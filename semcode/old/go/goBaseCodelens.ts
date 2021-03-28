/* eslint-disable @typescript-eslint/no-unused-vars */
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import vscode = require('vscode');

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
