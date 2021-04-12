import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from '../../../old/go/config';
import { toolExecutionEnvironment } from '../../../old/go/goEnv';
import { promptForMissingTool, promptForUpdatingTool, shouldUpdateTool } from '../../../old/go/goInstallTools';
import { packagePathToGoModPathMap } from '../../../old/go/goModules';
import { getToolAtVersion } from '../../../old/go/goTools';
import { pickProc, pickProcByName } from '../../../../old/go/pickProc';
import { getFromGlobalState, updateGlobalState } from '../../../old/go/stateUtils';
import { getBinPath, resolvePath } from '../../../old/go/util';
import { parseEnvFiles } from './utils/envUtils';
let dlvDAPVersionCurrent = false;
export class GoDebugConfigProvider implements qv.DebugConfigProvider {
  constructor(private defaultDebugAdapterType: string = 'go') {}
  public async provideDebugConfigs(folder: qv.WorkspaceFolder | undefined, token?: qv.CancellationToken): Promise<qv.DebugConfig[] | undefined> {
    return await this.pickConfig();
  }
  public async pickConfig(): Promise<qv.DebugConfig[]> {
    const debugConfigs = [
      {
        label: 'Go: Launch package',
        description: 'Debug the package in the program attribute',
        config: {
          name: 'Launch Package',
          type: this.defaultDebugAdapterType,
          request: 'launch',
          mode: 'debug',
          program: '${workspaceFolder}',
        },
      },
      {
        label: 'Go: Launch file',
        description: 'Debug the file in the program attribute',
        config: {
          name: 'Launch file',
          type: 'go',
          request: 'launch',
          mode: 'debug',
          program: '${file}',
        },
      },
      {
        label: 'Go: Launch test package',
        description: 'Debug the test package in the program attribute',
        config: {
          name: 'Launch test package',
          type: 'go',
          request: 'launch',
          mode: 'test',
          program: '${workspaceFolder}',
        },
      },
      {
        label: 'Go: Launch test function',
        description: 'Debug the test function in the args, ensure program attributes points to right package',
        config: {
          name: 'Launch test function',
          type: 'go',
          request: 'launch',
          mode: 'test',
          program: '${workspaceFolder}',
          args: ['-test.run', 'MyTestFunction'],
        },
        fill: async (config: qv.DebugConfig) => {
          const testFunc = await qv.window.showInputBox({
            placeHolder: 'MyTestFunction',
            prompt: 'Name of the function to test',
          });
          if (testFunc) {
            config.args = ['-test.run', testFunc];
          }
        },
      },
      {
        label: 'Go: Attach to local process',
        description: 'Attach to an existing process by process ID',
        config: {
          name: 'Attach to Proc',
          type: 'go',
          request: 'attach',
          mode: 'local',
          processId: 0,
        },
      },
      {
        label: 'Go: Connect to server',
        description: 'Connect to a remote headless debug server',
        config: {
          name: 'Connect to server',
          type: 'go',
          request: 'attach',
          mode: 'remote',
          remotePath: '${workspaceFolder}',
          port: 2345,
          host: '127.0.0.1',
        },
        fill: async (config: qv.DebugConfig) => {
          const host = await qv.window.showInputBox({
            prompt: 'Enter hostname',
            value: '127.0.0.1',
          });
          if (host) {
            config.host = host;
          }
          const port = Number(
            await qv.window.showInputBox({
              prompt: 'Enter port',
              value: '2345',
              validateInput: (value: string) => {
                if (isNaN(Number(value))) {
                  return 'Please enter a number.';
                }
                return '';
              },
            })
          );
          if (port) {
            config.port = port;
          }
        },
      },
    ];
    const choice = await qv.window.showQuickPick(debugConfigs, {
      placeHolder: 'Choose debug configuration',
    });
    if (!choice) {
      return [];
    }
    if (choice.fill) {
      await choice.fill(choice.config);
    }
    return [choice.config];
  }
  public async resolveDebugConfig(folder: qv.WorkspaceFolder | undefined, debugConfig: qv.DebugConfig, token?: qv.CancellationToken): Promise<qv.DebugConfig> {
    const activeEditor = qv.window.activeTextEditor;
    if (!debugConfig || !debugConfig.request) {
      if (!activeEditor || activeEditor.document.languageId !== 'go') {
        return;
      }
      debugConfig = Object.assign(debugConfig || {}, {
        name: 'Launch',
        type: this.defaultDebugAdapterType,
        request: 'launch',
        mode: 'auto',
        program: path.dirname(activeEditor.document.fileName), // matches ${fileDirname}
      });
    }
    if (!debugConfig.type) {
      debugConfig['type'] = this.defaultDebugAdapterType;
    }
    debugConfig['packagePathToGoModPathMap'] = packagePathToGoModPathMap;
    const goConfig = getGoConfig(folder && folder.uri);
    const dlvConfig = goConfig['delveConfig'];
    let useApiV1 = false;
    if (debugConfig.hasOwnProperty('useApiV1')) {
      useApiV1 = debugConfig['useApiV1'] === true;
    } else if (dlvConfig.hasOwnProperty('useApiV1')) {
      useApiV1 = dlvConfig['useApiV1'] === true;
    }
    if (useApiV1) {
      debugConfig['apiVersion'] = 1;
    }
    if (!debugConfig.hasOwnProperty('apiVersion') && dlvConfig.hasOwnProperty('apiVersion')) {
      debugConfig['apiVersion'] = dlvConfig['apiVersion'];
    }
    if (!debugConfig.hasOwnProperty('dlvLoadConfig') && dlvConfig.hasOwnProperty('dlvLoadConfig')) {
      debugConfig['dlvLoadConfig'] = dlvConfig['dlvLoadConfig'];
    }
    if (!debugConfig.hasOwnProperty('showGlobalVariables') && dlvConfig.hasOwnProperty('showGlobalVariables')) {
      debugConfig['showGlobalVariables'] = dlvConfig['showGlobalVariables'];
    }
    if (debugConfig.request === 'attach' && !debugConfig['cwd']) {
      debugConfig['cwd'] = '${workspaceFolder}';
    }
    if (debugConfig['cwd']) {
      debugConfig['cwd'] = resolvePath(debugConfig['cwd']);
    }
    if (debugConfig['buildFlags']) {
      const resp = this.removeGcflags(debugConfig['buildFlags']);
      if (resp.removed) {
        debugConfig['buildFlags'] = resp.args;
        this.showWarning(
          'ignoreDebugGCFlagsWarning',
          "User specified build flag '--gcflags' in 'buildFlags' is being ignored (see [debugging with build flags](https://github.com/golang/vscode-go/blob/master/docs/debugging.md#specifying-other-build-flags) documentation)"
        );
      }
    }
    if (debugConfig['env'] && debugConfig['env']['GOFLAGS']) {
      const resp = this.removeGcflags(debugConfig['env']['GOFLAGS']);
      if (resp.removed) {
        debugConfig['env']['GOFLAGS'] = resp.args;
        this.showWarning(
          'ignoreDebugGCFlagsWarning',
          "User specified build flag '--gcflags' in 'GOFLAGS' is being ignored (see [debugging with build flags](https://github.com/golang/vscode-go/blob/master/docs/debugging.md#specifying-other-build-flags) documentation)"
        );
      }
    }
    const debugAdapter = debugConfig['debugAdapter'] === 'dlv-dap' ? 'dlv-dap' : 'dlv';
    const dlvToolPath = getBinPath(debugAdapter);
    if (!path.isAbsolute(dlvToolPath)) {
      await promptForMissingTool(debugAdapter);
      return;
    }
    debugConfig['dlvToolPath'] = dlvToolPath;
    if (debugAdapter === 'dlv-dap' && !dlvDAPVersionCurrent) {
      const tool = getToolAtVersion('dlv-dap');
      if (await shouldUpdateTool(tool, dlvToolPath)) {
        promptForUpdatingTool('dlv-dap');
        return;
      }
      dlvDAPVersionCurrent = true;
    }
    if (debugConfig['mode'] === 'auto') {
      debugConfig['mode'] = activeEditor && activeEditor.document.fileName.endsWith('_test.go') ? 'test' : 'debug';
    }
    if (debugConfig.request === 'launch' && debugConfig['mode'] === 'remote') {
      this.showWarning('ignoreDebugLaunchRemoteWarning', "Request type of 'launch' with mode 'remote' is deprecated, please use request type 'attach' with mode 'remote' instead.");
    }
    if (debugConfig.request === 'attach' && debugConfig['mode'] === 'remote' && debugConfig['program']) {
      this.showWarning('ignoreUsingRemotePathAndProgramWarning', "Request type of 'attach' with mode 'remote' does not work with 'program' attribute, please use 'cwd' attribute instead.");
    }
    if (debugConfig.request === 'attach' && debugConfig['mode'] === 'local') {
      if (!debugConfig['processId'] || debugConfig['processId'] === 0) {
        debugConfig['processId'] = parseInt(await pickProc(), 10);
      } else if (typeof debugConfig['processId'] === 'string') {
        debugConfig['processId'] = parseInt(await pickProcByName(debugConfig['processId']), 10);
      }
    }
    return debugConfig;
  }
  public removeGcflags(args: string): { args: string; removed: boolean } {
    const gcflagsRegexp = /(^|\s)(-gcflags)(=| )('[^']*'|"[^"]*"|[^'"\s]+)+/;
    let removed = false;
    while (args.search(gcflagsRegexp) >= 0) {
      args = args.replace(gcflagsRegexp, '');
      removed = true;
    }
    return { args, removed };
  }
  public resolveDebugConfigWithSubstitutedVariables(folder: qv.WorkspaceFolder | undefined, debugConfig: qv.DebugConfig, token?: qv.CancellationToken): qv.DebugConfig {
    const goToolsEnvVars = toolExecutionEnvironment(folder?.uri); // also includes GOPATH: getCurrentGoPath().
    const fileEnvs = parseEnvFiles(debugConfig['envFile']);
    const env = debugConfig['env'] || {};
    debugConfig['env'] = Object.assign(goToolsEnvVars, fileEnvs, env);
    debugConfig['envFile'] = undefined; // unset, since we already processed.
    return debugConfig;
  }
  private showWarning(ignoreWarningKey: string, warningMessage: string) {
    const ignoreWarning = getFromGlobalState(ignoreWarningKey);
    if (ignoreWarning) {
      return;
    }
    const neverAgain = { title: "Don't Show Again" };
    qv.window.showWarningMessage(warningMessage, neverAgain).then((result) => {
      if (result === neverAgain) {
        updateGlobalState(ignoreWarningKey, true);
      }
    });
  }
}
