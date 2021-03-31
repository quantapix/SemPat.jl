import cp = require('child_process');
import fs = require('fs');
import moment = require('moment');
import os = require('os');
import * as path from 'path';
import { promisify } from 'util';
import { getGoConfig, IsInCloudIDE } from './config';
import { toolInstallationEnvironment } from './goEnv';
import { logVerbose } from './goLogging';
import { addGoStatus, goEnvStatusbarItem, outputChannel, removeGoStatus } from './goStatus';
import { getFromGlobalState, getFromWorkspaceState, updateGlobalState, updateWorkspaceState } from './stateUtils';
import { getBinPath, getCheckForToolsUpdatesConfig, getGoVersion, getTempFilePath, GoVersion, rmdirRecursive } from './util';
import { correctBinname, executableFileExists, fixDriveCasingInWindows, getBinPathFromEnvVar, getCurrentGoRoot, pathExists } from './utils/pathUtils';
import * as qv from 'vscode';
import WebRequest = require('web-request');

export class GoEnvironmentOption {
  public static fromQuickPickItem({ description, label }: qv.QuickPickItem): GoEnvironmentOption {
    return new GoEnvironmentOption(description, label);
  }

  constructor(public binpath: string, public label: string) {}

  public toQuickPickItem(): qv.QuickPickItem {
    return {
      label: this.label,
      description: this.binpath,
    };
  }
}

export let terminalCreationListener: qv.Disposable;

let environmentVariableCollection: qv.EnvironmentVariableCollection;
export function setEnvironmentVariableCollection(env: qv.EnvironmentVariableCollection) {
  environmentVariableCollection = env;
}

const CLEAR_SELECTION = '$(clear-all) Clear selection';
const CHOOSE_FROM_FILE_BROWSER = '$(folder) Choose from file browser';

export async function chooseGoEnvironment() {
  if (!goEnvStatusbarItem) {
    return;
  }
  if (!qv.workspace.name) {
    qv.window.showInformationMessage(`GOROOT: ${getCurrentGoRoot()}. Switching Go version is not yet supported in single-file mode.`);
    return;
  }
  let defaultOption: GoEnvironmentOption;
  let uninstalledOptions: GoEnvironmentOption[];
  let goSDKOptions: GoEnvironmentOption[];
  try {
    [defaultOption, uninstalledOptions, goSDKOptions] = await Promise.all([getDefaultGoOption(), fetchDownloadableGoVersions(), getSDKGoOptions()]);
  } catch (e) {
    qv.window.showErrorMessage(e.message);
    return;
  }
  const uninstalledQuickPicks = uninstalledOptions.map((op) => op.toQuickPickItem());
  const defaultQuickPick = defaultOption ? [defaultOption.toQuickPickItem()] : [];
  const goSDKQuickPicks = goSDKOptions.map((op) => op.toQuickPickItem());
  const clearOption: qv.QuickPickItem = { label: CLEAR_SELECTION };
  const filePickerOption: qv.QuickPickItem = {
    label: CHOOSE_FROM_FILE_BROWSER,
    description: 'Select the go binary to use',
  };
  const options = [filePickerOption, clearOption, ...defaultQuickPick, ...goSDKQuickPicks, ...uninstalledQuickPicks].reduce((opts, nextOption) => {
    if (opts.find((op) => op.description === nextOption.description || op.label === nextOption.label)) {
      return opts;
    }
    return [...opts, nextOption];
  }, [] as qv.QuickPickItem[]);
  const selection = await qv.window.showQuickPick<qv.QuickPickItem>(options);
  if (!selection) {
    return;
  }
  try {
    await setSelectedGo(GoEnvironmentOption.fromQuickPickItem(selection));
  } catch (e) {
    qv.window.showErrorMessage(e.message);
  }
}

