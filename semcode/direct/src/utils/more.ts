import { ServiceClient } from '../service';
import { uuid } from 'uuidv4';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vslc from 'vscode-languageclient';
import type * as qp from '../server/proto';
import leven from 'leven';

export type GetCanonicalFileName = (name: string) => string;
export function isDebugMode() {
  const x = process.execArgv.join();
  return x.includes('inspect') || x.includes('debug');
}

export function computeCompletionSimilarity(typedValue: string, symbolName: string): number {
  if (symbolName.startsWith(typedValue)) {
    return 1;
  }
  const symbolLower = symbolName.toLocaleLowerCase();
  const typedLower = typedValue.toLocaleLowerCase();
  if (symbolLower.startsWith(typedLower)) {
    return 0.75;
  }
  let symbolSubstrLength = symbolLower.length;
  let smallestEditDistance = Number.MAX_VALUE;
  while (symbolSubstrLength > 0) {
    const editDistance = leven(symbolLower.substr(0, symbolSubstrLength), typedLower);
    if (editDistance < smallestEditDistance) smallestEditDistance = editDistance;
    symbolSubstrLength--;
  }
  if (smallestEditDistance >= typedValue.length) return 0;
  const similarity = (typedValue.length - smallestEditDistance) / typedValue.length;
  return 0.5 * similarity;
}
export function isPatternInSymbol(typedValue: string, symbolName: string): boolean {
  const typedLower = typedValue.toLocaleLowerCase();
  const symbolLower = symbolName.toLocaleLowerCase();
  const typedLength = typedLower.length;
  const symbolLength = symbolLower.length;
  let typedPos = 0;
  let symbolPos = 0;
  while (typedPos < typedLength && symbolPos < symbolLength) {
    if (typedLower[typedPos] === symbolLower[symbolPos]) typedPos += 1;
    symbolPos += 1;
  }
  return typedPos === typedLength;
}

export function isWeb(): boolean {
  return false;
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
  if (config !== undefined) return config.toString();
  else if (env !== undefined) return env;
  else {
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
