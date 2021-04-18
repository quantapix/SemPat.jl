import * as qv from 'vscode';
import type * as qp from './proto';
import { EventName } from '../utils/key';
import { CallbackMap } from './callback';
import { RequestItem, RequestQueue, RequestQueueType } from './request';
import { TsServerError } from './error';
import { ServerResponse, ServerType, TSRequests } from '../server/service';
import { TSServiceConfig } from '../utils/config';
import { Disposable } from '../utils/base';
import { TelemetryReporter } from '../utils/telemetry';
import Tracer from '../utils/tracer';
import { OngoingRequestCancel } from './cancel';
import { TsVersionMgr } from './manager';
import { TsVersion } from './version';
import { CancellationToken, CodeAction, CodeActionKind, CodeActionParams, Command, ExecuteCommandParams, WorkDoneProgressServerReporter } from 'vscode-languageserver/node';
import { isMainThread } from 'worker_threads';
import { AnalysisResults } from './analyzer/analysis';
import { isPythonBinary } from './analyzer/pythonPathUtils';
import { BackgroundAnalysis, BackgroundAnalysisRunner } from './backgroundAnalysis';
import { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CommandController } from './commands/commandController';
import { getCancellationFolderName } from './common/cancellationUtils';
import { LogLevel } from './common/console';
import { isDebugMode, isString } from './common/core';
import { convertUriToPath, resolvePaths } from './common/pathUtils';
import { ProgressReporter } from './common/progressReporter';
import { LangServerBase, ServerSettings, WorkspaceServiceInstance } from './languageServerBase';
import { CodeActionProvider } from './languageService/codeActionProvider';
import * as path from 'path';
import * as TurndownService from 'turndown';
import * as LSP from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Analyzer from './analyser';
import * as Builtins from './builtins';
import * as config from './config';
import Executables from './executables';
import { initializeParser } from './parser';
import * as ReservedWords from './reservedWords';
import { BashCompletionItem, CompletionItemDataType } from './types';
import { uniqueBasedOnHash } from './util/array';
import { getShellDocumentation } from './util/sh';

