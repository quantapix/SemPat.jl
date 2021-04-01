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

    let declarations = symbol.getTypedDeclarations();
    if (declarations.length === 0) {
      declarations = symbol.getDeclarations();

      if (declarations.length === 0) {
        return undefined;
      }
    }

    curDeclaration = declarations[declarations.length - 1];

    if (alreadyVisited.find((decl) => decl === curDeclaration)) {
      return declaration;
    }
    alreadyVisited.push(curDeclaration);
  }
}
