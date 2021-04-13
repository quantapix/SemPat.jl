import Tracer from '../utils/tracer';
import * as fs from 'fs';
import { getTempFile } from '../utils/temp';
import * as os from 'os';
import * as path from 'path';
import { CancellationId, CancellationTokenSource, MessageConnection } from 'vscode-jsonrpc';
import { randomBytes } from 'crypto';
import {
  AbstractCancellationTokenSource,
  CancellationReceiverStrategy,
  CancellationSenderStrategy,
  CancellationStrategy,
  CancellationToken,
  Disposable,
  Emitter,
  Event,
  LSPErrorCodes,
  ResponseError,
} from 'vscode-languageserver';
class CancellationThrottle {
  private static _lastCheckTimestamp = 0;
  static shouldCheck() {
    const minTimeBetweenChecksInMs = 5;
    const curTimestamp = Date.now().valueOf();
    const timeSinceLastCheck = curTimestamp - this._lastCheckTimestamp;
    if (timeSinceLastCheck >= minTimeBetweenChecksInMs) {
      this._lastCheckTimestamp = curTimestamp;
      return true;
    }
    return false;
  }
}
class FileBasedToken implements CancellationToken {
  protected isCancelled = false;
  private _emitter: Emitter<any> | undefined;
  constructor(readonly cancellationFilePath: string) {}
  public cancel() {
    if (!this.isCancelled) {
      this.isCancelled = true;
      if (this._emitter) {
        this._emitter.fire(undefined);
        this._disposeEmitter();
      }
    }
  }
  get isCancellationRequested(): boolean {
    if (this.isCancelled) return true;
    if (CancellationThrottle.shouldCheck() && this._pipeExists()) this.cancel();
    return this.isCancelled;
  }
  get onCancellationRequested(): Event<any> {
    if (!this._emitter) this._emitter = new Emitter<any>();
    return this._emitter.event;
  }
  public dispose(): void {
    this._disposeEmitter();
  }
  private _disposeEmitter() {
    if (this._emitter) {
      this._emitter.dispose();
      this._emitter = undefined;
    }
  }
  private _pipeExists(): boolean {
    try {
      fs.statSync(this.cancellationFilePath);
      return true;
    } catch (e) {
      return false;
    }
  }
}
class OwningFileToken extends FileBasedToken {
  private _disposed = false;
  constructor(cancellationFilePath: string) {
    super(cancellationFilePath);
  }
  public cancel() {
    if (!this._disposed && !this.isCancelled) {
      this._createPipe();
      super.cancel();
    }
  }
  get isCancellationRequested(): boolean {
    return this.isCancelled;
  }
  public dispose(): void {
    this._disposed = true;
    super.dispose();
    this._removePipe();
  }
  private _createPipe() {
    try {
      fs.writeFileSync(this.cancellationFilePath, '', { flag: 'w' });
    } catch {}
  }
  private _removePipe() {
    try {
      fs.unlinkSync(this.cancellationFilePath);
    } catch {}
  }
}
class FileBasedCancellationTokenSource implements AbstractCancellationTokenSource {
  private _token: CancellationToken | undefined;
  constructor(private _cancellationFilePath: string, private _ownFile: boolean = false) {}
  get token(): CancellationToken {
    if (!this._token) {
      this._token = this._ownFile ? new OwningFileToken(this._cancellationFilePath) : new FileBasedToken(this._cancellationFilePath);
    }
    return this._token;
  }
  cancel(): void {
    if (!this._token) this._token = CancellationToken.Cancelled;
    else (this._token as FileBasedToken).cancel();
  }
  dispose(): void {
    if (!this._token) this._token = CancellationToken.None;
    else if (this._token instanceof FileBasedToken) this._token.dispose();
  }
}
function getCancellationFolderPath(folderName: string) {
  return path.join(os.tmpdir(), 'python-languageserver-cancellation', folderName);
}
function getCancellationFilePath(folderName: string, id: CancellationId) {
  return path.join(getCancellationFolderPath(folderName), `cancellation-${String(id)}.tmp`);
}
class FileCancellationReceiverStrategy implements CancellationReceiverStrategy {
  constructor(readonly folderName: string) {}
  createCancellationTokenSource(id: CancellationId): AbstractCancellationTokenSource {
    return new FileBasedCancellationTokenSource(getCancellationFilePath(this.folderName, id));
  }
}
export class OpCanceledException extends ResponseError<void> {
  constructor() {
    super(LSPErrorCodes.RequestCancelled, 'request cancelled');
  }
  static is(e: any) {
    return e.code === LSPErrorCodes.RequestCancelled;
  }
}
export function throwIfCancellationRequested(token: CancellationToken) {
  if (token.isCancellationRequested) {
    throw new OpCanceledException();
  }
}
let cancellationFolderName: string | undefined;
export function getCancellationFolderName() {
  return cancellationFolderName;
}
export function setCancellationFolderName(folderName?: string) {
  cancellationFolderName = folderName;
}
export function getCancellationStrategyFromArgv(argv: string[]): CancellationStrategy {
  let receiver: CancellationReceiverStrategy | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cancellationReceive') receiver = createReceiverStrategyFromArgv(argv[i + 1]);
    else {
      const args = arg.split('=');
      if (args[0] === '--cancellationReceive') receiver = createReceiverStrategyFromArgv(args[1]);
    }
  }
  if (receiver && !cancellationFolderName) setCancellationFolderName((receiver as FileCancellationReceiverStrategy).folderName);
  receiver = receiver ? receiver : CancellationReceiverStrategy.Message;
  return { receiver, sender: CancellationSenderStrategy.Message };
  function createReceiverStrategyFromArgv(arg: string): CancellationReceiverStrategy | undefined {
    const folderName = extractCancellationFolderName(arg);
    return folderName ? new FileCancellationReceiverStrategy(folderName) : undefined;
  }
  function extractCancellationFolderName(arg: string): string | undefined {
    const fileRegex = /^file:(.+)$/;
    const folderName = arg.match(fileRegex);
    return folderName ? folderName[1] : undefined;
  }
}
let cancellationSourceId = 0;
export function createBackgroundThreadCancellationTokenSource(): AbstractCancellationTokenSource {
  if (!cancellationFolderName) return new CancellationTokenSource();
  return new FileBasedCancellationTokenSource(getCancellationFilePath(cancellationFolderName, `source-${String(cancellationSourceId++)}`), true);
}
export function disposeCancellationToken(token: CancellationToken) {
  if (token instanceof FileBasedToken) token.dispose();
}
export function getCancellationTokenFromId(cancellationId: string) {
  if (!cancellationId) return CancellationToken.None;
  return new FileBasedToken(cancellationId);
}
export function getCancellationTokenId(token: CancellationToken) {
  return token instanceof FileBasedToken ? token.cancellationFilePath : undefined;
}
export function CancelAfter(...tokens: CancellationToken[]) {
  const source = new CancellationTokenSource();
  const disposables: Disposable[] = [];
  for (const token of tokens) {
    disposables.push(
      token.onCancellationRequested((_) => {
        source.cancel();
      })
    );
  }
  disposables.push(
    source.token.onCancellationRequested((_) => {
      disposables.forEach((d) => d.dispose());
    })
  );
  return source;
}

