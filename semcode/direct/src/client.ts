import * as path from 'path';
import * as qv from 'vscode';
/*
import { DiagKind, DiagsMgr } from '../old/ts/languageFeatures/diagnostics';
import * as qp from './server/proto';
import { EventName } from './utils/key';
import BufferSyncSupport from '../old/ts/tsServer/bufferSyncSupport';
import { OngoingRequestCancelFact } from '../old/ts/tsServer/cancellation';
import { LogDirProvider } from '../old/ts/tsServer/logDirProvider';
import { ITsServer, TsServerProcFact } from '../old/ts/tsServer/server';
import { TsServerError } from '../old/ts/tsServer/serverError';
import { TsServerSpawner } from '../old/ts/tsServer/spawner';
import { TsVersionMgr } from '../old/ts/tsServer/versionMgr';
import { TsVersionProvider, TsVersion } from '../old/ts/tsServer/versionProvider';
import { ClientCaps, ClientCap, ExecConfig, ServiceClient, ServerResponse, TSRequests } from './service';
import API from './utils/env';
import { TsServerLogLevel, TSServiceConfig } from './utils/config';
import * as fileSchemes from '../old/ts/utils/fileSchemes';
import { Logger } from './utils/log';
import * as qu from './utils/base';
import { TsPluginPathsProvider } from './utils/path';
import { PluginMgr } from './utils/plugins';
import { TelemetryProperties, TelemetryReporter, VSCodeTelemetryReporter } from './utils/telemetry';
import Tracer from './utils/tracer';
import { inferredProjectCompilerOptions, ProjectType } from './utils/config';
*/
export interface TsDiags {
  readonly kind: DiagKind;
  readonly resource: qv.Uri;
  readonly diagnostics: qp.Diag[];
}
interface ToCancelOnResourceChanged {
  readonly resource: qv.Uri;
  cancel(): void;
}
namespace ServerState {
  export const enum Type {
    None,
    Running,
    Errored,
  }
  export const None = { type: Type.None } as const;
  export class Running {
    readonly type = Type.Running;
    constructor(public readonly server: ITsServer, public readonly apiVersion: API, public tsserverVersion: string | undefined, public languageServiceEnabled: boolean) {}
    public readonly toCancelOnResourceChange = new Set<ToCancelOnResourceChanged>();
    updateTsserverVersion(tsserverVersion: string) {
      this.tsserverVersion = tsserverVersion;
    }
    updateLangServiceEnabled(enabled: boolean) {
      this.languageServiceEnabled = enabled;
    }
  }
  export class Errored {
    readonly type = Type.Errored;
    constructor(public readonly error: Error, public readonly tsServerLogFile: string | undefined) {}
  }
  export type State = typeof None | Running | Errored;
}
export default class TypeScriptServiceClient extends qu.Disposable implements ServiceClient {
  private readonly pathSeparator: string;
  private readonly inMemoryResourcePrefix = '^';
  private readonly workspaceState: qv.Memento;
  private _onReady?: { promise: Promise<void>; resolve: () => void; reject: () => void };
  private _configuration: TSServiceConfig;
  private pluginPathsProvider: TsPluginPathsProvider;
  private readonly _versionMgr: TsVersionMgr;
  private readonly logger = new Logger();
  private readonly tracer = new Tracer(this.logger);
  private readonly TsServerSpawner: TsServerSpawner;
  private serverState: ServerState.State = ServerState.None;
  private lastStart: number;
  private numberRestarts: number;
  private _isPromptingAfterCrash = false;
  private isRestarting: boolean = false;
  private hasServerFatallyCrashedTooManyTimes = false;
  private readonly loadingIndicator = new ServerInitializingIndicator();
  public readonly telemetryReporter: TelemetryReporter;
  public readonly bufferSyncSupport: BufferSyncSupport;
  public readonly diagnosticsMgr: DiagsMgr;
  public readonly pluginMgr: PluginMgr;
  private readonly logDirProvider: LogDirProvider;
  private readonly cancellerFact: OngoingRequestCancelFact;
  private readonly versionProvider: TsVersionProvider;
  private readonly processFact: TsServerProcFact;
  constructor(
    private readonly context: qv.ExtensionContext,
    onCaseInsenitiveFileSystem: boolean,
    services: {
      pluginMgr: PluginMgr;
      logDirProvider: LogDirProvider;
      cancellerFact: OngoingRequestCancelFact;
      versionProvider: TsVersionProvider;
      processFact: TsServerProcFact;
    },
    allModeIds: readonly string[]
  ) {
    super();
    this.workspaceState = context.workspaceState;
    this.pluginMgr = services.pluginMgr;
    this.logDirProvider = services.logDirProvider;
    this.cancellerFact = services.cancellerFact;
    this.versionProvider = services.versionProvider;
    this.processFact = services.processFact;
    this.pathSeparator = path.sep;
    this.lastStart = Date.now();
    let resolve: () => void;
    let reject: () => void;
    const p = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this._onReady = { promise: p, resolve: resolve!, reject: reject! };
    this.numberRestarts = 0;
    this._configuration = TSServiceConfig.loadFromWorkspace();
    this.versionProvider.updateConfig(this._configuration);
    this.pluginPathsProvider = new TsPluginPathsProvider(this._configuration);
    this._versionMgr = this._register(new TsVersionMgr(this._configuration, this.versionProvider, this.workspaceState));
    this._register(
      this._versionMgr.onDidPickNewVersion(() => {
        this.restartTsServer();
      })
    );
    this.bufferSyncSupport = new BufferSyncSupport(this, allModeIds, onCaseInsenitiveFileSystem);
    this.onReady(() => {
      this.bufferSyncSupport.listen();
    });
    this.diagnosticsMgr = new DiagsMgr('typescript', onCaseInsenitiveFileSystem);
    this.bufferSyncSupport.onDelete(
      (resource) => {
        this.cancelInflightRequestsForResource(resource);
        this.diagnosticsMgr.delete(resource);
      },
      null,
      this._disposables
    );
    this.bufferSyncSupport.onWillChange((resource) => {
      this.cancelInflightRequestsForResource(resource);
    });
    qv.workspace.onDidChangeConfig(
      () => {
        const oldConfig = this._configuration;
        this._configuration = TSServiceConfig.loadFromWorkspace();
        this.versionProvider.updateConfig(this._configuration);
        this._versionMgr.updateConfig(this._configuration);
        this.pluginPathsProvider.updateConfig(this._configuration);
        this.tracer.updateConfig();
        if (this.serverState.type === ServerState.Type.Running) {
          if (!this._configuration.implictProjectConfig.isEqualTo(oldConfig.implictProjectConfig)) this.setCompilerOptionsForInferredProjects(this._configuration);
          if (!this._configuration.isEqualTo(oldConfig)) {
            this.restartTsServer();
          }
        }
      },
      this,
      this._ds
    );
    this.telemetryReporter = this._register(
      new VSCodeTelemetryReporter(() => {
        if (this.serverState.type === ServerState.Type.Running) {
          if (this.serverState.tsserverVersion) return this.serverState.tsserverVersion;
        }
        return this.apiVersion.fullVersionString;
      })
    );
    this.TsServerSpawner = new TsServerSpawner(
      this.versionProvider,
      this._versionMgr,
      this.logDirProvider,
      this.pluginPathsProvider,
      this.logger,
      this.telemetryReporter,
      this.tracer,
      this.processFact
    );
    this._register(
      this.pluginMgr.onDidUpdateConfig((update) => {
        this.configurePlugin(update.pluginId, update.config);
      })
    );
    this._register(
      this.pluginMgr.onDidChangePlugins(() => {
        this.restartTsServer();
      })
    );
  }
  public get capabilities() {
    if (qu.isWeb()) return new ClientCaps(ClientCap.Syntax, ClientCap.EnhancedSyntax);
    if (this.apiVersion.gte(API.v400)) return new ClientCaps(ClientCap.Syntax, ClientCap.EnhancedSyntax, ClientCap.Semantic);
    return new ClientCaps(ClientCap.Syntax, ClientCap.Semantic);
  }
  private readonly _onDidChangeCapabilities = this._register(new qv.EventEmitter<void>());
  readonly onDidChangeCapabilities = this._onDidChangeCapabilities.event;
  private cancelInflightRequestsForResource(resource: qv.Uri): void {
    if (this.serverState.type !== ServerState.Type.Running) return;
    for (const request of this.serverState.toCancelOnResourceChange) {
      if (request.resource.toString() === resource.toString()) {
        request.cancel();
      }
    }
  }
  public get configuration() {
    return this._configuration;
  }
  public dispose() {
    super.dispose();
    this.bufferSyncSupport.dispose();
    if (this.serverState.type === ServerState.Type.Running) this.serverState.server.kill();
    this.loadingIndicator.reset();
  }
  public restartTsServer(): void {
    if (this.serverState.type === ServerState.Type.Running) {
      this.info('Killing TS Server');
      this.isRestarting = true;
      this.serverState.server.kill();
    }
    this.serverState = this.startService(true);
  }
  private readonly _onTsServerStarted = this._register(new qv.EventEmitter<{ version: TsVersion; usedApiVersion: API }>());
  public readonly onTsServerStarted = this._onTsServerStarted.event;
  private readonly _onDiagsReceived = this._register(new qv.EventEmitter<TsDiags>());
  public readonly onDiagsReceived = this._onDiagsReceived.event;
  private readonly _onConfigDiagsReceived = this._register(new qv.EventEmitter<qp.ConfigFileDiagEvent>());
  public readonly onConfigDiagsReceived = this._onConfigDiagsReceived.event;
  private readonly _onResendModelsRequested = this._register(new qv.EventEmitter<void>());
  public readonly onResendModelsRequested = this._onResendModelsRequested.event;
  private readonly _onProjectLangServiceStateChanged = this._register(new qv.EventEmitter<qp.ProjectLangServiceStateEventBody>());
  public readonly onProjectLangServiceStateChanged = this._onProjectLangServiceStateChanged.event;
  private readonly _onDidBeginInstallTypings = this._register(new qv.EventEmitter<qp.BeginInstallTypesEventBody>());
  public readonly onDidBeginInstallTypings = this._onDidBeginInstallTypings.event;
  private readonly _onDidEndInstallTypings = this._register(new qv.EventEmitter<qp.EndInstallTypesEventBody>());
  public readonly onDidEndInstallTypings = this._onDidEndInstallTypings.event;
  private readonly _onTypesInstallerInitializationFailed = this._register(new qv.EventEmitter<qp.TypesInstallerInitializationFailedEventBody>());
  public readonly onTypesInstallerInitializationFailed = this._onTypesInstallerInitializationFailed.event;
  private readonly _onSurveyReady = this._register(new qv.EventEmitter<qp.SurveyReadyEventBody>());
  public readonly onSurveyReady = this._onSurveyReady.event;
  public get apiVersion(): API {
    if (this.serverState.type === ServerState.Type.Running) return this.serverState.apiVersion;
    return API.defaultVersion;
  }
  public onReady(f: () => void): Promise<void> {
    return this._onReady!.promise.then(f);
  }
  private info(message: string, data?: any): void {
    this.logger.info(message, data);
  }
  private error(message: string, data?: any): void {
    this.logger.error(message, data);
  }
  private logTelemetry(eventName: string, properties?: TelemetryProperties) {
    this.telemetryReporter.logTelemetry(eventName, properties);
  }
  private service(): ServerState.Running {
    if (this.serverState.type === ServerState.Type.Running) return this.serverState;
    if (this.serverState.type === ServerState.Type.Errored) throw this.serverState.error;
    const newState = this.startService();
    if (newState.type === ServerState.Type.Running) return newState;
    throw new Error(`Could not create TS service. Service state:${JSON.stringify(newState)}`);
  }
  public ensureServiceStarted() {
    if (this.serverState.type !== ServerState.Type.Running) this.startService();
  }
  private token: number = 0;
  private startService(resendModels: boolean = false): ServerState.State {
    this.info(`Starting TS Server `);
    if (this.isDisposed) {
      this.info(`Not starting server. Disposed `);
      return ServerState.None;
    }
    if (this.hasServerFatallyCrashedTooManyTimes) {
      this.info(`Not starting server. Too many crashes.`);
      return ServerState.None;
    }
    let version = this._versionMgr.currentVersion;
    if (!version.isValid) {
      qv.window.showWarningMessage('noServerFound');
      this._versionMgr.reset();
      version = this._versionMgr.currentVersion;
    }
    this.info(`Using tsserver from: ${version.path}`);
    const apiVersion = version.apiVersion || API.defaultVersion;
    const mytoken = ++this.token;
    const handle = this.TsServerSpawner.spawn(version, this.capabilities, this.configuration, this.pluginMgr, this.cancellerFact, {
      onFatalError: (command, err) => this.fatalError(command, err),
    });
    this.serverState = new ServerState.Running(handle, apiVersion, undefined, true);
    this.lastStart = Date.now();
    /* __GDPR__
			"tsserver.spawned" : {
				"${include}": [
					"${TypeScriptCommonProperties}"
				],
				"localTsVersion": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"VersionSource": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
    this.logTelemetry('tsserver.spawned', {
      localTsVersion: this.versionProvider.localVersion ? this.versionProvider.localVersion.displayName : '',
      VersionSource: version.source,
    });
    handle.onError((err: Error) => {
      if (this.token !== mytoken) return;
      if (err) qv.window.showErrorMessage('serverExitedWithError');
      this.serverState = new ServerState.Errored(err, handle.tsServerLogFile);
      this.error('TsServer errored with error.', err);
      if (handle.tsServerLogFile) this.error(`TsServer log file: ${handle.tsServerLogFile}`);
      /* __GDPR__
				"tsserver.error" : {
					"${include}": [
						"${TypeScriptCommonProperties}"
					]
				}
			*/
      this.logTelemetry('tsserver.error');
      this.serviceExited(false);
    });
    handle.onExit((code: any) => {
      if (this.token !== mytoken) return;
      if (code === null || typeof code === 'undefined') this.info('TsServer exited');
      else {
        this.error(`TsServer exited with code: ${code}`);
        /* __GDPR__
					"tsserver.exitWithCode" : {
						"code" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
						"${include}": [
							"${TypeScriptCommonProperties}"
						]
					}
				*/
        this.logTelemetry('tsserver.exitWithCode', { code: code });
      }
      if (handle.tsServerLogFile) this.info(`TsServer log file: ${handle.tsServerLogFile}`);
      this.serviceExited(!this.isRestarting);
      this.isRestarting = false;
    });
    handle.onEvent((event) => this.dispatchEvent(event));
    if (apiVersion.gte(API.v300) && this.capabilities.has(ClientCap.Semantic)) {
      this.loadingIndicator.startedLoadingProject(undefined /* projectName */);
    }
    this.serviceStarted(resendModels);
    this._onReady!.resolve();
    this._onTsServerStarted.fire({ version: version, usedApiVersion: apiVersion });
    this._onDidChangeCapabilities.fire();
    return this.serverState;
  }
  public async showVersionPicker(): Promise<void> {
    this._versionMgr.promptUserForVersion();
  }
  public async openTsServerLogFile(): Promise<boolean> {
    if (this._configuration.tsServerLogLevel === TsServerLogLevel.Off) {
      qv.window
        .showErrorMessage<qv.MessageItem>('typescript.openTsServerLog.loggingNotEnabled', {
          title: 'typescript.openTsServerLog.enableAndReloadOption',
        })
        .then((selection) => {
          if (selection) {
            return qv.workspace
              .getConfig()
              .update('typescript.tsserver.log', 'verbose', true)
              .then(() => {
                this.restartTsServer();
              });
          }
          return undefined;
        });
      return false;
    }
    if (this.serverState.type !== ServerState.Type.Running || !this.serverState.server.tsServerLogFile) {
      qv.window.showWarningMessage('typescript.openTsServerLog.noLogFile');
      return false;
    }
    try {
      const doc = await qv.workspace.openTextDocument(qv.Uri.file(this.serverState.server.tsServerLogFile));
      await qv.window.showTextDocument(doc);
      return true;
    } catch {}
    try {
      await qv.commands.executeCommand('revealFileInOS', qv.Uri.file(this.serverState.server.tsServerLogFile));
      return true;
    } catch {
      qv.window.showWarningMessage('openTsServerLog.openFileFailedFailed');
      return false;
    }
  }
  private serviceStarted(resendModels: boolean): void {
    this.bufferSyncSupport.reset();
    const watchOptions = this.apiVersion.gte(API.v380) ? this.configuration.watchOptions : undefined;
    const configureOptions: qp.ConfigureRequestArguments = {
      hostInfo: 'vscode',
      preferences: {
        providePrefixAndSuffixTextForRename: true,
        allowRenameOfImportPath: true,
        includePackageJsonAutoImports: this._configuration.includePackageJsonAutoImports,
      },
      watchOptions,
    };
    this.executeWithoutWaitingForResponse('configure', configureOptions);
    this.setCompilerOptionsForInferredProjects(this._configuration);
    if (resendModels) {
      this._onResendModelsRequested.fire();
      this.bufferSyncSupport.reinitialize();
      this.bufferSyncSupport.requestAllDiags();
    }
    for (const [config, pluginName] of this.pluginMgr.configurations()) {
      this.configurePlugin(config, pluginName);
    }
  }
  private setCompilerOptionsForInferredProjects(configuration: TSServiceConfig): void {
    const args: qp.SetCompilerOptionsForInferredProjectsArgs = {
      options: this.getCompilerOptionsForInferredProjects(configuration),
    };
    this.executeWithoutWaitingForResponse('compilerOptionsForInferredProjects', args);
  }
  private getCompilerOptionsForInferredProjects(configuration: TSServiceConfig): qp.ExternalProjectCompilerOptions {
    return {
      ...inferredProjectCompilerOptions(ProjectType.TypeScript, configuration),
      allowJs: true,
      allowSyntheticDefaultImports: true,
      allowNonTsExtensions: true,
      resolveJsonModule: true,
    };
  }
  private serviceExited(restart: boolean): void {
    this.loadingIndicator.reset();
    const previousState = this.serverState;
    this.serverState = ServerState.None;
    if (restart) {
      const diff = Date.now() - this.lastStart;
      this.numberRestarts++;
      let startService = true;
      const reportIssueItem: qv.MessageItem = {
        title: 'serverDiedReportIssue',
      };
      let prompt: Thenable<undefined | qv.MessageItem> | undefined = undefined;
      if (this.numberRestarts > 5) {
        this.numberRestarts = 0;
        if (diff < 10 * 1000 /* 10 seconds */) {
          this.lastStart = Date.now();
          startService = false;
          this.hasServerFatallyCrashedTooManyTimes = true;
          prompt = qv.window.showErrorMessage('serverDiedAfterStart', reportIssueItem);
          /* __GDPR__
						"serviceExited" : {
							"${include}": [
								"${TypeScriptCommonProperties}"
							]
						}
					*/
          this.logTelemetry('serviceExited');
        } else if (diff < 60 * 1000 * 5 /* 5 Minutes */) {
          this.lastStart = Date.now();
          prompt = qv.window.showWarningMessage('serverDied', reportIssueItem);
        }
      } else if (['vscode-insiders', 'code-oss'].includes(qv.env.uriScheme)) {
        if (!this._isPromptingAfterCrash && previousState.type === ServerState.Type.Errored && previousState.error instanceof TsServerError) {
          this.numberRestarts = 0;
          this._isPromptingAfterCrash = true;
          prompt = qv.window.showWarningMessage('serverDiedOnce', reportIssueItem);
        }
      }
      prompt?.then((item) => {
        this._isPromptingAfterCrash = false;
        if (item === reportIssueItem) {
          const args =
            previousState.type === ServerState.Type.Errored && previousState.error instanceof TsServerError
              ? getReportIssueArgsForError(previousState.error, previousState.tsServerLogFile)
              : undefined;
          qv.commands.executeCommand('workbench.action.openIssueReporter', args);
        }
      });
      if (startService) this.startService(true);
    }
  }
  public normalizedPath(resource: qv.Uri): string | undefined {
    if (fileSchemes.disabledSchemes.has(resource.scheme)) {
      return undefined;
    }
    switch (resource.scheme) {
      case fileSchemes.file: {
        let result = resource.fsPath;
        if (!result) return undefined;
        result = path.normalize(result);
        return result.replace(new RegExp('\\' + this.pathSeparator, 'g'), '/');
      }
      default: {
        return this.inMemoryResourcePrefix + resource.toString(true);
      }
    }
  }
  public toPath(resource: qv.Uri): string | undefined {
    return this.normalizedPath(resource);
  }
  public toOpenedFilePath(document: qv.TextDocument, options: { suppressAlertOnFailure?: boolean } = {}): string | undefined {
    if (!this.bufferSyncSupport.ensureHasBuffer(document.uri)) {
      if (!options.suppressAlertOnFailure && !fileSchemes.disabledSchemes.has(document.uri.scheme)) {
        console.error(`Unexpected resource ${document.uri}`);
      }
      return undefined;
    }
    return this.toPath(document.uri);
  }
  public hasCapabilityForResource(resource: qv.Uri, capability: ClientCap): boolean {
    switch (capability) {
      case ClientCap.Semantic: {
        return fileSchemes.semanticSupportedSchemes.includes(resource.scheme);
      }
      case ClientCap.Syntax:
      case ClientCap.EnhancedSyntax: {
        return true;
      }
    }
  }
  public toResource(filepath: string): qv.Uri {
    if (isWeb()) {
      if (filepath.startsWith('/')) {
        return qv.Uri.joinPath(this.context.extensionUri, 'node_modules', 'typescript', 'lib', filepath.slice(1));
      }
    }
    if (filepath.startsWith(this.inMemoryResourcePrefix)) {
      const resource = qv.Uri.parse(filepath.slice(1));
      return this.bufferSyncSupport.toVsCodeResource(resource);
    }
    return this.bufferSyncSupport.toResource(filepath);
  }
  public getWorkspaceRootForResource(resource: qv.Uri): string | undefined {
    const roots = qv.workspace.workspaceFolders ? Array.from(qv.workspace.workspaceFolders) : undefined;
    if (!roots || !roots.length) return undefined;
    if (resource.scheme === fileSchemes.file || resource.scheme === fileSchemes.untitled) {
      for (const root of roots.sort((a, b) => a.uri.fsPath.length - b.uri.fsPath.length)) {
        if (resource.fsPath.startsWith(root.uri.fsPath + path.sep)) return root.uri.fsPath;
      }
      return roots[0].uri.fsPath;
    }
    return undefined;
  }
  public execute(command: keyof TSRequests, args: any, token: qv.CancellationToken, config?: ExecConfig): Promise<ServerResponse.Response<qp.Response>> {
    let execution: Promise<ServerResponse.Response<qp.Response>>;
    if (config?.cancelOnResourceChange) {
      const runningServerState = this.service();
      const source = new qv.CancellationTokenSource();
      token.onCancellationRequested(() => source.cancel());
      const inFlight: ToCancelOnResourceChanged = {
        resource: config.cancelOnResourceChange,
        cancel: () => source.cancel(),
      };
      runningServerState.toCancelOnResourceChange.add(inFlight);
      execution = this.executeImpl(command, args, {
        isAsync: false,
        token: source.token,
        expectsResult: true,
        ...config,
      }).finally(() => {
        runningServerState.toCancelOnResourceChange.delete(inFlight);
        source.dispose();
      });
    } else {
      execution = this.executeImpl(command, args, {
        isAsync: false,
        token,
        expectsResult: true,
        ...config,
      });
    }
    if (config?.nonRecoverable) execution.catch((err) => this.fatalError(command, err));
    return execution;
  }
  public executeWithoutWaitingForResponse(command: keyof TSRequests, args: any): void {
    this.executeImpl(command, args, {
      isAsync: false,
      token: undefined,
      expectsResult: false,
    });
  }
  public executeAsync(command: keyof TSRequests, args: qp.GeterrRequestArgs, token: qv.CancellationToken): Promise<ServerResponse.Response<qp.Response>> {
    return this.executeImpl(command, args, {
      isAsync: true,
      token,
      expectsResult: true,
    });
  }
  private executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: false; lowPriority?: boolean; requireSemantic?: boolean }
  ): undefined;
  private executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; requireSemantic?: boolean }
  ): Promise<ServerResponse.Response<qp.Response>>;
  private executeImpl(
    command: keyof TSRequests,
    args: any,
    executeInfo: { isAsync: boolean; token?: qv.CancellationToken; expectsResult: boolean; lowPriority?: boolean; requireSemantic?: boolean }
  ): Promise<ServerResponse.Response<qp.Response>> | undefined {
    this.bufferSyncSupport.beforeCommand(command);
    const runningServerState = this.service();
    return runningServerState.server.executeImpl(command, args, executeInfo);
  }
  public interruptGetErr<R>(f: () => R): R {
    return this.bufferSyncSupport.interruptGetErr(f);
  }
  private fatalError(command: string, error: unknown): void {
    /* __GDPR__
			"fatalError" : {
				"${include}": [
					"${TypeScriptCommonProperties}",
					"${TypeScriptRequestErrorProperties}"
				],
				"command" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
    this.logTelemetry('fatalError', { ...(error instanceof TsServerError ? error.telemetry : { command }) });
    console.error(`A non-recoverable error occured while executing tsserver command: ${command}`);
    if (error instanceof TsServerError && error.serverErrorText) console.error(error.serverErrorText);
    if (this.serverState.type === ServerState.Type.Running) {
      this.info('Killing TS Server');
      const logfile = this.serverState.server.tsServerLogFile;
      this.serverState.server.kill();
      if (error instanceof TsServerError) this.serverState = new ServerState.Errored(error, logfile);
    }
  }
  private dispatchEvent(event: qp.Event) {
    switch (event.event) {
      case EventName.syntaxDiag:
      case EventName.semanticDiag:
      case EventName.suggestionDiag:
        this.loadingIndicator.reset();
        const diagnosticEvent = event as qp.DiagEvent;
        if (diagnosticEvent.body && diagnosticEvent.body.diagnostics)
          this._onDiagsReceived.fire({ kind: getDignosticsKind(event), resource: this.toResource(diagnosticEvent.body.file), diagnostics: diagnosticEvent.body.diagnostics });
        break;
      case EventName.configFileDiag:
        this._onConfigDiagsReceived.fire(event as qp.ConfigFileDiagEvent);
        break;
      case EventName.telemetry: {
        const body = (event as qp.TelemetryEvent).body;
        this.dispatchTelemetryEvent(body);
        break;
      }
      case EventName.projectLangServiceState: {
        const body = (event as qp.ProjectLangServiceStateEvent).body!;
        if (this.serverState.type === ServerState.Type.Running) this.serverState.updateLangServiceEnabled(body.languageServiceEnabled);
        this._onProjectLangServiceStateChanged.fire(body);
        break;
      }
      case EventName.projectsUpdatedInBackground:
        this.loadingIndicator.reset();
        const body = (event as qp.ProjectsUpdatedInBackgroundEvent).body;
        const resources = body.openFiles.map((file) => this.toResource(file));
        this.bufferSyncSupport.getErr(resources);
        break;
      case EventName.beginInstallTypes:
        this._onDidBeginInstallTypings.fire((event as qp.BeginInstallTypesEvent).body);
        break;
      case EventName.endInstallTypes:
        this._onDidEndInstallTypings.fire((event as qp.EndInstallTypesEvent).body);
        break;
      case EventName.typesInstallerInitializationFailed:
        this._onTypesInstallerInitializationFailed.fire((event as qp.TypesInstallerInitializationFailedEvent).body);
        break;
      case EventName.surveyReady:
        this._onSurveyReady.fire((event as qp.SurveyReadyEvent).body);
        break;
      case EventName.projectLoadingStart:
        this.loadingIndicator.startedLoadingProject((event as qp.ProjectLoadingStartEvent).body.projectName);
        break;
      case EventName.projectLoadingFinish:
        this.loadingIndicator.finishedLoadingProject((event as qp.ProjectLoadingFinishEvent).body.projectName);
        break;
    }
  }
  private dispatchTelemetryEvent(telemetryData: qp.TelemetryEventBody): void {
    const properties: { [key: string]: string } = Object.create(null);
    switch (telemetryData.telemetryEventName) {
      case 'typingsInstalled':
        const typingsInstalledPayload: qp.TypingsInstalledTelemetryEventPayload = telemetryData.payload as qp.TypingsInstalledTelemetryEventPayload;
        properties['installedPackages'] = typingsInstalledPayload.installedPackages;
        if (typeof typingsInstalledPayload.installSuccess === 'boolean') properties['installSuccess'] = typingsInstalledPayload.installSuccess.toString();
        if (typeof typingsInstalledPayload.typingsInstallerVersion === 'string') properties['typingsInstallerVersion'] = typingsInstalledPayload.typingsInstallerVersion;
        break;
      default:
        const payload = telemetryData.payload;
        if (payload) {
          Object.keys(payload).forEach((key) => {
            try {
              if (payload.hasOwnProperty(key)) properties[key] = typeof payload[key] === 'string' ? payload[key] : JSON.stringify(payload[key]);
            } catch (e) {}
          });
        }
        break;
    }
    if (telemetryData.telemetryEventName === 'projectInfo') {
      if (this.serverState.type === ServerState.Type.Running) this.serverState.updateTsserverVersion(properties['version']);
    }
    /* __GDPR__
			"typingsInstalled" : {
				"installedPackages" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"installSuccess": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
				"typingsInstallerVersion": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
    this.logTelemetry(telemetryData.telemetryEventName, properties);
  }
  private configurePlugin(pluginName: string, configuration: {}): any {
    if (this.apiVersion.gte(API.v314)) {
      this.executeWithoutWaitingForResponse('configurePlugin', { pluginName, configuration });
    }
  }
}
function getReportIssueArgsForError(error: TsServerError, logPath: string | undefined): { extensionId: string; issueTitle: string; issueBody: string } | undefined {
  if (!error.serverStack || !error.serverMessage) return undefined;
  const sections = [
    `❗️❗️❗️ Please fill in the sections below to help us diagnose the issue ❗️❗️❗️`,
    `**TypeScript Version:** ${error.version.apiVersion?.fullVersionString}`,
    `**Steps to reproduce crash**
1.
2.
3.`,
  ];
  if (logPath) {
    sections.push(`**TS Server Log**
❗️ Please review and upload this log file to help us diagnose this crash:
\`${logPath}\`
The log file may contain personal data, including full paths and source code from your workspace. You can scrub the log file to remove paths or other personal information.
`);
  } else {
    sections.push(`**TS Server Log**
❗️Server logging disabled. To help us fix crashes like this, please enable logging by setting:
\`\`\`json
"typescript.tsserver.log": "verbose"
\`\`\`
After enabling this setting, future crash reports will include the server log.`);
  }
  sections.push(`**TS Server Error Stack**
Server: \`${error.serverId}\`
\`\`\`
${error.serverStack}
\`\`\``);
  return {
    extensionId: 'qv.typescript-language-features',
    issueTitle: `TS Server fatal error:  ${error.serverMessage}`,
    issueBody: sections.join('\n\n'),
  };
}
function getDignosticsKind(event: qp.Event) {
  switch (event.event) {
    case 'syntaxDiag':
      return DiagKind.Syntax;
    case 'semanticDiag':
      return DiagKind.Semantic;
    case 'suggestionDiag':
      return DiagKind.Suggestion;
  }
  throw new Error('Unknown dignostics kind');
}
class ServerInitializingIndicator extends qu.Disposable {
  private _task?: { project: string | undefined; resolve: () => void; reject: () => void };
  public reset(): void {
    if (this._task) {
      this._task.reject();
      this._task = undefined;
    }
  }
  public startedLoadingProject(projectName: string | undefined): void {
    this.reset();
    qv.window.withProgress(
      {
        location: qv.ProgressLocation.Window,
        title: 'serverLoading.progress',
      },
      () =>
        new Promise<void>((resolve, reject) => {
          this._task = { project: projectName, resolve, reject };
        })
    );
  }
  public finishedLoadingProject(projectName: string | undefined): void {
    if (this._task && this._task.project === projectName) {
      this._task.resolve();
      this._task = undefined;
    }
  }
}