export async function setSelectedGo(goOption: GoEnvironmentOption, promptReload = true): Promise<boolean> {
  if (!goOption) {
    return false;
  }
  if (goOption.binpath?.startsWith('go get')) {
    await downloadGo(goOption);
  } else if (goOption.label === CLEAR_SELECTION) {
    if (!getSelectedGo()) {
      return false; // do nothing.
    }
    await updateWorkspaceState('selectedGo', undefined);
  } else if (goOption.label === CHOOSE_FROM_FILE_BROWSER) {
    const currentGOROOT = getCurrentGoRoot();
    const defaultUri = currentGOROOT ? qv.Uri.file(path.join(currentGOROOT, 'bin')) : undefined;

    const newGoUris = await qv.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri,
    });
    if (!newGoUris || newGoUris.length !== 1) {
      return false;
    }
    const newGoBin = fixDriveCasingInWindows(newGoUris[0].fsPath);
    const oldGoBin = fixDriveCasingInWindows(path.join(defaultUri.fsPath, correctBinname('go')));

    if (newGoBin === oldGoBin) {
      return false;
    }
    if (!executableFileExists(newGoBin)) {
      qv.window.showErrorMessage(`${newGoBin} is not an executable`);
      return false;
    }
    const newGo = await getGoVersion(newGoBin);
    if (!newGo || !newGo.isValid()) {
      qv.window.showErrorMessage(`failed to get "${newGoBin} version", invalid Go binary`);
      return false;
    }
    await updateWorkspaceState('selectedGo', new GoEnvironmentOption(newGo.binaryPath, formatGoVersion(newGo)));
  } else {
    const go = await getGoVersion();
    if (!!go && (go.binaryPath === goOption.binpath || 'Go ' + go.format() === goOption.label)) {
      return false;
    }
    await updateWorkspaceState('selectedGo', goOption);
  }
  if (promptReload) {
    const choice = await qv.window.showInformationMessage('Please reload the window to finish applying Go version changes.', 'Reload Window');
    if (choice === 'Reload Window') {
      await qv.commands.executeCommand('workbench.action.reloadWindow');
    }
  }
  goEnvStatusbarItem.text = 'Go: reload required';
  goEnvStatusbarItem.command = 'workbench.action.reloadWindow';

  return true;
}

async function downloadGo(goOption: GoEnvironmentOption) {
  const execFile = promisify(cp.execFile);
  await qv.window.withProgress(
    {
      title: `Downloading ${goOption.label}`,
      location: qv.ProgressLocation.Notification,
    },
    async () => {
      outputChannel.show();
      outputChannel.clear();

      outputChannel.appendLine('Finding Go executable for downloading');
      const goExecutable = getBinPath('go');
      if (!goExecutable) {
        outputChannel.appendLine('Could not find Go executable.');
        throw new Error('Could not find Go tool.');
      }
      const mkdtemp = promisify(fs.mkdtemp);
      const toolsTmpDir = await mkdtemp(getTempFilePath('go-tools-'));
      let tmpGoModFile: string;
      tmpGoModFile = path.join(toolsTmpDir, 'go.mod');
      const writeFile = promisify(fs.writeFile);
      await writeFile(tmpGoModFile, 'module tools');
      const env = {
        ...toolInstallationEnvironment(),
        GO111MODULE: 'on',
      };
      const [, ...args] = goOption.binpath.split(' ');
      outputChannel.appendLine(`Running ${goExecutable} ${args.join(' ')}`);
      try {
        await execFile(goExecutable, args, {
          env,
          cwd: toolsTmpDir,
        });
      } catch (getErr) {
        outputChannel.appendLine(`Error finding Go: ${getErr}`);
        throw new Error('Could not find Go version.');
      }
      const newExecutableName = args[1].split('/')[2];
      const goXExecutable = getBinPath(newExecutableName);
      outputChannel.appendLine(`Running: ${goXExecutable} download`);
      try {
        await execFile(goXExecutable, ['download'], { env, cwd: toolsTmpDir });
      } catch (downloadErr) {
        outputChannel.appendLine(`Error finishing installation: ${downloadErr}`);
        throw new Error('Could not download Go version.');
      }

      outputChannel.appendLine('Finding newly downloaded Go');
      const sdkPath = path.join(os.homedir(), 'sdk');
      if (!(await pathExists(sdkPath))) {
        outputChannel.appendLine(`SDK path does not exist: ${sdkPath}`);
        throw new Error(`SDK path does not exist: ${sdkPath}`);
      }

      const readdir = promisify(fs.readdir);
      const subdirs = await readdir(sdkPath);
      const dir = subdirs.find((subdir) => subdir === newExecutableName);
      if (!dir) {
        outputChannel.appendLine('Could not find newly downloaded Go');
        throw new Error('Could not install Go version.');
      }

      const binpath = path.join(sdkPath, dir, 'bin', correctBinname('go'));
      const newOption = new GoEnvironmentOption(binpath, goOption.label);
      await updateWorkspaceState('selectedGo', newOption);

      // remove tmp directories
      outputChannel.appendLine('Cleaning up...');
      rmdirRecursive(toolsTmpDir);
      outputChannel.appendLine('Success!');
    }
  );
}

let defaultPathEnv = '';

