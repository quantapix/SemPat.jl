import * as qv from 'vscode';
import * as lc from 'vscode-languageclient';
import * as ra from './lsp_ext';

import { Ctx, Cmd } from './ctx';
import { applySnippetWorkspaceEdit, applySnippetTextEdits } from './snippets';
import { spawnSync } from 'child_process';
import { RunnableQuickPick, selectRunnable, createTask } from './run';
import { AstInspector } from '../../../src/providers/ast_inspector';
import { isRustDocument, sleep, isRustEditor } from './util';
import { startDebugSession, makeDebugConfig } from './debug';

export * from '../../../src/providers/ast_inspector';
export * from './run';

export function analyzerStatus(ctx: Ctx): Cmd {
  const tdcp = new (class implements qv.TextDocumentContentProvider {
    readonly uri = qv.Uri.parse('rust-analyzer-status://status');
    readonly eventEmitter = new qv.EventEmitter<qv.Uri>();

    provideTextDocumentContent(_uri: qv.Uri): qv.ProviderResult<string> {
      if (!qv.window.activeTextEditor) return '';

      return ctx.client.sendRequest(ra.analyzerStatus, null);
    }

    get onDidChange(): qv.Event<qv.Uri> {
      return this.eventEmitter.event;
    }
  })();

  let poller: NodeJS.Timer | undefined = undefined;

  ctx.pushCleanup(qv.workspace.registerTextDocumentContentProvider('rust-analyzer-status', tdcp));

  ctx.pushCleanup({
    dispose() {
      if (poller !== undefined) {
        clearInterval(poller);
      }
    },
  });

  return async () => {
    if (poller === undefined) {
      poller = setInterval(() => tdcp.eventEmitter.fire(tdcp.uri), 1000);
    }
    const document = await qv.workspace.openTextDocument(tdcp.uri);
    return qv.window.showTextDocument(document, qv.ViewColumn.Two, true);
  };
}

export function memoryUsage(ctx: Ctx): Cmd {
  const tdcp = new (class implements qv.TextDocumentContentProvider {
    readonly uri = qv.Uri.parse('rust-analyzer-memory://memory');
    readonly eventEmitter = new qv.EventEmitter<qv.Uri>();

    provideTextDocumentContent(_uri: qv.Uri): qv.ProviderResult<string> {
      if (!qv.window.activeTextEditor) return '';

      return ctx.client.sendRequest(ra.memoryUsage, null).then((mem) => {
        return 'Per-query memory usage:\n' + mem + '\n(note: database has been cleared)';
      });
    }

    get onDidChange(): qv.Event<qv.Uri> {
      return this.eventEmitter.event;
    }
  })();

  ctx.pushCleanup(qv.workspace.registerTextDocumentContentProvider('rust-analyzer-memory', tdcp));

  return async () => {
    tdcp.eventEmitter.fire(tdcp.uri);
    const document = await qv.workspace.openTextDocument(tdcp.uri);
    return qv.window.showTextDocument(document, qv.ViewColumn.Two, true);
  };
}

export function matchingBrace(ctx: Ctx): Cmd {
  return async () => {
    const editor = ctx.activeRustEditor;
    const client = ctx.client;
    if (!editor || !client) return;

    const response = await client.sendRequest(ra.matchingBrace, {
      textDocument: { uri: editor.document.uri.toString() },
      positions: editor.selections.map((s) => client.code2ProtocolConverter.asPosition(s.active)),
    });
    editor.selections = editor.selections.map((sel, idx) => {
      const active = client.protocol2CodeConverter.asPosition(response[idx]);
      const anchor = sel.isEmpty ? active : sel.anchor;
      return new qv.Selection(anchor, active);
    });
    editor.revealRange(editor.selection);
  };
}

export function joinLines(ctx: Ctx): Cmd {
  return async () => {
    const editor = ctx.activeRustEditor;
    const client = ctx.client;
    if (!editor || !client) return;

    const items: lc.TextEdit[] = await client.sendRequest(ra.joinLines, {
      ranges: editor.selections.map((it) => client.code2ProtocolConverter.asRange(it)),
      textDocument: { uri: editor.document.uri.toString() },
    });
    editor.edit((builder) => {
      client.protocol2CodeConverter.asTextEdits(items).forEach((edit) => {
        builder.replace(edit.range, edit.newText);
      });
    });
  };
}

export function onEnter(ctx: Ctx): Cmd {
  async function handleKeypress() {
    const editor = ctx.activeRustEditor;
    const client = ctx.client;

    if (!editor || !client) return false;

    const lcEdits = await client
      .sendRequest(ra.onEnter, {
        textDocument: { uri: editor.document.uri.toString() },
        position: client.code2ProtocolConverter.asPosition(editor.selection.active),
      })
      .catch((_error) => {
        return null;
      });
    if (!lcEdits) return false;

    const edits = client.protocol2CodeConverter.asTextEdits(lcEdits);
    await applySnippetTextEdits(editor, edits);
    return true;
  }

  return async () => {
    if (await handleKeypress()) return;

    await qv.commands.executeCommand('default:type', { text: '\n' });
  };
}

