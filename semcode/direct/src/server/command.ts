import ServiceClientHost from './clientHost';
import { ActiveJsTsEditorTracker } from '../utils/tracker';
import { Command, CommandMgr, Lazy } from '../utils/base';
import { PluginMgr } from '../utils/plugins';
import * as qv from 'vscode';
import { openProjectConfigForFile, ProjectType } from '../utils/config';
import { isTypeScriptDocument } from '../utils/lang';
import { CancellationToken, ExecuteCommandParams, ResponseError } from 'vscode-languageserver';
import { convertUriToPath, convertPathToUri } from '../utils/path';
import { convertTextEdits } from '../utils/text';
import { AnalyzerService } from './analyzer/service';
import { OpCanceledException } from './common/cancellationUtils';
import { createDeferred } from '../utils/base';
import { LangServerInterface, WorkspaceServiceInstance } from './languageServerBase';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';

export class ConfigurePluginCommand implements Command {
  public readonly id = '_typescript.configurePlugin';
  public constructor(private readonly mgr: PluginMgr) {}
  public execute(id: string, cfg: any) {
    this.mgr.setConfig(id, cfg);
  }
}
class TypeScriptGoToProjectConfigCommand implements Command {
  public readonly id = 'typescript.goToProjectConfig';
  public constructor(private readonly tracker: ActiveJsTsEditorTracker, private readonly host: Lazy<ServiceClientHost>) {}
  public execute() {
    const e = this.tracker.activeJsTsEditor;
    if (e) openProjectConfigForFile(ProjectType.TypeScript, this.host.value.serviceClient, e.document.uri);
  }
}
class JavaScriptGoToProjectConfigCommand implements Command {
  public readonly id = 'javascript.goToProjectConfig';
  public constructor(private readonly tracker: ActiveJsTsEditorTracker, private readonly host: Lazy<ServiceClientHost>) {}
  public execute() {
    const e = this.tracker.activeJsTsEditor;
    if (e) openProjectConfigForFile(ProjectType.JavaScript, this.host.value.serviceClient, e.document.uri);
  }
}
class LearnMoreAboutRefactoringsCommand implements Command {
  public static readonly id = '_typescript.learnMoreAboutRefactorings';
  public readonly id = LearnMoreAboutRefactoringsCommand.id;
  public execute() {
    const u =
      qv.window.activeTextEditor && isTypeScriptDocument(qv.window.activeTextEditor.document) ? 'https://go.microsoft.com/fwlink/?linkid=2114477' : 'https://go.microsoft.com/fwlink/?linkid=2116761';
    qv.env.openExternal(qv.Uri.parse(u));
  }
}
class OpenTSServerLogCommand implements Command {
  public readonly id = 'typescript.openTSServerLog';
  public constructor(private readonly host: Lazy<ServiceClientHost>) {}
  public execute() {
    this.host.value.serviceClient.openTSServerLogFile();
  }
}
class ReloadTypeScriptProjectsCommand implements Command {
  public readonly id = 'typescript.reloadProjects';
  public constructor(private readonly host: Lazy<ServiceClientHost>) {}
  public execute() {
    this.host.value.reloadProjects();
  }
}
class ReloadJavaScriptProjectsCommand implements Command {
  public readonly id = 'javascript.reloadProjects';
  public constructor(private readonly host: Lazy<ServiceClientHost>) {}
  public execute() {
    this.host.value.reloadProjects();
  }
}
class RestartTSServerCommand implements Command {
  public readonly id = 'typescript.restartTSServer';
  public constructor(private readonly host: Lazy<ServiceClientHost>) {}
  public execute() {
    this.host.value.serviceClient.restartTSServer();
  }
}
class SelectTSVersionCommand implements Command {
  public readonly id = 'typescript.selectTSVersion';
  public constructor(private readonly host: Lazy<ServiceClientHost>) {}
  public execute() {
    this.host.value.serviceClient.showVersionPicker();
  }
}
export function registerBaseCommands(m: CommandMgr, h: Lazy<ServiceClientHost>, p: PluginMgr, t: ActiveJsTsEditorTracker): void {
  m.register(new ReloadTypeScriptProjectsCommand(h));
  m.register(new ReloadJavaScriptProjectsCommand(h));
  m.register(new SelectTSVersionCommand(h));
  m.register(new OpenTSServerLogCommand(h));
  m.register(new RestartTSServerCommand(h));
  m.register(new TypeScriptGoToProjectConfigCommand(t, h));
  m.register(new JavaScriptGoToProjectConfigCommand(t, h));
  m.register(new ConfigurePluginCommand(p));
  m.register(new LearnMoreAboutRefactoringsCommand());
}
export const enum Commands {
  createTypeStub = 'pyright.createtypestub',
  restartServer = 'pyright.restartserver',
  orderImports = 'pyright.organizeimports',
  addMissingOptionalToParam = 'pyright.addoptionalforparam',
  unusedImport = 'pyright.unusedImport',
}
export interface ServerCommand {
  execute(ps: ExecuteCommandParams, t: CancellationToken): Promise<any>;
}
export class RestartServerCommand implements ServerCommand {
  constructor(private _ls: LangServerInterface) {}
  async execute(_: ExecuteCommandParams): Promise<any> {
    this._ls.restart();
  }
}
export class CreateTypeStubCommand implements ServerCommand {
  constructor(private _ls: LangServerInterface) {}
  async execute(ps: ExecuteCommandParams, t: CancellationToken): Promise<any> {
    if (ps.arguments && ps.arguments.length >= 2) {
      const root = ps.arguments[0];
      const name = ps.arguments[1];
      const caller = ps.arguments[2];
      const service = await this._createTypeStubService(caller);
      const ws: WorkspaceServiceInstance = {
        workspaceName: `Create Type Stub ${name}`,
        rootPath: root,
        rootUri: convertPathToUri(this._ls.fs, root),
        serviceInstance: service,
        disableLangServices: true,
        disableOrganizeImports: true,
        isInitialized: createDeferred<boolean>(),
      };
      const settings = await this._ls.getSettings(ws);
      AnalyzerServiceExecutor.runWithOptions(this._ls.rootPath, ws, settings, name, false);
      try {
        await service.writeTypeStubInBackground(t);
        service.dispose();
        const infoMessage = `Type stub was successfully created for '${name}'.`;
        this._ls.window.showInformationMessage(infoMessage);
        this._handlePostCreateTypeStub();
      } catch (err) {
        const isCancellation = OpCanceledException.is(err);
        if (isCancellation) {
          const errMessage = `Type stub creation for '${name}' was canceled`;
          this._ls.console.error(errMessage);
        } else {
          let errMessage = '';
          if (err instanceof Error) errMessage = ': ' + err.message;
          errMessage = `An error occurred when creating type stub for '${name}'` + errMessage;
          this._ls.console.error(errMessage);
          this._ls.window.showErrorMessage(errMessage);
        }
      }
    }
  }
  private async _createTypeStubService(caller?: string): Promise<AnalyzerService> {
    if (caller) {
      const ws = await this._ls.getWorkspaceForFile(caller);
      return ws.serviceInstance.clone('Type stub', this._ls.createBackgroundAnalysis());
    }
    return new AnalyzerService('Type stub', this._ls.fs, this._ls.console);
  }
  private _handlePostCreateTypeStub() {
    this._ls.reanalyze();
  }
}
export class CommandController implements ServerCommand {
  private _createStub: CreateTypeStubCommand;
  private _restartServer: RestartServerCommand;
  private _quickAction: QuickActionCommand;
  constructor(ls: LangServerInterface) {
    this._createStub = new CreateTypeStubCommand(ls);
    this._restartServer = new RestartServerCommand(ls);
    this._quickAction = new QuickActionCommand(ls);
  }
  async execute(ps: ExecuteCommandParams, t: CancellationToken): Promise<any> {
    switch (ps.command) {
      case Commands.orderImports:
      case Commands.addMissingOptionalToParam: {
        return this._quickAction.execute(ps, t);
      }
      case Commands.createTypeStub: {
        return this._createStub.execute(ps, t);
      }
      case Commands.restartServer: {
        return this._restartServer.execute(ps);
      }
      default: {
        return new ResponseError<string>(1, 'Unsupported command');
      }
    }
  }
  isLongRunningCommand(x: string): boolean {
    switch (x) {
      case Commands.createTypeStub:
        return true;
      default:
        return false;
    }
  }
}
export class QuickActionCommand implements ServerCommand {
  constructor(private _ls: LangServerInterface) {}
  async execute(ps: ExecuteCommandParams, t: CancellationToken): Promise<any> {
    if (ps.arguments && ps.arguments.length >= 1) {
      const docUri = ps.arguments[0];
      const otherArgs = ps.arguments.slice(1);
      const filePath = convertUriToPath(this._ls.fs, docUri);
      const ws = await this._ls.getWorkspaceForFile(filePath);
      if (ps.command === Commands.orderImports && ws.disableOrganizeImports) return [];
      const as = ws.serviceInstance.performQuickAction(filePath, ps.command, otherArgs, t);
      return convertTextEdits(docUri, as);
    }
  }
}
