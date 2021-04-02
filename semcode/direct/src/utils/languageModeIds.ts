import * as qv from 'vscode';

export const typescript = 'typescript';
export const typescriptreact = 'typescriptreact';
export const javascript = 'javascript';
export const javascriptreact = 'javascriptreact';
export const jsxTags = 'jsx-tags';

export function isSupportedLangMode(doc: qv.TextDocument) {
  return qv.languages.match([typescript, typescriptreact, javascript, javascriptreact], doc) > 0;
}

export function isTypeScriptDocument(doc: qv.TextDocument) {
  return qv.languages.match([typescript, typescriptreact], doc) > 0;
}
