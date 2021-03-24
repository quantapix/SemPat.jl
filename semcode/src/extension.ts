import { JuliaDebugFeature } from './debug';
import { LanguageClient, LanguageClientOptions, RevealOutputChannelOn } from 'vscode-languageclient/node';
import { ProfilerResultsProvider } from './profiler';
import { registerCommand } from './utils';
import { SeverityLevel } from 'applicationinsights/out/Declarations/Contracts';
import { unwatchFile, watchFile } from 'async-file';
import * as documentation from './docs';
import * as fs from 'async-file';
import * as os from 'os';
import * as packs from './packs';
import * as path from 'path';
import * as repl from './repl';
import * as tasks from './tasks';
import * as utils from './utils';
import * as vscode from 'vscode';
import * as weave from './weave';

let g_languageClient: LanguageClient = null;
let g_context: vscode.ExtensionContext = null;
let g_watchedEnvironmentFile: string = null;
let g_startupNotification: vscode.StatusBarItem = null;

export async function activate(ctx: vscode.ExtensionContext) {
  //console.log('Congratulations, your extension "semcode2" is now active!');
  //let disposable = vscode.commands.registerCommand('semcode2.helloWorld', () => {
  //  vscode.window.showInformationMessage('Hello World from SemCode2!');
  //});
  //ctx.subscriptions.push(disposable);

  if (vscode.extensions.getExtension('julialang.language-julia') && vscode.extensions.getExtension('julialang.language-julia-insider')) {
    vscode.window.showErrorMessage(
      'You have both the Julia Insider and regular Julia extension installed at the same time, which is not supported. Please uninstall or disable one of the two extensions.'
    );
    return;
  }

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
  ctx.subscriptions.push(new JuliaDebugFeature(ctx));
  ctx.subscriptions.push(new packs.JuliaPackageDevFeature(ctx));
  g_startupNotification = vscode.window.createStatusBarItem();
  ctx.subscriptions.push(g_startupNotification);
  startLanguageServer();
  ctx.subscriptions.push(
    registerCommand('language-julia.refreshLanguageServer', refreshLanguageServer),
    registerCommand('language-julia.restartLanguageServer', restartLanguageServer),
    vscode.workspace.registerTextDocumentContentProvider('juliavsodeprofilerresults', new ProfilerResultsProvider())
  );
  const api = {
    version: 2,
    async getEnvironment() {
      return await packs.getAbsEnvPath();
    },
    async getJuliaPath() {
      return await packs.getJuliaExePath();
    },
    getPkgServer() {
      return vscode.workspace.getConfiguration('julia').get('packageServer');
    },
  };
  return api;
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
    jlEnvPath = await packs.getAbsEnvPath();
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
  const serverArgsRun = ['--startup-file=no', '--history-file=no', '--depwarn=no', `--project=${envForLSPath}`, 'main.jl', jlEnvPath, '--debug=no', 'pipe', oldDepotPath, g_context.globalStoragePath];
  const serverArgsDebug = [
    '--startup-file=no',
    '--history-file=no',
    '--depwarn=no',
    `--project=${envForLSPath}`,
    'main.jl',
    jlEnvPath,
    '--debug=yes',
    'pipe',
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
        assert(validatedPosition == position);
        return await next(document, position, context, token);
      },
      provideDefinition: async (document, position, token, next) => {
        const validatedPosition = document.validatePosition(position);
        assert(validatedPosition == position);
        return await next(document, position, token);
      },
    },
  };
  const languageClient = new LanguageClient('julia', 'Julia Language Server', serverOptions, clientOptions);
  languageClient.registerProposedFeatures();
  if (g_watchedEnvironmentFile) {
    unwatchFile(g_watchedEnvironmentFile);
  }
  g_watchedEnvironmentFile = (await packs.getProjectFilePaths(jlEnvPath)).manifest_toml_path;
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
