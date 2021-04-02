import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { Api, getExtensionApi } from './api';
import { ChildServerProc } from './tsServer/serverProc.electron';
import { CommandMgr } from './commands/commandMgr';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { DiskTSVersionProvider } from './tsServer/versionProvider.electron';
import { TSVersionProvider, TSVersion } from './tsServer/versionProvider';
import { LangConfigMgr } from './languageFeatures/languageConfig';
import { NodeLogDirProvider } from './tsServer/logDirProvider.electron';
import { nodeRequestCancelFact } from './tsServer/cancellation.electron';
import { onCaseInsenitiveFileSystem } from './utils/fileSystem.electron';
import { PluginMgr } from './utils/plugins';
import { registerBaseCommands } from './commands';
import { TSServiceConfig } from './utils/configuration';
import * as fs from 'fs';
import * as qv from 'vscode';
import * as temp from './utils/temp.electron';
import { basename } from 'path';

export function activate(ctx: qv.ExtensionContext): Api {
  const stat = qv.window.createStatusBarItem(qv.StatusBarAlignment.Left, 1000000);
  ctx.subscriptions.push(stat);
  ctx.subscriptions.push(qv.workspace.onDidChangeWorkspaceFolders((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.workspace.onDidChangeConfig((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.window.onDidChangeActiveTextEditor((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.window.onDidChangeTextEditorViewColumn((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.workspace.onDidOpenTextDocument((e) => updateStatus(stat)));
  ctx.subscriptions.push(qv.workspace.onDidCloseTextDocument((e) => updateStatus(stat)));
  updateStatus(stat);

	ctx.subscriptions.push(qv.languages.registerCallHierarchyProvider('plaintext', new FoodPyramid());
	showSampleText(ctx);

  qv.languages.registerCodeLensProvider("*", new Codelens());
  qv.commands.registerCommand("semcode.enableCodeLens", () => {
      qv.workspace.getConfig("semcode").update("enableCodeLens", true, true);
  });
  qv.commands.registerCommand("semcode.disableCodeLens", () => {
      qv.workspace.getConfig("semcode").update("enableCodeLens", false, true);
  });
  qv.commands.registerCommand("semcode.codelensAction", (args: any) => {
      qv.window.showInformationMessage(`CodeLens action with args=${args}`);
  });

  const pluginMgr = new PluginMgr();
  ctx.subscriptions.push(pluginMgr);
  const commandMgr = new CommandMgr();
  ctx.subscriptions.push(commandMgr);
  const onCompletionAccepted = new qv.EventEmitter<qv.CompletionItem>();
  ctx.subscriptions.push(onCompletionAccepted);
  const logDirProvider = new NodeLogDirProvider(ctx);
  const versionProvider = new DiskTSVersionProvider();
  ctx.subscriptions.push(new LangConfigMgr());
  const activeJsTsEditorTracker = new ActiveJsTsEditorTracker();
  ctx.subscriptions.push(activeJsTsEditorTracker);
  const lazyClientHost = createLazyClientHost(
    ctx,
    onCaseInsenitiveFileSystem(),
    {
      pluginMgr,
      commandMgr,
      logDirProvider,
      cancellerFact: nodeRequestCancelFact,
      versionProvider,
      processFact: ChildServerProc,
      activeJsTsEditorTracker,
    },
    (item) => {
      onCompletionAccepted.fire(item);
    }
  );
  registerBaseCommands(commandMgr, lazyClientHost, pluginMgr, activeJsTsEditorTracker);
  import('./providers/task').then((m) => {
    ctx.subscriptions.push(m.register(lazyClientHost.map((x) => x.serviceClient)));
  });
  import('./languageFeatures/tsconfig').then((m) => {
    ctx.subscriptions.push(m.register());
  });
  ctx.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginMgr, activeJsTsEditorTracker));
  return getExtensionApi(onCompletionAccepted.event, pluginMgr);
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
      const c = qv.workspace.getConfig('multiRootSample', r);
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

class StaticVersionProvider implements TSVersionProvider {
  constructor(private readonly _version: TSVersion) {}
  updateConfig(_configuration: TSServiceConfig): void {

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
