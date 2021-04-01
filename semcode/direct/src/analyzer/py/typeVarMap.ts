import { assert } from '../common/debug';
import { ClassType, maxTypeRecursionCount, ParamSpecValue, Type, TypeCategory, TypeVarScopeId, TypeVarType, WildcardTypeVarScopeId } from './types';
import { doForEachSubtype } from './typeUtils';

export interface TypeVarMapEntry {
  typeVar: TypeVarType;

  narrowBound?: Type;
  wideBound?: Type;

  retainLiteral?: boolean;
}

export interface ParamSpecMapEntry {
  paramSpec: TypeVarType;
  type: ParamSpecValue;
}

export interface VariadicTypeVarMapEntry {
  typeVar: TypeVarType;
  types: Type[];
}

export class TypeVarMap {
  private _solveForScopes: TypeVarScopeId[] | undefined;
  private _typeVarMap: Map<string, TypeVarMapEntry>;
  private _variadicTypeVarMap: Map<string, VariadicTypeVarMapEntry> | undefined;
  private _paramSpecMap: Map<string, ParamSpecMapEntry>;
  private _isLocked = false;

  constructor(solveForScopes?: TypeVarScopeId[] | TypeVarScopeId) {
    if (Array.isArray(solveForScopes)) {
      this._solveForScopes = solveForScopes;
    } else if (solveForScopes !== undefined) {
      this._solveForScopes = [solveForScopes];
    } else {
      this._solveForScopes = undefined;
    }

    this._typeVarMap = new Map<string, TypeVarMapEntry>();
    this._paramSpecMap = new Map<string, ParamSpecMapEntry>();
  }

  clone() {
    const newTypeVarMap = new TypeVarMap();
    if (this._solveForScopes) {
      newTypeVarMap._solveForScopes = [...this._solveForScopes];
    }

    this._typeVarMap.forEach((value) => {
      newTypeVarMap.setTypeVarType(value.typeVar, value.narrowBound, value.wideBound, value.retainLiteral);
    });

    this._paramSpecMap.forEach((value) => {
      newTypeVarMap.setParamSpec(value.paramSpec, value.type);
    });

    if (this._variadicTypeVarMap) {
      this._variadicTypeVarMap.forEach((value) => {
        newTypeVarMap.setVariadicTypeVar(value.typeVar, value.types);
      });
    }

    newTypeVarMap._isLocked = this._isLocked;

    return newTypeVarMap;
  }

  copyFromClone(clone: TypeVarMap) {
    this._typeVarMap = clone._typeVarMap;
    this._paramSpecMap = clone._paramSpecMap;
    this._variadicTypeVarMap = clone._variadicTypeVarMap;
    this._isLocked = clone._isLocked;
  }

  getSolveForScopes() {
    return this._solveForScopes;
  }

  hasSolveForScope(scopeId: TypeVarScopeId | undefined) {
    return scopeId !== undefined && this._solveForScopes !== undefined && this._solveForScopes.some((s) => s === scopeId || s === WildcardTypeVarScopeId);
  }

  setSolveForScopes(scopeIds: TypeVarScopeId[]) {
    this._solveForScopes = scopeIds;
  }

  addSolveForScope(scopeId?: TypeVarScopeId) {
    if (scopeId !== undefined && !this.hasSolveForScope(scopeId)) {
      if (!this._solveForScopes) {
        this._solveForScopes = [];
      }
      this._solveForScopes.push(scopeId);
    }
  }

  isEmpty() {
    return this._typeVarMap.size === 0 && this._paramSpecMap.size === 0;
  }

  getScore() {
    let score = 0;

    this._typeVarMap.forEach((value) => {
      score += 1;

      const typeVarType = this.getTypeVarType(value.typeVar)!;
      score += this._getComplexityScoreForType(typeVarType);
    });

    score += this._paramSpecMap.size;

    return score;
  }

  hasTypeVar(reference: TypeVarType): boolean {
    return this._typeVarMap.has(this._getKey(reference));
  }

