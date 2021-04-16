import * as path from 'path';
import * as qv from 'vscode';

export const typescript = 'typescript';
export const typescriptreact = 'typescriptreact';
export const javascript = 'javascript';
export const javascriptreact = 'javascriptreact';
export const jsxTags = 'jsx-tags';
export function isSupportedLangMode(d: qv.TextDocument) {
  return qv.languages.match([typescript, typescriptreact, javascript, javascriptreact], d) > 0;
}
export function isTypeScriptDocument(d: qv.TextDocument) {
  return qv.languages.match([typescript, typescriptreact], d) > 0;
}
export const enum DiagLang {
  JavaScript,
  TypeScript,
}
export const allDiagLangs = [DiagLang.JavaScript, DiagLang.TypeScript];
export interface LangDescription {
  readonly id: string;
  readonly diagnosticOwner: string;
  readonly diagnosticSource: string;
  readonly diagnosticLang: DiagLang;
  readonly modeIds: string[];
  readonly configFilePattern?: RegExp;
  readonly isExternal?: boolean;
}
export const standardLangDescriptions: LangDescription[] = [
  {
    id: 'typescript',
    diagnosticOwner: 'typescript',
    diagnosticSource: 'ts',
    diagnosticLang: DiagLang.TypeScript,
    modeIds: [typescript, typescriptreact],
    configFilePattern: /^tsconfig(\..*)?\.json$/gi,
  },
  {
    id: 'javascript',
    diagnosticOwner: 'typescript',
    diagnosticSource: 'ts',
    diagnosticLang: DiagLang.JavaScript,
    modeIds: [javascript, javascriptreact],
    configFilePattern: /^jsconfig(\..*)?\.json$/gi,
  },
];
export function isTsConfigFileName(x: string): boolean {
  return /^tsconfig\.(.+\.)?json$/i.test(path.basename(x));
}
export function isJsConfigOrTsConfigFileName(x: string): boolean {
  return /^[jt]sconfig\.(.+\.)?json$/i.test(path.basename(x));
}
export function doesResourceLookLikeATypeScriptFile(r: qv.Uri): boolean {
  return /\.tsx?$/i.test(r.fsPath);
}
export function doesResourceLookLikeAJavaScriptFile(r: qv.Uri): boolean {
  return /\.jsx?$/i.test(r.fsPath);
}
