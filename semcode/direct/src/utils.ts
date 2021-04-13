import { ServiceClient } from './service';
import { uuid } from 'uuidv4';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as PConst from './protocol.const';
import * as qv from 'vscode';
import * as vslc from 'vscode-languageclient';
import type * as qp from './protocol';
import { isArray } from '../old/py/common/core';
export const empty = Object.freeze([]);
export function isWeb(): boolean {
  return false;
}
export function equals<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>, f: (a: T, b: T) => boolean = (a, b) => a === b): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => f(x, b[i]));
}
export function flatten<T>(a: ReadonlyArray<T>[]): T[] {
  return Array.prototype.concat.apply([], a);
}
export function coalesce<T>(a: ReadonlyArray<T | undefined>): T[] {
  return <T[]>a.filter((e) => !!e);
}
export function startSpinner(m: string) {
  qv.window.setStatusBarMessage(`Rust: $(settings-gear~spin) ${m}`);
}
export function stopSpinner(m?: string) {
  qv.window.setStatusBarMessage(m ? `Rust: ${m}` : 'Rust');
}
export function parseKindModifier(ms: string): Set<string> {
  return new Set(ms.split(/,|\s+/g));
}
export interface DocumentSelector {
  readonly syntax: readonly qv.DocumentFilter[];
  readonly semantic: readonly qv.DocumentFilter[];
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
  public observe(f: (t: T) => void): qv.Disposable {
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
export function nearestParentWorkspace(curWorkspace: qv.WorkspaceFolder, filePath: string): qv.WorkspaceFolder {
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
        uri: qv.Uri.file(cur),
      };
    }
  }
  return curWorkspace;
}
export function getOuterMostWorkspaceFolder(f: qv.WorkspaceFolder): qv.WorkspaceFolder {
  const fs = (qv.workspace.workspaceFolders || []).map((x) => normalizeUriToPathPrefix(x.uri)).sort((a, b) => a.length - b.length);
  const uri = normalizeUriToPathPrefix(f.uri);
  const p = fs.find((x) => uri.startsWith(x));
  return p ? qv.workspace.getWorkspaceFolder(qv.Uri.parse(p)) || f : f;
}
function normalizeUriToPathPrefix(u: qv.Uri): string {
  let y = u.toString();
  if (y.charAt(y.length - 1) !== '/') y = y + '/';
  return y;
}
export function constructCommandString(c: string, xs = {}) {
  return `command:${c}?${encodeURIComponent(JSON.stringify(xs))}`;
}
export function getVersionedParamsAtPosition(d: qv.TextDocument, p: qv.Position): VersionedTextDocumentPositionParams {
  return {
    textDocument: vslc.TextDocumentIdentifier.create(d.uri.toString()),
    version: d.version,
    position: p,
  };
}
export function setContext(k: string, v: boolean) {
  qv.commands.executeCommand('setContext', k, v);
}
export function generatePipeName(pid: string, n: string) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\' + n + '-' + pid;
  else return path.join(os.tmpdir(), n + '-' + pid);
}
export function inferJuliaNumThreads(): string {
  const config: number | undefined = qv.workspace.getConfig('julia').get('NumThreads') ?? undefined;
  const env: string | undefined = process.env['JULIA_NUM_THREADS'];
  if (config !== undefined) {
    return config.toString();
  } else if (env !== undefined) {
    return env;
  } else {
    return '';
  }
}
export function activate(c: qv.ExtensionContext) {
  c.subscriptions.push(qv.commands.registerCommand('language-julia.applytextedit', applyTextEdit));
  c.subscriptions.push(qv.commands.registerCommand('language-julia.toggleLinter', toggleLinter));
}
function applyTextEdit(x: any) {
  const we = new qv.WorkspaceEdit();
  for (const e of x.documentChanges[0].edits) {
    we.replace(x.documentChanges[0].textDocument.uri, new qv.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText);
  }
  qv.workspace.applyEdit(we);
}
function toggleLinter() {
  const cval = qv.workspace.getConfig('julia').get('lint.run', false);
  qv.workspace.getConfig('julia').update('lint.run', !cval, true);
}
const g_profilerResults = new Map<string, string>();
export class ProfilerResultsProvider implements qv.TextDocumentContentProvider {
  provideTextDocumentContent(uri: qv.Uri) {
    return g_profilerResults.get(uri.toString());
  }
}
export function addProfilerResult(uri: qv.Uri, content: string) {
  g_profilerResults.set(uri.toString(), content);
}
export async function showProfileResult(params: { content: string }) {
  const new_uuid = uuid();
  const uri = qv.Uri.parse('juliavsodeprofilerresults:' + new_uuid.toString() + '.cpuprofile');
  addProfilerResult(uri, params.content);
  const doc = await qv.workspace.openTextDocument(uri);
  await qv.window.showTextDocument(doc, { preview: false });
}
export async function showProfileResultFile(params: { filename: string }) {
  const uri = qv.Uri.file(params.filename);
  await qv.commands.executeCommand('qv.open', uri, {
    preserveFocuse: true,
    preview: false,
    viewColumn: qv.ViewColumn.Beside,
  });
}
export interface VersionedTextDocumentPositionParams {
  textDocument: vslc.TextDocumentIdentifier;
  version: number;
  position: qv.Position;
}
export namespace Range {
  export const fromTextSpan = (s: qp.TextSpan): qv.Range => fromLocations(s.start, s.end);
  export const toTextSpan = (r: qv.Range): qp.TextSpan => ({
    start: Position.toLocation(r.start),
    end: Position.toLocation(r.end),
  });
  export const fromLocations = (start: qp.Location, end: qp.Location): qv.Range =>
    new qv.Range(Math.max(0, start.line - 1), Math.max(start.offset - 1, 0), Math.max(0, end.line - 1), Math.max(0, end.offset - 1));
  export const toFileRangeRequestArgs = (file: string, r: qv.Range): qp.FileRangeRequestArgs => ({
    file,
    startLine: r.start.line + 1,
    startOffset: r.start.character + 1,
    endLine: r.end.line + 1,
    endOffset: r.end.character + 1,
  });
  export const toFormattingRequestArgs = (file: string, r: qv.Range): qp.FormatRequestArgs => ({
    file,
    line: r.start.line + 1,
    offset: r.start.character + 1,
    endLine: r.end.line + 1,
    endOffset: r.end.character + 1,
  });
}
export namespace Position {
  export const fromLocation = (l: qp.Location): qv.Position => new qv.Position(l.line - 1, l.offset - 1);
  export const toLocation = (p: qv.Position): qp.Location => ({
    line: p.line + 1,
    offset: p.character + 1,
  });
  export const toFileLocationRequestArgs = (file: string, p: qv.Position): qp.FileLocationRequestArgs => ({
    file,
    line: p.line + 1,
    offset: p.character + 1,
  });
}
export namespace Location {
  export const fromTextSpan = (r: qv.Uri, s: qp.TextSpan): qv.Location => new qv.Location(r, Range.fromTextSpan(s));
}
export namespace TextEdit {
  export const fromCodeEdit = (e: qp.CodeEdit): qv.TextEdit => new qv.TextEdit(Range.fromTextSpan(e), e.newText);
}
export namespace WorkspaceEdit {
  export function fromFileCodeEdits(c: ServiceClient, es: Iterable<qp.FileCodeEdits>): qv.WorkspaceEdit {
    return withFileCodeEdits(new qv.WorkspaceEdit(), c, es);
  }
  export function withFileCodeEdits(w: qv.WorkspaceEdit, c: ServiceClient, es: Iterable<qp.FileCodeEdits>): qv.WorkspaceEdit {
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
  export function fromProtocolScriptElementKind(k: qp.ScriptElementKind) {
    switch (k) {
      case PConst.Kind.module:
        return qv.SymbolKind.Module;
      case PConst.Kind.class:
        return qv.SymbolKind.Class;
      case PConst.Kind.enum:
        return qv.SymbolKind.Enum;
      case PConst.Kind.enumMember:
        return qv.SymbolKind.EnumMember;
      case PConst.Kind.interface:
        return qv.SymbolKind.Interface;
      case PConst.Kind.indexSignature:
        return qv.SymbolKind.Method;
      case PConst.Kind.callSignature:
        return qv.SymbolKind.Method;
      case PConst.Kind.method:
        return qv.SymbolKind.Method;
      case PConst.Kind.memberVariable:
        return qv.SymbolKind.Property;
      case PConst.Kind.memberGetAccessor:
        return qv.SymbolKind.Property;
      case PConst.Kind.memberSetAccessor:
        return qv.SymbolKind.Property;
      case PConst.Kind.variable:
        return qv.SymbolKind.Variable;
      case PConst.Kind.let:
        return qv.SymbolKind.Variable;
      case PConst.Kind.const:
        return qv.SymbolKind.Variable;
      case PConst.Kind.localVariable:
        return qv.SymbolKind.Variable;
      case PConst.Kind.alias:
        return qv.SymbolKind.Variable;
      case PConst.Kind.function:
        return qv.SymbolKind.Function;
      case PConst.Kind.localFunction:
        return qv.SymbolKind.Function;
      case PConst.Kind.constructSignature:
        return qv.SymbolKind.Constructor;
      case PConst.Kind.constructorImplementation:
        return qv.SymbolKind.Constructor;
      case PConst.Kind.typeParameter:
        return qv.SymbolKind.TypeParameter;
      case PConst.Kind.string:
        return qv.SymbolKind.String;
      default:
        return qv.SymbolKind.Variable;
    }
  }
}
export function disposeAll(ds: qv.Disposable[]) {
  while (ds.length) {
    const d = ds.pop();
    if (d) d.dispose();
  }
}
export abstract class Disposable {
  private _done = false;
  protected _ds: qv.Disposable[] = [];
  public dispose(): any {
    if (this._done) return;
    this._done = true;
    disposeAll(this._ds);
  }
  protected _register<T extends qv.Disposable>(x: T | T[]) {
    if (isArray(x)) {
      for (const t of x) {
        this._register(t);
      }
    } else {
      if (this._done) x.dispose();
      else this._ds.push(x);
    }
  }
  protected get isDisposed() {
    return this._done;
  }
}
export const file = 'file';
export const untitled = 'untitled';
export const git = 'git';
export const vsls = 'vsls';
export const walkThroughSnippet = 'walkThroughSnippet';
export const vscodeNotebookCell = 'vscode-notebook-cell';
export const semanticSupportedSchemes = [file, untitled, walkThroughSnippet, vscodeNotebookCell];
export const disabledSchemes = new Set([git, vsls]);
export async function exists(r: qv.Uri): Promise<boolean> {
  try {
    const s = await qv.workspace.fs.stat(r);
    return !!(s.type & qv.FileType.File);
  } catch {
    return false;
  }
}
export const addMissingAwait = 'addMissingAwait';
export const annotateWithTypeFromJSDoc = 'annotateWithTypeFromJSDoc';
export const awaitInSyncFunction = 'fixAwaitInSyncFunction';
export const classDoesntImplementInheritedAbstractMember = 'fixClassDoesntImplementInheritedAbstractMember';
export const classIncorrectlyImplementsInterface = 'fixClassIncorrectlyImplementsInterface';
export const constructorForDerivedNeedSuperCall = 'constructorForDerivedNeedSuperCall';
export const extendsInterfaceBecomesImplements = 'extendsInterfaceBecomesImplements';
export const fixImport = 'import';
export const fixUnreachableCode = 'fixUnreachableCode';
export const forgottenThisPropertyAccess = 'forgottenThisPropertyAccess';
export const spelling = 'spelling';
export const unusedIdentifier = 'unusedIdentifier';
const noopDisposable = qv.Disposable.from();
export const nulToken: qv.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => noopDisposable,
};
export interface ITask<T> {
  (): T;
}
export class Delayer<T> {
  private tout?: any;
  private prom?: Promise<T | undefined>;
  private onSuccess?: (v: T | PromiseLike<T> | undefined) => void;
  private task?: ITask<T>;
  constructor(public defDelay: number) {}
  public trigger(t: ITask<T>, d: number = this.defDelay): Promise<T | undefined> {
    this.task = t;
    if (d >= 0) this.cancelTimeout();
    if (!this.prom) {
      this.prom = new Promise<T | undefined>((resolve) => {
        this.onSuccess = resolve;
      }).then(() => {
        this.prom = undefined;
        this.onSuccess = undefined;
        const y = this.task && this.task();
        this.task = undefined;
        return y;
      });
    }
    if (d >= 0 || this.tout === undefined) {
      this.tout = setTimeout(
        () => {
          this.tout = undefined;
          if (this.onSuccess) this.onSuccess(undefined);
        },
        d >= 0 ? d : this.defDelay
      );
    }
    return this.prom;
  }
  private cancelTimeout(): void {
    if (this.tout !== undefined) {
      clearTimeout(this.tout);
      this.tout = undefined;
    }
  }
}
export const variableDeclaredButNeverUsed = new Set([6196, 6133]);
export const propertyDeclaretedButNeverUsed = new Set([6138]);
export const allImportsAreUnused = new Set([6192]);
export const unreachableCode = new Set([7027]);
export const unusedLabel = new Set([7028]);
export const fallThroughCaseInSwitch = new Set([7029]);
export const notAllCodePathsReturnAValue = new Set([7030]);
export const incorrectlyImplementsInterface = new Set([2420]);
export const cannotFindName = new Set([2552, 2304]);
export const extendsShouldBeImplements = new Set([2689]);
export const asyncOnlyAllowedInAsyncFunctions = new Set([1308]);
export function getEditForCodeAction(c: ServiceClient, a: qp.CodeAction): qv.WorkspaceEdit | undefined {
  return a.changes && a.changes.length ? WorkspaceEdit.fromFileCodeEdits(c, a.changes) : undefined;
}
export async function applyCodeAction(c: ServiceClient, a: qp.CodeAction, t: qv.CancellationToken): Promise<boolean> {
  const e = getEditForCodeAction(c, a);
  if (e) {
    if (!(await qv.workspace.applyEdit(e))) return false;
  }
  return applyCodeActionCommands(c, a.commands, t);
}
export async function applyCodeActionCommands(c: ServiceClient, cs: ReadonlyArray<{}> | undefined, t: qv.CancellationToken): Promise<boolean> {
  if (cs && cs.length) {
    for (const command of cs) {
      await c.execute('applyCodeActionCommand', { command }, t);
    }
  }
  return true;
}
export function memoize(_target: any, key: string, x: any) {
  let k: string | undefined;
  let f: Function | undefined;
  if (typeof x.value === 'function') {
    k = 'value';
    f = x.value;
  } else if (typeof x.get === 'function') {
    k = 'get';
    f = x.get;
  } else throw new Error('not supported');
  const p = `$memoize$${key}`;
  x[k] = function (...xs: any[]) {
    if (!this.hasOwnProperty(p)) {
      Object.defineProperty(this, p, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: f!.apply(this, xs),
      });
    }
    return this[p];
  };
}
export function objequals(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return equals(a, b, equals);
  else {
    const aks: string[] = [];
    for (const key in a) {
      aks.push(key);
    }
    aks.sort();
    const bks: string[] = [];
    for (const key in b) {
      bks.push(key);
    }
    bks.sort();
    if (!equals(aks, bks)) return false;
    return aks.every((k) => equals(a[k], b[k]));
  }
}
export function escapeRegExp(s: string) {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
export class RelativeWorkspacePathResolver {
  public static asAbsoluteWorkspacePath(p: string): string | undefined {
    for (const r of qv.workspace.workspaceFolders || []) {
      const pres = [`./${r.name}/`, `${r.name}/`, `.\\${r.name}\\`, `${r.name}\\`];
      for (const s of pres) {
        if (p.startsWith(s)) return path.join(r.uri.fsPath, p.replace(s, ''));
      }
    }
    return undefined;
  }
}
export class ResourceMap<T> {
  private static readonly defaultPathNormalizer = (r: qv.Uri): string => {
    if (r.scheme === file) return r.fsPath;
    return r.toString(true);
  };
  private readonly _map = new Map<string, { readonly resource: qv.Uri; value: T }>();
  constructor(
    protected readonly _normalizePath: (r: qv.Uri) => string | undefined = ResourceMap.defaultPathNormalizer,
    protected readonly config: {
      readonly onCaseInsenitiveFileSystem: boolean;
    }
  ) {}
  public get size() {
    return this._map.size;
  }
  public has(r: qv.Uri): boolean {
    const f = this.toKey(r);
    return !!f && this._map.has(f);
  }
  public get(r: qv.Uri): T | undefined {
    const f = this.toKey(r);
    if (!f) return undefined;
    const e = this._map.get(f);
    return e ? e.value : undefined;
  }
  public set(r: qv.Uri, v: T) {
    const f = this.toKey(r);
    if (!f) return;
    const e = this._map.get(f);
    if (e) e.value = v;
    else this._map.set(f, { resource: r, value: v });
  }
  public delete(r: qv.Uri): void {
    const f = this.toKey(r);
    if (f) this._map.delete(f);
  }
  public clear(): void {
    this._map.clear();
  }
  public get values(): Iterable<T> {
    return Array.from(this._map.values()).map((x) => x.value);
  }
  public get entries(): Iterable<{ resource: qv.Uri; value: T }> {
    return this._map.values();
  }
  private toKey(r: qv.Uri): string | undefined {
    const k = this._normalizePath(r);
    if (!k) return k;
    return this.isCaseInsensitivePath(k) ? k.toLowerCase() : k;
  }
  private isCaseInsensitivePath(p: string) {
    if (isWindowsPath(p)) return true;
    return p[0] === '/' && this.config.onCaseInsenitiveFileSystem;
  }
}
function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\/\\]/.test(p);
}
export class Mutex {
  private mutex = Promise.resolve();
  public lock(): PromiseLike<() => void> {
    let x: (unlock: () => void) => void;
    this.mutex = this.mutex.then(() => {
      return new Promise(x);
    });
    return new Promise((resolve) => {
      x = resolve;
    });
  }
}
export function flatten<T>(xs: T[][]): T[] {
  return xs.reduce((y, x) => y.concat(x), []);
}
export function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
export function uniqueBasedOnHash<A extends Record<string, any>>(list: A[], elementToHash: (a: A) => string, __result: A[] = []): A[] {
  const result: typeof list = [];
  const hashSet = new Set<string>();
  list.forEach((element) => {
    const hash = elementToHash(element);
    if (hashSet.has(hash)) {
      return;
    }
    hashSet.add(hash);
    result.push(element);
  });
  return result;
}
export function flattenArray<T>(xs: T[][]): T[] {
  return xs.reduce((y, x) => [...y, ...x], []);
}
export function flattenObjectValues<T>(x: { [k: string]: T[] }): T[] {
  return flattenArray(Object.keys(x).map((k) => x[k]));
}
const SHEBANG_REGEXP = /^#!(.*)/;
export function getShebang(fileContent: string): string | null {
  const match = SHEBANG_REGEXP.exec(fileContent);
  if (!match || !match[1]) {
    return null;
  }
  return match[1].replace('-', '').trim();
}
export function isBashShebang(shebang: string): boolean {
  return shebang.endsWith('bash') || shebang.endsWith('sh');
}
export function hasBashShebang(fileContent: string): boolean {
  const shebang = getShebang(fileContent);
  return shebang ? isBashShebang(shebang) : false;
}
