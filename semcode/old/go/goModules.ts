import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from './config';
import { toolExecutionEnvironment } from './goEnv';
import { getFormatTool } from '../../direct/src/features/go/format';
import { installTools } from './goInstallTools';
import { getTool } from './goTools';
import { getFromGlobalState, updateGlobalState } from './stateUtils';
import { getBinPath, getGoVersion, getModuleCache } from './util';
import { envPath, fixDriveCasingInWindows, getCurrentGoRoot } from './utils/pathUtils';

export let GO111MODULE: string;

async function runGoModEnv(folderPath: string): Promise<string> {
  const goExecutable = getBinPath('go');
  if (!goExecutable) {
    console.warn(`Failed to run "go env GOMOD" to find mod file as the "go" binary cannot be found in either GOROOT(${getCurrentGoRoot()}) or PATH(${envPath})`);
    return;
  }
  const env = toolExecutionEnvironment();
  GO111MODULE = env['GO111MODULE'];
  return new Promise((resolve) => {
    cp.execFile(goExecutable, ['env', 'GOMOD'], { cwd: folderPath, env }, (err, stdout) => {
      if (err) {
        console.warn(`Error when running go env GOMOD: ${err}`);
        return resolve('');
      }
      const [goMod] = stdout.split('\n');
      resolve(goMod);
    });
  });
}

export function isModSupported(fileuri: qv.Uri, isDir?: boolean): Promise<boolean> {
  return getModFolderPath(fileuri, isDir).then((modPath) => !!modPath);
}

export const packagePathToGoModPathMap: { [key: string]: string } = {};

export async function getModFolderPath(fileuri: qv.Uri, isDir?: boolean): Promise<string> {
  const pkgPath = isDir ? fileuri.fsPath : path.dirname(fileuri.fsPath);
  if (packagePathToGoModPathMap[pkgPath]) {
    return packagePathToGoModPathMap[pkgPath];
  }

  // We never would be using the path under module cache for anything
  // So, dont bother finding where exactly is the go.mod file
  const moduleCache = getModuleCache();
  if (fixDriveCasingInWindows(fileuri.fsPath).startsWith(moduleCache)) {
    return moduleCache;
  }
  const goVersion = await getGoVersion();
  if (!goVersion || goVersion.lt('1.11')) {
    return;
  }

  let goModEnvResult = await runGoModEnv(pkgPath);
  if (goModEnvResult) {
    goModEnvResult = path.dirname(goModEnvResult);
    const goConfig = getGoConfig(fileuri);

    if (goConfig['inferGopath'] === true && !fileuri.path.includes('/vendor/')) {
      goConfig.update('inferGopath', false, qv.ConfigurationTarget.WorkspaceFolder);
      qv.window.showInformationMessage('The "inferGopath" setting is disabled for this workspace because Go modules are being used.');
    }

    if (goConfig['useLanguageServer'] === false && getFormatTool(goConfig) === 'goreturns') {
      const promptFormatToolMsg = 'The goreturns tool does not support Go modules. Please update the "formatTool" setting to "goimports".';
      promptToUpdateToolForModules('switchFormatToolToGoimports', promptFormatToolMsg, goConfig);
    }
  }
  packagePathToGoModPathMap[pkgPath] = goModEnvResult;
  return goModEnvResult;
}

const promptedToolsForCurrentSession = new Set<string>();
export async function promptToUpdateToolForModules(tool: string, promptMsg: string, goConfig?: qv.WorkspaceConfiguration): Promise<boolean> {
  if (promptedToolsForCurrentSession.has(tool)) {
    return false;
  }
  const promptedToolsForModules = getFromGlobalState('promptedToolsForModules', {});
  if (promptedToolsForModules[tool]) {
    return false;
  }
  const goVersion = await getGoVersion();
  const selected = await qv.window.showInformationMessage(promptMsg, 'Update', 'Later', "Don't show again");
  let choseToUpdate = false;
  switch (selected) {
    case 'Update':
      choseToUpdate = true;
      if (!goConfig) {
        goConfig = getGoConfig();
      }
      await installTools([getTool(tool)], goVersion);
      switch (tool) {
        case 'switchFormatToolToGoimports':
          goConfig.update('formatTool', 'goimports', qv.ConfigurationTarget.Global);
          break;
        case 'gopls':
          if (goConfig.get('useLanguageServer') === false) {
            goConfig.update('useLanguageServer', true, qv.ConfigurationTarget.Global);
          }
          if (goConfig.inspect('useLanguageServer').workspaceFolderValue === false) {
            goConfig.update('useLanguageServer', true, qv.ConfigurationTarget.WorkspaceFolder);
          }
          break;
      }
      promptedToolsForModules[tool] = true;
      updateGlobalState('promptedToolsForModules', promptedToolsForModules);
      break;
    case "Don't show again":
      promptedToolsForModules[tool] = true;
      updateGlobalState('promptedToolsForModules', promptedToolsForModules);
      break;
    case 'Later':
    default:
      promptedToolsForCurrentSession.add(tool);
      break;
  }
  return choseToUpdate;
}

const folderToPackageMapping: { [key: string]: string } = {};
export async function getCurrentPackage(cwd: string): Promise<string> {
  if (folderToPackageMapping[cwd]) {
    return folderToPackageMapping[cwd];
  }

  const moduleCache = getModuleCache();
  if (cwd.startsWith(moduleCache)) {
    let importPath = cwd.substr(moduleCache.length + 1);
    const matches = /@v\d+(\.\d+)?(\.\d+)?/.exec(importPath);
    if (matches) {
      importPath = importPath.substr(0, matches.index);
    }

    folderToPackageMapping[cwd] = importPath;
    return importPath;
  }

  const goRuntimePath = getBinPath('go');
  if (!goRuntimePath) {
    console.warn(`Failed to run "go list" to find current package as the "go" binary cannot be found in either GOROOT(${getCurrentGoRoot()}) or PATH(${envPath})`);
    return;
  }
  return new Promise<string>((resolve) => {
    const childProcess = cp.spawn(goRuntimePath, ['list'], { cwd, env: toolExecutionEnvironment() });
    const chunks: any[] = [];
    childProcess.stdout.on('data', (stdout) => {
      chunks.push(stdout);
    });

    childProcess.on('close', () => {
      // Ignore lines that are empty or those that have logs about updating the module cache
      const pkgs = chunks
        .join('')
        .toString()
        .split('\n')
        .filter((line) => line && line.indexOf(' ') === -1);
      if (pkgs.length !== 1) {
        resolve('');
        return;
      }
      folderToPackageMapping[cwd] = pkgs[0];
      resolve(pkgs[0]);
    });
  });
}
