import * as qv from 'vscode';
import * as arrays from './arrays';
import { Disposable } from './dispose';
import { CancellationToken, CompletionList } from 'vscode-languageserver';
import { ModuleNode } from '../parser/parseNodes';
import { ConfigOptions } from './opts';
export interface TypeScriptServerPlugin {
  readonly path: string;
  readonly name: string;
  readonly enableForWorkspaceTSVersions: boolean;
  readonly languages: ReadonlyArray<string>;
  readonly configNamespace?: string;
}
namespace TypeScriptServerPlugin {
  export function equals(a: TypeScriptServerPlugin, b: TypeScriptServerPlugin): boolean {
    return a.path === b.path && a.name === b.name && a.enableForWorkspaceTSVersions === b.enableForWorkspaceTSVersions && arrays.equals(a.languages, b.languages);
  }
}
export class PluginMgr extends Disposable {
  private readonly _pluginConfigs = new Map<string, {}>();
  private _plugins: Map<string, ReadonlyArray<TypeScriptServerPlugin>> | undefined;
  constructor() {
    super();
    qv.extensions.onDidChange(
      () => {
        if (!this._plugins) {
          return;
        }
        const newPlugins = this.readPlugins();
        if (!arrays.equals(arrays.flatten(Array.from(this._plugins.values())), arrays.flatten(Array.from(newPlugins.values())), TypeScriptServerPlugin.equals)) {
          this._plugins = newPlugins;
          this._onDidUpdatePlugins.fire(this);
        }
      },
      undefined,
      this._disposables
    );
  }
  public get plugins(): ReadonlyArray<TypeScriptServerPlugin> {
    if (!this._plugins) {
      this._plugins = this.readPlugins();
    }
    return arrays.flatten(Array.from(this._plugins.values()));
  }
  private readonly _onDidUpdatePlugins = this._register(new qv.EventEmitter<this>());
  public readonly onDidChangePlugins = this._onDidUpdatePlugins.event;
  private readonly _onDidUpdateConfig = this._register(new qv.EventEmitter<{ pluginId: string; config: {} }>());
  public readonly onDidUpdateConfig = this._onDidUpdateConfig.event;
  public setConfig(pluginId: string, config: {}) {
    this._pluginConfigs.set(pluginId, config);
    this._onDidUpdateConfig.fire({ pluginId, config });
  }
  public configurations(): IterableIterator<[string, {}]> {
    return this._pluginConfigs.entries();
  }
  private readPlugins() {
    const pluginMap = new Map<string, ReadonlyArray<TypeScriptServerPlugin>>();
    for (const extension of qv.extensions.all) {
      const pack = extension.packageJSON;
      if (pack.contributes && Array.isArray(pack.contributes.typescriptServerPlugins)) {
        const plugins: TypeScriptServerPlugin[] = [];
        for (const plugin of pack.contributes.typescriptServerPlugins) {
          plugins.push({
            name: plugin.name,
            enableForWorkspaceTSVersions: !!plugin.enableForWorkspaceTSVersions,
            path: extension.extensionPath,
            languages: Array.isArray(plugin.languages) ? plugin.languages : [],
            configNamespace: plugin.configNamespace,
          });
        }
        if (plugins.length) {
          pluginMap.set(extension.id, plugins);
        }
      }
    }
    return pluginMap;
  }
}
declare interface Promise<T> {
  ignoreErrors(): void;
}
Promise.prototype.ignoreErrors = function <T>(this: Promise<T>) {
  this.catch(() => {});
};
export interface LangServiceExtension {
  readonly completionListExtension: CompletionListExtension;
}
export interface CompletionListExtension {
  updateCompletionList(sourceList: CompletionList, ast: ModuleNode, content: string, position: number, options: ConfigOptions, token: CancellationToken): Promise<CompletionList>;
  readonly commandPrefix: string;
  executeCommand(command: string, args: any[] | undefined, token: CancellationToken): Promise<void>;
}
