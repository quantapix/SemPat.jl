import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { getAllPackages } from './goPackages';
import { getBinPath, getCurrentGoPath, getImportPath } from './util';
import { envPath, getCurrentGoRoot } from './utils/pathUtils';

export function browsePackages() {
  let workDir = '';
  let selectedText = '';
  const editor = qv.window.activeTextEditor;
  if (editor) {
    const currentUri = editor.document.uri;
    workDir = path.dirname(currentUri.fsPath);
    const selection = editor.selection;
    if (!selection.isEmpty) {
      // get selected text
      selectedText = editor.document.getText(selection);
    } else {
      // if selection is empty, then get the whole line the cursor is currently on.
      selectedText = editor.document.lineAt(selection.active.line).text;
    }
    selectedText = getImportPath(selectedText) || selectedText.trim();
  } else if (qv.workspace.workspaceFolders && qv.workspace.workspaceFolders.length === 1) {
    const currentUri = qv.workspace.workspaceFolders[0].uri;
    workDir = currentUri.fsPath;
  }

  showPackageFiles(selectedText, true, workDir);
}

function showPackageFiles(pkg: string, showAllPkgsIfPkgNotFound: boolean, workDir: string) {
  const goRuntimePath = getBinPath('go');
  if (!goRuntimePath) {
    return qv.window.showErrorMessage(`Failed to run "go list" to fetch packages as the "go" binary cannot be found in either GOROOT(${getCurrentGoRoot()}) or PATH(${envPath})`);
  }

  if (!pkg && showAllPkgsIfPkgNotFound) {
    return showPackageList(workDir);
  }

  const options: { [key: string]: any } = {
    env: Object.assign({}, process.env, { GOPATH: getCurrentGoPath() }),
  };

  if (workDir) {
    options['cwd'] = workDir;
  }

  cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}:{{.GoFiles}}:{{.TestGoFiles}}:{{.XTestGoFiles}}', pkg], options, (err, stdout, stderr) => {
    if (!stdout || stdout.indexOf(':') === -1) {
      if (showAllPkgsIfPkgNotFound) {
        return showPackageList(workDir);
      }

      return;
    }

    const matches = stdout && stdout.match(/(.*):\[(.*)\]:\[(.*)\]:\[(.*)\]/);
    if (matches) {
      const dir = matches[1];
      let files = matches[2] ? matches[2].split(' ') : [];
      const testfiles = matches[3] ? matches[3].split(' ') : [];
      const xtestfiles = matches[4] ? matches[4].split(' ') : [];
      files = files.concat(testfiles);
      files = files.concat(xtestfiles);
      qv.window.showQuickPick(files, { placeHolder: `Below are Go files from ${pkg}` }).then((file) => {
        // if user abandoned list, file will be null and path.join will error out.
        // therefore return.
        if (!file) {
          return;
        }

        qv.workspace.openTextDocument(path.join(dir, file)).then((document) => {
          qv.window.showTextDocument(document);
        });
      });
    }
  });
}

function showPackageList(workDir: string) {
  return getAllPackages(workDir).then((pkgMap) => {
    const pkgs: string[] = Array.from(pkgMap.keys());
    if (pkgs.length === 0) {
      return qv.window.showErrorMessage('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
    }

    qv.window.showQuickPick(pkgs.sort(), { placeHolder: 'Select a package to browse' }).then((pkgFromDropdown) => {
      if (!pkgFromDropdown) {
        return;
      }
      showPackageFiles(pkgFromDropdown, false, workDir);
    });
  });
}
