import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import * as qv from 'vscode';
import type * as qp from '../protocol';
import { TypeScriptServiceConfiguration } from '../utils/configuration';
import { Disposable } from '../utils';
import { TsServerProcess, TsServerProcessKind } from './server';
import { TypeScriptVersionManager } from './manager';
import { memoize } from '../utils';

const defaultSize: number = 8192;
const contentLength: string = 'Content-Length: ';
const contentLengthSize: number = Buffer.byteLength(contentLength, 'utf8');
const blank: number = Buffer.from(' ', 'utf8')[0];
const backslashR: number = Buffer.from('\r', 'utf8')[0];
const backslashN: number = Buffer.from('\n', 'utf8')[0];

class ProtocolBuffer {
  private index: number = 0;
  private buffer: Buffer = Buffer.allocUnsafe(defaultSize);

  public append(data: string | Buffer): void {
    let toAppend: Buffer | null = null;
    if (Buffer.isBuffer(data)) {
      toAppend = data;
    } else {
      toAppend = Buffer.from(data, 'utf8');
    }
    if (this.buffer.length - this.index >= toAppend.length) {
      toAppend.copy(this.buffer, this.index, 0, toAppend.length);
    } else {
      const newSize = (Math.ceil((this.index + toAppend.length) / defaultSize) + 1) * defaultSize;
      if (this.index === 0) {
        this.buffer = Buffer.allocUnsafe(newSize);
        toAppend.copy(this.buffer, 0, 0, toAppend.length);
      } else {
        this.buffer = Buffer.concat([this.buffer.slice(0, this.index), toAppend], newSize);
      }
    }
    this.index += toAppend.length;
  }

  public tryReadContentLength(): number {
    let result = -1;
    let current = 0;
    while (current < this.index && (this.buffer[current] === blank || this.buffer[current] === backslashR || this.buffer[current] === backslashN)) {
      current++;
    }
    if (this.index < current + contentLengthSize) {
      return result;
    }
    current += contentLengthSize;
    const start = current;
    while (current < this.index && this.buffer[current] !== backslashR) {
      current++;
    }
    if (current + 3 >= this.index || this.buffer[current + 1] !== backslashN || this.buffer[current + 2] !== backslashR || this.buffer[current + 3] !== backslashN) {
      return result;
    }
    const data = this.buffer.toString('utf8', start, current);
    result = parseInt(data);
    this.buffer = this.buffer.slice(current + 4);
    this.index = this.index - (current + 4);
    return result;
  }

  public tryReadContent(length: number): string | null {
    if (this.index < length) {
      return null;
    }
    const result = this.buffer.toString('utf8', 0, length);
    let sourceStart = length;
    while (sourceStart < this.index && (this.buffer[sourceStart] === backslashR || this.buffer[sourceStart] === backslashN)) {
      sourceStart++;
    }
    this.buffer.copy(this.buffer, 0, sourceStart);
    this.index = this.index - sourceStart;
    return result;
  }
}

class Reader<T> extends Disposable {
  private readonly buffer: ProtocolBuffer = new ProtocolBuffer();
  private nextMessageLength: number = -1;

  public constructor(readable: Readable) {
    super();
    readable.on('data', (data) => this.onLengthData(data));
  }

  private readonly _onError = this._register(new qv.EventEmitter<Error>());
  public readonly onError = this._onError.event;

  private readonly _onData = this._register(new qv.EventEmitter<T>());
  public readonly onData = this._onData.event;

  private onLengthData(data: Buffer | string): void {
    if (this.isDisposed) {
      return;
    }

    try {
      this.buffer.append(data);
      while (true) {
        if (this.nextMessageLength === -1) {
          this.nextMessageLength = this.buffer.tryReadContentLength();
          if (this.nextMessageLength === -1) {
            return;
          }
        }
        const msg = this.buffer.tryReadContent(this.nextMessageLength);
        if (msg === null) {
          return;
        }
        this.nextMessageLength = -1;
        const json = JSON.parse(msg);
        this._onData.fire(json);
      }
    } catch (e) {
      this._onError.fire(e);
    }
  }
}

export class ChildServerProcess extends Disposable implements TsServerProcess {
  private readonly _reader: Reader<qp.Response>;

