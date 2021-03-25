import { JuliaDebugFeature } from './debug';
import { LanguageClient, LanguageClientOptions, RevealOutputChannelOn, State } from 'vscode-languageclient/node';
import { unwatchFile, watchFile } from 'async-file';
import * as documentation from './docs';
import * as fs from 'async-file';
import * as os from 'os';
import * as packs from './packs';
import * as path from 'path';
import * as repl from './repl';
import * as tasks from './tasks';
import * as qu from './utils';
import * as vsc from 'vscode';

import { RLSConfiguration } from './configuration';
import * as rls from './rls';
import * as rustAnalyzer from './rustAnalyzer';
import { rustupUpdate } from './rustup';
import { activateTaskProvider, Execution, runRlsCommand } from './tasks';

export interface Api {
  activeWorkspace: typeof activeWorkspace;
}

export async function activate(c: vsc.ExtensionContext): Promise<Api> {
  c.subscriptions.push(
    ...[configureLanguage(), ...registerCommands(), vsc.workspace.onDidChangeWorkspaceFolders(whenChangingWorkspaceFolders), vsc.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor)]
  );
  onDidChangeActiveTextEditor(vsc.window.activeTextEditor);
  const config = vsc.workspace.getConfiguration();
  if (typeof config.get<boolean | null>('rust-client.enableMultiProjectSetup', null) === 'boolean') {
    vsc.window
      .showWarningMessage('The multi-project setup for RLS is always enabled, so the `rust-client.enableMultiProjectSetup` setting is now redundant', { modal: false }, { title: 'Remove' })
      .then((x) => {
        if (x && x.title === 'Remove') return config.update('rust-client.enableMultiProjectSetup', null, vsc.ConfigurationTarget.Global);
        return;
      });
  }
  return { activeWorkspace };
}

export async function deactivate() {
  return Promise.all([...workspaces.values()].map((ws) => ws.stop()));
}

let progressObserver: vsc.Disposable | undefined;

function onDidChangeActiveTextEditor(e?: vsc.TextEditor) {
  if (!e || !e.document) return;
  const { languageId, uri } = e.document;
  const w = clientWorkspaceForUri(uri, { initializeIfMissing: languageId === 'rust' || languageId === 'toml' });
  if (!w) return;
  activeWorkspace.value = w;
  const updateProgress = (p: WorkspaceProgress) => {
    if (p.state === 'progress') qu.startSpinner(`[${w.folder.name}] ${p.message}`);
    else {
      const ready = p.state === 'standby' ? '$(debug-stop)' : '$(debug-start)';
      qu.stopSpinner(`[${w.folder.name}] ${ready}`);
    }
  };
  if (progressObserver) progressObserver.dispose();
  progressObserver = w.progress.observe(updateProgress);
  updateProgress(w.progress.value);
}

function whenChangingWorkspaceFolders(e: vsc.WorkspaceFoldersChangeEvent) {
  for (const f of e.removed) {
    const w = workspaces.get(f.uri.toString());
    if (w) {
      workspaces.delete(f.uri.toString());
      w.stop();
    }
  }
}

const workspaces: Map<string, ClientWorkspace> = new Map();

function clientWorkspaceForUri(uri: vsc.Uri, opts?: { initializeIfMissing: boolean }): ClientWorkspace | undefined {
  const r = vsc.workspace.getWorkspaceFolder(uri);
  if (!r) return;
  const f = qu.nearestParentWorkspace(r, uri.fsPath);
  if (!f) return undefined;
  const existing = workspaces.get(f.uri.toString());
  if (!existing && opts && opts.initializeIfMissing) {
    const w = new ClientWorkspace(f);
    workspaces.set(f.uri.toString(), w);
    w.autoStart();
  }
  return workspaces.get(f.uri.toString());
}

export type WorkspaceProgress = { state: 'progress'; message: string } | { state: 'ready' | 'standby' };