  getTypeVarType(reference: TypeVarType): Type | undefined {
    const entry = this._typeVarMap.get(this._getKey(reference));
    if (!entry) {
      return undefined;
    }
    return entry.narrowBound || entry.wideBound;
  }

  setTypeVarType(reference: TypeVarType, narrowBound: Type | undefined, wideBound?: Type, retainLiteral?: boolean) {
    assert(!this._isLocked);
    const key = this._getKey(reference);
    this._typeVarMap.set(key, { typeVar: reference, narrowBound, wideBound, retainLiteral });
  }

  getVariadicTypeVar(reference: TypeVarType): Type[] | undefined {
    return this._variadicTypeVarMap?.get(this._getKey(reference))?.types;
  }

  setVariadicTypeVar(reference: TypeVarType, types: Type[]) {
    assert(!this._isLocked);
    const key = this._getKey(reference);

    if (!this._variadicTypeVarMap) {
      this._variadicTypeVarMap = new Map<string, VariadicTypeVarMapEntry>();
    }
    this._variadicTypeVarMap.set(key, { typeVar: reference, types });
  }

  getTypeVar(reference: TypeVarType): TypeVarMapEntry | undefined {
    const key = this._getKey(reference);
    return this._typeVarMap.get(key);
  }

  getTypeVars(): TypeVarMapEntry[] {
    const entries: TypeVarMapEntry[] = [];

    this._typeVarMap.forEach((entry) => {
      entries.push(entry);
    });

    return entries;
  }

  hasParamSpec(reference: TypeVarType): boolean {
    return this._paramSpecMap.has(this._getKey(reference));
  }

  getParamSpec(reference: TypeVarType): ParamSpecValue | undefined {
    return this._paramSpecMap.get(this._getKey(reference))?.type;
  }

  setParamSpec(reference: TypeVarType, type: ParamSpecValue) {
    assert(!this._isLocked);
    this._paramSpecMap.set(this._getKey(reference), { paramSpec: reference, type });
  }

  typeVarCount() {
    return this._typeVarMap.size;
  }

  getWideTypeBound(reference: TypeVarType): Type | undefined {
    const entry = this._typeVarMap.get(this._getKey(reference));
    if (entry) {
      return entry.wideBound;
    }

    return undefined;
  }

  getRetainLiterals(reference: TypeVarType): boolean {
    const entry = this._typeVarMap.get(this._getKey(reference));
    return !!entry?.retainLiteral;
  }

  lock() {
    assert(!this._isLocked);
    this._isLocked = true;
  }

  isLocked(): boolean {
    return this._isLocked;
  }

  private _getKey(reference: TypeVarType) {
    return TypeVarType.getNameWithScope(reference);
  }

  private _getComplexityScoreForType(type: Type, recursionCount = 0): number {
    if (recursionCount > maxTypeRecursionCount) {
      return 0;
    }

    switch (type.category) {
      case TypeCategory.Function:
      case TypeCategory.OverloadedFunction: {
        return 0.5;
      }

      case TypeCategory.Union: {
        let minScore = 1;
        doForEachSubtype(type, (subtype) => {
          const subtypeScore = this._getComplexityScoreForType(subtype, recursionCount + 1);
          if (subtypeScore < minScore) {
            minScore = subtypeScore;
          }
        });

        return minScore / 2;
      }

      case TypeCategory.Class: {
        return this._getComplexityScoreForClass(type, recursionCount + 1);
      }

      case TypeCategory.Object: {
        return this._getComplexityScoreForClass(type.classType, recursionCount + 1);
      }
    }

    return 0;
  }

  private _getComplexityScoreForClass(classType: ClassType, recursionCount: number): number {
    let typeArgScoreSum = 0;
    let typeArgCount = 0;

    if (classType.typeArguments) {
      classType.typeArguments.forEach((type) => {
        typeArgScoreSum += this._getComplexityScoreForType(type, recursionCount + 1);
        typeArgCount++;
      });
    }

    let score = 0.5;
    if (typeArgCount > 0) {
      score += (typeArgScoreSum / typeArgCount) * 0.5;
    }

    return score;
  }
}