export enum ExecTarget {
  Semantic,
  Syntax,
}
export interface ITsServer {
  readonly onEvent: qv.Event<qp.Event>;
  readonly onExit: qv.Event<any>;
  readonly onError: qv.Event<any>;
  readonly tsServerLogFile: string | undefined;
  kill(): void;
  executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): undefined;
  executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined;
  dispose(): void;
}
export interface TsServerDelegate {
  onFatalError(command: string, error: Error): void;
}
export const enum TsServerProcKind {
  Main = 'main',
  Syntax = 'syntax',
  Semantic = 'semantic',
  Diags = 'diagnostics',
}
export interface TsServerProcFact {
  fork(tsServerPath: string, args: readonly string[], kind: TsServerProcKind, configuration: TSServiceConfig, versionMgr: TsVersionMgr): TsServerProc;
}
export interface TsServerProc {
  write(serverRequest: qp.Request): void;
  onData(handler: (data: qp.Response) => void): void;
  onExit(handler: (code: number | null) => void): void;
  onError(handler: (error: Error) => void): void;
  kill(): void;
}
export class ProcBasedTsServer extends Disposable implements ITsServer {
  private readonly _requestQueue = new RequestQueue();
  private readonly _callbacks = new CallbackMap<qp.Response>();
  private readonly _pendingResponses = new Set<number>();
  constructor(
    private readonly _serverId: string,
    private readonly _serverSource: ServerType,
    private readonly _process: TsServerProc,
    private readonly _tsServerLogFile: string | undefined,
    private readonly _requestCancel: OngoingRequestCancel,
    private readonly _version: TsVersion,
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
      if (this._requestCancel.tryCancelOngoingRequest(seq)) {
        return true;
      }
      this.logTrace(`Tried to cancel request with sequence number ${seq}. But request got already delivered.`);
      return false;
    } finally {
      const callback = this.fetchCallback(seq);
      if (callback) callback.onSuccess(new ServerResponse.Cancelled(`Cancelled request ${seq} - ${command}`));
    }
  }
  private dispatchResponse(response: qp.Response) {
    const callback = this.fetchCallback(response.request_seq);
    if (!callback) return;
    this._tracer.traceResponse(this._serverId, response, callback);
    if (response.success) callback.onSuccess(response);
    else if (response.message === 'No content available.') callback.onSuccess(ServerResponse.NoContent);
    else {
      callback.onError(TsServerError.create(this._serverId, this._version, response));
    }
  }
  public executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): undefined;
  public executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  public executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined {
    const request = this._requestQueue.createRequest(command, args);
    const requestInfo: RequestItem = {
      request,
      expectsResponse: executeInfo.expectsResult,
      isAsync: executeInfo.isAsync,
      queueingType: ProcBasedTsServer.getQueueingType(command, executeInfo.lowPriority),
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
        if (err instanceof TsServerError) {
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
      if (item) this.sendRequest(item);
    }
  }
  private sendRequest(requestItem: RequestItem): void {
    const serverRequest = requestItem.request;
    this._tracer.traceRequest(this._serverId, serverRequest, requestItem.expectsResponse, this._requestQueue.length);
    if (requestItem.expectsResponse && !requestItem.isAsync) this._pendingResponses.add(requestItem.request.seq);
    try {
      this.write(serverRequest);
    } catch (err) {
      const callback = this.fetchCallback(serverRequest.seq);
      if (callback) callback.onError(err);
    }
  }
  private fetchCallback(seq: number) {
    const callback = this._callbacks.fetch(seq);
    if (!callback) return undefined;
    this._pendingResponses.delete(seq);
    return callback;
  }
  private logTrace(message: string) {
    this._tracer.logTrace(this._serverId, message);
  }
  private static readonly fenceCommands = new Set(['change', 'close', 'open', 'updateOpen']);
  private static getQueueingType(command: string, lowPriority?: boolean): RequestQueueType {
    if (ProcBasedTsServer.fenceCommands.has(command)) {
      return RequestQueueType.Fence;
    }
    return lowPriority ? RequestQueueType.LowPriority : RequestQueueType.Normal;
  }
}
interface ExecInfo {
  readonly isAsync: boolean;
  readonly token?: qv.CancellationToken;
  readonly expectsResult: boolean;
  readonly lowPriority?: boolean;
  readonly executionTarget?: ExecTarget;
}
class RequestRouter {
  private static readonly sharedCommands = new Set<keyof TSRequests>(['change', 'close', 'open', 'updateOpen', 'configure']);
  constructor(
    private readonly servers: ReadonlyArray<{
      readonly server: ITsServer;
      canRun?(command: keyof TSRequests, executeInfo: ExecInfo): void;
    }>,
    private readonly delegate: TsServerDelegate
  ) {}
  public execute(command: keyof TSRequests, args: any, executeInfo: ExecInfo): Promise<ServerResponse.Response<qp.Response>> | undefined {
    if (RequestRouter.sharedCommands.has(command) && typeof executeInfo.executionTarget === 'undefined') {
      const requestStates: RequestState.State[] = this.servers.map(() => RequestState.Unresolved);
      let token: qv.CancellationToken | undefined = undefined;
      if (executeInfo.token) {
        const source = new qv.CancellationTokenSource();
        executeInfo.token.onCancellationRequested(() => {
          if (requestStates.some((state) => state === RequestState.Resolved)) return;
          source.cancel();
        });
        token = source.token;
      }
      let firstRequest: Promise<ServerResponse.Response<qp.Response>> | undefined;
      for (let serverIndex = 0; serverIndex < this.servers.length; ++serverIndex) {
        const server = this.servers[serverIndex].server;
        const request = server.executeImpl(command, args, { ...executeInfo, token }) as Promise<ServerResponse.Response<qp.Response>> | undefined;
        if (serverIndex === 0) firstRequest = request;
        if (request) {
          request.then(
            (result) => {
              requestStates[serverIndex] = RequestState.Resolved;
              const erroredRequest = requestStates.find((state) => state.type === RequestState.Type.Errored) as RequestState.Errored | undefined;
              if (erroredRequest) this.delegate.onFatalError(command, erroredRequest.err);
              return result;
            },
            (err) => {
              requestStates[serverIndex] = new RequestState.Errored(err);
              if (requestStates.some((state) => state === RequestState.Resolved)) {
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
export class GetErrRoutingTsServer extends Disposable implements ITsServer {
  private static readonly diagnosticEvents = new Set<string>([EventName.configFileDiag, EventName.syntaxDiag, EventName.semanticDiag, EventName.suggestionDiag]);
  private readonly getErrServer: ITsServer;
  private readonly mainServer: ITsServer;
  private readonly router: RequestRouter;
  public constructor(servers: { getErr: ITsServer; primary: ITsServer }, delegate: TsServerDelegate) {
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
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): undefined;
  public executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  public executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined {
    return this.router.execute(command, args, executeInfo);
  }
}
export class SyntaxRoutingTsServer extends Disposable implements ITsServer {
  private static readonly syntaxAlwaysCommands = new Set<keyof TSRequests>(['navtree', 'getOutliningSpans', 'jsxClosingTag', 'selectionRange', 'format', 'formatonkey', 'docCommentTemplate']);
  private static readonly semanticCommands = new Set<keyof TSRequests>(['geterr', 'geterrForProject', 'projectInfo', 'configurePlugin']);
  private static readonly syntaxAllowedCommands = new Set<keyof TSRequests>([
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
  private readonly syntaxServer: ITsServer;
  private readonly semanticServer: ITsServer;
  private readonly router: RequestRouter;
  private _projectLoading = true;
  public constructor(servers: { syntax: ITsServer; semantic: ITsServer }, delegate: TsServerDelegate, enableDynamicRouting: boolean) {
    super();
    this.syntaxServer = servers.syntax;
    this.semanticServer = servers.semantic;
    this.router = new RequestRouter(
      [
        {
          server: this.syntaxServer,
          canRun: (command, execInfo) => {
            switch (execInfo.executionTarget) {
              case ExecTarget.Semantic:
                return false;
              case ExecTarget.Syntax:
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
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): undefined;
  public executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
  ): Promise<ServerResponse.Response<qp.Response>>;
  public executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; executionTarget?: ExecTarget }
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
const maxAnalysisTimeInForeground = { openFilesTimeInMs: 50, noOpenFilesTimeInMs: 200 };
class PyrightServer extends LangServerBase {
  private _controller: CommandController;
  constructor() {
    const version = require('../package.json').version || '';
    const rootDir = (global as any).__rootDir || __dirname;
    super({
      productName: 'Pyright',
      rootDir,
      version,
      maxAnalysisTimeInForeground,
      supportedCodeActions: [CodeActionKind.QuickFix, CodeActionKind.SourceOrganizeImports],
    });
    this._controller = new CommandController(this);
  }
  async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings> {
    const serverSettings: ServerSettings = {
      watchForSourceChanges: true,
      watchForLibraryChanges: true,
      openFilesOnly: true,
      useLibraryCodeForTypes: false,
      disableLangServices: false,
      disableOrganizeImports: false,
      typeCheckingMode: 'basic',
      diagnosticSeverityOverrides: {},
      logLevel: LogLevel.Info,
      autoImportCompletions: true,
    };
    try {
      const pythonSection = await this.getConfig(workspace.rootUri, 'python');
      if (pythonSection) {
        const pythonPath = pythonSection.pythonPath;
        if (pythonPath && isString(pythonPath) && !isPythonBinary(pythonPath)) {
          serverSettings.pythonPath = resolvePaths(workspace.rootPath, this.expandPathVariables(workspace.rootPath, pythonPath));
        }
        const venvPath = pythonSection.venvPath;
        if (venvPath && isString(venvPath)) {
          serverSettings.venvPath = resolvePaths(workspace.rootPath, this.expandPathVariables(workspace.rootPath, venvPath));
        }
      }
      const pythonAnalysisSection = await this.getConfig(workspace.rootUri, 'python.analysis');
      if (pythonAnalysisSection) {
        const typeshedPaths = pythonAnalysisSection.typeshedPaths;
        if (typeshedPaths && Array.isArray(typeshedPaths) && typeshedPaths.length > 0) {
          const typeshedPath = typeshedPaths[0];
          if (typeshedPath && isString(typeshedPath)) {
            serverSettings.typeshedPath = resolvePaths(workspace.rootPath, this.expandPathVariables(workspace.rootPath, typeshedPath));
          }
        }
        const stubPath = pythonAnalysisSection.stubPath;
        if (stubPath && isString(stubPath)) {
          serverSettings.stubPath = resolvePaths(workspace.rootPath, this.expandPathVariables(workspace.rootPath, stubPath));
        }
        const diagnosticSeverityOverrides = pythonAnalysisSection.diagnosticSeverityOverrides;
        if (diagnosticSeverityOverrides) {
          for (const [name, value] of Object.entries(diagnosticSeverityOverrides)) {
            const ruleName = this.getDiagRuleName(name);
            const severity = this.getSeverityOverrides(value as string);
            if (ruleName && severity) serverSettings.diagnosticSeverityOverrides![ruleName] = severity!;
          }
        }
        if (pythonAnalysisSection.diagnosticMode !== undefined) serverSettings.openFilesOnly = this.isOpenFilesOnly(pythonAnalysisSection.diagnosticMode);
        else if (pythonAnalysisSection.openFilesOnly !== undefined) serverSettings.openFilesOnly = !!pythonAnalysisSection.openFilesOnly;
        if (pythonAnalysisSection.useLibraryCodeForTypes !== undefined) serverSettings.useLibraryCodeForTypes = !!pythonAnalysisSection.useLibraryCodeForTypes;
        serverSettings.logLevel = this.convertLogLevel(pythonAnalysisSection.logLevel);
        serverSettings.autoSearchPaths = !!pythonAnalysisSection.autoSearchPaths;
        const extraPaths = pythonAnalysisSection.extraPaths;
        if (extraPaths && Array.isArray(extraPaths) && extraPaths.length > 0) {
          serverSettings.extraPaths = extraPaths.filter((p) => p && isString(p)).map((p) => resolvePaths(workspace.rootPath, this.expandPathVariables(workspace.rootPath, p)));
        }
        if (pythonAnalysisSection.typeCheckingMode !== undefined) serverSettings.typeCheckingMode = pythonAnalysisSection.typeCheckingMode;
        if (pythonAnalysisSection.autoImportCompletions !== undefined) serverSettings.autoImportCompletions = pythonAnalysisSection.autoImportCompletions;
        if (serverSettings.logLevel === LogLevel.Log && pythonAnalysisSection.logTypeEvaluationTime !== undefined) serverSettings.logTypeEvaluationTime = pythonAnalysisSection.logTypeEvaluationTime;
        if (pythonAnalysisSection.typeEvaluationTimeThreshold !== undefined) serverSettings.typeEvaluationTimeThreshold = pythonAnalysisSection.typeEvaluationTimeThreshold;
      } else {
        serverSettings.autoSearchPaths = true;
      }
      const pyrightSection = await this.getConfig(workspace.rootUri, 'pyright');
      if (pyrightSection) {
        if (pyrightSection.openFilesOnly !== undefined) {
          serverSettings.openFilesOnly = !!pyrightSection.openFilesOnly;
        }
        if (pyrightSection.useLibraryCodeForTypes !== undefined) serverSettings.useLibraryCodeForTypes = !!pyrightSection.useLibraryCodeForTypes;
        serverSettings.disableLangServices = !!pyrightSection.disableLangServices;
        serverSettings.disableOrganizeImports = !!pyrightSection.disableOrganizeImports;
        const typeCheckingMode = pyrightSection.typeCheckingMode;
        if (typeCheckingMode && isString(typeCheckingMode)) {
          serverSettings.typeCheckingMode = typeCheckingMode;
        }
      }
    } catch (error) {
      this.console.error(`Error reading settings: ${error}`);
    }
    return serverSettings;
  }
  createBackgroundAnalysis(): BackgroundAnalysisBase | undefined {
    if (isDebugMode() || !getCancellationFolderName()) {
      return undefined;
    }
    return new BackgroundAnalysis(this.console);
  }
  protected executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
    return this._controller.execute(params, token);
  }
  protected isLongRunningCommand(command: string): boolean {
    return this._controller.isLongRunningCommand(command);
  }
  protected async executeCodeAction(params: CodeActionParams, token: CancellationToken): Promise<(Command | CodeAction)[] | undefined | null> {
    this.recordUserInteractionTime();
    const filePath = convertUriToPath(this.fs, params.textDocument.uri);
    const workspace = await this.getWorkspaceForFile(filePath);
    return CodeActionProvider.getCodeActionsForPosition(workspace, filePath, params.range, token);
  }
  protected createProgressReporter(): ProgressReporter {
    let workDoneProgress: Promise<WorkDoneProgressServerReporter> | undefined;
    return {
      isEnabled: (data: AnalysisResults) => true,
      begin: () => {
        if (this.client.hasWindowProgressCapability) {
          workDoneProgress = this._connection.window.createWorkDoneProgress();
          workDoneProgress
            .then((progress) => {
              progress.begin('');
            })
            .ignoreErrors();
        } else {
          this._connection.sendNotification('pyright/beginProgress');
        }
      },
      report: (message: string) => {
        if (workDoneProgress) {
          workDoneProgress
            .then((progress) => {
              progress.report(message);
            })
            .ignoreErrors();
        } else {
          this._connection.sendNotification('pyright/reportProgress', message);
        }
      },
      end: () => {
        if (workDoneProgress) {
          workDoneProgress
            .then((progress) => {
              progress.done();
            })
            .ignoreErrors();
          workDoneProgress = undefined;
        } else {
          this._connection.sendNotification('pyright/endProgress');
        }
      },
    };
  }
}
function main() {
  if (process.env.NODE_ENV === 'production') require('source-map-support').install();
  if (isMainThread) new PyrightServer();
  else {
    const runner = new BackgroundAnalysisRunner();
    runner.start();
  }
}
main();
const PARAMETER_EXPANSION_PREFIXES = new Set(['$', '${']);
export default class BashServer {
  public static async initialize(connection: LSP.Connection, { rootPath }: LSP.InitializeParams): Promise<BashServer> {
    const parser = await initializeParser();
    const { PATH } = process.env;
    if (!PATH) throw new Error('Expected PATH environment variable to be set');
    return Promise.all([Executables.fromPath(PATH), Analyzer.fromRoot({ connection, rootPath, parser })]).then((xs) => {
      const executables = xs[0];
      const analyzer = xs[1];
      return new BashServer(connection, executables, analyzer);
    });
  }
  private executables: Executables;
  private analyzer: Analyzer;
  private documents: LSP.TextDocuments<TextDocument> = new LSP.TextDocuments(TextDocument);
  private connection: LSP.Connection;
  private constructor(connection: LSP.Connection, executables: Executables, analyzer: Analyzer) {
    this.connection = connection;
    this.executables = executables;
    this.analyzer = analyzer;
  }
  public register(connection: LSP.Connection): void {
    this.documents.listen(this.connection);
    this.documents.onDidChangeContent((change) => {
      const { uri } = change.document;
      const diagnostics = this.analyzer.analyze(uri, change.document);
      if (config.getHighlightParsingError()) {
        connection.sendDiags({
          uri: change.document.uri,
          diagnostics,
        });
      }
    });
    connection.onHover(this.onHover.bind(this));
    connection.onDefinition(this.onDefinition.bind(this));
    connection.onDocumentSymbol(this.onDocumentSymbol.bind(this));
    connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this));
    connection.onDocumentHighlight(this.onDocumentHighlight.bind(this));
    connection.onReferences(this.onReferences.bind(this));
    connection.onCompletion(this.onCompletion.bind(this));
    connection.onCompletionResolve(this.onCompletionResolve.bind(this));
  }
  public capabilities(): LSP.ServerCapabilities {
    return {
      textDocumentSync: LSP.TextDocumentSyncKind.Full,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['$', '{'],
      },
      hoverProvider: true,
      documentHighlightProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      referencesProvider: true,
    };
  }
  private getWordAtPoint(params: LSP.ReferenceParams | LSP.TextDocumentPositionParams): string | null {
    return this.analyzer.wordAtPoint(params.textDocument.uri, params.position.line, params.position.character);
  }
  private logRequest({ request, params, word }: { request: string; params: LSP.ReferenceParams | LSP.TextDocumentPositionParams; word?: string | null }) {
    const wordLog = word ? `"${word}"` : 'null';
    this.connection.console.log(`${request} ${params.position.line}:${params.position.character} word=${wordLog}`);
  }
  private getDocumentationForSymbol({ currentUri, symbol }: { symbol: LSP.SymbolInformation; currentUri: string }): string {
    const symbolUri = symbol.location.uri;
    const symbolStarLine = symbol.location.range.start.line;
    const commentAboveSymbol = this.analyzer.commentsAbove(symbolUri, symbolStarLine);
    const symbolDocumentation = commentAboveSymbol ? `\n\n${commentAboveSymbol}` : '';
    return symbolUri !== currentUri
      ? `${symbolKindToDescription(symbol.kind)} defined in ${path.relative(currentUri, symbolUri)}${symbolDocumentation}`
      : `${symbolKindToDescription(symbol.kind)} defined on line ${symbolStarLine + 1}${symbolDocumentation}`;
  }
  private getCompletionItemsForSymbols({ symbols, currentUri }: { symbols: LSP.SymbolInformation[]; currentUri: string }): BashCompletionItem[] {
    return deduplicateSymbols({ symbols, currentUri }).map((symbol: LSP.SymbolInformation) => ({
      label: symbol.name,
      kind: symbolKindToCompletionKind(symbol.kind),
      data: {
        name: symbol.name,
        type: CompletionItemDataType.Symbol,
      },
      documentation:
        symbol.location.uri !== currentUri
          ? this.getDocumentationForSymbol({
              currentUri,
              symbol,
            })
          : undefined,
    }));
  }
  private async onHover(params: LSP.TextDocumentPositionParams): Promise<LSP.Hover | null> {
    const word = this.getWordAtPoint(params);
    const currentUri = params.textDocument.uri;
    this.logRequest({ request: 'onHover', params, word });
    if (!word || word.startsWith('#')) {
      return null;
    }
    const explainshellEndpoint = config.getExplainshellEndpoint();
    if (explainshellEndpoint) {
      this.connection.console.log(`Query ${explainshellEndpoint}`);
      try {
        const response = await this.analyzer.getExplainshellDocumentation({
          params,
          endpoint: explainshellEndpoint,
        });
        if (response.status === 'error') this.connection.console.log(`getExplainshellDocumentation returned: ${JSON.stringify(response, null, 4)}`);
        else {
          return {
            contents: {
              kind: 'markdown',
              value: new TurndownService().turndown(response.helpHTML),
            },
          };
        }
      } catch (error) {
        this.connection.console.warn(`getExplainshellDocumentation exception: ${error.message}`);
      }
    }
    if (ReservedWords.isReservedWord(word) || Builtins.isBuiltin(word) || this.executables.isExecutableOnPATH(word)) {
      const shellDocumentation = await getShellDocumentation({ word });
      if (shellDocumentation) return { contents: getMarkdownContent(shellDocumentation) };
    } else {
      const symbolDocumentation = deduplicateSymbols({
        symbols: this.analyzer.findSymbolsMatchingWord({
          exactMatch: true,
          word,
        }),
        currentUri,
      })
        .filter((symbol) => symbol.location.range.start.line !== params.position.line)
        .map((symbol: LSP.SymbolInformation) => this.getDocumentationForSymbol({ currentUri, symbol }));
      if (symbolDocumentation.length === 1) return { contents: symbolDocumentation[0] };
    }
    return null;
  }
  private onDefinition(params: LSP.TextDocumentPositionParams): LSP.Definition | null {
    const word = this.getWordAtPoint(params);
    this.logRequest({ request: 'onDefinition', params, word });
    if (!word) return null;
    return this.analyzer.findDefinition(word);
  }
  private onDocumentSymbol(params: LSP.DocumentSymbolParams): LSP.SymbolInformation[] {
    this.connection.console.log(`onDocumentSymbol`);
    return this.analyzer.findSymbolsForFile({ uri: params.textDocument.uri });
  }
  private onWorkspaceSymbol(params: LSP.WorkspaceSymbolParams): LSP.SymbolInformation[] {
    this.connection.console.log('onWorkspaceSymbol');
    return this.analyzer.search(params.query);
  }
  private onDocumentHighlight(params: LSP.TextDocumentPositionParams): LSP.DocumentHighlight[] | null {
    const word = this.getWordAtPoint(params);
    this.logRequest({ request: 'onDocumentHighlight', params, word });
    if (!word) return [];
    return this.analyzer.findOccurrences(params.textDocument.uri, word).map((n) => ({ range: n.range }));
  }
  private onReferences(params: LSP.ReferenceParams): LSP.Location[] | null {
    const word = this.getWordAtPoint(params);
    this.logRequest({ request: 'onReferences', params, word });
    if (!word) return null;
    return this.analyzer.findReferences(word);
  }
  private onCompletion(params: LSP.TextDocumentPositionParams): BashCompletionItem[] {
    const word = this.getWordAtPoint({
      ...params,
      position: {
        line: params.position.line,
        // Go one character back to get completion on the current word
        character: Math.max(params.position.character - 1, 0),
      },
    });
    this.logRequest({ request: 'onCompletion', params, word });
    if (word && word.startsWith('#')) {
      // Inside a comment block
      return [];
    }
    if (word && word === '{') return [];
    const currentUri = params.textDocument.uri;
    const shouldCompleteOnVariables = word ? PARAMETER_EXPANSION_PREFIXES.has(word) : false;
    const symbolCompletions =
      word === null
        ? []
        : this.getCompletionItemsForSymbols({
            symbols: shouldCompleteOnVariables
              ? this.analyzer.getAllVariableSymbols()
              : this.analyzer.findSymbolsMatchingWord({
                  exactMatch: false,
                  word,
                }),
            currentUri,
          });
    if (shouldCompleteOnVariables) return symbolCompletions;
    const reservedWordsCompletions = ReservedWords.LIST.map((reservedWord) => ({
      label: reservedWord,
      kind: LSP.SymbolKind.Interface, // ??
      data: {
        name: reservedWord,
        type: CompletionItemDataType.ReservedWord,
      },
    }));
    const programCompletions = this.executables
      .list()
      .filter((executable) => !Builtins.isBuiltin(executable))
      .map((executable) => {
        return {
          label: executable,
          kind: LSP.SymbolKind.Function,
          data: {
            name: executable,
            type: CompletionItemDataType.Executable,
          },
        };
      });
    const builtinsCompletions = Builtins.LIST.map((builtin) => ({
      label: builtin,
      kind: LSP.SymbolKind.Interface, // ??
      data: {
        name: builtin,
        type: CompletionItemDataType.Builtin,
      },
    }));
    const allCompletions = [...reservedWordsCompletions, ...symbolCompletions, ...programCompletions, ...builtinsCompletions];
    if (word) return allCompletions.filter((item) => item.label.startsWith(word));
    return allCompletions;
  }
  private async onCompletionResolve(item: LSP.CompletionItem): Promise<LSP.CompletionItem> {
    const {
      data: { name, type },
    } = item as BashCompletionItem;
    this.connection.console.log(`onCompletionResolve name=${name} type=${type}`);
    try {
      let documentation = null;
      if (type === CompletionItemDataType.Executable || type === CompletionItemDataType.Builtin || type === CompletionItemDataType.ReservedWord) {
        documentation = await getShellDocumentation({ word: name });
      }
      return documentation
        ? {
            ...item,
            documentation: getMarkdownContent(documentation),
          }
        : item;
    } catch (error) {
      return item;
    }
  }
}
function deduplicateSymbols({ symbols, currentUri }: { symbols: LSP.SymbolInformation[]; currentUri: string }) {
  const isCurrentFile = ({ location: { uri } }: LSP.SymbolInformation) => uri === currentUri;
  const getSymbolId = ({ name, kind }: LSP.SymbolInformation) => `${name}${kind}`;
  const symbolsCurrentFile = symbols.filter((s) => isCurrentFile(s));
  const symbolsOtherFiles = symbols
    .filter((s) => !isCurrentFile(s))
    .filter((symbolOtherFiles) => !symbolsCurrentFile.some((symbolCurrentFile) => getSymbolId(symbolCurrentFile) === getSymbolId(symbolOtherFiles)));
  return uniqueBasedOnHash([...symbolsCurrentFile, ...symbolsOtherFiles], getSymbolId);
}
function symbolKindToCompletionKind(s: LSP.SymbolKind): LSP.CompletionItemKind {
  switch (s) {
    case LSP.SymbolKind.File:
      return LSP.CompletionItemKind.File;
    case LSP.SymbolKind.Module:
    case LSP.SymbolKind.Namespace:
    case LSP.SymbolKind.Package:
      return LSP.CompletionItemKind.Module;
    case LSP.SymbolKind.Class:
      return LSP.CompletionItemKind.Class;
    case LSP.SymbolKind.Method:
      return LSP.CompletionItemKind.Method;
    case LSP.SymbolKind.Property:
      return LSP.CompletionItemKind.Property;
    case LSP.SymbolKind.Field:
      return LSP.CompletionItemKind.Field;
    case LSP.SymbolKind.Constructor:
      return LSP.CompletionItemKind.Constructor;
    case LSP.SymbolKind.Enum:
      return LSP.CompletionItemKind.Enum;
    case LSP.SymbolKind.Interface:
      return LSP.CompletionItemKind.Interface;
    case LSP.SymbolKind.Function:
      return LSP.CompletionItemKind.Function;
    case LSP.SymbolKind.Variable:
      return LSP.CompletionItemKind.Variable;
    case LSP.SymbolKind.Constant:
      return LSP.CompletionItemKind.Constant;
    case LSP.SymbolKind.String:
    case LSP.SymbolKind.Number:
    case LSP.SymbolKind.Boolean:
    case LSP.SymbolKind.Array:
    case LSP.SymbolKind.Key:
    case LSP.SymbolKind.Null:
      return LSP.CompletionItemKind.Text;
    case LSP.SymbolKind.Object:
      return LSP.CompletionItemKind.Module;
    case LSP.SymbolKind.EnumMember:
      return LSP.CompletionItemKind.EnumMember;
    case LSP.SymbolKind.Struct:
      return LSP.CompletionItemKind.Struct;
    case LSP.SymbolKind.Event:
      return LSP.CompletionItemKind.Event;
    case LSP.SymbolKind.Operator:
      return LSP.CompletionItemKind.Operator;
    case LSP.SymbolKind.TypeParameter:
      return LSP.CompletionItemKind.TypeParameter;
    default:
      return LSP.CompletionItemKind.Text;
  }
}
function symbolKindToDescription(s: LSP.SymbolKind): string {
  switch (s) {
    case LSP.SymbolKind.Function:
      return 'Function';
    case LSP.SymbolKind.Variable:
      return 'Variable';
    default:
      return 'Keyword';
  }
}
const getMarkdownContent = (documentation: string): LSP.MarkupContent => ({
  value: ['``` man', documentation, '```'].join('\n'),
  kind: 'markdown' as const,
});
const pkg = require('../package');
export function listen() {
  const connection: LSP.IConnection = LSP.createConnection(new LSP.StreamMessageReader(process.stdin), new LSP.StreamMessageWriter(process.stdout));
  connection.onInitialize(
    async (params: LSP.InitializeParams): Promise<LSP.InitializeResult> => {
      connection.console.log(`Initialized server v. ${pkg.version} for ${params.rootUri}`);
      const server = await BashServer.initialize(connection, params);
      server.register(connection);
      return {
        capabilities: server.capabilities(),
      };
    }
  );
  connection.listen();
}
