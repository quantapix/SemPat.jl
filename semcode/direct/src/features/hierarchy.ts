import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap, requireMinVer } from '../registration';
import * as path from 'path';
import * as PConst from '../protocol.const';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import type * as qp from '../protocol';
import { CancellationToken, SymbolKind } from 'vscode-languageserver';
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Range } from 'vscode-languageserver-types';
import { Declaration, DeclarationType } from '../analyzer/declaration';
import * as DeclarationUtils from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { ClassType, isClass, isFunction, isObject } from '../analyzer/types';
import { ClassMemberLookupFlags, doForEachSubtype, isProperty, lookUpClassMember, lookUpObjectMember } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { getFileName } from '../common/pathUtils';
import { convertOffsetsToRange } from '../common/positionUtils';
import { rangesAreEqual } from '../common/textRange';
import { CallNode, MemberAccessNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

class TsCallHierarchy implements qv.CallHierarchyProvider {
  public static readonly minVersion = API.v380;
  public constructor(private readonly client: ServiceClient) {}
  public async prepareCallHierarchy(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.CallHierarchyItem | qv.CallHierarchyItem[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('prepareCallHierarchy', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return Array.isArray(v.body) ? v.body.map(fromProtocolCallHierarchyItem) : fromProtocolCallHierarchyItem(v.body);
  }
  public async provideCallHierarchyIncomingCalls(i: qv.CallHierarchyItem, t: qv.CancellationToken): Promise<qv.CallHierarchyIncomingCall[] | undefined> {
    const f = this.client.toPath(i.uri);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, i.selectionRange.start);
    const v = await this.client.execute('provideCallHierarchyIncomingCalls', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map(fromProtocolCallHierarchyIncomingCall);
  }
  public async provideCallHierarchyOutgoingCalls(i: qv.CallHierarchyItem, t: qv.CancellationToken): Promise<qv.CallHierarchyOutgoingCall[] | undefined> {
    const f = this.client.toPath(i.uri);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, i.selectionRange.start);
    const v = await this.client.execute('provideCallHierarchyOutgoingCalls', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map(fromProtocolCallHierarchyOutgoingCall);
  }
}
function isSourceFileItem(i: qp.CallHierarchyItem) {
  return i.kind === PConst.Kind.script || (i.kind === PConst.Kind.module && i.selectionSpan.start.line === 1 && i.selectionSpan.start.offset === 1);
}
function fromProtocolCallHierarchyItem(item: qp.CallHierarchyItem): qv.CallHierarchyItem {
  const useFileName = isSourceFileItem(item);
  const name = useFileName ? path.basename(item.file) : item.name;
  const detail = useFileName ? qv.workspace.asRelativePath(path.dirname(item.file)) : item.containerName ?? '';
  const result = new qv.CallHierarchyItem(
    qu.SymbolKind.fromProtocolScriptElementKind(item.kind),
    name,
    detail,
    qv.Uri.file(item.file),
    qu.Range.fromTextSpan(item.span),
    qu.Range.fromTextSpan(item.selectionSpan)
  );
  const kindModifiers = item.kindModifiers ? qu.parseKindModifier(item.kindModifiers) : undefined;
  if (kindModifiers?.has(PConst.KindModifiers.depreacted)) result.tags = [qv.SymbolTag.Deprecated];
  return result;
}
function fromProtocolCallHierarchyIncomingCall(c: qp.CallHierarchyIncomingCall): qv.CallHierarchyIncomingCall {
  return new qv.CallHierarchyIncomingCall(fromProtocolCallHierarchyItem(c.from), c.fromSpans.map(qu.Range.fromTextSpan));
}
function fromProtocolCallHierarchyOutgoingCall(c: qp.CallHierarchyOutgoingCall): qv.CallHierarchyOutgoingCall {
  return new qv.CallHierarchyOutgoingCall(fromProtocolCallHierarchyItem(c.to), c.fromSpans.map(qu.Range.fromTextSpan));
}
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireMinVer(c, TsCallHierarchy.minVersion), requireSomeCap(c, ClientCap.Semantic)], () => {
    return qv.languages.registerCallHierarchyProvider(s.semantic, new TsCallHierarchy(c));
  });
}