export class ClientWorkspace {
  public readonly folder: vsc.WorkspaceFolder;
  private readonly config: RLSConfiguration;
  private lc: LanguageClient | null = null;
  private disposables: vsc.Disposable[];
  private _progress: qu.Observable<WorkspaceProgress>;
  get progress() {
    return this._progress;
  }

  constructor(folder: vsc.WorkspaceFolder) {
    this.config = RLSConfiguration.loadFromWorkspace(folder.uri.fsPath);
    this.folder = folder;
    this.disposables = [];
    this._progress = new qu.Observable<WorkspaceProgress>({ state: 'standby' });
  }

  public async autoStart() {
    return this.config.autoStartRls && this.start().then(() => true);
  }

  public async start() {
    const { createLanguageClient, setupClient, setupProgress } = this.config.engine === 'rls' ? rls : rustAnalyzer;
    const client = await createLanguageClient(this.folder, {
      updateOnStartup: this.config.updateOnStartup,
      revealOutputChannelOn: this.config.revealOutputChannelOn,
      logToFile: this.config.logToFile,
      rustup: {
        channel: this.config.channel,
        path: this.config.rustupPath,
        disabled: this.config.rustupDisabled,
      },
      rls: { path: this.config.rlsPath },
      rustAnalyzer: this.config.rustAnalyzer,
    });
    client.onDidChangeState(({ newState }) => {
      if (newState === State.Starting) this._progress.value = { state: 'progress', message: 'Starting' };
      if (newState === State.Stopped) this._progress.value = { state: 'standby' };
    });
    setupProgress(client, this._progress);
    this.disposables.push(activateTaskProvider(this.folder));
    this.disposables.push(...setupClient(client, this.folder));
    if (client.needsStart()) {
      this.disposables.push(client.start());
    }
  }

  public async stop() {
    if (this.lc) await this.lc.stop();
    this.disposables.forEach((d) => void d.dispose());
  }

  public async restart() {
    await this.stop();
    return this.start();
  }

  public runRlsCommand(e: Execution) {
    return runRlsCommand(this.folder, e);
  }

  public rustupUpdate() {
    return rustupUpdate(this.config.rustupConfig());
  }
}

const activeWorkspace = new qu.Observable<ClientWorkspace | null>(null);

function registerCommands(): vsc.Disposable[] {
  return [
    vsc.commands.registerCommand('rls.update', () => activeWorkspace.value?.rustupUpdate()),
    vsc.commands.registerCommand('rls.restart', async () => activeWorkspace.value?.restart()),
    vsc.commands.registerCommand('rls.run', (e: Execution) => activeWorkspace.value?.runRlsCommand(e)),
    vsc.commands.registerCommand('rls.start', () => activeWorkspace.value?.start()),
    vsc.commands.registerCommand('rls.stop', () => activeWorkspace.value?.stop()),
  ];
}

function configureLanguage(): vsc.Disposable {
  return vsc.languages.setLanguageConfiguration('rust', {
    onEnterRules: [
      {
        // Doc single-line comment
        // e.g. ///|
        beforeText: /^\s*\/{3}.*$/,
        action: { indentAction: vsc.IndentAction.None, appendText: '/// ' },
      },
      {
        // Parent doc single-line comment
        // e.g. //!|
        beforeText: /^\s*\/{2}\!.*$/,
        action: { indentAction: vsc.IndentAction.None, appendText: '//! ' },
      },
      {
        // Begins an auto-closed multi-line comment (standard or parent doc)
        // e.g. /** | */ or /*! | */
        beforeText: /^\s*\/\*(\*|\!)(?!\/)([^\*]|\*(?!\/))*$/,
        afterText: /^\s*\*\/$/,
        action: { indentAction: vsc.IndentAction.IndentOutdent, appendText: ' * ' },
      },
      {
        // Begins a multi-line comment (standard or parent doc)
        // e.g. /** ...| or /*! ...|
        beforeText: /^\s*\/\*(\*|\!)(?!\/)([^\*]|\*(?!\/))*$/,
        action: { indentAction: vsc.IndentAction.None, appendText: ' * ' },
      },
      {
        // Continues a multi-line comment
        // e.g.  * ...|
        beforeText: /^(\ \ )*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
        action: { indentAction: vsc.IndentAction.None, appendText: '* ' },
      },
      {
        // Dedents after closing a multi-line comment
        // e.g.  */|
        beforeText: /^(\ \ )*\ \*\/\s*$/,
        action: { indentAction: vsc.IndentAction.None, removeText: 1 },
      },
    ],
  });
}

