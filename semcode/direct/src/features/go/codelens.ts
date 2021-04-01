import * as qv from 'vscode';

export abstract class GoBaseCodeLensProvider implements qv.CodeLensProvider {
  protected enabled = true;
  private onDidChangeCodeLensesEmitter = new qv.EventEmitter<void>();

  public get onDidChangeCodeLenses(): qv.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  public setEnabled(enabled: false): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.onDidChangeCodeLensesEmitter.fire();
    }
  }

  public provideCodeLenses(document: qv.TextDocument, token: qv.CancellationToken): qv.ProviderResult<qv.CodeLens[]> {
    return [];
  }
}
