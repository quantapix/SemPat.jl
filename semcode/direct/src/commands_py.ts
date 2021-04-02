import { CancellationToken, ExecuteCommandParams, ResponseError } from 'vscode-languageserver';
import { convertUriToPath } from './common/pathUtils';
import { convertTextEdits } from './common/textEditUtils';
import { AnalyzerService } from './analyzer/service';
import { OpCanceledException } from './common/cancellationUtils';
import { createDeferred } from './common/deferred';
import { convertPathToUri } from './common/pathUtils';
import { LangServerInterface, WorkspaceServiceInstance } from './languageServerBase';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';

export const enum Commands {
  createTypeStub = 'pyright.createtypestub',
  restartServer = 'pyright.restartserver',
  orderImports = 'pyright.organizeimports',
  addMissingOptionalToParam = 'pyright.addoptionalforparam',
  unusedImport = 'pyright.unusedImport',
}

export interface ServerCommand {
  execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any>;
}

export class RestartServerCommand implements ServerCommand {
  constructor(private _ls: LangServerInterface) {}
  async execute(cmdParams: ExecuteCommandParams): Promise<any> {
    this._ls.restart();
  }
}

export class CreateTypeStubCommand implements ServerCommand {
  constructor(private _ls: LangServerInterface) {}

  async execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any> {
    if (cmdParams.arguments && cmdParams.arguments.length >= 2) {
      const workspaceRoot = cmdParams.arguments[0];
      const importName = cmdParams.arguments[1];
      const callingFile = cmdParams.arguments[2];

      const service = await this._createTypeStubService(callingFile);

      const workspace: WorkspaceServiceInstance = {
        workspaceName: `Create Type Stub ${importName}`,
        rootPath: workspaceRoot,
        rootUri: convertPathToUri(this._ls.fs, workspaceRoot),
        serviceInstance: service,
        disableLangServices: true,
        disableOrganizeImports: true,
        isInitialized: createDeferred<boolean>(),
      };

      const serverSettings = await this._ls.getSettings(workspace);
      AnalyzerServiceExecutor.runWithOptions(this._ls.rootPath, workspace, serverSettings, importName, false);

      try {
        await service.writeTypeStubInBackground(token);
        service.dispose();
        const infoMessage = `Type stub was successfully created for '${importName}'.`;
        this._ls.window.showInformationMessage(infoMessage);
        this._handlePostCreateTypeStub();
      } catch (err) {
        const isCancellation = OpCanceledException.is(err);
        if (isCancellation) {
          const errMessage = `Type stub creation for '${importName}' was canceled`;
          this._ls.console.error(errMessage);
        } else {
          let errMessage = '';
          if (err instanceof Error) {
            errMessage = ': ' + err.message;
          }
          errMessage = `An error occurred when creating type stub for '${importName}'` + errMessage;
          this._ls.console.error(errMessage);
          this._ls.window.showErrorMessage(errMessage);
        }
      }
    }
  }

  private async _createTypeStubService(callingFile?: string): Promise<AnalyzerService> {
    if (callingFile) {
      const workspace = await this._ls.getWorkspaceForFile(callingFile);
      return workspace.serviceInstance.clone('Type stub', this._ls.createBackgroundAnalysis());
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

  async execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any> {
    switch (cmdParams.command) {
      case Commands.orderImports:
      case Commands.addMissingOptionalToParam: {
        return this._quickAction.execute(cmdParams, token);
      }

      case Commands.createTypeStub: {
        return this._createStub.execute(cmdParams, token);
      }

      case Commands.restartServer: {
        return this._restartServer.execute(cmdParams);
      }

      default: {
        return new ResponseError<string>(1, 'Unsupported command');
      }
    }
  }

  isLongRunningCommand(command: string): boolean {
    switch (command) {
      case Commands.createTypeStub:
        return true;

      default:
        return false;
    }
  }
}

export class QuickActionCommand implements ServerCommand {
  constructor(private _ls: LangServerInterface) {}

  async execute(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
    if (params.arguments && params.arguments.length >= 1) {
      const docUri = params.arguments[0];
      const otherArgs = params.arguments.slice(1);
      const filePath = convertUriToPath(this._ls.fs, docUri);
      const workspace = await this._ls.getWorkspaceForFile(filePath);

      if (params.command === Commands.orderImports && workspace.disableOrganizeImports) {
        return [];
      }

      const editActions = workspace.serviceInstance.performQuickAction(filePath, params.command, otherArgs, token);

      return convertTextEdits(docUri, editActions);
    }
  }
}
