import * as path from 'path';
import * as qv from 'vscode';
import * as ql from 'vscode-languageclient/node';
import * as WebSocket from 'ws';

let aClient: ql.LanguageClient;
let clients: Map<string, ql.LanguageClient> = new Map();

let _sorteds: string[] | undefined;
function sortFolders(): string[] {
  if (_sorteds === undefined) {
    _sorteds = qv.workspace.workspaceFolders
      ? qv.workspace.workspaceFolders
          .map((f) => {
            let s = f.uri.toString();
            if (s.charAt(s.length - 1) !== '/') s = s + '/';
            return s;
          })
          .sort((a, b) => {
            return a.length - b.length;
          })
      : [];
  }
  return _sorteds;
}
qv.workspace.onDidChangeWorkspaceFolders(() => (_sorteds = undefined));

function getOuterFolder(w: qv.WorkspaceFolder): qv.WorkspaceFolder {
  let fs = sortFolders();
  for (let f of fs) {
    let s = w.uri.toString();
    if (s.charAt(s.length - 1) !== '/') s = s + '/';
    if (s.startsWith(f)) return qv.workspace.getWorkspaceFolder(qv.Uri.parse(f))!;
  }
  return w;
}

export function activate(ctx: qv.ExtensionContext) {
  const port = qv.workspace.getConfiguration('semcode').get('port', 7000);
  let socket: WebSocket | undefined = undefined;
  qv.commands.registerCommand('semcode.startStreaming', () => {
    socket = new WebSocket(`ws://localhost:${port}`);
  });
  const module = ctx.asAbsolutePath(path.join('server', 'out', 'server.js'));
  //const outputChannel: qv.OutputChannel = qv.window.createOutputChannel('semcode');
  let log = '';
  const outputChannel: qv.OutputChannel = {
    name: 'websocket',
    append(s: string) {
      log += s;
      console.log(s);
    },
    appendLine(s: string) {
      log += s;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(log);
      log = '';
    },
    clear() {},
    show() {},
    hide() {},
    dispose() {},
  };

  function didOpenDoc(d: qv.TextDocument): void {
    if (d.languageId !== 'plaintext' || (d.uri.scheme !== 'file' && d.uri.scheme !== 'untitled')) return;
    const r = d.uri;
    if (r.scheme === 'untitled' && !aClient) {
      const os = { execArgv: ['--nolazy', '--inspect=6010'], cwd: process.cwd() };
      const so: ql.ServerOptions = {
        run: { module, transport: ql.TransportKind.ipc, options: { cwd: process.cwd() } },
        debug: { module, transport: ql.TransportKind.ipc, options: os },
      };
      const co: ql.LanguageClientOptions = {
        //documentSelector: [{ scheme: 'untitled', language: 'plaintext' }],
        documentSelector: [{ scheme: 'untitled', language: 'html1' }],
        synchronize: { fileEvents: qv.workspace.createFileSystemWatcher('**/.clientrc') },
        diagnosticCollectionName: 'semcode',
        //revealOutputChannelOn: RevealOutputChannelOn.Never,
        //progressOnInitialization: true,
        outputChannel,
      };
      aClient = new ql.LanguageClient('semcode', 'SemCode', so, co);
      aClient.start();
      //aClient.registerProposedFeatures();
      //ctx.subscriptions.push(aClient.start());
      return;
    }
    let f = qv.workspace.getWorkspaceFolder(r);
    if (!f) return;
    f = getOuterFolder(f);
    if (!clients.has(f.uri.toString())) {
      const os = { execArgv: ['--nolazy', `--inspect=${6011 + clients.size}`] };
      const so: ql.ServerOptions = {
        run: { module, transport: ql.TransportKind.ipc },
        debug: { module, transport: ql.TransportKind.ipc, options: os },
      };
      const co: ql.LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'plaintext', pattern: `${f.uri.fsPath}/**/*` }],
        diagnosticCollectionName: 'semcode',
        workspaceFolder: f,
        outputChannel,
      };
      const c = new ql.LanguageClient('semcode', 'Sem Code', so, co);
      c.start();
      clients.set(f.uri.toString(), c);
    }
  }

  qv.workspace.onDidOpenTextDocument(didOpenDoc);
  qv.workspace.textDocuments.forEach(didOpenDoc);
  qv.workspace.onDidChangeWorkspaceFolders((e) => {
    for (let f of e.removed) {
      const c = clients.get(f.uri.toString());
      if (c) {
        clients.delete(f.uri.toString());
        c.stop();
      }
    }
  });
}

export async function deactivate(): Promise<void> {
  let ps: Thenable<void>[] = [];
  if (aClient) ps.push(aClient.stop());
  for (let c of clients.values()) {
    ps.push(c.stop());
  }
  await Promise.all(ps);
  return undefined;
}
