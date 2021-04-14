import * as qv from 'vscode';
import VsCodeTelemetryReporter from 'vscode-extension-telemetry';
import { memoize } from './memoize';
interface PackageInfo {
  readonly name: string;
  readonly version: string;
  readonly aiKey: string;
}
export interface TelemetryProperties {
  readonly [k: string]: string | number | undefined;
}
export interface TelemetryReporter {
  logTelemetry(n: string, ps?: TelemetryProperties): void;
  dispose(): void;
}
export class VSCodeTelemetryReporter implements TelemetryReporter {
  private _reporter?: VsCodeTelemetryReporter;
  constructor(private readonly clientVersionDelegate: () => string) {}
  public logTelemetry(n: string, ps: { [k: string]: string } = {}) {
    const r = this.reporter;
    if (!r) return;
    /* __GDPR__FRAGMENT__
			"TypeScriptCommonProperties" : {
				"version" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
    ps['version'] = this.clientVersionDelegate();
    r.sendTelemetryEvent(n, ps);
  }
  public dispose() {
    if (this._reporter) {
      this._reporter.dispose();
      this._reporter = undefined;
    }
  }
  @memoize
  private get reporter(): VsCodeTelemetryReporter | undefined {
    if (this.packageInfo && this.packageInfo.aiKey) {
      this._reporter = new VsCodeTelemetryReporter(this.packageInfo.name, this.packageInfo.version, this.packageInfo.aiKey);
      return this._reporter;
    }
    return;
  }
  @memoize
  private get packageInfo(): PackageInfo | undefined {
    const { packageJSON } = qv.extensions.getExtension('qv.typescript-language-features')!;
    return packageJSON ? { name: packageJSON.name, version: packageJSON.version, aiKey: packageJSON.aiKey } : undefined;
  }
}
