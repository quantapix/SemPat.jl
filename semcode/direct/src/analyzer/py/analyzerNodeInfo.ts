import { ClassNode, ExecutionScopeNode, FunctionNode, LambdaNode, ListComprehensionNode, ModuleNode, ParseNode } from '../parser/parseNodes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { FlowFlags, FlowNode } from './codeFlow';
import { Declaration } from './declaration';
import { ImportResult } from './importResult';
import { Scope } from './scope';

interface AnalyzerNodeInfo {
  importInfo?: ImportResult;

  scope?: Scope;

  declaration?: Declaration;

  flowNode?: FlowNode;

  afterFlowNode?: FlowNode;

  fileInfo?: AnalyzerFileInfo;

  codeFlowExpressions?: Map<string, string>;

  dunderAllNames?: string[];
}

export type ScopedNode = ModuleNode | ClassNode | FunctionNode | LambdaNode | ListComprehensionNode;

export function cleanNodeAnalysisInfo(node: ParseNode) {
  const analyzerNode = node as AnalyzerNodeInfo;
  delete analyzerNode.scope;
  delete analyzerNode.declaration;
  delete analyzerNode.flowNode;
  delete analyzerNode.afterFlowNode;
  delete analyzerNode.fileInfo;
}

export function getImportInfo(node: ParseNode): ImportResult | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.importInfo;
}

export function setImportInfo(node: ParseNode, importInfo: ImportResult) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.importInfo = importInfo;
}

export function getScope(node: ParseNode): Scope | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.scope;
}

export function setScope(node: ParseNode, scope: Scope) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.scope = scope;
}

export function getDeclaration(node: ParseNode): Declaration | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.declaration;
}

export function setDeclaration(node: ParseNode, decl: Declaration) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.declaration = decl;
}

export function getFlowNode(node: ParseNode): FlowNode | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.flowNode;
}

export function setFlowNode(node: ParseNode, flowNode: FlowNode) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.flowNode = flowNode;
}

export function getAfterFlowNode(node: ParseNode): FlowNode | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.afterFlowNode;
}

export function setAfterFlowNode(node: ParseNode, flowNode: FlowNode) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.afterFlowNode = flowNode;
}

export function getFileInfo(node: ModuleNode): AnalyzerFileInfo | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.fileInfo;
}

export function setFileInfo(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.fileInfo = fileInfo;
}

export function getCodeFlowExpressions(node: ExecutionScopeNode): Map<string, string> | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.codeFlowExpressions;
}

export function setCodeFlowExpressions(node: ExecutionScopeNode, map: Map<string, string>) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.codeFlowExpressions = map;
}

export function getDunderAllNames(node: ModuleNode): string[] | undefined {
  const analyzerNode = node as AnalyzerNodeInfo;
  return analyzerNode.dunderAllNames;
}

export function setDunderAllNames(node: ModuleNode, names: string[] | undefined) {
  const analyzerNode = node as AnalyzerNodeInfo;
  analyzerNode.dunderAllNames = names;
}

export function isCodeUnreachable(node: ParseNode): boolean {
  let curNode: ParseNode | undefined = node;

  while (curNode) {
    const flowNode = getFlowNode(curNode);
    if (flowNode) {
      return !!(flowNode.flags & FlowFlags.Unreachable);
    }
    curNode = curNode.parent;
  }

  return false;
}
