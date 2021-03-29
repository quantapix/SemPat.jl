import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { Api, getExtensionApi } from './api';
import { ChildServerProcess } from './tsServer/serverProcess.electron';
import { CommandManager } from './commands/commandManager';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { DiskTypeScriptVersionProvider } from './tsServer/versionProvider.electron';
import { ITypeScriptVersionProvider, TypeScriptVersion } from './tsServer/versionProvider';
import { LanguageConfigurationManager } from './languageFeatures/languageConfiguration';
import { NodeLogDirectoryProvider } from './tsServer/logDirectoryProvider.electron';
import { nodeRequestCancellerFactory } from './tsServer/cancellation.electron';
import { onCaseInsenitiveFileSystem } from './utils/fileSystem.electron';
import { PluginManager } from './utils/plugins';
import { registerBaseCommands } from './commands';
import { TypeScriptServiceConfiguration } from './utils/configuration';
import * as fs from 'fs';
import * as qv from 'vscode';
import * as temp from './utils/temp.electron';

export function activate(ctx: qv.ExtensionContext): Api {
  const pluginManager = new PluginManager();
  ctx.subscriptions.push(pluginManager);
  const commandManager = new CommandManager();
  ctx.subscriptions.push(commandManager);
  const onCompletionAccepted = new qv.EventEmitter<qv.CompletionItem>();
  ctx.subscriptions.push(onCompletionAccepted);
  const logDirectoryProvider = new NodeLogDirectoryProvider(ctx);
  const versionProvider = new DiskTypeScriptVersionProvider();
  ctx.subscriptions.push(new LanguageConfigurationManager());
  const activeJsTsEditorTracker = new ActiveJsTsEditorTracker();
  ctx.subscriptions.push(activeJsTsEditorTracker);
  const lazyClientHost = createLazyClientHost(
    ctx,
    onCaseInsenitiveFileSystem(),
    {
      pluginManager,
      commandManager,
      logDirectoryProvider,
      cancellerFactory: nodeRequestCancellerFactory,
      versionProvider,
      processFactory: ChildServerProcess,
      activeJsTsEditorTracker,
    },
    (item) => {
      onCompletionAccepted.fire(item);
    }
  );
  registerBaseCommands(commandManager, lazyClientHost, pluginManager, activeJsTsEditorTracker);
  import('./providers/task').then((m) => {
    ctx.subscriptions.push(m.register(lazyClientHost.map((x) => x.serviceClient)));
  });
  import('./languageFeatures/tsconfig').then((m) => {
    ctx.subscriptions.push(m.register());
  });
  ctx.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager, activeJsTsEditorTracker));
  return getExtensionApi(onCompletionAccepted.event, pluginManager);
}

export function deactivate() {
  fs.rmdirSync(temp.getInstanceTempDir(), { recursive: true });
}

class StaticVersionProvider implements ITypeScriptVersionProvider {
  constructor(private readonly _version: TypeScriptVersion) {}
  updateConfiguration(_configuration: TypeScriptServiceConfiguration): void {
    // noop
  }
  get defaultVersion() {
    return this._version;
  }
  get bundledVersion() {
    return this._version;
  }
  readonly globalVersion = undefined;
  readonly localVersion = undefined;
  readonly localVersions = [];
}
