import { exec } from 'child-process-promise';
import { join } from 'path';
import * as vscode from 'vscode';
import { onDidChangeConfig } from './extension';
import * as fs from 'async-file';
import * as path from 'path';
import { registerCommand } from './utils';
import * as child_process from 'child_process';
import * as os from 'os';
import * as process from 'process';
import * as which from 'which';
import * as vslc from 'vscode-languageclient/node';
import { onSetLanguageClient } from './extension';

let juliaPackagePath = '';
let juliaDepotPath = '';
let actualJuliaExePath = '';
let g_languageClient: vslc.LanguageClient = null;
let g_current_environment: vscode.StatusBarItem = null;
let g_path_of_current_environment: string = null;
let g_path_of_default_environment: string = null;

export async function getProjectFilePaths(envpath: string) {
  const dlext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
  return {
    project_toml_path: (await fs.exists(path.join(envpath, 'JuliaProject.toml')))
      ? path.join(envpath, 'JuliaProject.toml')
      : (await fs.exists(path.join(envpath, 'Project.toml')))
      ? path.join(envpath, 'Project.toml')
      : undefined,
    manifest_toml_path: (await fs.exists(path.join(envpath, 'JuliaManifest.toml')))
      ? path.join(envpath, 'JuliaManifest.toml')
      : (await fs.exists(path.join(envpath, 'Manifest.toml')))
      ? path.join(envpath, 'Manifest.toml')
      : undefined,
    sysimage_path: (await fs.exists(path.join(envpath, `JuliaSysimage.${dlext}`))) ? path.join(envpath, `JuliaSysimage.${dlext}`) : undefined,
  };
}

