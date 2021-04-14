import { exec } from 'child-process-promise';
import { join } from 'path';
import * as qv from 'vscode';
import { onDidChangeConfig } from './extension_rs';
import * as fs from 'async-file';
import * as path from 'path';
import { registerCommand } from './utils';
import * as child_process from 'child_process';
import * as os from 'os';
import * as process from 'process';
import * as which from 'which';
import * as vslc from 'vscode-languageclient/node';
import { onSetLangClient } from './extension_rs';

let juliaPackagePath = '';
let juliaDepotPath = '';
let actualJuliaExePath = '';
let g_languageClient: vslc.LangClient = null;
let g_current_environment: qv.StatusBarItem = null;
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
  const section = qv.workspace.getConfig('julia');
  const currentConfigValue = section.get<string>('environmentPath');
  if (g_path_of_current_environment !== (await getDefaultEnvPath())) {
    if (currentConfigValue !== g_path_of_current_environment) {
      section.update('environmentPath', g_path_of_current_environment, qv.ConfigTarget.Workspace);
    }
  } else {
    if (currentConfigValue !== null) {
      section.update('environmentPath', undefined, qv.ConfigTarget.Workspace);
    }
  }
  g_current_environment.text = 'Julia env: ' + (await getEnvName());
  if (
    qv.workspace.workspaceFolders !== undefined &&
    qv.workspace.workspaceFolders.length === 1 &&
    qv.workspace.workspaceFolders[0].uri.fsPath !== g_path_of_current_environment &&
    ((await fs.exists(path.join(qv.workspace.workspaceFolders[0].uri.fsPath, 'Project.toml'))) || (await fs.exists(path.join(qv.workspace.workspaceFolders[0].uri.fsPath, 'JuliaProject.toml'))))
  ) {
    const case_adjusted =
      process.platform === 'win32'
        ? qv.workspace.workspaceFolders[0].uri.fsPath.charAt(0).toUpperCase() + qv.workspace.workspaceFolders[0].uri.fsPath.slice(1)
        : qv.workspace.workspaceFolders[0].uri.fsPath;

    const jlexepath = await getJuliaExePath();
    const res = await exec(
      `"${jlexepath}" --project=${g_path_of_current_environment} --startup-file=no --history-file=no -e "using Pkg; println(in(ARGS[1], VERSION>=VersionNumber(1,1,0) ? realpath.(filter(i->i!==nothing && isdir(i), getproperty.(values(Pkg.Types.Context().env.manifest), :path))) : realpath.(filter(i->i!=nothing && isdir(i), map(i->get(i[1], string(:path), nothing), values(Pkg.Types.Context().env.manifest)))) ))" "${case_adjusted}"`
    );
    if (res.stdout.trim() === 'false') {
      qv.window
        .showInformationMessage('You opened a Julia package that is not part of your current environment. Do you want to activate a different environment?', 'Change Julia environment')
        .then((env_choice) => {
          if (env_choice === 'Change Julia environment') {
            changeJuliaEnvironment();
          }
        });
    }
  }
  if (notifyLS) {
    if (!g_languageClient) return;
    await g_languageClient.onReady();
    g_languageClient.sendNotification('julia/activateenvironment', { envPath: envpath });
  }
}

