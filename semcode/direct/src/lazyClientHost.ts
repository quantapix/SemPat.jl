import * as qv from 'vscode';
import { CommandManager } from '../old/ts/commands/commandManager';
import { OngoingRequestCancellerFactory } from '../old/ts/tsServer/cancellation';
import { ILogDirectoryProvider } from '../old/ts/tsServer/logDirectoryProvider';
import { TsServerProcessFactory } from '../old/ts/tsServer/server';
import { ITypeScriptVersionProvider } from '../old/ts/tsServer/versionProvider';
import TypeScriptServiceClientHost from './clientHost';
import { ActiveJsTsEditorTracker } from '../old/ts/utils/activeJsTsEditorTracker';
import { flatten } from './utils';
import * as fileSchemes from './utils';
import { standardLanguageDescriptions } from '../old/ts/utils/languageDescription';
import { lazy, Lazy } from './utils';
import ManagedFileContextManager from '../old/ts/utils/managedFileContext';
import { PluginManager } from '../old/ts/utils/plugins';

export function createLazyClientHost(
  context: qv.ExtensionContext,
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
  onCompletionAccepted: (item: qv.CompletionItem) => void
): Lazy<TypeScriptServiceClientHost> {
  return lazy(() => {
    const clientHost = new TypeScriptServiceClientHost(standardLanguageDescriptions, context, onCaseInsensitiveFileSystem, services, onCompletionAccepted);

    context.subscriptions.push(clientHost);

    return clientHost;
  });
}

export function lazilyActivateClient(lazyClientHost: Lazy<TypeScriptServiceClientHost>, pluginManager: PluginManager, activeJsTsEditorTracker: ActiveJsTsEditorTracker): qv.Disposable {
  const disposables: qv.Disposable[] = [];

  const supportedLanguage = flatten([...standardLanguageDescriptions.map((x) => x.modeIds), ...pluginManager.plugins.map((x) => x.languages)]);

  let hasActivated = false;
  const maybeActivate = (textDocument: qv.TextDocument): boolean => {
    if (!hasActivated && isSupportedDocument(supportedLanguage, textDocument)) {
      hasActivated = true;

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

  const didActivate = qv.workspace.textDocuments.some(maybeActivate);
  if (!didActivate) {
    const openListener = qv.workspace.onDidOpenTextDocument(
      (doc) => {
        if (maybeActivate(doc)) {
          openListener.dispose();
        }
      },
      undefined,
      disposables
    );
  }

  return qv.Disposable.from(...disposables);
}

function isSupportedDocument(supportedLanguage: readonly string[], document: qv.TextDocument): boolean {
  return supportedLanguage.indexOf(document.languageId) >= 0 && !fileSchemes.disabledSchemes.has(document.uri.scheme);
}