export class PyCallHierarchy {
  static getCallForDeclaration(symbolName: string, declaration: Declaration, evaluator: TypeEvaluator, token: CancellationToken): CallHierarchyItem | undefined {
    throwIfCancellationRequested(token);
    if (declaration.type === DeclarationType.Function || declaration.type === DeclarationType.Class) {
      const callItem: CallHierarchyItem = {
        name: symbolName,
        kind: getSymbolKind(declaration, evaluator),
        uri: declaration.path,
        range: declaration.range,
        selectionRange: declaration.range,
      };
      return callItem;
    }
    return undefined;
  }
  static getIncomingCallsForDeclaration(
    filePath: string,
    symbolName: string,
    declaration: Declaration,
    parseResults: ParseResults,
    evaluator: TypeEvaluator,
    token: CancellationToken
  ): CallHierarchyIncomingCall[] | undefined {
    throwIfCancellationRequested(token);
    const callFinder = new FindIncomingCallTreeWalker(filePath, symbolName, declaration, parseResults, evaluator, token);
    const incomingCalls = callFinder.findCalls();
    return incomingCalls.length > 0 ? incomingCalls : undefined;
  }
  static getOutgoingCallsForDeclaration(declaration: Declaration, parseResults: ParseResults, evaluator: TypeEvaluator, token: CancellationToken): CallHierarchyOutgoingCall[] | undefined {
    throwIfCancellationRequested(token);
    let parseRoot: ParseNode | undefined;
    if (declaration.type === DeclarationType.Function) parseRoot = declaration.node;
    else if (declaration.type === DeclarationType.Class) {
      const classType = evaluator.getTypeForDeclaration(declaration);
      if (classType && isClass(classType)) {
        const initMethodMember = lookUpClassMember(
          classType,
          '__init__',
          ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass | ClassMemberLookupFlags.SkipBaseClasses
        );
        if (initMethodMember) {
          const initMethodType = evaluator.getTypeOfMember(initMethodMember);
          if (initMethodType && isFunction(initMethodType)) {
            const initDecls = initMethodMember.symbol.getDeclarations();
            if (initDecls && initDecls.length > 0) {
              const primaryInitDecl = initDecls[0];
              if (primaryInitDecl.type === DeclarationType.Function) parseRoot = primaryInitDecl.node;
            }
          }
        }
      }
    }
    if (!parseRoot) return undefined;
    const callFinder = new FindOutgoingCallTreeWalker(parseRoot, parseResults, evaluator, token);
    const outgoingCalls = callFinder.findCalls();
    return outgoingCalls.length > 0 ? outgoingCalls : undefined;
  }
  static getTargetDeclaration(declarations: Declaration[], node: ParseNode): Declaration {
    let targetDecl = declarations[0];
    for (const decl of declarations) {
      if (DeclarationUtils.hasTypeForDeclaration(decl) || !DeclarationUtils.hasTypeForDeclaration(targetDecl)) {
        if (decl.type === DeclarationType.Function || decl.type === DeclarationType.Class) {
          targetDecl = decl;
          if (decl.node === node) break;
        }
      }
    }
    return targetDecl;
  }
}
class FindOutgoingCallTreeWalker extends ParseTreeWalker {
  private _outgoingCalls: CallHierarchyOutgoingCall[] = [];
  constructor(private _parseRoot: ParseNode, private _parseResults: ParseResults, private _evaluator: TypeEvaluator, private _cancellationToken: CancellationToken) {
    super();
  }
  findCalls(): CallHierarchyOutgoingCall[] {
    this.walk(this._parseRoot);
    return this._outgoingCalls;
  }
  visitCall(node: CallNode): boolean {
    throwIfCancellationRequested(this._cancellationToken);
    let nameNode: NameNode | undefined;
    if (node.leftExpression.nodeType === ParseNodeType.Name) nameNode = node.leftExpression;
    else if (node.leftExpression.nodeType === ParseNodeType.MemberAccess) nameNode = node.leftExpression.memberName;
    if (nameNode) {
      const declarations = this._evaluator.getDeclarationsForNameNode(nameNode);
      if (declarations) {
        declarations.forEach((decl) => {
          this._addOutgoingCallForDeclaration(nameNode!, decl);
        });
      }
    }
    return true;
  }
  visitMemberAccess(node: MemberAccessNode): boolean {
    throwIfCancellationRequested(this._cancellationToken);
    const leftHandType = this._evaluator.getType(node.leftExpression);
    if (leftHandType) {
      doForEachSubtype(leftHandType, (subtype) => {
        let baseType = subtype;
        baseType = this._evaluator.makeTopLevelTypeVarsConcrete(baseType);
        if (!isObject(baseType)) return;
        const memberInfo = lookUpObjectMember(baseType, node.memberName.value);
        if (!memberInfo) return;
        const memberType = this._evaluator.getTypeOfMember(memberInfo);
        const propertyDecls = memberInfo.symbol.getDeclarations();
        if (!memberType) return;
        if (isObject(memberType) && ClassType.isPropertyClass(memberType.classType)) {
          propertyDecls.forEach((decl) => {
            this._addOutgoingCallForDeclaration(node.memberName, decl);
          });
        }
      });
    }
    return true;
  }
  private _addOutgoingCallForDeclaration(nameNode: NameNode, declaration: Declaration) {
    const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
    if (!resolvedDecl) return;
    if (resolvedDecl.type !== DeclarationType.Function && resolvedDecl.type !== DeclarationType.Class) return;
    const callDest: CallHierarchyItem = {
      name: nameNode.value,
      kind: getSymbolKind(resolvedDecl, this._evaluator),
      uri: resolvedDecl.path,
      range: resolvedDecl.range,
      selectionRange: resolvedDecl.range,
    };
    let outgoingCall: CallHierarchyOutgoingCall | undefined = this._outgoingCalls.find((outgoing) => outgoing.to.uri === callDest.uri && rangesAreEqual(outgoing.to.range, callDest.range));
    if (!outgoingCall) {
      outgoingCall = {
        to: callDest,
        fromRanges: [],
      };
      this._outgoingCalls.push(outgoingCall);
    }
    const fromRange: Range = convertOffsetsToRange(nameNode.start, nameNode.start + nameNode.length, this._parseResults.tokenizerOutput.lines);
    outgoingCall.fromRanges.push(fromRange);
  }
}
class FindIncomingCallTreeWalker extends ParseTreeWalker {
  private _incomingCalls: CallHierarchyIncomingCall[] = [];
  constructor(
    private _filePath: string,
    private _symbolName: string,
    private _declaration: Declaration,
    private _parseResults: ParseResults,
    private _evaluator: TypeEvaluator,
    private _cancellationToken: CancellationToken
  ) {
    super();
  }
  findCalls(): CallHierarchyIncomingCall[] {
    this.walk(this._parseResults.parseTree);
    return this._incomingCalls;
  }
  visitCall(node: CallNode): boolean {
    throwIfCancellationRequested(this._cancellationToken);
    let nameNode: NameNode | undefined;
    if (node.leftExpression.nodeType === ParseNodeType.Name) nameNode = node.leftExpression;
    else if (node.leftExpression.nodeType === ParseNodeType.MemberAccess) nameNode = node.leftExpression.memberName;
    if (nameNode && nameNode.value === this._symbolName) {
      const declarations = this._evaluator.getDeclarationsForNameNode(nameNode);
      if (declarations) {
        const resolvedDecls = declarations
          .map((decl) => {
            return this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
          })
          .filter((decl) => decl !== undefined);
        if (resolvedDecls.some((decl) => DeclarationUtils.areDeclarationsSame(decl!, this._declaration))) {
          this._addIncomingCallForDeclaration(nameNode!);
        }
      }
    }
    return true;
  }
  visitMemberAccess(node: MemberAccessNode): boolean {
    throwIfCancellationRequested(this._cancellationToken);
    if (node.memberName.value === this._symbolName) {
      const leftHandType = this._evaluator.getType(node.leftExpression);
      if (leftHandType) {
        doForEachSubtype(leftHandType, (subtype) => {
          let baseType = subtype;
          baseType = this._evaluator.makeTopLevelTypeVarsConcrete(baseType);
          if (!isObject(baseType)) return;
          const memberInfo = lookUpObjectMember(baseType, node.memberName.value);
          if (!memberInfo) return;
          const memberType = this._evaluator.getTypeOfMember(memberInfo);
          const propertyDecls = memberInfo.symbol.getDeclarations();
          if (!memberType) return;
          if (propertyDecls.some((decl) => DeclarationUtils.areDeclarationsSame(decl!, this._declaration))) {
            this._addIncomingCallForDeclaration(node.memberName);
          }
        });
      }
    }
    return true;
  }
  private _addIncomingCallForDeclaration(nameNode: NameNode) {
    const executionNode = ParseTreeUtils.getExecutionScopeNode(nameNode);
    if (!executionNode) return;
    let callSource: CallHierarchyItem;
    if (executionNode.nodeType === ParseNodeType.Module) {
      const moduleRange = convertOffsetsToRange(0, 0, this._parseResults.tokenizerOutput.lines);
      const fileName = getFileName(this._filePath);
      callSource = {
        name: `(module) ${fileName}`,
        kind: SymbolKind.Module,
        uri: this._filePath,
        range: moduleRange,
        selectionRange: moduleRange,
      };
    } else if (executionNode.nodeType === ParseNodeType.Lambda) {
      const lambdaRange = convertOffsetsToRange(executionNode.start, executionNode.start + executionNode.length, this._parseResults.tokenizerOutput.lines);
      callSource = {
        name: '(lambda)',
        kind: SymbolKind.Function,
        uri: this._filePath,
        range: lambdaRange,
        selectionRange: lambdaRange,
      };
    } else {
      const functionRange = convertOffsetsToRange(executionNode.name.start, executionNode.name.start + executionNode.name.length, this._parseResults.tokenizerOutput.lines);
      callSource = {
        name: executionNode.name.value,
        kind: SymbolKind.Function,
        uri: this._filePath,
        range: functionRange,
        selectionRange: functionRange,
      };
    }
    let incomingCall: CallHierarchyIncomingCall | undefined = this._incomingCalls.find((incoming) => incoming.from.uri === callSource.uri && rangesAreEqual(incoming.from.range, callSource.range));
    if (!incomingCall) {
      incomingCall = {
        from: callSource,
        fromRanges: [],
      };
      this._incomingCalls.push(incomingCall);
    }
    const fromRange: Range = convertOffsetsToRange(nameNode.start, nameNode.start + nameNode.length, this._parseResults.tokenizerOutput.lines);
    incomingCall.fromRanges.push(fromRange);
  }
}
function getSymbolKind(declaration: Declaration, evaluator: TypeEvaluator): SymbolKind {
  let symbolKind: SymbolKind;
  switch (declaration.type) {
    case DeclarationType.Class:
    case DeclarationType.SpecialBuiltInClass:
      symbolKind = SymbolKind.Class;
      break;
    case DeclarationType.Function:
      if (declaration.isMethod) {
        const declType = evaluator.getTypeForDeclaration(declaration);
        if (declType && isProperty(declType)) {
          symbolKind = SymbolKind.Property;
        } else {
          symbolKind = SymbolKind.Method;
        }
      } else {
        symbolKind = SymbolKind.Function;
      }
      break;
    default:
      symbolKind = SymbolKind.Function;
      break;
  }
  return symbolKind;
}