export function parentModule(ctx: Ctx): Cmd {
  return async () => {
    const editor = ctx.activeRustEditor;
    const client = ctx.client;
    if (!editor || !client) return;

    const response = await client.sendRequest(ra.parentModule, {
      textDocument: { uri: editor.document.uri.toString() },
      position: client.code2ProtocolConverter.asPosition(editor.selection.active),
    });
    const loc = response[0];
    if (!loc) return;

    const uri = client.protocol2CodeConverter.asUri(loc.targetUri);
    const range = client.protocol2CodeConverter.asRange(loc.targetRange);

    const doc = await qv.workspace.openTextDocument(uri);
    const e = await qv.window.showTextDocument(doc);
    e.selection = new qv.Selection(range.start, range.start);
    e.revealRange(range, qv.TextEditorRevealType.InCenter);
  };
}

export function ssr(ctx: Ctx): Cmd {
  return async () => {
    const client = ctx.client;
    if (!client) return;

    const options: qv.InputBoxOptions = {
      value: '() ==>> ()',
      prompt: "Enter request, for example 'Foo($a) ==> Foo::new($a)' ",
      validateInput: async (x: string) => {
        try {
          await client.sendRequest(ra.ssr, { query: x, parseOnly: true });
        } catch (e) {
          return e.toString();
        }
        return null;
      },
    };
    const request = await qv.window.showInputBox(options);
    if (!request) return;

    qv.window.withProgress(
      {
        location: qv.ProgressLocation.Notification,
        title: 'Structured search replace in progress...',
        cancellable: false,
      },
      async (_progress, _token) => {
        const edit = await client.sendRequest(ra.ssr, { query: request, parseOnly: false });

        await qv.workspace.applyEdit(client.protocol2CodeConverter.asWorkspaceEdit(edit));
      }
    );
  };
}

export function serverVersion(ctx: Ctx): Cmd {
  return async () => {
    const { stdout } = spawnSync(ctx.serverPath, ['--version'], { encoding: 'utf8' });
    const commitHash = stdout.slice(`rust-analyzer `.length).trim();
    const { releaseTag } = ctx.config.package;

    void qv.window.showInformationMessage(`rust-analyzer version: ${releaseTag ?? 'unreleased'} (${commitHash})`);
  };
}

export function toggleInlayHints(ctx: Ctx): Cmd {
  return async () => {
    await qv.workspace.getConfiguration(`${ctx.config.rootSection}.inlayHints`).update('enable', !ctx.config.inlayHints.enable, qv.ConfigurationTarget.Workspace);
  };
}

export function syntaxTree(ctx: Ctx): Cmd {
  const tdcp = new (class implements qv.TextDocumentContentProvider {
    readonly uri = qv.Uri.parse('rust-analyzer://syntaxtree/tree.rast');
    readonly eventEmitter = new qv.EventEmitter<qv.Uri>();
    constructor() {
      qv.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, ctx.subscriptions);
      qv.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, ctx.subscriptions);
    }

    private onDidChangeTextDocument(event: qv.TextDocumentChangeEvent) {
      if (isRustDocument(event.document)) {
        void sleep(10).then(() => this.eventEmitter.fire(this.uri));
      }
    }
    private onDidChangeActiveTextEditor(editor: qv.TextEditor | undefined) {
      if (editor && isRustEditor(editor)) {
        this.eventEmitter.fire(this.uri);
      }
    }

    provideTextDocumentContent(uri: qv.Uri, ct: qv.CancellationToken): qv.ProviderResult<string> {
      const rustEditor = ctx.activeRustEditor;
      if (!rustEditor) return '';

      const range = uri.query === 'range=true' && !rustEditor.selection.isEmpty ? ctx.client.code2ProtocolConverter.asRange(rustEditor.selection) : null;

      const params = { textDocument: { uri: rustEditor.document.uri.toString() }, range };
      return ctx.client.sendRequest(ra.syntaxTree, params, ct);
    }

    get onDidChange(): qv.Event<qv.Uri> {
      return this.eventEmitter.event;
    }
  })();

  void new AstInspector(ctx);

  ctx.pushCleanup(qv.workspace.registerTextDocumentContentProvider('rust-analyzer', tdcp));
  ctx.pushCleanup(
    qv.languages.setLanguageConfiguration('ra_syntax_tree', {
      brackets: [['[', ')']],
    })
  );

  return async () => {
    const editor = qv.window.activeTextEditor;
    const rangeEnabled = !!editor && !editor.selection.isEmpty;

    const uri = rangeEnabled ? qv.Uri.parse(`${tdcp.uri.toString()}?range=true`) : tdcp.uri;

    const document = await qv.workspace.openTextDocument(uri);

    tdcp.eventEmitter.fire(uri);

    void (await qv.window.showTextDocument(document, {
      viewColumn: qv.ViewColumn.Two,
      preserveFocus: true,
    }));
  };
}

