import { basename } from 'path';
import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { CommandManager } from '../../old/ts/commands/commandManager';
import { DiagnosticKind } from '../../old/ts/languageFeatures/diagnostics';
import { LanguageDescription } from '../../old/ts/utils/languageDescription';
import { TelemetryReporter } from '../../old/ts/utils/telemetry';
import * as qu from '../utils';
import * as qv from 'vscode';
import FileConfigurationManager from '../../old/ts/languageFeatures/fileConfigurationManager';
import TypeScriptServiceClient from '../client';
import TypingsStatus from '../../old/ts/utils/typingsStatus';

const validateSetting = 'validate.enable';
const suggestionSetting = 'suggestionActions.enabled';

export default class LanguageProvider extends qu.Disposable {
  constructor(
    private readonly client: TypeScriptServiceClient,
    private readonly description: LanguageDescription,
    private readonly commandManager: CommandManager,
    private readonly telemetryReporter: TelemetryReporter,
    private readonly typingsStatus: TypingsStatus,
    private readonly fileConfigurationManager: FileConfigurationManager,
    private readonly onCompletionAccepted: (item: qv.CompletionItem) => void
  ) {
    super();
    qv.workspace.onDidChangeConfiguration(this.configurationChanged, this, this._disposables);
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
        this._register(
          provider.register(s, this.description.id, this.client, this.typingsStatus, this.fileConfigurationManager, this.commandManager, this.telemetryReporter, this.onCompletionAccepted)
        )
      ),
      import('../../old/ts/languageFeatures/directiveCommentCompletions').then((provider) => this._register(provider.register(s, this.client))),
      import('./highlight').then((m) => this._register(m.register(s, this.client))),
      import('./symbol').then((m) => this._register(m.register(s, this.client, c))),
      import('../../old/ts/languageFeatures/fileReferences').then((provider) => this._register(provider.register(this.client, this.commandManager))),
      import('./fixAll').then((provider) => this._register(provider.register(s, this.client, this.fileConfigurationManager, this.client.diagnosticsManager))),
      import('./folding').then((m) => this._register(m.register(s, this.client))),
      import('./formatting').then((m) => this._register(m.register(s, this.description.id, this.client, this.fileConfigurationManager))),
      import('../../old/ts/languageFeatures/jsDocCompletions').then((provider) => this._register(provider.register(s, this.description.id, this.client, this.fileConfigurationManager))),
      import('./imports').then((provider) => this._register(provider.register(s, this.client, this.commandManager, this.fileConfigurationManager, this.telemetryReporter))),
      import('./quickFix').then((provider) =>
        this._register(provider.register(s, this.client, this.fileConfigurationManager, this.commandManager, this.client.diagnosticsManager, this.telemetryReporter))
      ),
      import('./refactor').then((provider) => this._register(provider.register(s, this.client, this.fileConfigurationManager, this.commandManager, this.telemetryReporter))),
      import('./reference').then((m) => this._register(m.register(s, this.client))),
      import('./rename').then((provider) => this._register(provider.register(s, this.client, this.fileConfigurationManager))),
      import('./token').then((provider) => this._register(provider.register(s, this.client))),
      import('./signature').then((provider) => this._register(provider.register(s, this.client))),
      import('./selection').then((provider) => this._register(provider.register(s, this.client))),
      import('../../old/ts/languageFeatures/tagClosing').then((provider) => this._register(provider.register(s, this.description.id, this.client))),
    ]);
  }

  private configurationChanged(): void {
    const c = qv.workspace.getConfiguration(this.id, null);
    this.updateValidate(c.get(validateSetting, true));
    this.updateSuggestionDiagnostics(c.get(suggestionSetting, true));
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
    this.client.diagnosticsManager.setValidate(this._diagnosticLanguage, v);
  }

  private updateSuggestionDiagnostics(v: boolean) {
    this.client.diagnosticsManager.setEnableSuggestions(this._diagnosticLanguage, v);
  }

  public reInitialize(): void {
    this.client.diagnosticsManager.reInitialize();
  }

  public triggerAllDiagnostics(): void {
    this.client.bufferSyncSupport.requestAllDiagnostics();
  }

  public diagnosticsReceived(k: DiagnosticKind, r: qv.Uri, ds: (qv.Diagnostic & { reportUnnecessary: any; reportDeprecated: any })[]): void {
    const c = qv.workspace.getConfiguration(this.id, r);
    const unnecessary = c.get<boolean>('showUnused', true);
    const deprecated = c.get<boolean>('showDeprecated', true);
    this.client.diagnosticsManager.updateDiagnostics(
      r,
      this._diagnosticLanguage,
      k,
      ds.filter((d) => {
        if (!unnecessary) {
          if (d.reportUnnecessary && d.severity === qv.DiagnosticSeverity.Hint) return false;
        }
        if (!deprecated) {
          if (d.reportDeprecated && d.severity === qv.DiagnosticSeverity.Hint) return false;
        }
        return true;
      })
    );
  }

  public configFileDiagnosticsReceived(r: qv.Uri, ds: qv.Diagnostic[]): void {
    this.client.diagnosticsManager.configFileDiagnosticsReceived(r, ds);
  }

  private get _diagnosticLanguage() {
    return this.description.diagnosticLanguage;
  }
}
