import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as qu from '../utils';
import * as qv from 'vscode';
import cp = require('child_process');
import * as path from 'path';
import { getGoConfig } from '../../../../old/go/config';
import { toolExecutionEnvironment } from '../../../../old/go/goEnv';
import { promptForMissingTool } from '../../../../old/go/goInstallTools';
import { byteOffsetAt, canonicalizeGOPATHPrefix, getBinPath, getFileArchive } from '../../../../old/go/util';
import { killProcTree } from './utils/processUtils';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import * as DeclarationUtils from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { ModuleNameNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export class GoReference implements qv.ReferenceProvider {
  public provideReferences(document: qv.TextDocument, position: qv.Position, options: { includeDeclaration: boolean }, token: qv.CancellationToken): Thenable<qv.Location[]> {
    return this.doFindReferences(document, position, options, token);
  }
  private doFindReferences(document: qv.TextDocument, position: qv.Position, options: { includeDeclaration: boolean }, token: qv.CancellationToken): Thenable<qv.Location[]> {
    return new Promise<qv.Location[]>((resolve, reject) => {
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) return resolve([]);
      const goGuru = getBinPath('guru');
      if (!path.isAbsolute(goGuru)) {
        promptForMissingTool('guru');
        return reject('Cannot find tool "guru" to find references.');
      }
      const filename = canonicalizeGOPATHPrefix(document.fileName);
      const cwd = path.dirname(filename);
      const offset = byteOffsetAt(document, wordRange.start);
      const env = toolExecutionEnvironment();
      const buildTags = getGoConfig(document.uri)['buildTags'];
      const args = buildTags ? ['-tags', buildTags] : [];
      args.push('-modified', 'referrers', `${filename}:#${offset.toString()}`);
      const process = cp.execFile(goGuru, args, { env }, (err, stdout, stderr) => {
        try {
          if (err && (<any>err).code === 'ENOENT') {
            promptForMissingTool('guru');
            return reject('Cannot find tool "guru" to find references.');
          }
          if (err && (<any>err).killed !== true) {
            return reject(`Error running guru: ${err.message || stderr}`);
          }
          const lines = stdout.toString().split('\n');
          const results: qv.Location[] = [];
          for (const line of lines) {
            const match = /^(.*):(\d+)\.(\d+)-(\d+)\.(\d+):/.exec(line);
            if (!match) continue;
            const [, file, lineStartStr, colStartStr, lineEndStr, colEndStr] = match;
            const referenceResource = qv.Uri.file(path.resolve(cwd, file));
            if (!options.includeDeclaration) {
              if (document.uri.fsPath === referenceResource.fsPath && position.line === Number(lineStartStr) - 1) {
                continue;
              }
            }
            const range = new qv.Range(+lineStartStr - 1, +colStartStr - 1, +lineEndStr - 1, +colEndStr);
            results.push(new qv.Location(referenceResource, range));
          }
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
      if (process.pid) process.stdin.end(getFileArchive(document));
      token.onCancellationRequested(() => killProcTree(process));
    });
  }
}

class TsReference implements qv.ReferenceProvider {
  public constructor(private readonly client: ServiceClient) {}
  public async provideReferences(d: qv.TextDocument, p: qv.Position, c: qv.ReferenceContext, t: qv.CancellationToken): Promise<qv.Location[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('references', xs, t);
    if (v.type !== 'response' || !v.body) return [];
    const ys: qv.Location[] = [];
    for (const r of v.body.refs) {
      if (!c.includeDeclaration && r.isDefinition) continue;
      const u = this.client.toResource(r.file);
      ys.push(qu.Location.fromTextSpan(u, r));
    }
    return ys;
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return qv.languages.registerReferenceProvider(s.syntax, new TsReference(c));
  });
}

export type ReferenceCallback = (locations: DocumentRange[]) => void;
export class ReferencesResult {
  private readonly _locations: DocumentRange[] = [];
  constructor(
    readonly requiresGlobalSearch: boolean,
    readonly nodeAtOffset: ParseNode,
    readonly symbolName: string,
    readonly declarations: Declaration[],
    private readonly _reporter?: ReferenceCallback
  ) {}
  get locations(): readonly DocumentRange[] {
    return this._locations;
  }
  addLocations(...locs: DocumentRange[]) {
    if (locs.length === 0) return;
    if (this._reporter) this._reporter(locs);
    this._locations.push(...locs);
  }
}
export class FindReferencesTreeWalker extends ParseTreeWalker {
  private readonly _locationsFound: DocumentRange[] = [];
  constructor(
    private _parseResults: ParseResults,
    private _filePath: string,
    private _referencesResult: ReferencesResult,
    private _includeDeclaration: boolean,
    private _evaluator: TypeEvaluator,
    private _cancellationToken: qv.CancellationToken
  ) {
    super();
  }
  findReferences(rootNode = this._parseResults.parseTree) {
    this.walk(rootNode);
    return this._locationsFound;
  }
  walk(node: ParseNode) {
    if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
      super.walk(node);
    }
  }
  visitModuleName(node: ModuleNameNode): boolean {
    return false;
  }
  visitName(node: NameNode): boolean {
    throwIfCancellationRequested(this._cancellationToken);
    if (node.value !== this._referencesResult.symbolName) return false;
    const declarations = this._evaluator.getDeclarationsForNameNode(node);
    if (declarations && declarations.length > 0) {
      if (declarations.some((decl) => this._resultsContainsDeclaration(decl))) {
        if (this._includeDeclaration || node !== this._referencesResult.nodeAtOffset) {
          this._locationsFound.push({
            path: this._filePath,
            range: {
              start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
              end: convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines),
            },
          });
        }
      }
    }
    return true;
  }
  private _resultsContainsDeclaration(declaration: Declaration) {
    const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ false);
    if (!resolvedDecl) return false;
    if (this._referencesResult.declarations.some((decl) => DeclarationUtils.areDeclarationsSame(decl, resolvedDecl))) {
      return true;
    }
    const resolvedDeclNonlocal = this._evaluator.resolveAliasDeclaration(resolvedDecl, /* resolveLocalNames */ true);
    if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) return false;
    return this._referencesResult.declarations.some((decl) => DeclarationUtils.areDeclarationsSame(decl, resolvedDeclNonlocal));
  }
}
export class PyReference {
  static getDeclarationForPosition(
    sourceMapper: SourceMapper,
    parseResults: ParseResults,
    filePath: string,
    position: Position,
    evaluator: TypeEvaluator,
    reporter: ReferenceCallback | undefined,
    token: qv.CancellationToken
  ): ReferencesResult | undefined {
    throwIfCancellationRequested(token);
    const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
    if (offset === undefined) return undefined;
    const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
    if (node === undefined) return undefined;
    if (node.nodeType !== ParseNodeType.Name) return undefined;
    if (node.parent?.nodeType === ParseNodeType.ModuleName) return undefined;
    const declarations = evaluator.getDeclarationsForNameNode(node);
    if (!declarations) return undefined;
    const resolvedDeclarations: Declaration[] = [];
    declarations.forEach((decl) => {
      const resolvedDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ false);
      if (resolvedDecl) {
        resolvedDeclarations.push(resolvedDecl);
        if (isStubFile(resolvedDecl.path)) {
          const implDecls = sourceMapper.findDeclarations(resolvedDecl);
          for (const implDecl of implDecls) {
            if (implDecl && implDecl.path) this._addIfUnique(resolvedDeclarations, implDecl);
          }
        }
      }
    });
    if (resolvedDeclarations.length === 0) return undefined;
    const requiresGlobalSearch = resolvedDeclarations.some((decl) => {
      if (decl.path !== filePath) return true;
      const evalScope = ParseTreeUtils.getEvaluationScopeNode(decl.node);
      if (evalScope.nodeType === ParseNodeType.Module || evalScope.nodeType === ParseNodeType.Class) return true;
      if (decl.node?.parent?.nodeType === ParseNodeType.MemberAccess && decl.node === decl.node.parent.memberName) return true;
      return false;
    });
    return new ReferencesResult(requiresGlobalSearch, node, node.value, resolvedDeclarations, reporter);
  }
  private static _addIfUnique(declarations: Declaration[], itemToAdd: Declaration) {
    for (const def of declarations) {
      if (DeclarationUtils.areDeclarationsSame(def, itemToAdd)) return;
    }
    declarations.push(itemToAdd);
  }
  static addReferences(parseResults: ParseResults, filePath: string, referencesResult: ReferencesResult, includeDeclaration: boolean, evaluator: TypeEvaluator, token: qv.CancellationToken): void {
    const refTreeWalker = new FindReferencesTreeWalker(parseResults, filePath, referencesResult, includeDeclaration, evaluator, token);
    referencesResult.addLocations(...refTreeWalker.findReferences());
  }
}
