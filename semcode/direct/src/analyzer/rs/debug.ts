import * as os from 'os';
import * as qv from 'vscode';
import * as path from 'path';
import * as ra from './lsp_ext';

import { Cargo } from './toolchain';
import { Ctx } from './ctx';
import { prepareEnv } from './run';

const debugOutput = qv.window.createOutputChannel('Debug');
type DebugConfigProvider = (config: ra.Runnable, executable: string, env: Record<string, string>, sourceFileMap?: Record<string, string>) => qv.DebugConfiguration;

export async function makeDebugConfig(ctx: Ctx, runnable: ra.Runnable): Promise<void> {
  const scope = ctx.activeRustEditor?.document.uri;
  if (!scope) return;

  const debugConfig = await getDebugConfiguration(ctx, runnable);
  if (!debugConfig) return;

  const wsLaunchSection = qv.workspace.getConfiguration('launch', scope);
  const configurations = wsLaunchSection.get<any[]>('configurations') || [];

  const index = configurations.findIndex((c) => c.name === debugConfig.name);
  if (index !== -1) {
    const answer = await qv.window.showErrorMessage(`Launch configuration '${debugConfig.name}' already exists!`, 'Cancel', 'Update');
    if (answer === 'Cancel') return;

    configurations[index] = debugConfig;
  } else {
    configurations.push(debugConfig);
  }

  await wsLaunchSection.update('configurations', configurations);
}

export async function startDebugSession(ctx: Ctx, runnable: ra.Runnable): Promise<boolean> {
  let debugConfig: qv.DebugConfiguration | undefined = undefined;
  let message = '';

  const wsLaunchSection = qv.workspace.getConfiguration('launch');
  const configurations = wsLaunchSection.get<any[]>('configurations') || [];

  const index = configurations.findIndex((c) => c.name === runnable.label);
  if (-1 !== index) {
    debugConfig = configurations[index];
    message = ' (from launch.json)';
    debugOutput.clear();
  } else {
    debugConfig = await getDebugConfiguration(ctx, runnable);
  }

  if (!debugConfig) return false;

  debugOutput.appendLine(`Launching debug configuration${message}:`);
  debugOutput.appendLine(JSON.stringify(debugConfig, null, 2));
  return qv.debug.startDebugging(undefined, debugConfig);
}

async function getDebugConfiguration(ctx: Ctx, runnable: ra.Runnable): Promise<qv.DebugConfiguration | undefined> {
  const editor = ctx.activeRustEditor;
  if (!editor) return;

  const knownEngines: Record<string, DebugConfigProvider> = {
    'vadimcn.vscode-lldb': getLldbDebugConfig,
    'ms-qv.cpptools': getCppvsDebugConfig,
  };
  const debugOptions = ctx.config.debug;

  let debugEngine = null;
  if (debugOptions.engine === 'auto') {
    for (var engineId in knownEngines) {
      debugEngine = qv.extensions.getExtension(engineId);
      if (debugEngine) break;
    }
  } else {
    debugEngine = qv.extensions.getExtension(debugOptions.engine);
  }

  if (!debugEngine) {
    qv.window.showErrorMessage(
      `Install [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)` +
        ` or [MS C++ tools](https://marketplace.visualstudio.com/items?itemName=ms-qv.cpptools) extension for debugging.`
    );
    return;
  }

  debugOutput.clear();
  if (ctx.config.debug.openDebugPane) {
    debugOutput.show(true);
  }

  const wsFolder = path.normalize(qv.workspace.workspaceFolders![0].uri.fsPath); // folder exists or RA is not active.
  function simplifyPath(p: string): string {
    return path.normalize(p).replace(wsFolder, '${workspaceRoot}');
  }

  const executable = await getDebugExecutable(runnable);
  const env = prepareEnv(runnable, ctx.config.runnableEnv);
  const debugConfig = knownEngines[debugEngine.id](runnable, simplifyPath(executable), env, debugOptions.sourceFileMap);
  if (debugConfig.type in debugOptions.engineSettings) {
    const settingsMap = (debugOptions.engineSettings as any)[debugConfig.type];
    for (var key in settingsMap) {
      debugConfig[key] = settingsMap[key];
    }
  }

  if (debugConfig.name === 'run binary') {
    debugConfig.name = `run ${path.basename(executable)}`;
  }

  if (debugConfig.cwd) {
    debugConfig.cwd = simplifyPath(debugConfig.cwd);
  }

  return debugConfig;
}

async function getDebugExecutable(runnable: ra.Runnable): Promise<string> {
  const cargo = new Cargo(runnable.args.workspaceRoot || '.', debugOutput);
  const executable = await cargo.executableFromArgs(runnable.args.cargoArgs);

  return executable;
}

function getLldbDebugConfig(runnable: ra.Runnable, executable: string, env: Record<string, string>, sourceFileMap?: Record<string, string>): qv.DebugConfiguration {
  return {
    type: 'lldb',
    request: 'launch',
    name: runnable.label,
    program: executable,
    args: runnable.args.executableArgs,
    cwd: runnable.args.workspaceRoot,
    sourceMap: sourceFileMap,
    sourceLanguages: ['rust'],
    env,
  };
}

function getCppvsDebugConfig(runnable: ra.Runnable, executable: string, env: Record<string, string>, sourceFileMap?: Record<string, string>): qv.DebugConfiguration {
  return {
    type: os.platform() === 'win32' ? 'cppvsdbg' : 'cppdbg',
    request: 'launch',
    name: runnable.label,
    program: executable,
    args: runnable.args.executableArgs,
    cwd: runnable.args.workspaceRoot,
    sourceFileMap,
    env,
  };
}
