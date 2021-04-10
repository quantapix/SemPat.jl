import { Declaration, DeclarationType } from './declaration';
import { areDeclarationsSame, hasTypeForDeclaration } from './declarationUtils';
import { Type } from './types';
export const enum SymbolFlags {
  None = 0,
  InitiallyUnbound = 1 << 0,
  ExternallyHidden = 1 << 1,
  ClassMember = 1 << 2,
  InstanceMember = 1 << 3,
  PrivateMember = 1 << 5,
  IgnoredForProtocolMatch = 1 << 6,
  ClassVar = 1 << 7,
  InDunderAll = 1 << 8,
}
let nextSymbolId = 1;
function getUniqueSymbolId() {
  return nextSymbolId++;
}
export const indeterminateSymbolId = 0;
export class Symbol {
  private _declarations?: Declaration[];
  private _flags: SymbolFlags;
  readonly id: number;
  private _synthesizedType?: Type;
  constructor(flags = SymbolFlags.ClassMember) {
    this.id = getUniqueSymbolId();
    this._flags = flags;
  }
  static createWithType(flags: SymbolFlags, type: Type) {
    const newSymbol = new Symbol(flags);
    newSymbol._synthesizedType = type;
    return newSymbol;
  }
  isInitiallyUnbound() {
    return !!(this._flags & SymbolFlags.InitiallyUnbound);
  }
  setIsExternallyHidden() {
    this._flags |= SymbolFlags.ExternallyHidden;
  }
  isExternallyHidden() {
    return !!(this._flags & SymbolFlags.ExternallyHidden);
  }
  setIsIgnoredForProtocolMatch() {
    this._flags |= SymbolFlags.IgnoredForProtocolMatch;
  }
  isIgnoredForProtocolMatch() {
    return !!(this._flags & SymbolFlags.IgnoredForProtocolMatch);
  }
  setIsClassMember() {
    this._flags |= SymbolFlags.ClassMember;
  }
  isClassMember() {
    return !!(this._flags & SymbolFlags.ClassMember);
  }
  setIsInstanceMember() {
    this._flags |= SymbolFlags.InstanceMember;
  }
  isInstanceMember() {
    return !!(this._flags & SymbolFlags.InstanceMember);
  }
  setIsClassVar() {
    this._flags |= SymbolFlags.ClassVar;
  }
  isClassVar() {
    return !!(this._flags & SymbolFlags.ClassVar);
  }
  setIsInDunderAll() {
    this._flags |= SymbolFlags.InDunderAll;
  }
  isInDunderAll() {
    return !!(this._flags & SymbolFlags.InDunderAll);
  }
  setIsPrivateMember() {
    this._flags |= SymbolFlags.PrivateMember;
  }
  isPrivateMember() {
    return !!(this._flags & SymbolFlags.PrivateMember);
  }
  addDeclaration(declaration: Declaration) {
    if (this._declarations) {
      const declIndex = this._declarations.findIndex((decl) => areDeclarationsSame(decl, declaration));
      if (declIndex < 0) {
        this._declarations.push(declaration);
        this._declarations.forEach((decl) => {
          if (decl.type === DeclarationType.Variable && decl.typeAliasName) {
            delete decl.typeAliasName;
          }
        });
      } else {
        const curDecl = this._declarations[declIndex];
        if (hasTypeForDeclaration(declaration)) {
          this._declarations[declIndex] = declaration;
          if (curDecl.type === DeclarationType.Variable && declaration.type === DeclarationType.Variable) {
            if (!declaration.inferredTypeSource && curDecl.inferredTypeSource) {
              declaration.inferredTypeSource = curDecl.inferredTypeSource;
            }
          }
        } else if (declaration.type === DeclarationType.Variable) {
          if (curDecl.type === DeclarationType.Variable) {
            if (declaration.isFinal) {
              curDecl.isFinal = true;
            }
            if (declaration.typeAliasAnnotation) {
              curDecl.typeAliasAnnotation = declaration.typeAliasAnnotation;
            }
            if (!curDecl.inferredTypeSource && declaration.inferredTypeSource) {
              curDecl.inferredTypeSource = declaration.inferredTypeSource;
            }
          }
        }
      }
    } else {
      this._declarations = [declaration];
    }
  }
  hasDeclarations() {
    return this._declarations ? this._declarations.length > 0 : false;
  }
  getDeclarations() {
    return this._declarations ? this._declarations : [];
  }
  hasTypedDeclarations() {
    if (this._synthesizedType) {
      return true;
    }
    return this.getDeclarations().some((decl) => hasTypeForDeclaration(decl));
  }
  getTypedDeclarations() {
    return this.getDeclarations().filter((decl) => hasTypeForDeclaration(decl));
  }
  getSynthesizedType() {
    return this._synthesizedType;
  }
}
export type SymbolTable = Map<string, Symbol>;
