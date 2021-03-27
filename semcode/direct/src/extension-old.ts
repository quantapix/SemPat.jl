/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as qv from 'vscode';
import { Api, getExtensionApi } from './api';
import { CommandManager } from './commands/commandManager';
import { registerBaseCommands } from './commands';
import { LanguageConfigurationManager } from './languageFeatures/languageConfiguration';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { nodeRequestCancellerFactory } from './tsServer/cancellation.electron';
import { NodeLogDirectoryProvider } from './tsServer/logDirectoryProvider.electron';
import { ChildServerProcess } from './tsServer/serverProcess.electron';
import { DiskTypeScriptVersionProvider } from './tsServer/versionProvider.electron';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { onCaseInsenitiveFileSystem } from './utils/fileSystem.electron';
import { PluginManager } from './utils/plugins';
import * as temp from './utils/temp.electron';

export function activate(context: qv.ExtensionContext): Api {
  const pluginManager = new PluginManager();
  context.subscriptions.push(pluginManager);

  const commandManager = new CommandManager();
  context.subscriptions.push(commandManager);

  const onCompletionAccepted = new qv.EventEmitter<qv.CompletionItem>();
  context.subscriptions.push(onCompletionAccepted);

  const logDirectoryProvider = new NodeLogDirectoryProvider(context);
  const versionProvider = new DiskTypeScriptVersionProvider();

  context.subscriptions.push(new LanguageConfigurationManager());

  const activeJsTsEditorTracker = new ActiveJsTsEditorTracker();
  context.subscriptions.push(activeJsTsEditorTracker);

  const lazyClientHost = createLazyClientHost(
    context,
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

  import('./providers/task').then((module) => {
    context.subscriptions.push(module.register(lazyClientHost.map((x) => x.serviceClient)));
  });

  import('./languageFeatures/tsconfig').then((module) => {
    context.subscriptions.push(module.register());
  });

  context.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager, activeJsTsEditorTracker));

  return getExtensionApi(onCompletionAccepted.event, pluginManager);
}

export function deactivate() {
  fs.rmdirSync(temp.getInstanceTempDir(), { recursive: true });
}

/*---------------------------------------------------------------------------------------------
 *  Browser
 *--------------------------------------------------------------------------------------------*/

import * as qv from 'vscode';
import { Api, getExtensionApi } from './api';
import { registerBaseCommands } from './commands';
import { LanguageConfigurationManager } from './languageFeatures/languageConfiguration';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { noopRequestCancellerFactory } from './tsServer/cancellation';
import { noopLogDirectoryProvider } from './tsServer/logDirectoryProvider';
import { ITypeScriptVersionProvider, TypeScriptVersion, TypeScriptVersionSource } from './tsServer/versionProvider';
import { WorkerServerProcess } from './tsServer/serverProcess.browser';
import API from './utils/api';
import { CommandManager } from './commands/commandManager';
import { TypeScriptServiceConfiguration } from './utils/configuration';
import { PluginManager } from './utils/plugins';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';

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

export function activate(context: qv.ExtensionContext): Api {
  const pluginManager = new PluginManager();
  context.subscriptions.push(pluginManager);

  const commandManager = new CommandManager();
  context.subscriptions.push(commandManager);

  context.subscriptions.push(new LanguageConfigurationManager());

  const onCompletionAccepted = new qv.EventEmitter<qv.CompletionItem>();
  context.subscriptions.push(onCompletionAccepted);

  const activeJsTsEditorTracker = new ActiveJsTsEditorTracker();
  context.subscriptions.push(activeJsTsEditorTracker);

  const versionProvider = new StaticVersionProvider(
    new TypeScriptVersion(TypeScriptVersionSource.Bundled, qv.Uri.joinPath(context.extensionUri, 'dist/browser/typescript/tsserver.web.js').toString(), API.fromSimpleString('4.2.0'))
  );

  const lazyClientHost = createLazyClientHost(
    context,
    false,
    {
      pluginManager,
      commandManager,
      logDirectoryProvider: noopLogDirectoryProvider,
      cancellerFactory: noopRequestCancellerFactory,
      versionProvider,
      processFactory: WorkerServerProcess,
      activeJsTsEditorTracker,
    },
    (item) => {
      onCompletionAccepted.fire(item);
    }
  );

  registerBaseCommands(commandManager, lazyClientHost, pluginManager, activeJsTsEditorTracker);

  // context.subscriptions.push(task.register(lazyClientHost.map(x => x.serviceClient)));

  import('./languageFeatures/tsconfig').then((module) => {
    context.subscriptions.push(module.register());
  });

  context.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager, activeJsTsEditorTracker));

  return getExtensionApi(onCompletionAccepted.event, pluginManager);
}
