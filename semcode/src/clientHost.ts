import * as qv from 'vscode';
import { DiagnosticKind } from './languageFeatures/diagnostics';
import FileConfigurationManager from './languageFeatures/fileConfigurationManager';
import LanguageProvider from './providers/language';
import * as qp from './protocol';
import * as PConst from './protocol.const';
import { OngoingRequestCancellerFactory } from './tsServer/cancellation';
import { ILogDirectoryProvider } from './tsServer/logDirectoryProvider';
import { TsServerProcessFactory } from './tsServer/server';
import { ITypeScriptVersionProvider } from './tsServer/versionProvider';
import VersionStatus from './tsServer/versionStatus';
import ServiceClient from './client';
import { CommandManager } from './commands/commandManager';
import * as errorCodes from './utils/errorCodes';
import { DiagnosticLanguage, LanguageDescription } from './utils/languageDescription';
import { PluginManager } from './utils/plugins';
import * as qu from './utils';
import TypingsStatus, { AtaProgressReporter } from './utils/typingsStatus';
import * as ProjectStatus from './utils/largeProjectStatus';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';

const styleCheckDiagnostics = new Set([
  ...errorCodes.variableDeclaredButNeverUsed,
  ...errorCodes.propertyDeclaretedButNeverUsed,
  ...errorCodes.allImportsAreUnused,
  ...errorCodes.unreachableCode,
  ...errorCodes.unusedLabel,
  ...errorCodes.fallThroughCaseInSwitch,
  ...errorCodes.notAllCodePathsReturnAValue,
]);

export default class ServiceClientHost extends qu.Disposable {
  private readonly client: ServiceClient;
  private readonly languages: LanguageProvider[] = [];
  private readonly languagePerId = new Map<string, LanguageProvider>();
  private readonly typingsStatus: TypingsStatus;
  private readonly fileConfigurationManager: FileConfigurationManager;
  private reportStyleCheckAsWarnings: boolean = true;
  private readonly commandManager: CommandManager;

  constructor(
    descriptions: LanguageDescription[],
    context: qv.ExtensionContext,
    onCaseInsenitiveFileSystem: boolean,
    services: {
      pluginManager: PluginManager;
      commandManager: CommandManager;
      logDirectoryProvider: ILogDirectoryProvider;
      cancellerFactory: OngoingRequestCancellerFactory;
      versionProvider: ITypeScriptVersionProvider;
      processFactory: TsServerProcessFactory;
      activeJsTsEditorTracker: ActiveJsTsEditorTracker;
    },
    onCompletionAccepted: (item: qv.CompletionItem) => void
  ) {
    super();
    this.commandManager = services.commandManager;
    const allModeIds = this.getAllModeIds(descriptions, services.pluginManager);
    this.client = this._register(new ServiceClient(context, onCaseInsenitiveFileSystem, services, allModeIds));
    this.client.onDiagnosticsReceived(
      ({ kind, resource, diagnostics }) => {
        this.diagnosticsReceived(kind, resource, diagnostics);
      },
      null,
      this._disposables
    );
    this.client.onConfigDiagnosticsReceived((diag) => this.configFileDiagnosticsReceived(diag), null, this._disposables);
    this.client.onResendModelsRequested(() => this.populateService(), null, this._disposables);
    this._register(new VersionStatus(this.client, services.commandManager, services.activeJsTsEditorTracker));
    this._register(new AtaProgressReporter(this.client));
    this.typingsStatus = this._register(new TypingsStatus(this.client));
    this._register(ProjectStatus.create(this.client));
    this.fileConfigurationManager = this._register(new FileConfigurationManager(this.client, onCaseInsenitiveFileSystem));
    for (const description of descriptions) {
      const p = new LanguageProvider(this.client, description, this.commandManager, this.client.telemetryReporter, this.typingsStatus, this.fileConfigurationManager, onCompletionAccepted);
      this.languages.push(p);
      this._register(p);
      this.languagePerId.set(description.id, p);
    }
    import('./languageFeatures/updatePathsOnRename').then((module) => this._register(module.register(this.client, this.fileConfigurationManager, (r) => this.handles(r))));
    import('../../src/providers/workspaceSymbols').then((module) => this._register(module.register(this.client, allModeIds)));
    this.client.ensureServiceStarted();
    this.client.onReady(() => {
      const languages = new Set<string>();
      for (const plugin of services.pluginManager.plugins) {
        if (plugin.configNamespace && plugin.languages.length) {
          this.registerExtensionLanguageProvider(
            {
              id: plugin.configNamespace,
              modeIds: Array.from(plugin.languages),
              diagnosticSource: 'ts-plugin',
              diagnosticLanguage: DiagnosticLanguage.TypeScript,
              diagnosticOwner: 'typescript',
              isExternal: true,
            },
            onCompletionAccepted
          );
        } else {
          for (const language of plugin.languages) {
            languages.add(language);
          }
        }
      }
      if (languages.size) {
        this.registerExtensionLanguageProvider(
          {
            id: 'typescript-plugins',
            modeIds: Array.from(languages.values()),
            diagnosticSource: 'ts-plugin',
            diagnosticLanguage: DiagnosticLanguage.TypeScript,
            diagnosticOwner: 'typescript',
            isExternal: true,
          },
          onCompletionAccepted
        );
      }
    });
    this.client.onTsServerStarted(() => {
      this.triggerAllDiagnostics();
    });
    qv.workspace.onDidChangeConfiguration(this.configurationChanged, this, this._disposables);
    this.configurationChanged();
  }

