import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { ServiceClient } from '../service';
import * as qk from '../utils/key';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../server/proto';
import cp = require('child_process');
import { getGoConfig } from '../config';
import { toolExecutionEnvironment } from '../goEnv';
import { promptForMissingTool, promptForUpdatingTool } from '../goInstallTools';
import { getBinPath, getFileArchive, makeMemoizedByteOffsetConverter } from '../util';
import { killProc } from './utils/processUtils';
import { CancellationToken, DocumentSymbol, Location, SymbolInformation, SymbolKind } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { resolveAliasDeclaration } from '../analyzer/aliasDeclarationUtils';
import { AnalyzerFileInfo, ImportLookup } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { AliasDeclaration, Declaration, DeclarationType } from '../analyzer/declaration';
import { getNameFromDeclaration } from '../analyzer/declarationUtils';
import { getLastTypedDeclaredForSymbol } from '../analyzer/symbolUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { isProperty } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetsToRange } from '../common/positionUtils';
import * as StringUtils from '../common/stringUtils';
import { Range } from '../common/textRange';
import { ParseResults } from '../parser/parser';

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
    if (options.importsOption === GoOutlineImportsOptions.Only) gooutlineFlags.push('-imports-only');
    if (options.document) gooutlineFlags.push('-modified');
    let p: cp.ChildProc;
    if (token) token.onCancellationRequested(() => killProc(p));
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
        if (err) return resolve(null);
        const result = stdout.toString();
        const decls = <GoOutlineDeclaration[]>JSON.parse(result);
        return resolve(decls);
      } catch (e) {
        reject(e);
      }
    });
    if (options.document && p.pid) p.stdin.end(getFileArchive(options.document));
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
function convertToCodeSymbols(d: qv.TextDocument, decls: GoOutlineDeclaration[], includeImports: boolean, byteOffsetToDocumentOffset: (o: number) => number): qv.DocumentSymbol[] {
  const symbols: qv.DocumentSymbol[] = [];
  (decls || []).forEach((decl) => {
    if (!includeImports && decl.type === 'import') return;
    if (decl.label === '_' && decl.type === 'variable') return;
    const label = decl.receiverType ? `(${decl.receiverType}).${decl.label}` : decl.label;
    const start = byteOffsetToDocumentOffset(decl.start - 1);
    const end = byteOffsetToDocumentOffset(decl.end - 1);
    const startPosition = d.positionAt(start);
    const endPosition = d.positionAt(end);
    const symbolRange = new qv.Range(startPosition, endPosition);
    const selectionRange = startPosition.line === endPosition.line ? symbolRange : new qv.Range(startPosition, d.lineAt(startPosition.line).range.end);
    if (decl.type === 'type') {
      const line = d.lineAt(d.positionAt(start));
      const regexStruct = new RegExp(`^\\s*type\\s+${decl.label}\\s+struct\\b`);
      const regexInterface = new RegExp(`^\\s*type\\s+${decl.label}\\s+interface\\b`);
      decl.type = regexStruct.test(line.text) ? 'struct' : regexInterface.test(line.text) ? 'interface' : 'type';
    }
    const symbolInfo = new qv.DocumentSymbol(label, decl.type, goKindToCodeKind[decl.type], symbolRange, selectionRange);
    symbols.push(symbolInfo);
    if (decl.children) symbolInfo.children = convertToCodeSymbols(d, decl.children, includeImports, byteOffsetToDocumentOffset);
  });
  return symbols;
}
export class GoSymbol implements qv.DocumentSymbolProvider {
  constructor(private includeImports?: boolean) {}
  public provideDocumentSymbols(d: qv.TextDocument, t: qv.CancellationToken): Thenable<qv.DocumentSymbol[]> {
    if (typeof this.includeImports !== 'boolean') {
      const gotoSymbolConfig = getGoConfig(d.uri)['gotoSymbol'];
      this.includeImports = gotoSymbolConfig ? gotoSymbolConfig['includeImports'] : false;
    }
    const options: GoOutlineOptions = {
      fileName: d.fileName,
      document: d,
      importsOption: this.includeImports ? GoOutlineImportsOptions.Include : GoOutlineImportsOptions.Exclude,
    };
    return documentSymbols(options, t);
  }
}

