import cp = require('child_process');
import * as qv from 'vscode';
import { buildCode } from './goBuild';
import { outputChannel } from './goStatus';
import { getBinPath, getCurrentGoPath, getImportPath } from './util';
import { envPath, getCurrentGoRoot } from './utils/pathUtils';

export function goGetPackage() {
  const editor = qv.window.activeTextEditor;
  const selection = editor.selection;
  const selectedText = editor.document.lineAt(selection.active.line).text;

  const importPath = getImportPath(selectedText);
  if (importPath === '') {
    qv.window.showErrorMessage('No import path to get');
    return;
  }

  const goRuntimePath = getBinPath('go');
  if (!goRuntimePath) {
    return qv.window.showErrorMessage(`Failed to run "go get" to get package as the "go" binary cannot be found in either GOROOT(${getCurrentGoRoot()}) or PATH(${envPath})`);
  }

  const env = Object.assign({}, process.env, { GOPATH: getCurrentGoPath() });

  cp.execFile(goRuntimePath, ['get', '-v', importPath], { env }, (err, stdout, stderr) => {
    // go get -v uses stderr to write output regardless of success or failure
    if (stderr !== '') {
      outputChannel.show();
      outputChannel.clear();
      outputChannel.appendLine(stderr);
      buildCode();
      return;
    }

    // go get -v doesn't write anything when the package already exists
    qv.window.showInformationMessage(`Package already exists: ${importPath}`);
  });
}
