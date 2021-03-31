import cp = require('child_process');
import { dirname, isAbsolute } from 'path';
import { toolExecutionEnvironment } from './goEnv';
import { promptForMissingTool } from './goInstallTools';
import { getBinPath } from './util';
import * as qv from 'vscode';

export function extractFunction() {
  extract('extract');
}

export function extractVariable() {
  extract('var');
}

type typeOfExtraction = 'var' | 'extract';

async function extract(type: typeOfExtraction): Promise<void> {
  const activeEditor = qv.window.activeTextEditor;
  if (!activeEditor) {
    qv.window.showInformationMessage('No editor is active.');
    return;
  }
  if (activeEditor.selections.length !== 1) {
    qv.window.showInformationMessage(`You need to have a single selection for extracting ${type === 'var' ? 'variable' : 'method'}`);
    return;
  }

  const newName = await qv.window.showInputBox({
    placeHolder: `Please enter a name for the extracted ${type === 'var' ? 'variable' : 'method'}.`,
  });

  if (!newName) {
    return;
  }

  runGoDoctor(newName, activeEditor.selection, activeEditor.document.fileName, type);
}

function runGoDoctor(newName: string, selection: qv.Selection, fileName: string, type: typeOfExtraction): Thenable<void> {
  const godoctor = getBinPath('godoctor');

  return new Promise((resolve, reject) => {
    if (!isAbsolute(godoctor)) {
      promptForMissingTool('godoctor');
      return resolve();
    }

    cp.execFile(
      godoctor,
      ['-w', '-pos', `${selection.start.line + 1},${selection.start.character + 1}:${selection.end.line + 1},${selection.end.character}`, '-file', fileName, type, newName],
      {
        env: toolExecutionEnvironment(),
        cwd: dirname(fileName),
      },
      (err, stdout, stderr) => {
        if (err) {
          qv.window.showErrorMessage(stderr || err.message);
        }
      }
    );
  });
}