export function expandMacro(ctx: Ctx): Cmd {
  function codeFormat(expanded: ra.ExpandedMacro): string {
    let result = `// Recursive expansion of ${expanded.name}! macro\n`;
    result += '// ' + '='.repeat(result.length - 3);
    result += '\n\n';
    result += expanded.expansion;

    return result;
  }

  const tdcp = new (class implements qv.TextDocumentContentProvider {
    uri = qv.Uri.parse('rust-analyzer://expandMacro/[EXPANSION].rs');
    eventEmitter = new qv.EventEmitter<qv.Uri>();
    async provideTextDocumentContent(_uri: qv.Uri): Promise<string> {
      const editor = qv.window.activeTextEditor;
      const client = ctx.client;
      if (!editor || !client) return '';

      const position = editor.selection.active;

      const expanded = await client.sendRequest(ra.expandMacro, {
        textDocument: { uri: editor.document.uri.toString() },
        position,
      });

      if (expanded == null) return 'Not available';

      return codeFormat(expanded);
    }

    get onDidChange(): qv.Event<qv.Uri> {
      return this.eventEmitter.event;
    }
  })();

  ctx.pushCleanup(qv.workspace.registerTextDocumentContentProvider('rust-analyzer', tdcp));

  return async () => {
    const document = await qv.workspace.openTextDocument(tdcp.uri);
    tdcp.eventEmitter.fire(tdcp.uri);
    return qv.window.showTextDocument(document, qv.ViewColumn.Two, true);
  };
}

export function reloadWorkspace(ctx: Ctx): Cmd {
  return async () => ctx.client.sendRequest(ra.reloadWorkspace, null);
}

export function showReferences(ctx: Ctx): Cmd {
  return (uri: string, position: lc.Position, locations: lc.Location[]) => {
    const client = ctx.client;
    if (client) {
      qv.commands.executeCommand('editor.action.showReferences', qv.Uri.parse(uri), client.protocol2CodeConverter.asPosition(position), locations.map(client.protocol2CodeConverter.asLocation));
    }
  };
}

export function applyActionGroup(_ctx: Ctx): Cmd {
  return async (actions: { label: string; arguments: ra.ResolveCodeActionParams }[]) => {
    const selectedAction = await qv.window.showQuickPick(actions);
    if (!selectedAction) return;
    qv.commands.executeCommand('rust-analyzer.resolveCodeAction', selectedAction.arguments);
  };
}

export function gotoLocation(ctx: Ctx): Cmd {
  return async (locationLink: lc.LocationLink) => {
    const client = ctx.client;
    if (client) {
      const uri = client.protocol2CodeConverter.asUri(locationLink.targetUri);
      let range = client.protocol2CodeConverter.asRange(locationLink.targetSelectionRange);

      range = range.with({ end: range.start });

      await qv.window.showTextDocument(uri, { selection: range });
    }
  };
}

export function resolveCodeAction(ctx: Ctx): Cmd {
  const client = ctx.client;
  return async (params: ra.ResolveCodeActionParams) => {
    const item: lc.WorkspaceEdit = await client.sendRequest(ra.resolveCodeAction, params);
    if (!item) {
      return;
    }
    const edit = client.protocol2CodeConverter.asWorkspaceEdit(item);
    await applySnippetWorkspaceEdit(edit);
  };
}

export function applySnippetWorkspaceEditCommand(_ctx: Ctx): Cmd {
  return async (edit: qv.WorkspaceEdit) => {
    await applySnippetWorkspaceEdit(edit);
  };
}

export function run(ctx: Ctx): Cmd {
  let prevRunnable: RunnableQuickPick | undefined;

  return async () => {
    const item = await selectRunnable(ctx, prevRunnable);
    if (!item) return;

    item.detail = 'rerun';
    prevRunnable = item;
    const task = await createTask(item.runnable, ctx.config);
    return await qv.tasks.executeTask(task);
  };
}

export function runSingle(ctx: Ctx): Cmd {
  return async (runnable: ra.Runnable) => {
    const editor = ctx.activeRustEditor;
    if (!editor) return;

    const task = await createTask(runnable, ctx.config);
    task.group = qv.TaskGroup.Build;
    task.presentationOptions = {
      reveal: qv.TaskRevealKind.Always,
      panel: qv.TaskPanelKind.Dedicated,
      clear: true,
    };

    return qv.tasks.executeTask(task);
  };
}

export function debug(ctx: Ctx): Cmd {
  let prevDebuggee: RunnableQuickPick | undefined;

  return async () => {
    const item = await selectRunnable(ctx, prevDebuggee, true);
    if (!item) return;

    item.detail = 'restart';
    prevDebuggee = item;
    return await startDebugSession(ctx, item.runnable);
  };
}

export function debugSingle(ctx: Ctx): Cmd {
  return async (config: ra.Runnable) => {
    await startDebugSession(ctx, config);
  };
}

export function newDebugConfig(ctx: Ctx): Cmd {
  return async () => {
    const item = await selectRunnable(ctx, undefined, true, false);
    if (!item) return;

    await makeDebugConfig(ctx, item.runnable);
  };
}
