import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { Api, getExtensionApi } from './api';
import { ChildServerProcess } from './tsServer/serverProcess.electron';
import { CommandManager } from './commands/commandManager';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { DiskTypeScriptVersionProvider } from './tsServer/versionProvider.electron';
import { ITypeScriptVersionProvider, TypeScriptVersion } from './tsServer/versionProvider';
import { LanguageConfigurationManager } from './languageFeatures/languageConfiguration';
import { NodeLogDirectoryProvider } from './tsServer/logDirectoryProvider.electron';
import { nodeRequestCancellerFactory } from './tsServer/cancellation.electron';
import { onCaseInsenitiveFileSystem } from './utils/fileSystem.electron';
import { PluginManager } from './utils/plugins';
import { registerBaseCommands } from './commands';
import { TypeScriptServiceConfiguration } from './utils/configuration';
import * as fs from 'fs';
import * as qv from 'vscode';
import * as temp from './utils/temp.electron';
import { basename } from 'path';

export function activate(ctx: qv.ExtensionContext): Api {
  const stat = qv.window.createStatusBarItem(qv.StatusBarAlignment.Left, 1000000);
  ctx.subscriptions.push(stat);
  ctx.subscriptions.push(qv.workspace.onDidChangeWorkspaceFolders((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.workspace.onDidChangeConfiguration((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.window.onDidChangeActiveTextEditor((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.window.onDidChangeTextEditorViewColumn((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.workspace.onDidOpenTextDocument((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.workspace.onDidCloseTextDocument((e) => updateStatus(stat)));
  updateStatus(stat);

	ctx.subscriptions.push(qv.languages.registerCallHierarchyProvider('plaintext', new FoodPyramid());
	showSampleText(ctx);

  const pluginManager = new PluginManager();
  ctx.subscriptions.push(pluginManager);
  const commandManager = new CommandManager();
  ctx.subscriptions.push(commandManager);
  const onCompletionAccepted = new qv.EventEmitter<qv.CompletionItem>();
  ctx.subscriptions.push(onCompletionAccepted);
  const logDirectoryProvider = new NodeLogDirectoryProvider(ctx);
  const versionProvider = new DiskTypeScriptVersionProvider();
  ctx.subscriptions.push(new LanguageConfigurationManager());
  const activeJsTsEditorTracker = new ActiveJsTsEditorTracker();
  ctx.subscriptions.push(activeJsTsEditorTracker);
  const lazyClientHost = createLazyClientHost(
    ctx,
    onCaseInsenitiveFileSystem(),
    {
      pluginManager,
      commandManager,
      logDirectoryProvider,
      cancellerFactory: nodeRequestCancellerFactory,
      versionProvider,
      processFactory: ChildServerProcess,
      activeJsTsEditorTracker,
    },
    (item) => {
      onCompletionAccepted.fire(item);
    }
  );
  registerBaseCommands(commandManager, lazyClientHost, pluginManager, activeJsTsEditorTracker);
  import('./providers/task').then((m) => {
    ctx.subscriptions.push(m.register(lazyClientHost.map((x) => x.serviceClient)));
  });
  import('./languageFeatures/tsconfig').then((m) => {
    ctx.subscriptions.push(m.register());
  });
  ctx.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager, activeJsTsEditorTracker));
  return getExtensionApi(onCompletionAccepted.event, pluginManager);
}

export function deactivate() {
  fs.rmdirSync(temp.getInstanceTempDir(), { recursive: true });
}

function updateStatus(s: qv.StatusBarItem): void {
  const i = getEditorInfo();
  s.text = i ? i.text || '' : '';
  s.tooltip = i ? i.tooltip : undefined;
  s.color = i ? i.color : undefined;
  if (i) s.show();
  else s.hide();
}

function getEditorInfo(): { text?: string; tooltip?: string; color?: string } | undefined {
  const e = qv.window.activeTextEditor;
  if (!e || !qv.workspace.workspaceFolders || qv.workspace.workspaceFolders.length < 2) return null;
  let text: string | undefined;
  let tooltip: string | undefined;
  let color: string | undefined;
  const r = e.document.uri;
  if (r.scheme === 'file') {
    const f = qv.workspace.getWorkspaceFolder(r);
    if (!f) text = `$(alert) <outside workspace> → ${basename(r.fsPath)}`;
    else {
      text = `$(file-submodule) ${basename(f.uri.fsPath)} (${f.index + 1} of ${qv.workspace.workspaceFolders.length}) → $(file-code) ${basename(r.fsPath)}`;
      tooltip = r.fsPath;
      const c = qv.workspace.getConfiguration('multiRootSample', r);
      color = c.get('statusColor');
    }
  }
  return { text, tooltip, color };
}

async function showSampleText(ctx: qv.ExtensionContext): Promise<void> {
	const e = await qv.workspace.fs.readFile(qv.Uri.file(ctx.asAbsolutePath('sample.txt')));
	const t = new TextDecoder('utf-8').decode(e);
	const d = await qv.workspace.openTextDocument({ language: 'plaintext', content: t });
	qv.window.showTextDocument(d);
}

class StaticVersionProvider implements ITypeScriptVersionProvider {
  constructor(private readonly _version: TypeScriptVersion) {}
  updateConfiguration(_configuration: TypeScriptServiceConfiguration): void {
    // noop
  }
  get defaultVersion() {
    return this._version;
  }
  get bundledVersion() {
    return this._version;
  }
  readonly globalVersion = undefined;
  readonly localVersion = undefined;
  readonly localVersions = [];
}
