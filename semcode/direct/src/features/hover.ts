import { ClientCap, ServiceClient, ServerType } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import { markdownDocumentation } from '../../old/ts/utils/previewer';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';
import { getGoConfig } from '../../../../old/go/config';
import { definitionLocation } from './definition';
import { CancellationToken, Hover, MarkupKind } from 'vscode-languageserver';
import { Declaration, DeclarationType, FunctionDeclaration } from '../analyzer/declaration';
import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { getClassDocString, getFunctionDocStringInherited, getModuleDocString, getOverloadedFunctionDocStringsInherited, getPropertyDocStringInherited } from '../analyzer/typeDocStringUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { getTypeAliasInfo, isClass, isFunction, isModule, isObject, isOverloadedFunction, Type, TypeBase, UnknownType } from '../analyzer/types';
import { ClassMemberLookupFlags, isProperty, lookUpClassMember } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { fail } from '../common/debug';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { Position, Range } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { getOverloadedFunctionTooltip } from './tooltipUtils';

class TsHover implements qv.HoverProvider {
  public constructor(private readonly client: ServiceClient) {}
  public async provideHover(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Hover | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const y = await this.client.interruptGetErr(() => this.client.execute('quickinfo', xs, t));
    if (y.type !== 'response' || !y.body) return undefined;
    return new qv.Hover(this.getContents(d.uri, y.body, y._serverType), qu.Range.fromTextSpan(y.body));
  }
  private getContents(r: qv.Uri, d: qp.QuickInfoResponseBody, s?: ServerType) {
    const ys: qv.MarkdownString[] = [];
    if (d.displayString) {
      const ss: string[] = [];
      if (s === ServerType.Syntax && this.client.hasCapabilityForResource(r, ClientCap.Semantic)) ss.push('(loading...)');
      ss.push(d.displayString);
      ys.push(new qv.MarkdownString().appendCodeblock(ss.join(' '), 'typescript'));
    }
    ys.push(markdownDocumentation(d.documentation, d.tags));
    return ys;
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient): qv.Disposable {
  return condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return qv.languages.registerHoverProvider(s.syntax, new TsHover(c));
  });
}
export class GoHover implements qv.HoverProvider {
  private goConfig: qv.WorkspaceConfig | undefined;
  constructor(goConfig?: qv.WorkspaceConfig) {
    this.goConfig = goConfig;
  }
  public provideHover(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken): Thenable<qv.Hover> {
    if (!this.goConfig) {
      this.goConfig = getGoConfig(document.uri);
    }
    let goConfig = this.goConfig;
    if (goConfig['docsTool'] === 'guru') {
      goConfig = Object.assign({}, goConfig, { docsTool: 'godoc' });
    }
    return definitionLocation(document, position, goConfig, true, token).then(
      (definitionInfo) => {
        if (definitionInfo == null) {
          return null;
        }
        const lines = definitionInfo.declarationlines.filter((line) => line !== '').map((line) => line.replace(/\t/g, '    '));
        let text;
        text = lines.join('\n').replace(/\n+$/, '');
        const hoverTexts = new qv.MarkdownString();
        hoverTexts.appendCodeblock(text, 'go');
        if (definitionInfo.doc != null) {
          hoverTexts.appendMarkdown(definitionInfo.doc);
        }
        const hover = new qv.Hover(hoverTexts);
        return hover;
      },
      () => {
        return null;
      }
    );
  }
}

