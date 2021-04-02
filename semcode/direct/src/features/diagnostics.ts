import * as qv from 'vscode';
import { ResourceMap } from '../utils/resourceMap';
import { DiagLang } from '../utils/languageDescription';
import * as arrays from '../utils/arrays';
import { Disposable } from '../utils';

function diagnosticsEquals(a: qv.Diag, b: qv.Diag): boolean {
  if (a === b) {
    return true;
  }

  return (
    a.code === b.code &&
    a.message === b.message &&
    a.severity === b.severity &&
    a.source === b.source &&
    a.range.isEqual(b.range) &&
    arrays.equals(a.relatedInformation || arrays.empty, b.relatedInformation || arrays.empty, (a, b) => {
      return a.message === b.message && a.location.range.isEqual(b.location.range) && a.location.uri.fsPath === b.location.uri.fsPath;
    }) &&
    arrays.equals(a.tags || arrays.empty, b.tags || arrays.empty)
  );
}

export const enum DiagKind {
  Syntax,
  Semantic,
  Suggestion,
}

class FileDiags {
  private readonly _diagnostics = new Map<DiagKind, ReadonlyArray<qv.Diag>>();

  constructor(public readonly file: qv.Uri, public language: DiagLang) {}

  public updateDiags(language: DiagLang, kind: DiagKind, diagnostics: ReadonlyArray<qv.Diag>): boolean {
    if (language !== this.language) {
      this._diagnostics.clear();
      this.language = language;
    }

    const existing = this._diagnostics.get(kind);
    if (arrays.equals(existing || arrays.empty, diagnostics, diagnosticsEquals)) {
      return false;
    }

    this._diagnostics.set(kind, diagnostics);
    return true;
  }

  public getDiags(settings: DiagSettings): qv.Diag[] {
    if (!settings.getValidate(this.language)) {
      return [];
    }

    return [...this.get(DiagKind.Syntax), ...this.get(DiagKind.Semantic), ...this.getSuggestionDiags(settings)];
  }

  private getSuggestionDiags(settings: DiagSettings) {
    const enableSuggestions = settings.getEnableSuggestions(this.language);
    return this.get(DiagKind.Suggestion).filter((x) => {
      if (!enableSuggestions) {
        return x.tags && (x.tags.includes(qv.DiagTag.Unnecessary) || x.tags.includes(qv.DiagTag.Deprecated));
      }
      return true;
    });
  }

  private get(kind: DiagKind): ReadonlyArray<qv.Diag> {
    return this._diagnostics.get(kind) || [];
  }
}

interface LangDiagSettings {
  readonly validate: boolean;
  readonly enableSuggestions: boolean;
}

function areLangDiagSettingsEqual(currentSettings: LangDiagSettings, newSettings: LangDiagSettings): boolean {
  return currentSettings.validate === newSettings.validate && currentSettings.enableSuggestions && currentSettings.enableSuggestions;
}

class DiagSettings {
  private static readonly defaultSettings: LangDiagSettings = {
    validate: true,
    enableSuggestions: true,
  };

  private readonly _languageSettings = new Map<DiagLang, LangDiagSettings>();

  public getValidate(language: DiagLang): boolean {
    return this.get(language).validate;
  }

  public setValidate(language: DiagLang, value: boolean): boolean {
    return this.update(language, (settings) => ({
      validate: value,
      enableSuggestions: settings.enableSuggestions,
    }));
  }

  public getEnableSuggestions(language: DiagLang): boolean {
    return this.get(language).enableSuggestions;
  }

  public setEnableSuggestions(language: DiagLang, value: boolean): boolean {
    return this.update(language, (settings) => ({
      validate: settings.validate,
      enableSuggestions: value,
    }));
  }

  private get(language: DiagLang): LangDiagSettings {
    return this._languageSettings.get(language) || DiagSettings.defaultSettings;
  }

  private update(language: DiagLang, f: (x: LangDiagSettings) => LangDiagSettings): boolean {
    const currentSettings = this.get(language);
    const newSettings = f(currentSettings);
    this._languageSettings.set(language, newSettings);
    return areLangDiagSettingsEqual(currentSettings, newSettings);
  }
}

export class DiagsMgr extends Disposable {
  private readonly _diagnostics: ResourceMap<FileDiags>;
  private readonly _settings = new DiagSettings();
  private readonly _currentDiags: qv.DiagCollection;
  private readonly _pendingUpdates: ResourceMap<any>;

  private readonly _updateDelay = 50;

  constructor(owner: string, onCaseInsenitiveFileSystem: boolean) {
    super();
    this._diagnostics = new ResourceMap<FileDiags>(undefined, { onCaseInsenitiveFileSystem });
    this._pendingUpdates = new ResourceMap<any>(undefined, { onCaseInsenitiveFileSystem });

    this._currentDiags = this._register(qv.languages.createDiagCollection(owner));
  }

  public dispose() {
    super.dispose();

    for (const value of this._pendingUpdates.values) {
      clearTimeout(value);
    }
    this._pendingUpdates.clear();
  }

  public reInitialize(): void {
    this._currentDiags.clear();
    this._diagnostics.clear();
  }

  public setValidate(language: DiagLang, value: boolean) {
    const didUpdate = this._settings.setValidate(language, value);
    if (didUpdate) {
      this.rebuild();
    }
  }

  public setEnableSuggestions(language: DiagLang, value: boolean) {
    const didUpdate = this._settings.setEnableSuggestions(language, value);
    if (didUpdate) {
      this.rebuild();
    }
  }

  public updateDiags(file: qv.Uri, language: DiagLang, kind: DiagKind, diagnostics: ReadonlyArray<qv.Diag>): void {
    let didUpdate = false;
    const entry = this._diagnostics.get(file);
    if (entry) {
      didUpdate = entry.updateDiags(language, kind, diagnostics);
    } else if (diagnostics.length) {
      const fileDiags = new FileDiags(file, language);
      fileDiags.updateDiags(language, kind, diagnostics);
      this._diagnostics.set(file, fileDiags);
      didUpdate = true;
    }

    if (didUpdate) {
      this.scheduleDiagsUpdate(file);
    }
  }

  public configFileDiagsReceived(file: qv.Uri, diagnostics: ReadonlyArray<qv.Diag>): void {
    this._currentDiags.set(file, diagnostics);
  }

  public delete(resource: qv.Uri): void {
    this._currentDiags.delete(resource);
    this._diagnostics.delete(resource);
  }

  public getDiags(file: qv.Uri): ReadonlyArray<qv.Diag> {
    return this._currentDiags.get(file) || [];
  }

  private scheduleDiagsUpdate(file: qv.Uri) {
    if (!this._pendingUpdates.has(file)) {
      this._pendingUpdates.set(
        file,
        setTimeout(() => this.updateCurrentDiags(file), this._updateDelay)
      );
    }
  }

  private updateCurrentDiags(file: qv.Uri): void {
    if (this._pendingUpdates.has(file)) {
      clearTimeout(this._pendingUpdates.get(file));
      this._pendingUpdates.delete(file);
    }

    const fileDiags = this._diagnostics.get(file);
    this._currentDiags.set(file, fileDiags ? fileDiags.getDiags(this._settings) : []);
  }

  private rebuild(): void {
    this._currentDiags.clear();
    for (const fileDiag of this._diagnostics.values) {
      this._currentDiags.set(fileDiag.file, fileDiag.getDiags(this._settings));
    }
  }
}
