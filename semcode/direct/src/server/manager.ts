import * as qv from 'vscode';
import { TSServiceConfig } from '../utils/configuration';
import { Disposable } from '../utils';
import { TSVersionProvider, TSVersion } from './version';
const useWorkspaceTsdkStorageKey = 'typescript.useWorkspaceTsdk';
const suppressPromptWorkspaceTsdkStorageKey = 'typescript.suppressPromptWorkspaceTsdk';
interface QuickPickItem extends qv.QuickPickItem {
  run(): void;
}
export class TSVersionMgr extends Disposable {
  private _currentVersion: TSVersion;
  public constructor(private configuration: TSServiceConfig, private readonly versionProvider: TSVersionProvider, private readonly workspaceState: qv.Memento) {
    super();
    this._currentVersion = this.versionProvider.defaultVersion;
    if (this.useWorkspaceTsdkSetting) {
      if (this.isWorkspaceTrusted) {
        const localVersion = this.versionProvider.localVersion;
        if (localVersion) {
          this._currentVersion = localVersion;
        }
      } else {
        setImmediate(() => {
          qv.workspace.requireWorkspaceTrust({ modal: false }).then((trustState) => {
            if (trustState === qv.WorkspaceTrustState.Trusted && this.versionProvider.localVersion) {
              this.updateActiveVersion(this.versionProvider.localVersion);
            } else {
              this.updateActiveVersion(this.versionProvider.defaultVersion);
            }
          });
        });
      }
    }
    if (this.isInPromptWorkspaceTsdkState(configuration)) {
      setImmediate(() => {
        this.promptUseWorkspaceTsdk();
      });
    }
  }
  private readonly _onDidPickNewVersion = this._register(new qv.EventEmitter<void>());
  public readonly onDidPickNewVersion = this._onDidPickNewVersion.event;
  public updateConfig(nextConfig: TSServiceConfig) {
    const lastConfig = this.configuration;
    this.configuration = nextConfig;
    if (!this.isInPromptWorkspaceTsdkState(lastConfig) && this.isInPromptWorkspaceTsdkState(nextConfig)) {
      this.promptUseWorkspaceTsdk();
    }
  }
  public get currentVersion(): TSVersion {
    return this._currentVersion;
  }
  public reset(): void {
    this._currentVersion = this.versionProvider.bundledVersion;
  }
  public async promptUserForVersion(): Promise<void> {
    const selected = await qv.window.showQuickPick<QuickPickItem>([this.getBundledPickItem(), ...this.getLocalPickItems(), LearnMorePickItem], {
      placeHolder: 'selectTsVersion',
    });
    return selected?.run();
  }
  private getBundledPickItem(): QuickPickItem {
    const bundledVersion = this.versionProvider.defaultVersion;
    return {
      label: (!this.useWorkspaceTsdkSetting || !this.isWorkspaceTrusted ? '• ' : '') + 'useVSCodeVersionOption',
      description: bundledVersion.displayName,
      detail: bundledVersion.pathLabel,
      run: async () => {
        await this.workspaceState.update(useWorkspaceTsdkStorageKey, false);
        this.updateActiveVersion(bundledVersion);
      },
    };
  }
  private getLocalPickItems(): QuickPickItem[] {
    return this.versionProvider.localVersions.map((v) => {
      return {
        label: (this.useWorkspaceTsdkSetting && this.isWorkspaceTrusted && this.currentVersion.eq(v) ? '• ' : '') + 'useWorkspaceVersionOption',
        description: v.displayName,
        detail: v.pathLabel,
        run: async () => {
          const trustState = await qv.workspace.requireWorkspaceTrust();
          if (trustState === qv.WorkspaceTrustState.Trusted) {
            await this.workspaceState.update(useWorkspaceTsdkStorageKey, true);
            const tsConfig = qv.workspace.getConfig('typescript');
            await tsConfig.update('tsdk', v.pathLabel, false);
            this.updateActiveVersion(v);
          }
        },
      };
    });
  }
  private async promptUseWorkspaceTsdk(): Promise<void> {
    const workspaceVersion = this.versionProvider.localVersion;
    if (workspaceVersion === undefined) {
      throw new Error('Could not prompt to use workspace TypeScript version because no workspace version is specified');
    }
    const allowIt = 'allow';
    const dismissPrompt = 'dismiss';
    const suppressPrompt = 'suppress prompt';
    const result = await qv.window.showInformationMessage('promptUseWorkspaceTsdk', allowIt, dismissPrompt, suppressPrompt);
    if (result === allowIt) {
      await this.workspaceState.update(useWorkspaceTsdkStorageKey, true);
      this.updateActiveVersion(workspaceVersion);
    } else if (result === suppressPrompt) {
      await this.workspaceState.update(suppressPromptWorkspaceTsdkStorageKey, true);
    }
  }
  private updateActiveVersion(v: TSVersion) {
    const oldVersion = this.currentVersion;
    this._currentVersion = v;
    if (!oldVersion.eq(v)) {
      this._onDidPickNewVersion.fire();
    }
  }
  private get isWorkspaceTrusted(): boolean {
    return qv.workspace.trustState === qv.WorkspaceTrustState.Trusted;
  }
  private get useWorkspaceTsdkSetting(): boolean {
    return this.workspaceState.get<boolean>(useWorkspaceTsdkStorageKey, false);
  }
  private get suppressPromptWorkspaceTsdkSetting(): boolean {
    return this.workspaceState.get<boolean>(suppressPromptWorkspaceTsdkStorageKey, false);
  }
  private isInPromptWorkspaceTsdkState(configuration: TSServiceConfig) {
    return configuration.localTsdk !== null && configuration.enablePromptUseWorkspaceTsdk === true && this.suppressPromptWorkspaceTsdkSetting === false && this.useWorkspaceTsdkSetting === false;
  }
}
const LearnMorePickItem: QuickPickItem = {
  label: 'learnMore',
  description: '',
  run: () => {
    qv.env.openExternal(qv.Uri.parse('https://go.microsoft.com/fwlink/?linkid=839919'));
  },
};
