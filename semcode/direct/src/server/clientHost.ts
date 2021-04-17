import * as qv from 'vscode';
import { DiagKind } from './languageFeatures/diagnostics';
import FileConfigMgr from './languageFeatures/fileConfigMgr';
import LangProvider from './providers/language';
import * as qp from './proto';
import * as qk from '../utils/key';
import { OngoingRequestCancelFact } from './tsServer/cancellation';
import { LogDirProvider } from './tsServer/logDirProvider';
import { TsServerProcFact } from './server';
import { TsVersionProvider } from './version';
import { VersionStatus } from './status';
import ServiceClient from '../client';
import {  } from './command';
import { errorCodes } from '../utils/base';
import { DiagLang, LangDescription } from '../utils/lang';
import { PluginMgr } from '../utils/plugins';
import { TypingsStatus, AtaProgressReporter, ProjectStatus } from './status';
import * as  from './utils/largeProjectStatus';
import { ActiveJsTsEditorTracker } from '../utils/tracker';
import { CommandMgr, Disposable, fileSchemes, flatten, Lazy } from '../utils/base';
import { standardLangDescriptions } from '../utils/lang';
import ManagedFileContextMgr from '../utils/context';

const styleCheckDiags = new Set([
  ...errorCodes.variableDeclaredButNeverUsed,
  ...errorCodes.propertyDeclaretedButNeverUsed,
  ...errorCodes.allImportsAreUnused,
  ...errorCodes.unreachableCode,
  ...errorCodes.unusedLabel,
  ...errorCodes.fallThroughCaseInSwitch,
  ...errorCodes.notAllCodePathsReturnAValue,
]);
export default class ServiceClientHost extends Disposable {
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
      versionProvider: TsVersionProvider;
      processFact: TsServerProcFact;
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
      this._ds
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
    this.client.onTsServerStarted(() => {
      this.triggerAllDiags();
    });
    qv.workspace.onDidChangeConfig(this.configurationChanged, this, this._ds);
    this.configurationChanged();
  }
  private registerExtensionLangProvider(d: LangDescription, onCompletionAccepted: (i: qv.CompletionItem) => void) {
    const manager = new LangProvider(this.client, d, this.commandMgr, this.client.telemetryReporter, this.typingsStatus, this.fileConfigMgr, onCompletionAccepted);
    this.languages.push(manager);
    this._register(manager);
    this.languagePerId.set(d.id, manager);
  }
  private getAllModeIds(ds: LangDescription[], m: PluginMgr) {
    const allModeIds = flatten([...ds.map((x) => x.modeIds), ...m.plugins.map((x) => x.languages)]);
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
  private async diagnosticsReceived(k: DiagKind, r: qv.Uri, ds: qp.Diagnostic[]): Promise<void> {
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
          const r = d.start && d.end ? Range.fromTextSpan(d) : new qv.Range(0, 0, 0, 1);
          const y = new qv.Diagnostic(r, b.diagnostics[0].text, this.getDiagnosticSeverity(d));
          y.source = l.diagnosticSource;
          return y;
        })
      );
    });
  }
  private createMarkerDatas(ds: qp.Diagnostic[], src: string): (qv.Diagnostic & { reportUnnecessary: any; reportDeprecated: any })[] {
    return ds.map((d) => this.tsDiagToVsDiag(d, src));
  }
  private tsDiagToVsDiag(d: qp.Diagnostic, src: string): qv.Diagnostic & { reportUnnecessary: any; reportDeprecated: any } {
    const { start, end, text } = d;
    const r = new qv.Range(Position.fromLocation(start), Position.fromLocation(end));
    const v = new qv.Diagnostic(r, text, this.getDiagnosticSeverity(d));
    v.source = d.source || src;
    if (d.code) v.code = d.code;
    const i = d.relatedInformation;
    if (i) {
      v.relatedInformation = coalesce(
        i.map((info: any) => {
          const s = info.span;
          if (!s) return undefined;
          return new qv.DiagnosticRelatedInformation(Location.fromTextSpan(this.client.toResource(s.file), s), info.message);
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
    if (this.reportStyleCheckAsWarnings && this.isStyleCheckDiag(d.code) && d.category === qk.DiagCategory.error) {
      return qv.DiagnosticSeverity.Warning;
    }
    switch (d.category) {
      case qk.DiagCategory.error:
        return qv.DiagnosticSeverity.Error;
      case qk.DiagCategory.warning:
        return qv.DiagnosticSeverity.Warning;
      case qk.DiagCategory.suggestion:
        return qv.DiagnosticSeverity.Hint;
      default:
        return qv.DiagnosticSeverity.Error;
    }
  }
  private isStyleCheckDiag(code?: number): boolean {
    return typeof code === 'number' && styleCheckDiags.has(code);
  }
}
export function createLazyClientHost(
  context: qv.ExtensionContext,
  onCaseInsensitiveFileSystem: boolean,
  services: {
    pluginMgr: PluginMgr;
    commandMgr: CommandMgr;
    logDirProvider: LogDirProvider;
    cancellerFact: OngoingRequestCancelFact;
    versionProvider: TsVersionProvider;
    processFact: TsServerProcFact;
    activeJsTsEditorTracker: ActiveJsTsEditorTracker;
  },
  onCompletionAccepted: (item: qv.CompletionItem) => void
): Lazy<ServiceClientHost> {
  return lazy(() => {
    const y = new ServiceClientHost(standardLangDescriptions, context, onCaseInsensitiveFileSystem, services, onCompletionAccepted);
    context.subscriptions.push(y);
    return y;
  });
}
export function lazilyActivateClient(h: Lazy<ServiceClientHost>, p: PluginMgr, t: ActiveJsTsEditorTracker): qv.Disposable {
  const disposables: qv.Disposable[] = [];
  const supportedLang = flatten([...standardLangDescriptions.map((x) => x.modeIds), ...p.plugins.map((x) => x.languages)]);
  let hasActivated = false;
  const maybeActivate = (d: qv.TextDocument): boolean => {
    if (!hasActivated && isSupportedDocument(supportedLang, d)) {
      hasActivated = true;
      void h.value;
      disposables.push(
        new ManagedFileContextMgr(t, (r) => {
          return h.value.serviceClient.toPath(r);
        })
      );
      return true;
    }
    return false;
  };
  const didActivate = qv.workspace.textDocuments.some(maybeActivate);
  if (!didActivate) {
    const openListener = qv.workspace.onDidOpenTextDocument(
      (d) => {
        if (maybeActivate(d)) openListener.dispose();
      },
      undefined,
      disposables
    );
  }
  return qv.Disposable.from(...disposables);
}
function isSupportedDocument(ls: readonly string[], d: qv.TextDocument): boolean {
  return ls.indexOf(d.languageId) >= 0 && !fileSchemes.disabledSchemes.has(d.uri.scheme);
}
