import { assert } from 'console';
import { ParameterCategory } from '../parser/parseNodes';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { isTypedDictMemberAccessedThroughIndex } from './symbolUtils';
import {
  AnyType,
  ClassType,
  combineConstrainedTypes,
  combineTypes,
  ConstrainedSubtype,
  findSubtype,
  FunctionType,
  FunctionTypeFlags,
  isAny,
  isAnyOrUnknown,
  isClass,
  isFunction,
  isNever,
  isNone,
  isObject,
  isOverloadedFunction,
  isParamSpec,
  isTypeSame,
  isTypeVar,
  isUnbound,
  isUnion,
  isUnknown,
  isVariadicTypeVar,
  maxTypeRecursionCount,
  ModuleType,
  NeverType,
  NoneType,
  ObjectType,
  OverloadedFunctionType,
  ParamSpecEntry,
  ParamSpecValue,
  removeFromUnion,
  SpecializedFunctionTypes,
  SubtypeConstraints,
  Type,
  TypeBase,
  TypeCategory,
  TypeVarScopeId,
  TypeVarType,
  UnknownType,
} from './types';
import { TypeVarMap } from './typeVarMap';
export interface ClassMember {
  symbol: Symbol;
  classType: ClassType | UnknownType;
  isInstanceMember: boolean;
  isTypeDeclared: boolean;
}
export const enum ClassMemberLookupFlags {
  Default = 0,
  SkipOriginalClass = 1 << 0,
  SkipBaseClasses = 1 << 1,
  SkipObjectBaseClass = 1 << 2,
  SkipInstanceVariables = 1 << 3,
  DeclaredTypesOnly = 1 << 4,
}
export const enum ClassIteratorFlags {
  Default = 0,
  SkipOriginalClass = 1 << 0,
  SkipBaseClasses = 1 << 1,
  SkipObjectBaseClass = 1 << 2,
}
export const enum CanAssignFlags {
  Default = 0,
  EnforceInvariance = 1 << 0,
  ReverseTypeVarMatching = 1 << 1,
  AllowTypeVarNarrowing = 1 << 2,
  SkipSolveTypeVars = 1 << 3,
  DisallowAssignFromAny = 1 << 4,
  SkipFunctionReturnTypeCheck = 1 << 5,
  AllowBoolTypeGuard = 1 << 6,
  RetainLiteralsForTypeVar = 1 << 7,
}
interface TypeVarTransformer {
  transformTypeVar: (typeVar: TypeVarType) => Type;
  transformVariadicTypeVar: (paramSpec: TypeVarType) => Type[] | undefined;
  transformParamSpec: (paramSpec: TypeVarType) => ParamSpecEntry[] | undefined;
}
let synthesizedTypeVarIndexForExpectedType = 1;
export function isOptionalType(type: Type): boolean {
  if (isUnion(type)) {
    return findSubtype(type, (subtype) => isNone(subtype)) !== undefined;
  }
  return false;
}
export function mapSubtypes(type: Type, callback: (type: Type) => Type | undefined): Type {
  if (isUnion(type)) {
    const newSubtypes: ConstrainedSubtype[] = [];
    let typeChanged = false;
    type.subtypes.forEach((subtype, index) => {
      const subtypeConstraints = type.constraints ? type.constraints[index] : undefined;
      const transformedType = callback(subtype);
      if (transformedType) {
        newSubtypes.push({ type: transformedType, constraints: subtypeConstraints });
        if (transformedType !== subtype) {
          typeChanged = true;
        }
      } else {
        typeChanged = true;
      }
    });
    return typeChanged ? combineConstrainedTypes(newSubtypes) : type;
  }
  const transformedSubtype = callback(type);
  if (!transformedSubtype) {
    return NeverType.create();
  }
  return transformedSubtype;
}
export function doForEachSubtype(type: Type, callback: (type: Type, index: number, constraints: SubtypeConstraints) => void): void {
  if (isUnion(type)) {
    if (type.constraints) {
      type.subtypes.forEach((subtype, index) => {
        callback(subtype, index, type.constraints![index]);
      });
    } else {
      type.subtypes.forEach((subtype, index) => {
        callback(subtype, index, undefined);
      });
    }
  } else {
    callback(type, 0, undefined);
  }
}
export function areTypesSame(types: Type[]): boolean {
  if (types.length < 2) {
    return true;
  }
  for (let i = 1; i < types.length; i++) {
    if (!isTypeSame(types[0], types[i])) {
      return false;
    }
  }
  return true;
}
export function derivesFromAnyOrUnknown(type: Type): boolean {
  let anyOrUnknown = false;
  doForEachSubtype(type, (subtype) => {
    if (isAnyOrUnknown(type)) {
      anyOrUnknown = true;
    } else if (isClass(subtype)) {
      if (ClassType.hasUnknownBaseClass(subtype)) {
        anyOrUnknown = true;
      }
    } else if (isObject(subtype)) {
      if (ClassType.hasUnknownBaseClass(subtype.classType)) {
        anyOrUnknown = true;
      }
    }
  });
  return anyOrUnknown;
}
export function getFullNameOfType(type: Type): string | undefined {
  if (type.typeAliasInfo?.fullName) {
    return type.typeAliasInfo.fullName;
  }
  switch (type.category) {
    case TypeCategory.Any:
    case TypeCategory.Unknown:
      return 'typing.Any';
    case TypeCategory.None:
      return 'builtins.None';
    case TypeCategory.Class:
      return type.details.fullName;
    case TypeCategory.Object:
      return type.classType.details.fullName;
    case TypeCategory.Function:
      return type.details.fullName;
    case TypeCategory.Module:
      return type.moduleName;
    case TypeCategory.OverloadedFunction:
      return type.overloads[0].details.fullName;
  }
  return undefined;
}
export function stripLiteralValue(type: Type): Type {
  if (isObject(type)) {
    if (type.classType.literalValue !== undefined) {
      type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, undefined));
    }
    return type;
  }
  if (isClass(type)) {
    if (type.literalValue !== undefined) {
      type = ClassType.cloneWithLiteral(type, undefined);
    }
    return type;
  }
  if (isUnion(type)) {
    return mapSubtypes(type, (subtype) => {
      return stripLiteralValue(subtype);
    });
  }
  return type;
}
export function transformTypeObjectToClass(type: Type): Type {
  if (!isObject(type)) {
    return type;
  }
  const classType = type.classType;
  if (!ClassType.isBuiltIn(classType, 'Type')) {
    return type;
  }
  if (!classType.typeArguments || classType.typeArguments.length < 1 || !classType.isTypeArgumentExplicit) {
    return UnknownType.create();
  }
  return convertToInstantiable(classType.typeArguments[0]);
}
export function isTypeAliasPlaceholder(type: Type): type is TypeVarType {
  if (!isTypeVar(type)) {
    return false;
  }
  return !!type.details.recursiveTypeAliasName && !type.details.boundType;
}
export function isTypeAliasRecursive(typeAliasPlaceholder: TypeVarType, type: Type) {
  if (type.category !== TypeCategory.Union) {
    return isUnbound(type) && type.typeAliasInfo && type.typeAliasInfo.name === typeAliasPlaceholder.details.recursiveTypeAliasName;
  }
  return findSubtype(type, (subtype) => isTypeSame(typeAliasPlaceholder, subtype)) !== undefined;
}
export function transformPossibleRecursiveTypeAlias(type: Type): Type;
export function transformPossibleRecursiveTypeAlias(type: Type | undefined): Type | undefined;
export function transformPossibleRecursiveTypeAlias(type: Type | undefined): Type | undefined {
  if (type) {
    if (isTypeVar(type) && type.details.recursiveTypeAliasName && type.details.boundType) {
      const unspecializedType = TypeBase.isInstance(type) ? convertToInstance(type.details.boundType) : type.details.boundType;
      if (!type.typeAliasInfo?.typeArguments || !type.details.recursiveTypeParameters) {
        return unspecializedType;
      }
      const typeVarMap = buildTypeVarMap(type.details.recursiveTypeParameters, type.typeAliasInfo.typeArguments, getTypeVarScopeId(type));
      return applySolvedTypeVars(unspecializedType, typeVarMap);
    }
  }
  return type;
}
export function canBeFalsy(type: Type, recursionLevel = 0): boolean {
  if (recursionLevel > maxTypeRecursionCount) {
    return true;
  }
  switch (type.category) {
    case TypeCategory.Unbound:
    case TypeCategory.Unknown:
    case TypeCategory.Any:
    case TypeCategory.Never:
    case TypeCategory.None: {
      return true;
    }
    case TypeCategory.Union: {
      return findSubtype(type, (subtype) => canBeFalsy(subtype, recursionLevel + 1)) !== undefined;
    }
    case TypeCategory.Function:
    case TypeCategory.OverloadedFunction:
    case TypeCategory.Class:
    case TypeCategory.Module:
    case TypeCategory.TypeVar: {
      return false;
    }
    case TypeCategory.Object: {
      if (isTupleClass(type.classType) && type.classType.tupleTypeArguments) {
        return isOpenEndedTupleClass(type.classType) || type.classType.tupleTypeArguments.length === 0;
      }
      if (ClassType.isBuiltIn(type.classType, 'bool') && type.classType.literalValue !== undefined) {
        return type.classType.literalValue === false;
      }
      const lenMethod = lookUpObjectMember(type, '__len__');
      if (lenMethod) {
        return true;
      }
      const boolMethod = lookUpObjectMember(type, '__bool__');
      if (boolMethod) {
        return true;
      }
      return false;
    }
  }
}
export function canBeTruthy(type: Type, recursionLevel = 0): boolean {
  if (recursionLevel > maxTypeRecursionCount) {
    return true;
  }
  switch (type.category) {
    case TypeCategory.Unknown:
    case TypeCategory.Function:
    case TypeCategory.OverloadedFunction:
    case TypeCategory.Class:
    case TypeCategory.Module:
    case TypeCategory.TypeVar:
    case TypeCategory.Never:
    case TypeCategory.Any: {
      return true;
    }
    case TypeCategory.Union: {
      return findSubtype(type, (subtype) => canBeTruthy(subtype, recursionLevel + 1)) !== undefined;
    }
    case TypeCategory.Unbound:
    case TypeCategory.None: {
      return false;
    }
    case TypeCategory.Object: {
      if (isTupleClass(type.classType)) {
        if (type.classType.tupleTypeArguments && type.classType.tupleTypeArguments.length === 0) {
          return false;
        }
      }
      if (type.classType.literalValue === false || type.classType.literalValue === 0 || type.classType.literalValue === '') {
        return false;
      }
      return true;
    }
  }
}
export function getTypeVarScopeId(type: Type): TypeVarScopeId | undefined {
  if (isClass(type)) {
    return type.details.typeVarScopeId;
  }
  if (isObject(type)) {
    return type.classType.details.typeVarScopeId;
  }
  if (isFunction(type)) {
    return type.details.typeVarScopeId;
  }
  if (isTypeVar(type)) {
    return type.scopeId;
  }
  return undefined;
}
export function getSpecializedTupleType(type: Type): ClassType | undefined {
  let classType: ClassType | undefined;
  if (isClass(type)) {
    classType = type;
  } else if (isObject(type)) {
    classType = type.classType;
  }
  if (!classType) {
    return undefined;
  }
  const tupleClass = classType.details.mro.find((mroClass) => isClass(mroClass) && isTupleClass(mroClass));
  if (!tupleClass || !isClass(tupleClass)) {
    return undefined;
  }
  if (ClassType.isSameGenericClass(classType, tupleClass)) {
    return classType;
  }
  const typeVarMap = buildTypeVarMapFromSpecializedClass(classType);
  return applySolvedTypeVars(tupleClass, typeVarMap) as ClassType;
}
export function isLiteralType(type: ObjectType): boolean {
  return type.classType.literalValue !== undefined;
}
export function isLiteralTypeOrUnion(type: Type): boolean {
  if (isObject(type)) {
    return type.classType.literalValue !== undefined;
  }
  if (isUnion(type)) {
    return !findSubtype(type, (subtype) => !isObject(subtype) || subtype.classType.literalValue === undefined);
  }
  return false;
}
export function containsLiteralType(type: Type): boolean {
  if (isObject(type) && isLiteralType(type)) {
    return true;
  }
  if (isUnion(type)) {
    return type.subtypes.some((subtype) => isObject(subtype) && isLiteralType(subtype));
  }
  return false;
}
export function isEllipsisType(type: Type): boolean {
  return isAny(type) && type.isEllipsis;
}
export function isNoReturnType(type: Type): boolean {
  return isObject(type) && ClassType.isBuiltIn(type.classType, 'NoReturn');
}
export function removeNoReturnFromUnion(type: Type): Type {
  return removeFromUnion(type, (subtype) => isNoReturnType(subtype));
}
export function isProperty(type: Type): type is ObjectType {
  return isObject(type) && ClassType.isPropertyClass(type.classType);
}
export function isTupleClass(type: ClassType) {
  return ClassType.isBuiltIn(type, 'tuple');
}
export function isOpenEndedTupleClass(type: ClassType) {
  return type.tupleTypeArguments && type.tupleTypeArguments.length === 2 && isEllipsisType(type.tupleTypeArguments[1]);
}
export function partiallySpecializeType(type: Type, contextClassType: ClassType): Type {
  if (ClassType.isGeneric(contextClassType)) {
    return type;
  }
  const typeVarMap = buildTypeVarMapFromSpecializedClass(contextClassType);
  return applySolvedTypeVars(type, typeVarMap);
}
export function applySolvedTypeVars(type: Type, typeVarMap: TypeVarMap, unknownIfNotFound = false): Type {
  if (typeVarMap.isEmpty() && !unknownIfNotFound) {
    return type;
  }
  return _transformTypeVars(type, {
    transformTypeVar: (typeVar: TypeVarType) => {
      if (typeVar.scopeId && typeVarMap.hasSolveForScope(typeVar.scopeId)) {
        const replacement = typeVarMap.getTypeVarType(typeVar);
        if (replacement) {
          return replacement;
        }
        if (unknownIfNotFound) {
          return UnknownType.create();
        }
      }
      return typeVar;
    },
    transformVariadicTypeVar: (typeVar: TypeVarType) => {
      if (!typeVar.scopeId || !typeVarMap.hasSolveForScope(typeVar.scopeId)) {
        return undefined;
      }
      return typeVarMap.getVariadicTypeVar(typeVar);
    },
    transformParamSpec: (paramSpec: TypeVarType) => {
      if (!paramSpec.scopeId || !typeVarMap.hasSolveForScope(paramSpec.scopeId)) {
        return undefined;
      }
      return typeVarMap.getParamSpec(paramSpec);
    },
  });
}
export function transformExpectedTypeForConstructor(expectedType: Type, typeVarMap: TypeVarMap, liveTypeVarScopes: TypeVarScopeId[]): Type | undefined {
  const isTypeVarLive = (typeVar: TypeVarType) => liveTypeVarScopes.some((scopeId) => typeVar.scopeId === scopeId);
  const createDummyTypeVar = (prevTypeVar: TypeVarType) => {
    if (prevTypeVar.details.isSynthesized && prevTypeVar.details.name.startsWith(dummyTypeVarPrefix)) {
      return prevTypeVar;
    }
    const isInstance = TypeBase.isInstance(prevTypeVar);
    let newTypeVar = TypeVarType.createInstance(`__expected_type_${synthesizedTypeVarIndexForExpectedType}`);
    newTypeVar.details.isSynthesized = true;
    newTypeVar.scopeId = dummyScopeId;
    newTypeVar.nameWithScope = TypeVarType.makeNameWithScope(newTypeVar.details.name, dummyScopeId);
    if (!isInstance) {
      newTypeVar = convertToInstantiable(newTypeVar) as TypeVarType;
    }
    newTypeVar.details.boundType = prevTypeVar.details.boundType;
    newTypeVar.details.constraints = prevTypeVar.details.constraints;
    newTypeVar.details.variance = prevTypeVar.details.variance;
    synthesizedTypeVarIndexForExpectedType++;
    return newTypeVar;
  };
  if (isTypeVar(expectedType)) {
    if (isTypeVarLive(expectedType)) {
      return expectedType;
    }
    return undefined;
  }
  const dummyScopeId = '__expected_type_scope_id';
  const dummyTypeVarPrefix = '__expected_type_';
  typeVarMap.addSolveForScope(dummyScopeId);
  return _transformTypeVars(expectedType, {
    transformTypeVar: (typeVar: TypeVarType) => {
      if (isTypeVarLive(typeVar)) {
        return typeVar;
      }
      return createDummyTypeVar(typeVar);
    },
    transformVariadicTypeVar: (typeVar: TypeVarType) => {
      return undefined;
    },
    transformParamSpec: (paramSpec: TypeVarType) => {
      return undefined;
    },
  });
}
export function lookUpObjectMember(objectType: Type, memberName: string, flags = ClassMemberLookupFlags.Default): ClassMember | undefined {
  if (isObject(objectType)) {
    return lookUpClassMember(objectType.classType, memberName, flags);
  }
  return undefined;
}
export function lookUpClassMember(classType: Type, memberName: string, flags = ClassMemberLookupFlags.Default): ClassMember | undefined {
  const memberItr = getClassMemberIterator(classType, memberName, flags);
  return memberItr.next()?.value;
}
export function* getClassMemberIterator(classType: Type, memberName: string, flags = ClassMemberLookupFlags.Default) {
  const declaredTypesOnly = (flags & ClassMemberLookupFlags.DeclaredTypesOnly) !== 0;
  if (isClass(classType)) {
    let classFlags = ClassIteratorFlags.Default;
    if (flags & ClassMemberLookupFlags.SkipOriginalClass) {
      classFlags = classFlags | ClassIteratorFlags.SkipOriginalClass;
    }
    if (flags & ClassMemberLookupFlags.SkipBaseClasses) {
      classFlags = classFlags | ClassIteratorFlags.SkipBaseClasses;
    }
    if (flags & ClassMemberLookupFlags.SkipObjectBaseClass) {
      classFlags = classFlags | ClassIteratorFlags.SkipObjectBaseClass;
    }
    const classItr = getClassIterator(classType, classFlags);
    for (const [mroClass, specializedMroClass] of classItr) {
      if (!isClass(mroClass)) {
        if (!declaredTypesOnly) {
          const cm: ClassMember = {
            symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
            isInstanceMember: false,
            classType: UnknownType.create(),
            isTypeDeclared: false,
          };
          yield cm;
        }
        continue;
      }
      if (!isClass(specializedMroClass)) {
        continue;
      }
      const memberFields = specializedMroClass.details.fields;
      if ((flags & ClassMemberLookupFlags.SkipInstanceVariables) === 0) {
        const symbol = memberFields.get(memberName);
        if (symbol && symbol.isInstanceMember()) {
          const hasDeclaredType = symbol.hasTypedDeclarations();
          if (!declaredTypesOnly || hasDeclaredType) {
            const cm: ClassMember = {
              symbol,
              isInstanceMember: true,
              classType: specializedMroClass,
              isTypeDeclared: hasDeclaredType,
            };
            yield cm;
          }
        }
      }
      const symbol = memberFields.get(memberName);
      if (symbol && symbol.isClassMember()) {
        const hasDeclaredType = symbol.hasTypedDeclarations();
        if (!declaredTypesOnly || hasDeclaredType) {
          let isInstanceMember = false;
          if (ClassType.isDataClass(specializedMroClass) || ClassType.isTypedDictClass(specializedMroClass)) {
            const decls = symbol.getDeclarations();
            if (decls.length > 0 && decls[0].type === DeclarationType.Variable) {
              isInstanceMember = true;
            }
          }
          const cm: ClassMember = {
            symbol,
            isInstanceMember,
            classType: specializedMroClass,
            isTypeDeclared: hasDeclaredType,
          };
          yield cm;
        }
      }
    }
  } else if (isAnyOrUnknown(classType)) {
    const cm: ClassMember = {
      symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
      isInstanceMember: false,
      classType: UnknownType.create(),
      isTypeDeclared: false,
    };
    yield cm;
  }
  return undefined;
}
export function* getClassIterator(classType: Type, flags = ClassIteratorFlags.Default) {
  if (isClass(classType)) {
    let skipMroEntry = (flags & ClassIteratorFlags.SkipOriginalClass) !== 0;
    for (const mroClass of classType.details.mro) {
      if (skipMroEntry) {
        skipMroEntry = false;
        continue;
      }
      const specializedMroClass = partiallySpecializeType(mroClass, classType);
      if (flags & ClassIteratorFlags.SkipObjectBaseClass) {
        if (isClass(specializedMroClass)) {
          if (ClassType.isBuiltIn(specializedMroClass, 'object')) {
            continue;
          }
        }
      }
      yield [mroClass, specializedMroClass];
      if ((flags & ClassIteratorFlags.SkipBaseClasses) !== 0) {
        break;
      }
    }
  }
  return undefined;
}
export function addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[]) {
  for (const type2 of list2) {
    if (!list1.find((type1) => isTypeSame(type1, type2))) {
      list1.push(type2);
    }
  }
}
export function getTypeVarArgumentsRecursive(type: Type, recursionCount = 0): TypeVarType[] {
  if (recursionCount > maxTypeRecursionCount) {
    return [];
  }
  const getTypeVarsFromClass = (classType: ClassType) => {
    const combinedList: TypeVarType[] = [];
    if (classType.typeArguments) {
      classType.typeArguments.forEach((typeArg) => {
        addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg, recursionCount + 1));
      });
    }
    return combinedList;
  };
  if (type.typeAliasInfo?.typeArguments) {
    const combinedList: TypeVarType[] = [];
    type.typeAliasInfo?.typeArguments.forEach((typeArg) => {
      addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg, recursionCount + 1));
    });
    return combinedList;
  } else if (isTypeVar(type)) {
    if (type.details.recursiveTypeAliasName) {
      return [];
    }
    return [type];
  } else if (isClass(type)) {
    return getTypeVarsFromClass(type);
  } else if (isObject(type)) {
    return getTypeVarsFromClass(type.classType);
  } else if (isUnion(type)) {
    const combinedList: TypeVarType[] = [];
    doForEachSubtype(type, (subtype) => {
      addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(subtype, recursionCount + 1));
    });
    return combinedList;
  } else if (isFunction(type)) {
    const combinedList: TypeVarType[] = [];
    for (let i = 0; i < type.details.parameters.length; i++) {
      addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(FunctionType.getEffectiveParameterType(type, i), recursionCount + 1));
    }
    if (type.details.paramSpec) {
      addTypeVarsToListIfUnique(combinedList, [type.details.paramSpec]);
    }
    const returnType = FunctionType.getSpecializedReturnType(type);
    if (returnType) {
      addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(returnType, recursionCount + 1));
    }
    return combinedList;
  }
  return [];
}
export function selfSpecializeClassType(type: ClassType, setSkipAbstractClassTest = false): ClassType {
  if (!ClassType.isGeneric(type) && !setSkipAbstractClassTest) {
    return type;
  }
  const typeArgs = ClassType.getTypeParameters(type);
  return ClassType.cloneForSpecialization(type, typeArgs, /* isTypeArgumentExplicit */ false, setSkipAbstractClassTest);
}
export function specializeClassType(type: ClassType): ClassType {
  const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));
  const typeParams = ClassType.getTypeParameters(type);
  typeParams.forEach((typeParam) => {
    typeVarMap.setTypeVarType(typeParam, UnknownType.create());
  });
  return applySolvedTypeVars(type, typeVarMap) as ClassType;
}
export function setTypeArgumentsRecursive(destType: Type, srcType: Type, typeVarMap: TypeVarMap, recursionCount = 0) {
  if (recursionCount > maxTypeRecursionCount) return;
  if (typeVarMap.isLocked()) return;
  switch (destType.category) {
    case TypeCategory.Union:
      doForEachSubtype(destType, (subtype) => {
        setTypeArgumentsRecursive(subtype, srcType, typeVarMap, recursionCount + 1);
      });
      break;
    case TypeCategory.Class:
      if (destType.typeArguments) {
        destType.typeArguments.forEach((typeArg) => {
          setTypeArgumentsRecursive(typeArg, srcType, typeVarMap, recursionCount + 1);
        });
      }
      if (destType.tupleTypeArguments) {
        destType.tupleTypeArguments.forEach((typeArg) => {
          setTypeArgumentsRecursive(typeArg, srcType, typeVarMap, recursionCount + 1);
        });
      }
      break;
    case TypeCategory.Object:
      setTypeArgumentsRecursive(destType.classType, srcType, typeVarMap, recursionCount + 1);
      break;
    case TypeCategory.Function:
      if (destType.specializedTypes) {
        destType.specializedTypes.parameterTypes.forEach((paramType) => {
          setTypeArgumentsRecursive(paramType, srcType, typeVarMap, recursionCount + 1);
        });
        if (destType.specializedTypes.returnType) {
          setTypeArgumentsRecursive(destType.specializedTypes.returnType, srcType, typeVarMap, recursionCount + 1);
        }
      } else {
        destType.details.parameters.forEach((param) => {
          setTypeArgumentsRecursive(param.type, srcType, typeVarMap, recursionCount + 1);
        });
        if (destType.details.declaredReturnType) {
          setTypeArgumentsRecursive(destType.details.declaredReturnType, srcType, typeVarMap, recursionCount + 1);
        }
      }
      break;
    case TypeCategory.OverloadedFunction:
      destType.overloads.forEach((subtype) => {
        setTypeArgumentsRecursive(subtype, srcType, typeVarMap, recursionCount + 1);
      });
      break;
    case TypeCategory.TypeVar:
      if (!typeVarMap.hasTypeVar(destType)) {
        typeVarMap.setTypeVarType(destType, srcType);
      }
      break;
  }
}
export function buildTypeVarMapFromSpecializedClass(classType: ClassType, makeConcrete = true): TypeVarMap {
  const typeParameters = ClassType.getTypeParameters(classType);
  let typeArguments = classType.typeArguments;
  if (!typeArguments && !makeConcrete) {
    typeArguments = typeParameters;
  }
  const typeVarMap = buildTypeVarMap(typeParameters, typeArguments, getTypeVarScopeId(classType));
  if (ClassType.isTupleClass(classType) && classType.tupleTypeArguments && typeParameters.length >= 1) {
    typeVarMap.setVariadicTypeVar(typeParameters[0], classType.tupleTypeArguments);
  }
  return typeVarMap;
}
export function buildTypeVarMap(typeParameters: TypeVarType[], typeArgs: Type[] | undefined, typeVarScopeId: TypeVarScopeId | undefined): TypeVarMap {
  const typeVarMap = new TypeVarMap(typeVarScopeId);
  typeParameters.forEach((typeParam, index) => {
    let typeArgType: Type;
    if (typeArgs) {
      if (isParamSpec(typeParam)) {
        const paramSpecEntries: ParamSpecValue = [];
        if (index < typeArgs.length) {
          typeArgType = typeArgs[index];
          if (isFunction(typeArgType) && FunctionType.isParamSpecValue(typeArgType)) {
            typeArgType.details.parameters.forEach((param) => {
              paramSpecEntries.push({
                category: param.category,
                name: param.name,
                hasDefault: !!param.hasDefault,
                type: param.type,
              });
            });
          }
        }
        typeVarMap.setParamSpec(typeParam, paramSpecEntries);
      } else {
        if (index >= typeArgs.length) {
          typeArgType = AnyType.create();
        } else {
          typeArgType = typeArgs[index];
        }
        typeVarMap.setTypeVarType(typeParam, typeArgType, /* wideBound */ undefined, /* retainLiteral */ true);
      }
    }
  });
  return typeVarMap;
}
export function specializeForBaseClass(srcType: ClassType, baseClass: ClassType): ClassType {
  const typeParams = ClassType.getTypeParameters(baseClass);
  if (typeParams.length === 0) {
    return baseClass;
  }
  const typeVarMap = buildTypeVarMapFromSpecializedClass(srcType);
  const specializedType = applySolvedTypeVars(baseClass, typeVarMap);
  assert(isClass(specializedType));
  return specializedType as ClassType;
}
export function derivesFromClassRecursive(classType: ClassType, baseClassToFind: ClassType, ignoreUnknown: boolean) {
  if (ClassType.isSameGenericClass(classType, baseClassToFind)) {
    return true;
  }
  for (const baseClass of classType.details.baseClasses) {
    if (isClass(baseClass)) {
      if (derivesFromClassRecursive(baseClass, baseClassToFind, ignoreUnknown)) {
        return true;
      }
    } else if (!ignoreUnknown && isAnyOrUnknown(baseClass)) {
      return true;
    }
  }
  return false;
}
export function removeFalsinessFromType(type: Type): Type {
  return mapSubtypes(type, (subtype) => {
    if (isObject(subtype)) {
      if (subtype.classType.literalValue !== undefined) {
        return subtype.classType.literalValue ? subtype : undefined;
      }
      if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
        return ObjectType.create(ClassType.cloneWithLiteral(subtype.classType, true));
      }
    }
    if (canBeTruthy(subtype)) {
      return subtype;
    }
    return undefined;
  });
}
export function removeTruthinessFromType(type: Type): Type {
  return mapSubtypes(type, (subtype) => {
    if (isObject(subtype)) {
      if (subtype.classType.literalValue !== undefined) {
        return !subtype.classType.literalValue ? subtype : undefined;
      }
      if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
        return ObjectType.create(ClassType.cloneWithLiteral(subtype.classType, false));
      }
    }
    if (canBeFalsy(subtype)) {
      return subtype;
    }
    return undefined;
  });
}
export function getDeclaredGeneratorYieldType(functionType: FunctionType): Type | undefined {
  const returnType = FunctionType.getSpecializedReturnType(functionType);
  if (returnType) {
    const generatorTypeArgs = getGeneratorTypeArgs(returnType);
    if (generatorTypeArgs && generatorTypeArgs.length >= 1) {
      return generatorTypeArgs[0];
    }
  }
  return undefined;
}
export function getDeclaredGeneratorSendType(functionType: FunctionType): Type | undefined {
  const returnType = FunctionType.getSpecializedReturnType(functionType);
  if (returnType) {
    const generatorTypeArgs = getGeneratorTypeArgs(returnType);
    if (generatorTypeArgs && generatorTypeArgs.length >= 2) {
      return generatorTypeArgs[1];
    }
    return UnknownType.create();
  }
  return undefined;
}
export function getDeclaredGeneratorReturnType(functionType: FunctionType): Type | undefined {
  const returnType = FunctionType.getSpecializedReturnType(functionType);
  if (returnType) {
    const generatorTypeArgs = getGeneratorTypeArgs(returnType);
    if (generatorTypeArgs && generatorTypeArgs.length >= 3) {
      return generatorTypeArgs[2];
    }
    return UnknownType.create();
  }
  return undefined;
}
export function convertToInstance(type: Type): Type {
  let result = mapSubtypes(type, (subtype) => {
    subtype = transformTypeObjectToClass(subtype);
    switch (subtype.category) {
      case TypeCategory.Class: {
        return ObjectType.create(subtype);
      }
      case TypeCategory.None: {
        return NoneType.createInstance();
      }
      case TypeCategory.Function: {
        if (TypeBase.isInstantiable(subtype)) {
          return FunctionType.cloneAsInstance(subtype);
        }
        break;
      }
      case TypeCategory.TypeVar: {
        if (TypeBase.isInstantiable(subtype)) {
          return TypeVarType.cloneAsInstance(subtype);
        }
        break;
      }
    }
    return subtype;
  });
  if (type.typeAliasInfo && type !== result) {
    result = TypeBase.cloneForTypeAlias(
      result,
      type.typeAliasInfo.name,
      type.typeAliasInfo.fullName,
      type.typeAliasInfo.typeVarScopeId,
      type.typeAliasInfo.typeParameters,
      type.typeAliasInfo.typeArguments
    );
  }
  return result;
}
export function convertToInstantiable(type: Type): Type {
  let result = mapSubtypes(type, (subtype) => {
    switch (subtype.category) {
      case TypeCategory.Object: {
        return subtype.classType;
      }
      case TypeCategory.None: {
        return NoneType.createType();
      }
      case TypeCategory.Function: {
        if (TypeBase.isInstance(subtype)) {
          return FunctionType.cloneAsInstantiable(subtype);
        }
        break;
      }
      case TypeCategory.TypeVar: {
        if (TypeBase.isInstance(subtype)) {
          return TypeVarType.cloneAsInstantiable(subtype);
        }
        break;
      }
    }
    return subtype;
  });
  if (type.typeAliasInfo && type !== result) {
    result = TypeBase.cloneForTypeAlias(
      result,
      type.typeAliasInfo.name,
      type.typeAliasInfo.fullName,
      type.typeAliasInfo.typeVarScopeId,
      type.typeAliasInfo.typeParameters,
      type.typeAliasInfo.typeArguments
    );
  }
  return result;
}
export function getMembersForClass(classType: ClassType, symbolTable: SymbolTable, includeInstanceVars: boolean) {
  for (let i = 0; i < classType.details.mro.length; i++) {
    const mroClass = classType.details.mro[i];
    if (isClass(mroClass)) {
      const isClassTypedDict = ClassType.isTypedDictClass(mroClass);
      mroClass.details.fields.forEach((symbol, name) => {
        if (symbol.isClassMember() || (includeInstanceVars && symbol.isInstanceMember())) {
          if (!isClassTypedDict || !isTypedDictMemberAccessedThroughIndex(symbol)) {
            if (!symbolTable.get(name)) {
              symbolTable.set(name, symbol);
            }
          }
        }
      });
    }
  }
  if (!includeInstanceVars) {
    const metaclass = classType.details.effectiveMetaclass;
    if (metaclass && isClass(metaclass)) {
      for (const mroClass of metaclass.details.mro) {
        if (isClass(mroClass)) {
          mroClass.details.fields.forEach((symbol, name) => {
            if (!symbolTable.get(name)) {
              symbolTable.set(name, symbol);
            }
          });
        } else {
          break;
        }
      }
    }
  }
}
export function getMembersForModule(moduleType: ModuleType, symbolTable: SymbolTable) {
  if (moduleType.loaderFields) {
    moduleType.loaderFields.forEach((symbol, name) => {
      symbolTable.set(name, symbol);
    });
  }
  moduleType.fields.forEach((symbol, name) => {
    symbolTable.set(name, symbol);
  });
}
export function containsUnknown(type: Type) {
  let foundUnknown = false;
  doForEachSubtype(type, (subtype) => {
    if (isUnknown(subtype)) {
      foundUnknown = true;
    }
  });
  return foundUnknown;
}
export function isPartlyUnknown(type: Type, allowUnknownTypeArgsForClasses = false, recursionCount = 0): boolean {
  if (recursionCount > maxTypeRecursionCount) {
    return false;
  }
  if (isUnknown(type)) {
    return true;
  }
  if (isUnion(type)) {
    return findSubtype(type, (subtype) => isPartlyUnknown(subtype, allowUnknownTypeArgsForClasses, recursionCount + 1)) !== undefined;
  }
  if (isObject(type)) {
    return isPartlyUnknown(type.classType, false, recursionCount + 1);
  }
  if (isClass(type)) {
    if (!allowUnknownTypeArgsForClasses && !ClassType.isPseudoGenericClass(type)) {
      const typeArgs = type.tupleTypeArguments || type.typeArguments;
      if (typeArgs) {
        for (const argType of typeArgs) {
          if (isPartlyUnknown(argType, allowUnknownTypeArgsForClasses, recursionCount + 1)) {
            return true;
          }
        }
      }
    }
    return false;
  }
  if (isOverloadedFunction(type)) {
    return type.overloads.some((overload) => {
      return isPartlyUnknown(overload, false, recursionCount + 1);
    });
  }
  if (isFunction(type)) {
    for (let i = 0; i < type.details.parameters.length; i++) {
      if (type.details.parameters[i].name) {
        const paramType = FunctionType.getEffectiveParameterType(type, i);
        if (isPartlyUnknown(paramType, false, recursionCount + 1)) {
          return true;
        }
      }
    }
    if (type.details.declaredReturnType && isPartlyUnknown(type.details.declaredReturnType, false, recursionCount + 1)) {
      return true;
    }
    return false;
  }
  return false;
}
export function combineSameSizedTuples(type: Type, tupleType: Type | undefined) {
  if (!tupleType || !isClass(tupleType)) {
    return undefined;
  }
  let tupleEntries: Type[][] | undefined;
  let isValid = true;
  doForEachSubtype(type, (subtype) => {
    if (isObject(subtype) && isTupleClass(subtype.classType) && !isOpenEndedTupleClass(subtype.classType) && subtype.classType.tupleTypeArguments) {
      if (tupleEntries) {
        if (tupleEntries.length === subtype.classType.tupleTypeArguments.length) {
          subtype.classType.tupleTypeArguments.forEach((entry, index) => {
            tupleEntries![index].push(entry);
          });
        } else {
          isValid = false;
        }
      } else {
        tupleEntries = subtype.classType.tupleTypeArguments.map((entry) => [entry]);
      }
    } else {
      isValid = false;
    }
  });
  if (!isValid || !tupleEntries) {
    return undefined;
  }
  return convertToInstance(
    specializeTupleClass(
      tupleType,
      tupleEntries.map((entry) => combineTypes(entry))
    )
  );
}
export function specializeTupleClass(classType: ClassType, typeArgs: Type[], isTypeArgumentExplicit = true, stripLiterals = true, isForUnpackedVariadicTypeVar = false): ClassType {
  let combinedTupleType: Type = AnyType.create(/* isEllipsis */ false);
  if (typeArgs.length === 2 && isEllipsisType(typeArgs[1])) {
    combinedTupleType = typeArgs[0];
  } else {
    combinedTupleType = combineTypes(typeArgs);
  }
  if (stripLiterals) {
    combinedTupleType = stripLiteralValue(combinedTupleType);
  }
  if (isNever(combinedTupleType)) {
    combinedTupleType = AnyType.create();
  }
  const clonedClassType = ClassType.cloneForSpecialization(classType, [combinedTupleType], isTypeArgumentExplicit, /* skipAbstractClassTest */ undefined, typeArgs);
  if (isForUnpackedVariadicTypeVar) {
    clonedClassType.isTupleForUnpackedVariadicTypeVar = true;
  }
  return clonedClassType;
}
export function _transformTypeVars(type: Type, callbacks: TypeVarTransformer, recursionMap = new Map<string, TypeVarType>(), recursionLevel = 0): Type {
  if (recursionLevel > maxTypeRecursionCount) {
    return type;
  }
  if (!requiresSpecialization(type)) {
    return type;
  }
  if (isAnyOrUnknown(type)) {
    return type;
  }
  if (isNone(type)) {
    return type;
  }
  if (isTypeVar(type)) {
    if (type.details.recursiveTypeAliasName) {
      if (!type.typeAliasInfo?.typeArguments) {
        return type;
      }
      let requiresUpdate = false;
      const typeArgs = type.typeAliasInfo.typeArguments.map((typeArg) => {
        const replacementType = _transformTypeVars(typeArg, callbacks, recursionMap, recursionLevel + 1);
        if (replacementType !== typeArg) {
          requiresUpdate = true;
        }
        return replacementType;
      });
      if (requiresUpdate) {
        return TypeBase.cloneForTypeAlias(type, type.typeAliasInfo.name, type.typeAliasInfo.fullName, type.typeAliasInfo.typeVarScopeId, type.typeAliasInfo.typeParameters, typeArgs);
      }
      return type;
    }
    let replacementType: Type = type;
    const typeVarName = TypeVarType.getNameWithScope(type);
    if (!recursionMap.has(typeVarName)) {
      replacementType = callbacks.transformTypeVar(type);
      if (TypeBase.isInstantiable(type) && !TypeBase.isInstantiable(replacementType)) {
        replacementType = convertToInstantiable(replacementType);
      }
      recursionMap.set(typeVarName, type);
      replacementType = _transformTypeVars(replacementType, callbacks, recursionMap, recursionLevel + 1);
      recursionMap.delete(typeVarName);
    }
    return replacementType;
  }
  if (isUnion(type)) {
    return mapSubtypes(type, (subtype) => {
      let transformedType = _transformTypeVars(subtype, callbacks, recursionMap, recursionLevel + 1);
      if (isVariadicTypeVar(subtype) && !isVariadicTypeVar(transformedType)) {
        const subtypesToCombine: Type[] = [];
        doForEachSubtype(transformedType, (transformedSubtype) => {
          if (
            isObject(transformedSubtype) &&
            isTupleClass(transformedSubtype.classType) &&
            transformedSubtype.classType.tupleTypeArguments &&
            transformedSubtype.classType.isTupleForUnpackedVariadicTypeVar
          ) {
            subtypesToCombine.push(...transformedSubtype.classType.tupleTypeArguments);
          } else {
            subtypesToCombine.push(transformedSubtype);
          }
        });
        transformedType = combineTypes(subtypesToCombine);
      }
      return transformedType;
    });
  }
  if (isObject(type)) {
    const classType = _transformTypeVarsInClassType(type.classType, callbacks, recursionMap, recursionLevel + 1);
    if (ClassType.isBuiltIn(classType, 'Type')) {
      const typeArgs = classType.typeArguments;
      if (typeArgs && typeArgs.length >= 1) {
        if (isObject(typeArgs[0])) {
          return _transformTypeVars(typeArgs[0].classType, callbacks, recursionMap, recursionLevel + 1);
        } else if (isTypeVar(typeArgs[0])) {
          const replacementType = callbacks.transformTypeVar(typeArgs[0]);
          if (replacementType && isObject(replacementType)) {
            return replacementType.classType;
          }
        }
      }
    }
    if (classType === type.classType) {
      return type;
    }
    return ObjectType.create(classType);
  }
  if (isClass(type)) {
    return _transformTypeVarsInClassType(type, callbacks, recursionMap, recursionLevel + 1);
  }
  if (isFunction(type)) {
    return _transformTypeVarsInFunctionType(type, callbacks, recursionMap, recursionLevel + 1);
  }
  if (isOverloadedFunction(type)) {
    let requiresUpdate = false;
    const newOverloads: FunctionType[] = [];
    type.overloads.forEach((entry) => {
      const replacementType = _transformTypeVarsInFunctionType(entry, callbacks, recursionMap, recursionLevel);
      newOverloads.push(replacementType);
      if (replacementType !== entry) {
        requiresUpdate = true;
      }
    });
    return requiresUpdate ? OverloadedFunctionType.create(newOverloads) : type;
  }
  return type;
}
function _transformTypeVarsInClassType(classType: ClassType, callbacks: TypeVarTransformer, recursionMap: Map<string, TypeVarType>, recursionLevel: number): ClassType {
  if (ClassType.getTypeParameters(classType).length === 0 && !ClassType.isSpecialBuiltIn(classType)) {
    return classType;
  }
  let newTypeArgs: Type[] = [];
  let newVariadicTypeArgs: Type[] | undefined;
  let specializationNeeded = false;
  const typeParams = ClassType.getTypeParameters(classType);
  if (classType.typeArguments) {
    newTypeArgs = classType.typeArguments.map((oldTypeArgType) => {
      const newTypeArgType = _transformTypeVars(oldTypeArgType, callbacks, recursionMap, recursionLevel + 1);
      if (newTypeArgType !== oldTypeArgType) {
        specializationNeeded = true;
      }
      return newTypeArgType;
    });
  } else {
    typeParams.forEach((typeParam) => {
      let replacementType: Type = typeParam;
      if (typeParam.details.isParamSpec) {
        const paramSpecEntries = callbacks.transformParamSpec(typeParam);
        if (paramSpecEntries) {
          const functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);
          paramSpecEntries.forEach((entry) => {
            FunctionType.addParameter(functionType, {
              category: entry.category,
              name: entry.name,
              hasDefault: entry.hasDefault,
              hasDeclaredType: true,
              type: entry.type,
            });
          });
          replacementType = functionType;
        }
      } else {
        const typeParamName = TypeVarType.getNameWithScope(typeParam);
        if (!recursionMap.has(typeParamName)) {
          replacementType = callbacks.transformTypeVar(typeParam);
          if (replacementType !== typeParam) {
            recursionMap.set(typeParamName, typeParam);
            replacementType = _transformTypeVars(replacementType, callbacks, recursionMap, recursionLevel + 1);
            recursionMap.delete(typeParamName);
            specializationNeeded = true;
          }
        }
      }
      newTypeArgs.push(replacementType);
    });
  }
  if (ClassType.isTupleClass(classType)) {
    if (classType.tupleTypeArguments) {
      newVariadicTypeArgs = [];
      classType.tupleTypeArguments.forEach((oldTypeArgType) => {
        const newTypeArgType = _transformTypeVars(oldTypeArgType, callbacks, recursionMap, recursionLevel + 1);
        if (newTypeArgType !== oldTypeArgType) {
          specializationNeeded = true;
        }
        if (isVariadicTypeVar(oldTypeArgType) && isObject(newTypeArgType) && isTupleClass(newTypeArgType.classType) && newTypeArgType.classType.tupleTypeArguments) {
          newVariadicTypeArgs!.push(...newTypeArgType.classType.tupleTypeArguments);
        } else {
          newVariadicTypeArgs!.push(newTypeArgType);
        }
      });
    } else if (typeParams.length > 0) {
      newVariadicTypeArgs = callbacks.transformVariadicTypeVar(typeParams[0]);
      if (newVariadicTypeArgs) {
        specializationNeeded = true;
      }
    }
  }
  if (!specializationNeeded) {
    return classType;
  }
  return ClassType.cloneForSpecialization(classType, newTypeArgs, /* isTypeArgumentExplicit */ true, /* skipAbstractClassTest */ undefined, newVariadicTypeArgs);
}
function _transformTypeVarsInFunctionType(sourceType: FunctionType, callbacks: TypeVarTransformer, recursionMap: Map<string, TypeVarType>, recursionLevel: number): FunctionType {
  let functionType = sourceType;
  if (functionType.details.paramSpec) {
    const paramSpec = callbacks.transformParamSpec(functionType.details.paramSpec);
    if (paramSpec) {
      functionType = FunctionType.cloneForParamSpec(functionType, paramSpec);
    }
  }
  const declaredReturnType = functionType.specializedTypes && functionType.specializedTypes.returnType ? functionType.specializedTypes.returnType : functionType.details.declaredReturnType;
  const specializedReturnType = declaredReturnType ? _transformTypeVars(declaredReturnType, callbacks, recursionMap, recursionLevel + 1) : undefined;
  let typesRequiredSpecialization = declaredReturnType !== specializedReturnType;
  const specializedParameters: SpecializedFunctionTypes = {
    parameterTypes: [],
    returnType: specializedReturnType,
  };
  if (functionType.details.parameters.length >= 2) {
    const argsParam = functionType.details.parameters[functionType.details.parameters.length - 2];
    const kwargsParam = functionType.details.parameters[functionType.details.parameters.length - 1];
    const argsParamType = FunctionType.getEffectiveParameterType(functionType, functionType.details.parameters.length - 2);
    const kwargsParamType = FunctionType.getEffectiveParameterType(functionType, functionType.details.parameters.length - 1);
    if (
      argsParam.category === ParameterCategory.VarArgList &&
      kwargsParam.category === ParameterCategory.VarArgDictionary &&
      isParamSpec(argsParamType) &&
      isParamSpec(kwargsParamType) &&
      isTypeSame(argsParamType, kwargsParamType)
    ) {
      const paramSpecType = callbacks.transformParamSpec(argsParamType);
      if (paramSpecType) {
        functionType = FunctionType.cloneForParamSpecApplication(functionType, paramSpecType);
      }
    }
  }
  let variadicParamIndex: number | undefined;
  let variadicTypesToUnpack: Type[] | undefined;
  for (let i = 0; i < functionType.details.parameters.length; i++) {
    const paramType = FunctionType.getEffectiveParameterType(functionType, i);
    const specializedType = _transformTypeVars(paramType, callbacks, recursionMap, recursionLevel + 1);
    specializedParameters.parameterTypes.push(specializedType);
    if (variadicParamIndex === undefined && isVariadicTypeVar(paramType) && functionType.details.parameters[i].category === ParameterCategory.Simple) {
      variadicParamIndex = i;
      if (isObject(specializedType) && isTupleClass(specializedType.classType) && specializedType.classType.isTupleForUnpackedVariadicTypeVar) {
        variadicTypesToUnpack = specializedType.classType.tupleTypeArguments;
      }
    }
    if (paramType !== specializedType) {
      typesRequiredSpecialization = true;
    }
  }
  if (!typesRequiredSpecialization) {
    return functionType;
  }
  let specializedInferredReturnType: Type | undefined;
  if (functionType.inferredReturnType) {
    specializedInferredReturnType = _transformTypeVars(functionType.inferredReturnType, callbacks, recursionMap, recursionLevel + 1);
  }
  if (!variadicTypesToUnpack) {
    return FunctionType.cloneForSpecialization(functionType, specializedParameters, specializedInferredReturnType);
  }
  const newFunctionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.SynthesizedMethod);
  specializedParameters.parameterTypes.forEach((paramType, index) => {
    if (index === variadicParamIndex) {
      variadicTypesToUnpack!.forEach((unpackedType) => {
        FunctionType.addParameter(newFunctionType, {
          category: ParameterCategory.Simple,
          name: `_p${newFunctionType.details.parameters.length}`,
          isNameSynthesized: true,
          type: unpackedType,
          hasDeclaredType: true,
        });
      });
    } else {
      const param = { ...functionType.details.parameters[index] };
      param.type = paramType;
      if (param.name && param.isNameSynthesized) {
        param.name = `_p${newFunctionType.details.parameters.length}`;
      }
      FunctionType.addParameter(newFunctionType, param);
    }
  });
  newFunctionType.details.declaredReturnType = FunctionType.getSpecializedReturnType(functionType);
  return newFunctionType;
}
export function getGeneratorTypeArgs(returnType: Type): Type[] | undefined {
  if (isObject(returnType)) {
    const classType = returnType.classType;
    if (ClassType.isBuiltIn(classType)) {
      const className = classType.details.name;
      if (className === 'Generator' || className === 'AsyncGenerator') {
        return classType.typeArguments;
      }
    }
  }
  return undefined;
}
export function requiresTypeArguments(classType: ClassType) {
  if (classType.details.typeParameters.length > 0) {
    return !classType.details.typeParameters[0].details.isSynthesized;
  }
  if (ClassType.isBuiltIn(classType)) {
    const specialClasses = ['Tuple', 'Callable', 'Generic', 'Type', 'Optional', 'Union', 'Final', 'Literal', 'Annotated', 'TypeGuard'];
    if (specialClasses.some((t) => t === (classType.aliasName || classType.details.name))) {
      return true;
    }
  }
  return false;
}
export function requiresSpecialization(type: Type, recursionCount = 0): boolean {
  switch (type.category) {
    case TypeCategory.Class: {
      if (type.typeArguments) {
        if (recursionCount > maxTypeRecursionCount) {
          return false;
        }
        return type.typeArguments.find((typeArg) => requiresSpecialization(typeArg, recursionCount + 1)) !== undefined;
      }
      return ClassType.getTypeParameters(type).length > 0;
    }
    case TypeCategory.Object: {
      if (recursionCount > maxTypeRecursionCount) {
        return false;
      }
      return requiresSpecialization(type.classType, recursionCount + 1);
    }
    case TypeCategory.Function: {
      if (recursionCount > maxTypeRecursionCount) {
        return false;
      }
      for (let i = 0; i < type.details.parameters.length; i++) {
        if (requiresSpecialization(FunctionType.getEffectiveParameterType(type, i), recursionCount + 1)) {
          return true;
        }
      }
      const declaredReturnType = type.specializedTypes && type.specializedTypes.returnType ? type.specializedTypes.returnType : type.details.declaredReturnType;
      if (declaredReturnType) {
        if (requiresSpecialization(declaredReturnType, recursionCount + 1)) {
          return true;
        }
      } else if (type.inferredReturnType) {
        if (requiresSpecialization(type.inferredReturnType, recursionCount + 1)) {
          return true;
        }
      }
      return false;
    }
    case TypeCategory.OverloadedFunction: {
      return type.overloads.find((overload) => requiresSpecialization(overload, recursionCount + 1)) !== undefined;
    }
    case TypeCategory.Union: {
      return findSubtype(type, (subtype) => requiresSpecialization(subtype, recursionCount + 1)) !== undefined;
    }
    case TypeCategory.TypeVar: {
      if (!type.details.recursiveTypeAliasName) {
        return true;
      }
      if (type.typeAliasInfo?.typeArguments) {
        return type.typeAliasInfo.typeArguments.some((typeArg) => requiresSpecialization(typeArg, recursionCount + 1));
      }
    }
  }
  return false;
}
export function computeMroLinearization(classType: ClassType): boolean {
  let isMroFound = true;
  const classListsToMerge: Type[][] = [];
  const baseClassesToInclude = classType.details.baseClasses.filter((baseClass) => !isClass(baseClass) || !ClassType.isBuiltIn(baseClass, 'Generic'));
  baseClassesToInclude.forEach((baseClass) => {
    if (isClass(baseClass)) {
      const typeVarMap = buildTypeVarMapFromSpecializedClass(baseClass, /* makeConcrete */ false);
      classListsToMerge.push(
        baseClass.details.mro.map((mroClass) => {
          return applySolvedTypeVars(mroClass, typeVarMap);
        })
      );
    } else {
      classListsToMerge.push([baseClass]);
    }
  });
  classListsToMerge.push(
    baseClassesToInclude.map((baseClass) => {
      const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, /* makeConcrete */ false);
      return applySolvedTypeVars(baseClass, typeVarMap);
    })
  );
  const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, /* makeConcrete */ false);
  classType.details.mro.push(applySolvedTypeVars(classType, typeVarMap));
  const isInTail = (searchClass: ClassType, classLists: Type[][]) => {
    return classLists.some((classList) => {
      return classList.findIndex((value) => isClass(value) && ClassType.isSameGenericClass(value, searchClass)) > 0;
    });
  };
  const filterClass = (classToFilter: ClassType, classLists: Type[][]) => {
    for (let i = 0; i < classLists.length; i++) {
      classLists[i] = classLists[i].filter((value) => !isClass(value) || !ClassType.isSameGenericClass(value, classToFilter));
    }
  };
  while (true) {
    let foundValidHead = false;
    let nonEmptyList: Type[] | undefined = undefined;
    for (let i = 0; i < classListsToMerge.length; i++) {
      const classList = classListsToMerge[i];
      if (classList.length > 0) {
        if (nonEmptyList === undefined) {
          nonEmptyList = classList;
        }
        if (!isClass(classList[0])) {
          foundValidHead = true;
          classType.details.mro.push(classList[0]);
          classList.shift();
          break;
        } else if (!isInTail(classList[0], classListsToMerge)) {
          foundValidHead = true;
          classType.details.mro.push(classList[0]);
          filterClass(classList[0], classListsToMerge);
          break;
        }
      }
    }
    if (!nonEmptyList) {
      break;
    }
    if (!foundValidHead) {
      isMroFound = false;
      if (!isClass(nonEmptyList[0])) {
        classType.details.mro.push(nonEmptyList[0]);
        nonEmptyList.shift();
      } else {
        classType.details.mro.push(nonEmptyList[0]);
        filterClass(nonEmptyList[0], classListsToMerge);
      }
    }
  }
  return isMroFound;
}
export function getDeclaringModulesForType(type: Type): string[] {
  const moduleList: string[] = [];
  addDeclaringModuleNamesForType(type, moduleList);
  return moduleList;
}
function addDeclaringModuleNamesForType(type: Type, moduleList: string[], recursionCount = 0) {
  if (recursionCount > maxTypeRecursionCount) return;
  const addIfUnique = (moduleName: string) => {
    if (moduleName && !moduleList.some((n) => n === moduleName)) {
      moduleList.push(moduleName);
    }
  };
  switch (type.category) {
    case TypeCategory.Class: {
      addIfUnique(type.details.moduleName);
      break;
    }
    case TypeCategory.Object: {
      addIfUnique(type.classType.details.moduleName);
      break;
    }
    case TypeCategory.Function: {
      addIfUnique(type.details.moduleName);
      break;
    }
    case TypeCategory.OverloadedFunction: {
      type.overloads.forEach((overload) => {
        addDeclaringModuleNamesForType(overload, moduleList, recursionCount + 1);
      });
      break;
    }
    case TypeCategory.Union: {
      doForEachSubtype(type, (subtype) => {
        addDeclaringModuleNamesForType(subtype, moduleList, recursionCount + 1);
      });
      break;
    }
    case TypeCategory.Module: {
      addIfUnique(type.moduleName);
      break;
    }
  }
}
