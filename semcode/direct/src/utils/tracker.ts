import * as qv from 'vscode';
import { Disposable } from './dispose';
import { isJsConfigOrTsConfigFileName } from './lang';
import { isSupportedLangMode } from './lang';
import { ServiceClient } from '../service';
import { TelemetryReporter } from './telemetry';
import { isImplicitProjectConfigFile, openOrCreateConfig, ProjectType } from './tsconfig';
export class ActiveJsTsEditorTracker extends Disposable {
  private _activeJsTsEditor: qv.TextEditor | undefined;
  private readonly _onDidChangeActiveJsTsEditor = this._register(new qv.EventEmitter<qv.TextEditor | undefined>());
  public readonly onDidChangeActiveJsTsEditor = this._onDidChangeActiveJsTsEditor.event;
  public constructor() {
    super();
    qv.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, this._disposables);
    qv.window.onDidChangeVisibleTextEditors(
      () => {
        if (this._activeJsTsEditor) {
          if (!qv.window.visibleTextEditors.some((visibleEditor) => visibleEditor === this._activeJsTsEditor)) {
            this.onDidChangeActiveTextEditor(undefined);
          }
        }
      },
      this,
      this._disposables
    );
    this.onDidChangeActiveTextEditor(qv.window.activeTextEditor);
  }
  public get activeJsTsEditor(): qv.TextEditor | undefined {
    return this._activeJsTsEditor;
  }
  private onDidChangeActiveTextEditor(editor: qv.TextEditor | undefined): any {
    if (editor === this._activeJsTsEditor) {
      return;
    }
    if (editor && !editor.viewColumn) {
      return;
    }
    if (editor && this.isManagedFile(editor)) {
      this._activeJsTsEditor = editor;
    } else {
      this._activeJsTsEditor = undefined;
    }
    this._onDidChangeActiveJsTsEditor.fire(this._activeJsTsEditor);
  }
  private isManagedFile(editor: qv.TextEditor): boolean {
    return this.isManagedScriptFile(editor) || this.isManagedConfigFile(editor);
  }
  private isManagedScriptFile(editor: qv.TextEditor): boolean {
    return isSupportedLangMode(editor.document);
  }
  private isManagedConfigFile(editor: qv.TextEditor): boolean {
    return isJsConfigOrTsConfigFileName(editor.document.fileName);
  }
}
interface Hint {
  message: string;
}
class ExcludeHintItem {
  public configFileName?: string;
  private _item: qv.StatusBarItem;
  private _currentHint?: Hint;
  constructor(private readonly telemetryReporter: TelemetryReporter) {
    this._item = qv.window.createStatusBarItem({
      id: 'status.typescript.exclude',
      name: 'statusExclude',
      alignment: qv.StatusBarAlignment.Right,
      priority: 98 /* to the right of typescript version status (99) */,
    });
    this._item.command = 'js.projectStatus.command';
  }
  public getCurrentHint(): Hint {
    return this._currentHint!;
  }
  public hide() {
    this._item.hide();
  }
  public show(largeRoots?: string) {
    this._currentHint = {
      message: largeRoots ? 'hintExclude' : 'hintExclude.generic',
    };
    this._item.tooltip = this._currentHint.message;
    this._item.text = 'large.label';
    this._item.tooltip = 'hintExclude.tooltip';
    this._item.color = '#A5DF3B';
    this._item.show();
    /* __GDPR__
			"js.hintProjectExcludes" : {
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
    this.telemetryReporter.logTelemetry('js.hintProjectExcludes');
  }
}
function createLargeProjectMonitorFromTypeScript(item: ExcludeHintItem, client: ServiceClient): qv.Disposable {
  interface LargeProjectMessageItem extends qv.MessageItem {
    index: number;
  }
  return client.onProjectLangServiceStateChanged((body) => {
    if (body.languageServiceEnabled) {
      item.hide();
    } else {
      item.show();
      const configFileName = body.projectName;
      if (configFileName) {
        item.configFileName = configFileName;
        qv.window
          .showWarningMessage<LargeProjectMessageItem>(item.getCurrentHint().message, {
            title: 'large.label',
            index: 0,
          })
          .then((selected) => {
            if (selected && selected.index === 0) {
              onConfigureExcludesSelected(client, configFileName);
            }
          });
      }
    }
  });
}
function onConfigureExcludesSelected(client: ServiceClient, configFileName: string) {
  if (!isImplicitProjectConfigFile(configFileName)) {
    qv.workspace.openTextDocument(configFileName).then(qv.window.showTextDocument);
  } else {
    const root = client.getWorkspaceRootForResource(qv.Uri.file(configFileName));
    if (root) {
      openOrCreateConfig(/tsconfig\.?.*\.json/.test(configFileName) ? ProjectType.TypeScript : ProjectType.JavaScript, root, client.configuration);
    }
  }
}
export function create(client: ServiceClient): qv.Disposable {
  const toDispose: qv.Disposable[] = [];
  const item = new ExcludeHintItem(client.telemetryReporter);
  toDispose.push(
    qv.commands.registerCommand('js.projectStatus.command', () => {
      if (item.configFileName) {
        onConfigureExcludesSelected(client, item.configFileName);
      }
      const { message } = item.getCurrentHint();
      return qv.window.showInformationMessage(message);
    })
  );
  toDispose.push(createLargeProjectMonitorFromTypeScript(item, client));
  return qv.Disposable.from(...toDispose);
}
export interface ProgressReporter {
  isEnabled(data: any): boolean;
  begin(): void;
  report(message: string): void;
  end(): void;
}
export class ProgressReportTracker implements ProgressReporter {
  private _isDisplayingProgress = false;
  constructor(private _reporter: ProgressReporter) {}
  isEnabled(data: any): boolean {
    if (this._isDisplayingProgress) {
      return true;
    }
    return this._reporter.isEnabled(data) ?? false;
  }
  begin(): void {
    if (this._isDisplayingProgress) {
      return;
    }
    this._isDisplayingProgress = true;
    this._reporter.begin();
  }
  report(message: string): void {
    if (!this._isDisplayingProgress) {
      return;
    }
    this._reporter.report(message);
  }
  end(): void {
    if (!this._isDisplayingProgress) {
      return;
    }
    this._isDisplayingProgress = false;
    this._reporter.end();
  }
}
