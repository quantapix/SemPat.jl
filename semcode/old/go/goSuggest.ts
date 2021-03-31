import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from './config';
import { toolExecutionEnvironment } from './goEnv';
import { getTextEditForAddImport } from './goImport';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';
import { isModSupported } from './goModules';
import { getImportablePackages, PackageInfo } from './goPackages';
import {
  byteOffsetAt,
  getBinPath,
  getCurrentGoPath,
  getParametersAndReturnType,
  goBuiltinTypes,
  goKeywords,
  guessPackageNameFromFile,
  isPositionInComment,
  isPositionInString,
  parseFilePrelude,
  runGodoc,
} from './util';
import { getCurrentGoWorkspaceFromGOPATH } from './utils/pathUtils';

function vscodeKindFromGoCodeClass(kind: string, type: string): qv.CompletionItemKind {
  switch (kind) {
    case 'const':
      return qv.CompletionItemKind.Constant;
    case 'package':
      return qv.CompletionItemKind.Module;
    case 'type':
      switch (type) {
        case 'struct':
          return qv.CompletionItemKind.Class;
        case 'interface':
          return qv.CompletionItemKind.Interface;
      }
      return qv.CompletionItemKind.Struct;
    case 'func':
      return qv.CompletionItemKind.Function;
    case 'var':
      return qv.CompletionItemKind.Variable;
    case 'import':
      return qv.CompletionItemKind.Module;
  }
  return qv.CompletionItemKind.Property; // TODO@EG additional mappings needed?
}

interface GoCodeSuggestion {
  class: string;
  package?: string;
  name: string;
  type: string;
  receiver?: string;
}

class ExtendedCompletionItem extends qv.CompletionItem {
  public package?: string;
  public receiver?: string;
  public fileName: string;
}

const lineCommentFirstWordRegex = /^\s*\/\/\s+[\S]*$/;
const exportedMemberRegex = /(const|func|type|var)(\s+\(.*\))?\s+([A-Z]\w*)/;
const gocodeNoSupportForgbMsgKey = 'dontshowNoSupportForgb';

export class GoCompletionItemProvider implements qv.CompletionItemProvider, qv.Disposable {
  private pkgsList = new Map<string, PackageInfo>();
  private killMsgShown = false;
  private setGocodeOptions = true;
  private isGoMod = false;
  private globalState: qv.Memento;
  private previousFile: string;
  private previousFileDir: string;
  private gocodeFlags: string[];
  private excludeDocs = false;

  constructor(globalState?: qv.Memento) {
    this.globalState = globalState;
  }

  public provideCompletionItems(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken): Thenable<qv.CompletionList> {
    return this.provideCompletionItemsInternal(document, position, token, getGoConfig(document.uri)).then((result) => {
      if (!result) {
        return new qv.CompletionList([], false);
      }
      if (Array.isArray(result)) {
        return new qv.CompletionList(result, false);
      }
      return result;
    });
  }

  public resolveCompletionItem(item: qv.CompletionItem, token: qv.CancellationToken): qv.ProviderResult<qv.CompletionItem> {
    if (!(item instanceof ExtendedCompletionItem) || item.kind === qv.CompletionItemKind.Module || this.excludeDocs) {
      return;
    }

    if (typeof item.package === 'undefined') {
      promptForUpdatingTool('gocode');
      return;
    }

    return runGodoc(path.dirname(item.fileName), item.package || path.dirname(item.fileName), item.receiver, item.label, token)
      .then((doc) => {
        item.documentation = new qv.MarkdownString(doc);
        return item;
      })
      .catch((err) => {
        console.log(err);
        return item;
      });
  }

