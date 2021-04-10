import { Declaration, DeclarationType } from './declaration';
import { isFinalVariableDeclaration } from './declarationUtils';
import { Symbol } from './symbol';
export function getLastTypedDeclaredForSymbol(symbol: Symbol): Declaration | undefined {
  const typedDecls = symbol.getTypedDeclarations();
  if (typedDecls.length > 0) {
    return typedDecls[typedDecls.length - 1];
  }
  return undefined;
}
export function isTypedDictMemberAccessedThroughIndex(symbol: Symbol): boolean {
  const typedDecls = symbol.getTypedDeclarations();
  if (typedDecls.length > 0) {
    const lastDecl = typedDecls[typedDecls.length - 1];
    if (lastDecl.type === DeclarationType.Variable) {
      return true;
    }
  }
  return false;
}
export function isFinalVariable(symbol: Symbol): boolean {
  return symbol.getDeclarations().some((decl) => isFinalVariableDeclaration(decl));
}
export function isRequiredTypedDictVariable(symbol: Symbol) {
  return symbol.getDeclarations().some((decl) => decl.type === DeclarationType.Variable && !!decl.isRequired);
}
export function isNotRequiredTypedDictVariable(symbol: Symbol) {
  return symbol.getDeclarations().some((decl) => decl.type === DeclarationType.Variable && !!decl.isNotRequired);
}
