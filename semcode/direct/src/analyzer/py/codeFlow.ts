import { assert } from '../common/debug';
import { ArgumentCategory, CallNode, ExpressionNode, ImportFromNode, IndexNode, MemberAccessNode, NameNode, NumberNode, ParseNodeType, SuiteNode } from '../parser/parseNodes';

export enum FlowFlags {
  Unreachable = 1 << 0, // Unreachable code
  Start = 1 << 1, // Entry point
  BranchLabel = 1 << 2, // Junction for forward control flow
  LoopLabel = 1 << 3, // Junction for backward control flow
  Assignment = 1 << 4, // Assignment statement
  Unbind = 1 << 5, // Used with assignment to indicate target should be unbound
  WildcardImport = 1 << 6, // For "from X import *" statements
  TrueCondition = 1 << 7, // Condition known to be true
  FalseCondition = 1 << 9, // Condition known to be false
  Call = 1 << 10, // Call node
  PreFinallyGate = 1 << 11, // Injected edge that links pre-finally label and pre-try flow
  PostFinally = 1 << 12, // Injected edge that links post-finally flow with the rest of the graph
  AssignmentAlias = 1 << 13, // Assigned symbol is aliased to another symbol with the same name
  VariableAnnotation = 1 << 14, // Separates a variable annotation from its name node
  PostContextManager = 1 << 15, // Label that's used for context managers that suppress exceptions
  TrueNeverCondition = 1 << 16, // Condition whose type evaluates to never when narrowed in positive test
  FalseNeverCondition = 1 << 17, // Condition whose type evaluates to never when narrowed in negative test
}

let _nextFlowNodeId = 1;

export type CodeFlowReferenceExpressionNode = NameNode | MemberAccessNode | IndexNode;

export function getUniqueFlowNodeId() {
  return _nextFlowNodeId++;
}

export interface FlowNode {
  flags: FlowFlags;
  id: number;
}

export interface FlowLabel extends FlowNode {
  antecedents: FlowNode[];
}

export interface FlowAssignment extends FlowNode {
  node: CodeFlowReferenceExpressionNode;
  antecedent: FlowNode;
  targetSymbolId: number;
}

export interface FlowAssignmentAlias extends FlowNode {
  antecedent: FlowNode;
  targetSymbolId: number;
  aliasSymbolId: number;
}

export interface FlowVariableAnnotation extends FlowNode {
  antecedent: FlowNode;
}

export interface FlowWildcardImport extends FlowNode {
  node: ImportFromNode;
  names: string[];
  antecedent: FlowNode;
}

export interface FlowCondition extends FlowNode {
  expression: ExpressionNode;
  reference?: NameNode;
  antecedent: FlowNode;
}

export interface FlowCall extends FlowNode {
  node: CallNode;
  antecedent: FlowNode;
}

export interface FlowPreFinallyGate extends FlowNode {
  antecedent: FlowNode;
  isGateClosed: boolean;
}

export interface FlowPostFinally extends FlowNode {
  antecedent: FlowNode;
  finallyNode: SuiteNode;
  preFinallyGate: FlowPreFinallyGate;
}

export interface FlowPostContextManagerLabel extends FlowLabel {
  expressions: ExpressionNode[];
  isAsync: boolean;
}

export function isCodeFlowSupportedForReference(reference: ExpressionNode): boolean {
  if (reference.nodeType === ParseNodeType.Name) {
    return true;
  }

  if (reference.nodeType === ParseNodeType.MemberAccess) {
    return isCodeFlowSupportedForReference(reference.leftExpression);
  }

  if (reference.nodeType === ParseNodeType.Index) {
    if (reference.items.length !== 1 || reference.trailingComma || reference.items[0].name !== undefined || reference.items[0].argumentCategory !== ArgumentCategory.Simple) {
      return false;
    }

    const subscriptNode = reference.items[0].valueExpression;
    if (subscriptNode.nodeType !== ParseNodeType.Number || subscriptNode.isImaginary || !subscriptNode.isInteger) {
      return false;
    }

    return isCodeFlowSupportedForReference(reference.baseExpression);
  }

  return false;
}

export function createKeyForReference(reference: CodeFlowReferenceExpressionNode): string {
  let key;
  if (reference.nodeType === ParseNodeType.Name) {
    key = reference.value;
  } else if (reference.nodeType === ParseNodeType.MemberAccess) {
    const leftKey = createKeyForReference(reference.leftExpression as CodeFlowReferenceExpressionNode);
    key = `${leftKey}.${reference.memberName.value}`;
  } else {
    const leftKey = createKeyForReference(reference.baseExpression as CodeFlowReferenceExpressionNode);
    assert(reference.items.length === 1 && reference.items[0].valueExpression.nodeType === ParseNodeType.Number);
    key = `${leftKey}[${(reference.items[0].valueExpression as NumberNode).value.toString()}]`;
  }

  return key;
}
