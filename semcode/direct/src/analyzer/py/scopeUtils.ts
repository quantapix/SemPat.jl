import { ParseNode } from '../parser/parseNodes';
import { getScope } from './analyzerNodeInfo';
import { getEvaluationScopeNode } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
export function getBuiltInScope(currentScope: Scope): Scope {
  let builtInScope = currentScope;
  while (builtInScope.type !== ScopeType.Builtin) {
    builtInScope = builtInScope.parent!;
  }
  return builtInScope;
}
export function getScopeForNode(node: ParseNode): Scope | undefined {
  const scopeNode = getEvaluationScopeNode(node);
  return getScope(scopeNode);
}