  public async provideCompletionItemsInternal(
    document: qv.TextDocument,
    position: qv.Position,
    token: qv.CancellationToken,
    config: qv.WorkspaceConfiguration
  ): Promise<qv.CompletionItem[] | qv.CompletionList> {
    // Completions for the package statement based on the file name
    const pkgStatementCompletions = await getPackageStatementCompletions(document);
    if (pkgStatementCompletions && pkgStatementCompletions.length) {
      return pkgStatementCompletions;
    }

    this.excludeDocs = false;
    this.gocodeFlags = ['-f=json'];
    if (Array.isArray(config['gocodeFlags'])) {
      this.gocodeFlags.push(...config['gocodeFlags']);
    }

    return this.ensureGoCodeConfigured(document.uri, config).then(() => {
      return new Promise<qv.CompletionItem[] | qv.CompletionList>((resolve, reject) => {
        const filename = document.fileName;
        const lineText = document.lineAt(position.line).text;
        const lineTillCurrentPosition = lineText.substr(0, position.character);
        const autocompleteUnimportedPackages = config['autocompleteUnimportedPackages'] === true && !lineText.match(/^(\s)*(import|package)(\s)+/);

        // triggering completions in comments on exported members
        const commentCompletion = getCommentCompletion(document, position);
        if (commentCompletion) {
          return resolve([commentCompletion]);
        }
        // prevent completion when typing in a line comment that doesnt start from the beginning of the line
        if (isPositionInComment(document, position)) {
          return resolve([]);
        }

        const inString = isPositionInString(document, position);
        if (!inString && lineTillCurrentPosition.endsWith('"')) {
          return resolve([]);
        }

        const currentWord = getCurrentWord(document, position);
        if (currentWord.match(/^\d+$/)) {
          return resolve([]);
        }

        let offset = byteOffsetAt(document, position);
        let inputText = document.getText();
        const includeUnimportedPkgs = autocompleteUnimportedPackages && !inString && currentWord.length > 0;

        return this.runGoCode(document, filename, inputText, offset, inString, position, lineText, currentWord, includeUnimportedPkgs, config).then((suggestions) => {
          // gocode does not suggest keywords, so we have to do it
          suggestions.push(...getKeywordCompletions(currentWord));

          // If no suggestions and cursor is at a dot, then check if preceeding word is a package name
          // If yes, then import the package in the inputText and run gocode again to get suggestions
          if ((!suggestions || suggestions.length === 0) && lineTillCurrentPosition.endsWith('.')) {
            const pkgPath = this.getPackagePathFromLine(lineTillCurrentPosition);
            if (pkgPath.length === 1) {
              // Now that we have the package path, import it right after the "package" statement
              const v = parseFilePrelude(qv.window.activeTextEditor.document.getText());
              const pkg = v.pkg;
              const posToAddImport = document.offsetAt(new qv.Position(pkg.start + 1, 0));
              const textToAdd = `import "${pkgPath[0]}"\n`;
              inputText = inputText.substr(0, posToAddImport) + textToAdd + inputText.substr(posToAddImport);
              offset += textToAdd.length;

              // Now that we have the package imported in the inputText, run gocode again
              return this.runGoCode(document, filename, inputText, offset, inString, position, lineText, currentWord, false, config).then((newsuggestions) => {
                // Since the new suggestions are due to the package that we imported,
                // add additionalTextEdits to do the same in the actual document in the editor
                // We use additionalTextEdits instead of command so that 'useCodeSnippetsOnFunctionSuggest'
                // feature continues to work
                newsuggestions.forEach((item) => {
                  item.additionalTextEdits = getTextEditForAddImport(pkgPath[0]);
                });
                resolve(newsuggestions);
              }, reject);
            }
            if (pkgPath.length > 1) {
              pkgPath.forEach((pkg) => {
                const item = new qv.CompletionItem(`${lineTillCurrentPosition.replace('.', '').trim()} (${pkg})`, qv.CompletionItemKind.Module);
                item.additionalTextEdits = getTextEditForAddImport(pkg);
                item.insertText = '';
                item.detail = pkg;
                item.command = {
                  title: 'Trigger Suggest',
                  command: 'editor.action.triggerSuggest',
                };
                suggestions.push(item);
              });
              resolve(new qv.CompletionList(suggestions, true));
            }
          }
          resolve(suggestions);
        }, reject);
      });
    });
  }

