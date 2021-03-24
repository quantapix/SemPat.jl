import { SeverityLevel } from 'applicationinsights/out/Declarations/Contracts';
import * as fs from 'async-file';
import { unwatchFile, watchFile } from 'async-file';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, RevealOutputChannelOn } from 'vscode-languageclient/node';
import { JuliaDebugFeature } from './debugger/debugFeature';
import * as documentation from './docbrowser/documentation';
import { ProfilerResultsProvider } from './interactive/profiler';
import * as repl from './interactive/repl';
import * as jlpkgenv from './jlpkgenv';
import * as packs from './packs';
import * as utils from './utils';
import * as tasks from './tasks';
import * as telemetry from './telemetry';
import { registerCommand } from './utils';
import * as weave from './weave';

let g_languageClient: LanguageClient = null;
let g_context: vscode.ExtensionContext = null;
let g_watchedEnvironmentFile: string = null;
let g_startupNotification: vscode.StatusBarItem = null;

export async function activate(ctx: vscode.ExtensionContext) {
  if (vscode.extensions.getExtension('julialang.language-julia') && vscode.extensions.getExtension('julialang.language-julia-insider')) {
    vscode.window.showErrorMessage(
      'You have both the Julia Insider and regular Julia extension installed at the same time, which is not supported. Please uninstall or disable one of the two extensions.'
    );
    return;
  }
  await telemetry.init(ctx);
  try {
    telemetry.traceEvent('activate');
    telemetry.startLsCrashServer();
    g_context = ctx;
    console.log('Activating extension language-julia');
    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(changeConfig));
    vscode.languages.setLanguageConfiguration('julia', {
      indentationRules: {
        increaseIndentPattern: /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*(?:["'`][^"'`]*["'`])*[\w\s]*\b(if|while|for|function|macro|(mutable\s+)?struct|abstract\s+type|primitive\s+type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!(?:.*\bend\b[^\]]*)|(?:[^\[]*\].*)$).*$/,
        decreaseIndentPattern: /^\s*(end|else|elseif|catch|finally)\b.*$/,
      },
    });
    await packs.getJuliaExePath();
    repl.activate(ctx);
    weave.activate(ctx);
    documentation.activate(ctx);
    tasks.activate(ctx);
    utils.activate(ctx);
    packs.activate(ctx);
    jlpkgenv.activate(ctx);
    ctx.subscriptions.push(new JuliaDebugFeature(ctx));
    ctx.subscriptions.push(new packs.JuliaPackageDevFeature(ctx));
    g_startupNotification = vscode.window.createStatusBarItem();
    ctx.subscriptions.push(g_startupNotification);
    startLanguageServer();
    if (vscode.workspace.getConfiguration('julia').get<boolean>('enableTelemetry') === null) {
      const agree = 'Yes';
      const disagree = 'No';
      vscode.window
        .showInformationMessage(
          'To help improve the Julia extension, you can allow the development team to collect usage data. Read our [privacy statement](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more about how we use usage data. Do you agree to usage data collection?',
          agree,
          disagree
        )
        .then((choice) => {
          if (choice === agree) {
            vscode.workspace.getConfiguration('julia').update('enableTelemetry', true, true);
          } else if (choice === disagree) {
            vscode.workspace.getConfiguration('julia').update('enableTelemetry', false, true);
          }
        });
    }
    ctx.subscriptions.push(
      registerCommand('language-julia.refreshLanguageServer', refreshLanguageServer),
      registerCommand('language-julia.restartLanguageServer', restartLanguageServer),
      vscode.workspace.registerTextDocumentContentProvider('juliavsodeprofilerresults', new ProfilerResultsProvider())
    );
    const api = {
      version: 2,
      async getEnvironment() {
        return await jlpkgenv.getAbsEnvPath();
      },
      async getJuliaPath() {
        return await packs.getJuliaExePath();
      },
      getPkgServer() {
        return vscode.workspace.getConfiguration('julia').get('packageServer');
      },
    };
    return api;
  } catch (err) {
    telemetry.handleNewCrashReportFromException(err, 'Extension');
    throw err;
  }
}

export function deactivate() {}

const g_onSetLanguageClient = new vscode.EventEmitter<LanguageClient>();
export const onSetLanguageClient = g_onSetLanguageClient.event;
function setLanguageClient(c?: LanguageClient) {
  g_onSetLanguageClient.fire(c);
  g_languageClient = c;
}

export async function withLanguageClient(callback: (c: LanguageClient) => any, callbackOnHandledErr: (err: Error) => any) {
  if (g_languageClient === null) {
    return callbackOnHandledErr(new Error('Language client is not active'));
  }
  await g_languageClient.onReady();
  try {
    return callback(g_languageClient);
  } catch (err) {
    if (err.message === 'Language client is not ready yet') {
      return callbackOnHandledErr(err);
    }
    throw err;
  }
}

const g_onDidChangeConfig = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
export const onDidChangeConfig = g_onDidChangeConfig.event;
function changeConfig(event: vscode.ConfigurationChangeEvent) {
  g_onDidChangeConfig.fire(event);
  if (event.affectsConfiguration('julia.executablePath')) {
    restartLanguageServer();
  }
}

async function startLanguageServer() {
  g_startupNotification.text = 'Starting Julia Language Server…';
  g_startupNotification.show();

  let jlEnvPath = '';
  try {
    jlEnvPath = await jlpkgenv.getAbsEnvPath();
  } catch (e) {
    vscode.window.showErrorMessage('Could not start the Julia language server. Make sure the configuration setting julia.executablePath points to the Julia binary.');
    vscode.window.showErrorMessage(e);
    g_startupNotification.hide();
    return;
  }

  const languageServerDepotPath = path.join(g_context.globalStoragePath, 'lsdepot', 'v1');
  await fs.createDirectory(languageServerDepotPath);
  const oldDepotPath = process.env.JULIA_DEPOT_PATH ? process.env.JULIA_DEPOT_PATH : '';
  const envForLSPath = path.join(g_context.extensionPath, 'scripts', 'environments', 'languageserver');
  const serverArgsRun = [
    '--startup-file=no',
    '--history-file=no',
    '--depwarn=no',
    `--project=${envForLSPath}`,
    'main.jl',
    jlEnvPath,
    '--debug=no',
    telemetry.getCrashReportingPipename(),
    oldDepotPath,
    g_context.globalStoragePath,
  ];
  const serverArgsDebug = [
    '--startup-file=no',
    '--history-file=no',
    '--depwarn=no',
    `--project=${envForLSPath}`,
    'main.jl',
    jlEnvPath,
    '--debug=yes',
    telemetry.getCrashReportingPipename(),
    oldDepotPath,
    g_context.globalStoragePath,
  ];
  const spawnOptions = {
    cwd: path.join(g_context.extensionPath, 'scripts', 'languageserver'),
    env: {
      JULIA_DEPOT_PATH: languageServerDepotPath,
      JULIA_LOAD_PATH: process.platform === 'win32' ? ';' : ':',
      HOME: process.env.HOME ? process.env.HOME : os.homedir(),
      JULIA_LANGUAGESERVER: '1',
    },
  };

  const jlexepath = await packs.getJuliaExePath();

  const serverOptions = {
    run: { command: jlexepath, args: serverArgsRun, options: spawnOptions },
    debug: { command: jlexepath, args: serverArgsDebug, options: spawnOptions },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: ['julia', 'juliamarkdown'],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{jl,jmd}'),
    },
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    traceOutputChannel: vscode.window.createOutputChannel('Julia Language Server trace'),
    middleware: {
      provideCompletionItem: async (document, position, context, token, next) => {
        const validatedPosition = document.validatePosition(position);
        if (validatedPosition !== position) {
          telemetry.traceTrace({
            message: `Middleware found a change in position in provideCompletionItem. Original ${position.line}:${position.character}, validated ${validatedPosition.line}:${validatedPosition.character}`,
            severity: SeverityLevel.Error,
          });
        }
        return await next(document, position, context, token);
      },
      provideDefinition: async (document, position, token, next) => {
        const validatedPosition = document.validatePosition(position);
        if (validatedPosition !== position) {
          telemetry.traceTrace({
            message: `Middleware found a change in position in provideDefinition. Original ${position.line}:${position.character}, validated ${validatedPosition.line}:${validatedPosition.character}`,
            severity: SeverityLevel.Error,
          });
        }
        return await next(document, position, token);
      },
    },
  };
  const languageClient = new LanguageClient('julia', 'Julia Language Server', serverOptions, clientOptions);
  languageClient.registerProposedFeatures();
  languageClient.onTelemetry((data: any) => {
    if (data.command === 'trace_event') {
      telemetry.traceEvent(data.message);
    } else if (data.command === 'symserv_crash') {
      telemetry.traceEvent('symservererror');
      telemetry.handleNewCrashReport(data.name, data.message, data.stacktrace, 'Symbol Server');
    } else if (data.command === 'symserv_pkgload_crash') {
      telemetry.tracePackageLoadError(data.name, data.message);
    }
  });
  if (g_watchedEnvironmentFile) {
    unwatchFile(g_watchedEnvironmentFile);
  }
  g_watchedEnvironmentFile = (await jlpkgenv.getProjectFilePaths(jlEnvPath)).manifest_toml_path;
  if (g_watchedEnvironmentFile) {
    watchFile(g_watchedEnvironmentFile, { interval: 10000 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        if (!languageClient.needsStop()) {
          return;
        }
        refreshLanguageServer(languageClient);
      }
    });
  }
  const disposable = registerCommand('language-julia.showLanguageServerOutput', () => {
    languageClient.outputChannel.show(true);
  });
  try {
    g_context.subscriptions.push(languageClient.start());
    g_startupNotification.command = 'language-julia.showLanguageServerOutput';
    setLanguageClient(languageClient);
    languageClient.onReady().finally(() => {
      disposable.dispose();
      g_startupNotification.hide();
    });
  } catch (e) {
    vscode.window.showErrorMessage('Could not start the Julia language server. Make sure the configuration setting julia.executablePath points to the Julia binary.');
    setLanguageClient();
    disposable.dispose();
    g_startupNotification.hide();
  }
}

function refreshLanguageServer(c: LanguageClient = g_languageClient) {
  if (!c) return;
  c.sendNotification('julia/refreshLanguageServer');
}

function restartLanguageServer(c: LanguageClient = g_languageClient) {
  if (c !== null) {
    c.stop();
    setLanguageClient();
  }
  startLanguageServer();
}
