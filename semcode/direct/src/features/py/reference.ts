import { CancellationToken } from 'vscode-languageserver';

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
    if (locs.length === 0) {
      return;
    }

    if (this._reporter) {
      this._reporter(locs);
    }

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
    private _cancellationToken: CancellationToken
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

    if (node.value !== this._referencesResult.symbolName) {
      return false;
    }

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
    if (!resolvedDecl) {
      return false;
    }
    if (this._referencesResult.declarations.some((decl) => DeclarationUtils.areDeclarationsSame(decl, resolvedDecl))) {
      return true;
    }
    const resolvedDeclNonlocal = this._evaluator.resolveAliasDeclaration(resolvedDecl, /* resolveLocalNames */ true);
    if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) {
      return false;
    }

    return this._referencesResult.declarations.some((decl) => DeclarationUtils.areDeclarationsSame(decl, resolvedDeclNonlocal));
  }
}

export class ReferencesProvider {
  static getDeclarationForPosition(
    sourceMapper: SourceMapper,
    parseResults: ParseResults,
    filePath: string,
    position: Position,
    evaluator: TypeEvaluator,
    reporter: ReferenceCallback | undefined,
    token: CancellationToken
  ): ReferencesResult | undefined {
    throwIfCancellationRequested(token);

    const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
    if (offset === undefined) {
      return undefined;
    }

    const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
    if (node === undefined) {
      return undefined;
    }

    if (node.nodeType !== ParseNodeType.Name) {
      return undefined;
    }

    if (node.parent?.nodeType === ParseNodeType.ModuleName) {
      return undefined;
    }

    const declarations = evaluator.getDeclarationsForNameNode(node);
    if (!declarations) {
      return undefined;
    }

    const resolvedDeclarations: Declaration[] = [];
    declarations.forEach((decl) => {
      const resolvedDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ false);
      if (resolvedDecl) {
        resolvedDeclarations.push(resolvedDecl);

        if (isStubFile(resolvedDecl.path)) {
          const implDecls = sourceMapper.findDeclarations(resolvedDecl);
          for (const implDecl of implDecls) {
            if (implDecl && implDecl.path) {
              this._addIfUnique(resolvedDeclarations, implDecl);
            }
          }
        }
      }
    });

    if (resolvedDeclarations.length === 0) {
      return undefined;
    }
    const requiresGlobalSearch = resolvedDeclarations.some((decl) => {
      if (decl.path !== filePath) {
        return true;
      }

      const evalScope = ParseTreeUtils.getEvaluationScopeNode(decl.node);
      if (evalScope.nodeType === ParseNodeType.Module || evalScope.nodeType === ParseNodeType.Class) {
        return true;
      }
      if (decl.node?.parent?.nodeType === ParseNodeType.MemberAccess && decl.node === decl.node.parent.memberName) {
        return true;
      }

      return false;
    });

    return new ReferencesResult(requiresGlobalSearch, node, node.value, resolvedDeclarations, reporter);
  }

  private static _addIfUnique(declarations: Declaration[], itemToAdd: Declaration) {
    for (const def of declarations) {
      if (DeclarationUtils.areDeclarationsSame(def, itemToAdd)) {
        return;
      }
    }

    declarations.push(itemToAdd);
  }

  static addReferences(parseResults: ParseResults, filePath: string, referencesResult: ReferencesResult, includeDeclaration: boolean, evaluator: TypeEvaluator, token: CancellationToken): void {
    const refTreeWalker = new FindReferencesTreeWalker(parseResults, filePath, referencesResult, includeDeclaration, evaluator, token);

    referencesResult.addLocations(...refTreeWalker.findReferences());
  }
}