  public dispose() {
    const gocodeName = this.isGoMod ? 'gocode-gomod' : 'gocode';
    const gocode = getBinPath(gocodeName);
    if (path.isAbsolute(gocode)) {
      cp.spawn(gocode, ['close'], { env: toolExecutionEnvironment() });
    }
  }

  private runGoCode(
    document: qv.TextDocument,
    filename: string,
    inputText: string,
    offset: number,
    inString: boolean,
    position: qv.Position,
    lineText: string,
    currentWord: string,
    includeUnimportedPkgs: boolean,
    config: qv.WorkspaceConfiguration
  ): Thenable<qv.CompletionItem[]> {
    return new Promise<qv.CompletionItem[]>((resolve, reject) => {
      const gocodeName = this.isGoMod ? 'gocode-gomod' : 'gocode';
      const gocode = getBinPath(gocodeName);
      if (!path.isAbsolute(gocode)) {
        promptForMissingTool(gocodeName);
        return reject();
      }

      const env = toolExecutionEnvironment();
      let stdout = '';
      let stderr = '';

      // stamblerre/gocode does not support -unimported-packages flags.
      if (this.isGoMod) {
        const unimportedPkgIndex = this.gocodeFlags.indexOf('-unimported-packages');
        if (unimportedPkgIndex >= 0) {
          this.gocodeFlags.splice(unimportedPkgIndex, 1);
        }
      }

      // -exclude-docs is something we use internally and is not related to gocode
      const excludeDocsIndex = this.gocodeFlags.indexOf('-exclude-docs');
      if (excludeDocsIndex >= 0) {
        this.gocodeFlags.splice(excludeDocsIndex, 1);
        this.excludeDocs = true;
      }

      // Spawn `gocode` process
      const p = cp.spawn(gocode, [...this.gocodeFlags, 'autocomplete', filename, '' + offset], { env });
      p.stdout.on('data', (data) => (stdout += data));
      p.stderr.on('data', (data) => (stderr += data));
      p.on('error', (err) => {
        if (err && (<any>err).code === 'ENOENT') {
          promptForMissingTool(gocodeName);
          return reject();
        }
        return reject(err);
      });
      p.on('close', (code) => {
        try {
          if (code !== 0) {
            if (stderr.indexOf("rpc: can't find service Server.AutoComplete") > -1 && !this.killMsgShown) {
              qv.window.showErrorMessage('Auto-completion feature failed as an older gocode process is still running. Please kill the running process for gocode and try again.');
              this.killMsgShown = true;
            }
            if (stderr.startsWith('flag provided but not defined:')) {
              promptForUpdatingTool(gocodeName);
            }
            return reject();
          }
          const results = <[number, GoCodeSuggestion[]]>JSON.parse(stdout.toString());
          let suggestions: qv.CompletionItem[] = [];
          const packageSuggestions: string[] = [];

          const wordAtPosition = document.getWordRangeAtPosition(position);
          let areCompletionsForPackageSymbols = false;
          if (results && results[1]) {
            for (const suggest of results[1]) {
              if (inString && suggest.class !== 'import') {
                continue;
              }
              const item = new ExtendedCompletionItem(suggest.name);
              item.kind = vscodeKindFromGoCodeClass(suggest.class, suggest.type);
              item.package = suggest.package;
              item.receiver = suggest.receiver;
              item.fileName = document.fileName;
              item.detail = suggest.type;
              if (!areCompletionsForPackageSymbols && item.package && item.package !== 'builtin') {
                areCompletionsForPackageSymbols = true;
              }
              if (suggest.class === 'package') {
                const possiblePackageImportPaths = this.getPackageImportPath(item.label);
                if (possiblePackageImportPaths.length === 1) {
                  item.detail = possiblePackageImportPaths[0];
                }
                packageSuggestions.push(suggest.name);
              }
              if (inString && suggest.class === 'import') {
                item.textEdit = new qv.TextEdit(new qv.Range(position.line, lineText.substring(0, position.character).lastIndexOf('"') + 1, position.line, position.character), suggest.name);
              }
              if (
                (config['useCodeSnippetsOnFunctionSuggest'] || config['useCodeSnippetsOnFunctionSuggestWithoutType']) &&
                ((suggest.class === 'func' && lineText.substr(position.character, 2) !== '()') || // Avoids met() -> method()()
                  (suggest.class === 'var' &&
                    suggest.type.startsWith('func(') &&
                    lineText.substr(position.character, 1) !== ')' && // Avoids snippets when typing params in a func call
                    lineText.substr(position.character, 1) !== ',')) // Avoids snippets when typing params in a func call
              ) {
                const got = getParametersAndReturnType(suggest.type.substring(4));
                const params = got.params;
                const paramSnippets = [];
                for (let i = 0; i < params.length; i++) {
                  let param = params[i].trim();
                  if (param) {
                    param = param.replace('${', '\\${').replace('}', '\\}');
                    if (config['useCodeSnippetsOnFunctionSuggestWithoutType']) {
                      if (param.includes(' ')) {
                        // Separate the variable name from the type
                        param = param.substr(0, param.indexOf(' '));
                      }
                    }
                    paramSnippets.push('${' + (i + 1) + ':' + param + '}');
                  }
                }
                item.insertText = new qv.SnippetString(suggest.name + '(' + paramSnippets.join(', ') + ')');
              }
              if (config['useCodeSnippetsOnFunctionSuggest'] && suggest.class === 'type' && suggest.type.startsWith('func(')) {
                const { params, returnType } = getParametersAndReturnType(suggest.type.substring(4));
                const paramSnippets = [];
                for (let i = 0; i < params.length; i++) {
                  let param = params[i].trim();
                  if (param) {
                    param = param.replace('${', '\\${').replace('}', '\\}');
                    if (!param.includes(' ')) {
                      // If we don't have an argument name, we need to create one
                      param = 'arg' + (i + 1) + ' ' + param;
                    }
                    const arg = param.substr(0, param.indexOf(' '));
                    paramSnippets.push('${' + (i + 1) + ':' + arg + '}' + param.substr(param.indexOf(' '), param.length));
                  }
                }
                item.insertText = new qv.SnippetString(suggest.name + '(func(' + paramSnippets.join(', ') + ') {\n	$' + (params.length + 1) + '\n})' + returnType);
              }

              if (wordAtPosition && wordAtPosition.start.character === 0 && suggest.class === 'type' && !goBuiltinTypes.has(suggest.name)) {
                const auxItem = new qv.CompletionItem(suggest.name + ' method', qv.CompletionItemKind.Snippet);
                auxItem.label = 'func (*' + suggest.name + ')';
                auxItem.filterText = suggest.name;
                auxItem.detail = 'Method snippet';
                auxItem.sortText = 'b';
                const prefix = 'func (' + suggest.name[0].toLowerCase() + ' *' + suggest.name + ')';
                const snippet = prefix + ' ${1:methodName}(${2}) ${3} {\n\t$0\n}';
                auxItem.insertText = new qv.SnippetString(snippet);
                suggestions.push(auxItem);
              }

              // Add same sortText to all suggestions from gocode so that they appear before the unimported packages
              item.sortText = 'a';
              suggestions.push(item);
            }
          }

          // Add importable packages matching currentword to suggestions
          if (includeUnimportedPkgs && !this.isGoMod && !areCompletionsForPackageSymbols) {
            suggestions = suggestions.concat(getPackageCompletions(document, currentWord, this.pkgsList, packageSuggestions));
          }

          resolve(suggestions);
        } catch (e) {
          reject(e);
        }
      });
      if (p.pid) {
        p.stdin.end(inputText);
      }
    });
  }
  // TODO: Shouldn't lib-path also be set?
  private ensureGoCodeConfigured(fileuri: qv.Uri, goConfig: qv.WorkspaceConfiguration): Thenable<void> {
    const currentFile = fileuri.fsPath;
    let checkModSupport = Promise.resolve(this.isGoMod);
    if (this.previousFile !== currentFile && this.previousFileDir !== path.dirname(currentFile)) {
      this.previousFile = currentFile;
      this.previousFileDir = path.dirname(currentFile);
      checkModSupport = isModSupported(fileuri).then((result) => (this.isGoMod = result));
    }
    const setPkgsList = getImportablePackages(currentFile, true).then((pkgMap) => {
      this.pkgsList = pkgMap;
    });

    if (!this.setGocodeOptions) {
      return Promise.all([checkModSupport, setPkgsList]).then(() => {
        return;
      });
    }

    const setGocodeProps = new Promise<void>((resolve) => {
      const gocode = getBinPath('gocode');
      const env = toolExecutionEnvironment();

      cp.execFile(gocode, ['set'], { env }, (err, stdout) => {
        if (err && stdout.startsWith('gocode: unknown subcommand:')) {
          if (goConfig['gocodePackageLookupMode'] === 'gb' && this.globalState && !this.globalState.get(gocodeNoSupportForgbMsgKey)) {
            qv.window
              .showInformationMessage('The go.gocodePackageLookupMode setting for gb will not be honored as github.com/mdempskey/gocode doesnt support it yet.', "Don't show again")
              .then((selected) => {
                if (selected === "Don't show again") {
                  this.globalState.update(gocodeNoSupportForgbMsgKey, true);
                }
              });
          }
          this.setGocodeOptions = false;
          return resolve();
        }

        const existingOptions = stdout.split(/\r\n|\n/);
        const optionsToSet: string[][] = [];
        const setOption = () => {
          const [name, value] = optionsToSet.pop();
          cp.execFile(gocode, ['set', name, value], { env }, () => {
            if (optionsToSet.length) {
              setOption();
            } else {
              resolve();
            }
          });
        };

        if (existingOptions.indexOf('propose-builtins true') === -1) {
          optionsToSet.push(['propose-builtins', 'true']);
        }
        if (existingOptions.indexOf(`autobuild ${goConfig['gocodeAutoBuild']}`) === -1) {
          optionsToSet.push(['autobuild', goConfig['gocodeAutoBuild']]);
        }
        if (existingOptions.indexOf(`package-lookup-mode ${goConfig['gocodePackageLookupMode']}`) === -1) {
          optionsToSet.push(['package-lookup-mode', goConfig['gocodePackageLookupMode']]);
        }
        if (!optionsToSet.length) {
          return resolve();
        }

        setOption();
      });
    });

    return Promise.all([setPkgsList, setGocodeProps, checkModSupport]).then(() => {
      return;
    });
  }