export async function switchEnvToPath(envpath: string, notifyLS: boolean) {
  g_path_of_current_environment = envpath;
  const section = vscode.workspace.getConfiguration('julia');
  const currentConfigValue = section.get<string>('environmentPath');
  if (g_path_of_current_environment !== (await getDefaultEnvPath())) {
    if (currentConfigValue !== g_path_of_current_environment) {
      section.update('environmentPath', g_path_of_current_environment, vscode.ConfigurationTarget.Workspace);
    }
  } else {
    if (currentConfigValue !== null) {
      section.update('environmentPath', undefined, vscode.ConfigurationTarget.Workspace);
    }
  }
  g_current_environment.text = 'Julia env: ' + (await getEnvName());
  if (
    vscode.workspace.workspaceFolders !== undefined &&
    vscode.workspace.workspaceFolders.length === 1 &&
    vscode.workspace.workspaceFolders[0].uri.fsPath !== g_path_of_current_environment &&
    ((await fs.exists(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Project.toml'))) ||
      (await fs.exists(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaProject.toml'))))
  ) {
    const case_adjusted =
      process.platform === 'win32'
        ? vscode.workspace.workspaceFolders[0].uri.fsPath.charAt(0).toUpperCase() + vscode.workspace.workspaceFolders[0].uri.fsPath.slice(1)
        : vscode.workspace.workspaceFolders[0].uri.fsPath;

    const jlexepath = await getJuliaExePath();
    const res = await exec(
      `"${jlexepath}" --project=${g_path_of_current_environment} --startup-file=no --history-file=no -e "using Pkg; println(in(ARGS[1], VERSION>=VersionNumber(1,1,0) ? realpath.(filter(i->i!==nothing && isdir(i), getproperty.(values(Pkg.Types.Context().env.manifest), :path))) : realpath.(filter(i->i!=nothing && isdir(i), map(i->get(i[1], string(:path), nothing), values(Pkg.Types.Context().env.manifest)))) ))" "${case_adjusted}"`
    );
    if (res.stdout.trim() === 'false') {
      vscode.window
        .showInformationMessage('You opened a Julia package that is not part of your current environment. Do you want to activate a different environment?', 'Change Julia environment')
        .then((env_choice) => {
          if (env_choice === 'Change Julia environment') {
            changeJuliaEnvironment();
          }
        });
    }
  }
  if (notifyLS) {
    if (!g_languageClient) {
      return;
    }
    await g_languageClient.onReady();
    g_languageClient.sendNotification('julia/activateenvironment', { envPath: envpath });
  }
}

async function changeJuliaEnvironment() {
  const optionsEnv: vscode.QuickPickOptions = {
    placeHolder: 'Select environment',
  };
  const ds = await getPkgDepotPath();
  const projectNames = ['JuliaProject.toml', 'Project.toml'];
  const homeDir = os.homedir();
  const envFolders = [{ label: '(pick a folder)', description: '' }];
  if (vscode.workspace.workspaceFolders) {
    for (const f of vscode.workspace.workspaceFolders) {
      let cur = f.uri.fsPath.toString();
      while (true) {
        const old = cur;
        for (const p of projectNames) {
          if (await fs.exists(path.join(cur, p))) {
            envFolders.push({ label: path.basename(cur), description: cur });
            break;
          }
        }
        if (cur === homeDir) {
          break;
        }
        cur = path.dirname(cur);
        if (old === cur) {
          break;
        }
      }
    }
  }
  for (const d of ds) {
    const e = path.join(d, 'environments');
    if (await fs.exists(e)) {
      const xs = await fs.readdir(e);
      for (const x of xs) {
        envFolders.push({ label: x, description: path.join(e, x) });
      }
    }
  }
  const y = await vscode.window.showQuickPick(envFolders, optionsEnv);
  if (y !== undefined) {
    if (y.description === '') {
      const resultFolder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
      if (resultFolder !== undefined) {
        const envPathUri = resultFolder[0].toString();
        const envPath = vscode.Uri.parse(envPathUri).fsPath;
        const isThisAEnv = await fs.exists(path.join(envPath, 'Project.toml'));
        if (isThisAEnv) switchEnvToPath(envPath, true);
        else vscode.window.showErrorMessage('The selected path is not a julia environment.');
      }
    } else switchEnvToPath(y.description, true);
  }
}

async function getDefaultEnvPath() {
  if (g_path_of_default_environment === null) {
    if (vscode.workspace.workspaceFolders) {
      if (vscode.workspace.workspaceFolders.length === 1) {
        const projectFilePath1 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaProject.toml');
        const manifestFilePath1 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaManifest.toml');
        const projectFilePath2 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Project.toml');
        const manifestFilePath2 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Manifest.toml');
        if ((await fs.exists(projectFilePath1)) && (await fs.exists(manifestFilePath1))) {
          return vscode.workspace.workspaceFolders[0].uri.fsPath;
        } else if ((await fs.exists(projectFilePath2)) && (await fs.exists(manifestFilePath2))) {
          return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
      }
    }
    const jlexepath = await getJuliaExePath();
    const res = await exec(`"${jlexepath}" --startup-file=no --history-file=no -e "using Pkg; println(dirname(Pkg.Types.Context().env.project_file))"`);
    g_path_of_default_environment = res.stdout.trim();
  }
  return g_path_of_default_environment;
}

async function getEnvPath() {
  if (g_path_of_current_environment === null) {
    const section = vscode.workspace.getConfiguration('julia');
    const envPathConfig = section.get<string>('environmentPath');
    if (envPathConfig) {
      if (await fs.exists(absEnvPath(envPathConfig))) {
        g_path_of_current_environment = envPathConfig;
        return g_path_of_current_environment;
      }
    }
    g_path_of_current_environment = await getDefaultEnvPath();
  }
  return g_path_of_current_environment;
}

function absEnvPath(p: string) {
  if (path.isAbsolute(p)) {
    return p;
  } else {
    return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, p);
  }
}

export async function getAbsEnvPath() {
  const envPath = await getEnvPath();
  return absEnvPath(envPath);
}

export async function getEnvName() {
  const envpath = await getEnvPath();
  return path.basename(envpath);
}

async function setNewJuliaExePath(p: string) {
  actualJuliaExePath = p;
  const env = {
    JULIA_LANGUAGESERVER: '1',
  };
  child_process.exec(`"${p}" --version`, { env }, (e, stdout, _) => {
    if (e) {
      actualJuliaExePath = '';
      return;
    }
    const v = stdout.trim();
  });
}

export async function getJuliaExePath() {
  if (actualJuliaExePath === null) {
    if (!getExecutablePath()) {
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
  const c = vscode.workspace.getConfiguration('julia');
  const p = c ? c.get('executablePath', undefined) : undefined;
  return p === undefined ? '' : p;
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
  c.subscriptions.push(
    onSetLanguageClient((languageClient) => {
      g_languageClient = languageClient;
    })
  );
  c.subscriptions.push(registerCommand('language-julia.changeCurrentEnvironment', changeJuliaEnvironment));
  g_current_environment = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  g_current_environment.show();
  g_current_environment.text = 'Julia env: [loading]';
  g_current_environment.command = 'language-julia.changeCurrentEnvironment';
  c.subscriptions.push(g_current_environment);
  await switchEnvToPath(await getEnvPath(), false);
}

export class JuliaPackageDevFeature {
  constructor(private ctx: vscode.ExtensionContext) {
    this.ctx.subscriptions.push(registerCommand('language-julia.tagNewPackageVersion', () => this.tagNewPackageVersion()));
  }

  private async tagNewPackageVersion() {
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
