import { Subject } from 'await-notify';
import * as net from 'net';
import { join } from 'path';
import { uuid } from 'uuidv4';
import * as vscode from 'vscode';
import { InitializedEvent, Logger, logger, LoggingDebugSession, StoppedEvent, TerminatedEvent } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { createMessageConnection, Disposable, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { replStartDebugger } from './repl';
import { generatePipeName } from './utils';
import { NotificationType, RequestType, RequestType0 } from 'vscode-jsonrpc';
import * as packs from './packs';
import { getJuliaExePath } from './packs';
import { registerCommand } from './utils';

interface DisconnectResponseArguments {}
interface SetBreakpointsResponseArguments {
  breakpoints: DebugProtocol.Breakpoint[];
}
interface StackTraceResponseArguments {
  stackFrames: DebugProtocol.StackFrame[];
  totalFrames?: number;
}
interface SetExceptionBreakpointsResponseArguments {}
interface SetFunctionBreakpointsResponseArguments {
  breakpoints: DebugProtocol.Breakpoint[];
}
interface ScopesResponseArguments {
  scopes: DebugProtocol.Scope[];
}
interface SourceResponseArguments {
  content: string;
  mimeType?: string;
}
interface VariablesResponseArguments {
  variables: DebugProtocol.Variable[];
}
interface ContinueResponseArguments {
  allThreadsContinued?: boolean;
}
interface NextResponseArguments {}
interface StepInResponseArguments {}
interface StepInTargetsResponseArguments {
  targets: DebugProtocol.StepInTarget[];
}
interface StepOutResponseArguments {}
interface EvaluateResponseArguments {
  result: string;
  type?: string;
  presentationHint?: DebugProtocol.VariablePresentationHint;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  memoryReference?: string;
}
interface TerminateResponseArguments {}
interface ExceptionInfoResponseArguments {
  exceptionId: string;
  description?: string;
  breakMode: DebugProtocol.ExceptionBreakMode;
  details?: DebugProtocol.ExceptionDetails;
}
interface RestartFrameResponseArguments {}
interface SetVariableResponseArguments {
  value: string;
  type?: string;
  variablesReference?: number;
  namedVariables?: number;
  indexedVariables?: number;
}
interface StoppedArguments {
  reason: string;
  description?: string;
  threadId?: number;
  preserveFocusHint?: boolean;
  text?: string;
  allThreadsStopped?: boolean;
}
interface ThreadsResponseArguments {
  threads: DebugProtocol.Thread[];
}
interface BreakpointLocationsResponseArguments {
  breakpoints: DebugProtocol.BreakpointLocation[];
}

export const requestTypeDisconnect = new RequestType<DebugProtocol.DisconnectArguments, DisconnectResponseArguments, void>('disconnect');
export const requestTypeSetBreakpoints = new RequestType<DebugProtocol.SetBreakpointsArguments, SetBreakpointsResponseArguments, void>('setBreakpoints');
export const requestTypeSetExceptionBreakpoints = new RequestType<DebugProtocol.SetExceptionBreakpointsArguments, SetExceptionBreakpointsResponseArguments, void>('setExceptionBreakpoints');
export const requestTypeSetFunctionBreakpoints = new RequestType<DebugProtocol.SetFunctionBreakpointsArguments, SetFunctionBreakpointsResponseArguments, void>('setFunctionBreakpoints');
export const requestTypeStackTrace = new RequestType<DebugProtocol.StackTraceArguments, StackTraceResponseArguments, void>('stackTrace');
export const requestTypeScopes = new RequestType<DebugProtocol.ScopesArguments, ScopesResponseArguments, void>('scopes');
export const requestTypeSource = new RequestType<DebugProtocol.SourceArguments, SourceResponseArguments, void>('source');
export const requestTypeVariables = new RequestType<DebugProtocol.VariablesArguments, VariablesResponseArguments, void>('variables');
export const requestTypeContinue = new RequestType<DebugProtocol.ContinueArguments, ContinueResponseArguments, void>('continue');
export const requestTypeNext = new RequestType<DebugProtocol.NextArguments, NextResponseArguments, void>('next');
export const requestTypeStepIn = new RequestType<DebugProtocol.StepInArguments, StepInResponseArguments, void>('stepIn');
export const requestTypeStepInTargets = new RequestType<DebugProtocol.StepInTargetsArguments, StepInTargetsResponseArguments, void>('stepInTargets');
export const requestTypeStepOut = new RequestType<DebugProtocol.StepOutArguments, StepOutResponseArguments, void>('stepOut');
export const requestTypeEvaluate = new RequestType<DebugProtocol.EvaluateArguments, EvaluateResponseArguments, void>('evaluate');
export const requestTypeTerminate = new RequestType<DebugProtocol.TerminateArguments, TerminateResponseArguments, void>('terminate');
export const requestTypeExceptionInfo = new RequestType<DebugProtocol.ExceptionInfoArguments, ExceptionInfoResponseArguments, void>('exceptionInfo');
export const requestTypeRestartFrame = new RequestType<DebugProtocol.RestartFrameArguments, RestartFrameResponseArguments, void>('restartFrame');
export const requestTypeSetVariable = new RequestType<DebugProtocol.SetVariableArguments, SetVariableResponseArguments, void>('setVariable');
export const requestTypeThreads = new RequestType0<ThreadsResponseArguments, void>('threads');
export const requestTypeBreakpointLocations = new RequestType<DebugProtocol.BreakpointLocationsArguments, BreakpointLocationsResponseArguments, void>('breakpointLocations');
export const notifyTypeRun = new NotificationType<{ program: string }>('run');
export const notifyTypeDebug = new NotificationType<{ stopOnEntry: boolean; program: string }>('debug');
export const notifyTypeExec = new NotificationType<{ stopOnEntry: boolean; code: string; file: string }>('exec');
export const notifyTypeOurFinished = new NotificationType<void>('finished');
export const notifyTypeStopped = new NotificationType<StoppedArguments>('stopped');

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  program: string;
  stopOnEntry?: boolean;
  cwd?: string;
  juliaEnv?: string;
  trace?: boolean;
  args?: string[];
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
  code: string;
  file: string;
  stopOnEntry: boolean;
}

