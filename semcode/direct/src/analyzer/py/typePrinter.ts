import { ParameterCategory } from '../parser/parseNodes';
import * as ParseTreeUtils from './parseTreeUtils';
import {
  ClassType,
  combineTypes,
  EnumLiteral,
  FunctionType,
  isAnyOrUnknown,
  isClass,
  isObject,
  isParamSpec,
  isUnion,
  isVariadicTypeVar,
  maxTypeRecursionCount,
  ObjectType,
  removeNoneFromUnion,
  Type,
  TypeBase,
  TypeCategory,
  TypeVarType,
} from './types';
import { doForEachSubtype, isOptionalType, isTupleClass } from './typeUtils';

const singleTickRegEx = /'/g;
const tripleTickRegEx = /'''/g;

export const enum PrintTypeFlags {
  None = 0,

  PrintUnknownWithAny = 1 << 0,

  OmitTypeArgumentsIfAny = 1 << 1,

  OmitUnannotatedParamType = 1 << 2,

  PEP604 = 1 << 3,

  ParenthesizeUnion = 1 << 4,
}

export type FunctionReturnTypeCallback = (type: FunctionType) => Type;

export function printType(type: Type, printTypeFlags: PrintTypeFlags, returnTypeCallback: FunctionReturnTypeCallback, expandTypeAlias = false, recursionCount = 0): string {
  const parenthesizeUnion = (printTypeFlags & PrintTypeFlags.ParenthesizeUnion) !== 0;
  printTypeFlags &= ~PrintTypeFlags.ParenthesizeUnion;

  if (recursionCount >= maxTypeRecursionCount) {
    return '...';
  }

  if (type.typeAliasInfo && !expandTypeAlias) {
    let aliasName = type.typeAliasInfo.name;
    const typeParams = type.typeAliasInfo.typeParameters;

    if (typeParams) {
      let argumentStrings: string[] | undefined;

      if (type.typeAliasInfo.typeArguments) {
        if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 || type.typeAliasInfo.typeArguments.some((typeArg) => !isAnyOrUnknown(typeArg))) {
          argumentStrings = [];
          type.typeAliasInfo.typeArguments.forEach((typeArg, index) => {
            const typeParam = index < typeParams.length ? typeParams[index] : typeParams[typeParams.length - 1];

            if (isVariadicTypeVar(typeParam) && isObject(typeArg) && isTupleClass(typeArg.classType) && typeArg.classType.tupleTypeArguments) {
              typeArg.classType.tupleTypeArguments.forEach((tupleTypeArg) => {
                argumentStrings!.push(printType(tupleTypeArg, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1));
              });
            } else {
              argumentStrings!.push(printType(typeArg, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1));
            }
          });
        }
      } else {
        if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 || typeParams.some((typeParam) => !isAnyOrUnknown(typeParam))) {
          argumentStrings = [];
          typeParams.forEach((typeParam) => {
            argumentStrings!.push(printType(typeParam, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1));
          });
        }
      }

      if (argumentStrings) {
        if (argumentStrings.length === 0) {
          aliasName += `[()]`;
        } else {
          aliasName += `[${argumentStrings.join(', ')}]`;
        }
      }
    }

    if (type.category !== TypeCategory.TypeVar) {
      return aliasName;
    }
  }

  switch (type.category) {
    case TypeCategory.Unbound: {
      return 'Unbound';
    }

    case TypeCategory.Unknown: {
      return (printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0 ? 'Any' : 'Unknown';
    }

    case TypeCategory.Module: {
      return `Module("${type.moduleName}")`;
    }

    case TypeCategory.Class: {
      if (type.literalValue !== undefined) {
        return `Type[Literal[${printLiteralValue(type)}]]`;
      }

      return `Type[${printObjectTypeForClass(type, printTypeFlags, returnTypeCallback, recursionCount + 1)}]`;
    }

    case TypeCategory.Object: {
      if (type.classType.literalValue !== undefined) {
        return `Literal[${printLiteralValue(type.classType)}]`;
      }

      return printObjectTypeForClass(type.classType, printTypeFlags, returnTypeCallback, recursionCount + 1);
    }

    case TypeCategory.Function: {
      const parts = printFunctionParts(type, printTypeFlags, returnTypeCallback, recursionCount);
      if (type.details.paramSpec) {
        if (type.details.parameters.length > 0) {
          const paramTypes = type.details.parameters.map((param) => printType(param.type, printTypeFlags, returnTypeCallback));
          return `Callable[Concatenate[${paramTypes.join(', ')}, ${type.details.paramSpec.details.name}], ${parts[1]}]`;
        }
        return `Callable[${type.details.paramSpec.details.name}, ${parts[1]}]`;
      }

      const paramSignature = `(${parts[0].join(', ')})`;
      if (FunctionType.isParamSpecValue(type)) {
        return paramSignature;
      }
      return `${paramSignature} -> ${parts[1]}`;
    }

    case TypeCategory.OverloadedFunction: {
      const overloadedType = type;
      const overloads = overloadedType.overloads.map((overload) => printType(overload, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1));
      return `Overload[${overloads.join(', ')}]`;
    }

    case TypeCategory.Union: {
      if (type.constraints) {
        type = combineTypes(type.subtypes);
      }

      if (isOptionalType(type)) {
        const optionalType = printType(removeNoneFromUnion(type), printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1);

        if (printTypeFlags & PrintTypeFlags.PEP604) {
          return optionalType + ' | None';
        }

        return 'Optional[' + optionalType + ']';
      }

      let subtypes: Type[] = [];
      doForEachSubtype(type, (subtype) => {
        subtypes.push(subtype);
      });

      const isPseudoGeneric = (type: Type) => (isClass(type) && ClassType.isPseudoGenericClass(type)) || (isObject(type) && ClassType.isPseudoGenericClass(type.classType));
      if (subtypes.some((t) => isPseudoGeneric(t))) {
        const filteredSubtypes: Type[] = [];
        subtypes.forEach((type) => {
          if (!isPseudoGeneric(type)) {
            filteredSubtypes.push(type);
          } else if (isClass(type)) {
            if (!filteredSubtypes.some((t) => isClass(t) && ClassType.isSameGenericClass(t, type))) {
              filteredSubtypes.push(type);
            }
          } else if (isObject(type)) {
            if (!filteredSubtypes.some((t) => isObject(t) && ClassType.isSameGenericClass(t.classType, type.classType))) {
              filteredSubtypes.push(type);
            }
          }
        });
        subtypes = filteredSubtypes;
      }

      const isLiteralObject = (type: Type) => isObject(type) && type.classType.literalValue !== undefined;
      const isLiteralClass = (type: Type) => isClass(type) && type.literalValue !== undefined;

      const subtypeStrings: string[] = [];
      while (subtypes.length > 0) {
        const subtype = subtypes.shift()!;
        if (isLiteralObject(subtype)) {
          const literals = subtypes.filter((t) => isLiteralObject(t));
          literals.unshift(subtype);
          const literalValues = literals.map((t) => printLiteralValue((t as ObjectType).classType));
          subtypeStrings.push(`Literal[${literalValues.join(', ')}]`);

          if (literals.length > 1) {
            subtypes = subtypes.filter((t) => !isLiteralObject(t));
          }
        } else if (isLiteralClass(subtype)) {
          const literals = subtypes.filter((t) => isLiteralClass(t));
          literals.unshift(subtype);
          const literalValues = literals.map((t) => printLiteralValue(t as ClassType));
          subtypeStrings.push(`Type[Literal[${literalValues.join(', ')}]]`);

          if (literals.length > 1) {
            subtypes = subtypes.filter((t) => !isLiteralClass(t));
          }
        } else {
          subtypeStrings.push(printType(subtype, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1));
        }
      }

      const redundancyMap = new Map<string, string>();
      const dedupedSubtypeStrings: string[] = [];
      subtypeStrings.forEach((subtype) => {
        if (!redundancyMap.has(subtype)) {
          dedupedSubtypeStrings.push(subtype);
          redundancyMap.set(subtype, subtype);
        }
      });

      if (dedupedSubtypeStrings.length === 1) {
        return dedupedSubtypeStrings[0];
      }

      if (printTypeFlags & PrintTypeFlags.PEP604) {
        const unionString = dedupedSubtypeStrings.join(' | ');
        if (parenthesizeUnion) {
          return `(${unionString})`;
        }
        return unionString;
      }

      return `Union[${dedupedSubtypeStrings.join(', ')}]`;
    }

    case TypeCategory.TypeVar: {
      if (type.details.isSynthesized) {
        if (type.details.recursiveTypeAliasName) {
          if (expandTypeAlias && type.details.boundType) {
            return printType(type.details.boundType, printTypeFlags, returnTypeCallback, expandTypeAlias, recursionCount + 1);
          }
          return type.details.recursiveTypeAliasName;
        }

        if (type.details.boundType) {
          const boundTypeString = printType(type.details.boundType, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1);

          if (TypeBase.isInstantiable(type)) {
            return `Type[${boundTypeString}]`;
          }

          return boundTypeString;
        }

        return (printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0 ? 'Any' : 'Unknown';
      }

      if (type.details.isParamSpec) {
        return `${TypeVarType.getReadableName(type)}`;
      }

      let typeVarName = TypeVarType.getReadableName(type);

      if (type.isVariadicUnpacked) {
        typeVarName = `*${typeVarName}`;
      }

      if (TypeBase.isInstantiable(type)) {
        return `Type[${typeVarName}]`;
      }

      return typeVarName;
    }

    case TypeCategory.None: {
      return TypeBase.isInstantiable(type) ? 'NoneType' : 'None';
    }

    case TypeCategory.Never: {
      return 'Never';
    }

    case TypeCategory.Any: {
      const anyType = type;
      return anyType.isEllipsis ? '...' : 'Any';
    }
  }

  return '';
}

export function printLiteralValue(type: ClassType): string {
  const literalValue = type.literalValue;
  if (literalValue === undefined) {
    return '';
  }

  let literalStr: string;
  if (typeof literalValue === 'string') {
    const prefix = type.details.name === 'bytes' ? 'b' : '';
    literalStr = literalValue.toString();
    if (literalStr.indexOf('\n') >= 0) {
      literalStr = `${prefix}'''${literalStr.replace(tripleTickRegEx, "\\'\\'\\'")}'''`;
    } else {
      literalStr = `${prefix}'${literalStr.replace(singleTickRegEx, "\\'")}'`;
    }
  } else if (typeof literalValue === 'boolean') {
    literalStr = literalValue ? 'True' : 'False';
  } else if (literalValue instanceof EnumLiteral) {
    literalStr = `${literalValue.className}.${literalValue.itemName}`;
  } else {
    literalStr = literalValue.toString();
  }

  return literalStr;
}

export function printObjectTypeForClass(type: ClassType, printTypeFlags: PrintTypeFlags, returnTypeCallback: FunctionReturnTypeCallback, recursionCount = 0): string {
  let objName = type.aliasName || type.details.name;

  if (!ClassType.isPseudoGenericClass(type)) {
    const typeParams = ClassType.getTypeParameters(type);
    const lastTypeParam = typeParams.length > 0 ? typeParams[typeParams.length - 1] : undefined;
    const isVariadic = lastTypeParam ? lastTypeParam.details.isVariadic : false;

    const typeArgs = type.tupleTypeArguments || type.typeArguments;
    if (typeArgs) {
      if (typeArgs.length > 0) {
        const typeArgStrings: string[] = [];
        let isAllAny = true;

        typeArgs.forEach((typeArg, index) => {
          const typeParam = index < typeParams.length ? typeParams[index] : undefined;
          if (typeParam && typeParam.details.isVariadic && isObject(typeArg) && ClassType.isBuiltIn(typeArg.classType, 'tuple') && typeArg.classType.tupleTypeArguments) {
            if (typeArg.classType.tupleTypeArguments.length === 0) {
              if (!isAnyOrUnknown(typeArg)) {
                isAllAny = false;
              }

              typeArgStrings.push('()');
            } else {
              typeArgStrings.push(
                ...typeArg.classType.tupleTypeArguments!.map((typeArg) => {
                  if (!isAnyOrUnknown(typeArg)) {
                    isAllAny = false;
                  }

                  return printType(typeArg, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1);
                })
              );
            }
          } else {
            if (!isAnyOrUnknown(typeArg)) {
              isAllAny = false;
            }

            typeArgStrings.push(printType(typeArg, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1));
          }
        });

        if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 || !isAllAny) {
          objName += '[' + typeArgStrings.join(', ') + ']';
        }
      } else {
        if (ClassType.isTupleClass(type) || isVariadic) {
          objName += '[()]';
        }
      }
    } else {
      if (typeParams.length > 0) {
        if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 || typeParams.some((typeParam) => !isAnyOrUnknown(typeParam))) {
          objName +=
            '[' +
            typeParams
              .map((typeParam) => {
                return printType(typeParam, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1);
              })
              .join(', ') +
            ']';
        }
      }
    }
  }

  return objName;
}

export function printFunctionParts(type: FunctionType, printTypeFlags: PrintTypeFlags, returnTypeCallback: FunctionReturnTypeCallback, recursionCount = 0): [string[], string] {
  const paramTypeStrings: string[] = [];
  type.details.parameters.forEach((param, index) => {
    if (index === type.details.parameters.length - 1 && param.category === ParameterCategory.VarArgList && isVariadicTypeVar(param.type)) {
      const specializedParamType = FunctionType.getEffectiveParameterType(type, index);
      if (isObject(specializedParamType) && ClassType.isBuiltIn(specializedParamType.classType, 'tuple') && specializedParamType.classType.tupleTypeArguments) {
        specializedParamType.classType.tupleTypeArguments.forEach((paramType, paramIndex) => {
          const paramString = `_p${(index + paramIndex).toString()}: ${printType(paramType, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1)}`;
          paramTypeStrings.push(paramString);
        });
        return;
      }
    }

    let paramString = '';
    if (param.category === ParameterCategory.VarArgList) {
      paramString += '*';
    } else if (param.category === ParameterCategory.VarArgDictionary) {
      paramString += '**';
    }

    if (param.name) {
      paramString += param.name;
    }

    let defaultValueAssignment = '=';
    if (param.name) {
      if (param.hasDeclaredType || param.isTypeInferred) {
        const paramType = FunctionType.getEffectiveParameterType(type, index);
        const paramTypeString = recursionCount < maxTypeRecursionCount ? printType(paramType, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1) : '';
        paramString += ': ' + paramTypeString;

        if (isParamSpec(paramType)) {
          if (param.category === ParameterCategory.VarArgList) {
            paramString += '.args';
          } else if (param.category === ParameterCategory.VarArgDictionary) {
            paramString += '.kwargs';
          }
        }

        defaultValueAssignment = ' = ';
      } else if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0) {
        paramString += ': Unknown';
        defaultValueAssignment = ' = ';
      }
    } else if (param.category === ParameterCategory.Simple) {
      paramString += '/';
    }

    if (param.hasDefault) {
      if (param.defaultValueExpression) {
        paramString += defaultValueAssignment + ParseTreeUtils.printExpression(param.defaultValueExpression);
      } else {
        paramString += defaultValueAssignment + '...';
      }
    }

    paramTypeStrings.push(paramString);
  });

  const returnType = returnTypeCallback(type);
  let returnTypeString =
    recursionCount < maxTypeRecursionCount ? printType(returnType, printTypeFlags | PrintTypeFlags.ParenthesizeUnion, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1) : '';

  if (printTypeFlags & PrintTypeFlags.PEP604 && isUnion(returnType) && recursionCount > 0) {
    returnTypeString = `(${returnTypeString})`;
  }

  return [paramTypeStrings, returnTypeString];
}
