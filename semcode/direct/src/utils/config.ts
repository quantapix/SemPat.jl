import * as os from 'os';
import * as path from 'path';
import * as qu from '../utils/base';
import * as qv from 'vscode';
import type * as qp from '../server/proto';
import { ServiceClient, ServerResponse } from '../server/service';
import { nulToken } from '../utils';
import { RevealOutputChannelOn } from 'vscode-languageclient';
import { getActiveChannel, RustupConfig } from './rs/rustup';

export enum TsServerLogLevel {
  Off,
  Normal,
  Terse,
  Verbose,
}
export namespace TsServerLogLevel {
  export function fromString(value: string): TsServerLogLevel {
    switch (value && value.toLowerCase()) {
      case 'normal':
        return TsServerLogLevel.Normal;
      case 'terse':
        return TsServerLogLevel.Terse;
      case 'verbose':
        return TsServerLogLevel.Verbose;
      case 'off':
      default:
        return TsServerLogLevel.Off;
    }
  }
  export function toString(value: TsServerLogLevel): string {
    switch (value) {
      case TsServerLogLevel.Normal:
        return 'normal';
      case TsServerLogLevel.Terse:
        return 'terse';
      case TsServerLogLevel.Verbose:
        return 'verbose';
      case TsServerLogLevel.Off:
      default:
        return 'off';
    }
  }
}
export const enum SeparateSyntaxServerConfig {
  Disabled,
  Enabled,
}
export class ImplicitProjectConfig {
  public readonly checkJs: boolean;
  public readonly experimentalDecorators: boolean;
  public readonly strictNullChecks: boolean;
  public readonly strictFunctionTypes: boolean;
  constructor(configuration: qv.WorkspaceConfiguration) {
    this.checkJs = ImplicitProjectConfig.readCheckJs(configuration);
    this.experimentalDecorators = ImplicitProjectConfig.readExperimentalDecorators(configuration);
    this.strictNullChecks = ImplicitProjectConfig.readImplicitStrictNullChecks(configuration);
    this.strictFunctionTypes = ImplicitProjectConfig.readImplicitStrictFunctionTypes(configuration);
  }
  public isEqualTo(other: ImplicitProjectConfig): boolean {
    return qu.equals(this, other);
  }
  private static readCheckJs(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.checkJs') ?? configuration.get<boolean>('javascript.implicitProjectConfig.checkJs', false);
  }
  private static readExperimentalDecorators(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.experimentalDecorators') ?? configuration.get<boolean>('javascript.implicitProjectConfig.experimentalDecorators', false);
  }
  private static readImplicitStrictNullChecks(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.strictNullChecks', false);
  }
  private static readImplicitStrictFunctionTypes(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.strictFunctionTypes', true);
  }
}
export class TSServiceConfig {
  public readonly locale: string | null;
  public readonly globalTsdk: string | null;
  public readonly localTsdk: string | null;
  public readonly npmLocation: string | null;
  public readonly tsServerLogLevel: TsServerLogLevel = TsServerLogLevel.Off;
  public readonly tsServerPluginPaths: readonly string[];
  public readonly implictProjectConfig: ImplicitProjectConfig;
  public readonly disableAutomaticTypeAcquisition: boolean;
  public readonly separateSyntaxServer: SeparateSyntaxServerConfig;
  public readonly enableProjectDiags: boolean;
  public readonly maxTsServerMemory: number;
  public readonly enablePromptUseWorkspaceTsdk: boolean;
  public readonly watchOptions: protocol.WatchOptions | undefined;
  public readonly includePackageJsonAutoImports: 'auto' | 'on' | 'off' | undefined;
  public readonly enableTsServerTracing: boolean;
  public static loadFromWorkspace(): TSServiceConfig {
    return new TSServiceConfig();
  }
  private constructor() {
    const configuration = qv.workspace.getConfig();
    this.locale = TSServiceConfig.extractLocale(configuration);
    this.globalTsdk = TSServiceConfig.extractGlobalTsdk(configuration);
    this.localTsdk = TSServiceConfig.extractLocalTsdk(configuration);
    this.npmLocation = TSServiceConfig.readNpmLocation(configuration);
    this.tsServerLogLevel = TSServiceConfig.readTsServerLogLevel(configuration);
    this.tsServerPluginPaths = TSServiceConfig.readTsServerPluginPaths(configuration);
    this.implictProjectConfig = new ImplicitProjectConfig(configuration);
    this.disableAutomaticTypeAcquisition = TSServiceConfig.readDisableAutomaticTypeAcquisition(configuration);
    this.separateSyntaxServer = TSServiceConfig.readUseSeparateSyntaxServer(configuration);
    this.enableProjectDiags = TSServiceConfig.readEnableProjectDiags(configuration);
    this.maxTsServerMemory = TSServiceConfig.readMaxTsServerMemory(configuration);
    this.enablePromptUseWorkspaceTsdk = TSServiceConfig.readEnablePromptUseWorkspaceTsdk(configuration);
    this.watchOptions = TSServiceConfig.readWatchOptions(configuration);
    this.includePackageJsonAutoImports = TSServiceConfig.readIncludePackageJsonAutoImports(configuration);
    this.enableTsServerTracing = TSServiceConfig.readEnableTsServerTracing(configuration);
  }
  public isEqualTo(other: TSServiceConfig): boolean {
    return qu.equals(this, other);
  }
  private static fixPathPrefixes(inspectValue: string): string {
    const pathPrefixes = ['~' + path.sep];
    for (const pathPrefix of pathPrefixes) {
      if (inspectValue.startsWith(pathPrefix)) {
        return path.join(os.homedir(), inspectValue.slice(pathPrefix.length));
      }
    }
    return inspectValue;
  }
  private static extractGlobalTsdk(configuration: qv.WorkspaceConfiguration): string | null {
    const inspect = configuration.inspect('typescript.tsdk');
    if (inspect && typeof inspect.globalValue === 'string') return this.fixPathPrefixes(inspect.globalValue);
    return null;
  }
  private static extractLocalTsdk(configuration: qv.WorkspaceConfiguration): string | null {
    const inspect = configuration.inspect('typescript.tsdk');
    if (inspect && typeof inspect.workspaceValue === 'string') return this.fixPathPrefixes(inspect.workspaceValue);
    return null;
  }
  private static readTsServerLogLevel(configuration: qv.WorkspaceConfiguration): TsServerLogLevel {
    const setting = configuration.get<string>('typescript.tsserver.log', 'off');
    return TsServerLogLevel.fromString(setting);
  }
  private static readTsServerPluginPaths(configuration: qv.WorkspaceConfiguration): string[] {
    return configuration.get<string[]>('typescript.tsserver.pluginPaths', []);
  }
  private static readNpmLocation(configuration: qv.WorkspaceConfiguration): string | null {
    return configuration.get<string | null>('typescript.npm', null);
  }
  private static readDisableAutomaticTypeAcquisition(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('typescript.disableAutomaticTypeAcquisition', false);
  }
  private static extractLocale(configuration: qv.WorkspaceConfiguration): string | null {
    return configuration.get<string | null>('typescript.locale', null);
  }
  private static readUseSeparateSyntaxServer(configuration: qv.WorkspaceConfiguration): SeparateSyntaxServerConfig {
    const value = configuration.get('typescript.tsserver.useSeparateSyntaxServer', true);
    if (value === true) return SeparateSyntaxServerConfig.Enabled;
    return SeparateSyntaxServerConfig.Disabled;
  }
  private static readEnableProjectDiags(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('typescript.tsserver.experimental.enableProjectDiags', false);
  }
  private static readWatchOptions(configuration: qv.WorkspaceConfiguration): protocol.WatchOptions | undefined {
    return configuration.get<protocol.WatchOptions>('typescript.tsserver.watchOptions');
  }
  private static readIncludePackageJsonAutoImports(configuration: qv.WorkspaceConfiguration): 'auto' | 'on' | 'off' | undefined {
    return configuration.get<'auto' | 'on' | 'off'>('typescript.preferences.includePackageJsonAutoImports');
  }
  private static readMaxTsServerMemory(configuration: qv.WorkspaceConfiguration): number {
    const defaultMaxMemory = 3072;
    const minimumMaxMemory = 128;
    const memoryInMB = configuration.get<number>('typescript.tsserver.maxTsServerMemory', defaultMaxMemory);
    if (!Number.isSafeInteger(memoryInMB)) {
      return defaultMaxMemory;
    }
    return Math.max(memoryInMB, minimumMaxMemory);
  }
  private static readEnablePromptUseWorkspaceTsdk(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('typescript.enablePromptUseWorkspaceTsdk', false);
  }
  private static readEnableTsServerTracing(configuration: qv.WorkspaceConfiguration): boolean {
    return configuration.get<boolean>('typescript.tsserver.enableTracing', false);
  }
}
export const enum ProjectType {
  TypeScript,
  JavaScript,
}
export function isImplicitProjectConfigFile(configFileName: string) {
  return configFileName.startsWith('/dev/null/');
}
export function inferredProjectCompilerOptions(projectType: ProjectType, serviceConfig: TSServiceConfig): qp.ExternalProjectCompilerOptions {
  const projectConfig: qp.ExternalProjectCompilerOptions = {
    module: 'commonjs' as qp.ModuleKind,
    target: 'es2016' as qp.ScriptTarget,
    jsx: 'preserve' as qp.JsxEmit,
  };
  if (serviceConfig.implictProjectConfig.checkJs) {
    projectConfig.checkJs = true;
    if (projectType === ProjectType.TypeScript) projectConfig.allowJs = true;
  }
  if (serviceConfig.implictProjectConfig.experimentalDecorators) projectConfig.experimentalDecorators = true;
  if (serviceConfig.implictProjectConfig.strictNullChecks) projectConfig.strictNullChecks = true;
  if (serviceConfig.implictProjectConfig.strictFunctionTypes) projectConfig.strictFunctionTypes = true;
  if (projectType === ProjectType.TypeScript) projectConfig.sourceMap = true;
  return projectConfig;
}
function inferredProjectConfigSnippet(projectType: ProjectType, config: TSServiceConfig) {
  const baseConfig = inferredProjectCompilerOptions(projectType, config);
  const compilerOptions = Object.keys(baseConfig).map((key) => `"${key}": ${JSON.stringify(baseConfig[key])}`);
  return new qv.SnippetString(`{
	"compilerOptions": {
		${compilerOptions.join(',\n\t\t')}$0
	},
	"exclude": [
		"node_modules",
		"**/node_modules/*"
	]
}`);
}
export async function openOrCreateConfig(projectType: ProjectType, rootPath: string, configuration: TSServiceConfig): Promise<qv.TextEditor | null> {
  const configFile = qv.Uri.file(path.join(rootPath, projectType === ProjectType.TypeScript ? 'tsconfig.json' : 'jsconfig.json'));
  const col = qv.window.activeTextEditor?.viewColumn;
  try {
    const doc = await qv.workspace.openTextDocument(configFile);
    return qv.window.showTextDocument(doc, col);
  } catch {
    const doc = await qv.workspace.openTextDocument(configFile.with({ scheme: 'untitled' }));
    const editor = await qv.window.showTextDocument(doc, col);
    if (editor.document.getText().length === 0) {
      await editor.insertSnippet(inferredProjectConfigSnippet(projectType, configuration));
    }
    return editor;
  }
}
export async function openProjectConfigOrPromptToCreate(projectType: ProjectType, client: ServiceClient, rootPath: string, configFileName: string): Promise<void> {
  if (!isImplicitProjectConfigFile(configFileName)) {
    const doc = await qv.workspace.openTextDocument(configFileName);
    qv.window.showTextDocument(doc, qv.window.activeTextEditor?.viewColumn);
    return;
  }
  const CreateConfigItem: qv.MessageItem = {
    title: projectType === ProjectType.TypeScript ? 'typescript.configureTsconfigQuickPick' : 'typescript.configureJsconfigQuickPick',
  };
  const selected = await qv.window.showInformationMessage(projectType === ProjectType.TypeScript ? 'typescript.noTypeScriptProjectConfig' : 'typescript.noJavaScriptProjectConfig', CreateConfigItem);
  switch (selected) {
    case CreateConfigItem:
      openOrCreateConfig(projectType, rootPath, client.configuration);
      return;
  }
}
export async function openProjectConfigForFile(projectType: ProjectType, client: ServiceClient, resource: qv.Uri): Promise<void> {
  const rootPath = client.getWorkspaceRootForResource(resource);
  if (!rootPath) {
    qv.window.showInformationMessage('typescript.projectConfigNoWorkspace');
    return;
  }
  const file = client.toPath(resource);
  if (!file || !(await client.toPath(resource))) {
    qv.window.showWarningMessage('typescript.projectConfigUnsupportedFile');
    return;
  }
  let res: ServerResponse.Response<protocol.ProjectInfoResponse> | undefined;
  try {
    res = await client.execute('projectInfo', { file, needFileNameList: false }, nulToken);
  } catch {}
  if (res?.type !== 'response' || !res.body) {
    qv.window.showWarningMessage('typescript.projectConfigCouldNotGetInfo');
    return;
  }
  return openProjectConfigOrPromptToCreate(projectType, client, rootPath, res.body.configFileName);
}