export class JuliaDebugSession extends LoggingDebugSession {
  private _configurationDone = new Subject();

  private _debuggeeTerminal: vscode.Terminal;
  private _connection: MessageConnection;
  private _debuggeeWrapperSocket: net.Socket;

  private _launchMode: boolean;
  private _launchedWithoutDebug: boolean;

  private _no_need_for_force_kill: boolean = false;

  public constructor(private context: vscode.ExtensionContext, private juliaPath: string) {
    super('julia-debug.txt');
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  protected async initializeRequest(r: DebugProtocol.InitializeResponse, _: DebugProtocol.InitializeRequestArguments): Promise<void> {
    r.body = r.body || {};
    r.body.supportsConfigurationDoneRequest = true;
    r.body.supportsFunctionBreakpoints = true;
    r.body.supportsEvaluateForHovers = true;
    r.body.supportsStepBack = false;
    r.body.supportsDataBreakpoints = false;
    r.body.supportsCompletionsRequest = false;
    r.body.supportsCancelRequest = false;
    r.body.supportsTerminateRequest = true;
    r.body.supportsBreakpointLocationsRequest = false;
    r.body.supportsConditionalBreakpoints = true;
    r.body.supportsHitConditionalBreakpoints = false;
    r.body.supportsLogPoints = false;
    r.body.supportsExceptionInfoRequest = true;
    r.body.supportsRestartFrame = true;
    r.body.supportsSetVariable = true;
    r.body.supportsStepInTargetsRequest = true;
    r.body.exceptionBreakpointFilters = [
      { filter: 'compilemode', label: 'Compiled Mode (experimental)', default: false },
      { filter: 'error', label: 'Uncaught Exceptions', default: true },
      { filter: 'throw', label: 'All Exceptions', default: false },
    ];
    this.sendResponse(r);
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
    super.configurationDoneRequest(response, args);
    this._configurationDone.notify();
  }

  protected ourFinishedEvent() {
    this._no_need_for_force_kill = true;
    this.sendEvent(new TerminatedEvent());
  }

  protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
    this._launchMode = false;
    const pn = generatePipeName(uuid(), 'vsc-jl-dbg');
    const connectedPromise = new Subject();
    const serverListeningPromise = new Subject();
    const server = net.createServer((socket) => {
      this._connection = createMessageConnection(new StreamMessageReader(socket), new StreamMessageWriter(socket));
      this._connection.onNotification(notifyTypeStopped, (params) => this.sendEvent(new StoppedEvent(params.reason, params.threadId, params.text)));
      this._connection.onNotification(notifyTypeOurFinished, () => this.ourFinishedEvent());
      this._connection.listen();
      connectedPromise.notify();
    });
    server.listen(pn, () => {
      serverListeningPromise.notify();
    });
    await serverListeningPromise.wait();
    replStartDebugger(pn);
    await connectedPromise.wait();
    this.sendEvent(new InitializedEvent());
    await this._configurationDone.wait();
    this._connection.sendNotification(notifyTypeExec, { stopOnEntry: args.stopOnEntry, code: args.code, file: args.file });
    this.sendResponse(response);
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
    this._launchMode = true;
    logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);
    const connectedPromise = new Subject();
    const serverListeningPromise = new Subject();
    const serverForWrapperPromise = new Subject();
    const pn = generatePipeName(uuid(), 'vsc-jl-dbg');
    const pnForWrapper = generatePipeName(uuid(), 'vsc-jl-dbgw');
    const server = net.createServer((socket) => {
      this._connection = createMessageConnection(new StreamMessageReader(socket), new StreamMessageWriter(socket));
      this._connection.onNotification(notifyTypeStopped, (params) => this.sendEvent(new StoppedEvent(params.reason, params.threadId, params.text)));
      this._connection.onNotification(notifyTypeOurFinished, () => this.ourFinishedEvent());
      this._connection.listen();
      connectedPromise.notify();
    });

