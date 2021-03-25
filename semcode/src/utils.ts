import * as os from 'os';
import * as path from 'path';
import * as vsc from 'vscode';
import * as vslc from 'vscode-languageclient';
import { uuid } from 'uuidv4';
import * as fs from 'fs';
import { Uri, workspace, WorkspaceFolder } from 'vscode';

export function startSpinner(m: string) {
  vsc.window.setStatusBarMessage(`Rust: $(settings-gear~spin) ${m}`);
}

export function stopSpinner(m?: string) {
  vsc.window.setStatusBarMessage(m ? `Rust: ${m}` : 'Rust');
}

export class Observable<T> {
  private _listeners: Set<(arg: T) => void> = new Set();
  private _value: T;
  constructor(v: T) {
    this._value = v;
  }
  get value() {
    return this._value;
  }
  set value(v: T) {
    this._value = v;
    this._listeners.forEach((f) => f(v));
  }
  public observe(f: (x: T) => void): vsc.Disposable {
    this._listeners.add(f);
    return { dispose: () => this._listeners.delete(f) };
  }
}

export function nearestParentWorkspace(curWorkspace: WorkspaceFolder, filePath: string): WorkspaceFolder {
  const root = curWorkspace.uri.fsPath;
  const rootManifest = path.join(root, 'Cargo.toml');
  if (fs.existsSync(rootManifest)) return curWorkspace;
  let cur = filePath;
  while (true) {
    const old = cur;
    cur = path.dirname(cur);
    if (old === cur) break;
    if (root === cur) break;
    const cargoPath = path.join(cur, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      return {
        ...curWorkspace,
        name: path.basename(cur),
        uri: Uri.file(cur),
      };
    }
  }
  return curWorkspace;
}

export function getOuterMostWorkspaceFolder(f: WorkspaceFolder): WorkspaceFolder {
  const fs = (workspace.workspaceFolders || []).map((x) => normalizeUriToPathPrefix(x.uri)).sort((a, b) => a.length - b.length);
  const uri = normalizeUriToPathPrefix(f.uri);
  const p = fs.find((x) => uri.startsWith(x));
  return p ? workspace.getWorkspaceFolder(Uri.parse(p)) || f : f;
}

function normalizeUriToPathPrefix(u: Uri): string {
  let y = u.toString();
  if (y.charAt(y.length - 1) !== '/') y = y + '/';
  return y;
}

export function constructCommandString(c: string, xs = {}) {
  return `command:${c}?${encodeURIComponent(JSON.stringify(xs))}`;
}

export function getVersionedParamsAtPosition(d: vsc.TextDocument, p: vsc.Position): VersionedTextDocumentPositionParams {
  return {
    textDocument: vslc.TextDocumentIdentifier.create(d.uri.toString()),
    version: d.version,
    position: p,
  };
}

export function setContext(k: string, v: boolean) {
  vsc.commands.executeCommand('setContext', k, v);
}

export function generatePipeName(pid: string, n: string) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\' + n + '-' + pid;
  else return path.join(os.tmpdir(), n + '-' + pid);
}

export function inferJuliaNumThreads(): string {
  const config: number | undefined = vsc.workspace.getConfiguration('julia').get('NumThreads') ?? undefined;
  const env: string | undefined = process.env['JULIA_NUM_THREADS'];
  if (config !== undefined) {
    return config.toString();
  } else if (env !== undefined) {
    return env;
  } else {
    return '';
  }
}

export function activate(c: vsc.ExtensionContext) {
  c.subscriptions.push(vsc.commands.registerCommand('language-julia.applytextedit', applyTextEdit));
  c.subscriptions.push(vsc.commands.registerCommand('language-julia.toggleLinter', toggleLinter));
}

function applyTextEdit(x: any) {
  const we = new vsc.WorkspaceEdit();
  for (const e of x.documentChanges[0].edits) {
    we.replace(x.documentChanges[0].textDocument.uri, new vsc.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText);
  }
  vsc.workspace.applyEdit(we);
}

function toggleLinter() {
  const cval = vsc.workspace.getConfiguration('julia').get('lint.run', false);
  vsc.workspace.getConfiguration('julia').update('lint.run', !cval, true);
}

const g_profilerResults = new Map<string, string>();

export class ProfilerResultsProvider implements vsc.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vsc.Uri) {
    return g_profilerResults.get(uri.toString());
  }
}

export function addProfilerResult(uri: vsc.Uri, content: string) {
  g_profilerResults.set(uri.toString(), content);
}

export async function showProfileResult(params: { content: string }) {
  const new_uuid = uuid();
  const uri = vsc.Uri.parse('juliavsodeprofilerresults:' + new_uuid.toString() + '.cpuprofile');
  addProfilerResult(uri, params.content);
  const doc = await vsc.workspace.openTextDocument(uri);
  await vsc.window.showTextDocument(doc, { preview: false });
}

export async function showProfileResultFile(params: { filename: string }) {
  const uri = vsc.Uri.file(params.filename);
  await vsc.commands.executeCommand('vsc.open', uri, {
    preserveFocuse: true,
    preview: false,
    viewColumn: vsc.ViewColumn.Beside,
  });
}

export interface VersionedTextDocumentPositionParams {
  textDocument: vslc.TextDocumentIdentifier;
  version: number;
  position: vsc.Position;
}
