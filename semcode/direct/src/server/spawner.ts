import * as path from 'path';
import * as qv from 'vscode';
import { OngoingRequestCancelFact } from '../tsServer/cancellation';
import { ClientCaps, ClientCap, ServerType } from '../service';
import API from '../utils/api';
import { SeparateSyntaxServerConfig, TsServerLogLevel, TSServiceConfig } from '../utils/configuration';
import { Logger } from '../utils/logger';
import { isWeb } from '../utils/platform';
import { TsPluginPathsProvider } from '../utils/pluginPathsProvider';
import { PluginMgr } from '../utils/plugins';
import { TelemetryReporter } from '../utils/telemetry';
import Tracer from '../utils/tracer';
import { LogDirProvider } from './log';
import { GetErrRoutingTsServer, ITsServer, ProcBasedTsServer, SyntaxRoutingTsServer, TsServerDelegate, TsServerProcFact, TsServerProcKind } from './server';
import { TsVersionMgr } from './manager';
import { TsVersionProvider, TsVersion } from './version';

const enum CompositeServerType {
  Single,
  SeparateSyntax,
  DynamicSeparateSyntax,
  SyntaxOnly,
}
export class TsServerSpawner {
  public constructor(
    private readonly _versionProvider: TsVersionProvider,
    private readonly _versionMgr: TsVersionMgr,
    private readonly _logDirProvider: LogDirProvider,
    private readonly _pluginPathsProvider: TsPluginPathsProvider,
    private readonly _logger: Logger,
    private readonly _telemetryReporter: TelemetryReporter,
    private readonly _tracer: Tracer,
    private readonly _factory: TsServerProcFact
  ) {}
  public spawn(version: TsVersion, capabilities: ClientCaps, configuration: TSServiceConfig, pluginMgr: PluginMgr, cancellerFact: OngoingRequestCancelFact, delegate: TsServerDelegate): ITsServer {
    let primaryServer: ITsServer;
    const serverType = this.getCompositeServerType(version, capabilities, configuration);
    switch (serverType) {
      case CompositeServerType.SeparateSyntax:
      case CompositeServerType.DynamicSeparateSyntax: {
        const enableDynamicRouting = serverType === CompositeServerType.DynamicSeparateSyntax;
        primaryServer = new SyntaxRoutingTsServer(
          {
            syntax: this.spawnTsServer(TsServerProcKind.Syntax, version, configuration, pluginMgr, cancellerFact),
            semantic: this.spawnTsServer(TsServerProcKind.Semantic, version, configuration, pluginMgr, cancellerFact),
          },
          delegate,
          enableDynamicRouting
        );
        break;
      }
      case CompositeServerType.Single: {
        primaryServer = this.spawnTsServer(TsServerProcKind.Main, version, configuration, pluginMgr, cancellerFact);
        break;
      }
      case CompositeServerType.SyntaxOnly: {
        primaryServer = this.spawnTsServer(TsServerProcKind.Syntax, version, configuration, pluginMgr, cancellerFact);
        break;
      }
    }
    if (this.shouldUseSeparateDiagsServer(configuration)) {
      return new GetErrRoutingTsServer(
        {
          getErr: this.spawnTsServer(TsServerProcKind.Diags, version, configuration, pluginMgr, cancellerFact),
          primary: primaryServer,
        },
        delegate
      );
    }
    return primaryServer;
  }
  private getCompositeServerType(version: TsVersion, capabilities: ClientCaps, configuration: TSServiceConfig): CompositeServerType {
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
  private spawnTsServer(kind: TsServerProcKind, version: TsVersion, configuration: TSServiceConfig, pluginMgr: PluginMgr, cancellerFact: OngoingRequestCancelFact): ITsServer {
    const apiVersion = version.apiVersion || API.defaultVersion;
    const canceller = cancellerFact.create(kind, this._tracer);
    const { args, tsServerLogFile, tsServerTraceDir } = this.getTsServerArgs(kind, configuration, version, apiVersion, pluginMgr, canceller.cancellationPipeName);
    if (TsServerSpawner.isLoggingEnabled(configuration)) {
      if (tsServerLogFile) this._logger.info(`<${kind}> Log file: ${tsServerLogFile}`);
      else {
        this._logger.error(`<${kind}> Could not create log directory`);
      }
    }
    if (configuration.enableTsServerTracing) {
      if (tsServerTraceDir) this._logger.info(`<${kind}> Trace directory: ${tsServerTraceDir}`);
      else {
        this._logger.error(`<${kind}> Could not create trace directory`);
      }
    }
    this._logger.info(`<${kind}> Forking...`);
    const process = this._factory.fork(version.tsServerPath, args, kind, configuration, this._versionMgr);
    this._logger.info(`<${kind}> Starting...`);
    return new ProcBasedTsServer(kind, this.kindToServerType(kind), process!, tsServerLogFile, canceller, version, this._telemetryReporter, this._tracer);
  }
  private kindToServerType(kind: TsServerProcKind): ServerType {
    switch (kind) {
      case TsServerProcKind.Syntax:
        return ServerType.Syntax;
      case TsServerProcKind.Main:
      case TsServerProcKind.Semantic:
      case TsServerProcKind.Diags:
      default:
        return ServerType.Semantic;
    }
  }
  private getTsServerArgs(
    kind: TsServerProcKind,
    configuration: TSServiceConfig,
    currentVersion: TsVersion,
    apiVersion: API,
    pluginMgr: PluginMgr,
    cancellationPipeName: string | undefined
  ): { args: string[]; tsServerLogFile: string | undefined; tsServerTraceDir: string | undefined } {
    const args: string[] = [];
    let tsServerLogFile: string | undefined;
    let tsServerTraceDir: string | undefined;
    if (kind === TsServerProcKind.Syntax) {
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
    if (configuration.disableAutomaticTypeAcquisition || kind === TsServerProcKind.Syntax || kind === TsServerProcKind.Diags) args.push('--disableAutomaticTypingAcquisition');
    if (kind === TsServerProcKind.Semantic || kind === TsServerProcKind.Main) args.push('--enableTelemetry');
    if (cancellationPipeName) args.push('--cancellationPipeName', cancellationPipeName + '*');
    if (TsServerSpawner.isLoggingEnabled(configuration)) {
      if (isWeb()) {
        args.push('--logVerbosity', TsServerLogLevel.toString(configuration.tsServerLogLevel));
      } else {
        const logDir = this._logDirProvider.getNewLogDir();
        if (logDir) {
          tsServerLogFile = path.join(logDir, `tsserver.log`);
          args.push('--logVerbosity', TsServerLogLevel.toString(configuration.tsServerLogLevel));
          args.push('--logFile', tsServerLogFile);
        }
      }
    }
    if (configuration.enableTsServerTracing && !isWeb()) {
      tsServerTraceDir = this._logDirProvider.getNewLogDir();
      if (tsServerTraceDir) args.push('--traceDir', tsServerTraceDir);
    }
    if (!isWeb()) {
      const pluginPaths = this._pluginPathsProvider.getPluginPaths();
      if (pluginMgr.plugins.length) {
        args.push('--globalPlugins', pluginMgr.plugins.map((x) => x.name).join(','));
        const isUsingBundledTsVersion = currentVersion.path === this._versionProvider.defaultVersion.path;
        for (const plugin of pluginMgr.plugins) {
          if (isUsingBundledTsVersion || plugin.enableForWorkspaceTsVersions) pluginPaths.push(plugin.path);
        }
      }
      if (pluginPaths.length !== 0) args.push('--pluginProbeLocations', pluginPaths.join(','));
    }
    if (configuration.npmLocation) args.push('--npmLocation', `"${configuration.npmLocation}"`);
    if (apiVersion.gte(API.v260)) {
      args.push('--locale', TsServerSpawner.getTsLocale(configuration));
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
    return configuration.tsServerLogLevel !== TsServerLogLevel.Off;
  }
  private static getTsLocale(configuration: TSServiceConfig): string {
    return configuration.locale ? configuration.locale : qv.env.language;
  }
}
