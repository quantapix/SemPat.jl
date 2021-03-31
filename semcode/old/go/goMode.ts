import * as qv from 'vscode';

export const GO_MODE: qv.DocumentFilter = { language: 'go', scheme: 'file' };
export const GO_MOD_MODE: qv.DocumentFilter = { language: 'go.mod', scheme: 'file' };
export const GO_SUM_MODE: qv.DocumentFilter = { language: 'go.sum', scheme: 'file' };

export function isGoFile(document: qv.TextDocument): boolean {
  if (qv.languages.match(GO_MODE, document) || qv.languages.match(GO_MOD_MODE, document) || qv.languages.match(GO_SUM_MODE, document)) {
    return true;
  }
  return false;
}
