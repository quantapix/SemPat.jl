import * as qv from 'vscode';
import { PluginMgr } from './utils/plugins';

class ApiV0 {
  public constructor(public readonly onCompletionAccepted: qv.Event<qv.CompletionItem & { metadata?: any }>, private readonly _pluginMgr: PluginMgr) {}

  configurePlugin(pluginId: string, configuration: {}): void {
    this._pluginMgr.setConfig(pluginId, configuration);
  }
}

export interface Api {
  getAPI(version: 0): ApiV0 | undefined;
}

export function getExtensionApi(onCompletionAccepted: qv.Event<qv.CompletionItem>, pluginMgr: PluginMgr): Api {
  return {
    getAPI(version) {
      if (version === 0) {
        return new ApiV0(onCompletionAccepted, pluginMgr);
      }
      return undefined;
    },
  };
}