function pathEnvVarName(): string | undefined {
  if (process.env.hasOwnProperty('PATH')) {
    return 'PATH';
  } else if (process.platform === 'win32' && process.env.hasOwnProperty('Path')) {
    return 'Path';
  } else {
    return;
  }
}

export function addGoRuntimeBaseToPATH(newGoRuntimeBase: string) {
  if (!newGoRuntimeBase) {
    return;
  }
  const pathEnvVar = pathEnvVarName();
  if (!pathEnvVar) {
    logVerbose("couldn't find PATH property in process.env");
    return;
  }

  if (!defaultPathEnv) {
    // cache the default value
    defaultPathEnv = <string>process.env[pathEnvVar];
  }

  logVerbose(`addGoRuntimeBase(${newGoRuntimeBase}) when PATH=${defaultPathEnv}`);
  if (process.platform !== 'darwin') {
    environmentVariableCollection?.prepend(pathEnvVar, newGoRuntimeBase + path.delimiter);
  } else {
    const terminalShellArgs = <string[]>(qv.workspace.getConfiguration('terminal.integrated.shellArgs').get('osx') || []);
    if (terminalShellArgs.includes('-l') || terminalShellArgs.includes('--login')) {
      for (const term of qv.window.terminals) {
        updateIntegratedTerminal(term);
      }
      if (!terminalCreationListener) {
        terminalCreationListener = qv.window.onDidOpenTerminal(updateIntegratedTerminal);
      }
    } else {
      environmentVariableCollection?.prepend(pathEnvVar, newGoRuntimeBase + path.delimiter);
    }
  }

  let pathVars = defaultPathEnv.split(path.delimiter);
  pathVars = pathVars.filter((p) => p !== newGoRuntimeBase);
  pathVars.unshift(newGoRuntimeBase);
  process.env[pathEnvVar] = pathVars.join(path.delimiter);
}

export function clearGoRuntimeBaseFromPATH() {
  if (terminalCreationListener) {
    const l = terminalCreationListener;
    terminalCreationListener = undefined;
    l.dispose();
  }
  const pathEnvVar = pathEnvVarName();
  if (!pathEnvVar) {
    logVerbose("couldn't find PATH property in process.env");
    return;
  }
  environmentVariableCollection?.delete(pathEnvVar);
}

export async function updateIntegratedTerminal(terminal: qv.Terminal): Promise<void> {
  if (!terminal) {
    return;
  }
  const gorootBin = path.join(getCurrentGoRoot(), 'bin');
  const defaultGoRuntime = getBinPathFromEnvVar('go', defaultPathEnv, false);
  if (defaultGoRuntime && gorootBin === path.dirname(defaultGoRuntime)) {
    return;
  }
  if (terminal.name.toLowerCase() === 'cmd') {
    terminal.sendText(`set PATH=${gorootBin};%Path%`, true);
    terminal.sendText('cls');
  } else if (['powershell', 'pwsh'].includes(terminal.name.toLowerCase())) {
    terminal.sendText(`$env:Path="${gorootBin};$env:Path"`, true);
    terminal.sendText('clear');
  } else if (terminal.name.toLowerCase() === 'fish') {
    terminal.sendText(`set -gx PATH ${gorootBin} $PATH`);
    terminal.sendText('clear');
  } else if (['bash', 'sh', 'zsh', 'ksh'].includes(terminal.name.toLowerCase())) {
    terminal.sendText(`export PATH=${gorootBin}:$PATH`, true);
    terminal.sendText('clear');
  }
}

export function getSelectedGo(): GoEnvironmentOption {
  return getFromWorkspaceState('selectedGo');
}

export function getGoEnvironmentStatusbarItem(): qv.StatusBarItem {
  return goEnvStatusbarItem;
}

export function formatGoVersion(version?: GoVersion): string {
  if (!version || !version.isValid()) {
    return 'Go (unknown)';
  }
  const versionStr = version.format(true);
  const versionWords = versionStr.split(' ');
  if (versionWords.length > 1 && versionWords[0] === 'devel') {
    return `Go ${versionWords[1]}`;
  } else {
    return `Go ${versionWords[0]}`;
  }
}

async function getSDKGoOptions(): Promise<GoEnvironmentOption[]> {
  const sdkPath = path.join(os.homedir(), 'sdk');

  if (!(await pathExists(sdkPath))) {
    return [];
  }
  const readdir = promisify(fs.readdir);
  const subdirs = await readdir(sdkPath);
  return subdirs.map((dir: string) => new GoEnvironmentOption(path.join(sdkPath, dir, 'bin', correctBinname('go')), dir.replace('go', 'Go ')));
}

