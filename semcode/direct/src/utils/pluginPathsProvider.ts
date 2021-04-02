import * as path from 'path';
import * as qv from 'vscode';
import { TSServiceConfig } from './configuration';
import { RelativeWorkspacePathResolver } from './relativePathResolver';

export class TSPluginPathsProvider {
  public constructor(private configuration: TSServiceConfig) {}

  public updateConfig(configuration: TSServiceConfig): void {
    this.configuration = configuration;
  }

  public getPluginPaths(): string[] {
    const pluginPaths = [];
    for (const pluginPath of this.configuration.tsServerPluginPaths) {
      pluginPaths.push(...this.resolvePluginPath(pluginPath));
    }
    return pluginPaths;
  }

  private resolvePluginPath(pluginPath: string): string[] {
    if (path.isAbsolute(pluginPath)) {
      return [pluginPath];
    }

    const workspacePath = RelativeWorkspacePathResolver.asAbsoluteWorkspacePath(pluginPath);
    if (workspacePath !== undefined) {
      return [workspacePath];
    }

    return (qv.workspace.workspaceFolders || []).map((workspaceFolder) => path.join(workspaceFolder.uri.fsPath, pluginPath));
  }
}
