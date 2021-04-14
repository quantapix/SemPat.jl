import * as qv from 'vscode';
import { DiagKind } from './languageFeatures/diagnostics';
import FileConfigMgr from './languageFeatures/fileConfigMgr';
import LangProvider from './providers/language';
import * as qp from './protocol';
import * as qk from './utils/key';
import { OngoingRequestCancelFact } from './tsServer/cancellation';
import { LogDirProvider } from './tsServer/logDirProvider';
import { TSServerProcFact } from './tsServer/server';
import { TSVersionProvider } from './tsServer/versionProvider';
import VersionStatus from './tsServer/versionStatus';
import ServiceClient from './client';
import { CommandMgr } from './commands/commandMgr';
import * as errorCodes from './utils/errorCodes';
import { DiagLang, LangDescription } from './utils/languageDescription';
import { PluginMgr } from './utils/plugins';
import * as qu from './utils';
import TypingsStatus, { AtaProgressReporter } from './utils/typingsStatus';
import * as ProjectStatus from './utils/largeProjectStatus';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';

const styleCheckDiags = new Set([
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
  private readonly languages: LangProvider[] = [];
  private readonly languagePerId = new Map<string, LangProvider>();
  private readonly typingsStatus: TypingsStatus;
  private readonly fileConfigMgr: FileConfigMgr;
  private reportStyleCheckAsWarnings: boolean = true;
  private readonly commandMgr: CommandMgr;

  constructor(
    descriptions: LangDescription[],
    context: qv.ExtensionContext,
    onCaseInsenitiveFileSystem: boolean,
    services: {
      pluginMgr: PluginMgr;
      commandMgr: CommandMgr;
      logDirProvider: LogDirProvider;
      cancellerFact: OngoingRequestCancelFact;
      versionProvider: TSVersionProvider;
      processFact: TSServerProcFact;
      activeJsTsEditorTracker: ActiveJsTsEditorTracker;
    },
    onCompletionAccepted: (item: qv.CompletionItem) => void
  ) {
    super();
    this.commandMgr = services.commandMgr;
    const allModeIds = this.getAllModeIds(descriptions, services.pluginMgr);
    this.client = this._register(new ServiceClient(context, onCaseInsenitiveFileSystem, services, allModeIds));
    this.client.onDiagsReceived(
      ({ kind, resource, diagnostics }) => {
        this.diagnosticsReceived(kind, resource, diagnostics);
      },
      null,
      this._disposables
    );
    this.client.onConfigDiagsReceived((diag) => this.configFileDiagsReceived(diag), null, this._disposables);
    this.client.onResendModelsRequested(() => this.populateService(), null, this._disposables);
    this._register(new VersionStatus(this.client, services.commandMgr, services.activeJsTsEditorTracker));
    this._register(new AtaProgressReporter(this.client));
    this.typingsStatus = this._register(new TypingsStatus(this.client));
    this._register(ProjectStatus.create(this.client));
    this.fileConfigMgr = this._register(new FileConfigMgr(this.client, onCaseInsenitiveFileSystem));
    for (const description of descriptions) {
      const p = new LangProvider(this.client, description, this.commandMgr, this.client.telemetryReporter, this.typingsStatus, this.fileConfigMgr, onCompletionAccepted);
      this.languages.push(p);
      this._register(p);
      this.languagePerId.set(description.id, p);
    }
    import('./languageFeatures/updatePathsOnRename').then((module) => this._register(module.register(this.client, this.fileConfigMgr, (r) => this.handles(r))));
    import('../../src/providers/workspaceSymbols').then((module) => this._register(module.register(this.client, allModeIds)));
    this.client.ensureServiceStarted();
    this.client.onReady(() => {
      const languages = new Set<string>();
      for (const plugin of services.pluginMgr.plugins) {
        if (plugin.configNamespace && plugin.languages.length) {
          this.registerExtensionLangProvider(
            {
              id: plugin.configNamespace,
              modeIds: Array.from(plugin.languages),
              diagnosticSource: 'ts-plugin',
              diagnosticLang: DiagLang.TypeScript,
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
        this.registerExtensionLangProvider(
          {
            id: 'typescript-plugins',
            modeIds: Array.from(languages.values()),
            diagnosticSource: 'ts-plugin',
            diagnosticLang: DiagLang.TypeScript,
            diagnosticOwner: 'typescript',
            isExternal: true,
          },
          onCompletionAccepted
        );
      }
    });
    this.client.onTSServerStarted(() => {
      this.triggerAllDiags();
    });
    qv.workspace.onDidChangeConfig(this.configurationChanged, this, this._disposables);
    this.configurationChanged();
  }

  private registerExtensionLangProvider(d: LangDescription, onCompletionAccepted: (i: qv.CompletionItem) => void) {
    const manager = new LangProvider(this.client, d, this.commandMgr, this.client.telemetryReporter, this.typingsStatus, this.fileConfigMgr, onCompletionAccepted);
    this.languages.push(manager);
    this._register(manager);
    this.languagePerId.set(d.id, manager);
  }

  private getAllModeIds(ds: LangDescription[], m: PluginMgr) {
    const allModeIds = qu.flatten([...ds.map((x) => x.modeIds), ...m.plugins.map((x) => x.languages)]);
    return allModeIds;
  }

  public get serviceClient(): ServiceClient {
    return this.client;
  }

  public reloadProjects(): void {
    this.client.executeWithoutWaitingForResponse('reloadProjects', null);
    this.triggerAllDiags();
  }

  public async handles(r: qv.Uri): Promise<boolean> {
    const provider = await this.findLang(r);
    if (provider) return true;
    return this.client.bufferSyncSupport.handles(r);
  }

  private configurationChanged(): void {
    const c = qv.workspace.getConfig('typescript');
    this.reportStyleCheckAsWarnings = c.get('reportStyleChecksAsWarnings', true);
  }

  private async findLang(r: qv.Uri): Promise<LangProvider | undefined> {
    try {
      const d = await qv.workspace.openTextDocument(r);
      return this.languages.find((l) => l.handles(r, d));
    } catch {
      return undefined;
    }
  }

  private triggerAllDiags() {
    for (const l of this.languagePerId.values()) {
      l.triggerAllDiags();
    }
  }

  private populateService(): void {
    this.fileConfigMgr.reset();
    for (const l of this.languagePerId.values()) {
      l.reInitialize();
    }
  }

  private async diagnosticsReceived(k: DiagKind, r: qv.Uri, ds: qp.Diag[]): Promise<void> {
    const l = await this.findLang(r);
    if (l) l.diagnosticsReceived(k, r, this.createMarkerDatas(ds, l.diagnosticSource));
  }

  private configFileDiagsReceived(e: qp.ConfigFileDiagEvent): void {
    const b = e.body;
    if (!b || !b.diagnostics || !b.configFile) return;
    this.findLang(this.client.toResource(b.configFile)).then((l) => {
      if (!l) return;
      l.configFileDiagsReceived(
        this.client.toResource(b.configFile),
        b.diagnostics.map((d) => {
          const r = d.start && d.end ? qu.Range.fromTextSpan(d) : new qv.Range(0, 0, 0, 1);
          const y = new qv.Diag(r, b.diagnostics[0].text, this.getDiagSeverity(d));
          y.source = l.diagnosticSource;
          return y;
        })
      );
    });
  }

  private createMarkerDatas(ds: qp.Diag[], src: string): (qv.Diag & { reportUnnecessary: any; reportDeprecated: any })[] {
    return ds.map((d) => this.tsDiagToVsDiag(d, src));
  }

  private tsDiagToVsDiag(d: qp.Diag, src: string): qv.Diag & { reportUnnecessary: any; reportDeprecated: any } {
    const { start, end, text } = d;
    const r = new qv.Range(qu.Position.fromLocation(start), qu.Position.fromLocation(end));
    const v = new qv.Diag(r, text, this.getDiagSeverity(d));
    v.source = d.source || src;
    if (d.code) v.code = d.code;
    const i = d.relatedInformation;
    if (i) {
      v.relatedInformation = qu.coalesce(
        i.map((info: any) => {
          const s = info.span;
          if (!s) return undefined;
          return new qv.DiagRelatedInformation(qu.Location.fromTextSpan(this.client.toResource(s.file), s), info.message);
        })
      );
    }
    const ts: qv.DiagTag[] = [];
    if (d.reportsUnnecessary) ts.push(qv.DiagTag.Unnecessary);
    if (d.reportsDeprecated) ts.push(qv.DiagTag.Deprecated);
    v.tags = ts.length ? ts : undefined;
    const y = v as qv.Diag & { reportUnnecessary: any; reportDeprecated: any };
    y.reportUnnecessary = d.reportsUnnecessary;
    y.reportDeprecated = d.reportsDeprecated;
    return y;
  }

  private getDiagSeverity(d: qp.Diag): qv.DiagSeverity {
    if (this.reportStyleCheckAsWarnings && this.isStyleCheckDiag(d.code) && d.category === qk.DiagCategory.error) {
      return qv.DiagSeverity.Warning;
    }
    switch (d.category) {
      case qk.DiagCategory.error:
        return qv.DiagSeverity.Error;
      case qk.DiagCategory.warning:
        return qv.DiagSeverity.Warning;
      case qk.DiagCategory.suggestion:
        return qv.DiagSeverity.Hint;
      default:
        return qv.DiagSeverity.Error;
    }
  }

  private isStyleCheckDiag(code?: number): boolean {
    return typeof code === 'number' && styleCheckDiags.has(code);
  }
}
