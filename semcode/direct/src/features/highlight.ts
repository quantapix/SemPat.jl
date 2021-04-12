import { ServiceClient } from '../service';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';
import { DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver';
import { isCodeUnreachable } from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import { areDeclarationsSame } from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { Position, TextRange } from '../common/textRange';
import { ModuleNameNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
class TsHighlight implements qv.DocumentHighlightProvider {
  public constructor(private readonly client: ServiceClient) {}
  public async provideDocumentHighlights(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.DocumentHighlight[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    const xs = {
      ...qu.Position.toFileLocationRequestArgs(f, p),
      filesToSearch: [f],
    };
    const y = await this.client.execute('documentHighlights', xs, t);
    if (y.type !== 'response' || !y.body) return [];
    return qu.flatten(y.body.filter((highlight) => highlight.file === f).map(convertDocumentHighlight));
  }
}
function convertDocumentHighlight(i: qp.DocumentHighlightsItem): ReadonlyArray<qv.DocumentHighlight> {
  return i.highlightSpans.map((s) => new qv.DocumentHighlight(qu.Range.fromTextSpan(s), s.kind === 'writtenReference' ? qv.DocumentHighlightKind.Write : qv.DocumentHighlightKind.Read));
}
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return qv.languages.registerDocumentHighlightProvider(s.syntax, new TsHighlight(c));
}
class HighlightSymbolTreeWalker extends ParseTreeWalker {
  constructor(
    private _symbolName: string,
    private _declarations: Declaration[],
    private _parseResults: ParseResults,
    private _highlightResults: DocumentHighlight[],
    private _evaluator: TypeEvaluator,
    private _cancellationToken: qv.CancellationToken
  ) {
    super();
  }
  findHighlights() {
    this.walk(this._parseResults.parseTree);
  }
  walk(node: ParseNode) {
    if (!isCodeUnreachable(node)) {
      super.walk(node);
    }
  }
  visitModuleName(node: ModuleNameNode): boolean {
    return false;
  }
  visitName(node: NameNode): boolean {
    throwIfCancellationRequested(this._cancellationToken);
    if (node.value !== this._symbolName) {
      return false;
    }
    if (this._declarations.length > 0) {
      const declarations = this._evaluator.getDeclarationsForNameNode(node);
      if (declarations && declarations.length > 0) {
        if (declarations.some((decl) => this._resultsContainsDeclaration(decl))) {
          this._addResult(node);
        }
      }
    } else {
      this._addResult(node);
    }
    return true;
  }
  private _addResult(node: NameNode) {
    this._highlightResults.push({
      kind: this._isWriteAccess(node) ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
      range: {
        start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
        end: convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines),
      },
    });
  }
  private _isWriteAccess(node: NameNode) {
    let prevNode: ParseNode = node;
    let curNode: ParseNode | undefined = prevNode.parent;
    while (curNode) {
      switch (curNode.nodeType) {
        case ParseNodeType.Assignment: {
          return prevNode === curNode.leftExpression;
        }
        case ParseNodeType.AugmentedAssignment: {
          return prevNode === curNode.leftExpression;
        }
        case ParseNodeType.AssignmentExpression: {
          return prevNode === curNode.name;
        }
        case ParseNodeType.Del: {
          return true;
        }
        case ParseNodeType.For: {
          return prevNode === curNode.targetExpression;
        }
        case ParseNodeType.ImportAs: {
          return prevNode === curNode.alias || (curNode.module.nameParts.length > 0 && prevNode === curNode.module.nameParts[0]);
        }
        case ParseNodeType.ImportFromAs: {
          return prevNode === curNode.alias || (!curNode.alias && prevNode === curNode.name);
        }
        case ParseNodeType.MemberAccess: {
          if (prevNode !== curNode.memberName) {
            return false;
          }
          break;
        }
        case ParseNodeType.Except: {
          return prevNode === curNode.name;
        }
        case ParseNodeType.With: {
          return curNode.withItems.some((item) => item === prevNode);
        }
        case ParseNodeType.ListComprehensionFor: {
          return prevNode === curNode.targetExpression;
        }
        case ParseNodeType.TypeAnnotation: {
          if (prevNode === curNode.typeAnnotation) {
            return false;
          }
          break;
        }
        case ParseNodeType.Function:
        case ParseNodeType.Class:
        case ParseNodeType.Module: {
          return false;
        }
      }
      prevNode = curNode;
      curNode = curNode.parent;
    }
    return false;
  }
  private _resultsContainsDeclaration(declaration: Declaration) {
    const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ false);
    if (!resolvedDecl) {
      return false;
    }
    if (this._declarations.some((decl) => areDeclarationsSame(decl, resolvedDecl))) {
      return true;
    }
    const resolvedDeclNonlocal = this._evaluator.resolveAliasDeclaration(resolvedDecl, /* resolveLocalNames */ true);
    if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) {
      return false;
    }
    return this._declarations.some((decl) => areDeclarationsSame(decl, resolvedDeclNonlocal));
  }
}
export class PyHighlight {
  static getDocumentHighlight(parseResults: ParseResults, position: Position, evaluator: TypeEvaluator, token: qv.CancellationToken): DocumentHighlight[] | undefined {
    throwIfCancellationRequested(token);
    const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
    if (offset === undefined) {
      return undefined;
    }
    const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
    if (node === undefined) {
      return undefined;
    }
    const results: DocumentHighlight[] = [];
    if (node.nodeType === ParseNodeType.Name) {
      const declarations = evaluator.getDeclarationsForNameNode(node) || [];
      const resolvedDeclarations: Declaration[] = [];
      declarations.forEach((decl) => {
        const resolvedDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
        if (resolvedDecl) {
          resolvedDeclarations.push(resolvedDecl);
        }
      });
      const walker = new HighlightSymbolTreeWalker(node.value, resolvedDeclarations, parseResults, results, evaluator, token);
      walker.findHighlights();
    }
    return results.length > 0 ? results : undefined;
  }
}
