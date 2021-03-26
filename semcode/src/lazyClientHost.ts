/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CommandManager } from '../old/ts/commands/commandManager';
import { OngoingRequestCancellerFactory } from '../old/ts/tsServer/cancellation';
import { ILogDirectoryProvider } from '../old/ts/tsServer/logDirectoryProvider';
import { TsServerProcessFactory } from '../old/ts/tsServer/server';
import { ITypeScriptVersionProvider } from '../old/ts/tsServer/versionProvider';
import TypeScriptServiceClientHost from './clientHost';
import { ActiveJsTsEditorTracker } from '../old/ts/utils/activeJsTsEditorTracker';
import { flatten } from './utils/arrays';
import * as fileSchemes from '../old/ts/utils/fileSchemes';
import { standardLanguageDescriptions } from '../old/ts/utils/languageDescription';
import { lazy, Lazy } from './utils/lazy';
import ManagedFileContextManager from '../old/ts/utils/managedFileContext';
import { PluginManager } from '../old/ts/utils/plugins';

export function createLazyClientHost(
  context: vscode.ExtensionContext,
  onCaseInsensitiveFileSystem: boolean,
  services: {
    pluginManager: PluginManager;
    commandManager: CommandManager;
    logDirectoryProvider: ILogDirectoryProvider;
    cancellerFactory: OngoingRequestCancellerFactory;
    versionProvider: ITypeScriptVersionProvider;
    processFactory: TsServerProcessFactory;
    activeJsTsEditorTracker: ActiveJsTsEditorTracker;
  },
  onCompletionAccepted: (item: vscode.CompletionItem) => void
): Lazy<TypeScriptServiceClientHost> {
  return lazy(() => {
    const clientHost = new TypeScriptServiceClientHost(standardLanguageDescriptions, context, onCaseInsensitiveFileSystem, services, onCompletionAccepted);

    context.subscriptions.push(clientHost);

    return clientHost;
  });
}

export function lazilyActivateClient(lazyClientHost: Lazy<TypeScriptServiceClientHost>, pluginManager: PluginManager, activeJsTsEditorTracker: ActiveJsTsEditorTracker): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];

  const supportedLanguage = flatten([...standardLanguageDescriptions.map((x) => x.modeIds), ...pluginManager.plugins.map((x) => x.languages)]);

  let hasActivated = false;
  const maybeActivate = (textDocument: vscode.TextDocument): boolean => {
    if (!hasActivated && isSupportedDocument(supportedLanguage, textDocument)) {
      hasActivated = true;
      // Force activation
      void lazyClientHost.value;

      disposables.push(
        new ManagedFileContextManager(activeJsTsEditorTracker, (resource) => {
          return lazyClientHost.value.serviceClient.toPath(resource);
        })
      );
      return true;
    }
    return false;
  };

  const didActivate = vscode.workspace.textDocuments.some(maybeActivate);
  if (!didActivate) {
    const openListener = vscode.workspace.onDidOpenTextDocument(
      (doc) => {
        if (maybeActivate(doc)) {
          openListener.dispose();
        }
      },
      undefined,
      disposables
    );
  }

  return vscode.Disposable.from(...disposables);
}

function isSupportedDocument(supportedLanguage: readonly string[], document: vscode.TextDocument): boolean {
  return supportedLanguage.indexOf(document.languageId) >= 0 && !fileSchemes.disabledSchemes.has(document.uri.scheme);
}
