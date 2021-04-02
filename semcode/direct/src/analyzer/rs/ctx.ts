import * as qv from 'vscode';
import * as lc from 'vscode-languageclient';
import * as ra from './lsp_ext';

import { Config } from './config';
import { createClient } from './client';
import { isRustEditor, RustEditor } from './util';
import { Status } from './lsp_ext';

export class Ctx {
  private constructor(readonly config: Config, private readonly extCtx: qv.ExtensionContext, readonly client: lc.LangClient, readonly serverPath: string, readonly statusBar: qv.StatusBarItem) {}

  static async create(config: Config, extCtx: qv.ExtensionContext, serverPath: string, cwd: string): Promise<Ctx> {
    const client = createClient(serverPath, cwd);

    const statusBar = qv.window.createStatusBarItem(qv.StatusBarAlignment.Left);
    extCtx.subscriptions.push(statusBar);
    statusBar.text = 'rust-analyzer';
    statusBar.tooltip = 'ready';
    statusBar.show();

    const res = new Ctx(config, extCtx, client, serverPath, statusBar);

    res.pushCleanup(client.start());
    await client.onReady();
    client.onNotification(ra.status, (status) => res.setStatus(status));
    return res;
  }

  get activeRustEditor(): RustEditor | undefined {
    const editor = qv.window.activeTextEditor;
    return editor && isRustEditor(editor) ? editor : undefined;
  }

  get visibleRustEditors(): RustEditor[] {
    return qv.window.visibleTextEditors.filter(isRustEditor);
  }

  registerCommand(name: string, factory: (ctx: Ctx) => Cmd) {
    const fullName = `rust-analyzer.${name}`;
    const cmd = factory(this);
    const d = qv.commands.registerCommand(fullName, cmd);
    this.pushCleanup(d);
  }

  get globalState(): qv.Memento {
    return this.extCtx.globalState;
  }

  get subscriptions(): Disposable[] {
    return this.extCtx.subscriptions;
  }

  setStatus(status: Status) {
    switch (status) {
      case 'loading':
        this.statusBar.text = '$(sync~spin) rust-analyzer';
        this.statusBar.tooltip = 'Loading the project';
        this.statusBar.command = undefined;
        this.statusBar.color = undefined;
        break;
      case 'ready':
        this.statusBar.text = 'rust-analyzer';
        this.statusBar.tooltip = 'Ready';
        this.statusBar.command = undefined;
        this.statusBar.color = undefined;
        break;
      case 'invalid':
        this.statusBar.text = '$(error) rust-analyzer';
        this.statusBar.tooltip = 'Failed to load the project';
        this.statusBar.command = undefined;
        this.statusBar.color = new qv.ThemeColor('notificationsErrorIcon.foreground');
        break;
      case 'needsReload':
        this.statusBar.text = '$(warning) rust-analyzer';
        this.statusBar.tooltip = 'Click to reload';
        this.statusBar.command = 'rust-analyzer.reloadWorkspace';
        this.statusBar.color = new qv.ThemeColor('notificationsWarningIcon.foreground');
        break;
    }
  }

  pushCleanup(d: Disposable) {
    this.extCtx.subscriptions.push(d);
  }
}

export interface Disposable {
  dispose(): void;
}
export type Cmd = (...args: any[]) => unknown;
