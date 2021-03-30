import * as qv from 'vscode';
import type * as qp from '../protocol';
import { EventName } from '../../../src/protocol.const';
import { CallbackMap } from './callback';
import { RequestItem, RequestQueue, RequestQueueingType } from './request';
import { TypeScriptServerError } from '../tsServer/serverError';
import { ServerResponse, ServerType, TypeScriptRequests } from '../service';
import { TypeScriptServiceConfiguration } from '../utils/configuration';
import { Disposable } from '../utils/dispose';
import { TelemetryReporter } from '../utils/telemetry';
import Tracer from '../utils/tracer';
import { OngoingRequestCanceller } from './cancellation';
import { TypeScriptVersionManager } from './manager';
import { TypeScriptVersion } from './version';

export enum ExecutionTarget {
  Semantic,
  Syntax,
}

export interface ITypeScriptServer {
  readonly onEvent: qv.Event<qp.Event>;
  readonly onExit: qv.Event<any>;
  readonly onError: qv.Event<any>;

  readonly tsServerLogFile: string | undefined;

  kill(): void;

  executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): undefined;
  executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined;

  dispose(): void;
}

export interface TsServerDelegate {
  onFatalError(command: string, error: Error): void;
}

export const enum TsServerProcessKind {
  Main = 'main',
  Syntax = 'syntax',
  Semantic = 'semantic',
  Diagnostics = 'diagnostics',
}

export interface TsServerProcessFactory {
  fork(tsServerPath: string, args: readonly string[], kind: TsServerProcessKind, configuration: TypeScriptServiceConfiguration, versionManager: TypeScriptVersionManager): TsServerProcess;
}

export interface TsServerProcess {
  write(serverRequest: qp.Request): void;
  onData(handler: (data: qp.Response) => void): void;
  onExit(handler: (code: number | null) => void): void;
  onError(handler: (error: Error) => void): void;
  kill(): void;
}

export class ProcessBasedTsServer extends Disposable implements ITypeScriptServer {
  private readonly _requestQueue = new RequestQueue();
  private readonly _callbacks = new CallbackMap<qp.Response>();
  private readonly _pendingResponses = new Set<number>();

  constructor(
    private readonly _serverId: string,
    private readonly _serverSource: ServerType,
    private readonly _process: TsServerProcess,
    private readonly _tsServerLogFile: string | undefined,
    private readonly _requestCanceller: OngoingRequestCanceller,
    private readonly _version: TypeScriptVersion,
    private readonly _telemetryReporter: TelemetryReporter,
    private readonly _tracer: Tracer
  ) {
    super();
    this._process.onData((msg) => {
      this.dispatchMessage(msg);
    });
    this._process.onExit((code) => {
      this._onExit.fire(code);
      this._callbacks.destroy('server exited');
    });
    this._process.onError((error) => {
      this._onError.fire(error);
      this._callbacks.destroy('server errored');
    });
  }

  private readonly _onEvent = this._register(new qv.EventEmitter<qp.Event>());
  public readonly onEvent = this._onEvent.event;

  private readonly _onExit = this._register(new qv.EventEmitter<any>());
  public readonly onExit = this._onExit.event;

  private readonly _onError = this._register(new qv.EventEmitter<any>());
  public readonly onError = this._onError.event;

  public get tsServerLogFile() {
    return this._tsServerLogFile;
  }

  private write(serverRequest: qp.Request) {
    this._process.write(serverRequest);
  }

  public dispose() {
    super.dispose();
    this._callbacks.destroy('server disposed');
    this._pendingResponses.clear();
  }

  public kill() {
    this._process.kill();
  }

  private dispatchMessage(message: qp.Message) {
    try {
      switch (message.type) {
        case 'response':
          if (this._serverSource) {
            this.dispatchResponse({
              ...(message as qp.Response),
              _serverType: this._serverSource,
            });
          } else {
            this.dispatchResponse(message as qp.Response);
          }
          break;
        case 'event':
          const event = message as qp.Event;
          if (event.event === 'requestCompleted') {
            const seq = (event as qp.RequestCompletedEvent).body.request_seq;
            const callback = this._callbacks.fetch(seq);
            if (callback) {
              this._tracer.traceRequestCompleted(this._serverId, 'requestCompleted', seq, callback);
              callback.onSuccess(undefined);
            }
          } else {
            this._tracer.traceEvent(this._serverId, event);
            this._onEvent.fire(event);
          }
          break;
        default:
          throw new Error(`Unknown message type ${message.type} received`);
      }
    } finally {
      this.sendNextRequests();
    }
  }