export interface OngoingRequestCancel {
  readonly cancellationPipeName: string | undefined;
  tryCancelOngoingRequest(seq: number): boolean;
}
export interface OngoingRequestCancelFact {
  create(serverId: string, tracer: Tracer): OngoingRequestCancel;
}
const noopRequestCancel = new (class implements OngoingRequestCancel {
  public readonly cancellationPipeName = undefined;
  public tryCancelOngoingRequest(_seq: number): boolean {
    return false;
  }
})();
export const noopRequestCancelFact = new (class implements OngoingRequestCancelFact {
  create(_serverId: string, _tracer: Tracer): OngoingRequestCancel {
    return noopRequestCancel;
  }
})();
export class NodeRequestCancel implements OngoingRequestCancel {
  public readonly cancellationPipeName: string;
  public constructor(private readonly _serverId: string, private readonly _tracer: Tracer) {
    this.cancellationPipeName = getTempFile('tscancellation');
  }
  public tryCancelOngoingRequest(seq: number): boolean {
    if (!this.cancellationPipeName) {
      return false;
    }
    this._tracer.logTrace(this._serverId, `TypeScript Server: trying to cancel ongoing request with sequence number ${seq}`);
    try {
      fs.writeFileSync(this.cancellationPipeName + seq, '');
    } catch {}
    return true;
  }
}
export const nodeRequestCancelFact = new (class implements OngoingRequestCancelFact {
  create(serverId: string, tracer: Tracer): OngoingRequestCancel {
    return new NodeRequestCancel(serverId, tracer);
  }
})();
function getCancellationFolderPath(folderName: string) {
  return path.join(os.tmpdir(), 'python-languageserver-cancellation', folderName);
}
function getCancellationFilePath(folderName: string, id: CancellationId) {
  return path.join(getCancellationFolderPath(folderName), `cancellation-${String(id)}.tmp`);
}
function tryRun(callback: () => void) {
  try {
    callback();
  } catch (e) {
    /* empty */
  }
}
class FileCancellationSenderStrategy implements CancellationSenderStrategy {
  constructor(readonly folderName: string) {
    const folder = getCancellationFolderPath(folderName)!;
    tryRun(() => fs.mkdirSync(folder, { recursive: true }));
  }
  sendCancellation(_: MessageConnection, id: CancellationId): void {
    const file = getCancellationFilePath(this.folderName, id);
    tryRun(() => fs.writeFileSync(file, '', { flag: 'w' }));
  }
  cleanup(id: CancellationId): void {
    tryRun(() => fs.unlinkSync(getCancellationFilePath(this.folderName, id)));
  }
  dispose(): void {
    const folder = getCancellationFolderPath(this.folderName);
    tryRun(() => rimraf(folder));
    function rimraf(location: string) {
      const stat = fs.lstatSync(location);
      if (stat) {
        if (stat.isDir() && !stat.isSymbolicLink()) {
          for (const dir of fs.readdirSync(location)) {
            rimraf(path.join(location, dir));
          }
          fs.rmdirSync(location);
        } else {
          fs.unlinkSync(location);
        }
      }
    }
  }
}
export class FileBasedCancellationStrategy implements CancellationStrategy, Disposable {
  private _sender: FileCancellationSenderStrategy;
  constructor() {
    const folderName = randomBytes(21).toString('hex');
    this._sender = new FileCancellationSenderStrategy(folderName);
  }
  get receiver(): CancellationReceiverStrategy {
    return CancellationReceiverStrategy.Message;
  }
  get sender(): CancellationSenderStrategy {
    return this._sender;
  }
  getCommandLineArguments(): string[] {
    return [`--cancellationReceive=file:${this._sender.folderName}`];
  }
  dispose(): void {
    this._sender.dispose();
  }
}