    const serverForWrapper = net.createServer((socket) => {
      this._debuggeeWrapperSocket = socket;
    });

    serverForWrapper.listen(pnForWrapper, () => {
      serverForWrapperPromise.notify();
    });

    await serverForWrapperPromise.wait();

    server.listen(pn, () => {
      serverListeningPromise.notify();
    });

    await serverListeningPromise.wait();

    this._debuggeeTerminal = vscode.window.createTerminal({
      name: 'Julia Debugger',
      shellPath: this.juliaPath,
      shellArgs: ['--color=yes', '--startup-file=no', '--history-file=no', join(this.context.extensionPath, 'scripts', 'debugger', 'launch_wrapper.jl'), pn, pnForWrapper, args.cwd, args.juliaEnv, ''],
      env: {
        JL_ARGS: args.args ? args.args.map((i) => Buffer.from(i).toString('base64')).join(';') : '',
      },
    });
    this._debuggeeTerminal.show(false);
    const disposables: Array<Disposable> = [];
    vscode.window.onDidCloseTerminal(
      (terminal) => {
        if (terminal === this._debuggeeTerminal) {
          this.sendEvent(new TerminatedEvent());
          disposables.forEach((d) => d.dispose());
        }
      },
      this,
      disposables
    );

    await connectedPromise.wait();
    this.sendEvent(new InitializedEvent());
    await this._configurationDone.wait();
    this._launchedWithoutDebug = args.noDebug;
    if (args.noDebug) {
      this._connection.sendNotification(notifyTypeRun, { program: args.program });
    } else {
      this._connection.sendNotification(notifyTypeDebug, { stopOnEntry: args.stopOnEntry, program: args.program });
    }

    this.sendResponse(response);
  }

  protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
    if (this._launchedWithoutDebug) {
      this._debuggeeWrapperSocket.write('TERMINATE\n');
      this.sendEvent(new TerminatedEvent());
    } else {
      response.body = await this._connection.sendRequest(requestTypeTerminate, args);
    }
    this.sendResponse(response);
  }

  protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
    if (this._launchMode) {
      if (!this._no_need_for_force_kill) {
        this._debuggeeWrapperSocket.write('TERMINATE\n');
      }
    } else {
      response.body = await this._connection.sendRequest(requestTypeDisconnect, args);
    }

    this.sendResponse(response);
  }

  protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments) {
    try {
      response.body = await this._connection.sendRequest(requestTypeSetVariable, args);
    } catch (err) {
      response.success = false;
      response.message = err.message;
    }
    this.sendResponse(response);
  }

  protected async breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments) {
    response.body = await this._connection.sendRequest(requestTypeBreakpointLocations, args);
    this.sendResponse(response);
  }

  protected async threadsRequest(response: DebugProtocol.ThreadsResponse) {
    response.body = await this._connection.sendRequest(requestTypeThreads);
    this.sendResponse(response);
  }

  protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
    response.body = await this._connection.sendRequest(requestTypeSetBreakpoints, args);
    this.sendResponse(response);
  }

  protected async setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments) {
    response.body = await this._connection.sendRequest(requestTypeSetFunctionBreakpoints, args);
    this.sendResponse(response);
  }

  protected async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments) {
    response.body = await this._connection.sendRequest(requestTypeSetExceptionBreakpoints, args);
    this.sendResponse(response);
  }

  protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
    response.body = await this._connection.sendRequest(requestTypeContinue, args);
    this.sendResponse(response);
  }

  protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
    response.body = await this._connection.sendRequest(requestTypeNext, args);
    this.sendResponse(response);
  }

  protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {
    response.body = await this._connection.sendRequest(requestTypeStepIn, args);
    this.sendResponse(response);
  }
  protected async stepInTargetsRequest(response: DebugProtocol.StepInTargetsResponse, args: DebugProtocol.StepInTargetsArguments) {
    response.body = await this._connection.sendRequest(requestTypeStepInTargets, args);
    this.sendResponse(response);
  }

  protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) {
    response.body = await this._connection.sendRequest(requestTypeStepOut, args);
    this.sendResponse(response);
  }

  protected async restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments) {
    response.body = await this._connection.sendRequest(requestTypeRestartFrame, args);
    this.sendResponse(response);
  }

  protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
    response.body = await this._connection.sendRequest(requestTypeEvaluate, args);
    this.sendResponse(response);
  }

  protected async exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments) {
    response.body = await this._connection.sendRequest(requestTypeExceptionInfo, args);
    this.sendResponse(response);
  }

  protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
    response.body = await this._connection.sendRequest(requestTypeStackTrace, args);
    this.sendResponse(response);
  }

  protected async sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments) {
    response.body = await this._connection.sendRequest(requestTypeSource, args);
    this.sendResponse(response);
  }

  protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
    response.body = await this._connection.sendRequest(requestTypeScopes, args);
    this.sendResponse(response);
  }

  protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
    response.body = await this._connection.sendRequest(requestTypeVariables, args);
    this.sendResponse(response);
  }
}

