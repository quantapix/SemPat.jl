import { exec } from 'child-process-promise';
import { join } from 'path';
import * as vscode from 'vscode';
import { onDidChangeConfig } from './extension';
import * as fs from 'async-file';
import * as path from 'path';
import * as telemetry from './telemetry';
import { registerCommand } from './utils';
import * as child_process from 'child_process';
import * as os from 'os';
import * as process from 'process';
import * as which from 'which';
import { setCurrentJuliaVersion, traceEvent } from './telemetry';

let juliaPackagePath = '';
let juliaDepotPath = '';
let actualJuliaExePath = '';

async function setNewJuliaExePath(newPath: string) {
  actualJuliaExePath = newPath;
  const env = {
    JULIA_LANGUAGESERVER: '1',
  };
  child_process.exec(`"${newPath}" --version`, { env: env }, (error, stdout, stderr) => {
    if (error) {
      actualJuliaExePath = '';
      return;
    }
    const version = stdout.trim();
    setCurrentJuliaVersion(version);
    traceEvent('configured-new-julia-binary');
  });
}

export async function getJuliaExePath() {
  if (actualJuliaExePath === null) {
    if (getExecutablePath() === null) {
      const homedir = os.homedir();
      let pathsToSearch = [];
      if (process.platform === 'win32') {
        pathsToSearch = ['julia.exe', path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.6.0', 'bin', 'julia.exe')];
      } else if (process.platform === 'darwin') {
        pathsToSearch = [
          'julia',
          path.join(homedir, 'Applications', 'Julia-1.6.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
          path.join('/', 'Applications', 'Julia-1.6.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
        ];
      } else {
        pathsToSearch = ['julia'];
      }
      for (const p of pathsToSearch) {
        try {
          const res = await exec(`"${p}" --startup-file=no --history-file=no -e "println(Sys.BINDIR)"`);
          if (p === 'julia' || p === 'julia.exe') {
            setNewJuliaExePath(path.join(res.stdout.trim(), p));
          } else {
            setNewJuliaExePath(p);
          }
          break;
        } catch (e) {}
      }
    } else {
      if (getExecutablePath().includes(path.sep)) {
        setNewJuliaExePath(getExecutablePath().replace(/^~/, os.homedir()));
      } else {
        // resolve full path
        let fullPath: string | undefined = undefined;
        try {
          fullPath = await which(getExecutablePath());
        } catch (err) {}
        if (fullPath) {
          setNewJuliaExePath(fullPath);
        }
      }
    }
  }
  return actualJuliaExePath;
}

function getExecutablePath() {
  const section = vscode.workspace.getConfiguration('julia');
  const jlpath = section ? section.get('executablePath', null) : null;
  return jlpath === '' ? null : jlpath;
}

export async function getPkgPath() {
  if (!juliaPackagePath) {
    const e = await getJuliaExePath();
    const p = await exec(`"${e}" --startup-file=no --history-file=no -e "using Pkg;println(Pkg.depots()[1])"`);
    juliaPackagePath = join(p.stdout.trim(), 'dev');
  }
  return juliaPackagePath;
}

export async function getPkgDepotPath() {
  if (!juliaDepotPath) {
    const e = await getJuliaExePath();
    const p = await exec(`"${e}" --startup-file=no --history-file=no -e "using Pkg; println.(Pkg.depots())"`);
    juliaDepotPath = p.stdout.trim().split('\n');
  }
  return juliaDepotPath;
}

async function openPackageDirectoryCommand() {
  telemetry.traceEvent('command-openpackagedirectory');
  const optionsPackage: vscode.QuickPickOptions = {
    placeHolder: 'Select package',
  };
  try {
    const juliaVersionHomeDir = await getPkgPath();
    const files = await fs.readdir(juliaVersionHomeDir);
    const filteredPackages = files.filter((path) => !path.startsWith('.') && ['METADATA', 'REQUIRE', 'META_BRANCH'].indexOf(path) < 0);
    if (filteredPackages.length === 0) {
      vscode.window.showInformationMessage('Error: There are no packages installed.');
    } else {
      const resultPackage = await vscode.window.showQuickPick(filteredPackages, optionsPackage);
      if (resultPackage !== undefined) {
        const folder = vscode.Uri.file(path.join(juliaVersionHomeDir, resultPackage));
        try {
          await vscode.commands.executeCommand('vscode.openFolder', folder, true);
        } catch (e) {
          vscode.window.showInformationMessage('Could not open the package.');
        }
      }
    }
  } catch (e) {
    vscode.window.showInformationMessage('Error: Could not read package directory.');
  }
}

export function activate(c: vscode.ExtensionContext) {
  c.subscriptions.push(
    onDidChangeConfig((x) => {
      if (x.affectsConfiguration('julia.executablePath')) {
        juliaPackagePath = '';
        actualJuliaExePath = '';
      }
    })
  );
  c.subscriptions.push(registerCommand('language-julia.openPackageDirectory', openPackageDirectoryCommand));
}

export class JuliaPackageDevFeature {
  constructor(private ctx: vscode.ExtensionContext) {
    this.ctx.subscriptions.push(registerCommand('language-julia.tagNewPackageVersion', () => this.tagNewPackageVersion()));
  }

  private async tagNewPackageVersion() {
    telemetry.traceEvent('command-tagnewpackageversion');
    let resultVersion = await vscode.window.showQuickPick(['Next', 'Major', 'Minor', 'Patch', 'Custom'], { placeHolder: 'Please select the version to be tagged.' });
    if (resultVersion === 'Custom') {
      resultVersion = await vscode.window.showInputBox({ prompt: 'Please enter the version number you want to tag.' });
    }
    if (resultVersion !== undefined) {
      const bar = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
      const accessToken = bar.accessToken;
      const account = bar.account.label;
      const exepath = await getJuliaExePath();
      const newTerm = vscode.window.createTerminal({
        name: 'Julia: Tag a new package version',
        shellPath: exepath,
        shellArgs: [path.join(this.ctx.extensionPath, 'scripts', 'packagedev', 'tagnewpackageversion.jl'), accessToken, account, resultVersion],
        cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
        env: {
          JULIA_PROJECT: path.join(this.ctx.extensionPath, 'scripts', 'environments', 'pkgdev'),
        },
      });
      newTerm.show(true);
    }
  }

  public dispose() {}
}
