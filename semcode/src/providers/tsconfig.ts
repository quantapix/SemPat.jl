/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qv from 'vscode';

export interface TSConfig {
  readonly uri: qv.Uri;
  readonly fsPath: string;
  readonly posixPath: string;
  readonly workspaceFolder?: qv.WorkspaceFolder;
}

export class TsConfigProvider {
  public async getConfigsForWorkspace(token: qv.CancellationToken): Promise<Iterable<TSConfig>> {
    if (!qv.workspace.workspaceFolders) {
      return [];
    }

    const configs = new Map<string, TSConfig>();
    for (const config of await this.findConfigFiles(token)) {
      const root = qv.workspace.getWorkspaceFolder(config);
      if (root) {
        configs.set(config.fsPath, {
          uri: config,
          fsPath: config.fsPath,
          posixPath: config.path,
          workspaceFolder: root,
        });
      }
    }
    return configs.values();
  }

  private async findConfigFiles(token: qv.CancellationToken): Promise<qv.Uri[]> {
    return await qv.workspace.findFiles('**/tsconfig*.json', '**/{node_modules,.*}/**', undefined, token);
  }
}
