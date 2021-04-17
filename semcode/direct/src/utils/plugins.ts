import * as qv from 'vscode';
import * as qu from './base';
import { CancellationToken, CompletionList } from 'vscode-languageserver';
import { ModuleNode } from '../parser/parseNodes';
import { ConfigOptions } from './option';
export interface TsServerPlugin {
  readonly path: string;
  readonly name: string;
  readonly enableForWorkspaceTSVersions: boolean;
  readonly languages: ReadonlyArray<string>;
  readonly configNamespace?: string;
}
namespace TsServerPlugin {
  export function equals(a: TsServerPlugin, b: TsServerPlugin): boolean {
    return a.path === b.path && a.name === b.name && a.enableForWorkspaceTSVersions === b.enableForWorkspaceTSVersions && qu.equals(a.languages, b.languages);
  }
}
export class PluginMgr extends qu.Disposable {
  private readonly configs = new Map<string, {}>();
  private _plugins?: Map<string, ReadonlyArray<TsServerPlugin>>;
  constructor() {
    super();
    qv.extensions.onDidChange(
      () => {
        if (!this._plugins) return;
        const ps = this.readPlugins();
        if (!qu.equals(qu.flatten(Array.from(this._plugins.values())), qu.flatten(Array.from(ps.values())), TsServerPlugin.equals)) {
          this._plugins = ps;
          this._onDidUpdatePlugins.fire(this);
        }
      },
      undefined,
      this._ds
    );
  }
  public get plugins(): ReadonlyArray<TsServerPlugin> {
    if (!this._plugins) this._plugins = this.readPlugins();
    return qu.flatten(Array.from(this._plugins.values()));
  }
  private readonly _onDidUpdatePlugins = this._register(new qv.EventEmitter<this>());
  public readonly onDidChangePlugins = this._onDidUpdatePlugins.event;
  private readonly _onDidUpdateConfig = this._register(new qv.EventEmitter<{ pluginId: string; config: {} }>());
  public readonly onDidUpdateConfig = this._onDidUpdateConfig.event;
  public setConfig(id: string, config: {}) {
    this.configs.set(id, config);
    this._onDidUpdateConfig.fire({ pluginId: id, config });
  }
  public configurations(): IterableIterator<[string, {}]> {
    return this.configs.entries();
  }
  private readPlugins() {
    const ys = new Map<string, ReadonlyArray<TsServerPlugin>>();
    for (const e of qv.extensions.all) {
      const j = e.packageJSON;
      if (j.contributes && Array.isArray(j.contributes.typescriptServerPlugins)) {
        const ps: TsServerPlugin[] = [];
        for (const p of j.contributes.typescriptServerPlugins) {
          ps.push({
            name: p.name,
            enableForWorkspaceTSVersions: !!p.enableForWorkspaceTSVersions,
            path: e.extensionPath,
            languages: Array.isArray(p.languages) ? p.languages : [],
            configNamespace: p.configNamespace,
          });
        }
        if (ps.length) ys.set(e.id, ps);
      }
    }
    return ys;
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
  updateCompletionList(l: CompletionList, ast: ModuleNode, content: string, pos: number, opts: ConfigOptions, t: CancellationToken): Promise<CompletionList>;
  readonly commandPrefix: string;
  executeCommand(command: string, args: any[] | undefined, t: CancellationToken): Promise<void>;
}
