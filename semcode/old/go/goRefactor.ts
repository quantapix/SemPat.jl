/* eslint-disable @typescript-eslint/no-unused-vars */
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');

export class GoRefactorProvider implements qv.CodeActionProvider {
  public provideCodeActions(document: qv.TextDocument, range: qv.Range, context: qv.CodeActionContext, token: qv.CancellationToken): qv.ProviderResult<qv.CodeAction[]> {
    if (range.isEmpty) {
      return [];
    }
    const extractFunction = new qv.CodeAction('Extract to function in package scope', qv.CodeActionKind.RefactorExtract);
    const extractVar = new qv.CodeAction('Extract to variable in local scope', qv.CodeActionKind.RefactorExtract);
    extractFunction.command = {
      title: 'Extract to function in package scope',
      command: 'go.godoctor.extract',
    };
    extractVar.command = {
      title: 'Extract to variable in local scope',
      command: 'go.godoctor.var',
    };

    return [extractFunction, extractVar];
  }
}
