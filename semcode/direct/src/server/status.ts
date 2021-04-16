import * as qv from 'vscode';
import { ServiceClient } from './service';
import { ActiveJsTsEditorTracker } from '../utils/tracker';
import { coalesce, Command, CommandMgr, Disposable } from '../utils/base';
import { isTypeScriptDocument } from '../utils/lang';
import { isImplicitProjectConfigFile, openOrCreateConfig, openProjectConfigForFile, openProjectConfigOrPromptToCreate, ProjectType } from '../utils/config';
import { TSVersion } from './version';

const typingsInstallTimeout = 30 * 1000;
export class TypingsStatus extends Disposable {
  private readonly _acquiring = new Map<number, NodeJS.Timer>();
  private readonly _client: ServiceClient;
  constructor(c: ServiceClient) {
    super();
    this._client = c;
    this._register(this._client.onDidBeginInstallTypings((x) => this.onBeginInstallTypings(x.eventId)));
    this._register(this._client.onDidEndInstallTypings((x) => this.onEndInstallTypings(x.eventId)));
  }
  public dispose(): void {
    super.dispose();
    for (const x of this._acquiring.values()) {
      clearTimeout(x);
    }
  }
  public get isAcquiringTypings(): boolean {
    return Object.keys(this._acquiring).length > 0;
  }
  private onBeginInstallTypings(i: number): void {
    if (this._acquiring.has(i)) return;
    this._acquiring.set(
      i,
      setTimeout(() => {
        this.onEndInstallTypings(i);
      }, typingsInstallTimeout)
    );
  }
  private onEndInstallTypings(i: number): void {
    const x = this._acquiring.get(i);
    if (x) clearTimeout(x);
    this._acquiring.delete(i);
  }
}
export class AtaProgressReporter extends Disposable {
  private readonly _promises = new Map<number, Function>();
  constructor(c: ServiceClient) {
    super();
    this._register(c.onDidBeginInstallTypings((x) => this._onBegin(x.eventId)));
    this._register(c.onDidEndInstallTypings((x) => this._onEndOrTimeout(x.eventId)));
    this._register(c.onTypesInstallerInitializationFailed((_) => this.onTypesInstallerInitializationFailed()));
  }
  dispose(): void {
    super.dispose();
    this._promises.forEach((x) => x());
  }
  private _onBegin(i: number): void {
    const h = setTimeout(() => this._onEndOrTimeout(i), typingsInstallTimeout);
    const p = new Promise<void>((res) => {
      this._promises.set(i, () => {
        clearTimeout(h);
        res();
      });
    });
    qv.window.withProgress({ location: qv.ProgressLocation.Window, title: 'installingPackages' }, () => p);
  }
  private _onEndOrTimeout(i: number): void {
    const res = this._promises.get(i);
    if (res) {
      this._promises.delete(i);
      res();
    }
  }
  private async onTypesInstallerInitializationFailed() {
    const c = qv.workspace.getConfig('typescript');
    if (c.get<boolean>('check.npmIsInstalled', true)) {
      const noshow: qv.MessageItem = { title: 'typesInstallerInitializationFailed.doNotCheckAgain' };
      const sel = await qv.window.showWarningMessage('typesInstallerInitializationFailed.title', noshow);
      if (sel === noshow) c.update('check.npmIsInstalled', false, true);
    }
  }
}
namespace ProjectInfoState {
  export const enum Type {
    None,
    Pending,
    Resolved,
  }
  export const None = Object.freeze({ type: Type.None } as const);
  export class Pending {
    public readonly type = Type.Pending;
    public readonly cancellation = new qv.CancellationTokenSource();
    constructor(public readonly resource: qv.Uri) {}
  }
  export class Resolved {
    public readonly type = Type.Resolved;
    constructor(public readonly resource: qv.Uri, public readonly configFile: string) {}
  }
  export type State = typeof None | Pending | Resolved;
}
interface QuickPickItem extends qv.QuickPickItem {
  run(): void;
}
class ProjectStatusCommand implements Command {
  public readonly id = '_typescript.projectStatus';
  public constructor(private readonly _client: ServiceClient, private readonly _delegate: () => ProjectInfoState.State) {}
  public async execute(): Promise<void> {
    const x = this._delegate();
    const y = await qv.window.showQuickPick<QuickPickItem>(coalesce([this.getProjectItem(x), this.getVersionItem(), this.getHelpItem()]), { placeHolder: 'projectQuickPick.placeholder' });
    return y?.run();
  }
  private getVersionItem(): QuickPickItem {
    return {
      label: 'projectQuickPick.version.label',
      description: 'projectQuickPick.version.description',
      run: () => {
        this._client.showVersionPicker();
      },
    };
  }
  private getProjectItem(s: ProjectInfoState.State): QuickPickItem | undefined {
    const root = s.type === ProjectInfoState.Type.Resolved ? this._client.getWorkspaceRootForResource(s.resource) : undefined;
    if (!root) return undefined;
    if (s.type === ProjectInfoState.Type.Resolved) {
      if (isImplicitProjectConfigFile(s.configFile)) {
        return {
          label: 'projectQuickPick.project.create',
          detail: 'projectQuickPick.project.create.description',
          run: () => {
            openOrCreateConfig(ProjectType.TypeScript, root, this._client.configuration);
          },
        };
      }
    }
    return {
      label: 'projectQuickPick.version.goProjectConfig',
      description: s.type === ProjectInfoState.Type.Resolved ? qv.workspace.asRelativePath(s.configFile) : undefined,
      run: () => {
        if (s.type === ProjectInfoState.Type.Resolved) openProjectConfigOrPromptToCreate(ProjectType.TypeScript, this._client, root, s.configFile);
        else if (s.type === ProjectInfoState.Type.Pending) openProjectConfigForFile(ProjectType.TypeScript, this._client, s.resource);
      },
    };
  }
  private getHelpItem(): QuickPickItem {
    return {
      label: 'projectQuickPick.help',
      run: () => {
        qv.env.openExternal(qv.Uri.parse('https://go.microsoft.com/fwlink/?linkid=839919'));
      },
    };
  }
}
export class VersionStatus extends Disposable {
  private readonly _statusBarEntry: qv.StatusBarItem;
  private _ready = false;
  private _state: ProjectInfoState.State = ProjectInfoState.None;
  constructor(private readonly _client: ServiceClient, m: CommandMgr, private readonly _activeTextEditorMgr: ActiveJsTsEditorTracker) {
    super();
    this._statusBarEntry = this._register(qv.window.createStatusBarItem(qv.StatusBarAlignment.Right, 99));
    const c = new ProjectStatusCommand(this._client, () => this._state);
    m.register(c);
    this._statusBarEntry.command = c.id;
    _activeTextEditorMgr.onDidChangeActiveJsTsEditor(this.updateStatus, this, this._ds);
    this._client.onReady(() => {
      this._ready = true;
      this.updateStatus();
    });
    this._register(this._client.onTSServerStarted(({ version }) => this.onDidChangeTSVersion(version)));
  }
  private onDidChangeTSVersion(v: TSVersion) {
    this._statusBarEntry.text = v.displayName;
    this._statusBarEntry.tooltip = v.path;
    this.updateStatus();
  }
  private async updateStatus() {
    const e = this._activeTextEditorMgr.activeJsTsEditor;
    if (!e) {
      this.hide();
      return;
    }
    const d = e.document;
    if (isTypeScriptDocument(d)) {
      const file = this._client.toOpenedFilePath(d, { suppressAlertOnFailure: true });
      if (file) {
        this._statusBarEntry.show();
        if (!this._ready) return;
        const s = new ProjectInfoState.Pending(d.uri);
        this.updateState(s);
        const y = await this._client.execute('projectInfo', { file, needFileNameList: false }, s.cancellation.token);
        if (y.type === 'response' && y.body) {
          if (this._state === s) {
            this.updateState(new ProjectInfoState.Resolved(d.uri, y.body.configFileName));
            this._statusBarEntry.show();
          }
        }
        return;
      }
    }
    this.hide();
  }
  private hide(): void {
    this._statusBarEntry.hide();
    this.updateState(ProjectInfoState.None);
  }
  private updateState(s: ProjectInfoState.State): void {
    if (this._state === s) return;
    if (this._state.type === ProjectInfoState.Type.Pending) {
      this._state.cancellation.cancel();
      this._state.cancellation.dispose();
    }
    this._state = s;
  }
}
