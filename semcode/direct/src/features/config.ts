import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ServiceClient } from '../service';
import API from '../utils/api';
import { Disposable } from '../utils';
import * as fileSchemes from '../utils/fileSchemes';
import { isTypeScriptDocument } from '../utils/languageModeIds';
import { equals } from '../utils/objects';
import { ResourceMap } from '../utils/resourceMap';
import * as languageModeIds from '../utils/languageModeIds';
import * as jsonc from 'jsonc-parser';
import { basename, dirname, join } from 'path';
import { coalesce, flatten } from '../utils/arrays';

interface FileConfig {
  readonly formatOptions: qp.FormatCodeSettings;
  readonly preferences: qp.UserPreferences;
}
function areFileConfigsEqual(a: FileConfig, b: FileConfig): boolean {
  return equals(a, b);
}
export default class FileConfigMgr extends Disposable {
  private readonly formatOptions: ResourceMap<Promise<FileConfig | undefined>>;
  public constructor(private readonly client: ServiceClient, onCaseInsenitiveFileSystem: boolean) {
    super();
    this.formatOptions = new ResourceMap(undefined, { onCaseInsenitiveFileSystem });
    qv.workspace.onDidCloseTextDocument(
      (textDocument) => {
        this.formatOptions.delete(textDocument.uri);
      },
      undefined,
      this._disposables
    );
  }
  public async ensureConfigForDocument(document: qv.TextDocument, token: qv.CancellationToken): Promise<void> {
    const formattingOptions = this.getFormattingOptions(document);
    if (formattingOptions) return this.ensureConfigOptions(document, formattingOptions, token);
  }
  private getFormattingOptions(document: qv.TextDocument): qv.FormattingOptions | undefined {
    const editor = qv.window.visibleTextEditors.find((editor) => editor.document.fileName === document.fileName);
    return editor
      ? ({
          tabSize: editor.options.tabSize,
          insertSpaces: editor.options.insertSpaces,
        } as qv.FormattingOptions)
      : undefined;
  }
  public async ensureConfigOptions(document: qv.TextDocument, options: qv.FormattingOptions, token: qv.CancellationToken): Promise<void> {
    const file = this.client.toOpenedFilePath(document);
    if (!file) return;
    const currentOptions = this.getFileOptions(document, options);
    const cachedOptions = this.formatOptions.get(document.uri);
    if (cachedOptions) {
      const cachedOptionsValue = await cachedOptions;
      if (cachedOptionsValue && areFileConfigsEqual(cachedOptionsValue, currentOptions)) return;
    }
    let resolve: (x: FileConfig | undefined) => void;
    this.formatOptions.set(document.uri, new Promise<FileConfig | undefined>((r) => (resolve = r)));
    const args: qp.ConfigureRequestArguments = {
      file,
      ...currentOptions,
    };
    try {
      const response = await this.client.execute('configure', args, token);
      resolve!(response.type === 'response' ? currentOptions : undefined);
    } finally {
      resolve!(undefined);
    }
  }
  public async setGlobalConfigFromDocument(document: qv.TextDocument, token: qv.CancellationToken): Promise<void> {
    const formattingOptions = this.getFormattingOptions(document);
    if (!formattingOptions) return;
    const args: qp.ConfigureRequestArguments = {
      file: undefined /*global*/,
      ...this.getFileOptions(document, formattingOptions),
    };
    await this.client.execute('configure', args, token);
  }
  public reset() {
    this.formatOptions.clear();
  }
  private getFileOptions(document: qv.TextDocument, options: qv.FormattingOptions): FileConfig {
    return {
      formatOptions: this.getFormatOptions(document, options),
      preferences: this.getPreferences(document),
    };
  }
  private getFormatOptions(document: qv.TextDocument, options: qv.FormattingOptions): qp.FormatCodeSettings {
    const config = qv.workspace.getConfig(isTypeScriptDocument(document) ? 'typescript.format' : 'javascript.format', document.uri);
    return {
      tabSize: options.tabSize,
      indentSize: options.tabSize,
      convertTabsToSpaces: options.insertSpaces,
      newLineCharacter: '\n',
      insertSpaceAfterCommaDelimiter: config.get<boolean>('insertSpaceAfterCommaDelimiter'),
      insertSpaceAfterConstructor: config.get<boolean>('insertSpaceAfterConstructor'),
      insertSpaceAfterSemicolonInForStatements: config.get<boolean>('insertSpaceAfterSemicolonInForStatements'),
      insertSpaceBeforeAndAfterBinaryOperators: config.get<boolean>('insertSpaceBeforeAndAfterBinaryOperators'),
      insertSpaceAfterKeywordsInControlFlowStatements: config.get<boolean>('insertSpaceAfterKeywordsInControlFlowStatements'),
      insertSpaceAfterFunctionKeywordForAnonymousFunctions: config.get<boolean>('insertSpaceAfterFunctionKeywordForAnonymousFunctions'),
      insertSpaceBeforeFunctionParenthesis: config.get<boolean>('insertSpaceBeforeFunctionParenthesis'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces'),
      insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingEmptyBraces'),
      insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces'),
      insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces'),
      insertSpaceAfterTypeAssertion: config.get<boolean>('insertSpaceAfterTypeAssertion'),
      placeOpenBraceOnNewLineForFunctions: config.get<boolean>('placeOpenBraceOnNewLineForFunctions'),
      placeOpenBraceOnNewLineForControlBlocks: config.get<boolean>('placeOpenBraceOnNewLineForControlBlocks'),
      semicolons: config.get<qp.SemicolonPreference>('semicolons'),
    };
  }
  private getPreferences(document: qv.TextDocument): qp.UserPreferences {
    if (this.client.apiVersion.lt(API.v290)) {
      return {};
    }
    const config = qv.workspace.getConfig(isTypeScriptDocument(document) ? 'typescript' : 'javascript', document.uri);
    const preferencesConfig = qv.workspace.getConfig(isTypeScriptDocument(document) ? 'typescript.preferences' : 'javascript.preferences', document.uri);
    const preferences: qp.UserPreferences = {
      quotePreference: this.getQuoteStylePreference(preferencesConfig),
      importModuleSpecifierPreference: getImportModuleSpecifierPreference(preferencesConfig),
      importModuleSpecifierEnding: getImportModuleSpecifierEndingPreference(preferencesConfig),
      allowTextChangesInNewFiles: document.uri.scheme === fileSchemes.file,
      providePrefixAndSuffixTextForRename: preferencesConfig.get<boolean>('renameShorthandProperties', true) === false ? false : preferencesConfig.get<boolean>('useAliasesForRenames', true),
      allowRenameOfImportPath: true,
      includeAutomaticOptionalChainCompletions: config.get<boolean>('suggest.includeAutomaticOptionalChainCompletions', true),
      provideRefactorNotApplicableReason: true,
      generateReturnInDocTemplate: config.get<boolean>('suggest.jsdoc.generateReturns', true),
    };
    return preferences;
  }
  private getQuoteStylePreference(config: qv.WorkspaceConfiguration) {
    switch (config.get<string>('quoteStyle')) {
      case 'single':
        return 'single';
      case 'double':
        return 'double';
      default:
        return this.client.apiVersion.gte(API.v333) ? 'auto' : undefined;
    }
  }
}
function getImportModuleSpecifierPreference(config: qv.WorkspaceConfiguration) {
  switch (config.get<string>('importModuleSpecifier')) {
    case 'project-relative':
      return 'project-relative';
    case 'relative':
      return 'relative';
    case 'non-relative':
      return 'non-relative';
    default:
      return undefined;
  }
}
function getImportModuleSpecifierEndingPreference(config: qv.WorkspaceConfiguration) {
  switch (config.get<string>('importModuleSpecifierEnding')) {
    case 'minimal':
      return 'minimal';
    case 'index':
      return 'index';
    case 'js':
      return 'js';
    default:
      return 'auto';
  }
}

const jsTsLangConfig: qv.LangConfig = {
  indentationRules: {
    decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[\}\]].*$/,
    increaseIndentPattern: /^((?!\/\/).)*(\{([^}"'`]*|(\t|[ ])*\/\/.*)|\([^)"'`]*|\[[^\]"'`]*)$/,
    unIndentedLinePattern: /^(\t|[ ])*[ ]\*[^/]*\*\/\s*$|^(\t|[ ])*[ ]\*\/\s*$|^(\t|[ ])*[ ]\*([ ]([^\*]|\*(?!\/))*)?$/,
  },
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  onEnterRules: [
    {
      beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
      afterText: /^\s*\*\/$/,
      action: { indentAction: qv.IndentAction.IndentOutdent, appendText: ' * ' },
    },
    {
      beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
      action: { indentAction: qv.IndentAction.None, appendText: ' * ' },
    },
    {
      beforeText: /^(\t|[ ])*[ ]\*([ ]([^\*]|\*(?!\/))*)?$/,
      previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/,
      action: { indentAction: qv.IndentAction.None, appendText: '* ' },
    },
    {
      beforeText: /^(\t|[ ])*[ ]\*\/\s*$/,
      action: { indentAction: qv.IndentAction.None, removeText: 1 },
    },
    {
      beforeText: /^(\t|[ ])*[ ]\*[^/]*\*\/\s*$/,
      action: { indentAction: qv.IndentAction.None, removeText: 1 },
    },
    {
      beforeText: /^\s*(\bcase\s.+:|\bdefault:)$/,
      afterText: /^(?!\s*(\bcase\b|\bdefault\b))/,
      action: { indentAction: qv.IndentAction.Indent },
    },
  ],
};
const EMPTY_ELEMENTS: string[] = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'menuitem', 'meta', 'param', 'source', 'track', 'wbr'];
const jsxTagsLangConfig: qv.LangConfig = {
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
  onEnterRules: [
    {
      beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w\\-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
      afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
      action: { indentAction: qv.IndentAction.IndentOutdent },
    },
    {
      beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w\\-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
      action: { indentAction: qv.IndentAction.Indent },
    },
    {
      beforeText: /^>$/,
      afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
      action: { indentAction: qv.IndentAction.IndentOutdent },
    },
    {
      beforeText: /^>$/,
      action: { indentAction: qv.IndentAction.Indent },
    },
  ],
};
export class LangConfigMgr extends Disposable {
  constructor() {
    super();
    const standardLangs = [languageModeIds.javascript, languageModeIds.javascriptreact, languageModeIds.typescript, languageModeIds.typescriptreact];
    for (const language of standardLangs) {
      this.registerConfig(language, jsTsLangConfig);
    }
    this.registerConfig(languageModeIds.jsxTags, jsxTagsLangConfig);
  }
  private registerConfig(language: string, config: qv.LangConfig) {
    this._register(qv.languages.setLangConfig(language, config));
  }
}

export interface TSConfig {
  readonly uri: qv.Uri;
  readonly fsPath: string;
  readonly posixPath: string;
  readonly workspaceFolder?: qv.WorkspaceFolder;
}
export class TsConfig {
  public async getConfigsForWorkspace(token: qv.CancellationToken): Promise<Iterable<TSConfig>> {
    if (!qv.workspace.workspaceFolders) return [];
    const configs = new Map<string, TSConfig>();
    for (const config of await this.findConfigFiles(token)) {
      const root = qv.workspace.getWorkspaceFolder(config);
      if (root) configs.set(config.fsPath, { uri: config, fsPath: config.fsPath, posixPath: config.path, workspaceFolder: root });
    }
    return configs.values();
  }
  private async findConfigFiles(token: qv.CancellationToken): Promise<qv.Uri[]> {
    return await qv.workspace.findFiles('**/tsconfig*.json', '**/{node_modules,.*}/**', undefined, token);
  }
}
function mapChildren<R>(node: jsonc.Node | undefined, f: (x: jsonc.Node) => R): R[] {
  return node && node.type === 'array' && node.children ? node.children.map(f) : [];
}
class TsconfigLinkProvider implements qv.DocumentLinkProvider {
  public provideDocumentLinks(document: qv.TextDocument, _token: qv.CancellationToken): qv.ProviderResult<qv.DocumentLink[]> {
    const root = jsonc.parseTree(document.getText());
    if (!root) return null;
    return coalesce([this.getExtendsLink(document, root), ...this.getFilesLinks(document, root), ...this.getReferencesLinks(document, root)]);
  }
  private getExtendsLink(document: qv.TextDocument, root: jsonc.Node): qv.DocumentLink | undefined {
    const extendsNode = jsonc.findNodeAtLocation(root, ['extends']);
    if (!this.isPathValue(extendsNode)) {
      return undefined;
    }
    if (extendsNode.value.startsWith('.')) {
      return new qv.DocumentLink(this.getRange(document, extendsNode), qv.Uri.file(join(dirname(document.uri.fsPath), extendsNode.value + (extendsNode.value.endsWith('.json') ? '' : '.json'))));
    }
    const workspaceFolderPath = qv.workspace.getWorkspaceFolder(document.uri)!.uri.fsPath;
    return new qv.DocumentLink(this.getRange(document, extendsNode), qv.Uri.file(join(workspaceFolderPath, 'node_modules', extendsNode.value + (extendsNode.value.endsWith('.json') ? '' : '.json'))));
  }
  private getFilesLinks(document: qv.TextDocument, root: jsonc.Node) {
    return mapChildren(jsonc.findNodeAtLocation(root, ['files']), (child) => this.pathNodeToLink(document, child));
  }
  private getReferencesLinks(document: qv.TextDocument, root: jsonc.Node) {
    return mapChildren(jsonc.findNodeAtLocation(root, ['references']), (child) => {
      const pathNode = jsonc.findNodeAtLocation(child, ['path']);
      if (!this.isPathValue(pathNode)) {
        return undefined;
      }
      return new qv.DocumentLink(this.getRange(document, pathNode), basename(pathNode.value).endsWith('.json') ? this.getFileTarget(document, pathNode) : this.getFolderTarget(document, pathNode));
    });
  }
  private pathNodeToLink(document: qv.TextDocument, node: jsonc.Node | undefined): qv.DocumentLink | undefined {
    return this.isPathValue(node) ? new qv.DocumentLink(this.getRange(document, node), this.getFileTarget(document, node)) : undefined;
  }
  private isPathValue(extendsNode: jsonc.Node | undefined): extendsNode is jsonc.Node {
    return extendsNode && extendsNode.type === 'string' && extendsNode.value && !(extendsNode.value as string).includes('*'); // don't treat globs as links.
  }
  private getFileTarget(document: qv.TextDocument, node: jsonc.Node): qv.Uri {
    return qv.Uri.file(join(dirname(document.uri.fsPath), node!.value));
  }
  private getFolderTarget(document: qv.TextDocument, node: jsonc.Node): qv.Uri {
    return qv.Uri.file(join(dirname(document.uri.fsPath), node!.value, 'tsconfig.json'));
  }
  private getRange(document: qv.TextDocument, node: jsonc.Node) {
    const offset = node!.offset;
    const start = document.positionAt(offset + 1);
    const end = document.positionAt(offset + (node!.length - 1));
    return new qv.Range(start, end);
  }
}
export function register() {
  const patterns: qv.GlobPattern[] = ['**/[jt]sconfig.json', '**/[jt]sconfig.*.json'];
  const languages = ['json', 'jsonc'];
  const selector: qv.DocumentSelector = flatten(languages.map((language) => patterns.map((pattern): qv.DocumentFilter => ({ language, pattern }))));
  return qv.languages.registerDocumentLinkProvider(selector, new TsconfigLinkProvider());
}