  private tryCancelRequest(seq: number, command: string): boolean {
    try {
      if (this._requestQueue.tryDeletePendingRequest(seq)) {
        this.logTrace(`Canceled request with sequence number ${seq}`);
        return true;
      }
      if (this._requestCanceller.tryCancelOngoingRequest(seq)) {
        return true;
      }
      this.logTrace(`Tried to cancel request with sequence number ${seq}. But request got already delivered.`);
      return false;
    } finally {
      const callback = this.fetchCallback(seq);
      if (callback) {
        callback.onSuccess(new ServerResponse.Cancelled(`Cancelled request ${seq} - ${command}`));
      }
    }
  }

  private dispatchResponse(response: qp.Response) {
    const callback = this.fetchCallback(response.request_seq);
    if (!callback) {
      return;
    }
    this._tracer.traceResponse(this._serverId, response, callback);
    if (response.success) {
      callback.onSuccess(response);
    } else if (response.message === 'No content available.') {
      callback.onSuccess(ServerResponse.NoContent);
    } else {
      callback.onError(TypeScriptServerError.create(this._serverId, this._version, response));
    }
  }

  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): undefined;
  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined {
    const request = this._requestQueue.createRequest(command, args);
    const requestInfo: RequestItem = {
      request,
      expectsResponse: executeInfo.expectsResult,
      isAsync: executeInfo.isAsync,
      queueingType: ProcessBasedTsServer.getQueueingType(command, executeInfo.lowPriority),
    };
    let result: Promise<ServerResponse.Response<qp.Response>> | undefined;
    if (executeInfo.expectsResult) {
      result = new Promise<ServerResponse.Response<qp.Response>>((resolve, reject) => {
        this._callbacks.add(
          request.seq,
          { onSuccess: resolve as () => ServerResponse.Response<qp.Response> | undefined, onError: reject, queuingStartTime: Date.now(), isAsync: executeInfo.isAsync },
          executeInfo.isAsync
        );

        if (executeInfo.token) {
          executeInfo.token.onCancellationRequested(() => {
            this.tryCancelRequest(request.seq, command);
          });
        }
      }).catch((err: Error) => {
        if (err instanceof TypeScriptServerError) {
          if (!executeInfo.token || !executeInfo.token.isCancellationRequested) {
            /* __GDPR__
							"languageServiceErrorResponse" : {
								"${include}": [
									"${TypeScriptCommonProperties}",
									"${TypeScriptRequestErrorProperties}"
								]
							}
						*/
            this._telemetryReporter.logTelemetry('languageServiceErrorResponse', err.telemetry);
          }
        }
        throw err;
      });
    }
    this._requestQueue.enqueue(requestInfo);
    this.sendNextRequests();
    return result;
  }

  private sendNextRequests(): void {
    while (this._pendingResponses.size === 0 && this._requestQueue.length > 0) {
      const item = this._requestQueue.dequeue();
      if (item) {
        this.sendRequest(item);
      }
    }
  }

  private sendRequest(requestItem: RequestItem): void {
    const serverRequest = requestItem.request;
    this._tracer.traceRequest(this._serverId, serverRequest, requestItem.expectsResponse, this._requestQueue.length);
    if (requestItem.expectsResponse && !requestItem.isAsync) {
      this._pendingResponses.add(requestItem.request.seq);
    }
    try {
      this.write(serverRequest);
    } catch (err) {
      const callback = this.fetchCallback(serverRequest.seq);
      if (callback) {
        callback.onError(err);
      }
    }
  }

  private fetchCallback(seq: number) {
    const callback = this._callbacks.fetch(seq);
    if (!callback) {
      return undefined;
    }
    this._pendingResponses.delete(seq);
    return callback;
  }

  private logTrace(message: string) {
    this._tracer.logTrace(this._serverId, message);
  }

  private static readonly fenceCommands = new Set(['change', 'close', 'open', 'updateOpen']);

  private static getQueueingType(command: string, lowPriority?: boolean): RequestQueueingType {
    if (ProcessBasedTsServer.fenceCommands.has(command)) {
      return RequestQueueingType.Fence;
    }
    return lowPriority ? RequestQueueingType.LowPriority : RequestQueueingType.Normal;
  }
}

interface ExecuteInfo {
  readonly isAsync: boolean;
  readonly token?: qv.CancellationToken;
  readonly expectsResult: boolean;
  readonly lowPriority?: boolean;
  readonly executionTarget?: ExecutionTarget;
}

