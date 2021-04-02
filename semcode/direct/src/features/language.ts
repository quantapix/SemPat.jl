import { basename } from 'path';
import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { CommandMgr } from '../../old/ts/commands/commandMgr';
import { DiagKind } from '../../old/ts/languageFeatures/diagnostics';
import { LangDescription } from '../../old/ts/utils/languageDescription';
import { TelemetryReporter } from '../../old/ts/utils/telemetry';
import * as qu from '../utils';
import * as qv from 'vscode';
import FileConfigMgr from '../../old/ts/languageFeatures/fileConfigMgr';
import TypeScriptServiceClient from '../client';
import TypingsStatus from '../../old/ts/utils/typingsStatus';

const validateSetting = 'validate.enable';
const suggestionSetting = 'suggestionActions.enabled';

export default class LangProvider extends qu.Disposable {
  constructor(
    private readonly client: TypeScriptServiceClient,
    private readonly description: LangDescription,
    private readonly commandMgr: CommandMgr,
    private readonly telemetryReporter: TelemetryReporter,
    private readonly typingsStatus: TypingsStatus,
    private readonly fileConfigMgr: FileConfigMgr,
    private readonly onCompletionAccepted: (item: qv.CompletionItem) => void
  ) {
    super();
    qv.workspace.onDidChangeConfig(this.configurationChanged, this, this._disposables);
    this.configurationChanged();
    client.onReady(() => this.registerProviders());
  }

  private get documentSelector(): qu.DocumentSelector {
    const semantic: qv.DocumentFilter[] = [];
    const syntax: qv.DocumentFilter[] = [];
    for (const language of this.description.modeIds) {
      syntax.push({ language });
      for (const scheme of qu.semanticSupportedSchemes) {
        semantic.push({ language, scheme });
      }
    }
    return { semantic, syntax };
  }

  private async registerProviders(): Promise<void> {
    const s = this.documentSelector;
    const c = new CachedResponse();
    await Promise.all([
      import('./hover').then((m) => this._register(m.register(s, this.client))),
      import('./definition').then((m) => this._register(m.register(s, this.client))),
      import('./hierarchy').then((m) => this._register(m.register(s, this.client))),
      import('../../old/ts/languageFeatures/codeLens/implementationsCodeLens').then((provider) => this._register(provider.register(s, this.description.id, this.client, c))),
      import('../../old/ts/languageFeatures/codeLens/referencesCodeLens').then((provider) => this._register(provider.register(s, this.description.id, this.client, c))),
      import('../../old/ts/languageFeatures/completions').then((provider) =>
        this._register(provider.register(s, this.description.id, this.client, this.typingsStatus, this.fileConfigMgr, this.commandMgr, this.telemetryReporter, this.onCompletionAccepted))
      ),
      import('../../old/ts/languageFeatures/directiveCommentCompletions').then((provider) => this._register(provider.register(s, this.client))),
      import('./highlight').then((m) => this._register(m.register(s, this.client))),
      import('./symbol').then((m) => this._register(m.register(s, this.client, c))),
      import('../../old/ts/languageFeatures/fileReferences').then((provider) => this._register(provider.register(this.client, this.commandMgr))),
      import('./fixAll').then((provider) => this._register(provider.register(s, this.client, this.fileConfigMgr, this.client.diagnosticsMgr))),
      import('./folding').then((m) => this._register(m.register(s, this.client))),
      import('./formatting').then((m) => this._register(m.register(s, this.description.id, this.client, this.fileConfigMgr))),
      import('../../old/ts/languageFeatures/jsDocCompletions').then((provider) => this._register(provider.register(s, this.description.id, this.client, this.fileConfigMgr))),
      import('./imports').then((provider) => this._register(provider.register(s, this.client, this.commandMgr, this.fileConfigMgr, this.telemetryReporter))),
      import('./quickFix').then((provider) => this._register(provider.register(s, this.client, this.fileConfigMgr, this.commandMgr, this.client.diagnosticsMgr, this.telemetryReporter))),
      import('./refactor').then((provider) => this._register(provider.register(s, this.client, this.fileConfigMgr, this.commandMgr, this.telemetryReporter))),
      import('./reference').then((m) => this._register(m.register(s, this.client))),
      import('./rename').then((provider) => this._register(provider.register(s, this.client, this.fileConfigMgr))),
      import('./token').then((provider) => this._register(provider.register(s, this.client))),
      import('./signature').then((provider) => this._register(provider.register(s, this.client))),
      import('./selection').then((provider) => this._register(provider.register(s, this.client))),
      import('../../old/ts/languageFeatures/tagClosing').then((provider) => this._register(provider.register(s, this.description.id, this.client))),
    ]);
  }

  private configurationChanged(): void {
    const c = qv.workspace.getConfig(this.id, null);
    this.updateValidate(c.get(validateSetting, true));
    this.updateSuggestionDiags(c.get(suggestionSetting, true));
  }

  public handles(r: qv.Uri, d: qv.TextDocument): boolean {
    if (d && this.description.modeIds.indexOf(d.languageId) >= 0) return true;
    const b = basename(r.fsPath);
    return !!b && !!this.description.configFilePattern && this.description.configFilePattern.test(b);
  }

  private get id(): string {
    return this.description.id;
  }

  public get diagnosticSource(): string {
    return this.description.diagnosticSource;
  }

  private updateValidate(v: boolean) {
    this.client.diagnosticsMgr.setValidate(this._diagnosticLang, v);
  }

  private updateSuggestionDiags(v: boolean) {
    this.client.diagnosticsMgr.setEnableSuggestions(this._diagnosticLang, v);
  }

  public reInitialize(): void {
    this.client.diagnosticsMgr.reInitialize();
  }

  public triggerAllDiags(): void {
    this.client.bufferSyncSupport.requestAllDiags();
  }

  public diagnosticsReceived(k: DiagKind, r: qv.Uri, ds: (qv.Diag & { reportUnnecessary: any; reportDeprecated: any })[]): void {
    const c = qv.workspace.getConfig(this.id, r);
    const unnecessary = c.get<boolean>('showUnused', true);
    const deprecated = c.get<boolean>('showDeprecated', true);
    this.client.diagnosticsMgr.updateDiags(
      r,
      this._diagnosticLang,
      k,
      ds.filter((d) => {
        if (!unnecessary) {
          if (d.reportUnnecessary && d.severity === qv.DiagSeverity.Hint) return false;
        }
        if (!deprecated) {
          if (d.reportDeprecated && d.severity === qv.DiagSeverity.Hint) return false;
        }
        return true;
      })
    );
  }

  public configFileDiagsReceived(r: qv.Uri, ds: qv.Diag[]): void {
    this.client.diagnosticsMgr.configFileDiagsReceived(r, ds);
  }

  private get _diagnosticLang() {
    return this.description.diagnosticLang;
  }
}