  // Given a line ending with dot, return the import paths of packages that match with the word preceeding the dot
  private getPackagePathFromLine(line: string): string[] {
    const pattern = /(\w+)\.$/g;
    const wordmatches = pattern.exec(line);
    if (!wordmatches) {
      return [];
    }

    const [, pkgNameFromWord] = wordmatches;
    // Word is isolated. Now check pkgsList for a match
    return this.getPackageImportPath(pkgNameFromWord);
  }

  /**
   * Returns import path for given package. Since there can be multiple matches,
   * this returns an array of matches
   * @param input Package name
   */
  private getPackageImportPath(input: string): string[] {
    const matchingPackages: any[] = [];
    this.pkgsList.forEach((info: PackageInfo, pkgPath: string) => {
      if (input === info.name) {
        matchingPackages.push(pkgPath);
      }
    });
    return matchingPackages;
  }
}

/**
 * Provides completion item for the exported member in the next line if current line is a comment
 * @param document The current document
 * @param position The cursor position
 */
function getCommentCompletion(document: qv.TextDocument, position: qv.Position): qv.CompletionItem {
  const lineText = document.lineAt(position.line).text;
  const lineTillCurrentPosition = lineText.substr(0, position.character);
  // triggering completions in comments on exported members
  if (lineCommentFirstWordRegex.test(lineTillCurrentPosition) && position.line + 1 < document.lineCount) {
    const nextLine = document.lineAt(position.line + 1).text.trim();
    const memberType = nextLine.match(exportedMemberRegex);
    let suggestionItem: qv.CompletionItem;
    if (memberType && memberType.length === 4) {
      suggestionItem = new qv.CompletionItem(memberType[3], vscodeKindFromGoCodeClass(memberType[1], ''));
    }
    return suggestionItem;
  }
}

