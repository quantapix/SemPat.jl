import cp = require('child_process');
import * as qv from 'vscode';
import { getGoConfig } from '../config';
import { toolExecutionEnvironment } from '../goEnv';
import { promptForMissingTool, promptForUpdatingTool } from '../goInstallTools';
import { getBinPath, getFileArchive, makeMemoizedByteOffsetConverter } from '../util';
import { killProc } from './utils/processUtils';
export interface GoOutlineRange {
  start: number;
  end: number;
}
export interface GoOutlineDeclaration {
  label: string;
  type: string;
  receiverType?: string;
  icon?: string;
  start: number;
  end: number;
  children?: GoOutlineDeclaration[];
  signature?: GoOutlineRange;
  comment?: GoOutlineRange;
}
export enum GoOutlineImportsOptions {
  Include,
  Exclude,
  Only,
}
export interface GoOutlineOptions {
  fileName: string;
  importsOption: GoOutlineImportsOptions;
  document?: qv.TextDocument;
}
export async function documentSymbols(options: GoOutlineOptions, token: qv.CancellationToken): Promise<qv.DocumentSymbol[]> {
  const decls = await runGoOutline(options, token);
  return convertToCodeSymbols(options.document, decls, options.importsOption !== GoOutlineImportsOptions.Exclude, makeMemoizedByteOffsetConverter(Buffer.from(options.document.getText())));
}
export function runGoOutline(options: GoOutlineOptions, token: qv.CancellationToken): Promise<GoOutlineDeclaration[]> {
  return new Promise<GoOutlineDeclaration[]>((resolve, reject) => {
    const gooutline = getBinPath('go-outline');
    const gooutlineFlags = ['-f', options.fileName];
    if (options.importsOption === GoOutlineImportsOptions.Only) {
      gooutlineFlags.push('-imports-only');
    }
    if (options.document) {
      gooutlineFlags.push('-modified');
    }
    let p: cp.ChildProc;
    if (token) {
      token.onCancellationRequested(() => killProc(p));
    }
    p = cp.execFile(gooutline, gooutlineFlags, { env: toolExecutionEnvironment() }, (err, stdout, stderr) => {
      try {
        if (err && (<any>err).code === 'ENOENT') {
          promptForMissingTool('go-outline');
        }
        if (stderr && stderr.startsWith('flag provided but not defined: ')) {
          promptForUpdatingTool('go-outline');
          if (stderr.startsWith('flag provided but not defined: -imports-only')) {
            options.importsOption = GoOutlineImportsOptions.Include;
          }
          if (stderr.startsWith('flag provided but not defined: -modified')) {
            options.document = null;
          }
          p = null;
          return runGoOutline(options, token).then((results) => {
            return resolve(results);
          });
        }
        if (err) {
          return resolve(null);
        }
        const result = stdout.toString();
        const decls = <GoOutlineDeclaration[]>JSON.parse(result);
        return resolve(decls);
      } catch (e) {
        reject(e);
      }
    });
    if (options.document && p.pid) {
      p.stdin.end(getFileArchive(options.document));
    }
  });
}
const goKindToCodeKind: { [key: string]: qv.SymbolKind } = {
  package: qv.SymbolKind.Package,
  import: qv.SymbolKind.Namespace,
  variable: qv.SymbolKind.Variable,
  constant: qv.SymbolKind.Constant,
  type: qv.SymbolKind.TypeParameter,
  function: qv.SymbolKind.Function,
  struct: qv.SymbolKind.Struct,
  interface: qv.SymbolKind.Interface,
};
function convertToCodeSymbols(document: qv.TextDocument, decls: GoOutlineDeclaration[], includeImports: boolean, byteOffsetToDocumentOffset: (byteOffset: number) => number): qv.DocumentSymbol[] {
  const symbols: qv.DocumentSymbol[] = [];
  (decls || []).forEach((decl) => {
    if (!includeImports && decl.type === 'import') {
      return;
    }
    if (decl.label === '_' && decl.type === 'variable') {
      return;
    }
    const label = decl.receiverType ? `(${decl.receiverType}).${decl.label}` : decl.label;
    const start = byteOffsetToDocumentOffset(decl.start - 1);
    const end = byteOffsetToDocumentOffset(decl.end - 1);
    const startPosition = document.positionAt(start);
    const endPosition = document.positionAt(end);
    const symbolRange = new qv.Range(startPosition, endPosition);
    const selectionRange = startPosition.line === endPosition.line ? symbolRange : new qv.Range(startPosition, document.lineAt(startPosition.line).range.end);
    if (decl.type === 'type') {
      const line = document.lineAt(document.positionAt(start));
      const regexStruct = new RegExp(`^\\s*type\\s+${decl.label}\\s+struct\\b`);
      const regexInterface = new RegExp(`^\\s*type\\s+${decl.label}\\s+interface\\b`);
      decl.type = regexStruct.test(line.text) ? 'struct' : regexInterface.test(line.text) ? 'interface' : 'type';
    }
    const symbolInfo = new qv.DocumentSymbol(label, decl.type, goKindToCodeKind[decl.type], symbolRange, selectionRange);
    symbols.push(symbolInfo);
    if (decl.children) {
      symbolInfo.children = convertToCodeSymbols(document, decl.children, includeImports, byteOffsetToDocumentOffset);
    }
  });
  return symbols;
}
export class GoDocumentSymbolProvider implements qv.DocumentSymbolProvider {
  constructor(private includeImports?: boolean) {}
  public provideDocumentSymbols(document: qv.TextDocument, token: qv.CancellationToken): Thenable<qv.DocumentSymbol[]> {
    if (typeof this.includeImports !== 'boolean') {
      const gotoSymbolConfig = getGoConfig(document.uri)['gotoSymbol'];
      this.includeImports = gotoSymbolConfig ? gotoSymbolConfig['includeImports'] : false;
    }
    const options: GoOutlineOptions = {
      fileName: document.fileName,
      document,
      importsOption: this.includeImports ? GoOutlineImportsOptions.Include : GoOutlineImportsOptions.Exclude,
    };
    return documentSymbols(options, token);
  }
}