let g_languageClient: LanguageClient = null;
let g_context: vsc.ExtensionContext = null;
let g_watchedEnvironmentFile: string = null;
let g_startupNotification: vsc.StatusBarItem = null;

export async function activate(ctx: vsc.ExtensionContext) {
  //console.log('Congratulations, your extension "semcode2" is now active!');
  //let disposable = vsc.commands.registerCommand('semcode2.helloWorld', () => {
  //  vsc.window.showInformationMessage('Hello World from SemCode2!');
  //});
  //ctx.subscriptions.push(disposable);

  if (vsc.extensions.getExtension('julialang.language-julia') && vsc.extensions.getExtension('julialang.language-julia-insider')) {
    vsc.window.showErrorMessage(
      'You have both the Julia Insider and regular Julia extension installed at the same time, which is not supported. Please uninstall or disable one of the two extensions.'
    );
    return;
  }

  g_context = ctx;
  console.log('Activating extension language-julia');
  ctx.subscriptions.push(vsc.workspace.onDidChangeConfiguration(changeConfig));
  vsc.languages.setLanguageConfiguration('julia', {
    indentationRules: {
      increaseIndentPattern: /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*(?:["'`][^"'`]*["'`])*[\w\s]*\b(if|while|for|function|macro|(mutable\s+)?struct|abstract\s+type|primitive\s+type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!(?:.*\bend\b[^\]]*)|(?:[^\[]*\].*)$).*$/,
      decreaseIndentPattern: /^\s*(end|else|elseif|catch|finally)\b.*$/,
    },
  });
  await packs.getJuliaExePath();
  repl.activate(ctx);
  documentation.activate(ctx);
  tasks.activate(ctx);
  qu.activate(ctx);
  packs.activate(ctx);
  ctx.subscriptions.push(new JuliaDebugFeature(ctx));
  ctx.subscriptions.push(new packs.JuliaPackageDevFeature(ctx));
  g_startupNotification = vsc.window.createStatusBarItem();
  ctx.subscriptions.push(g_startupNotification);
  startLanguageServer();
  ctx.subscriptions.push(
    vsc.commands.registerCommand('language-julia.refreshLanguageServer', refreshLanguageServer),
    vsc.commands.registerCommand('language-julia.restartLanguageServer', restartLanguageServer),
    vsc.workspace.registerTextDocumentContentProvider('juliavsodeprofilerresults', new qu.ProfilerResultsProvider())
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
      return vsc.workspace.getConfiguration('julia').get('packageServer');
    },
  };
  return api;
}

const g_onSetLanguageClient = new vsc.EventEmitter<LanguageClient>();
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

const g_onDidChangeConfig = new vsc.EventEmitter<vsc.ConfigurationChangeEvent>();
export const onDidChangeConfig = g_onDidChangeConfig.event;
function changeConfig(event: vsc.ConfigurationChangeEvent) {
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
    vsc.window.showErrorMessage('Could not start the Julia language server. Make sure the configuration setting julia.executablePath points to the Julia binary.');
    vsc.window.showErrorMessage(e);
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
      fileEvents: vsc.workspace.createFileSystemWatcher('**/*.{jl,jmd}'),
    },
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    traceOutputChannel: vsc.window.createOutputChannel('Julia Language Server trace'),
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
  const disposable = vsc.commands.registerCommand('language-julia.showLanguageServerOutput', () => {
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
    vsc.window.showErrorMessage('Could not start the Julia language server. Make sure the configuration setting julia.executablePath points to the Julia binary.');
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