  public static fork(
    tsServerPath: string,
    args: readonly string[],
    kind: TsServerProcessKind,
    configuration: TypeScriptServiceConfiguration,
    versionManager: TypeScriptVersionManager
  ): ChildServerProcess {
    if (!fs.existsSync(tsServerPath)) {
      qv.window.showWarningMessage('noServerFound');
      versionManager.reset();
      tsServerPath = versionManager.currentVersion.tsServerPath;
    }

    const childProcess = child_process.fork(tsServerPath, args, {
      silent: true,
      cwd: undefined,
      env: this.generatePatchedEnv(process.env, tsServerPath),
      execArgv: this.getExecArgv(kind, configuration),
    });

    return new ChildServerProcess(childProcess);
  }

  private static generatePatchedEnv(env: any, modulePath: string): any {
    const newEnv = Object.assign({}, env);

    newEnv['ELECTRON_RUN_AS_NODE'] = '1';
    newEnv['NODE_PATH'] = path.join(modulePath, '..', '..', '..');

    newEnv['PATH'] = newEnv['PATH'] || process.env.PATH;

    return newEnv;
  }

  private static getExecArgv(kind: TsServerProcessKind, configuration: TypeScriptServiceConfiguration): string[] {
    const args: string[] = [];

    const debugPort = this.getDebugPort(kind);
    if (debugPort) {
      const inspectFlag = ChildServerProcess.getTssDebugBrk() ? '--inspect-brk' : '--inspect';
      args.push(`${inspectFlag}=${debugPort}`);
    }

    if (configuration.maxTsServerMemory) {
      args.push(`--max-old-space-size=${configuration.maxTsServerMemory}`);
    }

    return args;
  }

  private static getDebugPort(kind: TsServerProcessKind): number | undefined {
    if (kind === TsServerProcessKind.Syntax) {
      return undefined;
    }
    const value = ChildServerProcess.getTssDebugBrk() || ChildServerProcess.getTssDebug();
    if (value) {
      const port = parseInt(value);
      if (!isNaN(port)) {
        return port;
      }
    }
    return undefined;
  }

  private static getTssDebug(): string | undefined {
    return process.env[qv.env.remoteName ? 'TSS_REMOTE_DEBUG' : 'TSS_DEBUG'];
  }

  private static getTssDebugBrk(): string | undefined {
    return process.env[qv.env.remoteName ? 'TSS_REMOTE_DEBUG_BRK' : 'TSS_DEBUG_BRK'];
  }

  private constructor(private readonly _process: child_process.ChildProcess) {
    super();
    this._reader = this._register(new Reader<qp.Response>(this._process.stdout!));
  }

  write(serverRequest: qp.Request): void {
    this._process.stdin!.write(JSON.stringify(serverRequest) + '\r\n', 'utf8');
  }

  onData(handler: (data: qp.Response) => void): void {
    this._reader.onData(handler);
  }

  onExit(handler: (code: number | null) => void): void {
    this._process.on('exit', handler);
  }

  onError(handler: (err: Error) => void): void {
    this._process.on('error', handler);
    this._reader.onError(handler);
  }

  kill(): void {
    this._process.kill();
    this._reader.dispose();
  }
}

declare const Worker: any;
declare type Worker = any;

export class WorkerServerProcess implements TsServerProcess {
  public static fork(tsServerPath: string, args: readonly string[], _kind: TsServerProcessKind, _configuration: TypeScriptServiceConfiguration) {
    const worker = new Worker(tsServerPath);
    return new WorkerServerProcess(worker, [...args, '--executingFilePath', tsServerPath]);
  }

  private _onDataHandlers = new Set<(data: qp.Response) => void>();
  private _onErrorHandlers = new Set<(err: Error) => void>();
  private _onExitHandlers = new Set<(code: number | null) => void>();

  public constructor(private readonly worker: Worker, args: readonly string[]) {
    worker.addEventListener('message', (msg: any) => {
      if (msg.data.type === 'log') {
        this.output.appendLine(msg.data.body);
        return;
      }
      for (const handler of this._onDataHandlers) {
        handler(msg.data);
      }
    });
    worker.postMessage(args);
  }

  @memoize
  private get output(): qv.OutputChannel {
    return qv.window.createOutputChannel('channelName');
  }

  write(serverRequest: qp.Request): void {
    this.worker.postMessage(serverRequest);
  }

  onData(handler: (response: qp.Response) => void): void {
    this._onDataHandlers.add(handler);
  }

  onError(handler: (err: Error) => void): void {
    this._onErrorHandlers.add(handler);
  }

  onExit(handler: (code: number | null) => void): void {
    this._onExitHandlers.add(handler);
  }

  kill(): void {
    this.worker.terminate();
  }
}