export interface PyHoverTextPart {
  python?: boolean;
  text: string;
}
export interface PyHoverResults {
  parts: PyHoverTextPart[];
  range: Range;
}
export class PyHover {
  static getHoverForPosition(
    sourceMapper: SourceMapper,
    parseResults: ParseResults,
    position: Position,
    format: MarkupKind,
    evaluator: TypeEvaluator,
    token: CancellationToken
  ): PyHoverResults | undefined {
    throwIfCancellationRequested(token);
    const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
    if (offset === undefined) {
      return undefined;
    }
    const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
    if (node === undefined) {
      return undefined;
    }
    const results: PyHoverResults = {
      parts: [],
      range: {
        start: convertOffsetToPosition(node.start, parseResults.tokenizerOutput.lines),
        end: convertOffsetToPosition(TextRange.getEnd(node), parseResults.tokenizerOutput.lines),
      },
    };
    if (node.nodeType === ParseNodeType.Name) {
      const declarations = evaluator.getDeclarationsForNameNode(node);
      if (declarations && declarations.length > 0) {
        let primaryDeclaration = declarations[0];
        if (primaryDeclaration.type === DeclarationType.Alias && declarations.length > 1) {
          primaryDeclaration = declarations[1];
        }
        this._addResultsForDeclaration(format, sourceMapper, results.parts, primaryDeclaration, node, evaluator);
      } else if (!node.parent || node.parent.nodeType !== ParseNodeType.ModuleName) {
        if (results.parts.length === 0) {
          const type = evaluator.getType(node) || UnknownType.create();
          let typeText = '';
          if (isModule(type)) {
            typeText = '(module) ' + node.value;
          } else {
            typeText = node.value + ': ' + evaluator.printType(type, /* expandTypeAlias */ false);
          }
          this._addResultsPart(results.parts, typeText, true);
          this._addDocumentationPart(format, sourceMapper, results.parts, node, evaluator, undefined);
        }
      }
    }
    return results.parts.length > 0 ? results : undefined;
  }
  private static _addResultsForDeclaration(format: MarkupKind, sourceMapper: SourceMapper, parts: PyHoverTextPart[], declaration: Declaration, node: NameNode, evaluator: TypeEvaluator): void {
    const resolvedDecl = evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
    if (!resolvedDecl) {
      this._addResultsPart(parts, `(import) ` + node.value + this._getTypeText(node, evaluator), true);
      return;
    }
    switch (resolvedDecl.type) {
      case DeclarationType.Intrinsic: {
        this._addResultsPart(parts, node.value + this._getTypeText(node, evaluator), true);
        this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
        break;
      }
      case DeclarationType.Variable: {
        let label = resolvedDecl.isConstant || resolvedDecl.isFinal ? 'constant' : 'variable';
        let typeNode = node;
        if (declaration.node.nodeType === ParseNodeType.ImportAs || declaration.node.nodeType === ParseNodeType.ImportFromAs) {
          if (declaration.node.alias && node !== declaration.node.alias) {
            if (resolvedDecl.node.nodeType === ParseNodeType.Name) {
              typeNode = resolvedDecl.node;
            }
          }
        } else if (node.parent?.nodeType === ParseNodeType.Argument && node.parent.name === node) {
          if (declaration.node.nodeType === ParseNodeType.Name) {
            typeNode = declaration.node;
          }
        }
        const type = evaluator.getType(typeNode);
        let expandTypeAlias = false;
        if (type && TypeBase.isInstantiable(type)) {
          const typeAliasInfo = getTypeAliasInfo(type);
          if (typeAliasInfo) {
            if (typeAliasInfo.name === typeNode.value) {
              expandTypeAlias = true;
            }
            label = 'type alias';
          }
        }
        this._addResultsPart(parts, `(${label}) ` + node.value + this._getTypeText(typeNode, evaluator, expandTypeAlias), true);
        this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
        break;
      }
      case DeclarationType.Parameter: {
        this._addResultsPart(parts, '(parameter) ' + node.value + this._getTypeText(node, evaluator), true);
        this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
        break;
      }
      case DeclarationType.Class:
      case DeclarationType.SpecialBuiltInClass: {
        if (this._addInitMethodInsteadIfCallNode(format, node, evaluator, parts, sourceMapper, resolvedDecl)) {
          return;
        }
        this._addResultsPart(parts, '(class) ' + node.value, true);
        this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
        break;
      }
      case DeclarationType.Function: {
        let label = 'function';
        if (resolvedDecl.isMethod) {
          const declaredType = evaluator.getTypeForDeclaration(resolvedDecl);
          label = declaredType && isProperty(declaredType) ? 'property' : 'method';
        }
        const type = evaluator.getType(node);
        if (type && isOverloadedFunction(type)) {
          this._addResultsPart(parts, `(${label})\n${getOverloadedFunctionTooltip(type, evaluator)}`, true);
        } else {
          this._addResultsPart(parts, `(${label}) ` + node.value + this._getTypeText(node, evaluator), true);
        }
        this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
        break;
      }
      case DeclarationType.Alias: {
        this._addResultsPart(parts, '(module) ' + node.value, true);
        this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
        break;
      }
    }
  }
  private static _addInitMethodInsteadIfCallNode(format: MarkupKind, node: NameNode, evaluator: TypeEvaluator, parts: PyHoverTextPart[], sourceMapper: SourceMapper, declaration: Declaration) {
    let callLeftNode: ParseNode | undefined = node;
    if (callLeftNode.parent && callLeftNode.parent.nodeType === ParseNodeType.MemberAccess && node === callLeftNode.parent.memberName) {
      callLeftNode = node.parent;
    }
    if (!callLeftNode || !callLeftNode.parent || callLeftNode.parent.nodeType !== ParseNodeType.Call || callLeftNode.parent.leftExpression !== callLeftNode) {
      return false;
    }
    const classType = evaluator.getType(node);
    if (!classType || !isClass(classType)) {
      return false;
    }
    const initMethodMember = lookUpClassMember(classType, '__init__', ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);
    if (!initMethodMember) {
      return false;
    }
    const instanceType = evaluator.getType(callLeftNode.parent);
    const functionType = evaluator.getTypeOfMember(initMethodMember);
    if (!instanceType || !functionType || !isObject(instanceType) || !isFunction(functionType)) {
      return false;
    }
    const initMethodType = evaluator.bindFunctionToClassOrObject(instanceType, functionType);
    if (!initMethodType || !isFunction(initMethodType)) {
      return false;
    }
    const functionParts = evaluator.printFunctionParts(initMethodType);
    const classText = `${node.value}(${functionParts[0].join(', ')})`;
    this._addResultsPart(parts, '(class) ' + classText, true);
    const addedDoc = this._addDocumentationPartForType(format, sourceMapper, parts, initMethodType, declaration, evaluator);
    if (!addedDoc) {
      this._addDocumentationPartForType(format, sourceMapper, parts, classType, declaration, evaluator);
    }
    return true;
  }
  private static _getTypeText(node: NameNode, evaluator: TypeEvaluator, expandTypeAlias = false): string {
    const type = evaluator.getType(node) || UnknownType.create();
    return ': ' + evaluator.printType(type, expandTypeAlias);
  }
  private static _addDocumentationPart(format: MarkupKind, sourceMapper: SourceMapper, parts: PyHoverTextPart[], node: NameNode, evaluator: TypeEvaluator, resolvedDecl: Declaration | undefined) {
    const type = evaluator.getType(node);
    if (type) {
      this._addDocumentationPartForType(format, sourceMapper, parts, type, resolvedDecl, evaluator);
    }
  }
  private static _addDocumentationPartForType(
    format: MarkupKind,
    sourceMapper: SourceMapper,
    parts: PyHoverTextPart[],
    type: Type,
    resolvedDecl: Declaration | undefined,
    evaluator: TypeEvaluator
  ): boolean {
    const docStrings: (string | undefined)[] = [];
    if (isModule(type)) {
      docStrings.push(getModuleDocString(type, resolvedDecl, sourceMapper));
    } else if (isClass(type)) {
      docStrings.push(getClassDocString(type, resolvedDecl, sourceMapper));
    } else if (isFunction(type)) {
      if (resolvedDecl?.type === DeclarationType.Function) {
        const enclosingClass = resolvedDecl ? ParseTreeUtils.getEnclosingClass(resolvedDecl.node) : undefined;
        const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;
        docStrings.push(getFunctionDocStringInherited(type, resolvedDecl, sourceMapper, classResults?.classType));
      } else if (resolvedDecl?.type === DeclarationType.Class) {
        const enclosingClass = resolvedDecl.node.nodeType === ParseNodeType.Class ? resolvedDecl.node : undefined;
        const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;
        const fieldSymbol = classResults?.classType.details.fields.get(type.details.name);
        if (fieldSymbol) {
          const decl = fieldSymbol.getDeclarations()[0];
          docStrings.push(getFunctionDocStringInherited(type, decl, sourceMapper, classResults?.classType));
        }
      }
    } else if (isOverloadedFunction(type)) {
      const enclosingClass = resolvedDecl ? ParseTreeUtils.getEnclosingClass(resolvedDecl.node) : undefined;
      const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;
      docStrings.push(...getOverloadedFunctionDocStringsInherited(type, resolvedDecl, sourceMapper, evaluator, classResults?.classType));
    } else if (resolvedDecl?.type === DeclarationType.Function) {
      const enclosingClass = resolvedDecl?.type === DeclarationType.Function ? ParseTreeUtils.getEnclosingClass((resolvedDecl as FunctionDeclaration).node.name, false) : undefined;
      const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;
      if (classResults) {
        docStrings.push(getPropertyDocStringInherited(resolvedDecl, sourceMapper, evaluator, classResults.classType));
      }
    }
    let addedDoc = false;
    for (const docString of docStrings) {
      if (docString) {
        addedDoc = true;
        this._addDocumentationResultsPart(format, parts, docString);
      }
    }
    return addedDoc;
  }
  private static _addDocumentationResultsPart(format: MarkupKind, parts: PyHoverTextPart[], docString?: string) {
    if (docString) {
      if (format === MarkupKind.Markdown) {
        const markDown = convertDocStringToMarkdown(docString);
        if (parts.length > 0 && markDown.length > 0) {
          parts.push({ text: '---\n' });
        }
        this._addResultsPart(parts, markDown);
      } else if (format === MarkupKind.PlainText) {
        this._addResultsPart(parts, convertDocStringToPlainText(docString));
      } else {
        fail(`Unsupported markup type: ${format}`);
      }
    }
  }
  private static _addResultsPart(parts: PyHoverTextPart[], text: string, python = false) {
    parts.push({
      python,
      text,
    });
  }
}
export function convertHoverResults(format: MarkupKind, hoverResults: PyHoverResults | undefined): Hover | undefined {
  if (!hoverResults) {
    return undefined;
  }
  const markupString = hoverResults.parts
    .map((part) => {
      if (part.python) {
        if (format === MarkupKind.Markdown) {
          return '```python\n' + part.text + '\n```\n';
        } else if (format === MarkupKind.PlainText) {
          return part.text + '\n\n';
        } else {
          fail(`Unsupported markup type: ${format}`);
        }
      }
      return part.text;
    })
    .join('');
  return {
    contents: {
      kind: format,
      value: markupString,
    },
    range: hoverResults.range,
  };
}
