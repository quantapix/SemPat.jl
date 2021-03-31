import cp = require('child_process');
import { dirname } from 'path';
import { toolExecutionEnvironment } from './goEnv';
import { promptForMissingTool } from './goInstallTools';
import { getBinPath } from './util';
import * as qv from 'vscode';

// Supports only passing interface, see TODO in implCursor to finish
const inputRegex = /^(\w+\ \*?\w+\ )?([\w./]+)$/;

export function implCursor() {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    qv.window.showErrorMessage('No active editor found.');
    return;
  }
  const cursor = editor.selection;
  return qv.window
    .showInputBox({
      placeHolder: 'f *File io.Closer',
      prompt: 'Enter receiver and interface to implement.',
    })
    .then((implInput) => {
      if (typeof implInput === 'undefined') {
        return;
      }
      const matches = implInput.match(inputRegex);
      if (!matches) {
        qv.window.showInformationMessage(`Not parsable input: ${implInput}`);
        return;
      }
      runGoImpl([matches[1], matches[2]], cursor.start, editor);
    });
}

function runGoImpl(args: string[], insertPos: qv.Position, editor: qv.TextEditor) {
  const goimpl = getBinPath('impl');
  const p = cp.execFile(goimpl, args, { env: toolExecutionEnvironment(), cwd: dirname(editor.document.fileName) }, (err, stdout, stderr) => {
    if (err && (<any>err).code === 'ENOENT') {
      promptForMissingTool('impl');
      return;
    }

    if (err) {
      qv.window.showInformationMessage(`Cannot stub interface: ${stderr}`);
      return;
    }

    editor.edit((editBuilder) => {
      editBuilder.insert(insertPos, stdout);
    });
  });
  if (p.pid) {
    p.stdin.end();
  }
}
