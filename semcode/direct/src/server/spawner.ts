import * as path from 'path';
import * as qv from 'vscode';
import { OngoingRequestCancelFact } from '../tsServer/cancellation';
import { ClientCaps, ClientCap, ServerType } from '../service';
import API from '../utils/api';
import { SeparateSyntaxServerConfig, TSServerLogLevel, TSServiceConfig } from '../utils/configuration';
import { Logger } from '../utils/logger';
import { isWeb } from '../utils/platform';
import { TSPluginPathsProvider } from '../utils/pluginPathsProvider';
import { PluginMgr } from '../utils/plugins';
import { TelemetryReporter } from '../utils/telemetry';
import Tracer from '../utils/tracer';
import { LogDirProvider } from './log';
import { GetErrRoutingTSServer, ITsServer, ProcBasedTSServer, SyntaxRoutingTSServer, TSServerDelegate, TSServerProcFact, TSServerProcKind } from './server';
import { TSVersionMgr } from './manager';
import { TSVersionProvider, TSVersion } from './version';
const enum CompositeServerType {
  Single,
  SeparateSyntax,
  DynamicSeparateSyntax,
  SyntaxOnly,
}
export class TSServerSpawner {
  public constructor(
    private readonly _versionProvider: TSVersionProvider,
    private readonly _versionMgr: TSVersionMgr,
    private readonly _logDirProvider: LogDirProvider,
    private readonly _pluginPathsProvider: TSPluginPathsProvider,
    private readonly _logger: Logger,
    private readonly _telemetryReporter: TelemetryReporter,
    private readonly _tracer: Tracer,
    private readonly _factory: TSServerProcFact
  ) {}
  public spawn(version: TSVersion, capabilities: ClientCaps, configuration: TSServiceConfig, pluginMgr: PluginMgr, cancellerFact: OngoingRequestCancelFact, delegate: TSServerDelegate): ITsServer {
    let primaryServer: ITsServer;
    const serverType = this.getCompositeServerType(version, capabilities, configuration);
    switch (serverType) {
      case CompositeServerType.SeparateSyntax:
      case CompositeServerType.DynamicSeparateSyntax: {
        const enableDynamicRouting = serverType === CompositeServerType.DynamicSeparateSyntax;
        primaryServer = new SyntaxRoutingTSServer(
          {
            syntax: this.spawnTSServer(TSServerProcKind.Syntax, version, configuration, pluginMgr, cancellerFact),
            semantic: this.spawnTSServer(TSServerProcKind.Semantic, version, configuration, pluginMgr, cancellerFact),
          },
          delegate,
          enableDynamicRouting
        );
        break;
      }
      case CompositeServerType.Single: {
        primaryServer = this.spawnTSServer(TSServerProcKind.Main, version, configuration, pluginMgr, cancellerFact);
        break;
      }
      case CompositeServerType.SyntaxOnly: {
        primaryServer = this.spawnTSServer(TSServerProcKind.Syntax, version, configuration, pluginMgr, cancellerFact);
        break;
      }
    }
    if (this.shouldUseSeparateDiagsServer(configuration)) {
      return new GetErrRoutingTSServer(
        {
          getErr: this.spawnTSServer(TSServerProcKind.Diags, version, configuration, pluginMgr, cancellerFact),
          primary: primaryServer,
        },
        delegate
      );
    }
    return primaryServer;
  }
  private getCompositeServerType(version: TSVersion, capabilities: ClientCaps, configuration: TSServiceConfig): CompositeServerType {
    if (!capabilities.has(ClientCap.Semantic)) {
      return CompositeServerType.SyntaxOnly;
    }
    switch (configuration.separateSyntaxServer) {
      case SeparateSyntaxServerConfig.Disabled:
        return CompositeServerType.Single;
      case SeparateSyntaxServerConfig.Enabled:
        if (version.apiVersion?.gte(API.v340)) {
          return version.apiVersion?.gte(API.v400) ? CompositeServerType.DynamicSeparateSyntax : CompositeServerType.SeparateSyntax;
        }
        return CompositeServerType.Single;
    }
  }
  private shouldUseSeparateDiagsServer(configuration: TSServiceConfig): boolean {
    return configuration.enableProjectDiags;
  }
  private spawnTSServer(kind: TSServerProcKind, version: TSVersion, configuration: TSServiceConfig, pluginMgr: PluginMgr, cancellerFact: OngoingRequestCancelFact): ITsServer {
    const apiVersion = version.apiVersion || API.defaultVersion;
    const canceller = cancellerFact.create(kind, this._tracer);
    const { args, tsServerLogFile, tsServerTraceDir } = this.getTSServerArgs(kind, configuration, version, apiVersion, pluginMgr, canceller.cancellationPipeName);
    if (TSServerSpawner.isLoggingEnabled(configuration)) {
      if (tsServerLogFile) this._logger.info(`<${kind}> Log file: ${tsServerLogFile}`);
      else {
        this._logger.error(`<${kind}> Could not create log directory`);
      }
    }
    if (configuration.enableTSServerTracing) {
      if (tsServerTraceDir) this._logger.info(`<${kind}> Trace directory: ${tsServerTraceDir}`);
      else {
        this._logger.error(`<${kind}> Could not create trace directory`);
      }
    }
    this._logger.info(`<${kind}> Forking...`);
    const process = this._factory.fork(version.tsServerPath, args, kind, configuration, this._versionMgr);
    this._logger.info(`<${kind}> Starting...`);
    return new ProcBasedTSServer(kind, this.kindToServerType(kind), process!, tsServerLogFile, canceller, version, this._telemetryReporter, this._tracer);
  }
  private kindToServerType(kind: TSServerProcKind): ServerType {
    switch (kind) {
      case TSServerProcKind.Syntax:
        return ServerType.Syntax;
      case TSServerProcKind.Main:
      case TSServerProcKind.Semantic:
      case TSServerProcKind.Diags:
      default:
        return ServerType.Semantic;
    }
  }
  private getTSServerArgs(
    kind: TSServerProcKind,
    configuration: TSServiceConfig,
    currentVersion: TSVersion,
    apiVersion: API,
    pluginMgr: PluginMgr,
    cancellationPipeName: string | undefined
  ): { args: string[]; tsServerLogFile: string | undefined; tsServerTraceDir: string | undefined } {
    const args: string[] = [];
    let tsServerLogFile: string | undefined;
    let tsServerTraceDir: string | undefined;
    if (kind === TSServerProcKind.Syntax) {
      if (apiVersion.gte(API.v401)) args.push('--serverMode', 'partialSemantic');
      else {
        args.push('--syntaxOnly');
      }
    }
    if (apiVersion.gte(API.v250)) {
      args.push('--useInferredProjectPerProjectRoot');
    } else {
      args.push('--useSingleInferredProject');
    }
    if (configuration.disableAutomaticTypeAcquisition || kind === TSServerProcKind.Syntax || kind === TSServerProcKind.Diags) args.push('--disableAutomaticTypingAcquisition');
    if (kind === TSServerProcKind.Semantic || kind === TSServerProcKind.Main) args.push('--enableTelemetry');
    if (cancellationPipeName) args.push('--cancellationPipeName', cancellationPipeName + '*');
    if (TSServerSpawner.isLoggingEnabled(configuration)) {
      if (isWeb()) {
        args.push('--logVerbosity', TSServerLogLevel.toString(configuration.tsServerLogLevel));
      } else {
        const logDir = this._logDirProvider.getNewLogDir();
        if (logDir) {
          tsServerLogFile = path.join(logDir, `tsserver.log`);
          args.push('--logVerbosity', TSServerLogLevel.toString(configuration.tsServerLogLevel));
          args.push('--logFile', tsServerLogFile);
        }
      }
    }
    if (configuration.enableTSServerTracing && !isWeb()) {
      tsServerTraceDir = this._logDirProvider.getNewLogDir();
      if (tsServerTraceDir) args.push('--traceDir', tsServerTraceDir);
    }
    if (!isWeb()) {
      const pluginPaths = this._pluginPathsProvider.getPluginPaths();
      if (pluginMgr.plugins.length) {
        args.push('--globalPlugins', pluginMgr.plugins.map((x) => x.name).join(','));
        const isUsingBundledTSVersion = currentVersion.path === this._versionProvider.defaultVersion.path;
        for (const plugin of pluginMgr.plugins) {
          if (isUsingBundledTSVersion || plugin.enableForWorkspaceTSVersions) pluginPaths.push(plugin.path);
        }
      }
      if (pluginPaths.length !== 0) args.push('--pluginProbeLocations', pluginPaths.join(','));
    }
    if (configuration.npmLocation) args.push('--npmLocation', `"${configuration.npmLocation}"`);
    if (apiVersion.gte(API.v260)) {
      args.push('--locale', TSServerSpawner.getTsLocale(configuration));
    }
    if (apiVersion.gte(API.v291)) {
      args.push('--noGetErrOnBackgroundUpdate');
    }
    if (apiVersion.gte(API.v345)) {
      args.push('--validateDefaultNpmLocation');
    }
    return { args, tsServerLogFile, tsServerTraceDir };
  }
  private static isLoggingEnabled(configuration: TSServiceConfig) {
    return configuration.tsServerLogLevel !== TSServerLogLevel.Off;
  }
  private static getTsLocale(configuration: TSServiceConfig): string {
    return configuration.locale ? configuration.locale : qv.env.language;
  }
}
