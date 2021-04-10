import { assert } from '../common/debug';
import { ExpressionNode, ParameterCategory } from '../parser/parseNodes';
import { FunctionDeclaration } from './declaration';
import { Symbol, SymbolTable } from './symbol';
export const enum TypeCategory {
  Unbound,
  Unknown,
  Any,
  None,
  Never,
  Function,
  OverloadedFunction,
  Class,
  Object,
  Module,
  Union,
  TypeVar,
}
export const enum TypeFlags {
  None = 0,
  Instantiable = 1 << 0,
  Instance = 1 << 1,
  Annotated = 1 << 2,
}
export type UnionableType = UnboundType | UnknownType | AnyType | NoneType | FunctionType | OverloadedFunctionType | ClassType | ObjectType | ModuleType | TypeVarType;
export type Type = UnionableType | NeverType | UnionType;
export type TypeVarScopeId = string;
export const WildcardTypeVarScopeId = '*';
export class EnumLiteral {
  constructor(public className: string, public itemName: string, public itemType: Type) {}
}
export type LiteralValue = number | boolean | string | EnumLiteral;
export type TypeSourceId = number;
export const maxTypeRecursionCount = 16;
export type InheritanceChain = (ClassType | UnknownType)[];
interface TypeAliasInfo {
  name: string;
  fullName: string;
  typeParameters?: TypeVarType[];
  typeArguments?: Type[];
  typeVarScopeId: TypeVarScopeId;
}
interface TypeBase {
  category: TypeCategory;
  flags: TypeFlags;
  typeAliasInfo?: TypeAliasInfo;
}
export namespace TypeBase {
  export function isInstantiable(type: TypeBase) {
    return (type.flags & TypeFlags.Instantiable) !== 0;
  }
  export function isInstance(type: TypeBase) {
    return (type.flags & TypeFlags.Instance) !== 0;
  }
  export function isAnnotated(type: TypeBase) {
    return (type.flags & TypeFlags.Annotated) !== 0;
  }
  export function cloneForTypeAlias(type: Type, name: string, fullName: string, typeVarScopeId: TypeVarScopeId, typeParams?: TypeVarType[], typeArgs?: Type[]): Type {
    const typeClone = { ...type };
    typeClone.typeAliasInfo = {
      name,
      fullName,
      typeParameters: typeParams,
      typeArguments: typeArgs,
      typeVarScopeId,
    };
    return typeClone;
  }
  export function cloneForAnnotated(type: Type) {
    const typeClone = { ...type };
    typeClone.flags |= TypeFlags.Annotated;
    return typeClone;
  }
}
export interface UnboundType extends TypeBase {
  category: TypeCategory.Unbound;
}
export namespace UnboundType {
  const _instance: UnboundType = {
    category: TypeCategory.Unbound,
    flags: TypeFlags.Instantiable | TypeFlags.Instance,
  };
  export function create() {
    return _instance;
  }
}
export interface UnknownType extends TypeBase {
  category: TypeCategory.Unknown;
}
export namespace UnknownType {
  const _instance: UnknownType = {
    category: TypeCategory.Unknown,
    flags: TypeFlags.Instantiable | TypeFlags.Instance,
  };
  export function create() {
    return _instance;
  }
}
export interface ModuleType extends TypeBase {
  category: TypeCategory.Module;
  fields: SymbolTable;
  docString?: string;
  loaderFields: SymbolTable;
  moduleName: string;
}
export namespace ModuleType {
  export function create(moduleName: string, symbolTable?: SymbolTable) {
    const newModuleType: ModuleType = {
      category: TypeCategory.Module,
      fields: symbolTable || new Map<string, Symbol>(),
      loaderFields: new Map<string, Symbol>(),
      flags: TypeFlags.Instantiable | TypeFlags.Instantiable,
      moduleName,
    };
    return newModuleType;
  }
  export function getField(moduleType: ModuleType, name: string): Symbol | undefined {
    let symbol = moduleType.fields.get(name);
    if (!symbol && moduleType.loaderFields) {
      symbol = moduleType.loaderFields.get(name);
    }
    return symbol;
  }
}
export interface DataClassEntry {
  name: string;
  hasDefault?: boolean;
  defaultValueExpression?: ExpressionNode;
  includeInInit: boolean;
  type: Type;
}
export interface TypedDictEntry {
  valueType: Type;
  isRequired: boolean;
  isProvided: boolean;
}
export const enum ClassTypeFlags {
  None = 0,
  BuiltInClass = 1 << 0,
  SpecialBuiltIn = 1 << 1,
  DataClass = 1 << 2,
  FrozenDataClass = 1 << 3,
  SkipSynthesizedDataClassInit = 1 << 4,
  SkipSynthesizedDataClassEq = 1 << 5,
  SynthesizedDataClassOrder = 1 << 6,
  TypedDictClass = 1 << 7,
  CanOmitDictValues = 1 << 8,
  SupportsAbstractMethods = 1 << 9,
  HasAbstractMethods = 1 << 10,
  PropertyClass = 1 << 11,
  Final = 1 << 12,
  ProtocolClass = 1 << 13,
  PseudoGenericClass = 1 << 14,
  RuntimeCheckable = 1 << 15,
  TypingExtensionClass = 1 << 16,
  PartiallyConstructed = 1 << 17,
  HasCustomClassGetItem = 1 << 18,
  TupleClass = 1 << 19,
  EnumClass = 1 << 20,
}
interface ClassDetails {
  name: string;
  fullName: string;
  moduleName: string;
  flags: ClassTypeFlags;
  typeSourceId: TypeSourceId;
  baseClasses: Type[];
  mro: Type[];
  declaredMetaclass?: ClassType | UnknownType;
  effectiveMetaclass?: ClassType | UnknownType;
  fields: SymbolTable;
  typeParameters: TypeVarType[];
  typeVarScopeId?: TypeVarScopeId;
  docString?: string;
  dataClassEntries?: DataClassEntry[];
  typedDictEntries?: Map<string, TypedDictEntry>;
}
export interface ClassType extends TypeBase {
  category: TypeCategory.Class;
  details: ClassDetails;
  typeArguments?: Type[];
  tupleTypeArguments?: Type[];
  isTupleForUnpackedVariadicTypeVar?: boolean;
  isTypeArgumentExplicit?: boolean;
  skipAbstractClassTest: boolean;
  literalValue?: LiteralValue;
  aliasName?: string;
  typedDictNarrowedEntries?: Map<string, TypedDictEntry>;
}
export namespace ClassType {
  export function create(
    name: string,
    fullName: string,
    moduleName: string,
    flags: ClassTypeFlags,
    typeSourceId: TypeSourceId,
    declaredMetaclass: ClassType | UnknownType | undefined,
    effectiveMetaclass: ClassType | UnknownType | undefined,
    docString?: string
  ) {
    const newClass: ClassType = {
      category: TypeCategory.Class,
      details: {
        name,
        fullName,
        moduleName,
        flags,
        typeSourceId,
        baseClasses: [],
        declaredMetaclass,
        effectiveMetaclass,
        mro: [],
        fields: new Map<string, Symbol>(),
        typeParameters: [],
        docString,
      },
      skipAbstractClassTest: false,
      flags: TypeFlags.Instantiable,
    };
    return newClass;
  }
  export function cloneForSpecialization(
    classType: ClassType,
    typeArguments: Type[] | undefined,
    isTypeArgumentExplicit: boolean,
    skipAbstractClassTest = false,
    tupleTypeArguments?: Type[]
  ): ClassType {
    const newClassType = { ...classType };
    newClassType.typeArguments = typeArguments ? typeArguments.map((t) => (isNever(t) ? UnknownType.create() : t)) : undefined;
    newClassType.isTypeArgumentExplicit = isTypeArgumentExplicit;
    newClassType.skipAbstractClassTest = skipAbstractClassTest;
    newClassType.tupleTypeArguments = tupleTypeArguments ? tupleTypeArguments.map((t) => (isNever(t) ? UnknownType.create() : t)) : undefined;
    return newClassType;
  }
  export function cloneWithLiteral(classType: ClassType, value: LiteralValue | undefined): ClassType {
    const newClassType = { ...classType };
    newClassType.literalValue = value;
    return newClassType;
  }
  export function cloneForTypingAlias(classType: ClassType, aliasName: string): ClassType {
    const newClassType = { ...classType };
    newClassType.aliasName = aliasName;
    return newClassType;
  }
  export function cloneForNarrowedTypedDictEntries(classType: ClassType, narrowedEntries?: Map<string, TypedDictEntry>) {
    const newClassType = { ...classType };
    newClassType.typedDictNarrowedEntries = narrowedEntries;
    return newClassType;
  }
  export function cloneWithNewTypeParameters(classType: ClassType, typeParams: TypeVarType[]): ClassType {
    const newClassType = { ...classType };
    newClassType.details = { ...newClassType.details };
    newClassType.details.typeParameters = typeParams;
    return newClassType;
  }
  export function isLiteralValueSame(type1: ClassType, type2: ClassType) {
    if (type1.literalValue === undefined) {
      return type2.literalValue === undefined;
    } else if (type2.literalValue === undefined) {
      return false;
    }
    if (type1.literalValue instanceof EnumLiteral) {
      if (type2.literalValue instanceof EnumLiteral) {
        return type1.literalValue.itemName === type2.literalValue.itemName;
      }
      return false;
    }
    return type1.literalValue === type2.literalValue;
  }
  export function isGeneric(classType: ClassType) {
    return classType.details.typeParameters.length > 0 && classType.typeArguments === undefined;
  }
  export function isSpecialBuiltIn(classType: ClassType, className?: string) {
    if (!(classType.details.flags & ClassTypeFlags.SpecialBuiltIn) && !classType.aliasName) {
      return false;
    }
    if (className !== undefined) {
      return classType.details.name === className;
    }
    return true;
  }
  export function isBuiltIn(classType: ClassType, className?: string) {
    if (!(classType.details.flags & ClassTypeFlags.BuiltInClass)) {
      return false;
    }
    if (className !== undefined) {
      return classType.details.name === className || classType.aliasName === className;
    }
    return true;
  }
  export function hasAbstractMethods(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.HasAbstractMethods) && !classType.skipAbstractClassTest;
  }
  export function supportsAbstractMethods(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.SupportsAbstractMethods);
  }
  export function isDataClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.DataClass);
  }
  export function isSkipSynthesizedDataClassInit(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.SkipSynthesizedDataClassInit);
  }
  export function isSkipSynthesizedDataClassEq(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.SkipSynthesizedDataClassEq);
  }
  export function isFrozenDataClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.FrozenDataClass);
  }
  export function isSynthesizedDataclassOrder(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.SynthesizedDataClassOrder);
  }
  export function isTypedDictClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.TypedDictClass);
  }
  export function isCanOmitDictValues(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.CanOmitDictValues);
  }
  export function isEnumClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.EnumClass);
  }
  export function isPropertyClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.PropertyClass);
  }
  export function isFinal(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.Final);
  }
  export function isProtocolClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.ProtocolClass);
  }
  export function isPseudoGenericClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.PseudoGenericClass);
  }
  export function getDataClassEntries(classType: ClassType): DataClassEntry[] {
    return classType.details.dataClassEntries || [];
  }
  export function isRuntimeCheckable(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.RuntimeCheckable);
  }
  export function isTypingExtensionClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.TypingExtensionClass);
  }
  export function isPartiallyConstructed(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.PartiallyConstructed);
  }
  export function hasCustomClassGetItem(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.HasCustomClassGetItem);
  }
  export function isTupleClass(classType: ClassType) {
    return !!(classType.details.flags & ClassTypeFlags.TupleClass);
  }
  export function getTypeParameters(classType: ClassType) {
    return classType.details.typeParameters;
  }
  export function hasUnknownBaseClass(classType: ClassType) {
    return classType.details.mro.some((baseClass) => isAnyOrUnknown(baseClass));
  }
  export function isSameGenericClass(classType: ClassType, type2: ClassType, recursionCount = 0) {
    if (recursionCount > maxTypeRecursionCount) {
      return true;
    }
    if (classType.details === type2.details) {
      return true;
    }
    const class1Details = classType.details;
    const class2Details = type2.details;
    if (class1Details === class2Details) {
      return true;
    }
    if (
      class1Details.fullName !== class2Details.fullName ||
      class1Details.flags !== class2Details.flags ||
      class1Details.typeSourceId !== class2Details.typeSourceId ||
      class1Details.baseClasses.length !== class2Details.baseClasses.length ||
      class1Details.typeParameters.length !== class2Details.typeParameters.length
    ) {
      return false;
    }
    if (ClassType.isBuiltIn(classType, 'NamedTuple') && ClassType.isBuiltIn(type2, 'NamedTuple')) {
      return true;
    }
    if (ClassType.isBuiltIn(classType, 'tuple') && ClassType.isBuiltIn(type2, 'tuple')) {
      return true;
    }
    for (let i = 0; i < class1Details.baseClasses.length; i++) {
      if (!isTypeSame(class1Details.baseClasses[i], class2Details.baseClasses[i], recursionCount + 1)) {
        return false;
      }
    }
    if (class1Details.declaredMetaclass || class2Details.declaredMetaclass) {
      if (!class1Details.declaredMetaclass || !class2Details.declaredMetaclass || !isTypeSame(class1Details.declaredMetaclass, class2Details.declaredMetaclass, recursionCount + 1)) {
        return false;
      }
    }
    for (let i = 0; i < class1Details.typeParameters.length; i++) {
      if (!isTypeSame(class1Details.typeParameters[i], class2Details.typeParameters[i], recursionCount + 1)) {
        return false;
      }
    }
    return true;
  }
  export function isDerivedFrom(subclassType: ClassType, parentClassType: ClassType, inheritanceChain?: InheritanceChain): boolean {
    if (isSameGenericClass(subclassType, parentClassType)) {
      if (inheritanceChain) {
        inheritanceChain.push(subclassType);
      }
      return true;
    }
    if (isBuiltIn(subclassType) && isBuiltIn(parentClassType, 'object')) {
      if (inheritanceChain) {
        inheritanceChain.push(parentClassType);
      }
      return true;
    }
    for (const baseClass of subclassType.details.baseClasses) {
      if (isClass(baseClass)) {
        if (isDerivedFrom(baseClass, parentClassType, inheritanceChain)) {
          if (inheritanceChain) {
            inheritanceChain.push(subclassType);
          }
          return true;
        }
      } else if (isAnyOrUnknown(baseClass)) {
        if (inheritanceChain) {
          inheritanceChain.push(UnknownType.create());
        }
        return true;
      }
    }
    return false;
  }
}
export interface ObjectType extends TypeBase {
  category: TypeCategory.Object;
  classType: ClassType;
}
export namespace ObjectType {
  export function create(classType: ClassType) {
    const newObjectType: ObjectType = {
      category: TypeCategory.Object,
      classType,
      flags: TypeFlags.Instance,
    };
    return newObjectType;
  }
}
export interface FunctionParameter {
  category: ParameterCategory;
  name?: string;
  isNameSynthesized?: boolean;
  isTypeInferred?: boolean;
  hasDefault?: boolean;
  defaultValueExpression?: ExpressionNode;
  defaultType?: Type;
  hasDeclaredType?: boolean;
  typeAnnotation?: ExpressionNode;
  type: Type;
}
export const enum FunctionTypeFlags {
  None = 0,
  ConstructorMethod = 1 << 0,
  ClassMethod = 1 << 1,
  StaticMethod = 1 << 2,
  AbstractMethod = 1 << 3,
  Generator = 1 << 4,
  DisableDefaultChecks = 1 << 5,
  SynthesizedMethod = 1 << 6,
  SkipConstructorCheck = 1 << 7,
  Overloaded = 1 << 8,
  Async = 1 << 9,
  WrapReturnTypeInAwait = 1 << 10,
  StubDefinition = 1 << 11,
  PyTypedDefinition = 1 << 12,
  Final = 1 << 13,
  UnannotatedParams = 1 << 14,
  SkipParamCompatibilityCheck = 1 << 15,
  ParamSpecValue = 1 << 16,
}
interface FunctionDetails {
  name: string;
  fullName: string;
  moduleName: string;
  flags: FunctionTypeFlags;
  parameters: FunctionParameter[];
  declaredReturnType?: Type;
  declaration?: FunctionDeclaration;
  typeVarScopeId?: TypeVarScopeId;
  builtInName?: string;
  docString?: string;
  paramSpec?: TypeVarType;
}
export interface SpecializedFunctionTypes {
  parameterTypes: Type[];
  returnType?: Type;
}
export interface FunctionType extends TypeBase {
  category: TypeCategory.Function;
  details: FunctionDetails;
  specializedTypes?: SpecializedFunctionTypes;
  inferredReturnType?: Type;
  strippedFirstParamType?: Type;
  boundToType?: ClassType | ObjectType;
  boundTypeVarScopeId?: TypeVarScopeId;
}
export interface ParamSpecEntry {
  category: ParameterCategory;
  name?: string;
  hasDefault: boolean;
  type: Type;
}
export type ParamSpecValue = ParamSpecEntry[];
export namespace FunctionType {
  export function createInstance(name: string, fullName: string, moduleName: string, functionFlags: FunctionTypeFlags, docString?: string) {
    return create(name, fullName, moduleName, functionFlags, TypeFlags.Instance, docString);
  }
  export function createInstantiable(name: string, fullName: string, moduleName: string, functionFlags: FunctionTypeFlags, docString?: string) {
    return create(name, fullName, moduleName, functionFlags, TypeFlags.Instantiable, docString);
  }
  function create(name: string, fullName: string, moduleName: string, functionFlags: FunctionTypeFlags, typeFlags: TypeFlags, docString?: string) {
    const newFunctionType: FunctionType = {
      category: TypeCategory.Function,
      details: {
        name,
        fullName,
        moduleName,
        flags: functionFlags,
        parameters: [],
        docString,
      },
      flags: typeFlags,
    };
    return newFunctionType;
  }
  export function clone(type: FunctionType, stripFirstParam = false, boundToType?: ClassType | ObjectType, boundTypeVarScopeId?: TypeVarScopeId): FunctionType {
    const newFunction = create(type.details.name, type.details.fullName, type.details.moduleName, type.details.flags, type.flags, type.details.docString);
    newFunction.details = { ...type.details };
    if (stripFirstParam) {
      if (type.details.parameters.length > 0 && type.details.parameters[0].category === ParameterCategory.Simple) {
        if (type.details.parameters.length > 0 && !type.details.parameters[0].isTypeInferred) {
          newFunction.strippedFirstParamType = getEffectiveParameterType(type, 0);
        }
        newFunction.details.parameters = type.details.parameters.slice(1);
      } else {
        stripFirstParam = false;
      }
      newFunction.boundToType = boundToType;
      newFunction.details.flags &= ~(FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.ClassMethod);
      newFunction.details.flags |= FunctionTypeFlags.StaticMethod;
    }
    if (type.typeAliasInfo !== undefined) {
      newFunction.typeAliasInfo = type.typeAliasInfo;
    }
    if (type.specializedTypes) {
      newFunction.specializedTypes = {
        parameterTypes: stripFirstParam ? type.specializedTypes.parameterTypes.slice(1) : type.specializedTypes.parameterTypes,
        returnType: type.specializedTypes.returnType,
      };
    }
    newFunction.inferredReturnType = type.inferredReturnType;
    newFunction.boundTypeVarScopeId = boundTypeVarScopeId;
    return newFunction;
  }
  export function cloneAsInstance(type: FunctionType) {
    assert(TypeBase.isInstantiable(type));
    const newInstance: FunctionType = { ...type };
    newInstance.flags &= ~TypeFlags.Instantiable;
    newInstance.flags |= TypeFlags.Instance;
    return newInstance;
  }
  export function cloneAsInstantiable(type: FunctionType) {
    assert(TypeBase.isInstance(type));
    const newInstance: FunctionType = { ...type };
    newInstance.flags &= ~TypeFlags.Instance;
    newInstance.flags |= TypeFlags.Instantiable;
    return newInstance;
  }
  export function cloneForSpecialization(type: FunctionType, specializedTypes: SpecializedFunctionTypes, specializedInferredReturnType: Type | undefined): FunctionType {
    const newFunction = create(type.details.name, type.details.fullName, type.details.moduleName, type.details.flags, type.flags, type.details.docString);
    newFunction.details = type.details;
    assert(specializedTypes.parameterTypes.length === type.details.parameters.length);
    newFunction.specializedTypes = specializedTypes;
    if (specializedInferredReturnType) {
      newFunction.inferredReturnType = specializedInferredReturnType;
    }
    return newFunction;
  }
  export function cloneForParamSpec(type: FunctionType, paramTypes: ParamSpecValue | undefined) {
    const newFunction = create(type.details.name, type.details.fullName, type.details.moduleName, type.details.flags, type.flags, type.details.docString);
    newFunction.details = { ...type.details };
    delete newFunction.details.paramSpec;
    if (paramTypes) {
      newFunction.details.parameters = [
        ...type.details.parameters,
        ...paramTypes.map((specEntry) => {
          return {
            category: specEntry.category,
            name: specEntry.name,
            hasDefault: specEntry.hasDefault,
            isNameSynthesized: false,
            hasDeclaredType: true,
            type: specEntry.type,
          };
        }),
      ];
    }
    return newFunction;
  }
  export function cloneForParamSpecApplication(type: FunctionType, paramTypes: ParamSpecValue) {
    const newFunction = create(type.details.name, type.details.fullName, type.details.moduleName, type.details.flags, type.flags, type.details.docString);
    newFunction.details = { ...type.details };
    newFunction.details.parameters = newFunction.details.parameters.slice(0, newFunction.details.parameters.length - 2);
    paramTypes.forEach((specEntry) => {
      newFunction.details.parameters.push({
        category: specEntry.category,
        name: specEntry.name,
        hasDefault: specEntry.hasDefault,
        isNameSynthesized: false,
        hasDeclaredType: true,
        type: specEntry.type,
      });
    });
    return newFunction;
  }
  export function addDefaultParameters(functionType: FunctionType, useUnknown = false) {
    FunctionType.addParameter(functionType, {
      category: ParameterCategory.VarArgList,
      name: 'args',
      type: useUnknown ? UnknownType.create() : AnyType.create(),
      hasDeclaredType: !useUnknown,
    });
    FunctionType.addParameter(functionType, {
      category: ParameterCategory.VarArgDictionary,
      name: 'kwargs',
      type: useUnknown ? UnknownType.create() : AnyType.create(),
      hasDeclaredType: !useUnknown,
    });
  }
  export function isInstanceMethod(type: FunctionType): boolean {
    return (type.details.flags & (FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ClassMethod)) === 0;
  }
  export function isConstructorMethod(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.ConstructorMethod) !== 0;
  }
  export function isStaticMethod(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.StaticMethod) !== 0;
  }
  export function isClassMethod(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.ClassMethod) !== 0;
  }
  export function isAbstractMethod(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.AbstractMethod) !== 0;
  }
  export function isGenerator(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.Generator) !== 0;
  }
  export function isSynthesizedMethod(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.SynthesizedMethod) !== 0;
  }
  export function isSkipConstructorCheck(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.SkipConstructorCheck) !== 0;
  }
  export function isOverloaded(type: FunctionType): boolean {
    return (type.details.flags & FunctionTypeFlags.Overloaded) !== 0;
  }
  export function isDefaultParameterCheckDisabled(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.DisableDefaultChecks) !== 0;
  }
  export function isAsync(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.Async) !== 0;
  }
  export function isWrapReturnTypeInAwait(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.WrapReturnTypeInAwait) !== 0;
  }
  export function isStubDefinition(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.StubDefinition) !== 0;
  }
  export function isPyTypedDefinition(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.PyTypedDefinition) !== 0;
  }
  export function isFinal(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.Final) !== 0;
  }
  export function hasUnannotatedParams(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.UnannotatedParams) !== 0;
  }
  export function shouldSkipParamCompatibilityCheck(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.SkipParamCompatibilityCheck) !== 0;
  }
  export function isParamSpecValue(type: FunctionType) {
    return (type.details.flags & FunctionTypeFlags.ParamSpecValue) !== 0;
  }
  export function getEffectiveParameterType(type: FunctionType, index: number): Type {
    assert(index < type.details.parameters.length);
    if (type.specializedTypes) {
      assert(index < type.specializedTypes.parameterTypes.length);
      return type.specializedTypes.parameterTypes[index];
    }
    return type.details.parameters[index].type;
  }
  export function addParameter(type: FunctionType, param: FunctionParameter) {
    type.details.parameters.push(param);
  }
  export function getSpecializedReturnType(type: FunctionType) {
    return type.specializedTypes && type.specializedTypes.returnType ? type.specializedTypes.returnType : type.details.declaredReturnType;
  }
}
export interface OverloadedFunctionType extends TypeBase {
  category: TypeCategory.OverloadedFunction;
  overloads: FunctionType[];
}
export namespace OverloadedFunctionType {
  export function create(overloads: FunctionType[] = []) {
    const newType: OverloadedFunctionType = {
      category: TypeCategory.OverloadedFunction,
      overloads,
      flags: TypeFlags.Instance,
    };
    return newType;
  }
  export function addOverload(type: OverloadedFunctionType, functionType: FunctionType) {
    type.overloads.push(functionType);
  }
}
export interface NoneType extends TypeBase {
  category: TypeCategory.None;
}
export namespace NoneType {
  const _noneInstance: NoneType = {
    category: TypeCategory.None,
    flags: TypeFlags.Instance,
  };
  const _noneType: NoneType = {
    category: TypeCategory.None,
    flags: TypeFlags.Instantiable,
  };
  export function createInstance() {
    return _noneInstance;
  }
  export function createType() {
    return _noneType;
  }
}
export interface NeverType extends TypeBase {
  category: TypeCategory.Never;
}
export namespace NeverType {
  const _neverInstance: NeverType = {
    category: TypeCategory.Never,
    flags: TypeFlags.Instance | TypeFlags.Instantiable,
  };
  export function create() {
    return _neverInstance;
  }
}
export interface AnyType extends TypeBase {
  category: TypeCategory.Any;
  isEllipsis: boolean;
}
export namespace AnyType {
  const _anyInstance: AnyType = {
    category: TypeCategory.Any,
    isEllipsis: false,
    flags: TypeFlags.Instance | TypeFlags.Instantiable,
  };
  const _ellipsisInstance: AnyType = {
    category: TypeCategory.Any,
    isEllipsis: true,
    flags: TypeFlags.Instance | TypeFlags.Instantiable,
  };
  export function create(isEllipsis = false) {
    return isEllipsis ? _ellipsisInstance : _anyInstance;
  }
}
export interface SubtypeConstraint {
  typeVarName: string;
  constraintIndex: number;
}
export namespace SubtypeConstraint {
  export function combine(constraints1: SubtypeConstraints, constraints2: SubtypeConstraints): SubtypeConstraints {
    if (!constraints1) {
      return constraints2;
    }
    if (!constraints2) {
      return constraints1;
    }
    const combined = [...constraints1];
    constraints2.forEach((c1) => {
      if (!combined.some((c2) => _compare(c1, c2) === 0)) {
        combined.push(c1);
      }
    });
    return combined.sort(_compare);
  }
  function _compare(c1: SubtypeConstraint, c2: SubtypeConstraint) {
    if (c1.typeVarName < c2.typeVarName) {
      return -1;
    } else if (c1.typeVarName > c2.typeVarName) {
      return 1;
    }
    if (c1.constraintIndex < c2.constraintIndex) {
      return -1;
    } else if (c1.constraintIndex > c2.constraintIndex) {
      return 1;
    }
    return 0;
  }
  export function isSame(constraints1: SubtypeConstraints, constraints2: SubtypeConstraints): boolean {
    if (!constraints1) {
      return !constraints2;
    }
    if (!constraints2 || constraints1.length !== constraints2.length) {
      return false;
    }
    return constraints1.find((c1, index) => c1.typeVarName !== constraints2[index].typeVarName || c1.constraintIndex !== constraints2[index].constraintIndex) === undefined;
  }
  export function isCompatible(constraints1: SubtypeConstraints, constraints2: SubtypeConstraints): boolean {
    if (!constraints1 || !constraints2) {
      return true;
    }
    for (const c1 of constraints1) {
      let foundTypeVarMatch = false;
      const exactMatch = constraints2.find((c2) => {
        if (c1.typeVarName === c2.typeVarName) {
          foundTypeVarMatch = true;
          return c1.constraintIndex === c2.constraintIndex;
        }
        return false;
      });
      if (foundTypeVarMatch && !exactMatch) {
        return false;
      }
    }
    return true;
  }
}
export type SubtypeConstraints = SubtypeConstraint[] | undefined;
export interface ConstrainedSubtype {
  type: Type;
  constraints: SubtypeConstraints;
}
export interface UnionType extends TypeBase {
  category: TypeCategory.Union;
  subtypes: UnionableType[];
  constraints?: SubtypeConstraints[];
  literalStrMap?: Map<string, UnionableType>;
  literalIntMap?: Map<number, UnionableType>;
}
export namespace UnionType {
  export function create() {
    const newUnionType: UnionType = {
      category: TypeCategory.Union,
      subtypes: [],
      flags: TypeFlags.Instance | TypeFlags.Instantiable,
    };
    return newUnionType;
  }
  export function addType(unionType: UnionType, newType: UnionableType, constraints: SubtypeConstraints) {
    if (isObject(newType) && ClassType.isBuiltIn(newType.classType, 'str') && newType.classType.literalValue !== undefined && !constraints) {
      if (unionType.literalStrMap === undefined) {
        unionType.literalStrMap = new Map<string, UnionableType>();
      }
      unionType.literalStrMap.set(newType.classType.literalValue as string, newType);
    } else if (isObject(newType) && ClassType.isBuiltIn(newType.classType, 'int') && newType.classType.literalValue !== undefined && !constraints) {
      if (unionType.literalIntMap === undefined) {
        unionType.literalIntMap = new Map<number, UnionableType>();
      }
      unionType.literalIntMap.set(newType.classType.literalValue as number, newType);
    }
    if (constraints) {
      if (!unionType.constraints) {
        unionType.constraints = Array.from({ length: unionType.subtypes.length });
      }
      unionType.constraints.push(constraints);
    }
    unionType.flags &= newType.flags;
    unionType.subtypes.push(newType);
  }
  export function containsType(unionType: UnionType, subtype: Type, constraints: SubtypeConstraints, recursionCount = 0): boolean {
    if (isObject(subtype)) {
      if (ClassType.isBuiltIn(subtype.classType, 'str') && subtype.classType.literalValue !== undefined && unionType.literalStrMap !== undefined) {
        return unionType.literalStrMap.has(subtype.classType.literalValue as string);
      } else if (ClassType.isBuiltIn(subtype.classType, 'int') && subtype.classType.literalValue !== undefined && unionType.literalIntMap !== undefined) {
        return unionType.literalIntMap.has(subtype.classType.literalValue as number);
      }
    }
    return unionType.subtypes.find((t) => isTypeSame(t, subtype, recursionCount + 1)) !== undefined;
  }
}
export const enum Variance {
  Invariant,
  Covariant,
  Contravariant,
}
export interface TypeVarDetails {
  name: string;
  constraints: Type[];
  boundType?: Type;
  variance: Variance;
  isParamSpec: boolean;
  isVariadic: boolean;
  isSynthesized: boolean;
  isSynthesizedSelfCls?: boolean;
  synthesizedIndex?: number;
  recursiveTypeAliasName?: string;
  recursiveTypeAliasScopeId?: TypeVarScopeId;
  recursiveTypeParameters?: TypeVarType[];
}
export interface TypeVarType extends TypeBase {
  category: TypeCategory.TypeVar;
  details: TypeVarDetails;
  scopeId?: TypeVarScopeId;
  scopeName?: string;
  nameWithScope?: string;
  isVariadicUnpacked?: boolean;
}
export namespace TypeVarType {
  export function createInstance(name: string) {
    return create(name, /* isParamSpec */ false, TypeFlags.Instance);
  }
  export function createInstantiable(name: string, isParamSpec = false) {
    return create(name, isParamSpec, TypeFlags.Instantiable);
  }
  export function cloneAsInstance(type: TypeVarType) {
    assert(TypeBase.isInstantiable(type));
    const newInstance: TypeVarType = { ...type };
    newInstance.flags &= ~TypeFlags.Instantiable;
    newInstance.flags |= TypeFlags.Instance;
    return newInstance;
  }
  export function cloneAsInstantiable(type: TypeVarType) {
    assert(TypeBase.isInstance(type));
    const newInstance: TypeVarType = { ...type };
    newInstance.flags &= ~TypeFlags.Instance;
    newInstance.flags |= TypeFlags.Instantiable;
    return newInstance;
  }
  export function cloneForScopeId(type: TypeVarType, scopeId: string, scopeName: string) {
    const newInstance: TypeVarType = { ...type };
    newInstance.nameWithScope = makeNameWithScope(type.details.name, scopeId);
    newInstance.scopeId = scopeId;
    newInstance.scopeName = scopeName;
    return newInstance;
  }
  export function cloneForUnpacked(type: TypeVarType) {
    assert(type.details.isVariadic);
    const newInstance: TypeVarType = { ...type };
    newInstance.isVariadicUnpacked = true;
    return newInstance;
  }
  export function cloneForPacked(type: TypeVarType) {
    assert(type.details.isVariadic);
    const newInstance: TypeVarType = { ...type };
    newInstance.isVariadicUnpacked = false;
    return newInstance;
  }
  export function cloneAsInvariant(type: TypeVarType) {
    if (type.details.isParamSpec || type.details.isVariadic) {
      return type;
    }
    if (type.details.variance === Variance.Invariant) {
      if (type.details.boundType === undefined && type.details.constraints.length === 0) {
        return type;
      }
    }
    const newInstance: TypeVarType = { ...type };
    newInstance.details = { ...newInstance.details };
    newInstance.details.variance = Variance.Invariant;
    newInstance.details.boundType = undefined;
    newInstance.details.constraints = [];
    return newInstance;
  }
  export function makeNameWithScope(name: string, scopeId: string) {
    return `${name}.${scopeId}`;
  }
  function create(name: string, isParamSpec: boolean, typeFlags: TypeFlags) {
    const newTypeVarType: TypeVarType = {
      category: TypeCategory.TypeVar,
      details: {
        name,
        constraints: [],
        variance: Variance.Invariant,
        isParamSpec,
        isVariadic: false,
        isSynthesized: false,
      },
      flags: typeFlags,
    };
    return newTypeVarType;
  }
  export function addConstraint(typeVarType: TypeVarType, constraintType: Type) {
    typeVarType.details.constraints.push(constraintType);
  }
  export function getNameWithScope(typeVarType: TypeVarType) {
    return typeVarType.nameWithScope || typeVarType.details.name;
  }
  export function getReadableName(typeVarType: TypeVarType) {
    if (typeVarType.scopeName) {
      return `${typeVarType.details.name}@${typeVarType.scopeName}`;
    }
    return typeVarType.details.name;
  }
}
export function isNever(type: Type): type is NeverType {
  return type.category === TypeCategory.Never;
}
export function isNone(type: Type): type is NoneType {
  return type.category === TypeCategory.None;
}
export function isAny(type: Type): type is AnyType {
  return type.category === TypeCategory.Any;
}
export function isUnknown(type: Type): type is UnknownType {
  return type.category === TypeCategory.Unknown;
}
export function isAnyOrUnknown(type: Type): type is AnyType | UnknownType {
  if (type.category === TypeCategory.Any || type.category === TypeCategory.Unknown) {
    return true;
  }
  if (isUnion(type)) {
    return type.subtypes.find((subtype) => !isAnyOrUnknown(subtype)) === undefined;
  }
  return false;
}
export function isUnbound(type: Type): type is UnboundType {
  return type.category === TypeCategory.Unbound;
}
export function isUnion(type: Type): type is UnionType {
  return type.category === TypeCategory.Union;
}
export function isPossiblyUnbound(type: Type): boolean {
  if (isUnbound(type)) {
    return true;
  }
  if (isUnion(type)) {
    return type.subtypes.find((subtype) => isPossiblyUnbound(subtype)) !== undefined;
  }
  return false;
}
export function isClass(type: Type): type is ClassType {
  return type.category === TypeCategory.Class;
}
export function isObject(type: Type): type is ObjectType {
  return type.category === TypeCategory.Object;
}
export function isModule(type: Type): type is ModuleType {
  return type.category === TypeCategory.Module;
}
export function isTypeVar(type: Type): type is TypeVarType {
  return type.category === TypeCategory.TypeVar;
}
export function isVariadicTypeVar(type: Type): type is TypeVarType {
  return type.category === TypeCategory.TypeVar && type.details.isVariadic;
}
export function isUnpackedVariadicTypeVar(type: Type): boolean {
  if (isUnion(type) && type.subtypes.length === 1) {
    type = type.subtypes[0];
  }
  return type.category === TypeCategory.TypeVar && type.details.isVariadic && !!type.isVariadicUnpacked;
}
export function isParamSpec(type: Type): type is TypeVarType {
  return type.category === TypeCategory.TypeVar && type.details.isParamSpec;
}
export function isFunction(type: Type): type is FunctionType {
  return type.category === TypeCategory.Function;
}
export function isOverloadedFunction(type: Type): type is OverloadedFunctionType {
  return type.category === TypeCategory.OverloadedFunction;
}
export function getTypeAliasInfo(type: Type) {
  if (type.typeAliasInfo) {
    return type.typeAliasInfo;
  }
  if (isTypeVar(type) && type.details.recursiveTypeAliasName && type.details.boundType && type.details.boundType.typeAliasInfo) {
    return type.details.boundType.typeAliasInfo;
  }
  return undefined;
}
export function isTypeSame(type1: Type, type2: Type, recursionCount = 0): boolean {
  if (type1.category !== type2.category) {
    return false;
  }
  if (recursionCount > maxTypeRecursionCount) {
    return true;
  }
  switch (type1.category) {
    case TypeCategory.Class: {
      const classType2 = type2 as ClassType;
      if (!ClassType.isSameGenericClass(type1, classType2, recursionCount + 1)) {
        return false;
      }
      const type1TypeArgs = type1.typeArguments || [];
      const type2TypeArgs = classType2.typeArguments || [];
      const typeArgCount = Math.max(type1TypeArgs.length, type2TypeArgs.length);
      for (let i = 0; i < typeArgCount; i++) {
        const typeArg1 = i < type1TypeArgs.length ? type1TypeArgs[i] : AnyType.create();
        const typeArg2 = i < type2TypeArgs.length ? type2TypeArgs[i] : AnyType.create();
        if (!isTypeSame(typeArg1, typeArg2, recursionCount + 1)) {
          return false;
        }
      }
      const type1TupleTypeArgs = type1.tupleTypeArguments || [];
      const type2TupleTypeArgs = classType2.tupleTypeArguments || [];
      if (type1TupleTypeArgs.length !== type2TupleTypeArgs.length) {
        return false;
      }
      for (let i = 0; i < type1TupleTypeArgs.length; i++) {
        if (!isTypeSame(type1TupleTypeArgs[i], type2TupleTypeArgs[i], recursionCount + 1)) {
          return false;
        }
      }
      if (!ClassType.isLiteralValueSame(type1, classType2)) {
        return false;
      }
      return true;
    }
    case TypeCategory.Object: {
      const objType2 = type2 as ObjectType;
      return isTypeSame(type1.classType, objType2.classType, recursionCount + 1);
    }
    case TypeCategory.Function: {
      const functionType2 = type2 as FunctionType;
      const params1 = type1.details.parameters;
      const params2 = functionType2.details.parameters;
      if (params1.length !== params2.length) {
        return false;
      }
      for (let i = 0; i < params1.length; i++) {
        const param1 = params1[i];
        const param2 = params2[i];
        if (param1.category !== param2.category) {
          return false;
        }
        if (param1.name !== param2.name) {
          return false;
        }
        const param1Type = FunctionType.getEffectiveParameterType(type1, i);
        const param2Type = FunctionType.getEffectiveParameterType(functionType2, i);
        if (!isTypeSame(param1Type, param2Type, recursionCount + 1)) {
          return false;
        }
      }
      let return1Type = type1.details.declaredReturnType;
      if (type1.specializedTypes && type1.specializedTypes.returnType) {
        return1Type = type1.specializedTypes.returnType;
      }
      let return2Type = functionType2.details.declaredReturnType;
      if (functionType2.specializedTypes && functionType2.specializedTypes.returnType) {
        return2Type = functionType2.specializedTypes.returnType;
      }
      if (return1Type || return2Type) {
        if (!return1Type || !return2Type || !isTypeSame(return1Type, return2Type, recursionCount + 1)) {
          return false;
        }
      }
      if (type1.details.declaration !== functionType2.details.declaration) {
        return false;
      }
      return true;
    }
    case TypeCategory.OverloadedFunction: {
      const functionType2 = type2 as OverloadedFunctionType;
      if (type1.overloads.length !== functionType2.overloads.length) {
        return false;
      }
      for (let i = 0; i < type1.overloads.length; i++) {
        if (!isTypeSame(type1.overloads[i], functionType2.overloads[i], recursionCount + 1)) {
          return false;
        }
      }
      return true;
    }
    case TypeCategory.Union: {
      const unionType2 = type2 as UnionType;
      const subtypes1 = type1.subtypes;
      const subtypes2 = unionType2.subtypes;
      if (subtypes1.length !== subtypes2.length) {
        return false;
      }
      return findSubtype(type1, (subtype, constraints) => !UnionType.containsType(unionType2, subtype, constraints, recursionCount + 1)) === undefined;
    }
    case TypeCategory.TypeVar: {
      const type2TypeVar = type2 as TypeVarType;
      if (type1.scopeId !== type2TypeVar.scopeId) {
        return false;
      }
      if (type1.details === type2TypeVar.details) {
        return true;
      }
      if (
        type1.details.name !== type2TypeVar.details.name ||
        type1.details.isParamSpec !== type2TypeVar.details.isParamSpec ||
        type1.details.isVariadic !== type2TypeVar.details.isVariadic ||
        type1.details.isSynthesized !== type2TypeVar.details.isSynthesized ||
        type1.details.variance !== type2TypeVar.details.variance
      ) {
        return false;
      }
      const boundType1 = type1.details.boundType;
      const boundType2 = type2TypeVar.details.boundType;
      if (boundType1) {
        if (!boundType2 || !isTypeSame(boundType1, boundType2, recursionCount + 1)) {
          return false;
        }
      } else {
        if (boundType2) {
          return false;
        }
      }
      const constraints1 = type1.details.constraints;
      const constraints2 = type2TypeVar.details.constraints;
      if (constraints1.length !== constraints2.length) {
        return false;
      }
      for (let i = 0; i < constraints1.length; i++) {
        if (!isTypeSame(constraints1[i], constraints2[i], recursionCount + 1)) {
          return false;
        }
      }
      return true;
    }
    case TypeCategory.Module: {
      const type2Module = type2 as ModuleType;
      if (type1.fields === type2Module.fields) {
        return true;
      }
      if (type1.fields.size === 0 && type2Module.fields.size === 0) {
        return true;
      }
      return false;
    }
  }
  return true;
}
export function removeAnyFromUnion(type: Type): Type {
  return removeFromUnion(type, (t: Type) => isAnyOrUnknown(t));
}
export function removeUnknownFromUnion(type: Type): Type {
  return removeFromUnion(type, (t: Type) => isUnknown(t));
}
export function removeUnbound(type: Type): Type {
  if (isUnion(type)) {
    return removeFromUnion(type, (t: Type) => isUnbound(t));
  }
  if (isUnbound(type)) {
    return UnknownType.create();
  }
  return type;
}
export function removeNoneFromUnion(type: Type): Type {
  return removeFromUnion(type, (t: Type) => isNone(t));
}
export function removeFromUnion(type: Type, removeFilter: (type: Type, constraints: SubtypeConstraints) => boolean) {
  if (isUnion(type)) {
    const remainingTypes: ConstrainedSubtype[] = [];
    type.subtypes.forEach((subtype, index) => {
      const constraints = type.constraints ? type.constraints[index] : undefined;
      if (!removeFilter(subtype, constraints)) {
        remainingTypes.push({ type: subtype, constraints });
      }
    });
    if (remainingTypes.length < type.subtypes.length) {
      return combineConstrainedTypes(remainingTypes);
    }
  }
  return type;
}
export function findSubtype(type: Type, filter: (type: UnionableType | NeverType, constraints: SubtypeConstraints) => boolean) {
  if (isUnion(type)) {
    return type.subtypes.find((subtype, index) => {
      return filter(subtype, type.constraints ? type.constraints[index] : undefined);
    });
  }
  return filter(type, undefined) ? type : undefined;
}
export function isUnionableType(subtypes: Type[]): boolean {
  let typeFlags = TypeFlags.Instance | TypeFlags.Instantiable;
  for (const subtype of subtypes) {
    typeFlags &= subtype.flags;
  }
  return (typeFlags & TypeFlags.Instantiable) !== 0 && (typeFlags & TypeFlags.Instance) === 0;
}
export function combineTypes(types: Type[], maxSubtypeCount?: number): Type {
  return combineConstrainedTypes(
    types.map((type) => {
      return { type, constraints: undefined };
    }),
    maxSubtypeCount
  );
}
export function combineConstrainedTypes(subtypes: ConstrainedSubtype[], maxSubtypeCount?: number): Type {
  subtypes = subtypes.filter((subtype) => subtype.type.category !== TypeCategory.Never);
  if (subtypes.length === 0) {
    return NeverType.create();
  }
  if (subtypes.length === 1 && !subtypes[0].constraints && !isUnpackedVariadicTypeVar(subtypes[0].type)) {
    return subtypes[0].type;
  }
  let expandedTypes: ConstrainedSubtype[] = [];
  for (const constrainedType of subtypes) {
    if (isUnion(constrainedType.type)) {
      const unionType = constrainedType.type;
      unionType.subtypes.forEach((subtype, index) => {
        expandedTypes.push({
          type: subtype,
          constraints: SubtypeConstraint.combine(unionType.constraints ? unionType.constraints[index] : undefined, constrainedType.constraints),
        });
      });
    } else {
      expandedTypes.push({ type: constrainedType.type, constraints: constrainedType.constraints });
    }
  }
  expandedTypes = expandedTypes.sort((constrainedType1, constrainedType2) => {
    const type1 = constrainedType1.type;
    const type2 = constrainedType2.type;
    if ((isObject(type1) && type1.classType.literalValue !== undefined) || (isClass(type1) && type1.literalValue !== undefined)) {
      return 1;
    } else if ((isObject(type2) && type2.classType.literalValue !== undefined) || (isClass(type2) && type2.literalValue !== undefined)) {
      return -1;
    }
    return 0;
  });
  if (expandedTypes.length === 0) {
    return UnknownType.create();
  }
  const newUnionType = UnionType.create();
  let hitMaxSubtypeCount = false;
  expandedTypes.forEach((constrainedType, index) => {
    if (index === 0) {
      UnionType.addType(newUnionType, constrainedType.type as UnionableType, constrainedType.constraints);
    } else {
      if (maxSubtypeCount === undefined || newUnionType.subtypes.length < maxSubtypeCount) {
        _addTypeIfUnique(newUnionType, constrainedType.type as UnionableType, constrainedType.constraints);
      } else {
        hitMaxSubtypeCount = true;
      }
    }
  });
  if (hitMaxSubtypeCount) {
    return AnyType.create();
  }
  if (newUnionType.subtypes.length === 1 && !newUnionType.constraints && !isUnpackedVariadicTypeVar(newUnionType.subtypes[0])) {
    return newUnionType.subtypes[0];
  }
  return newUnionType;
}
export function isSameWithoutLiteralValue(destType: Type, srcType: Type): boolean {
  if (isTypeSame(destType, srcType)) {
    return true;
  }
  if (isClass(srcType) && srcType.literalValue !== undefined) {
    srcType = ClassType.cloneWithLiteral(srcType, undefined);
    return isTypeSame(destType, srcType);
  }
  if (isObject(srcType) && srcType.classType.literalValue !== undefined) {
    srcType = ObjectType.create(ClassType.cloneWithLiteral(srcType.classType, undefined));
    return isTypeSame(destType, srcType);
  }
  return false;
}
function _addTypeIfUnique(unionType: UnionType, typeToAdd: UnionableType, constraintsToAdd: SubtypeConstraints) {
  if (!constraintsToAdd && isObject(typeToAdd)) {
    if (ClassType.isBuiltIn(typeToAdd.classType, 'str') && typeToAdd.classType.literalValue !== undefined && unionType.literalStrMap !== undefined) {
      if (!unionType.literalStrMap.has(typeToAdd.classType.literalValue as string)) {
        UnionType.addType(unionType, typeToAdd, constraintsToAdd);
      }
      return;
    } else if (ClassType.isBuiltIn(typeToAdd.classType, 'int') && typeToAdd.classType.literalValue !== undefined && unionType.literalIntMap !== undefined) {
      if (!unionType.literalIntMap.has(typeToAdd.classType.literalValue as number)) {
        UnionType.addType(unionType, typeToAdd, constraintsToAdd);
      }
      return;
    }
  }
  for (let i = 0; i < unionType.subtypes.length; i++) {
    const type = unionType.subtypes[i];
    const constraints = unionType.constraints ? unionType.constraints[i] : undefined;
    if (!SubtypeConstraint.isSame(constraints, constraintsToAdd)) {
      continue;
    }
    if (isTypeSame(type, typeToAdd)) {
      return;
    }
    if (isObject(type) && isObject(typeToAdd)) {
      if (isSameWithoutLiteralValue(type, typeToAdd)) {
        if (type.classType.literalValue === undefined) {
          return;
        }
      }
      if (ClassType.isBuiltIn(type.classType, 'bool') && ClassType.isBuiltIn(typeToAdd.classType, 'bool')) {
        if (typeToAdd.classType.literalValue !== undefined && !typeToAdd.classType.literalValue === type.classType.literalValue) {
          unionType.subtypes[i] = ObjectType.create(ClassType.cloneWithLiteral(type.classType, undefined));
          return;
        }
      }
    }
  }
  UnionType.addType(unionType, typeToAdd, constraintsToAdd);
}
