import * as qv from 'vscode';
import { ActiveJsTsEditorTracker } from './activeJsTsEditorTracker';
import { Disposable } from './dispose';
import { isJsConfigOrTsConfigFileName } from './languageDescription';
import { isSupportedLangMode } from './languageModeIds';
export default class ManagedFileContextMgr extends Disposable {
  private static readonly contextName = 'typescript.isManagedFile';
  private isInManagedFileContext: boolean = false;
  public constructor(activeJsTsEditorTracker: ActiveJsTsEditorTracker, private readonly normalizePath: (resource: qv.Uri) => string | undefined) {
    super();
    activeJsTsEditorTracker.onDidChangeActiveJsTsEditor(this.onDidChangeActiveTextEditor, this, this._disposables);
    this.onDidChangeActiveTextEditor(activeJsTsEditorTracker.activeJsTsEditor);
  }
  private onDidChangeActiveTextEditor(editor?: qv.TextEditor): void {
    if (editor) this.updateContext(this.isManagedFile(editor));
    else this.updateContext(false);
  }
  private updateContext(newValue: boolean) {
    if (newValue === this.isInManagedFileContext) return;
    qv.commands.executeCommand('setContext', ManagedFileContextMgr.contextName, newValue);
    this.isInManagedFileContext = newValue;
  }
  private isManagedFile(editor: qv.TextEditor): boolean {
    return this.isManagedScriptFile(editor) || this.isManagedConfigFile(editor);
  }
  private isManagedScriptFile(editor: qv.TextEditor): boolean {
    return isSupportedLangMode(editor.document) && this.normalizePath(editor.document.uri) !== null;
  }
  private isManagedConfigFile(editor: qv.TextEditor): boolean {
    return isJsConfigOrTsConfigFileName(editor.document.fileName);
  }
}