class RequestRouter {
  private static readonly sharedCommands = new Set<keyof TypeScriptRequests>(['change', 'close', 'open', 'updateOpen', 'configure']);

  constructor(
    private readonly servers: ReadonlyArray<{
      readonly server: ITypeScriptServer;
      canRun?(command: keyof TypeScriptRequests, executeInfo: ExecuteInfo): void;
    }>,
    private readonly delegate: TsServerDelegate
  ) {}

  public execute(command: keyof TypeScriptRequests, args: any, executeInfo: ExecuteInfo): Promise<ServerResponse.Response<qp.Response>> | undefined {
    if (RequestRouter.sharedCommands.has(command) && typeof executeInfo.executionTarget === 'undefined') {
      const requestStates: RequestState.State[] = this.servers.map(() => RequestState.Unresolved);
      let token: qv.CancellationToken | undefined = undefined;
      if (executeInfo.token) {
        const source = new qv.CancellationTokenSource();
        executeInfo.token.onCancellationRequested(() => {
          if (requestStates.some((state) => state === RequestState.Resolved)) {
            return;
          }
          source.cancel();
        });
        token = source.token;
      }
      let firstRequest: Promise<ServerResponse.Response<qp.Response>> | undefined;
      for (let serverIndex = 0; serverIndex < this.servers.length; ++serverIndex) {
        const server = this.servers[serverIndex].server;
        const request = server.executeImpl(command, args, { ...executeInfo, token }) as Promise<ServerResponse.Response<qp.Response>> | undefined;
        if (serverIndex === 0) {
          firstRequest = request;
        }
        if (request) {
          request.then(
            (result) => {
              requestStates[serverIndex] = RequestState.Resolved;
              const erroredRequest = requestStates.find((state) => state.type === RequestState.Type.Errored) as RequestState.Errored | undefined;
              if (erroredRequest) {
                this.delegate.onFatalError(command, erroredRequest.err);
              }
              return result;
            },
            (err) => {
              requestStates[serverIndex] = new RequestState.Errored(err);
              if (requestStates.some((state) => state === RequestState.Resolved)) {
                // We've gone out of sync
                this.delegate.onFatalError(command, err);
              }
              throw err;
            }
          );
        }
      }
      return firstRequest;
    }
    for (const { canRun, server } of this.servers) {
      if (!canRun || canRun(command, executeInfo)) {
        return server.executeImpl(command, args, executeInfo);
      }
    }
    throw new Error(`Could not find server for command: '${command}'`);
  }
}

export class GetErrRoutingTsServer extends Disposable implements ITypeScriptServer {
  private static readonly diagnosticEvents = new Set<string>([EventName.configFileDiag, EventName.syntaxDiag, EventName.semanticDiag, EventName.suggestionDiag]);

  private readonly getErrServer: ITypeScriptServer;
  private readonly mainServer: ITypeScriptServer;
  private readonly router: RequestRouter;

  public constructor(servers: { getErr: ITypeScriptServer; primary: ITypeScriptServer }, delegate: TsServerDelegate) {
    super();
    this.getErrServer = servers.getErr;
    this.mainServer = servers.primary;
    this.router = new RequestRouter(
      [
        { server: this.getErrServer, canRun: (command) => ['geterr', 'geterrForProject'].includes(command) },
        { server: this.mainServer, canRun: undefined /* gets all other commands */ },
      ],
      delegate
    );
    this._register(
      this.getErrServer.onEvent((e) => {
        if (GetErrRoutingTsServer.diagnosticEvents.has(e.event)) {
          this._onEvent.fire(e);
        }
      })
    );
    this._register(
      this.mainServer.onEvent((e) => {
        if (!GetErrRoutingTsServer.diagnosticEvents.has(e.event)) {
          this._onEvent.fire(e);
        }
      })
    );
    this._register(this.getErrServer.onError((e) => this._onError.fire(e)));
    this._register(this.mainServer.onError((e) => this._onError.fire(e)));
    this._register(
      this.mainServer.onExit((e) => {
        this._onExit.fire(e);
        this.getErrServer.kill();
      })
    );
  }

  private readonly _onEvent = this._register(new qv.EventEmitter<qp.Event>());
  public readonly onEvent = this._onEvent.event;

  private readonly _onExit = this._register(new qv.EventEmitter<any>());
  public readonly onExit = this._onExit.event;