export class JuliaDebugFeature {
  constructor(private context: vscode.ExtensionContext) {
    const provider = new JuliaDebugConfigurationProvider();
    const factory = new InlineDebugAdapterFactory(this.context);

    this.context.subscriptions.push(
      vscode.debug.registerDebugConfigurationProvider('julia', provider),
      vscode.debug.registerDebugAdapterDescriptorFactory('julia', factory),
      registerCommand('language-julia.debug.getActiveJuliaEnvironment', async (config) => {
        return await packs.getAbsEnvPath();
      }),
      registerCommand('language-julia.runEditorContents', async (resource: vscode.Uri | undefined) => {
        resource = getActiveUri(resource);
        if (!resource) {
          vscode.window.showInformationMessage('No active editor found.');
          return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(resource);
        if (folder === undefined) {
          vscode.window.showInformationMessage('File not found in workspace.');
          return;
        }
        const success = await vscode.debug.startDebugging(folder, {
          type: 'julia',
          name: 'Run Editor Contents',
          request: 'launch',
          program: resource.fsPath,
          noDebug: true,
        });
        if (!success) {
          vscode.window.showErrorMessage('Could not run editor content in new process.');
        }
      }),
      registerCommand('language-julia.debugEditorContents', async (resource: vscode.Uri | undefined) => {
        resource = getActiveUri(resource);
        if (!resource) {
          vscode.window.showInformationMessage('No active editor found.');
          return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(resource);
        if (folder === undefined) {
          vscode.window.showInformationMessage('File not found in workspace.');
          return;
        }
        const success = await vscode.debug.startDebugging(folder, {
          type: 'julia',
          name: 'Debug Editor Contents',
          request: 'launch',
          program: resource.fsPath,
        });
        if (!success) {
          vscode.window.showErrorMessage('Could not debug editor content in new process.');
        }
      })
    );
  }

  public dispose() {}
}

function getActiveUri(uri: vscode.Uri | undefined, editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor) {
  return uri || (editor ? editor.document.uri : undefined);
}

export class JuliaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  public resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
    if (!config.request) {
      config.request = 'launch';
    }

    if (!config.type) {
      config.type = 'julia';
    }

    if (!config.name) {
      config.name = 'Launch Julia';
    }

    if (!config.program && config.request !== 'attach') {
      config.program = vscode.window.activeTextEditor.document.fileName;
    }

    if (!config.internalConsoleOptions) {
      config.internalConsoleOptions = 'neverOpen';
    }

    if (!config.stopOnEntry) {
      config.stopOnEntry = false;
    }

    if (!config.cwd && config.request !== 'attach') {
      config.cwd = '${workspaceFolder}';
    }

    if (!config.juliaEnv && config.request !== 'attach') {
      config.juliaEnv = '${command:activeJuliaEnvironment}';
    }

    console.log(config);

    return config;
  }
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(private context: vscode.ExtensionContext) {}

  createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return (async () => {
      return new vscode.DebugAdapterInlineImplementation(<any>new JuliaDebugSession(this.context, await getJuliaExePath()));
    })();
  }
}
