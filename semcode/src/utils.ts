import { ServiceClient } from './service';
import { uuid } from 'uuidv4';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as PConst from './protocol.const';
import * as vsc from 'vscode';
import * as vslc from 'vscode-languageclient';
import type * as Proto from './protocol';

export function startSpinner(m: string) {
  vsc.window.setStatusBarMessage(`Rust: $(settings-gear~spin) ${m}`);
}
export function stopSpinner(m?: string) {
  vsc.window.setStatusBarMessage(m ? `Rust: ${m}` : 'Rust');
}

export class Observable<T> {
  private _sinks: Set<(t: T) => void> = new Set();
  constructor(private _val: T) {}
  get val() {
    return this._val;
  }
  set val(v: T) {
    this._val = v;
    this._sinks.forEach((f) => f(v));
  }
  public observe(f: (t: T) => void): vsc.Disposable {
    this._sinks.add(f);
    return { dispose: () => this._sinks.delete(f) };
  }
}

export class Lazy<T> {
  private _val?: T;
  constructor(private readonly fun: () => T) {}
  get val() {
    return this._val ?? (this._val = this.fun());
  }
  reset() {
    this._val = undefined;
  }
  map<R>(f: (x: T) => R): Lazy<R> {
    return new Lazy(() => f(this.val));
  }
}

export function nearestParentWorkspace(curWorkspace: vsc.WorkspaceFolder, filePath: string): vsc.WorkspaceFolder {
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
        uri: vsc.Uri.file(cur),
      };
    }
  }
  return curWorkspace;
}

export function getOuterMostWorkspaceFolder(f: vsc.WorkspaceFolder): vsc.WorkspaceFolder {
  const fs = (vsc.workspace.workspaceFolders || []).map((x) => normalizeUriToPathPrefix(x.uri)).sort((a, b) => a.length - b.length);
  const uri = normalizeUriToPathPrefix(f.uri);
  const p = fs.find((x) => uri.startsWith(x));
  return p ? vsc.workspace.getWorkspaceFolder(vsc.Uri.parse(p)) || f : f;
}

function normalizeUriToPathPrefix(u: vsc.Uri): string {
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

export namespace Range {
  export const fromTextSpan = (s: Proto.TextSpan): vsc.Range => fromLocations(s.start, s.end);
  export const toTextSpan = (r: vsc.Range): Proto.TextSpan => ({
    start: Position.toLocation(r.start),
    end: Position.toLocation(r.end),
  });
  export const fromLocations = (start: Proto.Location, end: Proto.Location): vsc.Range =>
    new vsc.Range(Math.max(0, start.line - 1), Math.max(start.offset - 1, 0), Math.max(0, end.line - 1), Math.max(0, end.offset - 1));
  export const toFileRangeRequestArgs = (file: string, r: vsc.Range): Proto.FileRangeRequestArgs => ({
    file,
    startLine: r.start.line + 1,
    startOffset: r.start.character + 1,
    endLine: r.end.line + 1,
    endOffset: r.end.character + 1,
  });
  export const toFormattingRequestArgs = (file: string, r: vsc.Range): Proto.FormatRequestArgs => ({
    file,
    line: r.start.line + 1,
    offset: r.start.character + 1,
    endLine: r.end.line + 1,
    endOffset: r.end.character + 1,
  });
}

export namespace Position {
  export const fromLocation = (l: Proto.Location): vsc.Position => new vsc.Position(l.line - 1, l.offset - 1);
  export const toLocation = (p: vsc.Position): Proto.Location => ({
    line: p.line + 1,
    offset: p.character + 1,
  });
  export const toFileLocationRequestArgs = (file: string, p: vsc.Position): Proto.FileLocationRequestArgs => ({
    file,
    line: p.line + 1,
    offset: p.character + 1,
  });
}

export namespace Location {
  export const fromTextSpan = (r: vsc.Uri, s: Proto.TextSpan): vsc.Location => new vsc.Location(r, Range.fromTextSpan(s));
}

export namespace TextEdit {
  export const fromCodeEdit = (e: Proto.CodeEdit): vsc.TextEdit => new vsc.TextEdit(Range.fromTextSpan(e), e.newText);
}

export namespace WorkspaceEdit {
  export function fromFileCodeEdits(c: ServiceClient, es: Iterable<Proto.FileCodeEdits>): vsc.WorkspaceEdit {
    return withFileCodeEdits(new vsc.WorkspaceEdit(), c, es);
  }
  export function withFileCodeEdits(w: vsc.WorkspaceEdit, c: ServiceClient, es: Iterable<Proto.FileCodeEdits>): vsc.WorkspaceEdit {
    for (const e of es) {
      const r = c.toResource(e.fileName);
      for (const d of e.textChanges) {
        w.replace(r, Range.fromTextSpan(d), d.newText);
      }
    }
    return w;
  }
}

export namespace SymbolKind {
  export function fromProtocolScriptElementKind(k: Proto.ScriptElementKind) {
    switch (k) {
      case PConst.Kind.module:
        return vsc.SymbolKind.Module;
      case PConst.Kind.class:
        return vsc.SymbolKind.Class;
      case PConst.Kind.enum:
        return vsc.SymbolKind.Enum;
      case PConst.Kind.enumMember:
        return vsc.SymbolKind.EnumMember;
      case PConst.Kind.interface:
        return vsc.SymbolKind.Interface;
      case PConst.Kind.indexSignature:
        return vsc.SymbolKind.Method;
      case PConst.Kind.callSignature:
        return vsc.SymbolKind.Method;
      case PConst.Kind.method:
        return vsc.SymbolKind.Method;
      case PConst.Kind.memberVariable:
        return vsc.SymbolKind.Property;
      case PConst.Kind.memberGetAccessor:
        return vsc.SymbolKind.Property;
      case PConst.Kind.memberSetAccessor:
        return vsc.SymbolKind.Property;
      case PConst.Kind.variable:
        return vsc.SymbolKind.Variable;
      case PConst.Kind.let:
        return vsc.SymbolKind.Variable;
      case PConst.Kind.const:
        return vsc.SymbolKind.Variable;
      case PConst.Kind.localVariable:
        return vsc.SymbolKind.Variable;
      case PConst.Kind.alias:
        return vsc.SymbolKind.Variable;
      case PConst.Kind.function:
        return vsc.SymbolKind.Function;
      case PConst.Kind.localFunction:
        return vsc.SymbolKind.Function;
      case PConst.Kind.constructSignature:
        return vsc.SymbolKind.Constructor;
      case PConst.Kind.constructorImplementation:
        return vsc.SymbolKind.Constructor;
      case PConst.Kind.typeParameter:
        return vsc.SymbolKind.TypeParameter;
      case PConst.Kind.string:
        return vsc.SymbolKind.String;
      default:
        return vsc.SymbolKind.Variable;
    }
  }
}

export function disposeAll(ds: vsc.Disposable[]) {
  while (ds.length) {
    const d = ds.pop();
    if (d) d.dispose();
  }
}

export abstract class Disposable {
  private _done = false;
  protected _ds: vsc.Disposable[] = [];
  public dispose(): any {
    if (this._done) return;
    this._done = true;
    disposeAll(this._ds);
  }
  protected _register<T extends vsc.Disposable>(t: T): T {
    if (this._done) t.dispose();
    else this._ds.push(t);
    return t;
  }
  protected get isDisposed() {
    return this._done;
  }
}
