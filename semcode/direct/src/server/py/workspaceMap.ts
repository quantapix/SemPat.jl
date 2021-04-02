import { createDeferred } from './common/deferred';
import { LangServerBase, WorkspaceServiceInstance } from './serverBase';

export class WorkspaceMap extends Map<string, WorkspaceServiceInstance> {
  private _defaultWorkspacePath = '<default>';

  constructor(private _ls: LangServerBase) {
    super();
  }

  getNonDefaultWorkspaces(): WorkspaceServiceInstance[] {
    const workspaces: WorkspaceServiceInstance[] = [];
    this.forEach((workspace) => {
      if (workspace.rootPath) {
        workspaces.push(workspace);
      }
    });

    return workspaces;
  }

  getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
    let bestRootPath: string | undefined;
    let bestInstance: WorkspaceServiceInstance | undefined;

    this.forEach((workspace) => {
      if (workspace.rootPath) {
        if (filePath.startsWith(workspace.rootPath)) {
          if (bestRootPath === undefined || workspace.rootPath.startsWith(bestRootPath)) {
            bestRootPath = workspace.rootPath;
            bestInstance = workspace;
          }
        }
      }
    });

    if (bestInstance === undefined) {
      let defaultWorkspace = this.get(this._defaultWorkspacePath);
      if (!defaultWorkspace) {
        const workspaceNames = [...this.keys()];
        if (workspaceNames.length === 1) {
          return this.get(workspaceNames[0])!;
        }

        defaultWorkspace = {
          workspaceName: '',
          rootPath: '',
          rootUri: '',
          serviceInstance: this._ls.createAnalyzerService(this._defaultWorkspacePath),
          disableLangServices: false,
          disableOrganizeImports: false,
          isInitialized: createDeferred<boolean>(),
        };
        this.set(this._defaultWorkspacePath, defaultWorkspace);
        this._ls.updateSettingsForWorkspace(defaultWorkspace).ignoreErrors();
      }

      return defaultWorkspace;
    }

    return bestInstance;
  }
}
