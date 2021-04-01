import { ImportLookup, ImportLookupResult } from './analyzerFileInfo';
import { Declaration, DeclarationType } from './declaration';
import { Symbol } from './symbol';

export function resolveAliasDeclaration(importLookup: ImportLookup, declaration: Declaration, resolveLocalNames: boolean): Declaration | undefined {
  let curDeclaration: Declaration | undefined = declaration;
  const alreadyVisited: Declaration[] = [];

  while (true) {
    if (curDeclaration.type !== DeclarationType.Alias) {
      return curDeclaration;
    }

    if (!curDeclaration.symbolName) {
      return curDeclaration;
    }

    // If we are not supposed to follow local alias names and this
    // is a local name, don't continue to follow the alias.
    if (!resolveLocalNames && curDeclaration.usesLocalName) {
      return curDeclaration;
    }

    let lookupResult: ImportLookupResult | undefined;
    if (curDeclaration.path) {
      lookupResult = importLookup(curDeclaration.path);
    }

    const symbol: Symbol | undefined = lookupResult ? lookupResult.symbolTable.get(curDeclaration.symbolName) : undefined;
    if (!symbol) {
      if (curDeclaration.submoduleFallback) {
        return resolveAliasDeclaration(importLookup, curDeclaration.submoduleFallback, resolveLocalNames);
      }
      return undefined;
    }

    // Prefer declarations with specified types. If we don't have any of those,
    // fall back on declarations with inferred types.
    let declarations = symbol.getTypedDeclarations();
    if (declarations.length === 0) {
      declarations = symbol.getDeclarations();

      if (declarations.length === 0) {
        return undefined;
      }
    }

    // Prefer the last declaration in the list. This ensures that
    // we use all of the overloads if it's an overloaded function.
    curDeclaration = declarations[declarations.length - 1];

    // Make sure we don't follow a circular list indefinitely.
    if (alreadyVisited.find((decl) => decl === curDeclaration)) {
      return declaration;
    }
    alreadyVisited.push(curDeclaration);
  }
}