function fromStringToRevealOutputChannelOn(s: string): RevealOutputChannelOn {
  switch (s && s.toLowerCase()) {
    case 'info':
      return RevealOutputChannelOn.Info;
    case 'warn':
      return RevealOutputChannelOn.Warn;
    case 'error':
      return RevealOutputChannelOn.Error;
    case 'never':
    default:
      return RevealOutputChannelOn.Never;
  }
}
export class RLSConfig {
  private readonly configuration: qv.WorkspaceConfiguration;
  private readonly wsPath: string;
  private constructor(c: qv.WorkspaceConfiguration, p: string) {
    this.configuration = c;
    this.wsPath = p;
  }
  public static loadFromWorkspace(p: string): RLSConfig {
    const c = qv.workspace.getConfig();
    return new RLSConfig(c, p);
  }
  private static readRevealOutputChannelOn(c: qv.WorkspaceConfiguration) {
    const y = c.get<string>('rust-client.revealOutputChannelOn', 'never');
    return fromStringToRevealOutputChannelOn(y);
  }
  private static readChannel(wsPath: string, rustupPath: string, c: qv.WorkspaceConfiguration): string {
    const ch = c.get<string>('rust-client.channel');
    if (ch === 'default' || !ch) {
      try {
        return getActiveChannel(wsPath, rustupPath);
      } catch (e) {
        return 'nightly';
      }
    } else return ch;
  }
  public get rustupPath(): string {
    return this.configuration.get('rust-client.rustupPath', 'rustup');
  }
  public get logToFile(): boolean {
    return this.configuration.get<boolean>('rust-client.logToFile', false);
  }
  public get rustupDisabled(): boolean {
    const y = Boolean(this.rlsPath);
    return y || this.configuration.get<boolean>('rust-client.disableRustup', false);
  }
  public get rustAnalyzer(): { path?: string; releaseTag: string } {
    const c = this.configuration;
    const releaseTag = c.get('rust.rust-analyzer.releaseTag', 'nightly');
    const path = c.get<string>('rust.rust-analyzer.path');
    return { releaseTag, ...{ path } };
  }
  public get revealOutputChannelOn(): RevealOutputChannelOn {
    return RLSConfig.readRevealOutputChannelOn(this.configuration);
  }
  public get updateOnStartup(): boolean {
    return this.configuration.get<boolean>('rust-client.updateOnStartup', true);
  }
  public get channel(): string {
    return RLSConfig.readChannel(this.wsPath, this.rustupPath, this.configuration);
  }
  public get rlsPath(): string | undefined {
    return this.configuration.get<string>('rust-client.rlsPath');
  }
  public get engine(): 'rls' | 'rust-analyzer' {
    return this.configuration.get('rust-client.engine') || 'rls';
  }
  public get autoStartRls(): boolean {
    return this.configuration.get<boolean>('rust-client.autoStartRls', true);
  }
  public rustupConfig(): RustupConfig {
    return { channel: this.channel, path: this.rustupPath };
  }
}
