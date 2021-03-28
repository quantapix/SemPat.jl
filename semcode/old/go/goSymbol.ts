/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import vscode = require('vscode');
import { getGoConfig } from './config';
import { toolExecutionEnvironment } from './goEnv';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';
import { getBinPath, getWorkspaceFolderPath } from './util';
import { getCurrentGoRoot } from './utils/pathUtils';
import { killProcessTree } from './utils/processUtils';

// Keep in sync with github.com/acroca/go-symbols'
interface GoSymbolDeclaration {
  name: string;
  kind: string;
  package: string;
  path: string;
  line: number;
  character: number;
}

export class GoWorkspaceSymbolProvider implements qv.WorkspaceSymbolProvider {
  private goKindToCodeKind: { [key: string]: qv.SymbolKind } = {
    package: qv.SymbolKind.Package,
    import: qv.SymbolKind.Namespace,
    var: qv.SymbolKind.Variable,
    type: qv.SymbolKind.Interface,
    func: qv.SymbolKind.Function,
    const: qv.SymbolKind.Constant,
  };

  public provideWorkspaceSymbols(query: string, token: qv.CancellationToken): Thenable<qv.SymbolInformation[]> {
    const convertToCodeSymbols = (decls: GoSymbolDeclaration[], symbols: qv.SymbolInformation[]): void => {
      if (!decls) {
        return;
      }
      for (const decl of decls) {
        let kind: qv.SymbolKind;
        if (decl.kind !== '') {
          kind = this.goKindToCodeKind[decl.kind];
        }
        const pos = new qv.Position(decl.line, decl.character);
        const symbolInfo = new qv.SymbolInformation(decl.name, kind, new qv.Range(pos, pos), qv.Uri.file(decl.path), '');
        symbols.push(symbolInfo);
      }
    };
    const root = getWorkspaceFolderPath(qv.window.activeTextEditor && qv.window.activeTextEditor.document.uri);
    const goConfig = getGoConfig();

    if (!root && !goConfig.gotoSymbol.includeGoroot) {
      qv.window.showInformationMessage('No workspace is open to find symbols.');
      return;
    }

    return getWorkspaceSymbols(root, query, token, goConfig).then((results) => {
      const symbols: qv.SymbolInformation[] = [];
      convertToCodeSymbols(results, symbols);
      return symbols;
    });
  }
}

export function getWorkspaceSymbols(
  workspacePath: string,
  query: string,
  token: qv.CancellationToken,
  goConfig?: qv.WorkspaceConfiguration,
  ignoreFolderFeatureOn = true
): Thenable<GoSymbolDeclaration[]> {
  if (!goConfig) {
    goConfig = getGoConfig();
  }
  const gotoSymbolConfig = goConfig['gotoSymbol'];
  const calls: Promise<GoSymbolDeclaration[]>[] = [];

  const ignoreFolders: string[] = gotoSymbolConfig ? gotoSymbolConfig['ignoreFolders'] : [];
  const baseArgs = ignoreFolderFeatureOn && ignoreFolders && ignoreFolders.length > 0 ? ['-ignore', ignoreFolders.join(',')] : [];

  calls.push(callGoSymbols([...baseArgs, workspacePath, query], token));

  if (gotoSymbolConfig.includeGoroot) {
    const goRoot = getCurrentGoRoot();
    const gorootCall = callGoSymbols([...baseArgs, goRoot, query], token);
    calls.push(gorootCall);
  }

  return Promise.all(calls)
    .then(([...results]) => <GoSymbolDeclaration[]>[].concat(...results))
    .catch((err: Error) => {
      if (err && (<any>err).code === 'ENOENT') {
        promptForMissingTool('go-symbols');
      }
      if (err.message.startsWith('flag provided but not defined: -ignore')) {
        promptForUpdatingTool('go-symbols');
        return getWorkspaceSymbols(workspacePath, query, token, goConfig, false);
      }
    });
}

function callGoSymbols(args: string[], token: qv.CancellationToken): Promise<GoSymbolDeclaration[]> {
  const gosyms = getBinPath('go-symbols');
  const env = toolExecutionEnvironment();
  let p: cp.ChildProcess;

  if (token) {
    token.onCancellationRequested(() => killProcessTree(p));
  }

  return new Promise((resolve, reject) => {
    p = cp.execFile(gosyms, args, { maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err && stderr && stderr.startsWith('flag provided but not defined: -ignore')) {
        return reject(new Error(stderr));
      } else if (err) {
        return reject(err);
      }
      const result = stdout.toString();
      const decls = <GoSymbolDeclaration[]>JSON.parse(result);
      return resolve(decls);
    });
  });
}