function getCurrentWord(document: qv.TextDocument, position: qv.Position): string {
  // get current word
  const wordAtPosition = document.getWordRangeAtPosition(position);
  let currentWord = '';
  if (wordAtPosition && wordAtPosition.start.character < position.character) {
    const word = document.getText(wordAtPosition);
    currentWord = word.substr(0, position.character - wordAtPosition.start.character);
  }

  return currentWord;
}

function getKeywordCompletions(currentWord: string): qv.CompletionItem[] {
  if (!currentWord.length) {
    return [];
  }
  const completionItems: qv.CompletionItem[] = [];
  goKeywords.forEach((keyword) => {
    if (keyword.startsWith(currentWord)) {
      completionItems.push(new qv.CompletionItem(keyword, qv.CompletionItemKind.Keyword));
    }
  });
  return completionItems;
}

/**
 * Return importable packages that match given word as Completion Items
 * @param document Current document
 * @param currentWord The word at the cursor
 * @param allPkgMap Map of all available packages and their import paths
 * @param importedPackages List of imported packages. Used to prune imported packages out of available packages
 */
function getPackageCompletions(document: qv.TextDocument, currentWord: string, allPkgMap: Map<string, PackageInfo>, importedPackages: string[] = []): qv.CompletionItem[] {
  const cwd = path.dirname(document.fileName);
  const goWorkSpace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
  const workSpaceFolder = qv.workspace.getWorkspaceFolder(document.uri);
  const currentPkgRootPath = (workSpaceFolder ? workSpaceFolder.uri.path : cwd).slice(goWorkSpace.length + 1);

  const completionItems: any[] = [];

  allPkgMap.forEach((info: PackageInfo, pkgPath: string) => {
    const pkgName = info.name;
    if (pkgName.startsWith(currentWord) && importedPackages.indexOf(pkgName) === -1) {
      const item = new qv.CompletionItem(pkgName, qv.CompletionItemKind.Keyword);
      item.detail = pkgPath;
      item.documentation = 'Imports the package';
      item.insertText = pkgName;
      item.command = {
        title: 'Import Package',
        command: 'go.import.add',
        arguments: [{ importPath: pkgPath, from: 'completion' }],
      };
      item.kind = qv.CompletionItemKind.Module;

      // Unimported packages should appear after the suggestions from gocode
      const isStandardPackage = !item.detail.includes('.');
      item.sortText = isStandardPackage ? 'za' : pkgPath.startsWith(currentPkgRootPath) ? 'zb' : 'zc';
      completionItems.push(item);
    }
  });
  return completionItems;
}

async function getPackageStatementCompletions(document: qv.TextDocument): Promise<qv.CompletionItem[]> {
  // 'Smart Snippet' for package clause
  const inputText = document.getText();
  if (inputText.match(/package\s+(\w+)/)) {
    return [];
  }

  const pkgNames = await guessPackageNameFromFile(document.fileName);
  const suggestions = pkgNames.map((pkgName) => {
    const packageItem = new qv.CompletionItem('package ' + pkgName);
    packageItem.kind = qv.CompletionItemKind.Snippet;
    packageItem.insertText = 'package ' + pkgName + '\r\n\r\n';
    return packageItem;
  });
  return suggestions;
}
