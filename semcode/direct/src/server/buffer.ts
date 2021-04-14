import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ServiceClient, ClientCap } from '../service';
import API from '../utils/api';
import * as languageModeIds from '../utils/lang';
import * as qu from '../utils/base';
const enum BufferKind {
  TypeScript = 1,
  JavaScript = 2,
}
const enum BufferState {
  Initial = 1,
  Open = 2,
  Closed = 2,
}
function mode2ScriptKind(mode: string): 'TS' | 'TSX' | 'JS' | 'JSX' | undefined {
  switch (mode) {
    case languageModeIds.typescript:
      return 'TS';
    case languageModeIds.typescriptreact:
      return 'TSX';
    case languageModeIds.javascript:
      return 'JS';
    case languageModeIds.javascriptreact:
      return 'JSX';
  }
  return undefined;
}
const enum BufferOpType {
  Close,
  Open,
  Change,
}
class CloseOp {
  readonly type = BufferOpType.Close;
  constructor(public readonly args: string) {}
}
class OpenOp {
  readonly type = BufferOpType.Open;
  constructor(public readonly args: qp.OpenRequestArgs) {}
}
class ChangeOp {
  readonly type = BufferOpType.Change;
  constructor(public readonly args: qp.FileCodeEdits) {}
}
type BufferOp = CloseOp | OpenOp | ChangeOp;
class BufferSynchronizer {
  private readonly _pending: qu.ResourceMap<BufferOp>;
  constructor(private readonly client: ServiceClient, pathNormalizer: (path: qv.Uri) => string | undefined, onCaseInsenitiveFileSystem: boolean) {
    this._pending = new qu.ResourceMap<BufferOp>(pathNormalizer, {
      onCaseInsenitiveFileSystem,
    });
  }
  public open(r: qv.Uri, xs: qp.OpenRequestArgs) {
    if (this.supportsBatching) this.updatePending(r, new OpenOp(xs));
    else this.client.executeWithoutWaitingForResponse('open', xs);
  }
  public close(r: qv.Uri, filepath: string): boolean {
    if (this.supportsBatching) return this.updatePending(r, new CloseOp(filepath));
    else {
      const args: qp.FileRequestArgs = { file: filepath };
      this.client.executeWithoutWaitingForResponse('close', args);
      return true;
    }
  }
  public change(resource: qv.Uri, filepath: string, events: readonly qv.TextDocumentContentChangeEvent[]) {
    if (!events.length) return;
    if (this.supportsBatching) {
      this.updatePending(
        resource,
        new ChangeOp({
          fileName: filepath,
          textChanges: events
            .map(
              (change): qp.CodeEdit => ({
                newText: change.text,
                start: qu.Position.toLocation(change.range.start),
                end: qu.Position.toLocation(change.range.end),
              })
            )
            .reverse(),
        })
      );
    } else {
      for (const { range, text } of events) {
        const args: qp.ChangeRequestArgs = {
          insertString: text,
          ...qu.Range.toFormattingRequestArgs(filepath, range),
        };
        this.client.executeWithoutWaitingForResponse('change', args);
      }
    }
  }
  public reset(): void {
    this._pending.clear();
  }
  public beforeCommand(command: string): void {
    if (command === 'updateOpen') return;
    this.flush();
  }
  private flush() {
    if (!this.supportsBatching) {
      this._pending.clear();
      return;
    }
    if (this._pending.size > 0) {
      const closedFiles: string[] = [];
      const openFiles: qp.OpenRequestArgs[] = [];
      const changedFiles: qp.FileCodeEdits[] = [];
      for (const change of this._pending.values) {
        switch (change.type) {
          case BufferOpType.Change:
            changedFiles.push(change.args);
            break;
          case BufferOpType.Open:
            openFiles.push(change.args);
            break;
          case BufferOpType.Close:
            closedFiles.push(change.args);
            break;
        }
      }
      this.client.execute('updateOpen', { changedFiles, closedFiles, openFiles }, qu.nulToken, { nonRecoverable: true });
      this._pending.clear();
    }
  }
  private get supportsBatching(): boolean {
    return this.client.apiVersion.gte(API.v340);
  }
  private updatePending(resource: qv.Uri, op: BufferOp): boolean {
    switch (op.type) {
      case BufferOpType.Close:
        const existing = this._pending.get(resource);
        switch (existing?.type) {
          case BufferOpType.Open:
            this._pending.delete(resource);
            return false; // Open then close. No need to do anything
        }
        break;
    }
    if (this._pending.has(resource)) {
      this.flush();
    }
    this._pending.set(resource, op);
    return true;
  }
}
class SyncBuffer {
  private state = BufferState.Initial;
  constructor(private readonly document: qv.TextDocument, public readonly filepath: string, private readonly client: ServiceClient, private readonly synchronizer: BufferSynchronizer) {}
  public open(): void {
    const args: qp.OpenRequestArgs = {
      file: this.filepath,
      fileContent: this.document.getText(),
      projectRootPath: this.client.getWorkspaceRootForResource(this.document.uri),
    };
    const scriptKind = mode2ScriptKind(this.document.languageId);
    if (scriptKind) args.scriptKindName = scriptKind;
    if (this.client.apiVersion.gte(API.v240)) {
      const tsPluginsForDocument = this.client.pluginMgr.plugins.filter((x) => x.languages.indexOf(this.document.languageId) >= 0);
      if (tsPluginsForDocument.length) (args as any).plugins = tsPluginsForDocument.map((plugin) => plugin.name);
    }
    this.synchronizer.open(this.resource, args);
    this.state = BufferState.Open;
  }
  public get resource(): qv.Uri {
    return this.document.uri;
  }
  public get lineCount(): number {
    return this.document.lineCount;
  }
  public get kind(): BufferKind {
    switch (this.document.languageId) {
      case languageModeIds.javascript:
      case languageModeIds.javascriptreact:
        return BufferKind.JavaScript;
      case languageModeIds.typescript:
      case languageModeIds.typescriptreact:
      default:
        return BufferKind.TypeScript;
    }
  }
  public close(): boolean {
    if (this.state !== BufferState.Open) {
      this.state = BufferState.Closed;
      return false;
    }
    this.state = BufferState.Closed;
    return this.synchronizer.close(this.resource, this.filepath);
  }
  public onContentChanged(events: readonly qv.TextDocumentContentChangeEvent[]): void {
    if (this.state !== BufferState.Open) console.error(`Unexpected buffer state: ${this.state}`);
    this.synchronizer.change(this.resource, this.filepath, events);
  }
}
class SyncBufferMap extends qu.ResourceMap<SyncBuffer> {
  public getForPath(filePath: string): SyncBuffer | undefined {
    return this.get(qv.Uri.file(filePath));
  }
  public get allBuffers(): Iterable<SyncBuffer> {
    return this.values;
  }
}
class PendingDiags extends qu.ResourceMap<number> {
  public getOrderedFileSet(): qu.ResourceMap<void> {
    const orderedResources = Array.from(this.entries)
      .sort((a, b) => a.value - b.value)
      .map((entry) => entry.resource);
    const map = new qu.ResourceMap<void>(this._normalizePath, this.config);
    for (const resource of orderedResources) {
      map.set(resource, undefined);
    }
    return map;
  }
}
class GetErrRequest {
  public static executeGetErrRequest(client: ServiceClient, files: qu.ResourceMap<void>, onDone: () => void) {
    return new GetErrRequest(client, files, onDone);
  }
  private _done: boolean = false;
  private readonly _token: qv.CancellationTokenSource = new qv.CancellationTokenSource();
  private constructor(client: ServiceClient, public readonly files: qu.ResourceMap<void>, onDone: () => void) {
    const allFiles = qu.coalesce(
      Array.from(files.entries)
        .filter((entry) => client.hasCapabilityForResource(entry.resource, ClientCap.Semantic))
        .map((entry) => client.normalizedPath(entry.resource))
    );
    if (!allFiles.length || !client.capabilities.has(ClientCap.Semantic)) {
      this._done = true;
      setImmediate(onDone);
    } else {
      const request = client.configuration.enableProjectDiags
        ? client.executeAsync('geterrForProject', { delay: 0, file: allFiles[0] }, this._token.token)
        : client.executeAsync('geterr', { delay: 0, files: allFiles }, this._token.token);
      request.finally(() => {
        if (this._done) return;
        this._done = true;
        onDone();
      });
    }
  }
  public cancel(): any {
    if (!this._done) this._token.cancel();
    this._token.dispose();
  }
}
export default class BufferSyncSupport extends qu.Disposable {
  private readonly client: ServiceClient;
  private _validateJavaScript: boolean = true;
  private _validateTypeScript: boolean = true;
  private readonly modeIds: Set<string>;
  private readonly syncedBuffers: SyncBufferMap;
  private readonly pendingDiags: PendingDiags;
  private readonly diagnosticDelayer: qu.Delayer<any>;
  private pendingGetErr: GetErrRequest | undefined;
  private listening: boolean = false;
  private readonly synchronizer: BufferSynchronizer;
  constructor(client: ServiceClient, modeIds: readonly string[], onCaseInsenitiveFileSystem: boolean) {
    super();
    this.client = client;
    this.modeIds = new Set<string>(modeIds);
    this.diagnosticDelayer = new qu.Delayer<any>(300);
    const pathNormalizer = (path: qv.Uri) => this.client.normalizedPath(path);
    this.syncedBuffers = new SyncBufferMap(pathNormalizer, { onCaseInsenitiveFileSystem });
    this.pendingDiags = new PendingDiags(pathNormalizer, { onCaseInsenitiveFileSystem });
    this.synchronizer = new BufferSynchronizer(client, pathNormalizer, onCaseInsenitiveFileSystem);
    this.updateConfig();
    qv.workspace.onDidChangeConfig(this.updateConfig, this, this._disposables);
  }
  private readonly _onDelete = this._register(new qv.EventEmitter<qv.Uri>());
  public readonly onDelete = this._onDelete.event;
  private readonly _onWillChange = this._register(new qv.EventEmitter<qv.Uri>());
  public readonly onWillChange = this._onWillChange.event;
  public listen(): void {
    if (this.listening) return;
    this.listening = true;
    qv.workspace.onDidOpenTextDocument(this.openTextDocument, this, this._disposables);
    qv.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, this._disposables);
    qv.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, this._disposables);
    qv.window.onDidChangeVisibleTextEditors(
      (e) => {
        for (const { document } of e) {
          const syncedBuffer = this.syncedBuffers.get(document.uri);
          if (syncedBuffer) this.requestDiag(syncedBuffer);
        }
      },
      this,
      this._disposables
    );
    qv.workspace.textDocuments.forEach(this.openTextDocument, this);
  }
  public handles(resource: qv.Uri): boolean {
    return this.syncedBuffers.has(resource);
  }
  public ensureHasBuffer(resource: qv.Uri): boolean {
    if (this.syncedBuffers.has(resource)) {
      return true;
    }
    const existingDocument = qv.workspace.textDocuments.find((doc) => doc.uri.toString() === resource.toString());
    if (existingDocument) return this.openTextDocument(existingDocument);
    return false;
  }
  public toVsCodeResource(resource: qv.Uri): qv.Uri {
    const filepath = this.client.normalizedPath(resource);
    for (const buffer of this.syncedBuffers.allBuffers) {
      if (buffer.filepath === filepath) return buffer.resource;
    }
    return resource;
  }
  public toResource(filePath: string): qv.Uri {
    const buffer = this.syncedBuffers.getForPath(filePath);
    if (buffer) return buffer.resource;
    return qv.Uri.file(filePath);
  }
  public reset(): void {
    this.pendingGetErr?.cancel();
    this.pendingDiags.clear();
    this.synchronizer.reset();
  }
  public reinitialize(): void {
    this.reset();
    for (const buffer of this.syncedBuffers.allBuffers) {
      buffer.open();
    }
  }
  public openTextDocument(d: qv.TextDocument): boolean {
    if (!this.modeIds.has(d.languageId)) {
      return false;
    }
    const resource = d.uri;
    const filepath = this.client.normalizedPath(resource);
    if (!filepath) return false;
    if (this.syncedBuffers.has(resource)) {
      return true;
    }
    const syncedBuffer = new SyncBuffer(d, filepath, this.client, this.synchronizer);
    this.syncedBuffers.set(resource, syncedBuffer);
    syncedBuffer.open();
    this.requestDiag(syncedBuffer);
    return true;
  }
  public closeResource(r: qv.Uri): void {
    const syncedBuffer = this.syncedBuffers.get(r);
    if (!syncedBuffer) return;
    this.pendingDiags.delete(r);
    this.pendingGetErr?.files.delete(r);
    this.syncedBuffers.delete(r);
    const wasBufferOpen = syncedBuffer.close();
    this._onDelete.fire(r);
    if (wasBufferOpen) this.requestAllDiags();
  }
  public interruptGetErr<R>(f: () => R): R {
    if (!this.pendingGetErr || this.client.configuration.enableProjectDiags) return f();
    this.pendingGetErr.cancel();
    this.pendingGetErr = undefined;
    const result = f();
    this.triggerDiags();
    return result;
  }
  public beforeCommand(c: string): void {
    this.synchronizer.beforeCommand(c);
  }
  private onDidCloseTextDocument(d: qv.TextDocument): void {
    this.closeResource(d.uri);
  }
  private onDidChangeTextDocument(e: qv.TextDocumentChangeEvent): void {
    const syncedBuffer = this.syncedBuffers.get(e.document.uri);
    if (!syncedBuffer) return;
    this._onWillChange.fire(syncedBuffer.resource);
    syncedBuffer.onContentChanged(e.contentChanges);
    const didTrigger = this.requestDiag(syncedBuffer);
    if (!didTrigger && this.pendingGetErr) {
      this.pendingGetErr.cancel();
      this.pendingGetErr = undefined;
      this.triggerDiags();
    }
  }
  public requestAllDiags() {
    for (const buffer of this.syncedBuffers.allBuffers) {
      if (this.shouldValidate(buffer)) {
        this.pendingDiags.set(buffer.resource, Date.now());
      }
    }
    this.triggerDiags();
  }
  public getErr(rs: readonly qv.Uri[]): any {
    const handledResources = rs.filter((r) => this.handles(r));
    if (!handledResources.length) return;
    for (const resource of handledResources) {
      this.pendingDiags.set(resource, Date.now());
    }
    this.triggerDiags();
  }
  private triggerDiags(delay: number = 200) {
    this.diagnosticDelayer.trigger(() => {
      this.sendPendingDiags();
    }, delay);
  }
  private requestDiag(b: SyncBuffer): boolean {
    if (!this.shouldValidate(b)) {
      return false;
    }
    this.pendingDiags.set(b.resource, Date.now());
    const delay = Math.min(Math.max(Math.ceil(b.lineCount / 20), 300), 800);
    this.triggerDiags(delay);
    return true;
  }
  public hasPendingDiags(r: qv.Uri): boolean {
    return this.pendingDiags.has(r);
  }
  private sendPendingDiags(): void {
    const orderedFileSet = this.pendingDiags.getOrderedFileSet();
    if (this.pendingGetErr) {
      this.pendingGetErr.cancel();
      for (const { resource } of this.pendingGetErr.files.entries) {
        if (this.syncedBuffers.get(resource)) {
          orderedFileSet.set(resource, undefined);
        }
      }
      this.pendingGetErr = undefined;
    }
    for (const buffer of this.syncedBuffers.values) {
      orderedFileSet.set(buffer.resource, undefined);
    }
    if (orderedFileSet.size) {
      const getErr = (this.pendingGetErr = GetErrRequest.executeGetErrRequest(this.client, orderedFileSet, () => {
        if (this.pendingGetErr === getErr) {
          this.pendingGetErr = undefined;
        }
      }));
    }
    this.pendingDiags.clear();
  }
  private updateConfig() {
    const jsConfig = qv.workspace.getConfig('javascript', null);
    const tsConfig = qv.workspace.getConfig('typescript', null);
    this._validateJavaScript = jsConfig.get<boolean>('validate.enable', true);
    this._validateTypeScript = tsConfig.get<boolean>('validate.enable', true);
  }
  private shouldValidate(b: SyncBuffer) {
    switch (b.kind) {
      case BufferKind.JavaScript:
        return this._validateJavaScript;
      case BufferKind.TypeScript:
      default:
        return this._validateTypeScript;
    }
  }
}