  private registerExtensionLanguageProvider(d: LanguageDescription, onCompletionAccepted: (i: qv.CompletionItem) => void) {
    const manager = new LanguageProvider(this.client, d, this.commandManager, this.client.telemetryReporter, this.typingsStatus, this.fileConfigurationManager, onCompletionAccepted);
    this.languages.push(manager);
    this._register(manager);
    this.languagePerId.set(d.id, manager);
  }

  private getAllModeIds(ds: LanguageDescription[], m: PluginManager) {
    const allModeIds = qu.flatten([...ds.map((x) => x.modeIds), ...m.plugins.map((x) => x.languages)]);
    return allModeIds;
  }

  public get serviceClient(): ServiceClient {
    return this.client;
  }

  public reloadProjects(): void {
    this.client.executeWithoutWaitingForResponse('reloadProjects', null);
    this.triggerAllDiagnostics();
  }

  public async handles(r: qv.Uri): Promise<boolean> {
    const provider = await this.findLanguage(r);
    if (provider) return true;
    return this.client.bufferSyncSupport.handles(r);
  }

  private configurationChanged(): void {
    const c = qv.workspace.getConfiguration('typescript');
    this.reportStyleCheckAsWarnings = c.get('reportStyleChecksAsWarnings', true);
  }

  private async findLanguage(r: qv.Uri): Promise<LanguageProvider | undefined> {
    try {
      const d = await qv.workspace.openTextDocument(r);
      return this.languages.find((l) => l.handles(r, d));
    } catch {
      return undefined;
    }
  }

  private triggerAllDiagnostics() {
    for (const l of this.languagePerId.values()) {
      l.triggerAllDiagnostics();
    }
  }

  private populateService(): void {
    this.fileConfigurationManager.reset();
    for (const l of this.languagePerId.values()) {
      l.reInitialize();
    }
  }

  private async diagnosticsReceived(k: DiagnosticKind, r: qv.Uri, ds: qp.Diagnostic[]): Promise<void> {
    const l = await this.findLanguage(r);
    if (l) l.diagnosticsReceived(k, r, this.createMarkerDatas(ds, l.diagnosticSource));
  }

  private configFileDiagnosticsReceived(e: qp.ConfigFileDiagnosticEvent): void {
    const b = e.body;
    if (!b || !b.diagnostics || !b.configFile) return;
    this.findLanguage(this.client.toResource(b.configFile)).then((l) => {
      if (!l) return;
      l.configFileDiagnosticsReceived(
        this.client.toResource(b.configFile),
        b.diagnostics.map((d) => {
          const r = d.start && d.end ? qu.Range.fromTextSpan(d) : new qv.Range(0, 0, 0, 1);
          const y = new qv.Diagnostic(r, b.diagnostics[0].text, this.getDiagnosticSeverity(d));
          y.source = l.diagnosticSource;
          return y;
        })
      );
    });
  }

  private createMarkerDatas(ds: qp.Diagnostic[], src: string): (qv.Diagnostic & { reportUnnecessary: any; reportDeprecated: any })[] {
    return ds.map((d) => this.tsDiagnosticToVsDiagnostic(d, src));
  }

  private tsDiagnosticToVsDiagnostic(d: qp.Diagnostic, src: string): qv.Diagnostic & { reportUnnecessary: any; reportDeprecated: any } {
    const { start, end, text } = d;
    const r = new qv.Range(qu.Position.fromLocation(start), qu.Position.fromLocation(end));
    const v = new qv.Diagnostic(r, text, this.getDiagnosticSeverity(d));
    v.source = d.source || src;
    if (d.code) v.code = d.code;
    const i = d.relatedInformation;
    if (i) {
      v.relatedInformation = qu.coalesce(
        i.map((info: any) => {
          const s = info.span;
          if (!s) return undefined;
          return new qv.DiagnosticRelatedInformation(qu.Location.fromTextSpan(this.client.toResource(s.file), s), info.message);
        })
      );
    }
    const ts: qv.DiagnosticTag[] = [];
    if (d.reportsUnnecessary) ts.push(qv.DiagnosticTag.Unnecessary);
    if (d.reportsDeprecated) ts.push(qv.DiagnosticTag.Deprecated);
    v.tags = ts.length ? ts : undefined;
    const y = v as qv.Diagnostic & { reportUnnecessary: any; reportDeprecated: any };
    y.reportUnnecessary = d.reportsUnnecessary;
    y.reportDeprecated = d.reportsDeprecated;
    return y;
  }

  private getDiagnosticSeverity(d: qp.Diagnostic): qv.DiagnosticSeverity {
    if (this.reportStyleCheckAsWarnings && this.isStyleCheckDiagnostic(d.code) && d.category === PConst.DiagnosticCategory.error) {
      return qv.DiagnosticSeverity.Warning;
    }
    switch (d.category) {
      case PConst.DiagnosticCategory.error:
        return qv.DiagnosticSeverity.Error;
      case PConst.DiagnosticCategory.warning:
        return qv.DiagnosticSeverity.Warning;
      case PConst.DiagnosticCategory.suggestion:
        return qv.DiagnosticSeverity.Hint;
      default:
        return qv.DiagnosticSeverity.Error;
    }
  }

  private isStyleCheckDiagnostic(code?: number): boolean {
    return typeof code === 'number' && styleCheckDiagnostics.has(code);
  }
}