class TsSymbol implements qv.DocumentSymbolProvider {
  public constructor(private readonly client: ServiceClient, private cached: CachedResponse<qp.NavTreeResponse>) {}
  public async provideDocumentSymbols(d: qv.TextDocument, t: qv.CancellationToken): Promise<qv.DocumentSymbol[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs: qp.FileRequestArgs = { file: f };
    const response = await this.cached.execute(d, () => this.client.execute('navtree', xs, t));
    if (response.type !== 'response' || !response.body?.childItems) return undefined;
    const y: qv.DocumentSymbol[] = [];
    for (const i of response.body.childItems) {
      convertNavTree(d.uri, y, i);
    }
    return y;
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient, r: CachedResponse<qp.NavTreeResponse>) {
  return qv.languages.registerDocumentSymbolProvider(s.syntax, new TsSymbol(c, r), { label: 'TypeScript' });
}
function convertNavTree(u: qv.Uri, out: qv.DocumentSymbol[], t: qp.NavigationTree): boolean {
  let y = shouldIncludeEntry(t);
  if (!y && !t.childItems?.length) return false;
  const cs = new Set(t.childItems || []);
  for (const s of t.spans) {
    const r = qu.Range.fromTextSpan(s);
    const symbolInfo = convertSymbol(t, r);
    for (const c of cs) {
      if (c.spans.some((x) => !!r.intersection(qu.Range.fromTextSpan(x)))) {
        const includedChild = convertNavTree(u, symbolInfo.children, c);
        y = y || includedChild;
        cs.delete(c);
      }
    }
    if (y) out.push(symbolInfo);
  }
  return y;
}
function convertSymbol(t: qp.NavigationTree, r: qv.Range): qv.DocumentSymbol {
  const selectionRange = t.nameSpan ? qu.Range.fromTextSpan(t.nameSpan) : r;
  let x = t.text;
  switch (t.kind) {
    case qk.Kind.memberGetAccessor:
      x = `(get) ${x}`;
      break;
    case qk.Kind.memberSetAccessor:
      x = `(set) ${x}`;
      break;
  }
  const y = new qv.DocumentSymbol(x, '', getSymbolKind(t.kind), r, r.contains(selectionRange) ? selectionRange : r);
  const ms = qu.parseKindModifier(t.kindModifiers);
  if (ms.has(qk.KindModifiers.depreacted)) y.tags = [qv.SymbolTag.Deprecated];
  return y;
}
function shouldIncludeEntry(t: qp.NavigationTree | qp.NavigationBarItem): boolean {
  if (t.kind === qk.Kind.alias) return false;
  return !!(t.text && t.text !== '<function>' && t.text !== '<class>');
}
function getSymbolKind(k: string): qv.SymbolKind {
  switch (k) {
    case qk.Kind.module:
      return qv.SymbolKind.Module;
    case qk.Kind.class:
      return qv.SymbolKind.Class;
    case qk.Kind.enum:
      return qv.SymbolKind.Enum;
    case qk.Kind.interface:
      return qv.SymbolKind.Interface;
    case qk.Kind.method:
      return qv.SymbolKind.Method;
    case qk.Kind.memberVariable:
      return qv.SymbolKind.Property;
    case qk.Kind.memberGetAccessor:
      return qv.SymbolKind.Property;
    case qk.Kind.memberSetAccessor:
      return qv.SymbolKind.Property;
    case qk.Kind.variable:
      return qv.SymbolKind.Variable;
    case qk.Kind.const:
      return qv.SymbolKind.Variable;
    case qk.Kind.localVariable:
      return qv.SymbolKind.Variable;
    case qk.Kind.function:
      return qv.SymbolKind.Function;
    case qk.Kind.localFunction:
      return qv.SymbolKind.Function;
    case qk.Kind.constructSignature:
      return qv.SymbolKind.Constructor;
    case qk.Kind.constructorImplementation:
      return qv.SymbolKind.Constructor;
  }
  return qv.SymbolKind.Variable;
}

export interface IndexAliasData {
  readonly originalName: string;
  readonly modulePath: string;
  readonly kind: SymbolKind;
}
export interface IndexSymbolData {
  readonly name: string;
  readonly externallyVisible: boolean;
  readonly kind: SymbolKind;
  readonly alias?: IndexAliasData;
  readonly range?: Range;
  readonly selectionRange?: Range;
  readonly children?: IndexSymbolData[];
}
export interface IndexResults {
  readonly privateOrProtected: boolean;
  readonly symbols: IndexSymbolData[];
}
export interface IndexOptions {
  indexingForAutoImportMode: boolean;
}
export type WorkspaceSymbolCallback = (symbols: SymbolInformation[]) => void;
export function getIndexAliasData(importLookup: ImportLookup, declaration: AliasDeclaration): IndexAliasData | undefined {
  if (!declaration.symbolName) return undefined;
  const resolved = resolveAliasDeclaration(importLookup, declaration, /* resolveLocalNames */ true);
  const nameValue = resolved ? getNameFromDeclaration(resolved) : undefined;
  if (!nameValue || resolved!.path.length <= 0) return undefined;
  return {
    originalName: nameValue,
    modulePath: resolved!.path,
    kind: getSymbolKind(nameValue, resolved!) ?? SymbolKind.Module,
  };
}
export function convertToFlatSymbols(documentUri: string, symbolList: DocumentSymbol[]): SymbolInformation[] {
  const flatSymbols: SymbolInformation[] = [];
  for (const symbol of symbolList) {
    appendToFlatSymbolsRecursive(flatSymbols, documentUri, symbol);
  }
  return flatSymbols;
}
export class PySymbol {
  static getSymbolsForDocument(
    fileInfo: AnalyzerFileInfo | undefined,
    indexResults: IndexResults | undefined,
    parseResults: ParseResults | undefined,
    filePath: string,
    query: string,
    token: CancellationToken
  ): SymbolInformation[] {
    const symbolList: SymbolInformation[] = [];
    if (!indexResults && !parseResults) return symbolList;
    const indexSymbolData = (indexResults?.symbols as IndexSymbolData[]) ?? PySymbol.indexSymbols(fileInfo!, parseResults!, { indexingForAutoImportMode: false }, token);
    appendWorkspaceSymbolsRecursive(indexSymbolData, filePath, query, '', symbolList, token);
    return symbolList;
  }
  static addHierarchicalSymbolsForDocument(
    fileInfo: AnalyzerFileInfo | undefined,
    indexResults: IndexResults | undefined,
    parseResults: ParseResults | undefined,
    symbolList: DocumentSymbol[],
    token: CancellationToken
  ) {
    if (!indexResults && !parseResults) return;
    const indexSymbolData = (indexResults?.symbols as IndexSymbolData[]) ?? PySymbol.indexSymbols(fileInfo!, parseResults!, { indexingForAutoImportMode: false }, token);
    appendDocumentSymbolsRecursive(indexSymbolData, symbolList, token);
  }
  static indexSymbols(fileInfo: AnalyzerFileInfo, parseResults: ParseResults, options: IndexOptions, token: CancellationToken): IndexSymbolData[] {
    const indexSymbolData: IndexSymbolData[] = [];
    collectSymbolIndexData(fileInfo, parseResults, parseResults.parseTree, options, indexSymbolData, token);
    return indexSymbolData;
  }
}
function getSymbolKind(name: string, declaration: Declaration, evaluator?: TypeEvaluator): SymbolKind | undefined {
  let symbolKind: SymbolKind;
  switch (declaration.type) {
    case DeclarationType.Class:
    case DeclarationType.SpecialBuiltInClass:
      symbolKind = SymbolKind.Class;
      break;
    case DeclarationType.Function:
      if (declaration.isMethod) {
        const declType = evaluator?.getTypeForDeclaration(declaration);
        if (declType && isProperty(declType)) {
          symbolKind = SymbolKind.Property;
        } else {
          symbolKind = SymbolKind.Method;
        }
      } else {
        symbolKind = SymbolKind.Function;
      }
      break;
    case DeclarationType.Alias:
      symbolKind = SymbolKind.Module;
      break;
    case DeclarationType.Parameter:
      if (name === 'self' || name === 'cls' || name === '_') return;
      symbolKind = SymbolKind.Variable;
      break;
    case DeclarationType.Variable:
      if (name === '_') return;
      symbolKind = declaration.isConstant || declaration.isFinal ? SymbolKind.Constant : SymbolKind.Variable;
      break;
    default:
      symbolKind = SymbolKind.Variable;
      break;
  }
  return symbolKind;
}
function appendWorkspaceSymbolsRecursive(
  indexSymbolData: IndexSymbolData[] | undefined,
  filePath: string,
  query: string,
  container: string,
  symbolList: SymbolInformation[],
  token: CancellationToken
) {
  throwIfCancellationRequested(token);
  if (!indexSymbolData) return;
  for (const symbolData of indexSymbolData) {
    if (symbolData.alias) continue;
    if (StringUtils.isPatternInSymbol(query, symbolData.name)) {
      const location: Location = {
        uri: URI.file(filePath).toString(),
        range: symbolData.selectionRange!,
      };
      const symbolInfo: SymbolInformation = {
        name: symbolData.name,
        kind: symbolData.kind,
        containerName: container.length > 0 ? container : undefined,
        location,
      };
      symbolList.push(symbolInfo);
    }
    appendWorkspaceSymbolsRecursive(symbolData.children, filePath, query, getContainerName(container, symbolData.name), symbolList, token);
  }
  function getContainerName(container: string, name: string) {
    if (container.length > 0) return `${container}.${name}`;
    return name;
  }
}
function appendDocumentSymbolsRecursive(indexSymbolData: IndexSymbolData[] | undefined, symbolList: DocumentSymbol[], token: CancellationToken) {
  throwIfCancellationRequested(token);
  if (!indexSymbolData) return;
  for (const symbolData of indexSymbolData) {
    if (symbolData.alias) continue;
    const children: DocumentSymbol[] = [];
    appendDocumentSymbolsRecursive(symbolData.children, children, token);
    const symbolInfo: DocumentSymbol = {
      name: symbolData.name,
      kind: symbolData.kind,
      range: symbolData.range!,
      selectionRange: symbolData.selectionRange!,
      children: children!,
    };
    symbolList.push(symbolInfo);
  }
}
function collectSymbolIndexData(
  fileInfo: AnalyzerFileInfo,
  parseResults: ParseResults,
  node: AnalyzerNodeInfo.ScopedNode,
  options: IndexOptions,
  indexSymbolData: IndexSymbolData[],
  token: CancellationToken
) {
  throwIfCancellationRequested(token);
  const scope = AnalyzerNodeInfo.getScope(node);
  if (!scope) return;
  const symbolTable = scope.symbolTable;
  symbolTable.forEach((symbol, name) => {
    if (symbol.isIgnoredForProtocolMatch()) return;
    if (options.indexingForAutoImportMode && !fileInfo.isStubFile && !fileInfo.isInPyTypedPackage && !symbol.isInDunderAll()) return;
    let declaration = getLastTypedDeclaredForSymbol(symbol);
    if (!declaration && symbol.hasDeclarations()) {
      declaration = symbol.getDeclarations()[0];
    }
    if (!declaration) return;
    if (DeclarationType.Alias === declaration.type) {
      if (!options.indexingForAutoImportMode) return;

      if (declaration.path.length <= 0) return;
    }
    collectSymbolIndexDataForName(fileInfo, parseResults, declaration, options, !symbol.isExternallyHidden(), name, indexSymbolData, token);
  });
}
function collectSymbolIndexDataForName(
  fileInfo: AnalyzerFileInfo,
  parseResults: ParseResults,
  declaration: Declaration,
  options: IndexOptions,
  externallyVisible: boolean,
  name: string,
  indexSymbolData: IndexSymbolData[],
  token: CancellationToken
) {
  if (options.indexingForAutoImportMode && !externallyVisible) return;
  const symbolKind = getSymbolKind(name, declaration);
  if (symbolKind === undefined) return;
  const selectionRange = declaration.range;
  let range = selectionRange;
  const children: IndexSymbolData[] = [];
  if (declaration.type === DeclarationType.Class || declaration.type === DeclarationType.Function) {
    if (!options.indexingForAutoImportMode) collectSymbolIndexData(fileInfo, parseResults, declaration.node, options, children, token);

    range = convertOffsetsToRange(declaration.node.start, declaration.node.start + declaration.node.length, parseResults.tokenizerOutput.lines);
  }
  const data: IndexSymbolData = {
    name,
    externallyVisible,
    kind: symbolKind,
    alias: DeclarationType.Alias === declaration.type ? getIndexAliasData(AnalyzerNodeInfo.getFileInfo(parseResults.parseTree)!.importLookup, declaration) : undefined,
    range: options.indexingForAutoImportMode ? undefined : range,
    selectionRange: options.indexingForAutoImportMode ? undefined : selectionRange,
    children: options.indexingForAutoImportMode ? undefined : children,
  };
  indexSymbolData.push(data);
}
function appendToFlatSymbolsRecursive(flatSymbols: SymbolInformation[], documentUri: string, symbol: DocumentSymbol, parent?: DocumentSymbol) {
  const flatSymbol: SymbolInformation = {
    name: symbol.name,
    kind: symbol.kind,
    location: Location.create(documentUri, symbol.range),
    tags: symbol.tags,
    containerName: parent?.name,
  };
  flatSymbols.push(flatSymbol);
  if (symbol.children) {
    for (const child of symbol.children) {
      appendToFlatSymbolsRecursive(flatSymbols, documentUri, child, symbol);
    }
  }
}
