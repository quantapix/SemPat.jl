import * as vsc from 'vscode';
import { RevealOutputChannelOn } from 'vscode-languageclient';

import { getActiveChannel, RustupConfig } from './rs/rustup';

function fromStringToRevealOutputChannelOn(s: string): RevealOutputChannelOn {
  switch (s && s.toLowerCase()) {
    case 'info':
      return RevealOutputChannelOn.Info;
    case 'warn':
      return RevealOutputChannelOn.Warn;
    case 'error':
      return RevealOutputChannelOn.Error;
    case 'never':
    default:
      return RevealOutputChannelOn.Never;
  }
}

export class RLSConfiguration {
  private readonly configuration: vsc.WorkspaceConfiguration;
  private readonly wsPath: string;

  private constructor(c: vsc.WorkspaceConfiguration, p: string) {
    this.configuration = c;
    this.wsPath = p;
  }

  public static loadFromWorkspace(p: string): RLSConfiguration {
    const c = vsc.workspace.getConfiguration();
    return new RLSConfiguration(c, p);
  }

  private static readRevealOutputChannelOn(c: vsc.WorkspaceConfiguration) {
    const setting = c.get<string>('rust-client.revealOutputChannelOn', 'never');
    return fromStringToRevealOutputChannelOn(setting);
  }

  private static readChannel(wsPath: string, rustupPath: string, c: vsc.WorkspaceConfiguration): string {
    const channel = c.get<string>('rust-client.channel');
    if (channel === 'default' || !channel) {
      try {
        return getActiveChannel(wsPath, rustupPath);
      } catch (e) {
        return 'nightly';
      }
    } else {
      return channel;
    }
  }

  public get rustupPath(): string {
    return this.configuration.get('rust-client.rustupPath', 'rustup');
  }

  public get logToFile(): boolean {
    return this.configuration.get<boolean>('rust-client.logToFile', false);
  }

  public get rustupDisabled(): boolean {
    const rlsOverriden = Boolean(this.rlsPath);
    return rlsOverriden || this.configuration.get<boolean>('rust-client.disableRustup', false);
  }

  public get rustAnalyzer(): { path?: string; releaseTag: string } {
    const cfg = this.configuration;
    const releaseTag = cfg.get('rust.rust-analyzer.releaseTag', 'nightly');
    const path = cfg.get<string>('rust.rust-analyzer.path');
    return { releaseTag, ...{ path } };
  }

  public get revealOutputChannelOn(): RevealOutputChannelOn {
    return RLSConfiguration.readRevealOutputChannelOn(this.configuration);
  }

  public get updateOnStartup(): boolean {
    return this.configuration.get<boolean>('rust-client.updateOnStartup', true);
  }

  public get channel(): string {
    return RLSConfiguration.readChannel(this.wsPath, this.rustupPath, this.configuration);
  }

  public get rlsPath(): string | undefined {
    return this.configuration.get<string>('rust-client.rlsPath');
  }

  public get engine(): 'rls' | 'rust-analyzer' {
    return this.configuration.get('rust-client.engine') || 'rls';
  }

  public get autoStartRls(): boolean {
    return this.configuration.get<boolean>('rust-client.autoStartRls', true);
  }

  public rustupConfig(): RustupConfig {
    return {
      channel: this.channel,
      path: this.rustupPath,
    };
  }
}
