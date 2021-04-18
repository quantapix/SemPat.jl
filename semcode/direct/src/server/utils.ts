import { createDeferred } from './common/deferred';
import { LangServerBase, WorkspaceServiceInstance } from './base';
import * as qv from 'vscode';
import { ServerResponse } from '../server/service';
import type * as qp from '../server/proto';
import * as fs from 'fs';
import * as path from 'path';
import { memoize } from '../utils';
export enum RequestQueueType {
  Normal = 1,
  LowPriority = 2,
  Fence = 3,
}
export interface RequestItem {
  readonly request: qp.Request;
  readonly expectsResponse: boolean;
  readonly isAsync: boolean;
  readonly queueingType: RequestQueueType;
}
export class RequestQueue {
  private readonly queue: RequestItem[] = [];
  private sequenceNumber: number = 0;
  public get length(): number {
    return this.queue.length;
  }
  public enqueue(item: RequestItem): void {
    if (item.queueingType === RequestQueueType.Normal) {
      let index = this.queue.length - 1;
      while (index >= 0) {
        if (this.queue[index].queueingType !== RequestQueueType.LowPriority) break;
        --index;
      }
      this.queue.splice(index + 1, 0, item);
    } else {
      this.queue.push(item);
    }
  }
  public dequeue(): RequestItem | undefined {
    return this.queue.shift();
  }
  public tryDeletePendingRequest(seq: number): boolean {
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].request.seq === seq) {
        this.queue.splice(i, 1);
        return true;
      }
    }
    return false;
  }
  public createRequest(command: string, args: any): qp.Request {
    return {
      seq: this.sequenceNumber++,
      type: 'request',
      command: command,
      arguments: args,
    };
  }
}

type Resolve<T extends qp.Response> = () => Promise<ServerResponse.Response<T>>;
export class CachedResponse<T extends qp.Response> {
  private response?: Promise<ServerResponse.Response<T>>;
  private version: number = -1;
  private doc: string = '';
  public execute(d: qv.TextDocument, resolve: Resolve<T>): Promise<ServerResponse.Response<T>> {
    if (this.response && this.matches(d)) {
      return (this.response = this.response.then((result) => (result.type === 'cancelled' ? resolve() : result)));
    }
    return this.reset(d, resolve);
  }
  private matches(d: qv.TextDocument): boolean {
    return this.version === d.version && this.doc === d.uri.toString();
  }
  private async reset(d: qv.TextDocument, resolve: Resolve<T>): Promise<ServerResponse.Response<T>> {
    this.version = d.version;
    this.doc = d.uri.toString();
    return (this.response = resolve());
  }
}
export interface CallbackItem<R> {
  readonly onSuccess: (value: R) => void;
  readonly onError: (err: Error) => void;
  readonly queuingStartTime: number;
  readonly isAsync: boolean;
}
export class CallbackMap<R extends qp.Response> {
  private readonly _callbacks = new Map<number, CallbackItem<ServerResponse.Response<R> | undefined>>();
  private readonly _asyncCallbacks = new Map<number, CallbackItem<ServerResponse.Response<R> | undefined>>();
  public destroy(cause: string): void {
    const cancellation = new ServerResponse.Cancelled(cause);
    for (const callback of this._callbacks.values()) {
      callback.onSuccess(cancellation);
    }
    this._callbacks.clear();
    for (const callback of this._asyncCallbacks.values()) {
      callback.onSuccess(cancellation);
    }
    this._asyncCallbacks.clear();
  }
  public add(seq: number, cb: CallbackItem<ServerResponse.Response<R> | undefined>, isAsync: boolean) {
    if (isAsync) this._asyncCallbacks.set(seq, cb);
    else {
      this._callbacks.set(seq, cb);
    }
  }
  public fetch(seq: number): CallbackItem<ServerResponse.Response<R> | undefined> | undefined {
    const callback = this._callbacks.get(seq) || this._asyncCallbacks.get(seq);
    this.delete(seq);
    return callback;
  }
  private delete(seq: number) {
    if (!this._callbacks.delete(seq)) {
      this._asyncCallbacks.delete(seq);
    }
  }
}

export class WorkspaceMap extends Map<string, WorkspaceServiceInstance> {
  private _defaultWorkspacePath = '<default>';
  constructor(private _ls: LangServerBase) {
    super();
  }
  getNonDefaultWorkspaces(): WorkspaceServiceInstance[] {
    const workspaces: WorkspaceServiceInstance[] = [];
    this.forEach((workspace) => {
      if (workspace.rootPath) workspaces.push(workspace);
    });
    return workspaces;
  }
  getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
    let bestRootPath: string | undefined;
    let bestInstance: WorkspaceServiceInstance | undefined;
    this.forEach((workspace) => {
      if (workspace.rootPath) {
        if (filePath.startsWith(workspace.rootPath)) {
          if (bestRootPath === undefined || workspace.rootPath.startsWith(bestRootPath)) {
            bestRootPath = workspace.rootPath;
            bestInstance = workspace;
          }
        }
      }
    });
    if (bestInstance === undefined) {
      let defaultWorkspace = this.get(this._defaultWorkspacePath);
      if (!defaultWorkspace) {
        const workspaceNames = [...this.keys()];
        if (workspaceNames.length === 1) return this.get(workspaceNames[0])!;
        defaultWorkspace = {
          workspaceName: '',
          rootPath: '',
          rootUri: '',
          serviceInstance: this._ls.createAnalyzerService(this._defaultWorkspacePath),
          disableLangServices: false,
          disableOrganizeImports: false,
          isInitialized: createDeferred<boolean>(),
        };
        this.set(this._defaultWorkspacePath, defaultWorkspace);
        this._ls.updateSettingsForWorkspace(defaultWorkspace).ignoreErrors();
      }
      return defaultWorkspace;
    }
    return bestInstance;
  }
}
export interface LogDirProvider {
  getNewLogDir(): string | undefined;
}
export const noopLogDirProvider = new (class implements LogDirProvider {
  public getNewLogDir(): undefined {
    return undefined;
  }
})();
export class NodeLogDirProvider implements LogDirProvider {
  public constructor(private readonly context: qv.ExtensionContext) {}
  public getNewLogDir(): string | undefined {
    const root = this.logDir();
    if (root) {
      try {
        return fs.mkdtempSync(path.join(root, `tsserver-log-`));
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  }
  @memoize
  private logDir(): string | undefined {
    try {
      const path = this.context.logPath;
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path);
      }
      return this.context.logPath;
    } catch {
      return undefined;
    }
  }
}