export async function getDefaultGoOption(): Promise<GoEnvironmentOption | undefined> {
  const goroot = getCurrentGoRoot();
  if (!goroot) {
    return undefined;
  }
  const version = await getGoVersion();
  return new GoEnvironmentOption(path.join(goroot, 'bin', correctBinname('go')), formatGoVersion(version));
}

interface GoVersionWebResult {
  version: string;
  stable: boolean;
  files: {
    filename: string;
    os: string;
    arch: string;
    version: string;
    sha256: string;
    size: number;
    kind: string;
  }[];
}
async function fetchDownloadableGoVersions(): Promise<GoEnvironmentOption[]> {
  let webResults;
  try {
    webResults = await WebRequest.json<GoVersionWebResult[]>('https://golang.org/dl/?mode=json');
  } catch (error) {
    return [];
  }
  if (!webResults) {
    return [];
  }
  return webResults.reduce((opts, result: GoVersionWebResult) => {
    const dlPath = `go get golang.org/dl/${result.version}`;
    const label = result.version.replace('go', 'Go ');
    return [...opts, new GoEnvironmentOption(dlPath, label)];
  }, []);
}

export const latestGoVersionKey = 'latestGoVersions';
const oneday = 60 * 60 * 24 * 1000; // 24 hours in milliseconds

export async function getLatestGoVersions(): Promise<GoEnvironmentOption[]> {
  const timeout = oneday;
  const now = moment.now();

  let results: GoEnvironmentOption[];

  // Check if we can use cached results
  const cachedResults = getFromGlobalState(latestGoVersionKey);
  if (cachedResults && now - cachedResults.timestamp < timeout) {
    results = cachedResults.goVersions;
  } else {
    // fetch the latest supported Go versions
    try {
      // fetch the latest Go versions and cache the results
      results = await fetchDownloadableGoVersions();
      await updateGlobalState(latestGoVersionKey, {
        timestamp: now,
        goVersions: results,
      });
    } catch (e) {
      // hardcode the latest versions of Go in case golang.dl is unavailable
      results = [new GoEnvironmentOption('go get golang.org/dl/go1.15', 'Go 1.15'), new GoEnvironmentOption('go get golang.org/dl/go1.14.7', 'Go 1.14.7')];
    }
  }

  return results;
}

const dismissedGoVersionUpdatesKey = 'dismissedGoVersionUpdates';

export async function offerToInstallLatestGoVersion() {
  if (IsInCloudIDE) {
    return;
  }
  const goConfig = getGoConfig();
  const checkForUpdate = getCheckForToolsUpdatesConfig(goConfig);
  if (checkForUpdate === 'off' || checkForUpdate === 'local') {
    // 'proxy' or misconfiguration..
    return;
  }

  let options = await getLatestGoVersions();

  // filter out Go versions the user has already dismissed
  let dismissedOptions: GoEnvironmentOption[];
  dismissedOptions = await getFromGlobalState(dismissedGoVersionUpdatesKey);
  if (dismissedOptions) {
    options = options.filter((version) => !dismissedOptions.find((x) => x.label === version.label));
  }

  // compare to current go version.
  const currentVersion = await getGoVersion();
  if (currentVersion) {
    options = options.filter((version) => currentVersion.lt(version.label));
  }

  // notify user that there is a newer version of Go available
  if (options.length > 0) {
    addGoStatus('Go Update Available', 'go.promptforgoinstall', 'A newer version of Go is available');
    qv.commands.registerCommand('go.promptforgoinstall', () => {
      const download = {
        title: 'Download',
        async command() {
          await qv.env.openExternal(qv.Uri.parse('https://golang.org/dl/'));
        },
      };

      const neverAgain = {
        title: "Don't Show Again",
        async command() {
          // mark these versions as seen
          dismissedOptions = await getFromGlobalState(dismissedGoVersionUpdatesKey);
          if (!dismissedOptions) {
            dismissedOptions = [];
          }
          options.forEach((version) => {
            dismissedOptions.push(version);
          });
          await updateGlobalState(dismissedGoVersionUpdatesKey, dismissedOptions);
        },
      };

      let versionsText: string;
      if (options.length > 1) {
        versionsText = `${options
          .map((x) => x.label)
          .reduce((prev, next) => {
            return prev + ' and ' + next;
          })} are available`;
      } else {
        versionsText = `${options[0].label} is available`;
      }

      qv.window.showInformationMessage(`${versionsText}. You are currently using ${formatGoVersion(currentVersion)}.`, download, neverAgain).then((selection) => {
        removeGoStatus();
        selection.command();
      });
    });
  }
}
