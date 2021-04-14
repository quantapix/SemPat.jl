import * as os from 'os';
import * as path from 'path';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ServiceClient, ServerResponse } from '../service';
import { nulToken } from '../utils';
export enum TSServerLogLevel {
  Off,
  Normal,
  Terse,
  Verbose,
}
export namespace TSServerLogLevel {
  export function fromString(value: string): TSServerLogLevel {
    switch (value && value.toLowerCase()) {
      case 'normal':
        return TSServerLogLevel.Normal;
      case 'terse':
        return TSServerLogLevel.Terse;
      case 'verbose':
        return TSServerLogLevel.Verbose;
      case 'off':
      default:
        return TSServerLogLevel.Off;
    }
  }
  export function toString(value: TSServerLogLevel): string {
    switch (value) {
      case TSServerLogLevel.Normal:
        return 'normal';
      case TSServerLogLevel.Terse:
        return 'terse';
      case TSServerLogLevel.Verbose:
        return 'verbose';
      case TSServerLogLevel.Off:
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
  constructor(configuration: qv.WorkspaceConfig) {
    this.checkJs = ImplicitProjectConfig.readCheckJs(configuration);
    this.experimentalDecorators = ImplicitProjectConfig.readExperimentalDecorators(configuration);
    this.strictNullChecks = ImplicitProjectConfig.readImplicitStrictNullChecks(configuration);
    this.strictFunctionTypes = ImplicitProjectConfig.readImplicitStrictFunctionTypes(configuration);
  }
  public isEqualTo(other: ImplicitProjectConfig): boolean {
    return qu.equals(this, other);
  }
  private static readCheckJs(configuration: qv.WorkspaceConfig): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.checkJs') ?? configuration.get<boolean>('javascript.implicitProjectConfig.checkJs', false);
  }
  private static readExperimentalDecorators(configuration: qv.WorkspaceConfig): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.experimentalDecorators') ?? configuration.get<boolean>('javascript.implicitProjectConfig.experimentalDecorators', false);
  }
  private static readImplicitStrictNullChecks(configuration: qv.WorkspaceConfig): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.strictNullChecks', false);
  }
  private static readImplicitStrictFunctionTypes(configuration: qv.WorkspaceConfig): boolean {
    return configuration.get<boolean>('js/ts.implicitProjectConfig.strictFunctionTypes', true);
  }
}
export class TSServiceConfig {
  public readonly locale: string | null;
  public readonly globalTsdk: string | null;
  public readonly localTsdk: string | null;
  public readonly npmLocation: string | null;
  public readonly tsServerLogLevel: TSServerLogLevel = TSServerLogLevel.Off;
  public readonly tsServerPluginPaths: readonly string[];
  public readonly implictProjectConfig: ImplicitProjectConfig;
  public readonly disableAutomaticTypeAcquisition: boolean;
  public readonly separateSyntaxServer: SeparateSyntaxServerConfig;
  public readonly enableProjectDiags: boolean;
  public readonly maxTSServerMemory: number;
  public readonly enablePromptUseWorkspaceTsdk: boolean;
  public readonly watchOptions: protocol.WatchOptions | undefined;
  public readonly includePackageJsonAutoImports: 'auto' | 'on' | 'off' | undefined;
  public readonly enableTSServerTracing: boolean;
  public static loadFromWorkspace(): TSServiceConfig {
    return new TSServiceConfig();
  }
  private constructor() {
    const configuration = qv.workspace.getConfig();
    this.locale = TSServiceConfig.extractLocale(configuration);
    this.globalTsdk = TSServiceConfig.extractGlobalTsdk(configuration);
    this.localTsdk = TSServiceConfig.extractLocalTsdk(configuration);
    this.npmLocation = TSServiceConfig.readNpmLocation(configuration);
    this.tsServerLogLevel = TSServiceConfig.readTSServerLogLevel(configuration);
    this.tsServerPluginPaths = TSServiceConfig.readTSServerPluginPaths(configuration);
    this.implictProjectConfig = new ImplicitProjectConfig(configuration);
    this.disableAutomaticTypeAcquisition = TSServiceConfig.readDisableAutomaticTypeAcquisition(configuration);
    this.separateSyntaxServer = TSServiceConfig.readUseSeparateSyntaxServer(configuration);
    this.enableProjectDiags = TSServiceConfig.readEnableProjectDiags(configuration);
    this.maxTSServerMemory = TSServiceConfig.readMaxTSServerMemory(configuration);
    this.enablePromptUseWorkspaceTsdk = TSServiceConfig.readEnablePromptUseWorkspaceTsdk(configuration);
    this.watchOptions = TSServiceConfig.readWatchOptions(configuration);
    this.includePackageJsonAutoImports = TSServiceConfig.readIncludePackageJsonAutoImports(configuration);
    this.enableTSServerTracing = TSServiceConfig.readEnableTSServerTracing(configuration);
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
  private static extractGlobalTsdk(configuration: qv.WorkspaceConfig): string | null {
    const inspect = configuration.inspect('typescript.tsdk');
    if (inspect && typeof inspect.globalValue === 'string') return this.fixPathPrefixes(inspect.globalValue);
    return null;
  }
  private static extractLocalTsdk(configuration: qv.WorkspaceConfig): string | null {
    const inspect = configuration.inspect('typescript.tsdk');
    if (inspect && typeof inspect.workspaceValue === 'string') return this.fixPathPrefixes(inspect.workspaceValue);
    return null;
  }
  private static readTSServerLogLevel(configuration: qv.WorkspaceConfig): TSServerLogLevel {
    const setting = configuration.get<string>('typescript.tsserver.log', 'off');
    return TSServerLogLevel.fromString(setting);
  }
  private static readTSServerPluginPaths(configuration: qv.WorkspaceConfig): string[] {
    return configuration.get<string[]>('typescript.tsserver.pluginPaths', []);
  }
  private static readNpmLocation(configuration: qv.WorkspaceConfig): string | null {
    return configuration.get<string | null>('typescript.npm', null);
  }
  private static readDisableAutomaticTypeAcquisition(configuration: qv.WorkspaceConfig): boolean {
    return configuration.get<boolean>('typescript.disableAutomaticTypeAcquisition', false);
  }
  private static extractLocale(configuration: qv.WorkspaceConfig): string | null {
    return configuration.get<string | null>('typescript.locale', null);
  }
  private static readUseSeparateSyntaxServer(configuration: qv.WorkspaceConfig): SeparateSyntaxServerConfig {
    const value = configuration.get('typescript.tsserver.useSeparateSyntaxServer', true);
    if (value === true) return SeparateSyntaxServerConfig.Enabled;
    return SeparateSyntaxServerConfig.Disabled;
  }
  private static readEnableProjectDiags(configuration: qv.WorkspaceConfig): boolean {
    return configuration.get<boolean>('typescript.tsserver.experimental.enableProjectDiags', false);
  }
  private static readWatchOptions(configuration: qv.WorkspaceConfig): protocol.WatchOptions | undefined {
    return configuration.get<protocol.WatchOptions>('typescript.tsserver.watchOptions');
  }
  private static readIncludePackageJsonAutoImports(configuration: qv.WorkspaceConfig): 'auto' | 'on' | 'off' | undefined {
    return configuration.get<'auto' | 'on' | 'off'>('typescript.preferences.includePackageJsonAutoImports');
  }
  private static readMaxTSServerMemory(configuration: qv.WorkspaceConfig): number {
    const defaultMaxMemory = 3072;
    const minimumMaxMemory = 128;
    const memoryInMB = configuration.get<number>('typescript.tsserver.maxTSServerMemory', defaultMaxMemory);
    if (!Number.isSafeInteger(memoryInMB)) {
      return defaultMaxMemory;
    }
    return Math.max(memoryInMB, minimumMaxMemory);
  }
  private static readEnablePromptUseWorkspaceTsdk(configuration: qv.WorkspaceConfig): boolean {
    return configuration.get<boolean>('typescript.enablePromptUseWorkspaceTsdk', false);
  }
  private static readEnableTSServerTracing(configuration: qv.WorkspaceConfig): boolean {
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
