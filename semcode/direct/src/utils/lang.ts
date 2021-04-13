import { basename } from 'path';
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
    modeIds: [languageModeIds.typescript, languageModeIds.typescriptreact],
    configFilePattern: /^tsconfig(\..*)?\.json$/gi,
  },
  {
    id: 'javascript',
    diagnosticOwner: 'typescript',
    diagnosticSource: 'ts',
    diagnosticLang: DiagLang.JavaScript,
    modeIds: [languageModeIds.javascript, languageModeIds.javascriptreact],
    configFilePattern: /^jsconfig(\..*)?\.json$/gi,
  },
];
export function isTsConfigFileName(fileName: string): boolean {
  return /^tsconfig\.(.+\.)?json$/i.test(basename(fileName));
}
export function isJsConfigOrTsConfigFileName(fileName: string): boolean {
  return /^[jt]sconfig\.(.+\.)?json$/i.test(basename(fileName));
}
export function doesResourceLookLikeATypeScriptFile(resource: qv.Uri): boolean {
  return /\.tsx?$/i.test(resource.fsPath);
}
export function doesResourceLookLikeAJavaScriptFile(resource: qv.Uri): boolean {
  return /\.jsx?$/i.test(resource.fsPath);
}
