import { workspace, WorkspaceConfiguration } from 'vscode';
import { RevealOutputChannelOn } from 'vscode-languageclient';

import { getActiveChannel, RustupConfig } from './rustup';

function fromStringToRevealOutputChannelOn(
  value: string,
): RevealOutputChannelOn {
  switch (value && value.toLowerCase()) {
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
  private readonly configuration: WorkspaceConfiguration;
  private readonly wsPath: string;

  private constructor(configuration: WorkspaceConfiguration, wsPath: string) {
    this.configuration = configuration;
    this.wsPath = wsPath;
  }

  public static loadFromWorkspace(wsPath: string): RLSConfiguration {
    const configuration = workspace.getConfiguration();
    return new RLSConfiguration(configuration, wsPath);
  }

  private static readRevealOutputChannelOn(
    configuration: WorkspaceConfiguration,
  ) {
    const setting = configuration.get<string>(
      'rust-client.revealOutputChannelOn',
      'never',
    );
    return fromStringToRevealOutputChannelOn(setting);
  }

  /**
   * Tries to fetch the `rust-client.channel` configuration value. If missing,
   * falls back on active toolchain specified by rustup (at `rustupPath`),
   * finally defaulting to `nightly` if all fails.
   */
  private static readChannel(
    wsPath: string,
    rustupPath: string,
    configuration: WorkspaceConfiguration,
  ): string {
    const channel = configuration.get<string>('rust-client.channel');
    if (channel === 'default' || !channel) {
      try {
        return getActiveChannel(wsPath, rustupPath);
      } catch (e) {
        // rustup might not be installed at the time the configuration is
        // initially loaded, so silently ignore the error and return a default value
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
    return (
      rlsOverriden ||
      this.configuration.get<boolean>('rust-client.disableRustup', false)
    );
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
    return RLSConfiguration.readChannel(
      this.wsPath,
      this.rustupPath,
      this.configuration,
    );
  }

  /**
   * If specified, RLS will be spawned by executing a file at the given path.
   */
  public get rlsPath(): string | undefined {
    return this.configuration.get<string>('rust-client.rlsPath');
  }

  /** Returns the language analysis engine to be used for the workspace */
  public get engine(): 'rls' | 'rust-analyzer' {
    return this.configuration.get('rust-client.engine') || 'rls';
  }

  /**
   * Whether a language server should be automatically started when opening
   * a relevant Rust project.
   */
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
