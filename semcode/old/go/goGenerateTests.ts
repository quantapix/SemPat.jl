import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from './config';
import { toolExecutionEnvironment } from './goEnv';
import { promptForMissingTool } from './goInstallTools';
import { GoDocumentSymbolProvider } from './go/symbol';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';

const generatedWord = 'Generated ';

function checkActiveEditor(): qv.TextEditor | undefined {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    qv.window.showInformationMessage('Cannot generate unit tests. No editor selected.');
    return;
  }
  if (!editor.document.fileName.endsWith('.go')) {
    qv.window.showInformationMessage('Cannot generate unit tests. File in the editor is not a Go file.');
    return;
  }
  if (editor.document.isDirty) {
    qv.window.showInformationMessage('File has unsaved changes. Save and try again.');
    return;
  }
  return editor;
}

export function toggleTestFile(): void {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    qv.window.showInformationMessage('Cannot toggle test file. No editor selected.');
    return;
  }
  const currentFilePath = editor.document.fileName;
  if (!currentFilePath.endsWith('.go')) {
    qv.window.showInformationMessage('Cannot toggle test file. File in the editor is not a Go file.');
    return;
  }
  let targetFilePath = '';
  if (currentFilePath.endsWith('_test.go')) {
    targetFilePath = currentFilePath.substr(0, currentFilePath.lastIndexOf('_test.go')) + '.go';
  } else {
    targetFilePath = currentFilePath.substr(0, currentFilePath.lastIndexOf('.go')) + '_test.go';
  }
  for (const doc of qv.window.visibleTextEditors) {
    if (doc.document.fileName === targetFilePath) {
      qv.commands.executeCommand('qv.open', qv.Uri.file(targetFilePath), doc.viewColumn);
      return;
    }
  }
  qv.commands.executeCommand('qv.open', qv.Uri.file(targetFilePath));
}

export function generateTestCurrentPackage(): Promise<boolean> {
  const editor = checkActiveEditor();
  if (!editor) {
    return;
  }
  return generateTests(
    {
      dir: path.dirname(editor.document.uri.fsPath),
      isTestFile: editor.document.fileName.endsWith('_test.go'),
    },
    getGoConfig(editor.document.uri)
  );
}

export function generateTestCurrentFile(): Promise<boolean> {
  const editor = checkActiveEditor();
  if (!editor) {
    return;
  }

  return generateTests(
    {
      dir: editor.document.uri.fsPath,
      isTestFile: editor.document.fileName.endsWith('_test.go'),
    },
    getGoConfig(editor.document.uri)
  );
}

export async function generateTestCurrentFunction(): Promise<boolean> {
  const editor = checkActiveEditor();
  if (!editor) {
    return;
  }

  const functions = await getFunctions(editor.document);
  const selection = editor.selection;
  const currentFunction: qv.DocumentSymbol = functions.find((func) => selection && func.range.contains(selection.start));

  if (!currentFunction) {
    qv.window.showInformationMessage('No function found at cursor.');
    return Promise.resolve(false);
  }
  let funcName = currentFunction.name;
  const funcNameParts = funcName.match(/^\(\*?(.*)\)\.(.*)$/);
  if (funcNameParts != null && funcNameParts.length === 3) {
    // receiver type specified
    const rType = funcNameParts[1].replace(/^\w/, (c) => c.toUpperCase());
    const fName = funcNameParts[2].replace(/^\w/, (c) => c.toUpperCase());
    funcName = rType + fName;
  }

  return generateTests(
    {
      dir: editor.document.uri.fsPath,
      func: funcName,
      isTestFile: editor.document.fileName.endsWith('_test.go'),
    },
    getGoConfig(editor.document.uri)
  );
}

interface Config {
  dir: string;
  func?: string;
  isTestFile?: boolean;
}

function generateTests(conf: Config, goConfig: qv.WorkspaceConfiguration): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const cmd = getBinPath('gotests');
    let args = ['-w'];
    const goGenerateTestsFlags: string[] = goConfig['generateTestsFlags'] || [];

    for (let i = 0; i < goGenerateTestsFlags.length; i++) {
      const flag = goGenerateTestsFlags[i];
      if (flag === '-w' || flag === 'all') {
        continue;
      }
      if (flag === '-only') {
        i++;
        continue;
      }
      args.push(flag);
    }

    if (conf.func) {
      args = args.concat(['-only', `^${conf.func}$`, conf.dir]);
    } else {
      args = args.concat(['-all', conf.dir]);
    }

    cp.execFile(cmd, args, { env: toolExecutionEnvironment() }, (err, stdout, stderr) => {
      outputChannel.appendLine('Generating Tests: ' + cmd + ' ' + args.join(' '));

      try {
        if (err && (<any>err).code === 'ENOENT') {
          promptForMissingTool('gotests');
          return resolve(false);
        }
        if (err) {
          console.log(err);
          outputChannel.appendLine(err.message);
          return reject('Cannot generate test due to errors');
        }

        let message = stdout;
        let testsGenerated = false;

        // Expected stdout is of the format "Generated TestMain\nGenerated Testhello\n"
        if (stdout.startsWith(generatedWord)) {
          const lines = stdout
            .split('\n')
            .filter((element) => {
              return element.startsWith(generatedWord);
            })
            .map((element) => {
              return element.substr(generatedWord.length);
            });
          message = `Generated ${lines.join(', ')}`;
          testsGenerated = true;
        }

        qv.window.showInformationMessage(message);
        outputChannel.append(message);

        if (testsGenerated && !conf.isTestFile) {
          toggleTestFile();
        }

        return resolve(true);
      } catch (e) {
        qv.window.showInformationMessage(e.msg);
        outputChannel.append(e.msg);
        reject(e);
      }
    });
  });
}

async function getFunctions(doc: qv.TextDocument): Promise<qv.DocumentSymbol[]> {
  const documentSymbolProvider = new GoDocumentSymbolProvider();
  const symbols = await documentSymbolProvider.provideDocumentSymbols(doc, null);
  return symbols[0].children.filter((sym) => sym.kind === qv.SymbolKind.Function);
}