  private readonly _onError = this._register(new qv.EventEmitter<any>());
  public readonly onError = this._onError.event;

  public get tsServerLogFile() {
    return this.mainServer.tsServerLogFile;
  }

  public kill(): void {
    this.getErrServer.kill();
    this.mainServer.kill();
  }

  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): undefined;
  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined {
    return this.router.execute(command, args, executeInfo);
  }
}

export class SyntaxRoutingTsServer extends Disposable implements ITypeScriptServer {
  private static readonly syntaxAlwaysCommands = new Set<keyof TypeScriptRequests>(['navtree', 'getOutliningSpans', 'jsxClosingTag', 'selectionRange', 'format', 'formatonkey', 'docCommentTemplate']);
  private static readonly semanticCommands = new Set<keyof TypeScriptRequests>(['geterr', 'geterrForProject', 'projectInfo', 'configurePlugin']);
  private static readonly syntaxAllowedCommands = new Set<keyof TypeScriptRequests>([
    'completions',
    'completionEntryDetails',
    'completionInfo',
    'definition',
    'definitionAndBoundSpan',
    'documentHighlights',
    'implementation',
    'navto',
    'quickinfo',
    'references',
    'rename',
    'signatureHelp',
  ]);

  private readonly syntaxServer: ITypeScriptServer;
  private readonly semanticServer: ITypeScriptServer;
  private readonly router: RequestRouter;

  private _projectLoading = true;

  public constructor(servers: { syntax: ITypeScriptServer; semantic: ITypeScriptServer }, delegate: TsServerDelegate, enableDynamicRouting: boolean) {
    super();

    this.syntaxServer = servers.syntax;
    this.semanticServer = servers.semantic;

    this.router = new RequestRouter(
      [
        {
          server: this.syntaxServer,
          canRun: (command, execInfo) => {
            switch (execInfo.executionTarget) {
              case ExecutionTarget.Semantic:
                return false;
              case ExecutionTarget.Syntax:
                return true;
            }
            if (SyntaxRoutingTsServer.syntaxAlwaysCommands.has(command)) {
              return true;
            }
            if (SyntaxRoutingTsServer.semanticCommands.has(command)) {
              return false;
            }
            if (enableDynamicRouting && this.projectLoading && SyntaxRoutingTsServer.syntaxAllowedCommands.has(command)) {
              return true;
            }
            return false;
          },
        },
        {
          server: this.semanticServer,
          canRun: undefined,
        },
      ],
      delegate
    );
    this._register(
      this.syntaxServer.onEvent((e) => {
        return this._onEvent.fire(e);
      })
    );
    this._register(
      this.semanticServer.onEvent((e) => {
        switch (e.event) {
          case EventName.projectLoadingStart:
            this._projectLoading = true;
            break;
          case EventName.projectLoadingFinish:
          case EventName.semanticDiag:
          case EventName.syntaxDiag:
          case EventName.suggestionDiag:
          case EventName.configFileDiag:
            this._projectLoading = false;
            break;
        }
        return this._onEvent.fire(e);
      })
    );
    this._register(
      this.semanticServer.onExit((e) => {
        this._onExit.fire(e);
        this.syntaxServer.kill();
      })
    );

    this._register(this.semanticServer.onError((e) => this._onError.fire(e)));
  }

  private get projectLoading() {
    return this._projectLoading;
  }

  private readonly _onEvent = this._register(new qv.EventEmitter<qp.Event>());
  public readonly onEvent = this._onEvent.event;

  private readonly _onExit = this._register(new qv.EventEmitter<any>());
  public readonly onExit = this._onExit.event;

  private readonly _onError = this._register(new qv.EventEmitter<any>());
  public readonly onError = this._onError.event;

  public get tsServerLogFile() {
    return this.semanticServer.tsServerLogFile;
  }

  public kill(): void {
    this.syntaxServer.kill();
    this.semanticServer.kill();
  }

  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): undefined;
  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  public executeImpl(
    command: keyof TypeScriptRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecutionTarget }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined {
    return this.router.execute(command, args, executeInfo);
  }
}

namespace RequestState {
  export const enum Type {
    Unresolved,
    Resolved,
    Errored,
  }
  export const Unresolved = { type: Type.Unresolved } as const;
  export const Resolved = { type: Type.Resolved } as const;
  export class Errored {
    readonly type = Type.Errored;
    constructor(public readonly err: Error) {}
  }
  export type State = typeof Unresolved | typeof Resolved | Errored;
}