async function changeJuliaEnvironment() {
  const optionsEnv: qv.QuickPickOptions = {
    placeHolder: 'Select environment',
  };
  const ds = await getPkgDepotPath();
  const projectNames = ['JuliaProject.toml', 'Project.toml'];
  const homeDir = os.homedir();
  const envFolders = [{ label: '(pick a folder)', description: '' }];
  if (qv.workspace.workspaceFolders) {
    for (const f of qv.workspace.workspaceFolders) {
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
  const y = await qv.window.showQuickPick(envFolders, optionsEnv);
  if (y !== undefined) {
    if (y.description === '') {
      const resultFolder = await qv.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
      if (resultFolder !== undefined) {
        const envPathUri = resultFolder[0].toString();
        const envPath = qv.Uri.parse(envPathUri).fsPath;
        const isThisAEnv = await fs.exists(path.join(envPath, 'Project.toml'));
        if (isThisAEnv) switchEnvToPath(envPath, true);
        else qv.window.showErrorMessage('The selected path is not a julia environment.');
      }
    } else switchEnvToPath(y.description, true);
  }
}

async function getDefaultEnvPath() {
  if (g_path_of_default_environment === null) {
    if (qv.workspace.workspaceFolders) {
      if (qv.workspace.workspaceFolders.length === 1) {
        const projectFilePath1 = path.join(qv.workspace.workspaceFolders[0].uri.fsPath, 'JuliaProject.toml');
        const manifestFilePath1 = path.join(qv.workspace.workspaceFolders[0].uri.fsPath, 'JuliaManifest.toml');
        const projectFilePath2 = path.join(qv.workspace.workspaceFolders[0].uri.fsPath, 'Project.toml');
        const manifestFilePath2 = path.join(qv.workspace.workspaceFolders[0].uri.fsPath, 'Manifest.toml');
        if ((await fs.exists(projectFilePath1)) && (await fs.exists(manifestFilePath1))) {
          return qv.workspace.workspaceFolders[0].uri.fsPath;
        } else if ((await fs.exists(projectFilePath2)) && (await fs.exists(manifestFilePath2))) {
          return qv.workspace.workspaceFolders[0].uri.fsPath;
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
    const section = qv.workspace.getConfig('julia');
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
    return path.join(qv.workspace.workspaceFolders[0].uri.fsPath, p);
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
  const c = qv.workspace.getConfig('julia');
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

async function openPackageDirCommand() {
  const optionsPackage: qv.QuickPickOptions = {
    placeHolder: 'Select package',
  };
  try {
    const juliaVersionHomeDir = await getPkgPath();
    const files = await fs.readdir(juliaVersionHomeDir);
    const filteredPackages = files.filter((path) => !path.startsWith('.') && ['METADATA', 'REQUIRE', 'META_BRANCH'].indexOf(path) < 0);
    if (filteredPackages.length === 0) {
      qv.window.showInformationMessage('Error: There are no packages installed.');
    } else {
      const resultPackage = await qv.window.showQuickPick(filteredPackages, optionsPackage);
      if (resultPackage !== undefined) {
        const folder = qv.Uri.file(path.join(juliaVersionHomeDir, resultPackage));
        try {
          await qv.commands.executeCommand('qv.openFolder', folder, true);
        } catch (e) {
          qv.window.showInformationMessage('Could not open the package.');
        }
      }
    }
  } catch (e) {
    qv.window.showInformationMessage('Error: Could not read package directory.');
  }
}

export function activate(c: qv.ExtensionContext) {
  c.subscriptions.push(
    onDidChangeConfig((x) => {
      if (x.affectsConfig('julia.executablePath')) {
        juliaPackagePath = '';
        actualJuliaExePath = '';
      }
    })
  );
  c.subscriptions.push(registerCommand('language-julia.openPackageDir', openPackageDirCommand));
  c.subscriptions.push(
    onSetLangClient((languageClient) => {
      g_languageClient = languageClient;
    })
  );
  c.subscriptions.push(registerCommand('language-julia.changeCurrentEnvironment', changeJuliaEnvironment));
  g_current_environment = qv.window.createStatusBarItem(qv.StatusBarAlignment.Left);
  g_current_environment.show();
  g_current_environment.text = 'Julia env: [loading]';
  g_current_environment.command = 'language-julia.changeCurrentEnvironment';
  c.subscriptions.push(g_current_environment);
  await switchEnvToPath(await getEnvPath(), false);
}

export class JuliaPackageDevFeature {
  constructor(private ctx: qv.ExtensionContext) {
    this.ctx.subscriptions.push(registerCommand('language-julia.tagNewPackageVersion', () => this.tagNewPackageVersion()));
  }

  private async tagNewPackageVersion() {
    let resultVersion = await qv.window.showQuickPick(['Next', 'Major', 'Minor', 'Patch', 'Custom'], { placeHolder: 'Please select the version to be tagged.' });
    if (resultVersion === 'Custom') {
      resultVersion = await qv.window.showInputBox({ prompt: 'Please enter the version number you want to tag.' });
    }
    if (resultVersion !== undefined) {
      const bar = await qv.authentication.getSession('github', ['repo'], { createIfNone: true });
      const accessToken = bar.accessToken;
      const account = bar.account.label;
      const exepath = await getJuliaExePath();
      const newTerm = qv.window.createTerminal({
        name: 'Julia: Tag a new package version',
        shellPath: exepath,
        shellArgs: [path.join(this.ctx.extensionPath, 'scripts', 'packagedev', 'tagnewpackageversion.jl'), accessToken, account, resultVersion],
        cwd: qv.workspace.workspaceFolders?.[0].uri.fsPath,
        env: {
          JULIA_PROJECT: path.join(this.ctx.extensionPath, 'scripts', 'environments', 'pkgdev'),
        },
      });
      newTerm.show(true);
    }
  }

  public dispose() {}
}
