import * as qv from 'vscode';
import { CommandMgr } from '../old/ts/commands/commandMgr';
import { OngoingRequestCancelFact } from '../old/ts/tsServer/cancellation';
import { LogDirProvider } from '../old/ts/tsServer/logDirProvider';
import { TSServerProcFact } from '../old/ts/tsServer/server';
import { TSVersionProvider } from '../old/ts/tsServer/versionProvider';
import TypeScriptServiceClientHost from './clientHost';
import { ActiveJsTsEditorTracker } from '../old/ts/utils/activeJsTsEditorTracker';
import { flatten } from './utils';
import * as fileSchemes from './utils';
import { standardLangDescriptions } from '../old/ts/utils/languageDescription';
import { lazy, Lazy } from './utils';
import ManagedFileContextMgr from '../old/ts/utils/managedFileContext';
import { PluginMgr } from '../old/ts/utils/plugins';
export function createLazyClientHost(
  context: qv.ExtensionContext,
  onCaseInsensitiveFileSystem: boolean,
  services: {
    pluginMgr: PluginMgr;
    commandMgr: CommandMgr;
    logDirProvider: LogDirProvider;
    cancellerFact: OngoingRequestCancelFact;
    versionProvider: TSVersionProvider;
    processFact: TSServerProcFact;
    activeJsTsEditorTracker: ActiveJsTsEditorTracker;
  },
  onCompletionAccepted: (item: qv.CompletionItem) => void
): Lazy<TypeScriptServiceClientHost> {
  return lazy(() => {
    const clientHost = new TypeScriptServiceClientHost(standardLangDescriptions, context, onCaseInsensitiveFileSystem, services, onCompletionAccepted);
    context.subscriptions.push(clientHost);
    return clientHost;
  });
}
export function lazilyActivateClient(lazyClientHost: Lazy<TypeScriptServiceClientHost>, pluginMgr: PluginMgr, activeJsTsEditorTracker: ActiveJsTsEditorTracker): qv.Disposable {
  const disposables: qv.Disposable[] = [];
  const supportedLang = flatten([...standardLangDescriptions.map((x) => x.modeIds), ...pluginMgr.plugins.map((x) => x.languages)]);
  let hasActivated = false;
  const maybeActivate = (textDocument: qv.TextDocument): boolean => {
    if (!hasActivated && isSupportedDocument(supportedLang, textDocument)) {
      hasActivated = true;
      void lazyClientHost.value;
      disposables.push(
        new ManagedFileContextMgr(activeJsTsEditorTracker, (resource) => {
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
        if (maybeActivate(doc)) openListener.dispose();
      },
      undefined,
      disposables
    );
  }
  return qv.Disposable.from(...disposables);
}
function isSupportedDocument(supportedLang: readonly string[], document: qv.TextDocument): boolean {
  return supportedLang.indexOf(document.languageId) >= 0 && !fileSchemes.disabledSchemes.has(document.uri.scheme);
}
