import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from '../../../../old/go/config';
import { toolExecutionEnvironment } from '../../../../old/go/goEnv';
import { promptForMissingTool, promptForUpdatingTool, shouldUpdateTool } from '../../../../old/go/goInstallTools';
import { packagePathToGoModPathMap } from '../../../../old/go/goModules';
import { getToolAtVersion } from '../../../../old/go/goTools';
import { pickProcess, pickProcessByName } from '../../../../old/go/pickProcess';
import { getFromGlobalState, updateGlobalState } from '../../../../old/go/stateUtils';
import { getBinPath, resolvePath } from '../../../../old/go/util';
import { parseEnvFiles } from './utils/envUtils';

let dlvDAPVersionCurrent = false;

export class GoDebugConfigurationProvider implements qv.DebugConfigurationProvider {
  constructor(private defaultDebugAdapterType: string = 'go') {}

  public async provideDebugConfigurations(folder: qv.WorkspaceFolder | undefined, token?: qv.CancellationToken): Promise<qv.DebugConfiguration[] | undefined> {
    return await this.pickConfiguration();
  }

  public async pickConfiguration(): Promise<qv.DebugConfiguration[]> {
    const debugConfigurations = [
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
        fill: async (config: qv.DebugConfiguration) => {
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
          name: 'Attach to Process',
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
        fill: async (config: qv.DebugConfiguration) => {
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

    const choice = await qv.window.showQuickPick(debugConfigurations, {
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

  public async resolveDebugConfiguration(folder: qv.WorkspaceFolder | undefined, debugConfiguration: qv.DebugConfiguration, token?: qv.CancellationToken): Promise<qv.DebugConfiguration> {
    const activeEditor = qv.window.activeTextEditor;
    if (!debugConfiguration || !debugConfiguration.request) {
      if (!activeEditor || activeEditor.document.languageId !== 'go') {
        return;
      }

      debugConfiguration = Object.assign(debugConfiguration || {}, {
        name: 'Launch',
        type: this.defaultDebugAdapterType,
        request: 'launch',
        mode: 'auto',
        program: path.dirname(activeEditor.document.fileName), // matches ${fileDirname}
      });
    }

    if (!debugConfiguration.type) {
      debugConfiguration['type'] = this.defaultDebugAdapterType;
    }

    debugConfiguration['packagePathToGoModPathMap'] = packagePathToGoModPathMap;

    const goConfig = getGoConfig(folder && folder.uri);
    const dlvConfig = goConfig['delveConfig'];
    let useApiV1 = false;
    if (debugConfiguration.hasOwnProperty('useApiV1')) {
      useApiV1 = debugConfiguration['useApiV1'] === true;
    } else if (dlvConfig.hasOwnProperty('useApiV1')) {
      useApiV1 = dlvConfig['useApiV1'] === true;
    }
    if (useApiV1) {
      debugConfiguration['apiVersion'] = 1;
    }
    if (!debugConfiguration.hasOwnProperty('apiVersion') && dlvConfig.hasOwnProperty('apiVersion')) {
      debugConfiguration['apiVersion'] = dlvConfig['apiVersion'];
    }
    if (!debugConfiguration.hasOwnProperty('dlvLoadConfig') && dlvConfig.hasOwnProperty('dlvLoadConfig')) {
      debugConfiguration['dlvLoadConfig'] = dlvConfig['dlvLoadConfig'];
    }
    if (!debugConfiguration.hasOwnProperty('showGlobalVariables') && dlvConfig.hasOwnProperty('showGlobalVariables')) {
      debugConfiguration['showGlobalVariables'] = dlvConfig['showGlobalVariables'];
    }
    if (debugConfiguration.request === 'attach' && !debugConfiguration['cwd']) {
      debugConfiguration['cwd'] = '${workspaceFolder}';
    }
    if (debugConfiguration['cwd']) {
      debugConfiguration['cwd'] = resolvePath(debugConfiguration['cwd']);
    }

    if (debugConfiguration['buildFlags']) {
      const resp = this.removeGcflags(debugConfiguration['buildFlags']);
      if (resp.removed) {
        debugConfiguration['buildFlags'] = resp.args;
        this.showWarning(
          'ignoreDebugGCFlagsWarning',
          "User specified build flag '--gcflags' in 'buildFlags' is being ignored (see [debugging with build flags](https://github.com/golang/vscode-go/blob/master/docs/debugging.md#specifying-other-build-flags) documentation)"
        );
      }
    }
    if (debugConfiguration['env'] && debugConfiguration['env']['GOFLAGS']) {
      const resp = this.removeGcflags(debugConfiguration['env']['GOFLAGS']);
      if (resp.removed) {
        debugConfiguration['env']['GOFLAGS'] = resp.args;
        this.showWarning(
          'ignoreDebugGCFlagsWarning',
          "User specified build flag '--gcflags' in 'GOFLAGS' is being ignored (see [debugging with build flags](https://github.com/golang/vscode-go/blob/master/docs/debugging.md#specifying-other-build-flags) documentation)"
        );
      }
    }

    const debugAdapter = debugConfiguration['debugAdapter'] === 'dlv-dap' ? 'dlv-dap' : 'dlv';
    const dlvToolPath = getBinPath(debugAdapter);
    if (!path.isAbsolute(dlvToolPath)) {
      await promptForMissingTool(debugAdapter);
      return;
    }
    debugConfiguration['dlvToolPath'] = dlvToolPath;

    if (debugAdapter === 'dlv-dap' && !dlvDAPVersionCurrent) {
      const tool = getToolAtVersion('dlv-dap');
      if (await shouldUpdateTool(tool, dlvToolPath)) {
        promptForUpdatingTool('dlv-dap');
        return;
      }
      dlvDAPVersionCurrent = true;
    }

    if (debugConfiguration['mode'] === 'auto') {
      debugConfiguration['mode'] = activeEditor && activeEditor.document.fileName.endsWith('_test.go') ? 'test' : 'debug';
    }

    if (debugConfiguration.request === 'launch' && debugConfiguration['mode'] === 'remote') {
      this.showWarning('ignoreDebugLaunchRemoteWarning', "Request type of 'launch' with mode 'remote' is deprecated, please use request type 'attach' with mode 'remote' instead.");
    }

    if (debugConfiguration.request === 'attach' && debugConfiguration['mode'] === 'remote' && debugConfiguration['program']) {
      this.showWarning('ignoreUsingRemotePathAndProgramWarning', "Request type of 'attach' with mode 'remote' does not work with 'program' attribute, please use 'cwd' attribute instead.");
    }

    if (debugConfiguration.request === 'attach' && debugConfiguration['mode'] === 'local') {
      if (!debugConfiguration['processId'] || debugConfiguration['processId'] === 0) {
        debugConfiguration['processId'] = parseInt(await pickProcess(), 10);
      } else if (typeof debugConfiguration['processId'] === 'string') {
        debugConfiguration['processId'] = parseInt(await pickProcessByName(debugConfiguration['processId']), 10);
      }
    }
    return debugConfiguration;
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

  public resolveDebugConfigurationWithSubstitutedVariables(folder: qv.WorkspaceFolder | undefined, debugConfiguration: qv.DebugConfiguration, token?: qv.CancellationToken): qv.DebugConfiguration {
    const goToolsEnvVars = toolExecutionEnvironment(folder?.uri); // also includes GOPATH: getCurrentGoPath().
    const fileEnvs = parseEnvFiles(debugConfiguration['envFile']);
    const env = debugConfiguration['env'] || {};

    debugConfiguration['env'] = Object.assign(goToolsEnvVars, fileEnvs, env);
    debugConfiguration['envFile'] = undefined; // unset, since we already processed.

    return debugConfiguration;
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
