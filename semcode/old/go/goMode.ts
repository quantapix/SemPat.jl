/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');

export const GO_MODE: qv.DocumentFilter = { language: 'go', scheme: 'file' };
export const GO_MOD_MODE: qv.DocumentFilter = { language: 'go.mod', scheme: 'file' };
export const GO_SUM_MODE: qv.DocumentFilter = { language: 'go.sum', scheme: 'file' };

export function isGoFile(document: qv.TextDocument): boolean {
  if (qv.languages.match(GO_MODE, document) || qv.languages.match(GO_MOD_MODE, document) || qv.languages.match(GO_SUM_MODE, document)) {
    return true;
  }
  return false;
}
