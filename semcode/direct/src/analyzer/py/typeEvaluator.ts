import { CancellationToken } from 'vscode-languageserver';

import { Commands } from '../commands/commands';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { DiagLevel } from '../common/configOptions';
import { assert, fail } from '../common/debug';
import { AddMissingOptionalToParamAction, Diag, DiagAddendum } from '../common/diagnostic';
import { DiagRule } from '../common/diagnosticRules';
import { LogTracker } from '../common/logTracker';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { getEmptyRange, TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
  ArgumentCategory,
  ArgumentNode,
  AssignmentNode,
  AugmentedAssignmentNode,
  BinaryOpNode,
  CallNode,
  CaseNode,
  ClassNode,
  ConstantNode,
  DecoratorNode,
  DictionaryNode,
  ExceptNode,
  ExpressionNode,
  ForNode,
  FunctionNode,
  ImportAsNode,
  ImportFromAsNode,
  ImportFromNode,
  IndexNode,
  isExpressionNode,
  LambdaNode,
  ListComprehensionNode,
  ListNode,
  MemberAccessNode,
  NameNode,
  ParameterCategory,
  ParameterNode,
  ParseNode,
  ParseNodeType,
  PatternAsNode,
  PatternAtomNode,
  PatternClassArgumentNode,
  PatternClassNode,
  PatternLiteralNode,
  PatternMappingNode,
  PatternSequenceNode,
  PatternValueNode,
  RaiseNode,
  SetNode,
  SliceNode,
  StringListNode,
  TernaryNode,
  TupleNode,
  TypeAnnotationNode,
  UnaryOpNode,
  WithItemNode,
  YieldFromNode,
  YieldNode,
} from '../parser/parseNodes';
import { ParseOptions, Parser } from '../parser/parser';
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import * as DeclarationUtils from './aliasDeclarationUtils';
import { AnalyzerFileInfo, ImportLookup } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import {
  CodeFlowReferenceExpressionNode,
  createKeyForReference,
  FlowAssignment,
  FlowAssignmentAlias,
  FlowCall,
  FlowCondition,
  FlowFlags,
  FlowLabel,
  FlowNode,
  FlowPostContextMgrLabel,
  FlowPostFinally,
  FlowPreFinallyGate,
  FlowVariableAnnotation,
  FlowWildcardImport,
  isCodeFlowSupportedForReference,
} from './codeFlow';
import { AliasDeclaration, ClassDeclaration, Declaration, DeclarationType, FunctionDeclaration, ModuleLoaderActions, VariableDeclaration } from './declaration';
import { isExplicitTypeAliasDeclaration, isPossibleTypeAliasDeclaration } from './declarationUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateOrProtectedName, isSingleDunderName } from './symbolNameUtils';
import { getLastTypedDeclaredForSymbol, isFinalVariable, isNotRequiredTypedDictVariable, isRequiredTypedDictVariable } from './symbolUtils';
import { PrintableType, TracePrinter } from './tracePrinter';
import { CachedType, IncompleteType, IncompleteTypeTracker, isIncompleteType, SpeculativeTypeTracker, TypeCache } from './typeCache';
import * as TypePrinter from './typePrinter';
import {
  AnyType,
  ClassType,
  ClassTypeFlags,
  combineConstrainedTypes,
  combineTypes,
  ConstrainedSubtype,
  DataClassEntry,
  EnumLiteral,
  findSubtype,
  FunctionParameter,
  FunctionType,
  FunctionTypeFlags,
  InheritanceChain,
  isAny,
  isAnyOrUnknown,
  isClass,
  isFunction,
  isModule,
  isNever,
  isNone,
  isObject,
  isOverloadedFunction,
  isParamSpec,
  isPossiblyUnbound,
  isTypeSame,
  isTypeVar,
  isUnbound,
  isUnion,
  isUnionableType,
  isUnknown,
  isVariadicTypeVar,
  LiteralValue,
  maxTypeRecursionCount,
  ModuleType,
  NeverType,
  NoneType,
  ObjectType,
  OverloadedFunctionType,
  ParamSpecEntry,
  removeNoneFromUnion,
  removeUnbound,
  SubtypeConstraint,
  SubtypeConstraints,
  Type,
  TypeBase,
  TypeCategory,
  TypedDictEntry,
  TypeSourceId,
  TypeVarScopeId,
  TypeVarType,
  UnboundType,
  UnknownType,
  Variance,
  WildcardTypeVarScopeId,
} from './types';
import {
  addTypeVarsToListIfUnique,
  applySolvedTypeVars,
  areTypesSame,
  buildTypeVarMapFromSpecializedClass,
  CanAssignFlags,
  canBeFalsy,
  canBeTruthy,
  ClassMember,
  ClassMemberLookupFlags,
  combineSameSizedTuples,
  computeMroLinearization,
  containsLiteralType,
  containsUnknown,
  convertToInstance,
  convertToInstantiable,
  derivesFromClassRecursive,
  doForEachSubtype,
  getDeclaredGeneratorReturnType,
  getDeclaredGeneratorSendType,
  getGeneratorTypeArgs,
  getSpecializedTupleType,
  getTypeVarArgumentsRecursive,
  getTypeVarScopeId,
  isEllipsisType,
  isLiteralType,
  isLiteralTypeOrUnion,
  isNoReturnType,
  isOpenEndedTupleClass,
  isOptionalType,
  isPartlyUnknown,
  isProperty,
  isTupleClass,
  isTypeAliasPlaceholder,
  isTypeAliasRecursive,
  lookUpClassMember,
  lookUpObjectMember,
  mapSubtypes,
  partiallySpecializeType,
  removeFalsinessFromType,
  removeNoReturnFromUnion,
  removeTruthinessFromType,
  requiresSpecialization,
  requiresTypeArguments,
  selfSpecializeClassType,
  setTypeArgumentsRecursive,
  specializeClassType,
  specializeForBaseClass,
  specializeTupleClass,
  stripLiteralValue,
  transformExpectedTypeForConstructor,
  transformPossibleRecursiveTypeAlias,
  transformTypeObjectToClass,
} from './typeUtils';
import { TypeVarMap } from './typeVarMap';

interface TypeResult {
  type: Type;
  node: ParseNode;

  typeErrors?: boolean;

  isEmptyTupleShorthand?: boolean;

  isIncomplete?: boolean;

  unpackedType?: Type;
  typeList?: TypeResult[];
  expectedTypeDiagAddendum?: DiagAddendum;

  bindToType?: ClassType | ObjectType | TypeVarType;
}

interface EffectiveTypeResult {
  type: Type;
  isIncomplete: boolean;
  includesVariableDecl: boolean;
  isRecursiveDefinition: boolean;
}

interface EffectiveTypeCacheEntry {
  usageNodeId: number | undefined;
  useLastDecl: boolean;
  result: EffectiveTypeResult;
}

interface FunctionArgument {
  argumentCategory: ArgumentCategory;
  node?: ArgumentNode;
  name?: NameNode;
  type?: Type;
  valueExpression?: ExpressionNode;
  active?: boolean;
}

interface ValidateArgTypeParams {
  paramCategory: ParameterCategory;
  paramType: Type;
  requiresTypeVarMatching: boolean;
  argument: FunctionArgument;
  errorNode: ExpressionNode;
  paramName?: string;
  mapsToVarArgList?: boolean;
}

interface ClassMemberLookup {
  type: Type;
  isTypeIncomplete: boolean;

  isClassMember: boolean;
}

interface AbstractMethod {
  symbol: Symbol;
  symbolName: string;
  classType: Type;
  isAbstract: boolean;
}

type TypeNarrowingCallback = (type: Type) => Type | undefined;

interface SequencePatternInfo {
  subtype: Type;
  entryTypes: Type[];
  isIndeterminateLength: boolean;
  isTuple: boolean;
}

interface MappingPatternInfo {
  subtype: Type;
  typedDict?: ClassType;
  dictTypeArgs?: {
    key: Type;
    value: Type;
  };
}

export const enum EvaluatorFlags {
  None = 0,

  ConvertEllipsisToAny = 1 << 0,

  DoNotSpecialize = 1 << 1,

  AllowForwardReferences = 1 << 2,

  EvaluateStringLiteralAsType = 1 << 3,

  FinalDisallowed = 1 << 4,

  ParamSpecDisallowed = 1 << 5,

  ExpectingType = 1 << 6,

  TypeVarTupleDisallowed = 1 << 7,

  ConvertEllipsisToUnknown = 1 << 8,

  GenericClassTypeAllowed = 1 << 9,

  ExpectingTypeAnnotation = 1 << 10,

  DisallowTypeVarsWithScopeId = 1 << 11,

  DisallowTypeVarsWithoutScopeId = 1 << 12,

  AssociateTypeVarsWithCurrentScope = 1 << 13,

  SkipUnboundCheck = 1 << 14,
}

interface EvaluatorUsage {
  method: 'get' | 'set' | 'del';

  setType?: Type;
  setErrorNode?: ExpressionNode;
  setExpectedTypeDiag?: DiagAddendum;
}

interface AliasMapEntry {
  alias: string;
  module: 'builtins' | 'collections' | 'self';
}

export const enum MemberAccessFlags {
  None = 0,

  AccessClassMembersOnly = 1 << 0,

  SkipBaseClasses = 1 << 1,

  SkipObjectBaseClass = 1 << 2,

  DisallowClassVarWrites = 1 << 3,

  TreatConstructorAsClassMethod = 1 << 4,

  ConsiderMetaclassOnly = 1 << 5,

  SkipAttributeAccessOverride = 1 << 6,
}

interface ParamAssignmentInfo {
  argsNeeded: number;
  argsReceived: number;
}

export type SetAnalysisChangedCallback = (reason: string) => void;

const binaryOperatorMap: { [operator: number]: [string, string, boolean] } = {
  [OperatorType.Add]: ['__add__', '__radd__', false],
  [OperatorType.Subtract]: ['__sub__', '__rsub__', false],
  [OperatorType.Multiply]: ['__mul__', '__rmul__', false],
  [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__', false],
  [OperatorType.Divide]: ['__truediv__', '__rtruediv__', false],
  [OperatorType.Mod]: ['__mod__', '__rmod__', false],
  [OperatorType.Power]: ['__pow__', '__rpow__', false],
  [OperatorType.MatrixMultiply]: ['__matmul__', '__rmatmul__', false],
  [OperatorType.BitwiseAnd]: ['__and__', '__rand__', false],
  [OperatorType.BitwiseOr]: ['__or__', '__ror__', false],
  [OperatorType.BitwiseXor]: ['__xor__', '__rxor__', false],
  [OperatorType.LeftShift]: ['__lshift__', '__rlshift__', false],
  [OperatorType.RightShift]: ['__rshift__', '__rrshift__', false],
  [OperatorType.Equals]: ['__eq__', '__ne__', true],
  [OperatorType.NotEquals]: ['__ne__', '__eq__', true],
  [OperatorType.LessThan]: ['__lt__', '__gt__', true],
  [OperatorType.LessThanOrEqual]: ['__le__', '__ge__', true],
  [OperatorType.GreaterThan]: ['__gt__', '__lt__', true],
  [OperatorType.GreaterThanOrEqual]: ['__ge__', '__le__', true],
};

const booleanOperatorMap: { [operator: number]: boolean } = {
  [OperatorType.And]: false,
  [OperatorType.Or]: false,
  [OperatorType.Is]: true,
  [OperatorType.IsNot]: true,
  [OperatorType.In]: true,
  [OperatorType.NotIn]: true,
};

const nonSubscriptableBuiltinTypes: { [builtinName: string]: PythonVersion } = {
  'asyncio.futures.Future': PythonVersion.V3_9,
  'builtins.dict': PythonVersion.V3_9,
  'builtins.frozenset': PythonVersion.V3_9,
  'builtins.list': PythonVersion.V3_9,
  'builtins._PathLike': PythonVersion.V3_9,
  'builtins.set': PythonVersion.V3_9,
  'builtins.tuple': PythonVersion.V3_9,
  'collections.ChainMap': PythonVersion.V3_9,
  'collections.Counter': PythonVersion.V3_9,
  'collections.defaultdict': PythonVersion.V3_9,
  'collections.DefaultDict': PythonVersion.V3_9,
  'collections.deque': PythonVersion.V3_9,
  'collections.OrderedDict': PythonVersion.V3_9,
  'queue.Queue': PythonVersion.V3_9,
};

const typePromotions: { [destType: string]: string[] } = {
  'builtins.float': ['builtins.int'],
  'builtins.complex': ['builtins.float', 'builtins.int'],
  'builtins.bytes': ['builtins.bytearray', 'builtins.memoryview'],
};

export interface ClassTypeResult {
  classType: ClassType;
  decoratedType: Type;
}

export interface FunctionTypeResult {
  functionType: FunctionType;
  decoratedType: Type;
}

export interface CallSignature {
  type: FunctionType;
  activeParam?: FunctionParameter;
}

export interface CallSignatureInfo {
  signatures: CallSignature[];
  callNode: CallNode;
}

export interface CallResult {
  returnType?: Type;
  isTypeIncomplete?: boolean;
  argumentErrors: boolean;
  activeParam?: FunctionParameter;
  overloadUsed?: FunctionType;
}

export interface ArgResult {
  isCompatible: boolean;
  isTypeIncomplete?: boolean;
}

export interface TypeEvaluator {
  runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;

  getType: (node: ExpressionNode) => Type | undefined;
  getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
  getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
  evaluateTypesForStatement: (node: ParseNode) => void;

  getDeclaredTypeForExpression: (expression: ExpressionNode) => Type | undefined;
  verifyRaiseExceptionType: (node: RaiseNode) => void;
  verifyDeleteExpression: (node: ExpressionNode) => void;

  isAfterNodeReachable: (node: ParseNode) => boolean;
  isNodeReachable: (node: ParseNode) => boolean;
  suppressDiags: (node: ParseNode, callback: () => void) => void;

  getDeclarationsForNameNode: (node: NameNode) => Declaration[] | undefined;
  getTypeForDeclaration: (declaration: Declaration) => Type | undefined;
  resolveAliasDeclaration: (declaration: Declaration, resolveLocalNames: boolean) => Declaration | undefined;
  getTypeFromIterable: (type: Type, isAsync: boolean, errorNode: ParseNode | undefined) => Type | undefined;
  getTypeFromIterator: (type: Type, isAsync: boolean, errorNode: ParseNode | undefined) => Type | undefined;
  getTypedDictMembersForClass: (classType: ClassType, allowNarrowed: boolean) => Map<string, TypedDictEntry>;
  getGetterTypeFromProperty: (propertyClass: ClassType, inferTypeIfNeeded: boolean) => Type | undefined;
  markNamesAccessed: (node: ParseNode, names: string[]) => void;
  getScopeIdForNode: (node: ParseNode) => string;
  makeTopLevelTypeVarsConcrete: (type: Type) => Type;

  getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
  getFunctionDeclaredReturnType: (node: FunctionNode) => Type | undefined;
  getFunctionInferredReturnType: (type: FunctionType) => Type;
  getBuiltInType: (node: ParseNode, name: string) => Type;
  getTypeOfMember: (member: ClassMember) => Type;
  bindFunctionToClassOrObject: (baseType: ClassType | ObjectType | undefined, memberType: FunctionType | OverloadedFunctionType) => FunctionType | OverloadedFunctionType | undefined;
  getCallSignatureInfo: (node: CallNode, activeIndex: number, activeOrFake: boolean) => CallSignatureInfo | undefined;
  getTypeAnnotationForParameter: (node: FunctionNode, paramIndex: number) => ExpressionNode | undefined;

  canAssignType: (destType: Type, srcType: Type, diag: DiagAddendum, typeVarMap?: TypeVarMap, flags?: CanAssignFlags) => boolean;
  canOverrideMethod: (baseMethod: Type, overrideMethod: FunctionType, diag: DiagAddendum) => boolean;
  canAssignProtocolClassToSelf: (destType: ClassType, srcType: ClassType) => boolean;

  addError: (message: string, node: ParseNode) => Diag | undefined;
  addWarning: (message: string, node: ParseNode) => Diag | undefined;
  addInformation: (message: string, node: ParseNode) => Diag | undefined;
  addUnusedCode: (node: ParseNode, textRange: TextRange) => void;

  addDiag: (diagLevel: DiagLevel, rule: string, message: string, node: ParseNode) => Diag | undefined;
  addDiagForTextRange: (fileInfo: AnalyzerFileInfo, diagLevel: DiagLevel, rule: string, message: string, range: TextRange) => Diag | undefined;

  printType: (type: Type, expandTypeAlias: boolean) => string;
  printFunctionParts: (type: FunctionType) => [string[], string];

  getTypeCacheSize: () => number;
}

interface CodeFlowAnalyzer {
  getTypeFromCodeFlow: (flowNode: FlowNode, reference: CodeFlowReferenceExpressionNode | undefined, targetSymbolId: number | undefined, initialType: Type | undefined) => FlowNodeTypeResult;
}

interface FlowNodeTypeResult {
  type: Type | undefined;
  isIncomplete: boolean;
  generationCount?: number;
  incompleteType?: Type;
  incompleteSubtypes?: (Type | undefined)[];
}

interface SymbolResolutionStackEntry {
  symbolId: number;
  declaration: Declaration;

  isResultValid: boolean;

  partialType?: Type;
}

interface ReturnTypeInferenceContext {
  functionNode: FunctionNode;
  codeFlowAnalyzer: CodeFlowAnalyzer;
}

const maxReturnTypeInferenceStackSize = 3;

const maxReturnTypeInferenceArgumentCount = 6;

const maxEntriesToUseForInference = 64;

const maxSubtypesForInferredType = 64;

export interface EvaluatorOptions {
  disableInferenceForPyTypedSources: boolean;
  printTypeFlags: TypePrinter.PrintTypeFlags;
  logCalls: boolean;
  minimumLoggingThreshold: number;
}

export function createTypeEvaluator(importLookup: ImportLookup, evaluatorOptions: EvaluatorOptions, logger: LogTracker, printer?: TracePrinter): TypeEvaluator {
  const symbolResolutionStack: SymbolResolutionStackEntry[] = [];
  const isReachableRecursionMap = new Map<number, true>();
  const functionRecursionMap = new Map<number, true>();
  const callIsNoReturnCache = new Map<number, boolean>();
  const isExceptionContextMgrCache = new Map<number, boolean>();
  const codeFlowAnalyzerCache = new Map<number, CodeFlowAnalyzer>();
  const typeCache: TypeCache = new Map<number, CachedType>();
  const speculativeTypeTracker = new SpeculativeTypeTracker();
  const effectiveTypeCache = new Map<number, EffectiveTypeCacheEntry[]>();
  const suppressedNodeStack: ParseNode[] = [];
  const incompleteTypeTracker = new IncompleteTypeTracker();
  let cancellationToken: CancellationToken | undefined;
  let flowIncompleteGeneration = 1;
  let initializedBasicTypes = false;
  let noneType: Type | undefined;
  let objectType: Type | undefined;
  let typeClassType: Type | undefined;
  let tupleClassType: Type | undefined;
  let incompleteTypeCache: TypeCache | undefined;

  const returnTypeInferenceContextStack: ReturnTypeInferenceContext[] = [];
  let returnTypeInferenceTypeCache: TypeCache | undefined;

  function logInternalCall<T>(title: string, callback: () => T, value: PrintableType): T {
    return logger.log(
      title,
      (logState) => {
        logState.add(printer?.print(value));
        return callback();
      },
      evaluatorOptions.minimumLoggingThreshold
    );
  }

  function runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T {
    try {
      cancellationToken = token;
      return callback();
    } finally {
      cancellationToken = undefined;
    }
  }

  function checkForCancellation() {
    if (cancellationToken) {
      throwIfCancellationRequested(cancellationToken);
    }
  }

  function getTypeCacheSize(): number {
    return typeCache.size;
  }

  function readTypeCache(node: ParseNode): Type | undefined {
    let cachedType: CachedType | undefined;

    if (returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node)) {
      cachedType = returnTypeInferenceTypeCache.get(node.id);
    } else {
      cachedType = typeCache.get(node.id);
    }

    if (cachedType === undefined) {
      return undefined;
    }

    assert(!isIncompleteType(cachedType));
    return cachedType as Type;
  }

  function writeTypeCache(node: ParseNode, type: Type, isIncomplete: boolean, expectedType?: Type, allowSpeculativeCaching = false) {
    if (isIncomplete) {
      if (incompleteTypeCache) {
        incompleteTypeCache.set(node.id, type);
      }
      return;
    }

    const typeCacheToUse = returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node) ? returnTypeInferenceTypeCache : typeCache;

    typeCacheToUse.set(node.id, type);

    if (speculativeTypeTracker.isSpeculative(node)) {
      speculativeTypeTracker.trackEntry(typeCacheToUse, node.id);
      if (allowSpeculativeCaching) {
        speculativeTypeTracker.addSpeculativeType(node, type, expectedType);
      }
    }

    incompleteTypeTracker.trackEntry(typeCacheToUse, node.id);
  }

  function deleteTypeCacheEntry(node: ParseNode) {
    const typeCacheToUse = returnTypeInferenceTypeCache && isNodeInReturnTypeInferenceContext(node) ? returnTypeInferenceTypeCache : typeCache;

    typeCacheToUse.delete(node.id);
  }

  function isNodeInReturnTypeInferenceContext(node: ParseNode) {
    const stackSize = returnTypeInferenceContextStack.length;
    if (stackSize === 0) {
      return false;
    }

    const contextNode = returnTypeInferenceContextStack[stackSize - 1];

    let curNode: ParseNode | undefined = node;
    while (curNode) {
      if (curNode === contextNode.functionNode) {
        return true;
      }
      curNode = curNode.parent;
    }

    return false;
  }

  function getCodeFlowAnalyzerForReturnTypeInferenceContext() {
    const stackSize = returnTypeInferenceContextStack.length;
    assert(stackSize > 0);
    const contextNode = returnTypeInferenceContextStack[stackSize - 1];
    return contextNode.codeFlowAnalyzer;
  }

  function getIndexOfSymbolResolution(symbol: Symbol, declaration: Declaration) {
    return symbolResolutionStack.findIndex((entry) => entry.symbolId === symbol.id && entry.declaration === declaration);
  }

  function pushSymbolResolution(symbol: Symbol, declaration: Declaration) {
    const index = getIndexOfSymbolResolution(symbol, declaration);
    if (index >= 0) {
      for (let i = index + 1; i < symbolResolutionStack.length; i++) {
        symbolResolutionStack[i].isResultValid = false;
      }
      return false;
    }

    symbolResolutionStack.push({
      symbolId: symbol.id,
      declaration,
      isResultValid: true,
    });
    return true;
  }

  function popSymbolResolution(symbol: Symbol) {
    const poppedEntry = symbolResolutionStack.pop()!;
    assert(poppedEntry.symbolId === symbol.id);
    return poppedEntry.isResultValid;
  }

  function setSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration, type: Type) {
    const index = getIndexOfSymbolResolution(symbol, declaration);
    if (index >= 0) {
      symbolResolutionStack[index].partialType = type;
    }
  }

  function getSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration): Type | undefined {
    const index = getIndexOfSymbolResolution(symbol, declaration);
    if (index >= 0) {
      return symbolResolutionStack[index].partialType;
    }

    return undefined;
  }

  function getType(node: ExpressionNode): Type | undefined {
    return evaluateTypeForSubnode(node, () => {
      evaluateTypesForExpressionInContext(node);
    })?.type;
  }

  const getTypeOfExpression = evaluatorOptions.logCalls
    ? (n: ExpressionNode, t?: Type, f = EvaluatorFlags.None) => logInternalCall('getTypeOfExpression', () => getTypeOfExpressionInternal(n, t, f), n)
    : getTypeOfExpressionInternal;

  function getTypeOfExpressionInternal(node: ExpressionNode, expectedType?: Type, flags = EvaluatorFlags.None): TypeResult {
    const cachedType = readTypeCache(node);
    if (cachedType) {
      return { type: cachedType, node };
    } else {
      const speculativeCachedType = speculativeTypeTracker.getSpeculativeType(node, expectedType);
      if (speculativeCachedType) {
        return { type: speculativeCachedType, node };
      }
    }

    checkForCancellation();

    const expectedTypeAlt = transformPossibleRecursiveTypeAlias(expectedType);

    if (!initializedBasicTypes) {
      noneType = getTypeshedType(node, 'NoneType') || AnyType.create();
      objectType = getBuiltInObject(node, 'object') || AnyType.create();
      typeClassType = getBuiltInType(node, 'type') || AnyType.create();
      tupleClassType = getBuiltInType(node, 'tuple') || AnyType.create();

      initializedBasicTypes = true;
    }

    let typeResult: TypeResult | undefined;
    let reportExpectingTypeErrors = (flags & EvaluatorFlags.ExpectingType) !== 0;

    switch (node.nodeType) {
      case ParseNodeType.Name: {
        typeResult = getTypeFromName(node, flags);
        break;
      }

      case ParseNodeType.MemberAccess: {
        typeResult = getTypeFromMemberAccess(node, flags);

        if (!isTypeAliasPlaceholder(typeResult.type)) {
          writeTypeCache(node.memberName, typeResult.type, !!typeResult.isIncomplete);
        }
        break;
      }

      case ParseNodeType.Index: {
        typeResult = getTypeFromIndex(node, flags);
        break;
      }

      case ParseNodeType.Call: {
        if ((flags & EvaluatorFlags.ExpectingTypeAnnotation) !== 0) {
          addDiag(getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeAnnotationCall(), node);
          typeResult = { node, type: UnknownType.create() };
        } else {
          typeResult = getTypeFromCall(node, expectedTypeAlt);
        }
        break;
      }

      case ParseNodeType.Tuple: {
        typeResult = getTypeFromTuple(node, expectedTypeAlt, flags);
        break;
      }

      case ParseNodeType.Constant: {
        typeResult = getTypeFromConstant(node, flags);
        break;
      }

      case ParseNodeType.StringList: {
        const expectingType = (flags & EvaluatorFlags.EvaluateStringLiteralAsType) !== 0 && !isAnnotationLiteralValue(node);

        if (expectingType) {
          if (node.typeAnnotation) {
            typeResult = getTypeOfExpression(node.typeAnnotation, undefined, flags | EvaluatorFlags.AllowForwardReferences | EvaluatorFlags.ExpectingType);
          } else if (!node.typeAnnotation && node.strings.length === 1) {
            const expr = parseStringAsTypeAnnotation(node);
            if (expr) {
              typeResult = getTypeOfExpression(expr, undefined, flags | EvaluatorFlags.AllowForwardReferences | EvaluatorFlags.ExpectingType);
            }
          }

          if (!typeResult) {
            const fileInfo = getFileInfo(node);
            addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.expectedTypeNotString(), node);
            typeResult = { node, type: UnknownType.create() };
          }

          reportExpectingTypeErrors = false;
        } else {
          node.strings.forEach((str) => {
            if (str.nodeType === ParseNodeType.FormatString) {
              str.expressions.forEach((expr) => {
                getTypeOfExpression(expr);
              });
            }
          });

          const isBytes = (node.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;

          if (node.strings.some((str) => str.nodeType === ParseNodeType.FormatString)) {
            typeResult = {
              node,
              type: getBuiltInObject(node, isBytes ? 'bytes' : 'str'),
            };
          } else {
            typeResult = {
              node,
              type: cloneBuiltinObjectWithLiteral(node, isBytes ? 'bytes' : 'str', node.strings.map((s) => s.value).join('')),
            };
          }
        }
        break;
      }

      case ParseNodeType.Number: {
        if (node.isImaginary) {
          typeResult = { node, type: getBuiltInObject(node, 'complex') };
        } else if (node.isInteger) {
          typeResult = { node, type: cloneBuiltinObjectWithLiteral(node, 'int', node.value) };
        } else {
          typeResult = { node, type: getBuiltInObject(node, 'float') };
        }
        break;
      }

      case ParseNodeType.Ellipsis: {
        if ((flags & EvaluatorFlags.ConvertEllipsisToAny) !== 0) {
          typeResult = { type: AnyType.create(/* isEllipsis */ true), node };
        } else if ((flags & EvaluatorFlags.ConvertEllipsisToUnknown) !== 0) {
          typeResult = { type: UnknownType.create(), node };
        } else {
          const ellipsisType = getBuiltInObject(node, 'ellipsis') || AnyType.create();
          typeResult = { type: ellipsisType, node };
        }
        break;
      }

      case ParseNodeType.UnaryOp: {
        typeResult = getTypeFromUnaryOp(node, expectedTypeAlt);
        break;
      }

      case ParseNodeType.BinaryOp: {
        typeResult = getTypeFromBinaryOp(node, expectedTypeAlt, flags);
        break;
      }

      case ParseNodeType.AugmentedAssignment: {
        typeResult = getTypeFromAugmentedAssignment(node, expectedTypeAlt);
        assignTypeToExpression(node.destExpression, typeResult.type, !!typeResult.isIncomplete, node.rightExpression);
        break;
      }

      case ParseNodeType.List: {
        typeResult = getTypeFromList(node, expectedTypeAlt);
        break;
      }

      case ParseNodeType.Slice: {
        typeResult = getTypeFromSlice(node);
        break;
      }

      case ParseNodeType.Await: {
        typeResult = getTypeOfExpression(node.expression, undefined, flags);
        typeResult = {
          type: getTypeFromAwaitable(typeResult.type, node.expression),
          node,
        };
        break;
      }

      case ParseNodeType.Ternary: {
        typeResult = getTypeFromTernary(node, flags, expectedTypeAlt);
        break;
      }

      case ParseNodeType.ListComprehension: {
        typeResult = getTypeFromListComprehension(node);
        break;
      }

      case ParseNodeType.Dictionary: {
        typeResult = getTypeFromDictionary(node, expectedTypeAlt);
        break;
      }

      case ParseNodeType.Lambda: {
        typeResult = getTypeFromLambda(node, expectedTypeAlt);
        break;
      }

      case ParseNodeType.Set: {
        typeResult = getTypeFromSet(node, expectedTypeAlt);
        break;
      }

      case ParseNodeType.Assignment: {
        typeResult = getTypeOfExpression(node.rightExpression);
        assignTypeToExpression(node.leftExpression, typeResult.type, /* isTypeIncomplete */ false, node.rightExpression);
        break;
      }

      case ParseNodeType.AssignmentExpression: {
        typeResult = getTypeOfExpression(node.rightExpression);
        assignTypeToExpression(node.name, typeResult.type, /* isTypeIncomplete */ false, node.rightExpression);
        break;
      }

      case ParseNodeType.Yield: {
        typeResult = getTypeFromYield(node);
        break;
      }

      case ParseNodeType.YieldFrom: {
        typeResult = getTypeFromYieldFrom(node);
        break;
      }

      case ParseNodeType.Unpack: {
        let iterExpectedType: Type | undefined;
        if (expectedTypeAlt) {
          const iterableType = getBuiltInType(node, 'Iterable');
          if (iterableType && isClass(iterableType)) {
            iterExpectedType = ObjectType.create(ClassType.cloneForSpecialization(iterableType, [expectedTypeAlt], /* isTypeArgumentExplicit */ true));
          }
        }

        const iterType = getTypeOfExpression(node.expression, iterExpectedType, flags).type;
        if ((flags & EvaluatorFlags.TypeVarTupleDisallowed) === 0 && isVariadicTypeVar(iterType) && !iterType.isVariadicUnpacked) {
          typeResult = { type: TypeVarType.cloneForUnpacked(iterType), node };
        } else {
          const type = getTypeFromIterator(iterType, /* isAsync */ false, node) || UnknownType.create();
          typeResult = { type, unpackedType: iterType, node };
        }
        break;
      }

      case ParseNodeType.TypeAnnotation: {
        typeResult = getTypeOfExpression(
          node.typeAnnotation,
          undefined,
          EvaluatorFlags.EvaluateStringLiteralAsType |
            EvaluatorFlags.ParamSpecDisallowed |
            EvaluatorFlags.TypeVarTupleDisallowed |
            EvaluatorFlags.ExpectingType |
            EvaluatorFlags.ExpectingTypeAnnotation
        );
        break;
      }

      case ParseNodeType.Error: {
        suppressDiags(node, () => {
          if (node.child) {
            getTypeOfExpression(node.child);
          }
        });
        typeResult = { type: UnknownType.create(), node };
        break;
      }
    }

    if (!typeResult) {
      fail(`Unhandled expression type '${ParseTreeUtils.printExpression(node)}'`);
    }

    if (reportExpectingTypeErrors && !typeResult.isIncomplete) {
      const resultType = transformTypeObjectToClass(typeResult.type);

      if (flags & EvaluatorFlags.TypeVarTupleDisallowed) {
        if (isTypeVar(typeResult.type) && typeResult.type.details.isVariadic) {
          addError(Localizer.Diag.typeVarTupleContext(), node);
          typeResult.type = UnknownType.create();
        }
      }

      if (!TypeBase.isInstantiable(resultType)) {
        const isEmptyVariadic = isObject(resultType) && ClassType.isTupleClass(resultType.classType) && resultType.classType.tupleTypeArguments?.length === 0;

        if (!isEmptyVariadic) {
          addExpectedClassDiag(typeResult.type, node);
        }
      }
    }

    if (!isTypeAliasPlaceholder(typeResult.type)) {
      writeTypeCache(node, typeResult.type, !!typeResult.isIncomplete, expectedType, /* allowSpeculativeCaching */ true);
    }

    return typeResult;
  }

  function isAnnotationEvaluationPostponed(fileInfo: AnalyzerFileInfo) {
    return fileInfo.futureImports.get('annotations') !== undefined || fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_10 || fileInfo.isStubFile;
  }

  function getTypeOfAnnotation(node: ExpressionNode, allowFinal = false, associateTypeVarsWithScope = false, allowTypeVarTuple = false): Type {
    const fileInfo = getFileInfo(node);

    if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
      const specialType = handleTypingStubTypeAnnotation(node);
      if (specialType) {
        return specialType;
      }
    }

    let evaluatorFlags =
      EvaluatorFlags.ExpectingType | EvaluatorFlags.ExpectingTypeAnnotation | EvaluatorFlags.ConvertEllipsisToAny | EvaluatorFlags.EvaluateStringLiteralAsType | EvaluatorFlags.ParamSpecDisallowed;

    if (!allowTypeVarTuple) {
      evaluatorFlags |= EvaluatorFlags.TypeVarTupleDisallowed;
    }

    if (isAnnotationEvaluationPostponed(fileInfo)) {
      evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
    }

    if (associateTypeVarsWithScope) {
      evaluatorFlags |= EvaluatorFlags.AssociateTypeVarsWithCurrentScope;
    } else {
      evaluatorFlags |= EvaluatorFlags.DisallowTypeVarsWithoutScopeId;
    }

    if (node?.parent?.nodeType === ParseNodeType.Assignment && node.parent.typeAnnotationComment === node) {
      evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
    } else if (node?.parent?.nodeType === ParseNodeType.FunctionAnnotation) {
      if (node.parent.returnTypeAnnotation === node || node.parent.paramTypeAnnotations.some((n) => n === node)) {
        evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
      }
    } else if (node?.parent?.nodeType === ParseNodeType.Parameter) {
      if (node.parent.typeAnnotationComment === node) {
        evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
      }
    }

    if (!allowFinal) {
      evaluatorFlags |= EvaluatorFlags.FinalDisallowed;
    }

    const classType = getTypeOfExpression(node, /* expectedType */ undefined, evaluatorFlags).type;

    return convertToInstance(classType);
  }

  function getTypeFromDecorator(node: DecoratorNode, functionOrClassType: Type): Type {
    const decoratorTypeResult = getTypeOfExpression(node.expression);

    if (isClass(decoratorTypeResult.type) && ClassType.isBuiltIn(decoratorTypeResult.type, 'classmethod') && isProperty(functionOrClassType)) {
      return functionOrClassType;
    }

    const argList = [
      {
        argumentCategory: ArgumentCategory.Simple,
        type: functionOrClassType,
      },
    ];

    const returnType =
      validateCallArguments(node.expression, argList, decoratorTypeResult.type, /* typeVarMap */ undefined, /* skipUnknownArgCheck */ true, /* expectedType */ undefined).returnType ||
      UnknownType.create();

    if (isFunction(returnType) && !returnType.details.declaredReturnType) {
      if (
        !returnType.details.parameters.some((param, index) => {
          if (!param.name || param.hasDeclaredType) {
            return true;
          }

          if (param.category !== ParameterCategory.Simple) {
            return false;
          }

          return index !== 0 || !param.isTypeInferred;
        })
      ) {
        return functionOrClassType;
      }
    }

    return returnType;
  }

  function getTypeFromObjectMember(
    errorNode: ExpressionNode,
    objectType: ObjectType,
    memberName: string,
    usage: EvaluatorUsage = { method: 'get' },
    diag: DiagAddendum = new DiagAddendum(),
    memberAccessFlags = MemberAccessFlags.None,
    bindToType?: ClassType | ObjectType | TypeVarType
  ): TypeResult | undefined {
    const memberInfo = getTypeFromClassMemberName(errorNode, objectType.classType, memberName, usage, diag, memberAccessFlags | MemberAccessFlags.DisallowClassVarWrites, bindToType);

    if (memberInfo) {
      return { node: errorNode, type: memberInfo.type, isIncomplete: !!memberInfo.isTypeIncomplete };
    }
    return undefined;
  }

  function getTypeFromClassMember(
    errorNode: ExpressionNode,
    classType: ClassType,
    memberName: string,
    usage: EvaluatorUsage = { method: 'get' },
    diag: DiagAddendum = new DiagAddendum(),
    memberAccessFlags = MemberAccessFlags.None,
    bindToType?: ClassType | ObjectType | TypeVarType
  ): TypeResult | undefined {
    let memberInfo: ClassMemberLookup | undefined;

    if (ClassType.isPartiallyConstructed(classType)) {
      addDiag(
        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.Diag.classDefinitionCycle().format({ name: classType.details.name }),
        errorNode
      );
      return { node: errorNode, type: UnknownType.create() };
    }

    if ((memberAccessFlags & MemberAccessFlags.ConsiderMetaclassOnly) === 0) {
      memberInfo = getTypeFromClassMemberName(errorNode, classType, memberName, usage, diag, memberAccessFlags | MemberAccessFlags.AccessClassMembersOnly, bindToType);
    }

    if (!memberInfo) {
      const metaclass = classType.details.effectiveMetaclass;
      if (metaclass && isClass(metaclass) && !ClassType.isSameGenericClass(metaclass, classType)) {
        memberInfo = getTypeFromClassMemberName(errorNode, metaclass, memberName, usage, new DiagAddendum(), memberAccessFlags, classType);
      }
    }

    if (memberInfo) {
      return { node: errorNode, type: memberInfo.type, isIncomplete: !!memberInfo.isTypeIncomplete };
    }
    return undefined;
  }

  function getBoundMethod(classType: ClassType, memberName: string, treatConstructorAsClassMember = false): FunctionType | OverloadedFunctionType | undefined {
    const memberInfo = lookUpClassMember(classType, memberName, ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);

    if (memberInfo) {
      const unboundMethodType = getTypeOfMember(memberInfo);
      if (isFunction(unboundMethodType) || isOverloadedFunction(unboundMethodType)) {
        const boundMethod = bindFunctionToClassOrObject(
          ObjectType.create(classType),
          unboundMethodType,
          /* memberClass */ undefined,
          /* errorNode */ undefined,
          /* recursionCount */ undefined,
          treatConstructorAsClassMember
        );

        if (boundMethod) {
          return boundMethod;
        }
      }
    }

    return undefined;
  }

  function getTypeAnnotationForParameter(node: FunctionNode, paramIndex: number): ExpressionNode | undefined {
    if (paramIndex >= node.parameters.length) {
      return undefined;
    }

    const param = node.parameters[paramIndex];
    if (param.typeAnnotation) {
      return param.typeAnnotation;
    } else if (param.typeAnnotationComment) {
      return param.typeAnnotationComment;
    }

    if (!node.functionAnnotationComment || node.functionAnnotationComment.isParamListEllipsis) {
      return undefined;
    }

    let firstCommentAnnotationIndex = 0;
    const paramAnnotations = node.functionAnnotationComment.paramTypeAnnotations;
    if (paramAnnotations.length < node.parameters.length) {
      firstCommentAnnotationIndex = 1;
    }

    const adjIndex = paramIndex - firstCommentAnnotationIndex;
    if (adjIndex < 0 || adjIndex >= paramAnnotations.length) {
      return undefined;
    }

    return paramAnnotations[adjIndex];
  }

  function getCallSignatureInfo(callNode: CallNode, activeIndex: number, activeOrFake: boolean): CallSignatureInfo | undefined {
    const exprNode = callNode.leftExpression;
    const callType = getType(exprNode);
    if (callType === undefined) {
      return undefined;
    }

    const argList: FunctionArgument[] = [];
    let previousCategory = ArgumentCategory.Simple;

    function addFakeArg() {
      argList.push({
        argumentCategory: previousCategory,
        type: UnknownType.create(),
        active: true,
      });
    }

    callNode.arguments.forEach((arg, index) => {
      let active = false;
      if (index === activeIndex) {
        if (activeOrFake) {
          active = true;
        } else {
          addFakeArg();
        }
      }

      previousCategory = arg.argumentCategory;

      argList.push({
        valueExpression: arg.valueExpression,
        argumentCategory: arg.argumentCategory,
        name: arg.name,
        active: active,
      });
    });

    if (callNode.arguments.length < activeIndex) {
      addFakeArg();
    }

    const signatures: CallSignature[] = [];

    function addOneFunctionToSignature(type: FunctionType) {
      let callResult: CallResult | undefined;

      useSpeculativeMode(callNode!, () => {
        callResult = validateFunctionArguments(exprNode, argList, type, new TypeVarMap(getTypeVarScopeId(type)), /* skipUnknownArgCheck */ true);
      });

      signatures.push({
        type,
        activeParam: callResult?.activeParam,
      });
    }

    function addFunctionToSignature(type: FunctionType | OverloadedFunctionType) {
      if (isFunction(type)) {
        addOneFunctionToSignature(type);
      } else {
        type.overloads.forEach((func) => {
          if (FunctionType.isOverloaded(func)) {
            addOneFunctionToSignature(func);
          }
        });
      }
    }

    doForEachSubtype(callType, (subtype) => {
      switch (subtype.category) {
        case TypeCategory.Function:
        case TypeCategory.OverloadedFunction: {
          addFunctionToSignature(subtype);
          break;
        }

        case TypeCategory.Class: {
          let methodType: FunctionType | OverloadedFunctionType | undefined;

          methodType = getBoundMethod(subtype, '__init__');

          if (!methodType || (isFunction(methodType) && FunctionType.isSkipConstructorCheck(methodType))) {
            methodType = getBoundMethod(subtype, '__new__', /* treatConstructorAsClassMember */ true);
          }

          if (methodType) {
            addFunctionToSignature(methodType);
          }
          break;
        }

        case TypeCategory.Object: {
          const methodType = getBoundMethod(subtype.classType, '__call__');
          if (methodType) {
            addFunctionToSignature(methodType);
          }
          break;
        }
      }
    });

    if (signatures.length === 0) {
      return undefined;
    }

    return {
      callNode,
      signatures,
    };
  }

  function isDeclaredTypeAlias(expression: ExpressionNode): boolean {
    if (expression.nodeType === ParseNodeType.TypeAnnotation) {
      if (expression.valueExpression.nodeType === ParseNodeType.Name) {
        const symbolWithScope = lookUpSymbolRecursive(expression, expression.valueExpression.value, /* honorCodeFlow */ false);
        if (symbolWithScope) {
          const symbol = symbolWithScope.symbol;
          return symbol.getDeclarations().find((decl) => isExplicitTypeAliasDeclaration(decl)) !== undefined;
        }
      }
    }

    return false;
  }

  function getDeclaredTypeForExpression(expression: ExpressionNode): Type | undefined {
    let symbol: Symbol | undefined;
    let classOrObjectBase: ClassType | ObjectType | undefined;
    let memberAccessClass: Type | undefined;

    switch (expression.nodeType) {
      case ParseNodeType.Name: {
        const symbolWithScope = lookUpSymbolRecursive(expression, expression.value, /* honorCodeFlow */ true);
        if (symbolWithScope) {
          symbol = symbolWithScope.symbol;

          if (getDeclaredTypeOfSymbol(symbol) === undefined && symbolWithScope.scope.type === ScopeType.Class) {
            const enclosingClass = ParseTreeUtils.getEnclosingClassOrFunction(expression);
            if (enclosingClass && enclosingClass.nodeType === ParseNodeType.Class) {
              const classTypeInfo = getTypeOfClass(enclosingClass);
              if (classTypeInfo) {
                const classMemberInfo = lookUpClassMember(classTypeInfo.classType, expression.value, ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.DeclaredTypesOnly);
                if (classMemberInfo) {
                  symbol = classMemberInfo.symbol;
                }
              }
            }
          }
        }
        break;
      }

      case ParseNodeType.TypeAnnotation: {
        return getDeclaredTypeForExpression(expression.valueExpression);
      }

      case ParseNodeType.MemberAccess: {
        const baseType = makeTopLevelTypeVarsConcrete(getTypeOfExpression(expression.leftExpression).type);
        let classMemberInfo: ClassMember | undefined;

        if (isObject(baseType)) {
          classMemberInfo = lookUpObjectMember(baseType, expression.memberName.value, ClassMemberLookupFlags.DeclaredTypesOnly);
          classOrObjectBase = baseType;
          memberAccessClass = classMemberInfo?.classType;
        } else if (isClass(baseType)) {
          classMemberInfo = lookUpClassMember(baseType, expression.memberName.value, ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.DeclaredTypesOnly);
          classOrObjectBase = baseType;
          memberAccessClass = classMemberInfo?.classType;
        }

        if (classMemberInfo) {
          symbol = classMemberInfo.symbol;
        }
        break;
      }

      case ParseNodeType.Index: {
        const baseType = getDeclaredTypeForExpression(expression.baseExpression);
        if (baseType && isObject(baseType)) {
          const setItemMember = lookUpClassMember(baseType.classType, '__setitem__');
          if (setItemMember) {
            const setItemType = getTypeOfMember(setItemMember);
            if (isFunction(setItemType)) {
              const boundFunction = bindFunctionToClassOrObject(
                baseType,
                setItemType,
                isClass(setItemMember.classType) ? setItemMember.classType : undefined,
                expression,
                /* recursionCount */ undefined,
                /* treatConstructorAsClassMember */ false
              );
              if (boundFunction && isFunction(boundFunction)) {
                if (boundFunction.details.parameters.length === 2) {
                  const paramType = FunctionType.getEffectiveParameterType(boundFunction, 1);
                  if (!isAnyOrUnknown(paramType)) {
                    return paramType;
                  }
                }
              }
            }
          }
        }
        break;
      }
    }

    if (symbol) {
      let declaredType = getDeclaredTypeOfSymbol(symbol);
      if (declaredType) {
        if (isProperty(declaredType)) {
          const setterInfo = lookUpClassMember((declaredType as ObjectType).classType, 'fset');
          const setter = setterInfo ? getTypeOfMember(setterInfo) : undefined;
          if (!setter || !isFunction(setter) || setter.details.parameters.length < 2) {
            return undefined;
          }

          declaredType = setter.details.parameters[1].type;
        }

        if (classOrObjectBase) {
          if (memberAccessClass && isClass(memberAccessClass)) {
            declaredType = partiallySpecializeType(declaredType, memberAccessClass);
          }

          if (isFunction(declaredType) || isOverloadedFunction(declaredType)) {
            declaredType = bindFunctionToClassOrObject(classOrObjectBase, declaredType, /* memberClass */ undefined, expression);
          }
        }

        return declaredType;
      }
    }

    return undefined;
  }

  function getTypeFromAwaitable(type: Type, errorNode?: ParseNode): Type {
    return mapSubtypes(type, (subtype) => {
      if (isAnyOrUnknown(subtype)) {
        return subtype;
      }

      const generatorReturnType = getReturnTypeFromGenerator(subtype);
      if (generatorReturnType) {
        return generatorReturnType;
      }

      if (isObject(subtype)) {
        const awaitReturnType = getSpecializedReturnType(subtype, '__await__', errorNode);
        if (awaitReturnType) {
          if (isAnyOrUnknown(awaitReturnType)) {
            return awaitReturnType;
          }

          if (isObject(awaitReturnType)) {
            const iterReturnType = getSpecializedReturnType(awaitReturnType, '__iter__', errorNode);

            if (iterReturnType) {
              const generatorReturnType = getReturnTypeFromGenerator(awaitReturnType);
              if (generatorReturnType) {
                return generatorReturnType;
              }
            }
          }
        }
      }

      if (errorNode) {
        const fileInfo = getFileInfo(errorNode);
        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeNotAwaitable().format({ type: printType(subtype) }), errorNode);
      }

      return UnknownType.create();
    });
  }

  function getTypeFromIterator(type: Type, isAsync: boolean, errorNode: ParseNode | undefined): Type | undefined {
    const iterMethodName = isAsync ? '__aiter__' : '__iter__';
    const nextMethodName = isAsync ? '__anext__' : '__next__';
    let isValidIterator = true;

    type = makeTopLevelTypeVarsConcrete(type);

    if (isOptionalType(type)) {
      if (errorNode) {
        addDiag(getFileInfo(errorNode).diagnosticRuleSet.reportOptionalIterable, DiagRule.reportOptionalIterable, Localizer.Diag.noneNotIterable(), errorNode);
      }
      type = removeNoneFromUnion(type);
    }

    const iterableType = mapSubtypes(type, (subtype) => {
      subtype = transformTypeObjectToClass(subtype);

      if (isAnyOrUnknown(subtype)) {
        return subtype;
      }

      const diag = new DiagAddendum();
      if (isObject(subtype) || isClass(subtype)) {
        let iterReturnType: Type | undefined;

        if (isObject(subtype)) {
          iterReturnType = getSpecializedReturnType(subtype, iterMethodName, errorNode);
        } else if (isClass(subtype) && subtype.details.effectiveMetaclass && isClass(subtype.details.effectiveMetaclass)) {
          iterReturnType = getSpecializedReturnType(ObjectType.create(subtype.details.effectiveMetaclass), iterMethodName, errorNode, subtype);
        }

        if (!iterReturnType) {
          if (isObject(subtype)) {
            const getItemReturnType = getSpecializedReturnType(subtype, '__getitem__', errorNode);
            if (getItemReturnType) {
              return getItemReturnType;
            }
          }

          diag.addMessage(Localizer.Diag.methodNotDefined().format({ name: iterMethodName }));
        } else {
          const concreteIterReturnType = makeTopLevelTypeVarsConcrete(iterReturnType);

          if (isAnyOrUnknown(concreteIterReturnType)) {
            return concreteIterReturnType;
          }

          if (isObject(concreteIterReturnType)) {
            const nextReturnType = getSpecializedReturnType(concreteIterReturnType, nextMethodName, errorNode);

            if (!nextReturnType) {
              diag.addMessage(
                Localizer.Diag.methodNotDefinedOnType().format({
                  name: nextMethodName,
                  type: printType(iterReturnType),
                })
              );
            } else {
              if (!isAsync) {
                return nextReturnType;
              }

              return getTypeFromAwaitable(nextReturnType, errorNode);
            }
          } else {
            diag.addMessage(Localizer.Diag.methodReturnsNonObject().format({ name: iterMethodName }));
          }
        }
      }

      if (errorNode) {
        addDiag(
          getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.typeNotIterable().format({ type: printType(subtype) }) + diag.getString(),
          errorNode
        );
      }

      isValidIterator = false;
    });

    return isValidIterator ? iterableType : undefined;
  }

  function getTypeFromIterable(type: Type, isAsync: boolean, errorNode: ParseNode | undefined): Type | undefined {
    const iterMethodName = isAsync ? '__aiter__' : '__iter__';
    let isValidIterable = true;

    type = makeTopLevelTypeVarsConcrete(type);

    if (isOptionalType(type)) {
      if (errorNode) {
        addDiag(getFileInfo(errorNode).diagnosticRuleSet.reportOptionalIterable, DiagRule.reportOptionalIterable, Localizer.Diag.noneNotIterable(), errorNode);
      }
      type = removeNoneFromUnion(type);
    }

    const iterableType = mapSubtypes(type, (subtype) => {
      subtype = transformTypeObjectToClass(subtype);

      if (isAnyOrUnknown(subtype)) {
        return subtype;
      }

      if (isObject(subtype) || isClass(subtype)) {
        let iterReturnType: Type | undefined;

        if (isObject(subtype)) {
          iterReturnType = getSpecializedReturnType(subtype, iterMethodName, errorNode);
        } else if (isClass(subtype) && subtype.details.effectiveMetaclass && isClass(subtype.details.effectiveMetaclass)) {
          iterReturnType = getSpecializedReturnType(ObjectType.create(subtype.details.effectiveMetaclass), iterMethodName, errorNode, subtype);
        }

        if (iterReturnType) {
          return makeTopLevelTypeVarsConcrete(iterReturnType);
        }
      }

      if (errorNode) {
        addDiag(getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeNotIterable().format({ type: printType(subtype) }), errorNode);
      }

      isValidIterable = false;
    });

    return isValidIterable ? iterableType : undefined;
  }

  function synthesizeDataClassMethods(node: ClassNode, classType: ClassType, skipSynthesizeInit: boolean) {
    assert(ClassType.isDataClass(classType));

    const newType = FunctionType.createInstance('__new__', '', '', FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod);
    const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);

    FunctionType.addParameter(newType, {
      category: ParameterCategory.Simple,
      name: 'cls',
      type: classType,
      hasDeclaredType: true,
    });
    FunctionType.addDefaultParameters(newType);
    newType.details.declaredReturnType = ObjectType.create(classType);

    const selfParam: FunctionParameter = {
      category: ParameterCategory.Simple,
      name: 'self',
      type: ObjectType.create(classType),
      hasDeclaredType: true,
    };
    FunctionType.addParameter(initType, selfParam);
    initType.details.declaredReturnType = NoneType.createInstance();

    const localDataClassEntries: DataClassEntry[] = [];
    const fullDataClassEntries: DataClassEntry[] = [];
    const allAncestorsKnown = addInheritedDataClassEntries(classType, fullDataClassEntries);

    if (!allAncestorsKnown) {
      FunctionType.addDefaultParameters(initType);
    }

    type TypeEvaluator = () => Type;
    const localEntryTypeEvaluator: { entry: DataClassEntry; evaluator: TypeEvaluator }[] = [];

    node.suite.statements.forEach((statementList) => {
      if (statementList.nodeType === ParseNodeType.StatementList) {
        statementList.statements.forEach((statement) => {
          let variableNameNode: NameNode | undefined;
          let variableTypeEvaluator: TypeEvaluator | undefined;
          let hasDefaultValue = false;
          let defaultValueExpression: ExpressionNode | undefined;
          let includeInInit = true;

          if (statement.nodeType === ParseNodeType.Assignment) {
            if (statement.leftExpression.nodeType === ParseNodeType.TypeAnnotation && statement.leftExpression.valueExpression.nodeType === ParseNodeType.Name) {
              variableNameNode = statement.leftExpression.valueExpression;
              variableTypeEvaluator = () => getTypeOfAnnotation((statement.leftExpression as TypeAnnotationNode).typeAnnotation, /* allowFinal */ true);
            }

            hasDefaultValue = true;
            defaultValueExpression = statement.rightExpression;

            if (statement.rightExpression.nodeType === ParseNodeType.Call) {
              const callType = getTypeOfExpression(statement.rightExpression.leftExpression).type;
              if (isOverloadedFunction(callType) && callType.overloads[0].details.builtInName === 'field') {
                const initArg = statement.rightExpression.arguments.find((arg) => arg.name?.value === 'init');
                if (initArg && initArg.valueExpression) {
                  const value = evaluateStaticBoolExpression(initArg.valueExpression, getFileInfo(node).executionEnvironment);
                  if (value === false) {
                    includeInInit = false;
                  }
                }

                hasDefaultValue = statement.rightExpression.arguments.some((arg) => arg.name?.value === 'default' || arg.name?.value === 'default_factory');
              }
            }
          } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
            if (statement.valueExpression.nodeType === ParseNodeType.Name) {
              variableNameNode = statement.valueExpression;
              variableTypeEvaluator = () => getTypeOfAnnotation(statement.typeAnnotation, /* allowFinal */ true);
            }
          }

          if (variableNameNode && variableTypeEvaluator) {
            const variableName = variableNameNode.value;

            const variableSymbol = classType.details.fields.get(variableName);
            if (!variableSymbol?.isClassVar()) {
              const dataClassEntry: DataClassEntry = {
                name: variableName,
                hasDefault: hasDefaultValue,
                defaultValueExpression,
                includeInInit,
                type: UnknownType.create(),
              };
              localEntryTypeEvaluator.push({ entry: dataClassEntry, evaluator: variableTypeEvaluator });

              let insertIndex = localDataClassEntries.findIndex((e) => e.name === variableName);
              if (insertIndex >= 0) {
                localDataClassEntries[insertIndex] = dataClassEntry;
              } else {
                localDataClassEntries.push(dataClassEntry);
              }

              insertIndex = fullDataClassEntries.findIndex((p) => p.name === variableName);
              if (insertIndex >= 0) {
                fullDataClassEntries[insertIndex] = dataClassEntry;
              } else {
                fullDataClassEntries.push(dataClassEntry);
                insertIndex = fullDataClassEntries.length - 1;
              }

              const firstDefaultValueIndex = fullDataClassEntries.findIndex((p) => p.hasDefault && p.includeInInit);
              if (includeInInit && !hasDefaultValue && firstDefaultValueIndex >= 0 && firstDefaultValueIndex < insertIndex) {
                addError(Localizer.Diag.dataClassFieldWithDefault(), variableNameNode);
              }
            }
          }
        });
      }
    });

    classType.details.dataClassEntries = localDataClassEntries;

    localEntryTypeEvaluator.forEach((entryEvaluator) => {
      entryEvaluator.entry.type = entryEvaluator.evaluator();
    });

    const symbolTable = classType.details.fields;
    if (!skipSynthesizeInit && allAncestorsKnown) {
      fullDataClassEntries.forEach((entry) => {
        if (entry.includeInInit) {
          const functionParam: FunctionParameter = {
            category: ParameterCategory.Simple,
            name: entry.name,
            hasDefault: entry.hasDefault,
            defaultValueExpression: entry.defaultValueExpression,
            type: entry.type,
            hasDeclaredType: true,
          };

          FunctionType.addParameter(initType, functionParam);
        }
      });

      symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
      symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
    }

    const synthesizeComparisonMethod = (operator: string, paramType: Type) => {
      const operatorMethod = FunctionType.createInstance(operator, '', '', FunctionTypeFlags.SynthesizedMethod);
      FunctionType.addParameter(operatorMethod, selfParam);
      FunctionType.addParameter(operatorMethod, {
        category: ParameterCategory.Simple,
        name: 'x',
        type: paramType,
        hasDeclaredType: true,
      });
      operatorMethod.details.declaredReturnType = getBuiltInObject(node, 'bool');
      symbolTable.set(operator, Symbol.createWithType(SymbolFlags.ClassMember, operatorMethod));
    };

    if (!ClassType.isSkipSynthesizedDataClassEq(classType)) {
      synthesizeComparisonMethod('__eq__', getBuiltInObject(node, 'object'));
    }

    if (ClassType.isSynthesizedDataclassOrder(classType)) {
      const objType = ObjectType.create(classType);
      ['__lt__', '__le__', '__gt__', '__ge__'].forEach((operator) => {
        synthesizeComparisonMethod(operator, objType);
      });
    }

    let dictType = getBuiltInType(node, 'dict');
    if (isClass(dictType)) {
      dictType = ObjectType.create(ClassType.cloneForSpecialization(dictType, [getBuiltInObject(node, 'str'), AnyType.create()], /* isTypeArgumentExplicit */ true));
    }
    symbolTable.set('__dataclass_fields__', Symbol.createWithType(SymbolFlags.ClassMember, dictType));

    updateNamedTupleBaseClass(
      classType,
      fullDataClassEntries.map((entry) => entry.type),
      /* isTypeArgumentExplicit */ true
    );
  }

  function synthesizeTypedDictClassMethods(node: ClassNode | ExpressionNode, classType: ClassType) {
    assert(ClassType.isTypedDictClass(classType));

    const newType = FunctionType.createInstance('__new__', '', '', FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod);
    FunctionType.addParameter(newType, {
      category: ParameterCategory.Simple,
      name: 'cls',
      type: classType,
      hasDeclaredType: true,
    });
    FunctionType.addDefaultParameters(newType);
    newType.details.declaredReturnType = ObjectType.create(classType);

    const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);
    FunctionType.addParameter(initType, {
      category: ParameterCategory.Simple,
      name: 'self',
      type: ObjectType.create(classType),
      hasDeclaredType: true,
    });
    initType.details.declaredReturnType = NoneType.createInstance();

    FunctionType.addParameter(initType, {
      category: ParameterCategory.VarArgList,
      type: AnyType.create(),
      hasDeclaredType: true,
    });

    const entries = getTypedDictMembersForClass(classType);
    entries.forEach((entry, name) => {
      FunctionType.addParameter(initType, {
        category: ParameterCategory.Simple,
        name,
        hasDefault: !entry.isRequired,
        type: entry.valueType,
        hasDeclaredType: true,
      });
    });

    const symbolTable = classType.details.fields;
    symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
    symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));

    const strClass = getBuiltInType(node, 'str');

    if (isClass(strClass)) {
      const selfParam: FunctionParameter = {
        category: ParameterCategory.Simple,
        name: 'self',
        type: ObjectType.create(classType),
        hasDeclaredType: true,
      };
      const typeVarScopeId = getScopeIdForNode(node);
      let defaultTypeVar = TypeVarType.createInstance(`__${classType.details.name}_default`);
      defaultTypeVar.details.isSynthesized = true;
      defaultTypeVar = TypeVarType.cloneForScopeId(defaultTypeVar, typeVarScopeId, classType.details.name);

      const createGetMethod = (keyType: Type, valueType: Type, includeDefault: boolean) => {
        const getOverload = FunctionType.createInstance('get', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded);
        FunctionType.addParameter(getOverload, selfParam);
        FunctionType.addParameter(getOverload, {
          category: ParameterCategory.Simple,
          name: 'k',
          type: keyType,
          hasDeclaredType: true,
        });
        if (includeDefault) {
          FunctionType.addParameter(getOverload, {
            category: ParameterCategory.Simple,
            name: 'default',
            type: valueType,
            hasDeclaredType: true,
            hasDefault: true,
          });
          getOverload.details.declaredReturnType = valueType;
        } else {
          getOverload.details.declaredReturnType = combineTypes([valueType, NoneType.createInstance()]);
        }
        return getOverload;
      };

      const createPopMethods = (keyType: Type, valueType: Type) => {
        const keyParam: FunctionParameter = {
          category: ParameterCategory.Simple,
          name: 'k',
          type: keyType,
          hasDeclaredType: true,
        };

        const popOverload1 = FunctionType.createInstance('pop', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded);
        FunctionType.addParameter(popOverload1, selfParam);
        FunctionType.addParameter(popOverload1, keyParam);
        popOverload1.details.declaredReturnType = valueType;

        const popOverload2 = FunctionType.createInstance('pop', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded);
        FunctionType.addParameter(popOverload2, selfParam);
        FunctionType.addParameter(popOverload2, keyParam);
        FunctionType.addParameter(popOverload2, {
          category: ParameterCategory.Simple,
          name: 'default',
          hasDeclaredType: true,
          type: defaultTypeVar,
          hasDefault: true,
        });
        popOverload2.details.declaredReturnType = combineTypes([valueType, defaultTypeVar]);
        popOverload2.details.typeVarScopeId = typeVarScopeId;
        return [popOverload1, popOverload2];
      };

      const createSetDefaultMethod = (keyType: Type, valueType: Type, isEntryRequired = false) => {
        const setDefaultOverload = FunctionType.createInstance('setdefault', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded);
        FunctionType.addParameter(setDefaultOverload, selfParam);
        FunctionType.addParameter(setDefaultOverload, {
          category: ParameterCategory.Simple,
          name: 'k',
          hasDeclaredType: true,
          type: keyType,
        });
        FunctionType.addParameter(setDefaultOverload, {
          category: ParameterCategory.Simple,
          name: 'default',
          hasDeclaredType: true,
          type: isEntryRequired ? AnyType.create() : defaultTypeVar,
          hasDefault: true,
        });
        setDefaultOverload.details.declaredReturnType = isEntryRequired ? valueType : combineTypes([valueType, defaultTypeVar]);
        setDefaultOverload.details.typeVarScopeId = typeVarScopeId;
        return setDefaultOverload;
      };

      const createDelItemMethod = (keyType: Type) => {
        const delItemOverload = FunctionType.createInstance('delitem', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded);
        FunctionType.addParameter(delItemOverload, selfParam);
        FunctionType.addParameter(delItemOverload, {
          category: ParameterCategory.Simple,
          name: 'k',
          hasDeclaredType: true,
          type: keyType,
        });
        delItemOverload.details.declaredReturnType = NoneType.createInstance();
        return delItemOverload;
      };

      const getOverloads: FunctionType[] = [];
      const popOverloads: FunctionType[] = [];
      const setDefaultOverloads: FunctionType[] = [];

      entries.forEach((entry, name) => {
        const nameLiteralType = ObjectType.create(ClassType.cloneWithLiteral(strClass, name));

        if (!entry.isRequired) {
          getOverloads.push(createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ false));
        }
        getOverloads.push(createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ true));
        popOverloads.push(...createPopMethods(nameLiteralType, entry.valueType));
        setDefaultOverloads.push(createSetDefaultMethod(nameLiteralType, entry.valueType, entry.isRequired));
      });

      const strType = ObjectType.create(strClass);
      getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ false));
      getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ true));
      popOverloads.push(...createPopMethods(strType, AnyType.create()));
      setDefaultOverloads.push(createSetDefaultMethod(strType, AnyType.create()));

      symbolTable.set('get', Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(getOverloads)));
      symbolTable.set('pop', Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(popOverloads)));
      symbolTable.set('setdefault', Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(setDefaultOverloads)));
      symbolTable.set('__delitem__', Symbol.createWithType(SymbolFlags.ClassMember, createDelItemMethod(strType)));
    }
  }

  function getTypingType(node: ParseNode, symbolName: string): Type | undefined {
    const fileInfo = getFileInfo(node);
    return getTypeFromTypeshedModule(symbolName, fileInfo.typingModulePath);
  }

  function getTypeshedType(node: ParseNode, symbolName: string): Type | undefined {
    const fileInfo = getFileInfo(node);
    return getTypeFromTypeshedModule(symbolName, fileInfo.typeshedModulePath);
  }

  function getTypeFromTypeshedModule(symbolName: string, importPath: string | undefined) {
    if (!importPath) {
      return undefined;
    }

    const lookupResult = importLookup(importPath);
    if (!lookupResult) {
      return undefined;
    }

    const symbol = lookupResult.symbolTable.get(symbolName);
    if (!symbol) {
      return undefined;
    }

    return getEffectiveTypeOfSymbol(symbol);
  }

  function isNodeReachable(node: ParseNode): boolean {
    const flowNode = AnalyzerNodeInfo.getFlowNode(node);
    if (!flowNode) {
      return false;
    }

    if (!isFlowNodeReachable(flowNode)) {
      return false;
    }

    return true;
  }

  function isAfterNodeReachable(node: ParseNode): boolean {
    const returnFlowNode = AnalyzerNodeInfo.getAfterFlowNode(node);
    if (!returnFlowNode) {
      return false;
    }

    if (!isFlowNodeReachable(returnFlowNode)) {
      return false;
    }

    if (!isFlowNodeReachableUsingNeverNarrowing(node, returnFlowNode)) {
      return false;
    }

    return true;
  }

  function isFlowNodeReachableUsingNeverNarrowing(node: ParseNode, flowNode: FlowNode) {
    const analyzer = getCodeFlowAnalyzerForNode(node.id);
    const codeFlowResult = getTypeFromCodeFlow(analyzer, flowNode, /* reference */ undefined, /* targetSymbolId */ undefined, /* initialType */ UnboundType.create());

    return codeFlowResult.type !== undefined;
  }

  function isFlowPathBetweenNodes(sourceNode: ParseNode, sinkNode: ParseNode) {
    const sourceFlowNode = AnalyzerNodeInfo.getFlowNode(sourceNode);
    const sinkFlowNode = AnalyzerNodeInfo.getFlowNode(sinkNode);
    if (!sourceFlowNode || !sinkFlowNode) {
      return false;
    }
    if (sourceFlowNode === sinkFlowNode) {
      return true;
    }

    return isFlowNodeReachable(sinkFlowNode, sourceFlowNode);
  }

  function isAnnotationLiteralValue(node: StringListNode): boolean {
    if (node.parent && node.parent.nodeType === ParseNodeType.Index) {
      const baseType = getTypeOfExpression(node.parent.baseExpression).type;
      if (baseType && isClass(baseType)) {
        if (ClassType.isSpecialBuiltIn(baseType, 'Literal')) {
          return true;
        }
      }
    }

    return false;
  }

  function addInformation(message: string, node: ParseNode, range?: TextRange) {
    return addDiagWithSuppressionCheck('information', message, node, range);
  }

  function addWarning(message: string, node: ParseNode, range?: TextRange) {
    return addDiagWithSuppressionCheck('warning', message, node, range);
  }

  function addError(message: string, node: ParseNode, range?: TextRange) {
    return addDiagWithSuppressionCheck('error', message, node, range);
  }

  function addUnusedCode(node: ParseNode, textRange: TextRange) {
    if (!isDiagSuppressedForNode(node)) {
      const fileInfo = getFileInfo(node);
      fileInfo.diagnosticSink.addUnusedCodeWithTextRange(Localizer.Diag.unreachableCode(), textRange);
    }
  }

  function addDiagWithSuppressionCheck(diagLevel: DiagLevel, message: string, node: ParseNode, range?: TextRange) {
    if (!isDiagSuppressedForNode(node)) {
      const fileInfo = getFileInfo(node);
      return fileInfo.diagnosticSink.addDiagWithTextRange(diagLevel, message, range || node);
    }

    return undefined;
  }

  function isDiagSuppressedForNode(node: ParseNode) {
    return (
      suppressedNodeStack.some((suppressedNode) => ParseTreeUtils.isNodeContainedWithin(node, suppressedNode)) ||
      speculativeTypeTracker.isSpeculative(node) ||
      incompleteTypeTracker.isUndoTrackingEnabled()
    );
  }

  function addDiag(diagLevel: DiagLevel, rule: string, message: string, node: ParseNode) {
    if (diagLevel === 'none') {
      return undefined;
    }

    const diagnostic = addDiagWithSuppressionCheck(diagLevel, message, node);
    if (diagnostic) {
      diagnostic.setRule(rule);
    }

    return diagnostic;
  }

  function addDiagForTextRange(fileInfo: AnalyzerFileInfo, diagLevel: DiagLevel, rule: string, message: string, range: TextRange) {
    if (diagLevel === 'none') {
      return undefined;
    }

    const diagnostic = fileInfo.diagnosticSink.addDiagWithTextRange(diagLevel, message, range);
    diagnostic.setRule(rule);

    return diagnostic;
  }

  function addExpectedClassDiag(type: Type, node: ParseNode) {
    const fileInfo = getFileInfo(node);
    const diag = new DiagAddendum();
    if (isUnion(type)) {
      doForEachSubtype(type, (subtype) => {
        if (!TypeBase.isInstantiable(subtype)) {
          diag.addMessage(Localizer.DiagAddendum.typeNotClass().format({ type: printType(subtype) }));
        }
      });
    }

    addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeExpectedClass().format({ type: printType(type) }) + diag.getString(), node);
  }

  function assignTypeToNameNode(nameNode: NameNode, type: Type, isTypeIncomplete: boolean, srcExpression?: ParseNode, expectedTypeDiagAddendum?: DiagAddendum) {
    const nameValue = nameNode.value;

    const symbolWithScope = lookUpSymbolRecursive(nameNode, nameValue, /* honorCodeFlow */ false);
    if (!symbolWithScope) {
      return;
    }

    const declarations = symbolWithScope.symbol.getDeclarations();
    const declaredType = getDeclaredTypeOfSymbol(symbolWithScope.symbol);
    const fileInfo = getFileInfo(nameNode);

    let destType = type;
    if (declaredType && srcExpression) {
      let diagAddendum = new DiagAddendum();

      if (!canAssignType(declaredType, type, diagAddendum)) {
        if (expectedTypeDiagAddendum) {
          diagAddendum = expectedTypeDiagAddendum;
        }

        addDiag(
          fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.typeAssignmentMismatch().format({
            sourceType: printType(type),
            destType: printType(declaredType),
          }) + diagAddendum.getString(),
          srcExpression || nameNode
        );

        destType = declaredType;
      } else {
        destType = narrowTypeBasedOnAssignment(declaredType, type);
      }
    } else {
      const scope = ScopeUtils.getScopeForNode(nameNode);
      if (scope?.type === ScopeType.Class) {
        const isConstant = isConstantName(nameValue);
        const isPrivate = isPrivateOrProtectedName(nameValue);

        if (TypeBase.isInstance(destType) && !isConstant && (!isPrivate || getFileInfo(nameNode).diagnosticRuleSet.reportPrivateUsage === 'none')) {
          destType = stripLiteralValue(destType);
        }
      }
    }

    const varDecl: Declaration | undefined = declarations.find((decl) => decl.type === DeclarationType.Variable);

    if (varDecl && varDecl.type === DeclarationType.Variable && srcExpression) {
      if (varDecl.isConstant) {
        if (nameNode !== declarations[0].node) {
          addDiag(fileInfo.diagnosticRuleSet.reportConstantRedefinition, DiagRule.reportConstantRedefinition, Localizer.Diag.constantRedefinition().format({ name: nameValue }), nameNode);
        }
      }
    }

    writeTypeCache(nameNode, destType, isTypeIncomplete, /* expectedType */ undefined, /* allowSpeculativeCaching */ false);
  }

  function assignTypeToMemberAccessNode(target: MemberAccessNode, type: Type, isTypeIncomplete: boolean, srcExpr?: ExpressionNode, expectedTypeDiagAddendum?: DiagAddendum) {
    const baseTypeResult = getTypeOfExpression(target.leftExpression);
    const baseType = makeTopLevelTypeVarsConcrete(baseTypeResult.type);

    if (target.leftExpression.nodeType === ParseNodeType.Name) {
      const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

      if (enclosingClassNode) {
        const classTypeResults = getTypeOfClass(enclosingClassNode);

        if (classTypeResults && isClass(classTypeResults.classType)) {
          if (isObject(baseType)) {
            if (ClassType.isSameGenericClass(baseType.classType, classTypeResults.classType)) {
              assignTypeToMemberVariable(target, type, isTypeIncomplete, true, srcExpr);
            }
          } else if (isClass(baseType)) {
            if (ClassType.isSameGenericClass(baseType, classTypeResults.classType)) {
              assignTypeToMemberVariable(target, type, isTypeIncomplete, false, srcExpr);
            }
          }

          if (ClassType.isProtocolClass(classTypeResults.classType)) {
            const memberSymbol = classTypeResults.classType.details.fields.get(target.memberName.value);
            if (memberSymbol) {
              const classLevelDecls = memberSymbol.getDeclarations().filter((decl) => {
                return !ParseTreeUtils.getEnclosingFunction(decl.node);
              });
              if (classLevelDecls.length === 0) {
                addError(Localizer.Diag.assignmentInProtocol(), target.memberName);
              }
            }
          }
        }
      }
    }

    getTypeFromMemberAccessWithBaseType(target, baseTypeResult, { method: 'set', setType: type, setErrorNode: srcExpr, setExpectedTypeDiag: expectedTypeDiagAddendum }, EvaluatorFlags.None);

    writeTypeCache(target.memberName, type, isTypeIncomplete, /* expectedType */ undefined, /* allowSpeculativeCaching */ false);
    writeTypeCache(target, type, isTypeIncomplete, /* expectedType */ undefined, /* allowSpeculativeCaching */ false);
  }

  function assignTypeToMemberVariable(node: MemberAccessNode, srcType: Type, isTypeIncomplete: boolean, isInstanceMember: boolean, srcExprNode?: ExpressionNode) {
    const memberName = node.memberName.value;
    const fileInfo = getFileInfo(node);

    const classDef = ParseTreeUtils.getEnclosingClass(node);
    if (!classDef) {
      return;
    }

    const classTypeInfo = getTypeOfClass(classDef);
    if (classTypeInfo && isClass(classTypeInfo.classType)) {
      let memberInfo = lookUpClassMember(classTypeInfo.classType, memberName, isInstanceMember ? ClassMemberLookupFlags.Default : ClassMemberLookupFlags.SkipInstanceVariables);

      const memberFields = classTypeInfo.classType.details.fields;
      if (memberInfo) {
        const isThisClass = isClass(memberInfo.classType) && ClassType.isSameGenericClass(classTypeInfo.classType, memberInfo.classType);

        if (isThisClass && memberInfo.isInstanceMember === isInstanceMember) {
          const symbol = memberFields.get(memberName)!;
          assert(symbol !== undefined);

          const typedDecls = symbol.getDeclarations();
          let isFinalVar = isFinalVariable(symbol);

          if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Variable && srcExprNode && node.memberName !== typedDecls[0].node) {
            if (typedDecls[0].isConstant) {
              addDiag(
                fileInfo.diagnosticRuleSet.reportConstantRedefinition,
                DiagRule.reportConstantRedefinition,
                Localizer.Diag.constantRedefinition().format({ name: node.memberName.value }),
                node.memberName
              );
            }

            const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
            if (enclosingFunctionNode && enclosingFunctionNode.name.value === '__init__') {
              isFinalVar = false;
            }

            if (isFinalVar) {
              addError(Localizer.Diag.finalReassigned().format({ name: node.memberName.value }), node.memberName);
            }
          }
        } else {
          const declaredType = getDeclaredTypeOfSymbol(memberInfo.symbol);
          if (declaredType && !isProperty(declaredType)) {
            if (!memberInfo.isInstanceMember && isInstanceMember) {
              setSymbolAccessed(fileInfo, memberInfo.symbol, node.memberName);
              const memberType = getTypeOfMember(memberInfo);
              srcType = combineTypes([srcType, memberType]);
            }
          }
        }
      }

      memberInfo = lookUpClassMember(classTypeInfo.classType, memberName, ClassMemberLookupFlags.DeclaredTypesOnly);

      if (!memberInfo && srcExprNode && !isTypeIncomplete) {
        reportPossibleUnknownAssignment(fileInfo.diagnosticRuleSet.reportUnknownMemberType, DiagRule.reportUnknownMemberType, node.memberName, srcType, node);
      }
    }
  }

  function assignTypeToTupleNode(target: TupleNode, type: Type, isTypeIncomplete: boolean, srcExpr: ExpressionNode) {
    const targetTypes: ConstrainedSubtype[][] = new Array(target.expressions.length);
    for (let i = 0; i < target.expressions.length; i++) {
      targetTypes[i] = [];
    }

    const unpackIndex = target.expressions.findIndex((expr) => expr.nodeType === ParseNodeType.Unpack);

    doForEachSubtype(type, (subtype, index, constraints) => {
      const tupleType = getSpecializedTupleType(subtype);
      if (tupleType && tupleType.tupleTypeArguments) {
        const sourceEntryTypes = tupleType.tupleTypeArguments;
        const sourceEntryCount = sourceEntryTypes.length;

        if (isOpenEndedTupleClass(tupleType)) {
          for (let index = 0; index < target.expressions.length; index++) {
            targetTypes[index].push({ type: sourceEntryTypes[0], constraints });
          }
        } else {
          let sourceIndex = 0;
          let targetIndex = 0;
          for (targetIndex = 0; targetIndex < target.expressions.length; targetIndex++) {
            if (targetIndex === unpackIndex) {
              const remainingTargetEntries = target.expressions.length - targetIndex - 1;
              const remainingSourceEntries = sourceEntryCount - sourceIndex;
              let entriesToPack = Math.max(remainingSourceEntries - remainingTargetEntries, 0);
              while (entriesToPack > 0) {
                targetTypes[targetIndex].push({ type: sourceEntryTypes[sourceIndex], constraints });
                sourceIndex++;
                entriesToPack--;
              }
            } else {
              if (sourceIndex >= sourceEntryCount) {
                break;
              }

              targetTypes[targetIndex].push({ type: sourceEntryTypes[sourceIndex], constraints });
              sourceIndex++;
            }
          }

          if (targetIndex < target.expressions.length || sourceIndex < sourceEntryCount) {
            const fileInfo = getFileInfo(target);
            const expectedEntryCount = unpackIndex >= 0 ? target.expressions.length - 1 : target.expressions.length;
            addDiag(
              fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.tupleSizeMismatch().format({
                expected: expectedEntryCount,
                received: sourceEntryCount,
              }),
              target
            );
          }
        }
      } else {
        const iterableType = getTypeFromIterator(subtype, /* isAsync */ false, srcExpr) || UnknownType.create();
        for (let index = 0; index < target.expressions.length; index++) {
          targetTypes[index].push({ type: iterableType, constraints });
        }
      }
    });

    target.expressions.forEach((expr, index) => {
      const typeList = targetTypes[index];
      let targetType = typeList.length === 0 ? UnknownType.create() : combineConstrainedTypes(typeList);
      targetType = removeNoReturnFromUnion(targetType);

      if (index === unpackIndex) {
        const listType = getBuiltInType(expr, 'list');
        if (isClass(listType)) {
          targetType = ObjectType.create(ClassType.cloneForSpecialization(listType, [targetType], /* isTypeArgumentExplicit */ true));
        }
      }

      assignTypeToExpression(expr, targetType, isTypeIncomplete, srcExpr);
    });

    writeTypeCache(target, type, isTypeIncomplete);
  }

  function makeTopLevelTypeVarsConcrete(type: Type): Type {
    return mapSubtypes(type, (subtype) => {
      if (isTypeVar(subtype) && !subtype.details.recursiveTypeAliasName) {
        if (subtype.details.boundType) {
          return TypeBase.isInstantiable(subtype) ? convertToInstantiable(subtype.details.boundType) : convertToInstance(subtype.details.boundType);
        }

        if (subtype.details.recursiveTypeAliasName) {
          return subtype;
        }

        if (subtype.details.constraints.length > 0) {
          const constrainedTypes = subtype.details.constraints.map((constraintType, constraintIndex) => {
            return {
              type: constraintType,
              constraints: [
                {
                  typeVarName: TypeVarType.getNameWithScope(subtype),
                  constraintIndex,
                },
              ],
            };
          });

          return combineConstrainedTypes(constrainedTypes);
        }

        const objType = objectType || AnyType.create();
        return TypeBase.isInstantiable(subtype) ? convertToInstantiable(objType) : objType;
      }

      return subtype;
    });
  }

  function mapSubtypesExpandTypeVars(
    type: Type,
    constraintFilter: SubtypeConstraints | undefined,
    callback: (expandedSubtype: Type, unexpandedSubtype: Type, constraints: SubtypeConstraints) => Type | undefined
  ): Type {
    const newSubtypes: ConstrainedSubtype[] = [];
    let typeChanged = false;

    const expandSubtype = (unexpandedType: Type) => {
      const expandedType = makeTopLevelTypeVarsConcrete(unexpandedType);

      if (isUnion(expandedType)) {
        expandedType.subtypes.forEach((subtype, index) => {
          const subtypeConstraints = expandedType.constraints ? expandedType.constraints[index] : undefined;
          if (constraintFilter) {
            if (!SubtypeConstraint.isCompatible(subtypeConstraints, constraintFilter)) {
              return undefined;
            }
          }

          const transformedType = callback(subtype, unexpandedType, subtypeConstraints);
          if (transformedType !== unexpandedType) {
            typeChanged = true;
          }
          if (transformedType) {
            newSubtypes.push({ type: transformedType, constraints: subtypeConstraints });
          }
          return undefined;
        });
      } else {
        const transformedType = callback(expandedType, unexpandedType, undefined);
        if (transformedType !== unexpandedType) {
          typeChanged = true;
        }

        if (transformedType) {
          newSubtypes.push({ type: transformedType, constraints: undefined });
        }
      }
    };

    if (isUnion(type)) {
      type.subtypes.forEach((subtype) => {
        expandSubtype(subtype);
      });
    } else {
      expandSubtype(type);
    }

    return typeChanged ? combineConstrainedTypes(newSubtypes) : type;
  }

  function markNamesAccessed(node: ParseNode, names: string[]) {
    const fileInfo = getFileInfo(node);
    const scope = ScopeUtils.getScopeForNode(node);

    if (scope) {
      names.forEach((symbolName) => {
        const symbolInScope = scope.lookUpSymbolRecursive(symbolName);
        if (symbolInScope) {
          setSymbolAccessed(fileInfo, symbolInScope.symbol, node);
        }
      });
    }
  }

  function assignTypeToExpression(target: ExpressionNode, type: Type, isTypeIncomplete: boolean, srcExpr: ExpressionNode, expectedTypeDiagAddendum?: DiagAddendum) {
    if (isTypeVar(type)) {
      if (srcExpr && srcExpr.nodeType === ParseNodeType.Call) {
        const callType = getTypeOfExpression(srcExpr.leftExpression).type;
        if (isClass(callType) && (ClassType.isBuiltIn(callType, 'TypeVar') || ClassType.isBuiltIn(callType, 'TypeVarTuple') || ClassType.isBuiltIn(callType, 'ParamSpec'))) {
          if (target.nodeType !== ParseNodeType.Name || target.value !== type.details.name) {
            addError(
              type.details.isParamSpec
                ? Localizer.Diag.paramSpecAssignedName().format({
                    name: TypeVarType.getReadableName(type),
                  })
                : Localizer.Diag.typeVarAssignedName().format({
                    name: TypeVarType.getReadableName(type),
                  }),
              target
            );
          }
        }
      }
    }

    type = removeUnbound(type);

    switch (target.nodeType) {
      case ParseNodeType.Name: {
        if (!isTypeIncomplete) {
          reportPossibleUnknownAssignment(getFileInfo(target).diagnosticRuleSet.reportUnknownVariableType, DiagRule.reportUnknownVariableType, target, type, target);
        }

        assignTypeToNameNode(target, type, isTypeIncomplete, srcExpr, expectedTypeDiagAddendum);
        break;
      }

      case ParseNodeType.MemberAccess: {
        assignTypeToMemberAccessNode(target, type, isTypeIncomplete, srcExpr, expectedTypeDiagAddendum);
        break;
      }

      case ParseNodeType.Index: {
        const baseTypeResult = getTypeOfExpression(target.baseExpression, undefined, EvaluatorFlags.DoNotSpecialize);

        getTypeFromIndexWithBaseType(
          target,
          baseTypeResult.type,
          {
            method: 'set',
            setType: type,
            setErrorNode: srcExpr,
            setExpectedTypeDiag: expectedTypeDiagAddendum,
          },
          EvaluatorFlags.None
        );

        writeTypeCache(target, type, isTypeIncomplete);
        break;
      }

      case ParseNodeType.Tuple: {
        assignTypeToTupleNode(target, type, isTypeIncomplete, srcExpr);
        break;
      }

      case ParseNodeType.TypeAnnotation: {
        const annotationType: Type | undefined = getTypeOfAnnotation(target.typeAnnotation, ParseTreeUtils.isFinalAllowedForAssignmentTarget(target.valueExpression));

        if (!isObject(annotationType) || !ClassType.isBuiltIn(annotationType.classType, 'Final')) {
          const isTypeAliasAnnotation = isObject(annotationType) && ClassType.isBuiltIn(annotationType.classType, 'TypeAlias');

          if (!isTypeAliasAnnotation) {
            if (canAssignType(annotationType, type, new DiagAddendum())) {
              if (!isObject(type) || !ClassType.isEnumClass(type.classType)) {
                type = narrowTypeBasedOnAssignment(annotationType, type);
              }
            }
          }
        }

        assignTypeToExpression(target.valueExpression, type, /* isIncomplete */ false, srcExpr, expectedTypeDiagAddendum);
        break;
      }

      case ParseNodeType.Unpack: {
        if (target.expression.nodeType === ParseNodeType.Name) {
          assignTypeToNameNode(target.expression, type, /* isIncomplete */ false, srcExpr);
        }
        break;
      }

      case ParseNodeType.List: {
        const iteratedType = getTypeFromIterator(type, /* isAsync */ false, srcExpr) || UnknownType.create();

        target.entries.forEach((entry) => {
          assignTypeToExpression(entry, iteratedType, /* isIncomplete */ false, srcExpr);
        });
        break;
      }

      case ParseNodeType.Error: {
        if (target.child) {
          suppressDiags(target.child, () => {
            getTypeOfExpression(target.child!);
          });
        }
        break;
      }

      default: {
        const fileInfo = getFileInfo(target);
        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.assignmentTargetExpr(), target);
        break;
      }
    }
  }

  function verifyRaiseExceptionType(node: RaiseNode) {
    const baseExceptionType = getBuiltInType(node, 'BaseException');

    if (node.typeExpression) {
      const exceptionType = getType(node.typeExpression);

      if (exceptionType && baseExceptionType && isClass(baseExceptionType)) {
        const diagAddendum = new DiagAddendum();

        doForEachSubtype(exceptionType, (subtype) => {
          const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

          if (!isAnyOrUnknown(concreteSubtype)) {
            if (isClass(concreteSubtype) && concreteSubtype.literalValue === undefined) {
              if (!derivesFromClassRecursive(concreteSubtype, baseExceptionType, /* ignoreUnknown */ false)) {
                diagAddendum.addMessage(
                  Localizer.Diag.exceptionTypeIncorrect().format({
                    type: printType(subtype, /* expandTypeAlias */ false),
                  })
                );
              } else {
                let callResult: CallResult | undefined;
                suppressDiags(node.typeExpression!, () => {
                  callResult = validateConstructorArguments(node.typeExpression!, [], concreteSubtype, /* skipUnknownArgCheck */ false, /* expectedType */ undefined);
                });

                if (callResult && callResult.argumentErrors) {
                  diagAddendum.addMessage(
                    Localizer.Diag.exceptionTypeNotInstantiable().format({
                      type: printType(subtype, /* expandTypeAlias */ false),
                    })
                  );
                }
              }
            } else if (isObject(concreteSubtype)) {
              if (!derivesFromClassRecursive(concreteSubtype.classType, baseExceptionType, /* ignoreUnknown */ false)) {
                diagAddendum.addMessage(
                  Localizer.Diag.exceptionTypeIncorrect().format({
                    type: printType(subtype, /* expandTypeAlias */ false),
                  })
                );
              }
            } else {
              diagAddendum.addMessage(
                Localizer.Diag.exceptionTypeIncorrect().format({
                  type: printType(subtype, /* expandTypeAlias */ false),
                })
              );
            }
          }
        });

        if (!diagAddendum.isEmpty()) {
          const fileInfo = getFileInfo(node);
          addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.expectedExceptionClass() + diagAddendum.getString(), node.typeExpression);
        }
      }
    }
  }

  function verifyDeleteExpression(node: ExpressionNode) {
    switch (node.nodeType) {
      case ParseNodeType.Name: {
        getTypeOfExpression(node, /* expectedType */ undefined, EvaluatorFlags.SkipUnboundCheck);
        break;
      }

      case ParseNodeType.MemberAccess: {
        const baseTypeResult = getTypeOfExpression(node.leftExpression);
        const memberType = getTypeFromMemberAccessWithBaseType(node, baseTypeResult, { method: 'del' }, EvaluatorFlags.SkipUnboundCheck);
        writeTypeCache(node.memberName, memberType.type, /* isIncomplete */ false);
        writeTypeCache(node, memberType.type, /* isIncomplete */ false);
        break;
      }

      case ParseNodeType.Index: {
        const baseTypeResult = getTypeOfExpression(node.baseExpression, undefined, EvaluatorFlags.DoNotSpecialize);
        getTypeFromIndexWithBaseType(node, baseTypeResult.type, { method: 'del' }, EvaluatorFlags.SkipUnboundCheck);
        writeTypeCache(node, UnboundType.create(), /* isIncomplete */ false);
        break;
      }

      case ParseNodeType.Error: {
        if (node.child) {
          suppressDiags(node.child, () => {
            getTypeOfExpression(node.child!, /* expectedType */ undefined, EvaluatorFlags.SkipUnboundCheck);
          });
        }
        break;
      }

      default: {
        const fileInfo = getFileInfo(node);
        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.delTargetExpr(), node);
        break;
      }
    }
  }

  function setSymbolAccessed(fileInfo: AnalyzerFileInfo, symbol: Symbol, node: ParseNode) {
    if (!speculativeTypeTracker.isSpeculative(node) && !incompleteTypeTracker.isUndoTrackingEnabled()) {
      fileInfo.accessedSymbolMap.set(symbol.id, true);
    }
  }

  function addInheritedDataClassEntries(classType: ClassType, entries: DataClassEntry[]) {
    let allAncestorsAreKnown = true;

    for (let i = classType.details.mro.length - 1; i >= 0; i--) {
      const mroClass = classType.details.mro[i];

      if (isClass(mroClass)) {
        const typeVarMap = buildTypeVarMapFromSpecializedClass(mroClass, /* makeConcrete */ false);
        const dataClassEntries = ClassType.getDataClassEntries(mroClass);

        dataClassEntries.forEach((entry) => {
          const existingIndex = entries.findIndex((e) => e.name === entry.name);

          const updatedEntry = { ...entry };
          updatedEntry.type = applySolvedTypeVars(updatedEntry.type, typeVarMap);

          if (existingIndex >= 0) {
            entries[existingIndex] = updatedEntry;
          } else {
            entries.push(updatedEntry);
          }
        });
      } else {
        allAncestorsAreKnown = false;
      }
    }
    return allAncestorsAreKnown;
  }

  function getReturnTypeFromGenerator(type: Type): Type | undefined {
    if (isAnyOrUnknown(type)) {
      return type;
    }

    if (isObject(type)) {
      const classType = type.classType;
      if (ClassType.isBuiltIn(classType, 'Generator')) {
        const typeArgs = classType.typeArguments;
        if (typeArgs && typeArgs.length >= 3) {
          return typeArgs[2];
        }
      }
    }

    return undefined;
  }

  function getSpecializedReturnType(objType: ObjectType, memberName: string, errorNode: ParseNode | undefined, bindToClass?: ClassType) {
    const classMember = lookUpObjectMember(objType, memberName, ClassMemberLookupFlags.SkipInstanceVariables);
    if (!classMember) {
      return undefined;
    }

    const memberType = getTypeOfMember(classMember);
    if (isAnyOrUnknown(memberType)) {
      return memberType;
    }

    if (isFunction(memberType)) {
      const methodType = bindFunctionToClassOrObject(
        bindToClass || objType,
        memberType,
        classMember && isClass(classMember.classType) ? classMember.classType : undefined,
        errorNode,
        /* recursionCount */ undefined,
        /* treatConstructorAsClassMember */ false,
        /* firstParamType */ bindToClass
      );
      if (methodType) {
        return getFunctionEffectiveReturnType(methodType as FunctionType);
      }
    }

    return undefined;
  }

  function getTypeFromName(node: NameNode, flags: EvaluatorFlags): TypeResult {
    const fileInfo = getFileInfo(node);
    const name = node.value;
    let type: Type | undefined;
    let isIncomplete = false;
    const allowForwardReferences = (flags & EvaluatorFlags.AllowForwardReferences) !== 0 || fileInfo.isStubFile;

    const symbolWithScope = lookUpSymbolRecursive(node, name, !allowForwardReferences);

    if (symbolWithScope) {
      let useCodeFlowAnalysis = !allowForwardReferences;

      if (symbolWithScope.scope.type === ScopeType.Builtin) {
        useCodeFlowAnalysis = false;
      }

      const symbol = symbolWithScope.symbol;

      const effectiveTypeInfo = getEffectiveTypeOfSymbolForUsage(symbol, useCodeFlowAnalysis ? node : undefined);
      const effectiveType = effectiveTypeInfo.type;

      if (effectiveTypeInfo.isIncomplete) {
        isIncomplete = true;
      }

      if (effectiveTypeInfo.isRecursiveDefinition && isNodeReachable(node)) {
        addDiag(getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.recursiveDefinition().format({ name }), node);
      }

      const isSpecialBuiltIn = !!effectiveType && isClass(effectiveType) && ClassType.isSpecialBuiltIn(effectiveType);

      type = effectiveType;
      if (useCodeFlowAnalysis && !isSpecialBuiltIn) {
        const typeAtStart = symbolWithScope.isBeyondExecutionScope || !symbol.isInitiallyUnbound() ? effectiveType : UnboundType.create();
        const codeFlowTypeResult = getFlowTypeOfReference(node, symbol.id, typeAtStart);
        if (codeFlowTypeResult.type) {
          type = codeFlowTypeResult.type;
        }

        if (codeFlowTypeResult.isIncomplete) {
          isIncomplete = true;
        }
      }

      if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
        if (isClass(type)) {
          if ((flags & EvaluatorFlags.ExpectingType) !== 0) {
            if (requiresTypeArguments(type) && !type.typeArguments) {
              addDiag(
                fileInfo.diagnosticRuleSet.reportMissingTypeArgument,
                DiagRule.reportMissingTypeArgument,
                Localizer.Diag.typeArgsMissingForClass().format({
                  name: type.aliasName || type.details.name,
                }),
                node
              );
            }
          }
          if (!type.typeArguments) {
            type = createSpecializedClassType(type, undefined, flags, node);
          }
        } else if (isObject(type)) {
          type = transformTypeObjectToClass(type);
        }

        if (
          (flags & EvaluatorFlags.ExpectingType) !== 0 &&
          type.typeAliasInfo &&
          type.typeAliasInfo.typeParameters &&
          type.typeAliasInfo.typeParameters.length > 0 &&
          !type.typeAliasInfo.typeArguments
        ) {
          addDiag(
            fileInfo.diagnosticRuleSet.reportMissingTypeArgument,
            DiagRule.reportMissingTypeArgument,
            Localizer.Diag.typeArgsMissingForAlias().format({
              name: type.typeAliasInfo.name,
            }),
            node
          );
        }
      }

      if (!isIncomplete && !AnalyzerNodeInfo.isCodeUnreachable(node)) {
        if ((flags & EvaluatorFlags.SkipUnboundCheck) === 0) {
          if (isUnbound(type)) {
            addDiag(fileInfo.diagnosticRuleSet.reportUnboundVariable, DiagRule.reportUnboundVariable, Localizer.Diag.symbolIsUnbound().format({ name }), node);
          } else if (isPossiblyUnbound(type)) {
            addDiag(fileInfo.diagnosticRuleSet.reportUnboundVariable, DiagRule.reportUnboundVariable, Localizer.Diag.symbolIsPossiblyUnbound().format({ name }), node);
          }
        }
      }

      setSymbolAccessed(fileInfo, symbol, node);

      if ((flags & EvaluatorFlags.ExpectingTypeAnnotation) !== 0) {
        if (effectiveTypeInfo.includesVariableDecl && !type.typeAliasInfo) {
          if (!isTypeAliasPlaceholder(type) && !isTypeVar(type) && !isUnknown(type) && !fileInfo.isTypingStubFile) {
            addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeAnnotationVariable(), node);
          }
        }
      }
    } else {
      if (name !== 'reveal_type' && name !== 'reveal_locals') {
        addDiag(fileInfo.diagnosticRuleSet.reportUndefinedVariable, DiagRule.reportUndefinedVariable, Localizer.Diag.symbolIsUndefined().format({ name }), node);
      }
      type = UnknownType.create();
    }

    if (isParamSpec(type)) {
      if (flags & EvaluatorFlags.ParamSpecDisallowed) {
        addError(Localizer.Diag.paramSpecContext(), node);
        type = UnknownType.create();
      }
    }

    if (isTypeVar(type) && (flags & EvaluatorFlags.ExpectingType) === 0 && type.details.name === name) {
      const typeVarType = type.details.isVariadic ? getTypingType(node, 'TypeVarTuple') : getTypingType(node, 'TypeVar');
      if (typeVarType && isClass(typeVarType)) {
        type = ObjectType.create(typeVarType);
      } else {
        type = UnknownType.create();
      }
    }

    if ((flags & EvaluatorFlags.ExpectingType) !== 0) {
      if ((flags & EvaluatorFlags.GenericClassTypeAllowed) === 0) {
        if (isClass(type) && ClassType.isBuiltIn(type, 'Generic')) {
          addDiag(getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.genericNotAllowed(), node);
        }
      }
    }

    if (isTypeVar(type)) {
      if (TypeBase.isInstantiable(type) && !isTypeAliasPlaceholder(type)) {
        const scopedTypeVarInfo = findScopedTypeVar(node, type);
        type = scopedTypeVarInfo.type;

        if ((flags & EvaluatorFlags.DisallowTypeVarsWithScopeId) !== 0 && type.scopeId !== undefined) {
          if (!type.details.isSynthesized && !type.details.isParamSpec) {
            addDiag(getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeVarUsedByOuterScope().format({ name: type.details.name }), node);
          }
        } else if ((flags & EvaluatorFlags.AssociateTypeVarsWithCurrentScope) !== 0) {
          if (type.scopeId === undefined) {
            if (!scopedTypeVarInfo.foundInterveningClass) {
              let enclosingScope = ParseTreeUtils.getEnclosingClassOrFunction(node);

              if (enclosingScope && node.parent?.nodeType === ParseNodeType.MemberAccess && node.parent.leftExpression === node) {
                const memberName = node.parent.memberName.value;
                if (memberName === 'args' || memberName === 'kwargs') {
                  const outerFunctionScope = ParseTreeUtils.getEnclosingClassOrFunction(enclosingScope);

                  if (outerFunctionScope?.nodeType === ParseNodeType.Function) {
                    enclosingScope = outerFunctionScope;
                  } else if (!scopedTypeVarInfo.type.scopeId) {
                    addDiag(
                      getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                      DiagRule.reportGeneralTypeIssues,
                      Localizer.Diag.paramSpecNotUsedByOuterScope().format({
                        name: type.details.name,
                      }),
                      node
                    );
                  }
                }
              }

              if (enclosingScope) {
                type = TypeVarType.cloneForScopeId(type, getScopeIdForNode(enclosingScope), enclosingScope.name.value);
              } else {
                fail('AssociateTypeVarsWithCurrentScope flag was set but enclosing scope not found');
              }
            } else {
              addDiag(
                getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                Localizer.Diag.typeVarUsedByOuterScope().format({ name: type.details.name }),
                node
              );
            }
          }
        } else if ((flags & EvaluatorFlags.DisallowTypeVarsWithoutScopeId) !== 0) {
          if ((type.scopeId === undefined || scopedTypeVarInfo.foundInterveningClass) && !type.details.isSynthesized) {
            const message = isParamSpec(type) ? Localizer.Diag.paramSpecNotUsedByOuterScope() : Localizer.Diag.typeVarNotUsedByOuterScope();
            addDiag(getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, message.format({ name: type.details.name }), node);
          }
        }
      }

      if (type.isVariadicUnpacked) {
        type = TypeVarType.cloneForPacked(type);
      }
    }

    return { type, node, isIncomplete };
  }

  function getScopeIdForNode(node: ParseNode): string {
    const fileInfo = getFileInfo(node);
    return `${fileInfo.filePath}.${node.start.toString()}`;
  }

  function getTypeVarScopesForNode(node: ParseNode): TypeVarScopeId[] {
    const scopeIds: TypeVarScopeId[] = [];

    let curNode: ParseNode | undefined = node;
    while (curNode) {
      curNode = ParseTreeUtils.getTypeVarScopeNode(curNode);
      if (!curNode) {
        break;
      }

      scopeIds.push(getScopeIdForNode(curNode));
      curNode = curNode.parent;
    }

    return scopeIds;
  }

  function findScopedTypeVar(node: NameNode, type: TypeVarType): { type: TypeVarType; foundInterveningClass: boolean } {
    let curNode: ParseNode | undefined = node;
    let nestedClassCount = 0;

    assert(TypeBase.isInstantiable(type));

    while (curNode) {
      curNode = ParseTreeUtils.getTypeVarScopeNode(curNode, node.parent?.nodeType === ParseNodeType.MemberAccess);
      if (!curNode) {
        break;
      }

      let typeVarsForScope: TypeVarType[] | undefined;

      if (curNode.nodeType === ParseNodeType.Class) {
        const classTypeInfo = getTypeOfClass(curNode);
        if (classTypeInfo) {
          typeVarsForScope = classTypeInfo.classType.details.typeParameters;
        }

        nestedClassCount++;
      } else if (curNode.nodeType === ParseNodeType.Function) {
        const functionTypeInfo = getTypeOfFunction(curNode);
        if (functionTypeInfo) {
          typeVarsForScope = [];
          functionTypeInfo.functionType.details.parameters.forEach((param) => {
            if (param.hasDeclaredType) {
              addTypeVarsToListIfUnique(typeVarsForScope!, getTypeVarArgumentsRecursive(param.type));
            }
          });
        }
      } else if (curNode.nodeType === ParseNodeType.Module) {
        break;
      }

      if (typeVarsForScope) {
        const match = typeVarsForScope.find((typeVar) => typeVar.details.name === type.details.name);

        if (match && match.scopeId) {
          return {
            type: nestedClassCount > 1 ? type : (convertToInstantiable(match) as TypeVarType),
            foundInterveningClass: nestedClassCount > 1,
          };
        }
      }

      curNode = curNode.parent;
    }

    curNode = node;
    while (curNode) {
      if (curNode.nodeType === ParseNodeType.Assignment) {
        const leftType = readTypeCache(curNode.leftExpression);

        if (leftType && isTypeVar(leftType) && leftType.details.recursiveTypeAliasScopeId && leftType.details.recursiveTypeAliasName) {
          return {
            type: TypeVarType.cloneForScopeId(type, leftType.details.recursiveTypeAliasScopeId, leftType.details.recursiveTypeAliasName),
            foundInterveningClass: false,
          };
        }
      }

      curNode = curNode.parent;
    }

    return { type, foundInterveningClass: false };
  }

  function getTypeFromMemberAccess(node: MemberAccessNode, flags: EvaluatorFlags): TypeResult {
    const baseTypeFlags =
      EvaluatorFlags.DoNotSpecialize |
      (flags &
        (EvaluatorFlags.ExpectingType |
          EvaluatorFlags.ExpectingTypeAnnotation |
          EvaluatorFlags.AllowForwardReferences |
          EvaluatorFlags.DisallowTypeVarsWithScopeId |
          EvaluatorFlags.DisallowTypeVarsWithoutScopeId |
          EvaluatorFlags.AssociateTypeVarsWithCurrentScope));
    const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, baseTypeFlags);

    if (isTypeAliasPlaceholder(baseTypeResult.type)) {
      return {
        node,
        type: UnknownType.create(),
        isIncomplete: true,
      };
    }

    const memberTypeResult = getTypeFromMemberAccessWithBaseType(node, baseTypeResult, { method: 'get' }, flags);

    if (isCodeFlowSupportedForReference(node)) {
      writeTypeCache(node, memberTypeResult.type, /* isIncomplete */ false);
      writeTypeCache(node.memberName, memberTypeResult.type, /* isIncomplete */ false);

      let initialType = memberTypeResult.type;
      if (isUnbound(initialType)) {
        const baseType = makeTopLevelTypeVarsConcrete(baseTypeResult.type);

        let classMemberInfo: ClassMember | undefined;
        if (isClass(baseType)) {
          classMemberInfo = lookUpClassMember(baseType, node.memberName.value, ClassMemberLookupFlags.SkipOriginalClass);
        } else if (isObject(baseType)) {
          classMemberInfo = lookUpObjectMember(baseType, node.memberName.value, ClassMemberLookupFlags.SkipOriginalClass);
        }

        if (classMemberInfo) {
          initialType = getTypeOfMember(classMemberInfo);
        }
      }

      const codeFlowTypeResult = getFlowTypeOfReference(node, indeterminateSymbolId, initialType);
      if (codeFlowTypeResult.type) {
        memberTypeResult.type = codeFlowTypeResult.type;
      }

      if (codeFlowTypeResult.isIncomplete) {
        memberTypeResult.isIncomplete = true;
      }

      deleteTypeCacheEntry(node);
      deleteTypeCacheEntry(node.memberName);
    }

    if (baseTypeResult.isIncomplete) {
      memberTypeResult.isIncomplete = true;
    }

    return memberTypeResult;
  }

  function getTypeFromMemberAccessWithBaseType(node: MemberAccessNode, baseTypeResult: TypeResult, usage: EvaluatorUsage, flags: EvaluatorFlags): TypeResult {
    const baseType = baseTypeResult.type;
    const memberName = node.memberName.value;
    let diag = new DiagAddendum();
    const fileInfo = getFileInfo(node);
    let type: Type | undefined;
    let isIncomplete = false;

    switch (baseType.category) {
      case TypeCategory.Any:
      case TypeCategory.Unknown: {
        type = baseType;
        break;
      }

      case TypeCategory.Never: {
        type = UnknownType.create();
        break;
      }

      case TypeCategory.Class: {
        const typeResult = getTypeFromClassMember(node.memberName, baseType, memberName, usage, diag, MemberAccessFlags.None, baseTypeResult.bindToType);
        type = typeResult?.type;
        if (typeResult?.isIncomplete) {
          isIncomplete = true;
        }
        break;
      }

      case TypeCategory.TypeVar: {
        if (baseType.details.isParamSpec) {
          if (memberName === 'args') {
            if (node.parent?.nodeType !== ParseNodeType.Parameter || node.parent.category !== ParameterCategory.VarArgList) {
              addError(Localizer.Diag.paramSpecArgsUsage(), node);
              return { type: UnknownType.create(), node };
            }
            return { type: baseType, node };
          }

          if (memberName === 'kwargs') {
            if (node.parent?.nodeType !== ParseNodeType.Parameter || node.parent.category !== ParameterCategory.VarArgDictionary) {
              addError(Localizer.Diag.paramSpecKwargsUsage(), node);
              return { type: UnknownType.create(), node };
            }
            return { type: baseType, node };
          }

          addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.paramSpecUnknownMember().format({ name: memberName }), node);
          return { type: UnknownType.create(), node };
        }

        if (flags & EvaluatorFlags.ExpectingType) {
          addDiag(
            getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.typeVarNoMember().format({ type: printType(baseType), name: memberName }),
            node.leftExpression
          );

          return { type: UnknownType.create(), node };
        }

        if (baseType.details.recursiveTypeAliasName) {
          return { type: UnknownType.create(), node, isIncomplete: true };
        }

        return getTypeFromMemberAccessWithBaseType(
          node,
          {
            type: makeTopLevelTypeVarsConcrete(baseType),
            node,
            bindToType: baseType,
          },
          usage,
          EvaluatorFlags.None
        );
      }

      case TypeCategory.Object: {
        const classFromTypeObject = transformTypeObjectToClass(baseType);
        if (TypeBase.isInstantiable(classFromTypeObject)) {
          return getTypeFromMemberAccessWithBaseType(node, { type: classFromTypeObject, node: baseTypeResult.node, bindToType: baseTypeResult.bindToType }, usage, flags);
        }

        if (ClassType.isEnumClass(baseType.classType) && baseType.classType.literalValue instanceof EnumLiteral) {
          if (memberName === 'name' || memberName === '_name_') {
            const strClass = getBuiltInType(node, 'str');
            if (isClass(strClass)) {
              return {
                node,
                type: ObjectType.create(ClassType.cloneWithLiteral(strClass, baseType.classType.literalValue.itemName)),
              };
            }
          } else if (memberName === 'value' || memberName === '_value_') {
            return { node, type: baseType.classType.literalValue.itemType };
          }
        }

        const typeResult = getTypeFromObjectMember(node.memberName, baseType, memberName, usage, diag, /* memberAccessFlags */ undefined, baseTypeResult.bindToType);
        type = typeResult?.type;
        if (typeResult?.isIncomplete) {
          isIncomplete = true;
        }
        break;
      }

      case TypeCategory.Module: {
        const symbol = ModuleType.getField(baseType, memberName);
        if (symbol) {
          if (usage.method === 'get') {
            setSymbolAccessed(getFileInfo(node), symbol, node.memberName);
          }

          type = getEffectiveTypeOfSymbolForUsage(symbol, /* usageNode */ undefined, /* useLastDecl */ true).type;

          if (isUnbound(type)) {
            type = UnknownType.create();
          }
        } else {
          if (usage.method === 'get') {
            const getAttrSymbol = ModuleType.getField(baseType, '__getattr__');
            if (getAttrSymbol) {
              const isModuleGetAttrSupported =
                fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_7 || getAttrSymbol.getDeclarations().some((decl) => decl.path.toLowerCase().endsWith('.pyi'));

              if (isModuleGetAttrSupported) {
                const getAttrTypeResult = getEffectiveTypeOfSymbolForUsage(getAttrSymbol);
                if (isFunction(getAttrTypeResult.type)) {
                  type = getFunctionEffectiveReturnType(getAttrTypeResult.type);
                  if (getAttrTypeResult.isIncomplete) {
                    isIncomplete = true;
                  }
                }
              }
            }
          }

          if (!type) {
            addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.moduleUnknownMember().format({ name: memberName }), node.memberName);
            type = UnknownType.create();
          }
        }
        break;
      }

      case TypeCategory.Union: {
        type = mapSubtypes(baseType, (subtype) => {
          if (isNone(subtype)) {
            addDiag(
              getFileInfo(node).diagnosticRuleSet.reportOptionalMemberAccess,
              DiagRule.reportOptionalMemberAccess,
              Localizer.Diag.noneUnknownMember().format({ name: memberName }),
              node.memberName
            );
            return undefined;
          } else if (isUnbound(subtype)) {
            return undefined;
          } else {
            const typeResult = getTypeFromMemberAccessWithBaseType(
              node,
              {
                type: subtype,
                node,
              },
              usage,
              EvaluatorFlags.None
            );
            return typeResult.type;
          }
        });
        break;
      }

      case TypeCategory.Function:
      case TypeCategory.OverloadedFunction: {
        const functionObj = getBuiltInObject(node, 'function');

        if (functionObj && memberName !== '__defaults__') {
          type = getTypeFromMemberAccessWithBaseType(node, { type: functionObj, node }, usage, flags).type;
        } else {
          type = AnyType.create();
        }
        break;
      }

      default:
        diag.addMessage(Localizer.DiagAddendum.typeUnsupported().format({ type: printType(baseType) }));
        break;
    }

    if (!type) {
      let diagMessage = Localizer.Diag.memberAccess();
      if (usage.method === 'set') {
        diagMessage = Localizer.Diag.memberSet();
      } else if (usage.method === 'del') {
        diagMessage = Localizer.Diag.memberDelete();
      }

      if (usage.setExpectedTypeDiag) {
        diag = usage.setExpectedTypeDiag;
      }

      const isFunctionRule = isFunction(baseType) || isOverloadedFunction(baseType) || (isObject(baseType) && ClassType.isBuiltIn(baseType.classType, 'function'));
      const [ruleSet, rule] = isFunctionRule
        ? [fileInfo.diagnosticRuleSet.reportFunctionMemberAccess, DiagRule.reportFunctionMemberAccess]
        : [fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues];

      addDiag(ruleSet, rule, diagMessage.format({ name: memberName, type: printType(baseType) }) + diag.getString(), node.memberName);

      type = isFunctionRule ? AnyType.create() : UnknownType.create();
    }

    if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
      if (isClass(type) && !type.typeArguments) {
        type = createSpecializedClassType(type, undefined, flags, node);
      }
    }

    if (usage.method === 'get') {
      if (node.parent?.nodeType !== ParseNodeType.Argument || !isClass(type)) {
        if (!isIncomplete) {
          reportPossibleUnknownAssignment(fileInfo.diagnosticRuleSet.reportUnknownMemberType, DiagRule.reportUnknownMemberType, node.memberName, type, node);
        }
      }
    }

    return { type, node, isIncomplete };
  }

  function getTypeFromClassMemberName(
    errorNode: ExpressionNode,
    classType: ClassType,
    memberName: string,
    usage: EvaluatorUsage,
    diag: DiagAddendum,
    flags: MemberAccessFlags,
    bindToType?: ClassType | ObjectType | TypeVarType
  ): ClassMemberLookup | undefined {
    let classLookupFlags = ClassMemberLookupFlags.Default;
    if (flags & MemberAccessFlags.AccessClassMembersOnly) {
      classLookupFlags |= ClassMemberLookupFlags.SkipInstanceVariables;
    }
    if (flags & MemberAccessFlags.SkipBaseClasses) {
      classLookupFlags |= ClassMemberLookupFlags.SkipBaseClasses;
    }
    if (flags & MemberAccessFlags.SkipObjectBaseClass) {
      classLookupFlags |= ClassMemberLookupFlags.SkipObjectBaseClass;
    }

    let memberInfo = lookUpClassMember(classType, memberName, classLookupFlags | ClassMemberLookupFlags.DeclaredTypesOnly);

    if (!memberInfo) {
      memberInfo = lookUpClassMember(classType, memberName, classLookupFlags);
    }

    if (memberInfo) {
      let type: Type | undefined;
      let isTypeIncomplete = false;

      if (usage.method === 'get') {
        const typeResult = getTypeOfMemberInternal(errorNode, memberInfo);
        if (typeResult) {
          type = typeResult.type;
          if (typeResult.isIncomplete) {
            isTypeIncomplete = true;
          }
        } else {
          type = UnknownType.create();
        }
      } else {
        const containingClass = ParseTreeUtils.getEnclosingClass(errorNode);
        if (containingClass) {
          const containingClassType = getTypeOfClass(containingClass)?.classType;
          if (containingClassType && isClass(containingClassType) && ClassType.isSameGenericClass(containingClassType, classType)) {
            type = getDeclaredTypeOfSymbol(memberInfo.symbol) || UnknownType.create();
            if (type && isClass(memberInfo.classType)) {
              type = partiallySpecializeType(type, memberInfo.classType);
            }
          }
        }

        if (!type) {
          const typeResult = getTypeOfMemberInternal(errorNode, memberInfo);
          if (typeResult) {
            type = typeResult.type;
            if (typeResult.isIncomplete) {
              isTypeIncomplete = true;
            }
          } else {
            type = UnknownType.create();
          }
        }
      }

      if (ClassType.isTypedDictClass(classType)) {
        const typedDecls = memberInfo.symbol.getTypedDeclarations();
        if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Variable) {
          diag.addMessage(Localizer.DiagAddendum.memberUnknown().format({ name: memberName }));
          return undefined;
        }
      }

      if (usage.method === 'get') {
        if (isClass(memberInfo.classType) && ClassType.isSameGenericClass(memberInfo.classType, classType)) {
          setSymbolAccessed(getFileInfo(errorNode), memberInfo.symbol, errorNode);
        }
      }

      const objectAccessType = applyDescriptorAccessMethod(
        type,
        memberInfo,
        classType,
        bindToType,
        /* isAccessedThroughObject */ (flags & MemberAccessFlags.AccessClassMembersOnly) === 0,
        flags,
        errorNode,
        memberName,
        usage,
        diag
      );

      if (!objectAccessType) {
        return undefined;
      }
      type = objectAccessType;

      if (usage.method === 'set') {
        if (!canAssignType(type, usage.setType!, diag.createAddendum())) {
          diag.addMessage(
            Localizer.DiagAddendum.memberAssignment().format({
              type: printType(usage.setType!),
              name: memberName,
              classType: printObjectTypeForClass(classType),
            })
          );
          return undefined;
        }

        if (isClass(memberInfo.classType) && ClassType.isFrozenDataClass(memberInfo.classType) && (flags & MemberAccessFlags.AccessClassMembersOnly) === 0) {
          diag.addMessage(
            Localizer.DiagAddendum.dataclassFrozen().format({
              name: printType(ObjectType.create(memberInfo.classType)),
            })
          );
          return undefined;
        }
      }

      return {
        type,
        isTypeIncomplete,
        isClassMember: !memberInfo.isInstanceMember,
      };
    }

    if ((flags & (MemberAccessFlags.AccessClassMembersOnly | MemberAccessFlags.SkipAttributeAccessOverride)) === 0) {
      const generalAttrType = applyAttributeAccessOverride(classType, errorNode, usage);

      if (generalAttrType) {
        const objectAccessType = applyDescriptorAccessMethod(generalAttrType, memberInfo, classType, bindToType, /* isAccessedThroughObject */ false, flags, errorNode, memberName, usage, diag);

        if (!objectAccessType) {
          return undefined;
        }

        return {
          type: objectAccessType,
          isTypeIncomplete: false,
          isClassMember: false,
        };
      }
    }

    diag.addMessage(Localizer.DiagAddendum.memberUnknown().format({ name: memberName }));
    return undefined;
  }

  function applyDescriptorAccessMethod(
    type: Type,
    memberInfo: ClassMember | undefined,
    baseTypeClass: ClassType,
    bindToType: ObjectType | ClassType | TypeVarType | undefined,
    isAccessedThroughObject: boolean,
    flags: MemberAccessFlags,
    errorNode: ExpressionNode,
    memberName: string,
    usage: EvaluatorUsage,
    diag: DiagAddendum
  ): Type | undefined {
    const treatConstructorAsClassMember = (flags & MemberAccessFlags.TreatConstructorAsClassMethod) !== 0;
    let isTypeValid = true;

    type = mapSubtypes(type, (subtype) => {
      if (isObject(subtype)) {
        let accessMethodName: string;

        if (usage.method === 'get') {
          accessMethodName = '__get__';
        } else if (usage.method === 'set') {
          accessMethodName = '__set__';
        } else {
          accessMethodName = '__delete__';
        }

        const memberClassType = subtype.classType;
        const accessMethod = lookUpClassMember(memberClassType, accessMethodName, ClassMemberLookupFlags.SkipInstanceVariables);

        if (ClassType.isPropertyClass(subtype.classType)) {
          if (usage.method === 'set') {
            if (!accessMethod) {
              diag.addMessage(Localizer.DiagAddendum.propertyMissingSetter().format({ name: memberName }));
              isTypeValid = false;
              return undefined;
            }
          } else if (usage.method === 'del') {
            if (!accessMethod) {
              diag.addMessage(Localizer.DiagAddendum.propertyMissingDeleter().format({ name: memberName }));
              isTypeValid = false;
              return undefined;
            }
          }
        }

        if (accessMethod) {
          let accessMethodType = getTypeOfMember(accessMethod);
          const argList: FunctionArgument[] = [
            {
              argumentCategory: ArgumentCategory.Simple,
              type: subtype,
            },
            {
              argumentCategory: ArgumentCategory.Simple,
              type: isAccessedThroughObject ? bindToType || ObjectType.create(baseTypeClass) : NoneType.createInstance(),
            },
          ];

          if (usage.method === 'get') {
            argList.push({
              argumentCategory: ArgumentCategory.Simple,
              type: baseTypeClass,
            });
          } else if (usage.method === 'set') {
            argList.push({
              argumentCategory: ArgumentCategory.Simple,
              type: usage.setType,
            });
          }

          if (ClassType.isPropertyClass(subtype.classType) && memberInfo && isClass(memberInfo!.classType)) {
            if (isFunction(accessMethodType)) {
              getFunctionEffectiveReturnType(accessMethodType);
            } else if (isOverloadedFunction(accessMethodType)) {
              accessMethodType.overloads.forEach((overload) => {
                getFunctionEffectiveReturnType(overload);
              });
            }

            accessMethodType = partiallySpecializeType(accessMethodType, memberInfo.classType);
          }

          if (isOverloadedFunction(accessMethodType)) {
            const overload = findOverloadedFunctionType(errorNode, argList, accessMethodType, /* expectedType */ undefined, new TypeVarMap(getTypeVarScopeId(accessMethod.classType)));
            if (overload) {
              accessMethodType = overload;
            }
          }

          if (accessMethodType && isFunction(accessMethodType)) {
            const returnType = suppressDiags(errorNode, () => {
              const boundMethodType = bindFunctionToClassOrObject(subtype, accessMethodType as FunctionType, memberInfo && isClass(memberInfo.classType) ? memberInfo.classType : undefined, errorNode);

              if (boundMethodType && isFunction(boundMethodType)) {
                const callResult = validateFunctionArguments(errorNode, argList.slice(1), boundMethodType, new TypeVarMap(getTypeVarScopeId(boundMethodType)), /* skipUnknownArgCheck */ true);

                if (callResult.argumentErrors) {
                  isTypeValid = false;
                  return AnyType.create();
                }

                return usage.method === 'get' ? callResult.returnType || UnknownType.create() : AnyType.create();
              }
            });

            if (returnType) {
              return returnType;
            }
          }
        }
      } else if (isFunction(subtype) || isOverloadedFunction(subtype)) {
        if (!isAccessedThroughObject || !memberInfo?.isInstanceMember) {
          return bindFunctionToClassOrObject(
            isAccessedThroughObject ? ObjectType.create(baseTypeClass) : baseTypeClass,
            subtype,
            memberInfo && isClass(memberInfo.classType) ? memberInfo.classType : undefined,
            errorNode,
            /* recursionCount */ undefined,
            treatConstructorAsClassMember,
            bindToType
          );
        }
      }

      if (usage.method === 'set') {
        if (memberInfo?.symbol.isClassVar()) {
          if (flags & MemberAccessFlags.DisallowClassVarWrites) {
            diag.addMessage(Localizer.DiagAddendum.memberSetClassVar().format({ name: memberName }));
            return undefined;
          }
        }

        let enforceTargetType = false;

        if (memberInfo && memberInfo.symbol.hasTypedDeclarations()) {
          enforceTargetType = true;
        } else {
          if (memberInfo && !memberInfo.symbol.getDeclarations().some((decl) => decl.node === errorNode)) {
            enforceTargetType = true;
          }
        }

        if (enforceTargetType) {
          let effectiveType = subtype;

          if (isAccessedThroughObject) {
            if (!memberInfo!.isInstanceMember && isFunction(subtype)) {
              if (FunctionType.isClassMethod(subtype) || FunctionType.isInstanceMethod(subtype)) {
                effectiveType = FunctionType.clone(subtype, /* stripFirstParam */ true);
              }
            }
          }

          return effectiveType;
        }
      }

      return subtype;
    });

    return isTypeValid ? type : undefined;
  }

  function applyAttributeAccessOverride(classType: ClassType, errorNode: ExpressionNode, usage: EvaluatorUsage): Type | undefined {
    if (usage.method === 'get') {
      const getAttribType = getTypeFromClassMember(errorNode, classType, '__getattribute__', { method: 'get' }, new DiagAddendum(), MemberAccessFlags.SkipObjectBaseClass)?.type;

      if (getAttribType && isFunction(getAttribType)) {
        return getFunctionEffectiveReturnType(getAttribType);
      }

      const getAttrType = getTypeFromClassMember(errorNode, classType, '__getattr__', { method: 'get' }, new DiagAddendum(), MemberAccessFlags.SkipObjectBaseClass)?.type;
      if (getAttrType && isFunction(getAttrType)) {
        return getFunctionEffectiveReturnType(getAttrType);
      }
    } else if (usage.method === 'set') {
      const setAttrType = getTypeFromClassMember(errorNode, classType, '__setattr__', { method: 'get' }, new DiagAddendum(), MemberAccessFlags.SkipObjectBaseClass)?.type;
      if (setAttrType) {
        return AnyType.create();
      }
    } else {
      assert(usage.method === 'del');
      const delAttrType = getTypeFromClassMember(errorNode, classType, '__detattr__', { method: 'get' }, new DiagAddendum(), MemberAccessFlags.SkipObjectBaseClass)?.type;
      if (delAttrType) {
        return AnyType.create();
      }
    }

    return undefined;
  }

  function getTypeFromIndex(node: IndexNode, flags = EvaluatorFlags.None): TypeResult {
    const baseTypeResult = getTypeOfExpression(node.baseExpression, undefined, flags | EvaluatorFlags.DoNotSpecialize);

    if (flags & EvaluatorFlags.ExpectingType) {
      if (node.baseExpression.nodeType === ParseNodeType.StringList) {
        const fileInfo = getFileInfo(node);
        if (!fileInfo.isStubFile && fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_10) {
          addError(Localizer.Diag.stringNotSubscriptable(), node.baseExpression);
        }
      }
    }

    if ((flags & EvaluatorFlags.AllowForwardReferences) === 0) {
      const fileInfo = getFileInfo(node);
      if (isClass(baseTypeResult.type) && ClassType.isBuiltIn(baseTypeResult.type) && !baseTypeResult.type.aliasName) {
        const minPythonVersion = nonSubscriptableBuiltinTypes[baseTypeResult.type.details.fullName];
        if (minPythonVersion !== undefined && fileInfo.executionEnvironment.pythonVersion < minPythonVersion && !fileInfo.isStubFile) {
          addError(
            Localizer.Diag.classNotRuntimeSubscriptable().format({
              name: baseTypeResult.type.aliasName || baseTypeResult.type.details.name,
            }),
            node.baseExpression
          );
        }
      }
    }

    const indexTypeResult = getTypeFromIndexWithBaseType(node, baseTypeResult.type, { method: 'get' }, flags);

    if (isCodeFlowSupportedForReference(node)) {
      writeTypeCache(node, indexTypeResult.type, /* isIncomplete */ false);

      const codeFlowTypeResult = getFlowTypeOfReference(node, indeterminateSymbolId, indexTypeResult.type);
      if (codeFlowTypeResult.type) {
        indexTypeResult.type = codeFlowTypeResult.type;
      }

      if (codeFlowTypeResult.isIncomplete) {
        indexTypeResult.isIncomplete = true;
      }

      deleteTypeCacheEntry(node);
    }

    if (baseTypeResult.isIncomplete) {
      indexTypeResult.isIncomplete = true;
    }

    return indexTypeResult;
  }

  function adjustTypeArgumentsForVariadicTypeVar(typeArgs: TypeResult[], typeParameters: TypeVarType[]): TypeResult[] {
    const variadicIndex = typeParameters.findIndex((param) => isVariadicTypeVar(param));

    if (variadicIndex >= 0) {
      if (tupleClassType && isClass(tupleClassType)) {
        const variadicTypeResults = typeArgs.slice(variadicIndex, variadicIndex + 1 + typeArgs.length - typeParameters.length);

        if (variadicTypeResults.length === 1 && isVariadicTypeVar(variadicTypeResults[0].type)) {
          validateVariadicTypeVarIsUnpacked(variadicTypeResults[0].type, variadicTypeResults[0].node);
        } else {
          variadicTypeResults.forEach((arg, index) => {
            validateTypeArg(arg, /* allowEmptyTuple */ index === 0);
          });

          const variadicTypes: Type[] =
            variadicTypeResults.length === 1 && variadicTypeResults[0].isEmptyTupleShorthand ? [] : variadicTypeResults.map((typeResult) => convertToInstance(typeResult.type));

          const tupleObject = convertToInstance(
            specializeTupleClass(tupleClassType, variadicTypes, /* isTypeArgumentExplicit */ true, /* stripLiterals */ true, /* isForUnpackedVariadicTypeVar */ true)
          );

          typeArgs = [
            ...typeArgs.slice(0, variadicIndex),
            { node: typeArgs[variadicIndex].node, type: tupleObject },
            ...typeArgs.slice(variadicIndex + 1 + typeArgs.length - typeParameters.length, typeArgs.length),
          ];
        }
      }
    }

    return typeArgs;
  }

  function validateVariadicTypeVarIsUnpacked(type: TypeVarType, node: ParseNode) {
    if (!type.isVariadicUnpacked) {
      addError(
        Localizer.Diag.unpackedTypeVarTupleExpected().format({
          name1: type.details.name,
          name2: type.details.name,
        }),
        node
      );
      return false;
    }

    return true;
  }

  function getTypeFromIndexWithBaseType(node: IndexNode, baseType: Type, usage: EvaluatorUsage, flags: EvaluatorFlags): TypeResult {
    if (baseType.typeAliasInfo?.typeParameters && baseType.typeAliasInfo.typeParameters.length > 0 && !baseType.typeAliasInfo.typeArguments) {
      const typeParameters = baseType.typeAliasInfo.typeParameters;
      const typeArgs = adjustTypeArgumentsForVariadicTypeVar(getTypeArgs(node, flags), typeParameters);

      if (typeArgs.length > typeParameters.length && !typeParameters.some((typeVar) => typeVar.details.isVariadic)) {
        addError(
          Localizer.Diag.typeArgsTooMany().format({
            name: printType(baseType),
            expected: typeParameters.length,
            received: typeArgs.length,
          }),
          typeArgs[typeParameters.length].node
        );
      }

      const typeVarMap = new TypeVarMap(baseType.typeAliasInfo.typeVarScopeId);
      const diag = new DiagAddendum();
      typeParameters.forEach((param, index) => {
        const typeArgType: Type = index < typeArgs.length ? convertToInstance(typeArgs[index].type) : UnknownType.create();
        canAssignTypeToTypeVar(param, typeArgType, diag, typeVarMap);
      });

      if (!diag.isEmpty()) {
        addError(Localizer.Diag.typeNotSpecializable().format({ type: printType(baseType) }) + diag.getString(), node);
      }

      let type = applySolvedTypeVars(baseType, typeVarMap);
      if (baseType.typeAliasInfo && type !== baseType) {
        const typeArgs: Type[] = [];
        baseType.typeAliasInfo.typeParameters?.forEach((typeParam) => {
          typeArgs.push(typeVarMap.getTypeVarType(typeParam) || UnknownType.create());
        });

        type = TypeBase.cloneForTypeAlias(type, baseType.typeAliasInfo.name, baseType.typeAliasInfo.fullName, baseType.typeAliasInfo.typeVarScopeId, baseType.typeAliasInfo.typeParameters, typeArgs);
      }

      return { type, node };
    }

    if (isTypeAliasPlaceholder(baseType)) {
      const typeArgTypes = getTypeArgs(node, flags).map((t) => convertToInstance(t.type));
      const type = TypeBase.cloneForTypeAlias(baseType, baseType.details.recursiveTypeAliasName!, '', baseType.details.recursiveTypeAliasScopeId!, undefined, typeArgTypes);
      return { type, node };
    }

    let isIncomplete = false;

    const type = mapSubtypes(baseType, (subtype) => {
      subtype = transformTypeObjectToClass(subtype);
      const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

      if (isAnyOrUnknown(concreteSubtype)) {
        return concreteSubtype;
      }

      if (flags & EvaluatorFlags.ExpectingType) {
        if (isTypeVar(subtype)) {
          addDiag(
            getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.typeVarNotSubscriptable().format({ type: printType(subtype) }),
            node.baseExpression
          );

          getTypeArgs(node, flags, /* isAnnotatedClass */ false, /* hasCustomClassGetItem */ false);

          return UnknownType.create();
        }
      }

      if (isClass(concreteSubtype)) {
        if (usage.method === 'set') {
          addError(Localizer.Diag.genericClassAssigned(), node.baseExpression);
        } else if (usage.method === 'del') {
          addError(Localizer.Diag.genericClassDeleted(), node.baseExpression);
        }

        if (ClassType.isSpecialBuiltIn(concreteSubtype, 'Literal')) {
          return createLiteralType(node, flags);
        }

        if (ClassType.isBuiltIn(concreteSubtype, 'InitVar')) {
          const typeArgs = getTypeArgs(node, flags);
          if (typeArgs.length === 1) {
            return typeArgs[0].type;
          } else {
            addError(Localizer.Diag.typeArgsMismatchOne().format({ received: typeArgs.length }), node.baseExpression);
            return UnknownType.create();
          }
        }

        if (ClassType.isEnumClass(concreteSubtype)) {
          return ObjectType.create(concreteSubtype);
        }

        const isAnnotatedClass = isClass(concreteSubtype) && ClassType.isBuiltIn(concreteSubtype, 'Annotated');
        const hasCustomClassGetItem = isClass(concreteSubtype) && ClassType.hasCustomClassGetItem(concreteSubtype);

        let typeArgs = getTypeArgs(node, flags, isAnnotatedClass, hasCustomClassGetItem);
        if (!isAnnotatedClass) {
          typeArgs = adjustTypeArgumentsForVariadicTypeVar(typeArgs, concreteSubtype.details.typeParameters);
        }

        if (hasCustomClassGetItem) {
          return concreteSubtype;
        }

        return createSpecializedClassType(concreteSubtype, typeArgs, flags, node);
      }

      if (isObject(concreteSubtype)) {
        const typeResult = getTypeFromIndexedObject(node, concreteSubtype, usage);
        if (typeResult.isIncomplete) {
          isIncomplete = true;
        }
        return typeResult.type;
      }

      if (isNever(concreteSubtype)) {
        return UnknownType.create();
      }

      if (isNone(concreteSubtype)) {
        addDiag(getFileInfo(node).diagnosticRuleSet.reportOptionalSubscript, DiagRule.reportOptionalSubscript, Localizer.Diag.noneNotSubscriptable(), node.baseExpression);

        return UnknownType.create();
      }

      if (!isUnbound(concreteSubtype)) {
        const fileInfo = getFileInfo(node);
        addDiag(
          fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.typeNotSubscriptable().format({ type: printType(concreteSubtype) }),
          node.baseExpression
        );
      }

      return UnknownType.create();
    });

    node.items.forEach((item) => {
      getTypeOfExpression(item.valueExpression, /* expectedType */ undefined, flags & EvaluatorFlags.AllowForwardReferences);
    });

    return { type, node, isIncomplete };
  }

  function makeTupleObject(entryTypes: Type[], isUnspecifiedLength = false) {
    if (tupleClassType && isClass(tupleClassType)) {
      if (isUnspecifiedLength) {
        return convertToInstance(specializeTupleClass(tupleClassType, [combineTypes(entryTypes), AnyType.create(/* isEllipsis */ true)]));
      }
      return convertToInstance(specializeTupleClass(tupleClassType, entryTypes));
    }

    return UnknownType.create();
  }

  function getTypeFromIndexedObject(node: IndexNode, baseType: ObjectType, usage: EvaluatorUsage): TypeResult {
    if (ClassType.isTypedDictClass(baseType.classType)) {
      const typeFromTypedDict = getTypeFromIndexedTypedDict(node, baseType, usage);
      if (typeFromTypedDict) {
        return typeFromTypedDict;
      }
    }

    let magicMethodName: string;
    if (usage.method === 'get') {
      magicMethodName = '__getitem__';
    } else if (usage.method === 'set') {
      magicMethodName = '__setitem__';
    } else {
      assert(usage.method === 'del');
      magicMethodName = '__delitem__';
    }

    const itemMethodType = getTypeFromObjectMember(node, baseType, magicMethodName)?.type;

    if (!itemMethodType) {
      const fileInfo = getFileInfo(node);
      addDiag(
        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.Diag.methodNotDefinedOnType().format({
          name: magicMethodName,
          type: printType(baseType),
        }),
        node.baseExpression
      );
      return { node, type: UnknownType.create() };
    }

    if (node.items.length === 1 && !node.trailingComma && !node.items[0].name && node.items[0].argumentCategory === ArgumentCategory.Simple) {
      const baseTypeClass = baseType.classType;
      const index0Expr = node.items[0].valueExpression;
      const valueType = getTypeOfExpression(index0Expr).type;

      if (isObject(valueType) && ClassType.isBuiltIn(valueType.classType, 'int') && isLiteralType(valueType)) {
        const indexValue = valueType.classType.literalValue as number;
        const tupleType = getSpecializedTupleType(baseTypeClass);

        if (tupleType && tupleType.tupleTypeArguments) {
          if (isOpenEndedTupleClass(tupleType)) {
            return { node, type: tupleType.tupleTypeArguments[0] };
          } else if (indexValue >= 0 && indexValue < tupleType.tupleTypeArguments.length) {
            return { node, type: tupleType.tupleTypeArguments[indexValue] };
          } else if (indexValue < 0 && tupleType.tupleTypeArguments.length + indexValue >= 0) {
            return {
              node,
              type: tupleType.tupleTypeArguments[tupleType.tupleTypeArguments.length + indexValue],
            };
          }
        }
      }
    }

    const positionalArgs = node.items.filter((item) => item.argumentCategory === ArgumentCategory.Simple && !item.name);
    const unpackedListArgs = node.items.filter((item) => item.argumentCategory === ArgumentCategory.UnpackedList);

    const keywordArgs = node.items.filter((item) => item.argumentCategory === ArgumentCategory.Simple && !!item.name);
    const unpackedDictArgs = node.items.filter((item) => item.argumentCategory === ArgumentCategory.UnpackedDictionary);

    let positionalIndexType: Type;
    if (positionalArgs.length === 1 && unpackedListArgs.length === 0 && !node.trailingComma) {
      positionalIndexType = getTypeOfExpression(positionalArgs[0].valueExpression).type;
    } else if (positionalArgs.length === 0 && unpackedListArgs.length === 0) {
      positionalIndexType = tupleClassType && isClass(tupleClassType) ? convertToInstance(specializeTupleClass(tupleClassType, [])) : UnknownType.create();
    } else {
      const tupleEntries: Type[] = [];
      positionalArgs.forEach((arg) => {
        tupleEntries.push(getTypeOfExpression(arg.valueExpression).type);
      });
      unpackedListArgs.forEach((arg) => {
        const exprType = getTypeOfExpression(arg.valueExpression).type;
        const iterableType = getTypeFromIterator(exprType, /* isAsync */ false, arg) || UnknownType.create();
        tupleEntries.push(iterableType);
      });

      positionalIndexType = makeTupleObject(tupleEntries, unpackedListArgs.length > 0);
    }

    let argList: FunctionArgument[] = [
      {
        argumentCategory: ArgumentCategory.Simple,
        type: positionalIndexType,
      },
    ];

    if (usage.method === 'set') {
      argList.push({
        argumentCategory: ArgumentCategory.Simple,
        type: usage.setType || AnyType.create(),
      });
    }

    keywordArgs.forEach((arg) => {
      argList.push({
        argumentCategory: ArgumentCategory.Simple,
        valueExpression: arg.valueExpression,
        node: arg,
        name: arg.name,
      });
    });

    unpackedDictArgs.forEach((arg) => {
      argList.push({
        argumentCategory: ArgumentCategory.UnpackedDictionary,
        valueExpression: arg.valueExpression,
        node: arg,
      });
    });

    let callResult: CallResult | undefined;

    useSpeculativeMode(node, () => {
      callResult = validateCallArguments(node, argList, itemMethodType, new TypeVarMap(getTypeVarScopeId(itemMethodType)));

      if (callResult.argumentErrors) {
        if (isObject(positionalIndexType) && keywordArgs.length === 0 && unpackedDictArgs.length === 0) {
          const altArgList = [...argList];
          altArgList[0] = { ...altArgList[0] };
          const indexMethod = getTypeFromObjectMember(node, positionalIndexType, '__index__');

          if (indexMethod) {
            const intType = getBuiltInObject(node, 'int');
            if (isObject(intType)) {
              altArgList[0].type = intType;
            }
          }

          callResult = validateCallArguments(node, altArgList, itemMethodType, new TypeVarMap(getTypeVarScopeId(itemMethodType)));

          if (!callResult.argumentErrors) {
            argList = altArgList;
          }
        }
      }
    });

    callResult = validateCallArguments(node, argList, itemMethodType, new TypeVarMap(getTypeVarScopeId(itemMethodType)));

    return {
      node,
      type: callResult.returnType || UnknownType.create(),
      isIncomplete: !!callResult.isTypeIncomplete,
    };
  }

  function getTypeFromIndexedTypedDict(node: IndexNode, baseType: ObjectType, usage: EvaluatorUsage): TypeResult | undefined {
    if (node.items.length !== 1) {
      addError(Localizer.Diag.typeArgsMismatchOne().format({ received: node.items.length }), node);
      return { node, type: UnknownType.create() };
    }

    if (node.trailingComma || node.items[0].name || node.items[0].argumentCategory !== ArgumentCategory.Simple) {
      return undefined;
    }

    const entries = getTypedDictMembersForClass(baseType.classType, /* allowNarrowed */ true);

    const indexTypeResult = getTypeOfExpression(node.items[0].valueExpression);
    const indexType = indexTypeResult.type;
    let diag = new DiagAddendum();

    const resultingType = mapSubtypes(indexType, (subtype) => {
      if (isAnyOrUnknown(subtype)) {
        return subtype;
      }

      if (isObject(subtype) && ClassType.isBuiltIn(subtype.classType, 'str')) {
        if (subtype.classType.literalValue === undefined) {
          return UnknownType.create();
        }

        const entryName = subtype.classType.literalValue as string;
        const entry = entries.get(entryName);
        if (!entry) {
          diag.addMessage(
            Localizer.DiagAddendum.keyUndefined().format({
              name: entryName,
              type: printType(baseType),
            })
          );
          return UnknownType.create();
        } else if (!entry.isRequired && usage.method === 'get') {
          diag.addMessage(
            Localizer.DiagAddendum.keyNotRequired().format({
              name: entryName,
              type: printType(baseType),
            })
          );
        }

        if (usage.method === 'set') {
          canAssignType(entry.valueType, usage.setType!, diag);
        } else if (usage.method === 'del' && entry.isRequired) {
          const fileInfo = getFileInfo(node);
          addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.keyRequiredDeleted().format({ name: entryName }), node);
        }

        return entry.valueType;
      }

      diag.addMessage(Localizer.DiagAddendum.typeNotStringLiteral().format({ type: printType(subtype) }));
      return UnknownType.create();
    });

    if (usage.setExpectedTypeDiag) {
      diag = usage.setExpectedTypeDiag;
    }

    if (!diag.isEmpty()) {
      let typedDictDiag: string;
      if (usage.method === 'set') {
        typedDictDiag = Localizer.Diag.typedDictSet();
      } else if (usage.method === 'del') {
        typedDictDiag = Localizer.Diag.typedDictDelete();
      } else {
        typedDictDiag = Localizer.Diag.typedDictAccess();
      }

      const fileInfo = getFileInfo(node);
      addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, typedDictDiag + diag.getString(), node);
    }

    return { node, type: resultingType, isIncomplete: !!indexTypeResult.isIncomplete };
  }

  function getTypeArgs(node: IndexNode, flags: EvaluatorFlags, isAnnotatedClass = false, hasCustomClassGetItem = false): TypeResult[] {
    const typeArgs: TypeResult[] = [];
    const adjFlags = flags & ~(EvaluatorFlags.DoNotSpecialize | EvaluatorFlags.ParamSpecDisallowed | EvaluatorFlags.TypeVarTupleDisallowed);

    const getTypeArgTypeResult = (expr: ExpressionNode, argIndex: number) => {
      let typeResult: TypeResult;

      if (hasCustomClassGetItem || (isAnnotatedClass && argIndex > 0)) {
        typeResult = getTypeOfExpression(expr, /* expectedType */ undefined, EvaluatorFlags.ParamSpecDisallowed | EvaluatorFlags.TypeVarTupleDisallowed | EvaluatorFlags.DoNotSpecialize);
      } else {
        typeResult = getTypeArg(expr, adjFlags);
      }
      return typeResult;
    };

    if (
      node.items.length === 1 &&
      !node.trailingComma &&
      !node.items[0].name &&
      node.items[0].valueExpression.nodeType === ParseNodeType.Tuple &&
      node.items[0].valueExpression.expressions.length > 0
    ) {
      node.items[0].valueExpression.expressions.forEach((item, index) => {
        typeArgs.push(getTypeArgTypeResult(item, index));
      });
    } else {
      node.items.forEach((arg, index) => {
        const typeResult = getTypeArgTypeResult(arg.valueExpression, index);

        if (arg.argumentCategory !== ArgumentCategory.Simple) {
          if (arg.argumentCategory === ArgumentCategory.UnpackedList && isVariadicTypeVar(typeResult.type) && !typeResult.type.isVariadicUnpacked) {
            typeResult.type = TypeVarType.cloneForUnpacked(typeResult.type);
          } else {
            addError(Localizer.Diag.unpackedArgInTypeArgument(), arg.valueExpression);
            typeResult.type = UnknownType.create();
          }
        }

        if (arg.name) {
          addError(Localizer.Diag.keywordArgInTypeArgument(), arg.valueExpression);
        }

        typeArgs.push(typeResult);
      });
    }

    return typeArgs;
  }

  function getTypeArg(node: ExpressionNode, flags: EvaluatorFlags): TypeResult {
    let typeResult: TypeResult;

    let adjustedFlags =
      flags | EvaluatorFlags.ExpectingType | EvaluatorFlags.ExpectingTypeAnnotation | EvaluatorFlags.ConvertEllipsisToAny | EvaluatorFlags.EvaluateStringLiteralAsType | EvaluatorFlags.FinalDisallowed;

    const fileInfo = getFileInfo(node);
    if (fileInfo.isStubFile) {
      adjustedFlags |= EvaluatorFlags.AllowForwardReferences;
    }

    if (node.nodeType === ParseNodeType.List) {
      typeResult = {
        type: UnknownType.create(),
        typeList: node.entries.map((entry) => getTypeOfExpression(entry, undefined, adjustedFlags)),
        node,
      };
    } else {
      typeResult = getTypeOfExpression(node, /* expectedType */ undefined, adjustedFlags);
    }

    return typeResult;
  }

  function getTypeFromTuple(node: TupleNode, expectedType: Type | undefined, flags: EvaluatorFlags): TypeResult {
    if ((flags & EvaluatorFlags.ExpectingType) !== 0 && node.expressions.length === 0 && !expectedType) {
      return { type: makeTupleObject([]), node, isEmptyTupleShorthand: true };
    }

    let effectiveExpectedType = expectedType;

    if (expectedType && isUnion(expectedType)) {
      let matchingSubtype: Type | undefined;

      doForEachSubtype(expectedType, (subtype) => {
        if (!matchingSubtype) {
          const subtypeResult = useSpeculativeMode(node, () => {
            return getTypeFromTupleExpected(node, subtype);
          });

          if (subtypeResult) {
            matchingSubtype = subtype;
          }
        }
      });

      effectiveExpectedType = matchingSubtype;
    }

    if (effectiveExpectedType) {
      const result = getTypeFromTupleExpected(node, effectiveExpectedType);
      if (result) {
        return result;
      }
    }

    return getTypeFromTupleInferred(node, /* useAny */ !!expectedType);
  }

  function getTypeFromTupleExpected(node: TupleNode, expectedType: Type): TypeResult | undefined {
    expectedType = transformPossibleRecursiveTypeAlias(expectedType);
    if (!isObject(expectedType)) {
      return undefined;
    }

    if (!tupleClassType || !isClass(tupleClassType)) {
      return undefined;
    }

    const expectedTypes: Type[] = [];

    if (isTupleClass(expectedType.classType) && expectedType.classType.tupleTypeArguments) {
      if (isOpenEndedTupleClass(expectedType.classType)) {
        const homogenousType = transformPossibleRecursiveTypeAlias(expectedType.classType.tupleTypeArguments[0]);
        for (let i = 0; i < node.expressions.length; i++) {
          expectedTypes.push(homogenousType);
        }
      } else {
        expectedType.classType.tupleTypeArguments.forEach((typeArg) => {
          expectedTypes.push(transformPossibleRecursiveTypeAlias(typeArg));
        });
      }
    } else {
      const tupleTypeVarMap = new TypeVarMap(getTypeVarScopeId(tupleClassType));
      if (!populateTypeVarMapBasedOnExpectedType(tupleClassType, expectedType, tupleTypeVarMap, getTypeVarScopesForNode(node))) {
        return undefined;
      }

      const specializedTuple = applySolvedTypeVars(tupleClassType, tupleTypeVarMap) as ClassType;
      if (!specializedTuple.typeArguments || specializedTuple.typeArguments.length !== 1) {
        return undefined;
      }

      const homogenousType = transformPossibleRecursiveTypeAlias(specializedTuple.typeArguments[0]);
      for (let i = 0; i < node.expressions.length; i++) {
        expectedTypes.push(homogenousType);
      }
    }

    const entryTypeResults = node.expressions.map((expr, index) => getTypeOfExpression(expr, index < expectedTypes.length ? expectedTypes[index] : undefined));

    const expectedTypesContainLiterals = expectedTypes.some((type) => isLiteralTypeOrUnion(type));

    const type = convertToInstance(specializeTupleClass(tupleClassType, buildTupleTypesList(entryTypeResults), /* isTypeArgumentExplicit */ true, /* stripLiterals */ !expectedTypesContainLiterals));

    return { type, node };
  }

  function getTypeFromTupleInferred(node: TupleNode, useAny: boolean): TypeResult {
    const entryTypeResults = node.expressions.map((expr) => getTypeOfExpression(expr, useAny ? AnyType.create() : undefined));

    if (!tupleClassType || !isClass(tupleClassType)) {
      return { type: UnknownType.create(), node };
    }

    const type = convertToInstance(specializeTupleClass(tupleClassType, buildTupleTypesList(entryTypeResults)));

    return { type, node };
  }

  function buildTupleTypesList(entryTypeResults: TypeResult[]): Type[] {
    const entryTypes: Type[] = [];
    let isOpenEnded = false;

    for (const typeResult of entryTypeResults) {
      if (typeResult.unpackedType) {
        if (isObject(typeResult.unpackedType) && isTupleClass(typeResult.unpackedType.classType)) {
          const typeArgs = typeResult.unpackedType.classType.tupleTypeArguments;

          if (!typeArgs || isOpenEndedTupleClass(typeResult.unpackedType.classType)) {
            entryTypes.push(typeResult.type);
            isOpenEnded = true;
          } else {
            entryTypes.push(...typeArgs);
          }
        } else {
          entryTypes.push(typeResult.type);
          isOpenEnded = true;
        }
      } else {
        entryTypes.push(typeResult.type);
      }
    }

    if (isOpenEnded) {
      return [combineTypes(entryTypes), AnyType.create(/* isEllipsis */ true)];
    }

    return entryTypes;
  }

  function updateNamedTupleBaseClass(classType: ClassType, typeArgs: Type[], isTypeArgumentExplicit: boolean) {
    const namedTupleIndex = classType.details.mro.findIndex((c) => isClass(c) && ClassType.isBuiltIn(c, 'NamedTuple'));
    if (namedTupleIndex < 0 || classType.details.mro.length < namedTupleIndex + 2) {
      return;
    }

    const namedTupleClass = classType.details.mro[namedTupleIndex] as ClassType;
    const typedTupleClass = classType.details.mro[namedTupleIndex + 1];

    if (!isClass(typedTupleClass) || !isTupleClass(typedTupleClass)) {
      return;
    }

    const updatedTupleClass = specializeTupleClass(typedTupleClass, typeArgs, isTypeArgumentExplicit);

    const clonedNamedTupleClass = ClassType.cloneForSpecialization(namedTupleClass, [], isTypeArgumentExplicit);
    clonedNamedTupleClass.details = { ...clonedNamedTupleClass.details };
    clonedNamedTupleClass.details.mro = [...clonedNamedTupleClass.details.mro];
    clonedNamedTupleClass.details.mro[1] = updatedTupleClass.details.mro[0];

    clonedNamedTupleClass.details.baseClasses = clonedNamedTupleClass.details.baseClasses.map((baseClass) => {
      if (isClass(baseClass) && isTupleClass(baseClass)) {
        return updatedTupleClass;
      }
      return baseClass;
    });

    classType.details.mro[namedTupleIndex] = clonedNamedTupleClass;
    classType.details.mro[namedTupleIndex + 1] = updatedTupleClass;

    classType.details.baseClasses = classType.details.baseClasses.map((baseClass) => {
      if (isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'NamedTuple')) {
        return clonedNamedTupleClass;
      }
      return baseClass;
    });
  }

  function getTypeFromCall(node: CallNode, expectedType: Type | undefined): TypeResult {
    const baseTypeResult = getTypeOfExpression(node.leftExpression, undefined, EvaluatorFlags.DoNotSpecialize);

    const argList = node.arguments.map((arg) => {
      const functionArg: FunctionArgument = {
        valueExpression: arg.valueExpression,
        argumentCategory: arg.argumentCategory,
        node: arg,
        name: arg.name,
      };
      return functionArg;
    });

    let returnResult: TypeResult = { node, type: UnknownType.create() };

    if (!isTypeAliasPlaceholder(baseTypeResult.type)) {
      if (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === 'super') {
        returnResult = getTypeFromSuperCall(node);
      } else if (isAnyOrUnknown(baseTypeResult.type) && node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === 'reveal_type') {
        if (node.arguments.length === 1 && node.arguments[0].argumentCategory === ArgumentCategory.Simple && node.arguments[0].name === undefined) {
          returnResult.type = getTypeFromRevealType(node);
        } else {
          addError(Localizer.Diag.revealTypeArgs(), node);
        }
      } else if (isAnyOrUnknown(baseTypeResult.type) && node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === 'reveal_locals') {
        if (node.arguments.length === 0) {
          returnResult.type = getTypeFromRevealLocals(node);
        } else {
          addError(Localizer.Diag.revealLocalsArgs(), node);
        }
      } else {
        const callResult = validateCallArguments(node, argList, baseTypeResult.type, /* typeVarMap */ undefined, /* skipUnknownArgCheck */ false, expectedType);
        returnResult.type = callResult.returnType || UnknownType.create();
        if (callResult.argumentErrors) {
          returnResult.typeErrors = true;
        }
      }

      if (baseTypeResult.isIncomplete) {
        returnResult.isIncomplete = true;
      }
    } else {
      returnResult.isIncomplete = true;
    }

    const isCyclicalTypeVarCall = isClass(baseTypeResult.type) && ClassType.isBuiltIn(baseTypeResult.type, 'TypeVar') && getFileInfo(node).isTypingStubFile;

    if (!isCyclicalTypeVarCall) {
      argList.forEach((arg, index) => {
        if (arg.node!.valueExpression.nodeType !== ParseNodeType.StringList) {
          getTypeForArgument(arg);
        }
      });
    }

    return returnResult;
  }

  function getTypeFromRevealType(node: CallNode) {
    const type = getTypeOfExpression(node.arguments[0].valueExpression).type;
    const exprString = ParseTreeUtils.printExpression(node.arguments[0].valueExpression);
    const typeString = printType(type);
    addInformation(Localizer.DiagAddendum.typeOfSymbol().format({ name: exprString, type: typeString }), node.arguments[0]);

    const strType = getBuiltInType(node, 'str');
    if (isClass(strType)) {
      return ObjectType.create(ClassType.cloneWithLiteral(strType, typeString));
    }

    return AnyType.create();
  }

  function getTypeFromRevealLocals(node: CallNode) {
    let curNode: ParseNode | undefined = node;
    let scope: Scope | undefined;

    while (curNode) {
      scope = ScopeUtils.getScopeForNode(curNode);

      if (scope && scope.type !== ScopeType.ListComprehension) {
        break;
      }

      curNode = curNode.parent;
    }

    const infoMessages: string[] = [];

    if (scope) {
      scope.symbolTable.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
          const typeOfSymbol = getEffectiveTypeOfSymbol(symbol);
          infoMessages.push(Localizer.DiagAddendum.typeOfSymbol().format({ name, type: printType(typeOfSymbol) }));
        }
      });
    }

    if (infoMessages.length > 0) {
      addInformation(infoMessages.join('\n'), node);
    } else {
      addInformation(Localizer.Diag.revealLocalsNone(), node);
    }

    return NoneType.createInstance();
  }

  function getTypeFromSuperCall(node: CallNode): TypeResult {
    if (node.arguments.length > 2) {
      addError(Localizer.Diag.superCallArgCount(), node.arguments[2]);
    }

    let targetClassType: Type;
    if (node.arguments.length > 0) {
      targetClassType = getTypeOfExpression(node.arguments[0].valueExpression).type;

      if (!isAnyOrUnknown(targetClassType) && !isClass(targetClassType)) {
        addDiag(
          getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.superCallFirstArg().format({ type: printType(targetClassType) }),
          node.arguments[0].valueExpression
        );
      }
    } else {
      const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
      if (enclosingClass) {
        const classTypeInfo = getTypeOfClass(enclosingClass);
        targetClassType = classTypeInfo ? classTypeInfo.classType : UnknownType.create();
      } else {
        addError(Localizer.Diag.superCallZeroArgForm(), node.leftExpression);
        targetClassType = UnknownType.create();
      }
    }

    let bindToType: ClassType | ObjectType | undefined;
    if (node.arguments.length > 1) {
      const secondArgType = makeTopLevelTypeVarsConcrete(getTypeOfExpression(node.arguments[1].valueExpression).type);

      let reportError = false;

      if (isAnyOrUnknown(secondArgType)) {
      } else if (isObject(secondArgType)) {
        if (isClass(targetClassType)) {
          if (!derivesFromClassRecursive(secondArgType.classType, targetClassType, /* ignoreUnknown */ true)) {
            reportError = true;
          }
        }
        bindToType = secondArgType;
      } else if (isClass(secondArgType)) {
        if (isClass(targetClassType)) {
          if (!derivesFromClassRecursive(secondArgType, targetClassType, /* ignoreUnknown */ true)) {
            reportError = true;
          }
        }
        bindToType = secondArgType;
      } else {
        reportError = true;
      }

      if (reportError) {
        const fileInfo = getFileInfo(node);
        addDiag(
          fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.superCallSecondArg().format({ type: printType(targetClassType) }),
          node.arguments[1].valueExpression
        );
      }
    }

    const parentNode = node.parent!;
    if (parentNode.nodeType === ParseNodeType.MemberAccess) {
      const memberName = parentNode.memberName.value;
      const lookupResults = lookUpClassMember(targetClassType, memberName, ClassMemberLookupFlags.SkipOriginalClass);
      if (lookupResults && isClass(lookupResults.classType)) {
        return {
          type: ObjectType.create(lookupResults.classType),
          node,
          bindToType,
        };
      }
    }

    if (isClass(targetClassType)) {
      if (targetClassType.details.mro.some((mroBase) => isAnyOrUnknown(mroBase))) {
        return {
          type: UnknownType.create(),
          node,
        };
      }

      const baseClasses = targetClassType.details.baseClasses;
      if (baseClasses.length > 0) {
        const baseClassType = baseClasses[0];
        if (isClass(baseClassType)) {
          return {
            type: ObjectType.create(baseClassType),
            node,
          };
        }
      }
    }

    return {
      type: UnknownType.create(),
      node,
    };
  }

  function findOverloadedFunctionType(
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    callType: OverloadedFunctionType,
    expectedType: Type | undefined,
    typeVarMap?: TypeVarMap
  ): FunctionType | undefined {
    let validOverload: FunctionType | undefined;

    for (const overload of callType.overloads) {
      if (FunctionType.isOverloaded(overload)) {
        const effectiveTypeVarMap = typeVarMap ? typeVarMap.clone() : new TypeVarMap(getTypeVarScopeId(overload));

        effectiveTypeVarMap.addSolveForScope(getTypeVarScopeId(overload));

        useSpeculativeMode(errorNode, () => {
          const callResult = validateFunctionArguments(errorNode, argList, overload, effectiveTypeVarMap, /* skipUnknownArgCheck */ true, expectedType);
          if (!callResult.argumentErrors) {
            validOverload = overload;
          }
        });

        if (validOverload) {
          break;
        }
      }
    }

    return validOverload;
  }

  function validateConstructorArguments(errorNode: ExpressionNode, argList: FunctionArgument[], type: ClassType, skipUnknownArgCheck: boolean, expectedType: Type | undefined): CallResult {
    let validatedTypes = false;
    let returnType: Type | undefined;
    let reportedErrors = false;

    const skipConstructorCheck = (type: Type) => {
      return isFunction(type) && FunctionType.isSkipConstructorCheck(type);
    };

    const initMethodType = getTypeFromObjectMember(
      errorNode,
      ObjectType.create(type),
      '__init__',
      { method: 'get' },
      new DiagAddendum(),
      MemberAccessFlags.SkipObjectBaseClass | MemberAccessFlags.SkipAttributeAccessOverride
    )?.type;

    if (initMethodType && !skipConstructorCheck(initMethodType)) {
      if (expectedType) {
        returnType = mapSubtypes(expectedType, (expectedSubType) => {
          expectedSubType = transformPossibleRecursiveTypeAlias(expectedSubType);
          const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));
          if (populateTypeVarMapBasedOnExpectedType(type, expectedSubType, typeVarMap, getTypeVarScopesForNode(errorNode))) {
            let callResult: CallResult | undefined;
            suppressDiags(errorNode, () => {
              callResult = validateCallArguments(errorNode, argList, initMethodType, typeVarMap.clone(), skipUnknownArgCheck, NoneType.createInstance());
            });

            if (!callResult?.argumentErrors) {
              validateCallArguments(errorNode, argList, initMethodType, typeVarMap, skipUnknownArgCheck, NoneType.createInstance());
              return applyExpectedSubtypeForConstructor(type, expectedSubType, typeVarMap);
            }
          }

          return undefined;
        });

        if (isNever(returnType)) {
          returnType = undefined;
        }
      }

      if (!returnType) {
        const typeVarMap = type.typeArguments ? buildTypeVarMapFromSpecializedClass(type, /* makeConcrete */ false) : new TypeVarMap(getTypeVarScopeId(type));

        typeVarMap.addSolveForScope(getTypeVarScopeId(initMethodType));
        const callResult = validateCallArguments(errorNode, argList, initMethodType, typeVarMap, skipUnknownArgCheck);

        if (!callResult.argumentErrors) {
          returnType = applyExpectedTypeForConstructor(type, /* expectedType */ undefined, typeVarMap);
        } else {
          reportedErrors = true;
        }
      }

      validatedTypes = true;
      skipUnknownArgCheck = true;
    }

    if (!reportedErrors) {
      const constructorMethodInfo = getTypeFromClassMemberName(
        errorNode,
        type,
        '__new__',
        { method: 'get' },
        new DiagAddendum(),
        MemberAccessFlags.AccessClassMembersOnly | MemberAccessFlags.SkipObjectBaseClass | MemberAccessFlags.TreatConstructorAsClassMethod,
        type
      );
      if (constructorMethodInfo && !skipConstructorCheck(constructorMethodInfo.type)) {
        const constructorMethodType = constructorMethodInfo.type;
        const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));

        if (constructorMethodType) {
          const callResult = validateCallArguments(errorNode, argList, constructorMethodType, typeVarMap, skipUnknownArgCheck);

          if (callResult.argumentErrors) {
            reportedErrors = true;
          } else {
            let newReturnType = callResult.returnType;

            if (newReturnType) {
              if (isObject(newReturnType) && ClassType.isSameGenericClass(newReturnType.classType, type)) {
                if ((!isPartlyUnknown(newReturnType) && !requiresSpecialization(newReturnType)) || returnType === undefined) {
                  if (
                    isObject(newReturnType) &&
                    ClassType.isTupleClass(newReturnType.classType) &&
                    newReturnType.classType.tupleTypeArguments &&
                    newReturnType.classType.tupleTypeArguments.length === 1
                  ) {
                    newReturnType = ObjectType.create(specializeTupleClass(newReturnType.classType, [newReturnType.classType.tupleTypeArguments[0], AnyType.create(/* isEllipsis */ true)]));
                  }

                  returnType = newReturnType;
                }
              }
            }
          }

          if (!returnType) {
            returnType = applyExpectedTypeForConstructor(type, expectedType, typeVarMap);
          }
          validatedTypes = true;
        }
      }
    }

    if (!validatedTypes) {
      argList.forEach((arg) => {
        if (arg.valueExpression && !speculativeTypeTracker.isSpeculative(arg.valueExpression)) {
          getTypeOfExpression(arg.valueExpression);
        }
      });
    }

    if (!validatedTypes && argList.length > 0) {
      const isCustomMetaclass = !!type.details.effectiveMetaclass && isClass(type.details.effectiveMetaclass) && !ClassType.isBuiltIn(type.details.effectiveMetaclass);

      if (!isCustomMetaclass) {
        const fileInfo = getFileInfo(errorNode);
        addDiag(
          fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.constructorNoArgs().format({ type: type.aliasName || type.details.name }),
          errorNode
        );
      }
    }

    if (!returnType) {
      const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));
      if (expectedType) {
        populateTypeVarMapBasedOnExpectedType(type, expectedType, typeVarMap, getTypeVarScopesForNode(errorNode));
      }
      returnType = applyExpectedTypeForConstructor(type, expectedType, typeVarMap);
    }

    return { argumentErrors: reportedErrors, returnType };
  }

  function applyExpectedSubtypeForConstructor(type: ClassType, expectedSubtype: Type, typeVarMap: TypeVarMap): Type | undefined {
    const specializedType = applySolvedTypeVars(ObjectType.create(type), typeVarMap, /* unknownIfNotFound */ true);

    if (!canAssignType(expectedSubtype, specializedType, new DiagAddendum())) {
      return undefined;
    }

    if (isAny(expectedSubtype)) {
      return expectedSubtype;
    }

    return specializedType;
  }

  function applyExpectedTypeForConstructor(type: ClassType, expectedType: Type | undefined, typeVarMap: TypeVarMap): Type {
    if (expectedType) {
      const specializedExpectedType = mapSubtypes(expectedType, (expectedSubtype) => {
        return applyExpectedSubtypeForConstructor(type, expectedSubtype, typeVarMap);
      });

      if (!isNever(specializedExpectedType)) {
        return specializedExpectedType;
      }
    }

    const specializedType = applySolvedTypeVars(type, typeVarMap, /* unknownIfNotFound */ true) as ClassType;
    return ObjectType.create(specializedType);
  }

  function populateTypeVarMapBasedOnExpectedType(type: ClassType, expectedType: Type, typeVarMap: TypeVarMap, liveTypeVarScopes: TypeVarScopeId[]): boolean {
    if (isAny(expectedType)) {
      type.details.typeParameters.forEach((typeParam) => {
        typeVarMap.setTypeVarType(typeParam, expectedType);
      });
      return true;
    }

    if (!isObject(expectedType)) {
      return false;
    }

    const expectedTypeArgs = expectedType.classType.typeArguments;
    if (!expectedTypeArgs) {
      return canAssignType(type, expectedType.classType, new DiagAddendum(), typeVarMap);
    }

    if (ClassType.isSameGenericClass(expectedType.classType, type)) {
      const sameClassTypeVarMap = buildTypeVarMapFromSpecializedClass(expectedType.classType);
      sameClassTypeVarMap.getTypeVars().forEach((entry) => {
        const typeVarType = sameClassTypeVarMap.getTypeVarType(entry.typeVar);
        typeVarMap.setTypeVarType(
          entry.typeVar,
          entry.typeVar.details.variance === Variance.Covariant ? undefined : typeVarType,
          entry.typeVar.details.variance === Variance.Contravariant ? undefined : typeVarType,
          entry.retainLiteral
        );
      });
      return true;
    }

    const expectedTypeScopeId = getTypeVarScopeId(expectedType.classType);
    const synthExpectedTypeArgs = ClassType.getTypeParameters(expectedType.classType).map((typeParam, index) => {
      const typeVar = TypeVarType.createInstance(`__dest${index}`);
      typeVar.details.isSynthesized = true;
      typeVar.details.variance = typeParam.details.variance;
      typeVar.scopeId = expectedTypeScopeId;
      return typeVar;
    });
    const genericExpectedType = ClassType.cloneForSpecialization(expectedType.classType, synthExpectedTypeArgs, /* isTypeArgumentExplicit */ true);

    const typeArgs = ClassType.getTypeParameters(type).map((_, index) => {
      const typeVar = TypeVarType.createInstance(`__source${index}`);
      typeVar.details.isSynthesized = true;
      typeVar.details.synthesizedIndex = index;
      return typeVar;
    });

    const specializedType = ClassType.cloneForSpecialization(type, typeArgs, /* isTypeArgumentExplicit */ true);
    const syntheticTypeVarMap = new TypeVarMap(expectedTypeScopeId);
    if (canAssignType(genericExpectedType, specializedType, new DiagAddendum(), syntheticTypeVarMap)) {
      synthExpectedTypeArgs.forEach((typeVar, index) => {
        const synthTypeVar = syntheticTypeVarMap.getTypeVarType(typeVar);

        if (synthTypeVar && isTypeVar(synthTypeVar) && synthTypeVar.details.isSynthesized && synthTypeVar.details.synthesizedIndex !== undefined) {
          const targetTypeVar = ClassType.getTypeParameters(specializedType)[synthTypeVar.details.synthesizedIndex];
          if (index < expectedTypeArgs.length) {
            const expectedTypeArgValue = transformExpectedTypeForConstructor(expectedTypeArgs[index], typeVarMap, liveTypeVarScopes);
            if (expectedTypeArgValue) {
              typeVarMap.setTypeVarType(
                targetTypeVar,
                typeVar.details.variance === Variance.Covariant ? undefined : expectedTypeArgValue,
                typeVar.details.variance === Variance.Contravariant ? undefined : expectedTypeArgValue
              );
            }
          }
        }
      });

      return true;
    }

    return false;
  }

  function validateCallArguments(errorNode: ExpressionNode, argList: FunctionArgument[], callType: Type, typeVarMap?: TypeVarMap, skipUnknownArgCheck = false, expectedType?: Type): CallResult {
    let argumentErrors = false;
    let overloadUsed: FunctionType | undefined;
    let isTypeIncomplete = false;

    const returnType = mapSubtypes(callType, (subtype) => {
      let isTypeObject = false;
      if (isObject(subtype) && ClassType.isBuiltIn(subtype.classType, 'Type')) {
        subtype = transformTypeObjectToClass(subtype);
        isTypeObject = true;
      }

      const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

      switch (concreteSubtype.category) {
        case TypeCategory.Unknown:
        case TypeCategory.Any: {
          argList.forEach((arg) => {
            if (arg.valueExpression && !speculativeTypeTracker.isSpeculative(arg.valueExpression)) {
              getTypeForArgument(arg);
            }
          });

          return concreteSubtype;
        }

        case TypeCategory.Union: {
          const callResult = validateCallArguments(errorNode, argList, concreteSubtype, typeVarMap, skipUnknownArgCheck, expectedType);
          if (callResult.argumentErrors) {
            argumentErrors = true;
          }
          if (callResult.overloadUsed) {
            overloadUsed = callResult.overloadUsed;
          }
          if (callResult.isTypeIncomplete) {
            isTypeIncomplete = true;
          }
          return callResult.returnType;
        }

        case TypeCategory.Function: {
          if (concreteSubtype.details.builtInName === 'namedtuple') {
            addDiag(getFileInfo(errorNode).diagnosticRuleSet.reportUntypedNamedTuple, DiagRule.reportUntypedNamedTuple, Localizer.Diag.namedTupleNoTypes(), errorNode);
            return createNamedTupleType(errorNode, argList, false);
          }

          if (concreteSubtype.details.builtInName === 'NewType') {
            const callResult = validateFunctionArguments(errorNode, argList, concreteSubtype, new TypeVarMap(getTypeVarScopeId(concreteSubtype)), skipUnknownArgCheck, expectedType);

            if (callResult.isTypeIncomplete) {
              isTypeIncomplete = true;
            }

            return callResult.argumentErrors ? callResult.returnType : createNewType(errorNode, argList);
          }

          const functionResult = validateFunctionArguments(errorNode, argList, concreteSubtype, typeVarMap || new TypeVarMap(getTypeVarScopeId(concreteSubtype)), skipUnknownArgCheck, expectedType);
          if (functionResult.argumentErrors) {
            argumentErrors = true;
          }
          if (functionResult.isTypeIncomplete) {
            isTypeIncomplete = true;
          }

          if (concreteSubtype.details.builtInName === '__import__') {
            return AnyType.create();
          }

          return functionResult.returnType;
        }

        case TypeCategory.OverloadedFunction: {
          const functionType = findOverloadedFunctionType(errorNode, argList, concreteSubtype, expectedType, typeVarMap);

          if (functionType) {
            if (functionType.details.builtInName === 'cast' && argList.length === 2) {
              const castToType = getTypeForArgumentExpectingType(argList[0]);
              const castFromType = getTypeForArgument(argList[1]);
              if (isClass(castToType) && isObject(castFromType)) {
                if (isTypeSame(castToType, castFromType.classType)) {
                  addDiag(
                    getFileInfo(errorNode).diagnosticRuleSet.reportUnnecessaryCast,
                    DiagRule.reportUnnecessaryCast,
                    Localizer.Diag.unnecessaryCast().format({
                      type: printType(castFromType),
                    }),
                    errorNode
                  );
                }
              }

              return convertToInstance(castToType);
            }

            const effectiveTypeVarMap = typeVarMap || new TypeVarMap(getTypeVarScopeId(concreteSubtype));
            effectiveTypeVarMap.addSolveForScope(getTypeVarScopeId(functionType));
            const functionResult = validateFunctionArguments(errorNode, argList, functionType, effectiveTypeVarMap, skipUnknownArgCheck, expectedType);

            overloadUsed = functionType;
            if (functionResult.argumentErrors) {
              argumentErrors = true;
            }
            if (functionResult.isTypeIncomplete) {
              isTypeIncomplete = true;
            }

            return functionResult.returnType || UnknownType.create();
          }

          if (!isDiagSuppressedForNode(errorNode)) {
            const functionName = concreteSubtype.overloads[0].details.name || '<anonymous function>';
            const diagAddendum = new DiagAddendum();
            const argTypes = argList.map((t) => printType(getTypeForArgument(t)));

            diagAddendum.addMessage(Localizer.DiagAddendum.argumentTypes().format({ types: argTypes.join(', ') }));
            addDiag(
              getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.noOverload().format({ name: functionName }) + diagAddendum.getString(),
              errorNode
            );
          }

          argumentErrors = true;
          return UnknownType.create();
        }

        case TypeCategory.Class: {
          if (concreteSubtype.literalValue !== undefined) {
            addDiag(getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.literalNotCallable(), errorNode);
            argumentErrors = true;
            return UnknownType.create();
          }

          if (ClassType.isBuiltIn(concreteSubtype)) {
            const className = concreteSubtype.aliasName || concreteSubtype.details.name;

            if (className === 'type') {
              validateConstructorArguments(errorNode, argList, concreteSubtype, skipUnknownArgCheck, expectedType);

              if (argList.length === 1) {
                const argType = getTypeForArgument(argList[0]);
                if (isObject(argType) || (isTypeVar(argType) && TypeBase.isInstance(argType))) {
                  return convertToInstantiable(stripLiteralValue(argType));
                }
              } else if (argList.length >= 2) {
                return createType(errorNode, argList) || AnyType.create();
              }

              return AnyType.create();
            }

            if (className === 'TypeVar') {
              return createTypeVarType(errorNode, argList);
            }

            if (className === 'TypeVarTuple') {
              return createTypeVarTupleType(errorNode, argList);
            }

            if (className === 'ParamSpec') {
              return createParamSpecType(errorNode, argList);
            }

            if (className === 'NamedTuple') {
              return createNamedTupleType(errorNode, argList, true);
            }

            if (className === 'Protocol' || className === 'Generic' || className === 'Callable' || className === 'Concatenate' || className === 'Type') {
              const fileInfo = getFileInfo(errorNode);
              addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeNotIntantiable().format({ type: className }), errorNode);
              return AnyType.create();
            }

            if (className === 'Enum' || className === 'IntEnum' || className === 'Flag' || className === 'IntFlag') {
              return createEnumType(errorNode, concreteSubtype, argList);
            }

            if (className === 'TypedDict') {
              return createTypedDictType(errorNode, concreteSubtype, argList);
            }

            if (className === 'auto' && argList.length === 0) {
              return getBuiltInObject(errorNode, 'int');
            }
          }

          if (!isTypeObject && ClassType.hasAbstractMethods(concreteSubtype)) {
            const abstractMethods = getAbstractMethods(concreteSubtype);
            const diagAddendum = new DiagAddendum();
            const errorsToDisplay = 2;

            abstractMethods.forEach((abstractMethod, index) => {
              if (index === errorsToDisplay) {
                diagAddendum.addMessage(
                  Localizer.DiagAddendum.memberIsAbstractMore().format({
                    count: abstractMethods.length - errorsToDisplay,
                  })
                );
              } else if (index < errorsToDisplay) {
                if (isClass(abstractMethod.classType)) {
                  const className = abstractMethod.classType.details.name;
                  diagAddendum.addMessage(
                    Localizer.DiagAddendum.memberIsAbstract().format({
                      type: className,
                      name: abstractMethod.symbolName,
                    })
                  );
                }
              }
            });

            const fileInfo = getFileInfo(errorNode);
            addDiag(
              fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.typeAbstract().format({ type: concreteSubtype.details.name }) + diagAddendum.getString(),
              errorNode
            );
          }

          if (!isTypeObject && ClassType.hasAbstractMethods(concreteSubtype)) {
            const abstractMethods = getAbstractMethods(concreteSubtype);
            const diagAddendum = new DiagAddendum();
            const errorsToDisplay = 2;

            abstractMethods.forEach((abstractMethod, index) => {
              if (index === errorsToDisplay) {
                diagAddendum.addMessage(
                  Localizer.DiagAddendum.memberIsAbstractMore().format({
                    count: abstractMethods.length - errorsToDisplay,
                  })
                );
              } else if (index < errorsToDisplay) {
                if (isClass(abstractMethod.classType)) {
                  const className = abstractMethod.classType.details.name;
                  diagAddendum.addMessage(
                    Localizer.DiagAddendum.memberIsAbstract().format({
                      type: className,
                      name: abstractMethod.symbolName,
                    })
                  );
                }
              }
            });

            const fileInfo = getFileInfo(errorNode);
            addDiag(
              fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.typeAbstract().format({ type: concreteSubtype.details.name }) + diagAddendum.getString(),
              errorNode
            );
          }

          const constructorResult = validateConstructorArguments(errorNode, argList, concreteSubtype, skipUnknownArgCheck, expectedType);
          if (constructorResult.argumentErrors) {
            argumentErrors = true;
          }
          let returnType = constructorResult.returnType;

          if (isTypeVar(subtype)) {
            returnType = convertToInstance(subtype);
          }

          if (returnType && isObject(returnType) && returnType.classType.details.mro.some((baseClass) => isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'type'))) {
            const newClassName = '__class_' + returnType.classType.details.name;
            const newClassType = ClassType.create(newClassName, '', '', ClassTypeFlags.None, getTypeSourceId(errorNode), returnType.classType, returnType.classType);
            newClassType.details.baseClasses.push(getBuiltInType(errorNode, 'object'));
            computeMroLinearization(newClassType);
            return newClassType;
          }

          return returnType;
        }

        case TypeCategory.Object: {
          const memberType = getTypeFromObjectMember(errorNode, concreteSubtype, '__call__')?.type;

          if (memberType && (isFunction(memberType) || isOverloadedFunction(memberType))) {
            const functionResult = validateCallArguments(errorNode, argList, memberType, typeVarMap, skipUnknownArgCheck, expectedType);
            if (functionResult.argumentErrors) {
              argumentErrors = true;
            }
            return functionResult.returnType || UnknownType.create();
          }

          addDiag(
            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.objectNotCallable().format({ type: printType(subtype) }),
            errorNode
          );
          return UnknownType.create();
        }

        case TypeCategory.None: {
          addDiag(getFileInfo(errorNode).diagnosticRuleSet.reportOptionalCall, DiagRule.reportOptionalCall, Localizer.Diag.noneNotCallable(), errorNode);
          return undefined;
        }
      }
    });

    return {
      argumentErrors,
      returnType: isNever(returnType) ? undefined : returnType,
      overloadUsed,
      isTypeIncomplete,
    };
  }

  function validateFunctionArguments(errorNode: ExpressionNode, argList: FunctionArgument[], type: FunctionType, typeVarMap: TypeVarMap, skipUnknownArgCheck = false, expectedType?: Type): CallResult {
    let argIndex = 0;
    const typeParams = type.details.parameters;
    let isTypeIncomplete = false;

    if (type.boundTypeVarScopeId) {
      typeVarMap.addSolveForScope(type.boundTypeVarScopeId);

      if (
        type.details.name === '__init__' &&
        FunctionType.isOverloaded(type) &&
        type.strippedFirstParamType &&
        type.boundToType &&
        isObject(type.strippedFirstParamType) &&
        isObject(type.boundToType) &&
        ClassType.isSameGenericClass(type.strippedFirstParamType.classType, type.boundToType.classType) &&
        type.strippedFirstParamType.classType.typeArguments
      ) {
        const typeParams = type.strippedFirstParamType!.classType.details.typeParameters;
        type.strippedFirstParamType.classType.typeArguments.forEach((typeArg, index) => {
          const typeParam = typeParams[index];
          if (!isTypeSame(typeParam, typeArg)) {
            typeVarMap.setTypeVarType(typeParams[index], typeArg);
          }
        });
      }
    }

    if (expectedType && !requiresSpecialization(expectedType) && type.details.declaredReturnType) {
      if (!isUnion(expectedType) || containsLiteralType(expectedType)) {
        canAssignType(getFunctionEffectiveReturnType(type), expectedType, new DiagAddendum(), typeVarMap, CanAssignFlags.AllowTypeVarNarrowing | CanAssignFlags.RetainLiteralsForTypeVar);
      }
    }

    const varArgDictParam = typeParams.find((param) => param.category === ParameterCategory.VarArgDictionary);
    let reportedArgError = false;

    const paramMap = new Map<string, ParamAssignmentInfo>();
    typeParams.forEach((param) => {
      if (param.name && param.category === ParameterCategory.Simple) {
        paramMap.set(param.name, {
          argsNeeded: param.category === ParameterCategory.Simple && !param.hasDefault ? 1 : 0,
          argsReceived: 0,
        });
      }
    });

    let positionalParamCount = typeParams.findIndex((param) => param.category === ParameterCategory.VarArgList && !param.name);

    const varArgListParamIndex = typeParams.findIndex((param) => param.category === ParameterCategory.VarArgList);
    const varArgDictParamIndex = typeParams.findIndex((param) => param.category === ParameterCategory.VarArgDictionary);

    let positionalOnlyIndex = typeParams.findIndex((param) => param.category === ParameterCategory.Simple && !param.name);

    if (positionalParamCount < 0) {
      positionalParamCount = varArgListParamIndex;
      if (positionalParamCount >= 0) {
        positionalParamCount++;
      }
    }

    if (positionalParamCount < 0) {
      positionalParamCount = varArgDictParamIndex;
    }

    let paramSpecArgList: FunctionArgument[] | undefined;
    let paramSpecTarget: TypeVarType | undefined;

    if (varArgListParamIndex >= 0 && varArgDictParamIndex >= 0) {
      const varArgListParam = typeParams[varArgListParamIndex];
      const varArgDictParam = typeParams[varArgDictParamIndex];
      if (
        varArgListParam.name &&
        varArgListParam.hasDeclaredType &&
        varArgListParam.typeAnnotation &&
        varArgListParam.typeAnnotation.nodeType === ParseNodeType.MemberAccess &&
        varArgListParam.typeAnnotation.memberName.value === 'args' &&
        varArgListParam.typeAnnotation.leftExpression.nodeType === ParseNodeType.Name &&
        varArgDictParam.name &&
        varArgDictParam.hasDeclaredType &&
        varArgDictParam.typeAnnotation &&
        varArgDictParam.typeAnnotation.nodeType === ParseNodeType.MemberAccess &&
        varArgDictParam.typeAnnotation.memberName.value === 'kwargs' &&
        varArgDictParam.typeAnnotation.leftExpression.nodeType === ParseNodeType.Name &&
        varArgListParam.typeAnnotation.leftExpression.value === varArgDictParam.typeAnnotation.leftExpression.value
      ) {
        const baseType = getTypeOfExpression(varArgListParam.typeAnnotation.leftExpression).type;
        if (isTypeVar(baseType) && baseType.details.isParamSpec) {
          if (baseType.scopeId === type.details.typeVarScopeId) {
            paramSpecArgList = [];
            paramSpecTarget = baseType;
          } else {
            positionalOnlyIndex = varArgListParamIndex;
          }
        }
      }
    }

    if (positionalParamCount < 0) {
      positionalParamCount = typeParams.length;
    }

    let positionalArgCount = argList.findIndex((arg) => arg.argumentCategory === ArgumentCategory.UnpackedDictionary || arg.name !== undefined);
    if (positionalArgCount < 0) {
      positionalArgCount = argList.length;
    }

    if (positionalOnlyIndex >= 0 && positionalArgCount < positionalOnlyIndex) {
      const firstParamWithDefault = typeParams.findIndex((param) => param.hasDefault);
      const positionOnlyWithoutDefaultsCount = firstParamWithDefault >= 0 && firstParamWithDefault < positionalOnlyIndex ? firstParamWithDefault : positionalOnlyIndex;
      positionalArgCount = Math.min(positionOnlyWithoutDefaultsCount, argList.length);
    }

    let validateArgTypeParams: ValidateArgTypeParams[] = [];

    let activeParam: FunctionParameter | undefined;
    function trySetActive(arg: FunctionArgument, param: FunctionParameter) {
      if (arg.active) {
        activeParam = param;
      }
    }

    let foundUnpackedListArg = argList.find((arg) => arg.argumentCategory === ArgumentCategory.UnpackedList) !== undefined;

    let paramIndex = 0;
    let unpackedArgIndex = 0;
    let unpackedParamIndex = 0;
    while (argIndex < positionalArgCount) {
      if (paramIndex === positionalOnlyIndex) {
        paramIndex++;
        continue;
      }

      if (argIndex < positionalOnlyIndex && argList[argIndex].name) {
        const fileInfo = getFileInfo(argList[argIndex].name!);
        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.argPositional(), argList[argIndex].name!);
        reportedArgError = true;
      }

      if (paramIndex >= positionalParamCount) {
        if (!foundUnpackedListArg || argList[argIndex].argumentCategory !== ArgumentCategory.UnpackedList) {
          addDiag(
            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            positionalParamCount === 1
              ? Localizer.Diag.argPositionalExpectedOne()
              : Localizer.Diag.argPositionalExpectedCount().format({
                  expected: positionalParamCount,
                }),
            argList[argIndex].valueExpression || errorNode
          );
          reportedArgError = true;
        }
        break;
      }

      const paramType = FunctionType.getEffectiveParameterType(type, paramIndex);
      if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedList) {
        if (!argList[argIndex].valueExpression) {
          break;
        }

        const isParamVariadic = typeParams[paramIndex].category === ParameterCategory.VarArgList && isVariadicTypeVar(paramType);
        let isArgCompatibleWithVariadic = false;
        const argType = getTypeForArgument(argList[argIndex]);
        let listElementType: Type;
        let advanceToNextArg = false;

        if (type.details.paramSpec && paramIndex < positionalParamCount) {
          addDiag(
            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            positionalParamCount === 1
              ? Localizer.Diag.argPositionalExpectedOne()
              : Localizer.Diag.argPositionalExpectedCount().format({
                  expected: positionalParamCount,
                }),
            argList[argIndex].valueExpression || errorNode
          );
          reportedArgError = true;
        }

        const combinedTupleType = combineSameSizedTuples(argType, tupleClassType);
        if (!isParamVariadic && combinedTupleType && isObject(combinedTupleType) && combinedTupleType.classType.tupleTypeArguments!.length > 0) {
          listElementType = combinedTupleType.classType.tupleTypeArguments![unpackedArgIndex];

          foundUnpackedListArg = argList.find((arg, index) => index > argIndex && arg.argumentCategory === ArgumentCategory.UnpackedList) !== undefined;

          unpackedArgIndex++;
          if (unpackedArgIndex >= combinedTupleType.classType.tupleTypeArguments!.length) {
            unpackedArgIndex = 0;
            advanceToNextArg = true;
          }
        } else if (isParamVariadic && isVariadicTypeVar(argType)) {
          listElementType = argType;
          isArgCompatibleWithVariadic = true;
        } else {
          listElementType = getTypeFromIterator(argType, /* isAsync */ false, argList[argIndex].valueExpression!) || UnknownType.create();

          if (isParamSpec(listElementType)) {
            listElementType = AnyType.create();
          }
        }

        const funcArg: FunctionArgument = {
          argumentCategory: ArgumentCategory.Simple,
          type: listElementType,
        };

        const paramName = typeParams[paramIndex].name;

        if (isParamVariadic && !isArgCompatibleWithVariadic) {
          addDiag(
            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.unpackedArgWithVariadicParam(),
            argList[argIndex].valueExpression || errorNode
          );
          reportedArgError = true;
        } else {
          validateArgTypeParams.push({
            paramCategory: typeParams[paramIndex].category,
            paramType,
            requiresTypeVarMatching: requiresSpecialization(paramType),
            argument: funcArg,
            errorNode: argList[argIndex].valueExpression || errorNode,
            paramName: typeParams[paramIndex].isNameSynthesized ? undefined : paramName,
          });
        }

        trySetActive(argList[argIndex], typeParams[paramIndex]);

        if (paramName && typeParams[paramIndex].category === ParameterCategory.Simple) {
          paramMap.get(paramName)!.argsReceived++;
        }

        if (advanceToNextArg || typeParams[paramIndex].category === ParameterCategory.VarArgList) {
          argIndex++;
        }

        if (typeParams[paramIndex].category !== ParameterCategory.VarArgList) {
          paramIndex++;
        }
      } else if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
        trySetActive(argList[argIndex], typeParams[paramIndex]);

        if (paramSpecArgList) {
          paramSpecArgList.push(argList[argIndex]);
        } else {
          let paramCategory = typeParams[paramIndex].category;
          let effectiveParamType = paramType;
          const paramName = typeParams[paramIndex].name;

          if (
            isVariadicTypeVar(typeParams[paramIndex].type) &&
            isObject(paramType) &&
            isTupleClass(paramType.classType) &&
            paramType.classType.tupleTypeArguments &&
            unpackedParamIndex < paramType.classType.tupleTypeArguments.length
          ) {
            effectiveParamType = paramType.classType.tupleTypeArguments[unpackedParamIndex];
            paramCategory = isVariadicTypeVar(effectiveParamType) ? ParameterCategory.VarArgList : ParameterCategory.Simple;

            unpackedParamIndex++;
            const paramsToFillCount = positionalArgCount - argIndex - 1;
            const argsRemainingCount = paramType.classType.tupleTypeArguments.length - unpackedParamIndex;

            if (unpackedParamIndex >= paramType.classType.tupleTypeArguments.length) {
              paramIndex++;
            } else if (argsRemainingCount > 0 && paramsToFillCount <= 0) {
              addDiag(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                argsRemainingCount === 1
                  ? Localizer.Diag.argMorePositionalExpectedOne()
                  : Localizer.Diag.argMorePositionalExpectedCount().format({
                      expected: argsRemainingCount,
                    }),
                argList[argIndex].valueExpression || errorNode
              );
              reportedArgError = true;
            }
          }

          validateArgTypeParams.push({
            paramCategory,
            paramType: effectiveParamType,
            requiresTypeVarMatching: requiresSpecialization(paramType),
            argument: argList[argIndex],
            errorNode: argList[argIndex].valueExpression || errorNode,
            paramName,
            mapsToVarArgList: true,
          });
        }
        argIndex++;
      } else {
        const paramName = typeParams[paramIndex].name;
        validateArgTypeParams.push({
          paramCategory: typeParams[paramIndex].category,
          paramType,
          requiresTypeVarMatching: requiresSpecialization(paramType),
          argument: argList[argIndex],
          errorNode: argList[argIndex].valueExpression || errorNode,
          paramName: typeParams[paramIndex].isNameSynthesized ? undefined : paramName,
        });
        trySetActive(argList[argIndex], typeParams[paramIndex]);

        if (paramName) {
          paramMap.get(paramName)!.argsReceived++;
        }

        argIndex++;
        paramIndex++;
      }
    }

    if (!reportedArgError) {
      let foundUnpackedDictionaryArg = false;

      while (argIndex < argList.length) {
        if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedDictionary) {
          const argType = getTypeForArgument(argList[argIndex]);
          const mappingType = getTypingType(errorNode, 'Mapping');
          const strObjType = getBuiltInObject(errorNode, 'str');

          if (mappingType && isClass(mappingType) && strObjType && isObject(strObjType)) {
            const strMapObject = ObjectType.create(ClassType.cloneForSpecialization(mappingType, [strObjType, AnyType.create()], /* isTypeArgumentExplicit */ true));
            const diag = new DiagAddendum();
            if (!isParamSpec(argType) && !canAssignType(strMapObject, argType, diag)) {
              addDiag(
                getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                Localizer.Diag.unpackedDictArgumentNotMapping() + diag.getString(),
                argList[argIndex].valueExpression || errorNode
              );
              reportedArgError = true;
            }
          }
          foundUnpackedDictionaryArg = true;
        } else {
          const paramName = argList[argIndex].name;
          if (paramName) {
            const paramNameValue = paramName.value;
            const paramEntry = paramMap.get(paramNameValue);
            if (paramEntry) {
              if (paramEntry.argsReceived > 0) {
                addDiag(
                  getFileInfo(paramName).diagnosticRuleSet.reportGeneralTypeIssues,
                  DiagRule.reportGeneralTypeIssues,
                  Localizer.Diag.paramAlreadyAssigned().format({ name: paramNameValue }),
                  paramName
                );
                reportedArgError = true;
              } else {
                paramMap.get(paramName.value)!.argsReceived++;

                const paramInfoIndex = typeParams.findIndex((param) => param.name === paramNameValue);
                assert(paramInfoIndex >= 0);
                const paramType = FunctionType.getEffectiveParameterType(type, paramInfoIndex);

                validateArgTypeParams.push({
                  paramCategory: ParameterCategory.Simple,
                  paramType,
                  requiresTypeVarMatching: requiresSpecialization(paramType),
                  argument: argList[argIndex],
                  errorNode: argList[argIndex].valueExpression || errorNode,
                  paramName: paramNameValue,
                });
                trySetActive(argList[argIndex], typeParams[paramInfoIndex]);
              }
            } else if (varArgDictParam) {
              assert(varArgDictParamIndex >= 0);
              if (paramSpecArgList) {
                paramSpecArgList.push(argList[argIndex]);
              } else {
                let paramInfo = paramMap.get(paramNameValue);
                if (paramInfo && paramInfo.argsReceived > 0) {
                  addDiag(
                    getFileInfo(paramName).diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagRule.reportGeneralTypeIssues,
                    Localizer.Diag.paramAlreadyAssigned().format({ name: paramNameValue }),
                    paramName
                  );
                  reportedArgError = true;
                } else {
                  const paramType = FunctionType.getEffectiveParameterType(type, varArgDictParamIndex);
                  validateArgTypeParams.push({
                    paramCategory: ParameterCategory.VarArgDictionary,
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(varArgDictParam.type),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: paramNameValue,
                  });

                  if (!paramInfo) {
                    paramInfo = { argsNeeded: 1, argsReceived: 1 };
                  }
                  paramMap.set(paramNameValue, paramInfo);
                }
              }
              trySetActive(argList[argIndex], varArgDictParam);
            } else {
              addDiag(
                getFileInfo(paramName).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                Localizer.Diag.paramNameMissing().format({ name: paramName.value }),
                paramName
              );
              reportedArgError = true;
            }
          } else if (argList[argIndex].argumentCategory === ArgumentCategory.Simple) {
            const adjustedCount = positionalParamCount;
            const fileInfo = getFileInfo(errorNode);
            addDiag(
              fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              adjustedCount === 1 ? Localizer.Diag.argPositionalExpectedOne() : Localizer.Diag.argPositionalExpectedCount().format({ expected: adjustedCount }),
              argList[argIndex].valueExpression || errorNode
            );
            reportedArgError = true;
          }
        }

        argIndex++;
      }

      if (!foundUnpackedDictionaryArg && !foundUnpackedListArg && !FunctionType.isDefaultParameterCheckDisabled(type)) {
        const unassignedParams = [...paramMap.keys()].filter((name) => {
          const entry = paramMap.get(name)!;
          return entry.argsReceived < entry.argsNeeded;
        });

        if (unassignedParams.length > 0) {
          const missingParamNames = unassignedParams.map((p) => `"${p}"`).join(', ');
          addDiag(
            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            unassignedParams.length === 1 ? Localizer.Diag.argMissingForParam().format({ name: missingParamNames }) : Localizer.Diag.argMissingForParams().format({ names: missingParamNames }),
            errorNode
          );
          reportedArgError = true;
        }

        typeParams.forEach((param, index) => {
          if (param.category === ParameterCategory.Simple && param.name) {
            const entry = paramMap.get(param.name)!;
            if (entry.argsNeeded === 0 && entry.argsReceived === 0) {
              const paramType = FunctionType.getEffectiveParameterType(type, index);

              if (param.defaultType && !isEllipsisType(param.defaultType) && requiresSpecialization(paramType)) {
                validateArgTypeParams.push({
                  paramCategory: param.category,
                  paramType: paramType,
                  requiresTypeVarMatching: true,
                  argument: {
                    argumentCategory: ArgumentCategory.Simple,
                    type: param.defaultType,
                  },
                  errorNode: errorNode,
                  paramName: param.isNameSynthesized ? undefined : param.name,
                });
              }
            }
          }
        });
      }
    }

    if (['cast', 'isinstance', 'issubclass'].some((name) => name === type.details.builtInName)) {
      skipUnknownArgCheck = true;
    }

    if (!reportedArgError || !speculativeTypeTracker.isSpeculative(undefined)) {
      if (varArgListParamIndex >= 0 && typeParams[varArgListParamIndex].hasDeclaredType) {
        const paramType = FunctionType.getEffectiveParameterType(type, varArgListParamIndex);
        const variadicArgs = validateArgTypeParams.filter((argParam) => argParam.mapsToVarArgList);

        if (isTypeVar(paramType) && paramType.details.isVariadic) {
          if (tupleClassType && isClass(tupleClassType)) {
            const tupleTypeArgs = variadicArgs.map((argParam) => stripLiteralValue(getTypeForArgument(argParam.argument)));
            const specializedTuple = ObjectType.create(
              specializeTupleClass(tupleClassType, tupleTypeArgs, /* isTypeArgumentExplicit */ true, /* stripLiterals */ true, /* isForUnpackedVariadicTypeVar */ true)
            );

            const combinedArg: ValidateArgTypeParams = {
              paramCategory: ParameterCategory.VarArgList,
              paramType,
              requiresTypeVarMatching: true,
              argument: { argumentCategory: ArgumentCategory.Simple, type: specializedTuple },
              errorNode,
              paramName: typeParams[varArgListParamIndex].name,
              mapsToVarArgList: true,
            };

            validateArgTypeParams = [...validateArgTypeParams.filter((argParam) => !argParam.mapsToVarArgList), combinedArg];
          }
        }
      }

      const typeVarMatchingCount = validateArgTypeParams.filter((arg) => arg.requiresTypeVarMatching).length;
      if (typeVarMatchingCount > 0) {
        const passCount = Math.min(typeVarMatchingCount, 2);
        for (let i = 0; i < passCount; i++) {
          useSpeculativeMode(errorNode, () => {
            validateArgTypeParams.forEach((argParam) => {
              if (argParam.requiresTypeVarMatching) {
                const argResult = validateArgType(argParam, typeVarMap, type.details.name, skipUnknownArgCheck);
                if (argResult.isTypeIncomplete) {
                  isTypeIncomplete = true;
                }
              }
            });
          });
        }

        typeVarMap.lock();
      }

      validateArgTypeParams.forEach((argParam) => {
        const argResult = validateArgType(argParam, typeVarMap, type.details.name, skipUnknownArgCheck);
        if (!argResult.isCompatible) {
          reportedArgError = true;
        } else if (argResult.isTypeIncomplete) {
          isTypeIncomplete = true;
        }
      });

      if (!incompleteTypeTracker.isUndoTrackingEnabled()) {
        argList.forEach((arg) => {
          if (arg.valueExpression && !speculativeTypeTracker.isSpeculative(arg.valueExpression)) {
            if (!validateArgTypeParams.some((validatedArg) => validatedArg.argument === arg)) {
              getTypeOfExpression(arg.valueExpression);
            }
          }
        });
      }
    }

    if (!reportedArgError && paramSpecArgList && paramSpecTarget) {
      if (!validateFunctionArgumentsForParamSpec(errorNode, paramSpecArgList, paramSpecTarget, typeVarMap)) {
        reportedArgError = true;
      }
    }

    const returnType = getFunctionEffectiveReturnType(type, validateArgTypeParams, !reportedArgError);
    const specializedReturnType = applySolvedTypeVars(returnType, typeVarMap);

    return { argumentErrors: reportedArgError, returnType: specializedReturnType, isTypeIncomplete, activeParam };
  }

  function validateFunctionArgumentsForParamSpec(errorNode: ExpressionNode, argList: FunctionArgument[], paramSpec: TypeVarType, typeVarMap: TypeVarMap): boolean {
    const paramSpecValue = typeVarMap.getParamSpec(paramSpec);

    if (!paramSpecValue) {
      addDiag(
        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.Diag.paramSpecNotBound().format({ type: printType(paramSpec) }),
        argList[0]?.valueExpression || errorNode
      );
      return false;
    }

    let reportedArgError = false;

    const paramMap = new Map<string, ParamSpecEntry>();
    paramSpecValue.forEach((param) => {
      if (param.name) {
        paramMap.set(param.name, param);
      }
    });

    let positionalIndex = 0;
    argList.forEach((arg) => {
      if (arg.argumentCategory === ArgumentCategory.Simple) {
        let paramType: Type | undefined;

        if (arg.name) {
          const paramInfo = paramMap.get(arg.name.value);
          if (paramInfo) {
            paramType = paramInfo.type;
            paramMap.delete(arg.name.value);
          } else {
            addDiag(
              getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.paramNameMissing().format({ name: arg.name.value }),
              arg.valueExpression || errorNode
            );
            reportedArgError = true;
          }
        } else {
          if (positionalIndex < paramSpecValue.length) {
            const paramInfo = paramSpecValue[positionalIndex];
            paramType = paramInfo.type;
            if (paramInfo.name) {
              paramMap.delete(paramInfo.name);
            }
          } else {
            addDiag(
              getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              paramSpecValue.length === 1
                ? Localizer.Diag.argPositionalExpectedOne()
                : Localizer.Diag.argPositionalExpectedCount().format({
                    expected: paramSpecValue.length,
                  }),
              arg.valueExpression || errorNode
            );
            reportedArgError = true;
          }

          positionalIndex++;
        }

        if (paramType) {
          if (
            !validateArgType(
              {
                paramCategory: ParameterCategory.Simple,
                paramType,
                requiresTypeVarMatching: false,
                argument: arg,
                errorNode: arg.valueExpression || errorNode,
              },
              typeVarMap,
              /* functionName */ '',
              /* skipUnknownArgCheck */ false
            )
          ) {
            reportedArgError = true;
          }
        }
      } else {
      }
    });

    if (!reportedArgError) {
      const unassignedParams = [...paramMap.keys()];

      if (unassignedParams.length > 0) {
        const missingParamNames = unassignedParams.map((p) => `"${p}"`).join(', ');
        addDiag(
          getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          unassignedParams.length === 1 ? Localizer.Diag.argMissingForParam().format({ name: missingParamNames }) : Localizer.Diag.argMissingForParams().format({ names: missingParamNames }),
          errorNode
        );
        reportedArgError = true;
      }
    }

    return !reportedArgError;
  }

  function validateArgType(argParam: ValidateArgTypeParams, typeVarMap: TypeVarMap, functionName: string, skipUnknownCheck: boolean): ArgResult {
    let argType: Type | undefined;
    let expectedTypeDiag: DiagAddendum | undefined;
    let isTypeIncomplete = false;

    if (argParam.argument.valueExpression) {
      let expectedType: Type | undefined = isTypeVar(argParam.paramType) ? undefined : applySolvedTypeVars(argParam.paramType, typeVarMap);

      if (expectedType && isUnknown(expectedType)) {
        expectedType = undefined;
      }

      const exprType = getTypeOfExpression(argParam.argument.valueExpression, expectedType);
      argType = exprType.type;
      if (exprType.isIncomplete) {
        isTypeIncomplete = true;
      }
      if (exprType.typeErrors) {
        return { isCompatible: false };
      }
      expectedTypeDiag = exprType.expectedTypeDiagAddendum;

      if (argParam.argument && argParam.argument.name && !speculativeTypeTracker.isSpeculative(argParam.errorNode)) {
        writeTypeCache(argParam.argument.name, expectedType || argType, !!exprType.isIncomplete);
      }
    } else {
      argType = getTypeForArgument(argParam.argument);
    }

    if (argParam.paramCategory === ParameterCategory.VarArgDictionary && isTypeVar(argParam.paramType)) {
      argType = stripLiteralValue(argType);
    }

    let diag = new DiagAddendum();

    if (!canAssignType(argParam.paramType, argType, diag.createAddendum(), typeVarMap)) {
      if (!isDiagSuppressedForNode(argParam.errorNode)) {
        const fileInfo = getFileInfo(argParam.errorNode);
        const argTypeText = printType(argType);
        const paramTypeText = printType(argParam.paramType);

        let message: string;
        if (argParam.paramName) {
          if (functionName) {
            message = Localizer.Diag.argAssignmentParamFunction().format({
              argType: argTypeText,
              paramType: paramTypeText,
              functionName,
              paramName: argParam.paramName,
            });
          } else {
            message = Localizer.Diag.argAssignmentParam().format({
              argType: argTypeText,
              paramType: paramTypeText,
              paramName: argParam.paramName,
            });
          }
        } else {
          if (functionName) {
            message = Localizer.Diag.argAssignmentFunction().format({
              argType: argTypeText,
              paramType: paramTypeText,
              functionName,
            });
          } else {
            message = Localizer.Diag.argAssignment().format({
              argType: argTypeText,
              paramType: paramTypeText,
            });
          }
        }

        if (expectedTypeDiag) {
          diag = expectedTypeDiag;
        }

        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, message + diag.getString(), argParam.errorNode);
      }
      return { isCompatible: false };
    } else if (!skipUnknownCheck) {
      const simplifiedType = removeUnbound(argType);
      const fileInfo = getFileInfo(argParam.errorNode);

      const getDiagAddendum = () => {
        const diagAddendum = new DiagAddendum();
        if (argParam.paramName) {
          diagAddendum.addMessage(
            (functionName
              ? Localizer.DiagAddendum.argParamFunction().format({
                  paramName: argParam.paramName,
                  functionName,
                })
              : Localizer.DiagAddendum.argParam().format({ paramName: argParam.paramName })) + diagAddendum.getString()
          );
        }
        return diagAddendum;
      };

      if (!isAny(argParam.paramType)) {
        if (isUnknown(simplifiedType)) {
          const diagAddendum = getDiagAddendum();
          addDiag(fileInfo.diagnosticRuleSet.reportUnknownArgumentType, DiagRule.reportUnknownArgumentType, Localizer.Diag.argTypeUnknown() + diagAddendum.getString(), argParam.errorNode);
        } else if (isPartlyUnknown(simplifiedType, true)) {
          if (!isPartlyUnknown(argParam.paramType) && !isClass(simplifiedType)) {
            const diagAddendum = getDiagAddendum();
            diagAddendum.addMessage(
              Localizer.DiagAddendum.argumentType().format({
                type: printType(simplifiedType, /* expandTypeAlias */ true),
              })
            );
            addDiag(fileInfo.diagnosticRuleSet.reportUnknownArgumentType, DiagRule.reportUnknownArgumentType, Localizer.Diag.argTypePartiallyUnknown() + diagAddendum.getString(), argParam.errorNode);
          }
        }
      }
    }

    return { isCompatible: true, isTypeIncomplete };
  }

  function createTypeVarType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
    let typeVarName = '';
    let firstConstraintArg: FunctionArgument | undefined;

    if (argList.length === 0) {
      addError(Localizer.Diag.typeVarFirstArg(), errorNode);
      return undefined;
    }

    const firstArg = argList[0];
    if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
      typeVarName = firstArg.valueExpression.strings.map((s) => s.value).join('');
    } else {
      addError(Localizer.Diag.typeVarFirstArg(), firstArg.valueExpression || errorNode);
    }

    const typeVar = TypeVarType.createInstantiable(typeVarName, /* isParamSpec */ false);

    for (let i = 1; i < argList.length; i++) {
      const paramNameNode = argList[i].name;
      const paramName = paramNameNode ? paramNameNode.value : undefined;
      const paramNameMap = new Map<string, string>();

      if (paramName) {
        if (paramNameMap.get(paramName)) {
          addError(Localizer.Diag.duplicateParam().format({ name: paramName }), argList[i].valueExpression || errorNode);
        }

        if (paramName === 'bound') {
          if (typeVar.details.constraints.length > 0) {
            addError(Localizer.Diag.typeVarBoundAndConstrained(), argList[i].valueExpression || errorNode);
          } else {
            const argType = getTypeForArgumentExpectingType(argList[i]);
            if (requiresSpecialization(argType)) {
              addError(Localizer.Diag.typeVarGeneric(), argList[i].valueExpression || errorNode);
            }
            typeVar.details.boundType = convertToInstance(argType);
          }
        } else if (paramName === 'covariant') {
          if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
            if (typeVar.details.variance === Variance.Contravariant) {
              addError(Localizer.Diag.typeVarVariance(), argList[i].valueExpression!);
            } else {
              typeVar.details.variance = Variance.Covariant;
            }
          }
        } else if (paramName === 'contravariant') {
          if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
            if (typeVar.details.variance === Variance.Covariant) {
              addError(Localizer.Diag.typeVarVariance(), argList[i].valueExpression!);
            } else {
              typeVar.details.variance = Variance.Contravariant;
            }
          }
        } else {
          addError(Localizer.Diag.typeVarUnknownParam().format({ name: paramName }), argList[i].node?.name || argList[i].valueExpression || errorNode);
        }

        paramNameMap.set(paramName, paramName);
      } else {
        if (typeVar.details.boundType) {
          addError(Localizer.Diag.typeVarBoundAndConstrained(), argList[i].valueExpression || errorNode);
        } else {
          const argType = getTypeForArgumentExpectingType(argList[i]);
          if (requiresSpecialization(argType)) {
            addError(Localizer.Diag.typeVarGeneric(), argList[i].valueExpression || errorNode);
          }
          TypeVarType.addConstraint(typeVar, convertToInstance(argType));
          if (firstConstraintArg === undefined) {
            firstConstraintArg = argList[i];
          }
        }
      }
    }

    if (typeVar.details.constraints.length === 1 && firstConstraintArg) {
      addDiag(
        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.Diag.typeVarSingleConstraint(),
        firstConstraintArg.valueExpression || errorNode
      );
    }

    return typeVar;
  }

  function createTypeVarTupleType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
    let typeVarName = '';

    if (argList.length === 0) {
      addError(Localizer.Diag.typeVarFirstArg(), errorNode);
      return undefined;
    }

    const firstArg = argList[0];
    if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
      typeVarName = firstArg.valueExpression.strings.map((s) => s.value).join('');
    } else {
      addError(Localizer.Diag.typeVarFirstArg(), firstArg.valueExpression || errorNode);
    }

    const typeVar = TypeVarType.createInstantiable(typeVarName, /* isParamSpec */ false);
    typeVar.details.isVariadic = true;

    for (let i = 1; i < argList.length; i++) {
      addError(Localizer.Diag.typeVarUnknownParam().format({ name: argList[i].name?.value || '?' }), argList[i].node?.name || argList[i].valueExpression || errorNode);
    }

    return typeVar;
  }

  function createParamSpecType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
    const fileInfo = getFileInfo(errorNode);
    if (!fileInfo.isStubFile && fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_9) {
      addError(Localizer.Diag.paramSpecIllegal(), errorNode);
    }

    if (argList.length === 0) {
      addError(Localizer.Diag.paramSpecFirstArg(), errorNode);
      return undefined;
    }

    const firstArg = argList[0];
    let paramSpecName = '';
    if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
      paramSpecName = firstArg.valueExpression.strings.map((s) => s.value).join('');
    } else {
      addError(Localizer.Diag.paramSpecFirstArg(), firstArg.valueExpression || errorNode);
    }

    const paramSpec = TypeVarType.createInstantiable(paramSpecName, /* isParamSpec */ true);

    for (let i = 1; i < argList.length; i++) {
      if (argList[i].name?.value) {
        addError(Localizer.Diag.paramSpecUnknownParam().format({ name: argList[i].name!.value }), argList[i].node?.name || argList[i].valueExpression || errorNode);
      } else {
        addError(Localizer.Diag.paramSpecUnknownArg(), argList[i].valueExpression || errorNode);
        break;
      }
    }

    return paramSpec;
  }

  function getBooleanValue(node: ExpressionNode): boolean {
    if (node.nodeType === ParseNodeType.Constant) {
      if (node.constType === KeywordType.False) {
        return false;
      } else if (node.constType === KeywordType.True) {
        return true;
      }
    }

    addError(Localizer.Diag.expectedBoolLiteral(), node);
    return false;
  }

  function getClassFullName(classNode: ParseNode, moduleName: string, className: string): string {
    const nameParts: string[] = [className];

    let curNode: ParseNode | undefined = classNode;

    while (curNode) {
      curNode = ParseTreeUtils.getEnclosingClass(curNode);
      if (curNode) {
        nameParts.push(curNode.name.value);
      }
    }

    nameParts.push(moduleName);

    return nameParts.reverse().join('.');
  }

  function getFunctionFullName(functionNode: ParseNode, moduleName: string, functionName: string): string {
    const nameParts: string[] = [functionName];

    let curNode: ParseNode | undefined = functionNode;

    while (curNode) {
      curNode = ParseTreeUtils.getEnclosingClassOrFunction(curNode);
      if (curNode) {
        nameParts.push(curNode.name.value);
      }
    }

    nameParts.push(moduleName);

    return nameParts.reverse().join('.');
  }

  function createEnumType(errorNode: ExpressionNode, enumClass: ClassType, argList: FunctionArgument[]): ClassType | undefined {
    const fileInfo = getFileInfo(errorNode);
    let className = 'enum';
    if (argList.length === 0) {
      return undefined;
    } else {
      const nameArg = argList[0];
      if (nameArg.argumentCategory === ArgumentCategory.Simple && nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
        className = nameArg.valueExpression.strings.map((s) => s.value).join('');
      } else {
        return undefined;
      }
    }

    const classType = ClassType.create(
      className,
      getClassFullName(errorNode, fileInfo.moduleName, className),
      fileInfo.moduleName,
      ClassTypeFlags.EnumClass,
      getTypeSourceId(errorNode),
      /* declaredMetaclass */ undefined,
      enumClass.details.effectiveMetaclass
    );
    classType.details.baseClasses.push(enumClass);
    computeMroLinearization(classType);

    const classFields = classType.details.fields;
    classFields.set('__class__', Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType));

    if (argList.length < 2) {
      return undefined;
    } else {
      const entriesArg = argList[1];
      if (entriesArg.argumentCategory !== ArgumentCategory.Simple || !entriesArg.valueExpression || entriesArg.valueExpression.nodeType !== ParseNodeType.StringList) {
        return undefined;
      } else {
        const entries = entriesArg.valueExpression.strings
          .map((s) => s.value)
          .join('')
          .split(' ');
        entries.forEach((entryName) => {
          entryName = entryName.trim();
          if (entryName) {
            const entryType = UnknownType.create();
            const newSymbol = Symbol.createWithType(SymbolFlags.ClassMember, entryType);

            const stringNode = entriesArg.valueExpression!;
            assert(stringNode.nodeType === ParseNodeType.StringList);
            const fileInfo = getFileInfo(errorNode);
            const declaration: VariableDeclaration = {
              type: DeclarationType.Variable,
              node: stringNode as StringListNode,
              path: fileInfo.filePath,
              range: convertOffsetsToRange(stringNode.start, TextRange.getEnd(stringNode), fileInfo.lines),
              moduleName: fileInfo.moduleName,
            };
            newSymbol.addDeclaration(declaration);
            classFields.set(entryName, newSymbol);
          }
        });
      }
    }

    return classType;
  }

  function createNewType(errorNode: ExpressionNode, argList: FunctionArgument[]): ClassType | undefined {
    const fileInfo = getFileInfo(errorNode);
    let className = '_';
    if (argList.length >= 1) {
      const nameArg = argList[0];
      if (nameArg.argumentCategory === ArgumentCategory.Simple) {
        if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
          className = nameArg.valueExpression.strings.map((s) => s.value).join('');
        }
      }
    }

    if (argList.length >= 2) {
      const baseClass = getTypeForArgumentExpectingType(argList[1]);

      if (isClass(baseClass)) {
        if (ClassType.isProtocolClass(baseClass)) {
          addError(Localizer.Diag.newTypeProtocolClass(), argList[1].node || errorNode);
        } else if (baseClass.literalValue !== undefined) {
          addError(Localizer.Diag.newTypeLiteral(), argList[1].node || errorNode);
        }

        const classFlags = baseClass.details.flags & ~(ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn);
        const classType = ClassType.create(
          className,
          getClassFullName(errorNode, fileInfo.moduleName, className),
          fileInfo.moduleName,
          classFlags,
          getTypeSourceId(errorNode),
          /* declaredMetaclass */ undefined,
          baseClass.details.effectiveMetaclass
        );
        classType.details.baseClasses.push(baseClass);
        computeMroLinearization(classType);

        const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(initType, {
          category: ParameterCategory.Simple,
          name: 'self',
          type: ObjectType.create(classType),
          hasDeclaredType: true,
        });
        FunctionType.addParameter(initType, {
          category: ParameterCategory.Simple,
          name: '_x',
          type: ObjectType.create(baseClass),
          hasDeclaredType: true,
        });
        initType.details.declaredReturnType = NoneType.createInstance();
        classType.details.fields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

        const newType = FunctionType.createInstance('__new__', '', '', FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(newType, {
          category: ParameterCategory.Simple,
          name: 'cls',
          type: classType,
          hasDeclaredType: true,
        });
        FunctionType.addDefaultParameters(newType);
        newType.details.declaredReturnType = ObjectType.create(classType);
        classType.details.fields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
        return classType;
      } else if (!isAnyOrUnknown(baseClass)) {
        addError(Localizer.Diag.newTypeNotAClass(), argList[1].node || errorNode);
      }
    }

    return undefined;
  }

  function createType(errorNode: ExpressionNode, argList: FunctionArgument[]): ClassType | undefined {
    const fileInfo = getFileInfo(errorNode);
    const arg0Type = getTypeForArgument(argList[0]);
    if (!isObject(arg0Type) || !ClassType.isBuiltIn(arg0Type.classType, 'str')) {
      return undefined;
    }
    const className = (arg0Type.classType.literalValue as string) || '_';

    const arg1Type = getTypeForArgument(argList[1]);
    if (!isObject(arg1Type) || !isTupleClass(arg1Type.classType) || arg1Type.classType.tupleTypeArguments === undefined) {
      return undefined;
    }

    const classType = ClassType.create(
      className,
      getClassFullName(errorNode, fileInfo.moduleName, className),
      fileInfo.moduleName,
      ClassTypeFlags.None,
      getTypeSourceId(errorNode),
      /* declaredMetaclass */ undefined,
      arg1Type.classType.details.effectiveMetaclass
    );
    arg1Type.classType.tupleTypeArguments.forEach((baseClass) => {
      if (isClass(baseClass) || isAnyOrUnknown(baseClass)) {
        classType.details.baseClasses.push(baseClass);
      } else {
        addExpectedClassDiag(baseClass, argList[1].valueExpression || errorNode);
      }
    });

    if (!computeMroLinearization(classType)) {
      addError(Localizer.Diag.methodOrdering(), errorNode);
    }

    return classType;
  }

  function createTypedDictType(errorNode: ExpressionNode, typedDictClass: ClassType, argList: FunctionArgument[]): ClassType {
    const fileInfo = getFileInfo(errorNode);

    let className = 'TypedDict';
    if (argList.length === 0) {
      addError(Localizer.Diag.typedDictFirstArg(), errorNode);
    } else {
      const nameArg = argList[0];
      if (nameArg.argumentCategory !== ArgumentCategory.Simple || !nameArg.valueExpression || nameArg.valueExpression.nodeType !== ParseNodeType.StringList) {
        addError(Localizer.Diag.typedDictFirstArg(), argList[0].valueExpression || errorNode);
      } else {
        className = nameArg.valueExpression.strings.map((s) => s.value).join('');
      }
    }

    const classType = ClassType.create(
      className,
      getClassFullName(errorNode, fileInfo.moduleName, className),
      fileInfo.moduleName,
      ClassTypeFlags.TypedDictClass,
      getTypeSourceId(errorNode),
      /* declaredMetaclass */ undefined,
      typedDictClass.details.effectiveMetaclass
    );
    classType.details.baseClasses.push(typedDictClass);
    computeMroLinearization(classType);

    const classFields = classType.details.fields;
    classFields.set('__class__', Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType));

    let usingDictSyntax = false;
    if (argList.length < 2) {
      addError(Localizer.Diag.typedDictSecondArgDict(), errorNode);
    } else {
      const entriesArg = argList[1];
      const entryMap = new Map<string, boolean>();

      if (entriesArg.argumentCategory === ArgumentCategory.Simple && entriesArg.valueExpression && entriesArg.valueExpression.nodeType === ParseNodeType.Dictionary) {
        usingDictSyntax = true;
        const entryDict = entriesArg.valueExpression;

        entryDict.entries.forEach((entry) => {
          if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
            addError(Localizer.Diag.typedDictSecondArgDictEntry(), entry);
            return;
          }

          if (entry.keyExpression.nodeType !== ParseNodeType.StringList) {
            addError(Localizer.Diag.typedDictEntryName(), entry.keyExpression);
            return;
          }

          const entryName = entry.keyExpression.strings.map((s) => s.value).join('');
          if (!entryName) {
            addError(Localizer.Diag.typedDictEmptyName(), entry.keyExpression);
            return;
          }

          if (entryMap.has(entryName)) {
            addError(Localizer.Diag.typedDictEntryUnique(), entry.keyExpression);
            return;
          }

          entryMap.set(entryName, true);

          getTypeForExpressionExpectingType(entry.valueExpression, /* allowFinal */ true);

          const newSymbol = new Symbol(SymbolFlags.InstanceMember);
          const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: entry.keyExpression,
            path: fileInfo.filePath,
            typeAnnotationNode: entry.valueExpression,
            range: convertOffsetsToRange(entry.keyExpression.start, TextRange.getEnd(entry.keyExpression), fileInfo.lines),
            moduleName: fileInfo.moduleName,
          };
          newSymbol.addDeclaration(declaration);

          classFields.set(entryName, newSymbol);
        });
      } else if (entriesArg.name) {
        for (let i = 1; i < argList.length; i++) {
          const entry = argList[i];
          if (!entry.name || !entry.valueExpression) {
            continue;
          }

          if (entryMap.has(entry.name.value)) {
            addError(Localizer.Diag.typedDictEntryUnique(), entry.valueExpression);
            continue;
          }

          entryMap.set(entry.name.value, true);

          getTypeForExpressionExpectingType(entry.valueExpression, /* allowFinal */ true);

          const newSymbol = new Symbol(SymbolFlags.InstanceMember);
          const fileInfo = getFileInfo(errorNode);
          const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: entry.name,
            path: fileInfo.filePath,
            typeAnnotationNode: entry.valueExpression,
            range: convertOffsetsToRange(entry.name.start, TextRange.getEnd(entry.valueExpression), fileInfo.lines),
            moduleName: fileInfo.moduleName,
          };
          newSymbol.addDeclaration(declaration);

          classFields.set(entry.name.value, newSymbol);
        }
      } else {
        addError(Localizer.Diag.typedDictSecondArgDict(), errorNode);
      }
    }

    if (usingDictSyntax) {
      if (argList.length >= 3) {
        if (
          !argList[2].name ||
          argList[2].name.value !== 'total' ||
          !argList[2].valueExpression ||
          argList[2].valueExpression.nodeType !== ParseNodeType.Constant ||
          !(argList[2].valueExpression.constType === KeywordType.False || argList[2].valueExpression.constType === KeywordType.True)
        ) {
          addError(Localizer.Diag.typedDictTotalParam(), argList[2].valueExpression || errorNode);
        } else if (argList[2].valueExpression.constType === KeywordType.False) {
          classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
        }
      }

      if (argList.length > 3) {
        addError(Localizer.Diag.typedDictExtraArgs(), argList[3].valueExpression || errorNode);
      }
    }

    synthesizeTypedDictClassMethods(errorNode, classType);

    return classType;
  }

  function createNamedTupleType(errorNode: ExpressionNode, argList: FunctionArgument[], includesTypes: boolean): ClassType {
    const fileInfo = getFileInfo(errorNode);
    let className = 'namedtuple';
    if (argList.length === 0) {
      addError(Localizer.Diag.namedTupleFirstArg(), errorNode);
    } else {
      const nameArg = argList[0];
      if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
        addError(Localizer.Diag.namedTupleFirstArg(), argList[0].valueExpression || errorNode);
      } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
        className = nameArg.valueExpression.strings.map((s) => s.value).join('');
      }
    }

    const namedTupleType = getTypingType(errorNode, 'NamedTuple') || UnknownType.create();

    const classType = ClassType.create(
      className,
      getClassFullName(errorNode, fileInfo.moduleName, className),
      fileInfo.moduleName,
      ClassTypeFlags.None,
      getTypeSourceId(errorNode),
      /* declaredMetaclass */ undefined,
      isClass(namedTupleType) ? namedTupleType.details.effectiveMetaclass : UnknownType.create()
    );
    classType.details.baseClasses.push(namedTupleType);

    const classFields = classType.details.fields;
    classFields.set('__class__', Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType));

    const constructorType = FunctionType.createInstance('__new__', '', '', FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod);
    constructorType.details.declaredReturnType = ObjectType.create(classType);
    if (ParseTreeUtils.isAssignmentToDefaultsFollowingNamedTuple(errorNode)) {
      constructorType.details.flags |= FunctionTypeFlags.DisableDefaultChecks;
    }
    FunctionType.addParameter(constructorType, {
      category: ParameterCategory.Simple,
      name: 'cls',
      type: classType,
      hasDeclaredType: true,
    });

    const selfParameter: FunctionParameter = {
      category: ParameterCategory.Simple,
      name: 'self',
      type: ObjectType.create(classType),
      hasDeclaredType: true,
    };

    let addGenericGetAttribute = false;
    const entryTypes: Type[] = [];

    if (argList.length < 2) {
      addError(Localizer.Diag.namedTupleSecondArg(), errorNode);
      addGenericGetAttribute = true;
    } else {
      const entriesArg = argList[1];
      if (entriesArg.argumentCategory !== ArgumentCategory.Simple) {
        addGenericGetAttribute = true;
      } else {
        if (!includesTypes && entriesArg.valueExpression && entriesArg.valueExpression.nodeType === ParseNodeType.StringList) {
          const entries = entriesArg.valueExpression.strings
            .map((s) => s.value)
            .join('')
            .split(/[,\s]+/);
          entries.forEach((entryName) => {
            entryName = entryName.trim();
            if (entryName) {
              const entryType = UnknownType.create();
              const paramInfo: FunctionParameter = {
                category: ParameterCategory.Simple,
                name: entryName,
                type: entryType,
                hasDeclaredType: includesTypes,
              };

              FunctionType.addParameter(constructorType, paramInfo);
              const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);

              const stringNode = entriesArg.valueExpression!;
              const declaration: VariableDeclaration = {
                type: DeclarationType.Variable,
                node: stringNode as StringListNode,
                path: fileInfo.filePath,
                range: convertOffsetsToRange(stringNode.start, TextRange.getEnd(stringNode), fileInfo.lines),
                moduleName: fileInfo.moduleName,
              };
              newSymbol.addDeclaration(declaration);
              classFields.set(entryName, newSymbol);
              entryTypes.push(entryType);
            }
          });
        } else if (entriesArg.valueExpression && entriesArg.valueExpression.nodeType === ParseNodeType.List) {
          const entryList = entriesArg.valueExpression;
          const entryMap = new Map<string, string>();

          entryList.entries.forEach((entry, index) => {
            let entryTypeNode: ExpressionNode | undefined;
            let entryType: Type | undefined;
            let entryNameNode: ExpressionNode | undefined;
            let entryName = '';

            if (includesTypes) {
              if (entry.nodeType === ParseNodeType.Tuple && entry.expressions.length === 2) {
                entryNameNode = entry.expressions[0];
                entryTypeNode = entry.expressions[1];
                entryType = convertToInstance(getTypeForExpressionExpectingType(entryTypeNode));
              } else {
                addError(Localizer.Diag.namedTupleNameType(), entry);
              }
            } else {
              entryNameNode = entry;
              entryType = UnknownType.create();
            }

            if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
              entryName = entryNameNode.strings.map((s) => s.value).join('');
              if (!entryName) {
                addError(Localizer.Diag.namedTupleEmptyName(), entryNameNode);
              }
            } else {
              addError(Localizer.Diag.namedTupleNameString(), entryNameNode || entry);
            }

            if (!entryName) {
              entryName = `_${index.toString()}`;
            }

            if (entryMap.has(entryName)) {
              addError(Localizer.Diag.namedTupleNameUnique(), entryNameNode || entry);
            }

            entryMap.set(entryName, entryName);

            if (!entryType) {
              entryType = UnknownType.create();
            }

            const paramInfo: FunctionParameter = {
              category: ParameterCategory.Simple,
              name: entryName,
              type: entryType,
              hasDeclaredType: includesTypes,
            };

            FunctionType.addParameter(constructorType, paramInfo);
            entryTypes.push(entryType);

            const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);
            if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
              const declaration: VariableDeclaration = {
                type: DeclarationType.Variable,
                node: entryNameNode,
                path: fileInfo.filePath,
                typeAnnotationNode: entryTypeNode,
                range: convertOffsetsToRange(entryNameNode.start, TextRange.getEnd(entryNameNode), fileInfo.lines),
                moduleName: fileInfo.moduleName,
              };
              newSymbol.addDeclaration(declaration);
            }
            classFields.set(entryName, newSymbol);
          });
        } else {
          addGenericGetAttribute = true;
        }
      }
    }

    if (addGenericGetAttribute) {
      FunctionType.addDefaultParameters(constructorType);
      entryTypes.push(AnyType.create(/* isEllipsis */ false));
      entryTypes.push(AnyType.create(/* isEllipsis */ true));
    }

    const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.SkipConstructorCheck);
    FunctionType.addParameter(initType, selfParameter);
    FunctionType.addDefaultParameters(initType);
    initType.details.declaredReturnType = NoneType.createInstance();

    classFields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, constructorType));
    classFields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

    const keysItemType = FunctionType.createInstance('keys', '', '', FunctionTypeFlags.SynthesizedMethod);
    const itemsItemType = FunctionType.createInstance('items', '', '', FunctionTypeFlags.SynthesizedMethod);
    keysItemType.details.declaredReturnType = getBuiltInObject(errorNode, 'list', [getBuiltInObject(errorNode, 'str')]);
    itemsItemType.details.declaredReturnType = keysItemType.details.declaredReturnType;
    classFields.set('keys', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));
    classFields.set('items', Symbol.createWithType(SymbolFlags.InstanceMember, itemsItemType));

    const lenType = FunctionType.createInstance('__len__', '', '', FunctionTypeFlags.SynthesizedMethod);
    lenType.details.declaredReturnType = getBuiltInObject(errorNode, 'int');
    FunctionType.addParameter(lenType, selfParameter);
    classFields.set('__len__', Symbol.createWithType(SymbolFlags.ClassMember, lenType));

    if (addGenericGetAttribute) {
      const getAttribType = FunctionType.createInstance('__getattribute__', '', '', FunctionTypeFlags.SynthesizedMethod);
      getAttribType.details.declaredReturnType = AnyType.create();
      FunctionType.addParameter(getAttribType, selfParameter);
      FunctionType.addParameter(getAttribType, {
        category: ParameterCategory.Simple,
        name: 'name',
        type: getBuiltInObject(errorNode, 'str'),
      });
      classFields.set('__getattribute__', Symbol.createWithType(SymbolFlags.ClassMember, getAttribType));
    }

    computeMroLinearization(classType);

    updateNamedTupleBaseClass(classType, entryTypes, !addGenericGetAttribute);

    return classType;
  }

  function getTypeFromConstant(node: ConstantNode, flags: EvaluatorFlags): TypeResult | undefined {
    let type: Type | undefined;

    if (node.constType === KeywordType.None) {
      type = (flags & EvaluatorFlags.ExpectingType) !== 0 ? NoneType.createType() : NoneType.createInstance();
    } else if (node.constType === KeywordType.True || node.constType === KeywordType.False || node.constType === KeywordType.Debug) {
      type = getBuiltInObject(node, 'bool');

      if (type && isObject(type)) {
        if (node.constType === KeywordType.True) {
          type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, true));
        } else if (node.constType === KeywordType.False) {
          type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, false));
        }
      }
    }

    if (!type) {
      return undefined;
    }

    return { type, node };
  }

  function getTypeFromUnaryOp(node: UnaryOpNode, expectedType: Type | undefined): TypeResult {
    let exprType = makeTopLevelTypeVarsConcrete(getTypeOfExpression(node.expression).type);

    const unaryOperatorMap: { [operator: number]: string } = {
      [OperatorType.Add]: '__pos__',
      [OperatorType.Subtract]: '__neg__',
      [OperatorType.BitwiseInvert]: '__invert__',
    };

    let type: Type | undefined;

    if (node.operator !== OperatorType.Not) {
      if (isOptionalType(exprType)) {
        addDiag(
          getFileInfo(node).diagnosticRuleSet.reportOptionalOperand,
          DiagRule.reportOptionalOperand,
          Localizer.Diag.noneOperator().format({
            operator: ParseTreeUtils.printOperator(node.operator),
          }),
          node.expression
        );
        exprType = removeNoneFromUnion(exprType);
      }
    }

    if (node.operator === OperatorType.Not) {
      type = getBuiltInObject(node, 'bool');
      if (!type) {
        type = UnknownType.create();
      }
    } else {
      if (isAnyOrUnknown(exprType)) {
        type = exprType;
      } else {
        const magicMethodName = unaryOperatorMap[node.operator];
        type = getTypeFromMagicMethodReturn(exprType, [], magicMethodName, node, expectedType);
      }

      if (!type) {
        const fileInfo = getFileInfo(node);
        addDiag(
          fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.typeNotSupportUnaryOperator().format({
            operator: ParseTreeUtils.printOperator(node.operator),
            type: printType(exprType),
          }),
          node
        );
        type = UnknownType.create();
      }
    }

    if (node.operator === OperatorType.Add || node.operator === OperatorType.Subtract) {
      if (isObject(type) && ClassType.isBuiltIn(type.classType, 'int') && isObject(exprType) && ClassType.isBuiltIn(exprType.classType, 'int') && typeof exprType.classType.literalValue === 'number') {
        const value = node.operator === OperatorType.Add ? exprType.classType.literalValue : -exprType.classType.literalValue;
        type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, value));
      }
    }

    return { type, node };
  }

  function operatorSupportsComparisonChaining(op: OperatorType) {
    if (binaryOperatorMap[op] && binaryOperatorMap[op][2]) {
      return true;
    }

    if (booleanOperatorMap[op]) {
      return true;
    }

    return false;
  }

  function getTypeFromBinaryOp(node: BinaryOpNode, expectedType: Type | undefined, flags: EvaluatorFlags): TypeResult {
    const leftExpression = node.leftExpression;
    let rightExpression = node.rightExpression;
    let isIncomplete = false;

    if (operatorSupportsComparisonChaining(node.operator)) {
      if (rightExpression.nodeType === ParseNodeType.BinaryOp && !rightExpression.parenthesized && operatorSupportsComparisonChaining(rightExpression.operator)) {
        getTypeFromBinaryOp(rightExpression, expectedType, flags);

        rightExpression = rightExpression.leftExpression;
      }
    }

    let expectedOperandType = node.operator === OperatorType.Or || node.operator === OperatorType.And ? expectedType : undefined;
    const leftTypeResult = getTypeOfExpression(leftExpression, expectedOperandType, flags);
    let leftType = leftTypeResult.type;

    if (!expectedOperandType && (node.operator === OperatorType.Or || node.operator === OperatorType.And)) {
      expectedOperandType = leftType;
    }

    const rightTypeResult = getTypeOfExpression(rightExpression, expectedOperandType, flags);
    let rightType = rightTypeResult.type;

    if (leftTypeResult.isIncomplete || rightTypeResult.isIncomplete) {
      isIncomplete = true;
    }

    if (node.operator === OperatorType.BitwiseOr && !customMetaclassSupportsMethod(leftType, '__or__') && !customMetaclassSupportsMethod(rightType, '__ror__')) {
      let adjustedRightType = rightType;
      if (!isNone(leftType) && isNone(rightType) && TypeBase.isInstance(rightType)) {
        adjustedRightType = NoneType.createType();
      }

      if (isUnionableType([leftType, adjustedRightType])) {
        const fileInfo = getFileInfo(node);
        const unionNotationSupported = fileInfo.isStubFile || (flags & EvaluatorFlags.AllowForwardReferences) !== 0 || fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_10;
        if (!unionNotationSupported) {
          addError(Localizer.Diag.unionSyntaxIllegal(), node, node.operatorToken);
        }

        return {
          type: combineTypes([leftType, adjustedRightType]),
          node,
        };
      }
    }

    if (booleanOperatorMap[node.operator] === undefined) {
      if (isOptionalType(leftType)) {
        if (node.operator !== OperatorType.Equals && node.operator !== OperatorType.NotEquals) {
          addDiag(
            getFileInfo(node).diagnosticRuleSet.reportOptionalOperand,
            DiagRule.reportOptionalOperand,
            Localizer.Diag.noneOperator().format({
              operator: ParseTreeUtils.printOperator(node.operator),
            }),
            node.leftExpression
          );
        }
        leftType = removeNoneFromUnion(leftType);
      }

      if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
        rightType = removeNoneFromUnion(rightType);
      }
    }

    return {
      type: validateBinaryOp(node.operator, leftType, rightType, node, expectedType),
      node,
      isIncomplete,
    };
  }

  function customMetaclassSupportsMethod(type: Type, methodName: string): boolean {
    if (!isClass(type)) {
      return false;
    }

    const metaclass = type.details.effectiveMetaclass;
    if (!metaclass || !isClass(metaclass)) {
      return false;
    }

    if (ClassType.isBuiltIn(metaclass, 'type')) {
      return false;
    }

    const memberInfo = lookUpClassMember(metaclass, methodName);
    return !!memberInfo;
  }

  function getTypeFromAugmentedAssignment(node: AugmentedAssignmentNode, expectedType: Type | undefined): TypeResult {
    const operatorMap: { [operator: number]: [string, OperatorType] } = {
      [OperatorType.AddEqual]: ['__iadd__', OperatorType.Add],
      [OperatorType.SubtractEqual]: ['__isub__', OperatorType.Subtract],
      [OperatorType.MultiplyEqual]: ['__imul__', OperatorType.Multiply],
      [OperatorType.FloorDivideEqual]: ['__ifloordiv__', OperatorType.FloorDivide],
      [OperatorType.DivideEqual]: ['__itruediv__', OperatorType.Divide],
      [OperatorType.ModEqual]: ['__imod__', OperatorType.Mod],
      [OperatorType.PowerEqual]: ['__ipow__', OperatorType.Power],
      [OperatorType.MatrixMultiplyEqual]: ['__imatmul__', OperatorType.MatrixMultiply],
      [OperatorType.BitwiseAndEqual]: ['__iand__', OperatorType.BitwiseAnd],
      [OperatorType.BitwiseOrEqual]: ['__ior__', OperatorType.BitwiseOr],
      [OperatorType.BitwiseXorEqual]: ['__ixor__', OperatorType.BitwiseXor],
      [OperatorType.LeftShiftEqual]: ['__ilshift__', OperatorType.LeftShift],
      [OperatorType.RightShiftEqual]: ['__irshift__', OperatorType.RightShift],
    };

    let type: Type | undefined;

    const leftTypeResult = getTypeOfExpression(node.leftExpression);
    const leftType = leftTypeResult.type;
    const rightTypeResult = getTypeOfExpression(node.rightExpression);
    const rightType = rightTypeResult.type;
    const isIncomplete = !!rightTypeResult.isIncomplete || !!leftTypeResult.isIncomplete;

    type = mapSubtypesExpandTypeVars(leftType, /* constraintFilter */ undefined, (leftSubtypeExpanded, leftSubtypeUnexpanded, leftConstraints) => {
      return mapSubtypesExpandTypeVars(rightType, leftConstraints, (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
        if (isAnyOrUnknown(leftSubtypeUnexpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
          if (isUnknown(leftSubtypeUnexpanded) || isUnknown(rightSubtypeUnexpanded)) {
            return UnknownType.create();
          } else {
            return AnyType.create();
          }
        }

        const magicMethodName = operatorMap[node.operator][0];
        let returnResult = getTypeFromMagicMethodReturn(leftSubtypeUnexpanded, [rightSubtypeUnexpanded], magicMethodName, node, expectedType);

        if (!returnResult && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
          returnResult = getTypeFromMagicMethodReturn(leftSubtypeExpanded, [rightSubtypeUnexpanded], magicMethodName, node, expectedType);
        }

        if (!returnResult && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
          returnResult = getTypeFromMagicMethodReturn(leftSubtypeExpanded, [rightSubtypeExpanded], magicMethodName, node, expectedType);
        }

        return returnResult;
      });
    });

    if (!type || isNever(type)) {
      const binaryOperator = operatorMap[node.operator][1];
      type = validateBinaryOp(binaryOperator, leftType!, rightType, node, expectedType);
    }

    return { node, type, isIncomplete };
  }

  function validateBinaryOp(operator: OperatorType, leftType: Type, rightType: Type, errorNode: ExpressionNode, expectedType: Type | undefined): Type {
    let type: Type | undefined;
    const diag = new DiagAddendum();

    let concreteLeftType = makeTopLevelTypeVarsConcrete(leftType);

    if (booleanOperatorMap[operator] !== undefined) {
      if (operator === OperatorType.And) {
        if (!canBeTruthy(concreteLeftType)) {
          return leftType;
        }

        if (!canBeFalsy(concreteLeftType)) {
          return rightType;
        }

        concreteLeftType = removeTruthinessFromType(concreteLeftType);
      } else if (operator === OperatorType.Or) {
        if (!canBeFalsy(concreteLeftType)) {
          return leftType;
        }

        if (!canBeTruthy(concreteLeftType)) {
          return rightType;
        }

        concreteLeftType = removeFalsinessFromType(concreteLeftType);
      }

      if (operator === OperatorType.In || operator === OperatorType.NotIn) {
        type = mapSubtypesExpandTypeVars(rightType, /* constraintFilter */ undefined, (rightSubtypeExpanded, rightSubtypeUnexpanded, rightConstraints) => {
          return mapSubtypesExpandTypeVars(concreteLeftType, rightConstraints, (leftSubtype) => {
            if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
              if (isUnknown(leftSubtype) || isUnknown(rightSubtypeUnexpanded)) {
                return UnknownType.create();
              } else {
                return AnyType.create();
              }
            }

            let returnType = getTypeFromMagicMethodReturn(rightSubtypeExpanded, [leftSubtype], '__contains__', errorNode, /* expectedType */ undefined);

            if (!returnType) {
              const iteratorType = getTypeFromIterator(rightSubtypeExpanded, /* isAsync */ false, /* errorNode */ undefined);

              if (iteratorType && canAssignType(iteratorType, leftSubtype, new DiagAddendum())) {
                returnType = getBuiltInObject(errorNode, 'bool');
              }
            }

            if (!returnType) {
              diag.addMessage(
                Localizer.Diag.typeNotSupportBinaryOperator().format({
                  operator: ParseTreeUtils.printOperator(operator),
                  leftType: printType(leftType),
                  rightType: printType(rightType),
                })
              );
            }

            return returnType;
          });
        });

        if (type && !isNever(type)) {
          type = getBuiltInObject(errorNode, 'bool');
        }
      } else {
        type = mapSubtypesExpandTypeVars(concreteLeftType, /* constraintFilter */ undefined, (leftSubtypeExpanded, leftSubtypeUnexpanded, leftConstraints) => {
          return mapSubtypesExpandTypeVars(rightType, leftConstraints, (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
            if (operator === OperatorType.And || operator === OperatorType.Or) {
              return combineTypes([leftSubtypeUnexpanded, rightSubtypeUnexpanded]);
            }

            return getBuiltInObject(errorNode, 'bool');
          });
        });
      }
    } else if (binaryOperatorMap[operator]) {
      type = mapSubtypesExpandTypeVars(leftType, /* constraintFilter */ undefined, (leftSubtypeExpanded, leftSubtypeUnexpanded, leftConstraints) => {
        return mapSubtypesExpandTypeVars(rightType, leftConstraints, (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
          if (isAnyOrUnknown(leftSubtypeUnexpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
            if (isUnknown(leftSubtypeUnexpanded) || isUnknown(rightSubtypeUnexpanded)) {
              return UnknownType.create();
            } else {
              return AnyType.create();
            }
          }

          const magicMethodName = binaryOperatorMap[operator][0];
          let resultType = getTypeFromMagicMethodReturn(leftSubtypeUnexpanded, [rightSubtypeUnexpanded], magicMethodName, errorNode, expectedType);

          if (!resultType && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
            resultType = getTypeFromMagicMethodReturn(leftSubtypeExpanded, [rightSubtypeUnexpanded], magicMethodName, errorNode, expectedType);
          }

          if (!resultType && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
            resultType = getTypeFromMagicMethodReturn(leftSubtypeExpanded, [rightSubtypeExpanded], magicMethodName, errorNode, expectedType);
          }

          if (!resultType) {
            const altMagicMethodName = binaryOperatorMap[operator][1];
            resultType = getTypeFromMagicMethodReturn(rightSubtypeUnexpanded, [leftSubtypeUnexpanded], altMagicMethodName, errorNode, expectedType);

            if (!resultType && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
              resultType = getTypeFromMagicMethodReturn(rightSubtypeExpanded, [leftSubtypeUnexpanded], altMagicMethodName, errorNode, expectedType);
            }

            if (!resultType && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
              resultType = getTypeFromMagicMethodReturn(rightSubtypeExpanded, [leftSubtypeExpanded], altMagicMethodName, errorNode, expectedType);
            }
          }

          if (!resultType) {
            diag.addMessage(
              Localizer.Diag.typeNotSupportBinaryOperator().format({
                operator: ParseTreeUtils.printOperator(operator),
                leftType: printType(leftType),
                rightType: printType(rightType),
              })
            );
          }
          return resultType;
        });
      });
    }

    if (!diag.isEmpty() || !type || isNever(type)) {
      const fileInfo = getFileInfo(errorNode);
      addDiag(
        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.Diag.typeNotSupportBinaryOperator().format({
          operator: ParseTreeUtils.printOperator(operator),
          leftType: printType(leftType),
          rightType: printType(rightType),
        }) + diag.getString(),
        errorNode
      );
      type = UnknownType.create();
    }

    return type;
  }

  function getTypeFromMagicMethodReturn(objType: Type, args: Type[], magicMethodName: string, errorNode: ExpressionNode, expectedType: Type | undefined): Type | undefined {
    let magicMethodSupported = true;

    const handleSubtype = (subtype: ObjectType | ClassType | TypeVarType) => {
      let magicMethodType: Type | undefined;
      const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

      if (isObject(concreteSubtype)) {
        magicMethodType = getTypeFromObjectMember(errorNode, concreteSubtype, magicMethodName, /* usage */ undefined, /* diag */ undefined, /* memberAccessFlags */ undefined, subtype)?.type;
      } else if (isClass(concreteSubtype)) {
        magicMethodType = getTypeFromClassMember(errorNode, concreteSubtype, magicMethodName, /* usage */ undefined, /* diag */ undefined, MemberAccessFlags.ConsiderMetaclassOnly)?.type;
      }

      if (magicMethodType) {
        const functionArgs = args.map((arg) => {
          return {
            argumentCategory: ArgumentCategory.Simple,
            type: arg,
          };
        });

        let callResult: CallResult | undefined;

        suppressDiags(errorNode, () => {
          callResult = validateCallArguments(errorNode, functionArgs, magicMethodType!, new TypeVarMap(getTypeVarScopeId(magicMethodType!)), /* skipUnknownArgCheck */ true, expectedType);
        });

        if (callResult!.argumentErrors) {
          magicMethodSupported = false;
        }

        return callResult!.returnType;
      }

      magicMethodSupported = false;
      return undefined;
    };

    const returnType = mapSubtypes(objType, (subtype) => {
      if (isAnyOrUnknown(subtype)) {
        return subtype;
      }

      if (isObject(subtype) || isClass(subtype) || isTypeVar(subtype)) {
        return handleSubtype(subtype);
      } else if (isNone(subtype)) {
        const obj = getBuiltInObject(errorNode, 'object');
        if (isObject(obj)) {
          return handleSubtype(obj);
        }
      }

      magicMethodSupported = false;
      return undefined;
    });

    if (!magicMethodSupported) {
      return undefined;
    }

    return returnType;
  }

  function getTypeFromSet(node: SetNode, expectedType: Type | undefined): TypeResult {
    const entryTypes: Type[] = [];

    node.entries.forEach((entryNode, index) => {
      let elementType: Type;
      if (entryNode.nodeType === ParseNodeType.ListComprehension) {
        elementType = getElementTypeFromListComprehension(entryNode, expectedType);
      } else {
        elementType = getTypeOfExpression(entryNode).type;
      }

      if (index < maxEntriesToUseForInference || expectedType !== undefined) {
        entryTypes.push(elementType);
      }
    });

    if (expectedType && entryTypes.length > 0) {
      const narrowedExpectedType = mapSubtypes(expectedType, (subtype) => {
        if (isObject(subtype)) {
          if (ClassType.isBuiltIn(subtype.classType, 'set') && subtype.classType.typeArguments) {
            const typeArg = subtype.classType.typeArguments[0];
            const typeVarMap = new TypeVarMap(getTypeVarScopeId(subtype));

            for (const entryType of entryTypes) {
              if (!canAssignType(typeArg, entryType, new DiagAddendum(), typeVarMap)) {
                return undefined;
              }
            }

            return applySolvedTypeVars(subtype, typeVarMap);
          }
        }

        return undefined;
      });

      if (!isNever(narrowedExpectedType)) {
        return { type: narrowedExpectedType, node };
      }
    }

    let inferredEntryType = entryTypes.length > 0 ? combineTypes(entryTypes.map((t) => stripLiteralValue(t))) : UnknownType.create();

    if (!expectedType) {
      inferredEntryType = stripLiteralValue(inferredEntryType);
    }

    const type = getBuiltInObject(node, 'set', [inferredEntryType]);

    return { type, node };
  }

  function getTypeFromDictionary(node: DictionaryNode, expectedType: Type | undefined): TypeResult {
    if (expectedType && isUnion(expectedType)) {
      let matchingSubtype: Type | undefined;

      doForEachSubtype(expectedType, (subtype) => {
        if (!matchingSubtype) {
          const subtypeResult = useSpeculativeMode(node, () => {
            return getTypeFromDictionaryExpected(node, subtype, new DiagAddendum());
          });

          if (subtypeResult) {
            matchingSubtype = subtype;
          }
        }
      });

      expectedType = matchingSubtype;
    }

    let expectedTypeDiagAddendum = undefined;
    if (expectedType) {
      expectedTypeDiagAddendum = new DiagAddendum();
      const result = getTypeFromDictionaryExpected(node, expectedType, expectedTypeDiagAddendum);
      if (result) {
        return result;
      }
    }

    const result = getTypeFromDictionaryInferred(node, expectedType)!;
    return { ...result, expectedTypeDiagAddendum };
  }

  function getTypeFromDictionaryExpected(node: DictionaryNode, expectedType: Type, expectedDiagAddendum: DiagAddendum): TypeResult | undefined {
    expectedType = transformPossibleRecursiveTypeAlias(expectedType);

    if (!isObject(expectedType)) {
      return undefined;
    }

    const keyTypes: Type[] = [];
    const valueTypes: Type[] = [];

    if (ClassType.isTypedDictClass(expectedType.classType)) {
      const expectedTypedDictEntries = getTypedDictMembersForClass(expectedType.classType);

      getKeyAndValueTypesFromDictionary(node, keyTypes, valueTypes, !!expectedType, /* expectedKeyType */ undefined, /* expectedValueType */ undefined, expectedTypedDictEntries, expectedDiagAddendum);

      if (ClassType.isTypedDictClass(expectedType.classType) && canAssignToTypedDict(expectedType.classType, keyTypes, valueTypes, expectedDiagAddendum)) {
        return {
          type: expectedType,
          node,
        };
      }

      return undefined;
    }

    const builtInDict = getBuiltInObject(node, 'dict');
    if (!isObject(builtInDict)) {
      return undefined;
    }

    const dictTypeVarMap = new TypeVarMap(getTypeVarScopeId(builtInDict.classType));
    if (!populateTypeVarMapBasedOnExpectedType(builtInDict.classType, expectedType, dictTypeVarMap, getTypeVarScopesForNode(node))) {
      return undefined;
    }

    const specializedDict = applySolvedTypeVars(builtInDict.classType, dictTypeVarMap) as ClassType;
    if (!specializedDict.typeArguments || specializedDict.typeArguments.length !== 2) {
      return undefined;
    }

    const expectedKeyType = specializedDict.typeArguments[0];
    const expectedValueType = specializedDict.typeArguments[1];

    getKeyAndValueTypesFromDictionary(node, keyTypes, valueTypes, !!expectedType, expectedKeyType, expectedValueType, undefined, expectedDiagAddendum);

    const isExpectedTypeDict = isObject(expectedType) && ClassType.isBuiltIn(expectedType.classType, 'dict');

    const specializedKeyType = inferTypeArgFromExpectedType(expectedKeyType, keyTypes, /* isNarrowable */ false);
    const specializedValueType = inferTypeArgFromExpectedType(expectedValueType, valueTypes, /* isNarrowable */ !isExpectedTypeDict);
    if (!specializedKeyType || !specializedValueType) {
      return undefined;
    }

    const type = getBuiltInObject(node, 'dict', [specializedKeyType, specializedValueType]);
    return { type, node };
  }

  function getTypeFromDictionaryInferred(node: DictionaryNode, expectedType: Type | undefined): TypeResult {
    let keyType: Type = expectedType ? AnyType.create() : UnknownType.create();
    let valueType: Type = expectedType ? AnyType.create() : UnknownType.create();

    let keyTypes: Type[] = [];
    let valueTypes: Type[] = [];

    getKeyAndValueTypesFromDictionary(node, keyTypes, valueTypes, !expectedType, expectedType ? AnyType.create() : undefined, expectedType ? AnyType.create() : undefined);

    keyTypes = keyTypes.map((t) => stripLiteralValue(t));
    valueTypes = valueTypes.map((t) => stripLiteralValue(t));

    keyType = keyTypes.length > 0 ? combineTypes(keyTypes) : expectedType ? AnyType.create() : UnknownType.create();

    if (valueTypes.length > 0) {
      if (getFileInfo(node).diagnosticRuleSet.strictDictionaryInference || !!expectedType) {
        valueType = combineTypes(valueTypes);
      } else {
        valueType = areTypesSame(valueTypes) ? valueTypes[0] : expectedType ? AnyType.create() : UnknownType.create();
      }
    } else {
      valueType = expectedType ? AnyType.create() : UnknownType.create();
    }

    const type = getBuiltInObject(node, 'dict', [keyType, valueType]);
    return { type, node };
  }

  function getKeyAndValueTypesFromDictionary(
    node: DictionaryNode,
    keyTypes: Type[],
    valueTypes: Type[],
    limitEntryCount: boolean,
    expectedKeyType?: Type,
    expectedValueType?: Type,
    expectedTypedDictEntries?: Map<string, TypedDictEntry>,
    expectedDiagAddendum?: DiagAddendum
  ) {
    node.entries.forEach((entryNode, index) => {
      let addUnknown = true;

      if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
        let keyType = getTypeOfExpression(entryNode.keyExpression, expectedKeyType).type;
        if (expectedKeyType) {
          const adjExpectedKeyType = makeTopLevelTypeVarsConcrete(expectedKeyType);
          if (!isAnyOrUnknown(adjExpectedKeyType)) {
            if (canAssignType(adjExpectedKeyType, keyType, new DiagAddendum(), undefined)) {
              keyType = adjExpectedKeyType;
            }
          }
        }

        let valueTypeResult: TypeResult;

        if (
          expectedTypedDictEntries &&
          isObject(keyType) &&
          ClassType.isBuiltIn(keyType.classType, 'str') &&
          isLiteralType(keyType) &&
          expectedTypedDictEntries.has(keyType.classType.literalValue as string)
        ) {
          valueTypeResult = getTypeOfExpression(entryNode.valueExpression, expectedTypedDictEntries.get(keyType.classType.literalValue as string)!.valueType);
        } else {
          valueTypeResult = getTypeOfExpression(entryNode.valueExpression, expectedValueType);
        }

        if (expectedDiagAddendum && valueTypeResult.expectedTypeDiagAddendum) {
          expectedDiagAddendum.addAddendum(valueTypeResult.expectedTypeDiagAddendum);
        }

        const valueType = valueTypeResult.type;

        if (!limitEntryCount || index < maxEntriesToUseForInference) {
          keyTypes.push(keyType);
          valueTypes.push(valueType);
        }
        addUnknown = false;
      } else if (entryNode.nodeType === ParseNodeType.DictionaryExpandEntry) {
        const unexpandedType = getTypeOfExpression(entryNode.expandExpression).type;
        if (isAnyOrUnknown(unexpandedType)) {
          addUnknown = false;
        } else {
          const mappingType = getTypingType(node, 'Mapping');
          if (mappingType && isClass(mappingType)) {
            const mappingTypeVarMap = new TypeVarMap(getTypeVarScopeId(mappingType));
            if (canAssignType(ObjectType.create(mappingType), unexpandedType, new DiagAddendum(), mappingTypeVarMap)) {
              const specializedMapping = applySolvedTypeVars(mappingType, mappingTypeVarMap) as ClassType;
              const typeArgs = specializedMapping.typeArguments;
              if (typeArgs && typeArgs.length >= 2) {
                if (!limitEntryCount || index < maxEntriesToUseForInference) {
                  keyTypes.push(typeArgs[0]);
                  valueTypes.push(typeArgs[1]);
                }
                addUnknown = false;
              }
            } else {
              const fileInfo = getFileInfo(node);
              addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.dictUnpackIsNotMapping(), entryNode);
            }
          }
        }
      } else if (entryNode.nodeType === ParseNodeType.ListComprehension) {
        const dictEntryType = getElementTypeFromListComprehension(entryNode, expectedValueType, expectedKeyType);

        if (isObject(dictEntryType)) {
          const classType = dictEntryType.classType;
          if (isTupleClass(classType)) {
            const typeArgs = classType.tupleTypeArguments;
            if (typeArgs && typeArgs.length === 2) {
              if (!limitEntryCount || index < maxEntriesToUseForInference) {
                keyTypes.push(typeArgs[0]);
                valueTypes.push(typeArgs[1]);
              }
              addUnknown = false;
            }
          }
        }
      }

      if (addUnknown) {
        if (!limitEntryCount || index < maxEntriesToUseForInference) {
          keyTypes.push(UnknownType.create());
          valueTypes.push(UnknownType.create());
        }
      }
    });
  }

  function getTypeFromList(node: ListNode, expectedType: Type | undefined): TypeResult {
    let effectiveExpectedType = expectedType;

    if (expectedType && isUnion(expectedType)) {
      let matchingSubtype: Type | undefined;

      doForEachSubtype(expectedType, (subtype) => {
        if (!matchingSubtype) {
          const subtypeResult = useSpeculativeMode(node, () => {
            return getTypeFromListExpected(node, subtype);
          });

          if (subtypeResult) {
            matchingSubtype = subtype;
          }
        }
      });

      effectiveExpectedType = matchingSubtype;
    }

    if (effectiveExpectedType) {
      const result = getTypeFromListExpected(node, effectiveExpectedType);
      if (result) {
        return result;
      }
    }

    return getTypeFromListInferred(node, expectedType);
  }

  function getTypeFromListExpected(node: ListNode, expectedType: Type): TypeResult | undefined {
    expectedType = transformPossibleRecursiveTypeAlias(expectedType);

    if (!isObject(expectedType)) {
      return undefined;
    }

    const builtInList = getBuiltInObject(node, 'list');
    if (!isObject(builtInList)) {
      return undefined;
    }

    const listTypeVarMap = new TypeVarMap(getTypeVarScopeId(builtInList.classType));
    if (!populateTypeVarMapBasedOnExpectedType(builtInList.classType, expectedType, listTypeVarMap, getTypeVarScopesForNode(node))) {
      return undefined;
    }

    const specializedList = applySolvedTypeVars(builtInList.classType, listTypeVarMap) as ClassType;
    if (!specializedList.typeArguments || specializedList.typeArguments.length !== 1) {
      return undefined;
    }

    const expectedEntryType = specializedList.typeArguments[0];

    const entryTypes: Type[] = [];
    node.entries.forEach((entry) => {
      if (entry.nodeType === ParseNodeType.ListComprehension) {
        entryTypes.push(getElementTypeFromListComprehension(entry, expectedEntryType));
      } else {
        entryTypes.push(getTypeOfExpression(entry, expectedEntryType).type);
      }
    });

    const isExpectedTypeList = isObject(expectedType) && ClassType.isBuiltIn(expectedType.classType, 'list');
    const specializedEntryType = inferTypeArgFromExpectedType(expectedEntryType, entryTypes, /* isNarrowable */ !isExpectedTypeList);
    if (!specializedEntryType) {
      return undefined;
    }

    const type = getBuiltInObject(node, 'list', [specializedEntryType]);
    return { type, node };
  }

  function getTypeFromListInferred(node: ListNode, expectedType: Type | undefined): TypeResult {
    let expectedEntryType: Type | undefined;
    if (expectedType) {
      if (isAny(expectedType)) {
        expectedEntryType = expectedType;
      } else if (isObject(expectedType) && ClassType.isBuiltIn(expectedType.classType, 'object')) {
        expectedEntryType = AnyType.create();
      }
    }

    let entryTypes: Type[] = [];
    node.entries.forEach((entry, index) => {
      let entryType: Type;

      if (entry.nodeType === ParseNodeType.ListComprehension) {
        entryType = getElementTypeFromListComprehension(entry, expectedEntryType);
      } else {
        entryType = getTypeOfExpression(entry, expectedEntryType).type;
      }

      if (index < maxEntriesToUseForInference) {
        entryTypes.push(entryType);
      }
    });

    entryTypes = entryTypes.map((t) => stripLiteralValue(t));

    let inferredEntryType: Type = expectedType ? AnyType.create() : UnknownType.create();
    if (entryTypes.length > 0) {
      if (getFileInfo(node).diagnosticRuleSet.strictListInference || !!expectedType) {
        inferredEntryType = combineTypes(entryTypes, maxSubtypesForInferredType);
      } else {
        inferredEntryType = areTypesSame(entryTypes) ? entryTypes[0] : inferredEntryType;
      }
    }

    const type = getBuiltInObject(node, 'list', [inferredEntryType]);
    return { type, node };
  }

  function inferTypeArgFromExpectedType(expectedType: Type, entryTypes: Type[], isNarrowable: boolean): Type | undefined {
    const diagDummy = new DiagAddendum();

    const targetTypeVar = TypeVarType.createInstance('__typeArg');
    targetTypeVar.details.isSynthesized = true;
    targetTypeVar.details.boundType = expectedType;

    const expectedTypeScopeId = '__typeArgScopeId';
    targetTypeVar.scopeId = expectedTypeScopeId;

    let typeVarMap = new TypeVarMap(expectedTypeScopeId);
    typeVarMap.setTypeVarType(targetTypeVar, isNarrowable ? undefined : expectedType, expectedType);

    if (entryTypes.some((entryType) => !canAssignType(targetTypeVar, stripLiteralValue(entryType), diagDummy, typeVarMap))) {
      typeVarMap = new TypeVarMap(expectedTypeScopeId);
      typeVarMap.setTypeVarType(targetTypeVar, isNarrowable ? undefined : expectedType, expectedType, /* retainLiteral */ true);
      if (entryTypes.some((entryType) => !canAssignType(targetTypeVar!, entryType, diagDummy, typeVarMap))) {
        return undefined;
      }
    }

    return applySolvedTypeVars(targetTypeVar, typeVarMap);
  }

  function getTypeFromTernary(node: TernaryNode, flags: EvaluatorFlags, expectedType: Type | undefined): TypeResult {
    getTypeOfExpression(node.testExpression);

    const ifType = getTypeOfExpression(node.ifExpression, expectedType, flags);
    const elseType = getTypeOfExpression(node.elseExpression, expectedType, flags);

    const type = combineTypes([ifType.type, elseType.type]);
    return { type, node };
  }

  function getTypeFromYield(node: YieldNode): TypeResult {
    let sentType: Type | undefined;

    const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
    if (enclosingFunction) {
      const functionTypeInfo = getTypeOfFunction(enclosingFunction);
      if (functionTypeInfo) {
        sentType = getDeclaredGeneratorSendType(functionTypeInfo.functionType);
      }
    }

    if (node.expression) {
      getTypeOfExpression(node.expression).type;
    }

    return { type: sentType || UnknownType.create(), node };
  }

  function getTypeFromYieldFrom(node: YieldFromNode): TypeResult {
    const yieldFromType = getTypeOfExpression(node.expression).type;
    let generatorTypeArgs = getGeneratorTypeArgs(yieldFromType);

    let returnedType: Type | undefined;

    if (generatorTypeArgs) {
      returnedType = generatorTypeArgs.length >= 2 ? generatorTypeArgs[2] : UnknownType.create();
    } else {
      const iterableType = getTypeFromIterable(yieldFromType, /* isAsync */ false, node) || UnknownType.create();

      generatorTypeArgs = getGeneratorTypeArgs(iterableType);
      if (generatorTypeArgs) {
        returnedType = generatorTypeArgs.length >= 2 ? generatorTypeArgs[2] : UnknownType.create();
      } else {
        returnedType = UnknownType.create();
      }
    }

    return { type: returnedType || UnknownType.create(), node };
  }

  function getTypeFromLambda(node: LambdaNode, expectedType: Type | undefined): TypeResult {
    const functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.None);

    writeTypeCache(node, functionType, /* isIncomplete */ false);

    let expectedFunctionType: FunctionType | undefined;
    if (expectedType) {
      if (isFunction(expectedType)) {
        expectedFunctionType = expectedType;
      } else if (isUnion(expectedType)) {
        expectedFunctionType = findSubtype(expectedType, (t) => isFunction(t)) as FunctionType;
      } else if (isObject(expectedType)) {
        const callMember = lookUpObjectMember(expectedType, '__call__');
        if (callMember) {
          const memberType = getTypeOfMember(callMember);
          if (memberType && isFunction(memberType)) {
            const boundMethod = bindFunctionToClassOrObject(expectedType, memberType);

            if (boundMethod) {
              expectedFunctionType = boundMethod as FunctionType;
            }
          }
        }
      }
    }

    node.parameters.forEach((param, index) => {
      let paramType: Type = UnknownType.create();
      if (expectedFunctionType && index < expectedFunctionType.details.parameters.length) {
        paramType = FunctionType.getEffectiveParameterType(expectedFunctionType, index);
      }

      if (param.name) {
        writeTypeCache(param.name, paramType, /* isIncomplete */ false);
      }

      if (param.defaultValue) {
        getTypeOfExpression(param.defaultValue, undefined, EvaluatorFlags.ConvertEllipsisToAny);
      }

      const functionParam: FunctionParameter = {
        category: param.category,
        name: param.name ? param.name.value : undefined,
        hasDefault: !!param.defaultValue,
        defaultValueExpression: param.defaultValue,
        hasDeclaredType: true,
        type: paramType,
      };
      FunctionType.addParameter(functionType, functionParam);
    });

    const expectedReturnType = expectedFunctionType ? getFunctionEffectiveReturnType(expectedFunctionType) : undefined;

    if (speculativeTypeTracker.isSpeculative()) {
      useSpeculativeMode(
        node.expression,
        () => {
          functionType.inferredReturnType = getTypeOfExpression(node.expression, expectedReturnType).type;
        },
        /* allowCacheRetention */ false
      );
    } else {
      functionType.inferredReturnType = getTypeOfExpression(node.expression, expectedReturnType).type;
    }

    return { type: functionType, node };
  }

  function getTypeFromListComprehension(node: ListComprehensionNode): TypeResult {
    const elementType = getElementTypeFromListComprehension(node);

    const isAsync = node.comprehensions.some((comp) => {
      return comp.nodeType === ParseNodeType.ListComprehensionFor && comp.isAsync;
    });
    let type: Type = UnknownType.create();
    const builtInIteratorType = getTypingType(node, isAsync ? 'AsyncGenerator' : 'Generator');

    if (builtInIteratorType && isClass(builtInIteratorType)) {
      type = ObjectType.create(
        ClassType.cloneForSpecialization(
          builtInIteratorType,
          isAsync ? [elementType, NoneType.createInstance()] : [elementType, NoneType.createInstance(), NoneType.createInstance()],
          /* isTypeArgumentExplicit */ true
        )
      );
    }

    return { type, node };
  }

  function reportPossibleUnknownAssignment(diagLevel: DiagLevel, rule: string, target: NameNode, type: Type, errorNode: ExpressionNode) {
    if (diagLevel === 'none') {
      return;
    }

    const nameValue = target.value;

    const simplifiedType = removeUnbound(type);

    if (isUnknown(simplifiedType)) {
      addDiag(diagLevel, rule, Localizer.Diag.typeUnknown().format({ name: nameValue }), errorNode);
    } else if (isPartlyUnknown(simplifiedType)) {
      const diagAddendum = new DiagAddendum();
      diagAddendum.addMessage(
        Localizer.DiagAddendum.typeOfSymbol().format({
          name: nameValue,
          type: printType(simplifiedType, /* expandTypeAlias */ true),
        })
      );
      addDiag(diagLevel, rule, Localizer.Diag.typePartiallyUnknown().format({ name: nameValue }) + diagAddendum.getString(), errorNode);
    }
  }

  function getElementTypeFromListComprehension(node: ListComprehensionNode, expectedValueOrElementType?: Type, expectedKeyType?: Type): Type {
    for (const comprehension of node.comprehensions) {
      if (comprehension.nodeType === ParseNodeType.ListComprehensionFor) {
        const iterableTypeInfo = getTypeOfExpression(comprehension.iterableExpression);
        const iterableType = stripLiteralValue(iterableTypeInfo.type);
        const itemType = getTypeFromIterator(iterableType, !!comprehension.isAsync, comprehension.iterableExpression) || UnknownType.create();

        const targetExpr = comprehension.targetExpression;
        assignTypeToExpression(targetExpr, itemType, !!iterableTypeInfo.isIncomplete, comprehension.iterableExpression);
      } else {
        assert(comprehension.nodeType === ParseNodeType.ListComprehensionIf);

        if (!speculativeTypeTracker.isSpeculative(comprehension.testExpression)) {
          getTypeOfExpression(comprehension.testExpression);
        }
      }
    }

    let type: Type = UnknownType.create();
    if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
      let keyType = getTypeOfExpression(node.expression.keyExpression, expectedKeyType).type;
      if (!expectedKeyType || !containsLiteralType(expectedKeyType)) {
        keyType = stripLiteralValue(keyType);
      }
      let valueType = getTypeOfExpression(node.expression.valueExpression, expectedValueOrElementType).type;
      if (!expectedValueOrElementType || !containsLiteralType(expectedValueOrElementType)) {
        valueType = stripLiteralValue(valueType);
      }

      type = makeTupleObject([keyType, valueType]);
    } else if (node.expression.nodeType === ParseNodeType.DictionaryExpandEntry) {
      getTypeOfExpression(node.expression.expandExpression, expectedValueOrElementType);
    } else if (isExpressionNode(node)) {
      type = stripLiteralValue(getTypeOfExpression(node.expression as ExpressionNode, expectedValueOrElementType).type);
    }

    return type;
  }

  function getTypeFromSlice(node: SliceNode): TypeResult {
    if (node.startValue) {
      getTypeOfExpression(node.startValue);
    }

    if (node.endValue) {
      getTypeOfExpression(node.endValue);
    }

    if (node.stepValue) {
      getTypeOfExpression(node.stepValue);
    }

    return { type: getBuiltInObject(node, 'slice'), node };
  }

  function validateTypeArg(argResult: TypeResult, allowEmptyTuple = false, allowVariadicTypeVar = false): boolean {
    if (argResult.typeList) {
      addError(Localizer.Diag.typeArgListNotAllowed(), argResult.node);
      return false;
    }

    if (isEllipsisType(argResult.type)) {
      addError(Localizer.Diag.ellipsisContext(), argResult.node);
      return false;
    }

    if (isModule(argResult.type)) {
      addError(Localizer.Diag.moduleContext(), argResult.node);
      return false;
    }

    if (isParamSpec(argResult.type)) {
      addError(Localizer.Diag.paramSpecContext(), argResult.node);
      return false;
    }

    if (isVariadicTypeVar(argResult.type)) {
      if (!allowVariadicTypeVar) {
        addError(Localizer.Diag.typeVarTupleContext(), argResult.node);
        return false;
      } else {
        validateVariadicTypeVarIsUnpacked(argResult.type, argResult.node);
      }
    }

    if (!allowEmptyTuple && argResult.isEmptyTupleShorthand) {
      addError(Localizer.Diag.zeroLengthTupleNotAllowed(), argResult.node);
      return false;
    }

    return true;
  }

  function createCallableType(typeArgs: TypeResult[] | undefined, errorNode: ParseNode): FunctionType {
    const functionType = FunctionType.createInstantiable('', '', '', FunctionTypeFlags.None);
    functionType.details.declaredReturnType = UnknownType.create();

    const enclosingScope = ParseTreeUtils.getEnclosingClassOrFunction(errorNode);
    functionType.details.typeVarScopeId = enclosingScope ? getScopeIdForNode(enclosingScope) : WildcardTypeVarScopeId;

    if (typeArgs && typeArgs.length > 0) {
      if (typeArgs[0].typeList) {
        const typeList = typeArgs[0].typeList;
        let sawVariadic = false;
        let reportedVariadicError = false;

        typeList.forEach((entry, index) => {
          let entryType = entry.type;
          let paramCategory: ParameterCategory = ParameterCategory.Simple;
          const paramName = `_p${index.toString()}`;

          if (isVariadicTypeVar(entryType)) {
            if (sawVariadic) {
              if (!reportedVariadicError) {
                addError(Localizer.Diag.variadicTypeArgsTooMany(), entry.node);
                reportedVariadicError = true;
              }
            }
            sawVariadic = true;
            validateVariadicTypeVarIsUnpacked(entryType, entry.node);
            paramCategory = ParameterCategory.Simple;
          } else if (!validateTypeArg(entry)) {
            entryType = UnknownType.create();
          }

          FunctionType.addParameter(functionType, {
            category: paramCategory,
            name: paramName,
            isNameSynthesized: true,
            type: convertToInstance(entryType),
            hasDeclaredType: true,
          });
        });
      } else if (isEllipsisType(typeArgs[0].type)) {
        FunctionType.addDefaultParameters(functionType);
        functionType.details.flags |= FunctionTypeFlags.SkipParamCompatibilityCheck;
      } else if (isParamSpec(typeArgs[0].type)) {
        functionType.details.paramSpec = typeArgs[0].type as TypeVarType;
      } else {
        if (isClass(typeArgs[0].type) && ClassType.isBuiltIn(typeArgs[0].type, 'Concatenate')) {
          const concatTypeArgs = typeArgs[0].type.typeArguments;
          if (concatTypeArgs && concatTypeArgs.length > 0) {
            concatTypeArgs.forEach((typeArg, index) => {
              if (index === concatTypeArgs.length - 1) {
                if (isParamSpec(typeArg)) {
                  functionType.details.paramSpec = typeArg as TypeVarType;
                }
              } else {
                FunctionType.addParameter(functionType, {
                  category: ParameterCategory.Simple,
                  name: `__p${index}`,
                  isNameSynthesized: true,
                  hasDeclaredType: true,
                  type: typeArg,
                });
              }
            });
          }
        } else {
          addError(Localizer.Diag.callableFirstArg(), typeArgs[0].node);
        }
      }

      if (typeArgs.length > 1) {
        let typeArg1Type = typeArgs[1].type;
        if (!validateTypeArg(typeArgs[1])) {
          typeArg1Type = UnknownType.create();
        }
        functionType.details.declaredReturnType = convertToInstance(typeArg1Type);
      } else {
        const fileInfo = getFileInfo(errorNode);
        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.callableSecondArg(), errorNode);

        functionType.details.declaredReturnType = UnknownType.create();
      }

      if (typeArgs.length > 2) {
        addError(Localizer.Diag.callableExtraArgs(), typeArgs[2].node);
      }
    } else {
      FunctionType.addDefaultParameters(functionType, /* useUnknown */ true);
      functionType.details.flags |= FunctionTypeFlags.SkipParamCompatibilityCheck;
    }

    return functionType;
  }

  function createOptionalType(errorNode: ParseNode, typeArgs?: TypeResult[]): Type {
    if (!typeArgs || typeArgs.length !== 1) {
      addError(Localizer.Diag.optionalExtraArgs(), errorNode);
      return UnknownType.create();
    }

    let typeArg0Type = typeArgs[0].type;
    if (!validateTypeArg(typeArgs[0])) {
      typeArg0Type = UnknownType.create();
    } else if (!TypeBase.isInstantiable(typeArg0Type)) {
      addExpectedClassDiag(typeArg0Type, typeArgs[0].node);
    }

    return combineTypes([typeArg0Type, NoneType.createType()]);
  }

  function cloneBuiltinObjectWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
    const type = getBuiltInObject(node, builtInName);
    if (isObject(type)) {
      return ObjectType.create(ClassType.cloneWithLiteral(type.classType, value));
    }

    return UnknownType.create();
  }

  function cloneBuiltinClassWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
    const type = getBuiltInObject(node, builtInName);
    if (isObject(type)) {
      return ClassType.cloneWithLiteral(type.classType, value);
    }

    return UnknownType.create();
  }

  function createLiteralType(node: IndexNode, flags: EvaluatorFlags): Type {
    if (node.items.length === 0) {
      addError(Localizer.Diag.literalEmptyArgs(), node.baseExpression);
      return UnknownType.create();
    }

    const literalTypes: Type[] = [];

    for (const item of node.items) {
      let type: Type | undefined;
      const itemExpr = item.valueExpression;

      if (item.argumentCategory !== ArgumentCategory.Simple) {
        addError(Localizer.Diag.unpackedArgInTypeArgument(), itemExpr);
        type = UnknownType.create();
      } else if (item.name) {
        addError(Localizer.Diag.keywordArgInTypeArgument(), itemExpr);
        type = UnknownType.create();
      } else if (itemExpr.nodeType === ParseNodeType.StringList) {
        const isBytes = (itemExpr.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
        const value = itemExpr.strings.map((s) => s.value).join('');
        if (isBytes) {
          type = cloneBuiltinClassWithLiteral(node, 'bytes', value);
        } else {
          type = cloneBuiltinClassWithLiteral(node, 'str', value);
        }
      } else if (itemExpr.nodeType === ParseNodeType.Number) {
        if (!itemExpr.isImaginary && itemExpr.isInteger) {
          type = cloneBuiltinClassWithLiteral(node, 'int', itemExpr.value);
        }
      } else if (itemExpr.nodeType === ParseNodeType.Constant) {
        if (itemExpr.constType === KeywordType.True) {
          type = cloneBuiltinClassWithLiteral(node, 'bool', true);
        } else if (itemExpr.constType === KeywordType.False) {
          type = cloneBuiltinClassWithLiteral(node, 'bool', false);
        } else if (itemExpr.constType === KeywordType.None) {
          type = NoneType.createType();
        }
      } else if (itemExpr.nodeType === ParseNodeType.UnaryOp && itemExpr.operator === OperatorType.Subtract) {
        if (itemExpr.expression.nodeType === ParseNodeType.Number) {
          if (!itemExpr.expression.isImaginary && itemExpr.expression.isInteger) {
            type = cloneBuiltinClassWithLiteral(node, 'int', -itemExpr.expression.value);
          }
        }
      }

      if (!type) {
        const exprType = getTypeOfExpression(itemExpr);

        if (isObject(exprType.type) && ClassType.isEnumClass(exprType.type.classType) && exprType.type.classType.literalValue !== undefined) {
          type = exprType.type.classType;
        } else {
          let isLiteralType = true;

          doForEachSubtype(exprType.type, (subtype) => {
            if (!isClass(subtype) || subtype.literalValue === undefined) {
              isLiteralType = false;
            }
          });

          if (isLiteralType) {
            type = exprType.type;
          }
        }
      }

      if (!type) {
        if ((flags & EvaluatorFlags.ExpectingType) !== 0) {
          addError(Localizer.Diag.literalUnsupportedType(), item);
          type = UnknownType.create();
        } else {
          type = AnyType.create();
        }
      }

      literalTypes.push(type);
    }

    return combineTypes(literalTypes);
  }

  function createClassVarType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
    if (!typeArgs || typeArgs.length === 0) {
      addError(Localizer.Diag.classVarFirstArgMissing(), errorNode);
      return UnknownType.create();
    } else if (typeArgs.length > 1) {
      addError(Localizer.Diag.classVarTooManyArgs(), typeArgs[1].node);
      return UnknownType.create();
    }

    let type = typeArgs[0].type;

    type = makeTopLevelTypeVarsConcrete(type);

    return type;
  }

  function createTypeGuardType(errorNode: ParseNode, classType: ClassType, typeArgs: TypeResult[] | undefined): Type {
    if (!typeArgs || typeArgs.length !== 1) {
      addError(Localizer.Diag.typeGuardArgCount(), errorNode);
    }

    let typeArg: Type;
    if (typeArgs && typeArgs.length > 0) {
      typeArg = typeArgs[0].type;
      if (!validateTypeArg(typeArgs[0])) {
        typeArg = UnknownType.create();
      }
    } else {
      typeArg = UnknownType.create();
    }

    return ClassType.cloneForSpecialization(classType, [convertToInstance(typeArg)], !!typeArgs);
  }

  function createRequiredType(classType: ClassType, errorNode: ParseNode, isRequired: boolean, typeArgs: TypeResult[] | undefined): Type {
    if (!typeArgs || typeArgs.length !== 1) {
      addError(isRequired ? Localizer.Diag.requiredArgCount() : Localizer.Diag.notRequiredArgCount(), errorNode);
      return classType;
    }

    const typeArgType = typeArgs[0].type;

    const containingClassNode = ParseTreeUtils.getEnclosingClass(errorNode, /* stopAtFunction */ true);
    const classTypeInfo = containingClassNode ? getTypeOfClass(containingClassNode) : undefined;

    let isUsageLegal = false;

    if (classTypeInfo && isClass(classTypeInfo.classType) && ClassType.isTypedDictClass(classTypeInfo.classType)) {
      if (errorNode.parent?.nodeType === ParseNodeType.TypeAnnotation && errorNode.parent.typeAnnotation === errorNode) {
        isUsageLegal = true;
      }
    }

    if (!isUsageLegal) {
      addError(isRequired ? Localizer.Diag.requiredNotInTypedDict() : Localizer.Diag.notRequiredNotInTypedDict(), errorNode);
      return ClassType.cloneForSpecialization(classType, [convertToInstance(typeArgType)], !!typeArgs);
    }

    return typeArgType;
  }

  function createUnpackType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
    if (!typeArgs || typeArgs.length !== 1) {
      addError(Localizer.Diag.unpackArgCount(), errorNode);
      return UnknownType.create();
    }

    let typeArgType = typeArgs[0].type;
    if (isUnion(typeArgType) && typeArgType.subtypes.length === 1) {
      typeArgType = typeArgType.subtypes[0];
    }

    if (!isVariadicTypeVar(typeArgType) || typeArgType.isVariadicUnpacked) {
      addError(Localizer.Diag.unpackExpectedTypeVarTuple(), errorNode);
      return UnknownType.create();
    }

    return TypeVarType.cloneForUnpacked(typeArgType);
  }

  function createFinalType(classType: ClassType, errorNode: ParseNode, typeArgs: TypeResult[] | undefined, flags: EvaluatorFlags): Type {
    if (flags & EvaluatorFlags.FinalDisallowed) {
      addError(Localizer.Diag.finalContext(), errorNode);
      return AnyType.create();
    }

    if (!typeArgs || typeArgs.length === 0) {
      return classType;
    }

    if (typeArgs.length > 1) {
      addError(Localizer.Diag.finalTooManyArgs(), errorNode);
    }

    return typeArgs[0].type;
  }

  function createConcatenateType(errorNode: ParseNode, classType: ClassType, typeArgs: TypeResult[] | undefined): Type {
    if (!typeArgs || typeArgs.length === 0) {
      addError(Localizer.Diag.concatenateTypeArgsMissing(), errorNode);
    } else {
      typeArgs.forEach((typeArg, index) => {
        if (index === typeArgs.length - 1) {
          if (!isParamSpec(typeArg.type)) {
            addError(Localizer.Diag.concatenateParamSpecMissing(), typeArg.node);
          }
        } else {
          if (isParamSpec(typeArg.type)) {
            addError(Localizer.Diag.paramSpecContext(), typeArg.node);
          }
        }
      });
    }

    return createSpecialType(classType, typeArgs, /* paramLimit */ undefined, /* allowParamSpec */ true);
  }

  function createAnnotatedType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
    if (typeArgs && typeArgs.length < 2) {
      addError(Localizer.Diag.annotatedTypeArgMissing(), errorNode);
    }

    if (!typeArgs || typeArgs.length === 0) {
      return AnyType.create();
    }

    let typeArg0Type = typeArgs[0].type;
    if (!validateTypeArg(typeArgs[0])) {
      typeArg0Type = UnknownType.create();
    }

    return TypeBase.cloneForAnnotated(typeArg0Type);
  }

  function createSpecialType(classType: ClassType, typeArgs: TypeResult[] | undefined, paramLimit?: number, allowParamSpec = false): Type {
    const isTupleTypeParam = ClassType.isTupleClass(classType);

    if (typeArgs) {
      if (isTupleTypeParam && typeArgs.length === 1 && typeArgs[0].isEmptyTupleShorthand) {
        typeArgs = [];
      } else {
        let sawVariadic = false;
        let reportedVariadicError = false;

        typeArgs.forEach((typeArg, index) => {
          if (isEllipsisType(typeArg.type)) {
            if (!isTupleTypeParam) {
              addError(Localizer.Diag.ellipsisContext(), typeArg.node);
            } else if (typeArgs!.length !== 2 || index !== 1) {
              addError(Localizer.Diag.ellipsisSecondArg(), typeArg.node);
            } else {
              if (isTypeVar(typeArgs![0].type) && isVariadicTypeVar(typeArgs![0].type)) {
                addError(Localizer.Diag.typeVarTupleContext(), typeArgs![0].node);
              }
            }
          } else if (isParamSpec(typeArg.type) && allowParamSpec) {
          } else if (isVariadicTypeVar(typeArg.type) && paramLimit === undefined) {
            if (sawVariadic) {
              if (!reportedVariadicError) {
                addError(Localizer.Diag.variadicTypeArgsTooMany(), typeArg.node);
                reportedVariadicError = true;
              }
            }
            validateVariadicTypeVarIsUnpacked(typeArg.type, typeArg.node);
            sawVariadic = true;
          } else {
            validateTypeArg(typeArg);
          }
        });
      }
    }

    let typeArgTypes = typeArgs ? typeArgs.map((t) => convertToInstance(t.type)) : [];

    if (paramLimit !== undefined) {
      if (typeArgs && typeArgTypes.length > paramLimit) {
        addError(
          Localizer.Diag.typeArgsTooMany().format({
            name: classType.aliasName || classType.details.name,
            expected: paramLimit,
            received: typeArgTypes.length,
          }),
          typeArgs[paramLimit].node
        );
        typeArgTypes = typeArgTypes.slice(0, paramLimit);
      } else if (typeArgTypes.length < paramLimit) {
        while (typeArgTypes.length < paramLimit) {
          typeArgTypes.push(UnknownType.create());
        }
      }
    }

    if (isTupleTypeParam) {
      if (!typeArgs) {
        typeArgTypes.push(UnknownType.create());
        typeArgTypes.push(AnyType.create(/* isEllipsis */ true));
      }

      return specializeTupleClass(classType, typeArgTypes, typeArgs !== undefined);
    }

    return ClassType.cloneForSpecialization(classType, typeArgTypes, typeArgs !== undefined);
  }

  function createUnionType(typeArgs?: TypeResult[]): Type {
    const types: Type[] = [];

    if (typeArgs) {
      for (const typeArg of typeArgs) {
        let typeArgType = typeArg.type;

        if (!validateTypeArg(typeArg, /* allowEmptyTuple */ false, /* allowVariadicTypeVar */ true)) {
          typeArgType = UnknownType.create();
        } else if (!TypeBase.isInstantiable(typeArgType)) {
          addExpectedClassDiag(typeArgType, typeArg.node);
        }

        types.push(typeArgType);
      }
    }

    if (types.length > 0) {
      return combineTypes(types);
    }

    return NeverType.create();
  }

  function createGenericType(errorNode: ParseNode, classType: ClassType, typeArgs?: TypeResult[]): Type {
    if (!typeArgs || typeArgs.length === 0) {
      addError(Localizer.Diag.genericTypeArgMissing(), errorNode);
    }

    const uniqueTypeVars: TypeVarType[] = [];
    if (typeArgs) {
      typeArgs.forEach((typeArg) => {
        if (!isTypeVar(typeArg.type)) {
          addError(Localizer.Diag.genericTypeArgTypeVar(), typeArg.node);
        } else {
          for (const typeVar of uniqueTypeVars) {
            if (typeVar === typeArg.type) {
              addError(Localizer.Diag.genericTypeArgUnique(), typeArg.node);
              break;
            }
          }

          uniqueTypeVars.push(typeArg.type);
        }
      });
    }

    return createSpecialType(classType, typeArgs, /* paramLimit */ undefined, /* allowParamSpec */ true);
  }

  function transformTypeForPossibleEnumClass(node: NameNode, getValueType: () => Type): Type | undefined {
    const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);
    if (enclosingClassNode) {
      const enumClassInfo = getTypeOfClass(enclosingClassNode);

      if (enumClassInfo && ClassType.isEnumClass(enumClassInfo.classType)) {
        let isMemberOfEnumeration =
          (node.parent?.nodeType === ParseNodeType.Assignment && node.parent.leftExpression === node) ||
          (node.parent?.nodeType === ParseNodeType.TypeAnnotation && node.parent.valueExpression === node && node.parent.parent?.nodeType === ParseNodeType.Assignment) ||
          (getFileInfo(node).isStubFile && node.parent?.nodeType === ParseNodeType.TypeAnnotation && node.parent.valueExpression === node);

        if (isSingleDunderName(node.value)) {
          isMemberOfEnumeration = false;
        }

        if (node.value === 'name' || node.value === 'value') {
          isMemberOfEnumeration = false;
        }

        const valueType = getValueType();

        if (isObject(valueType) && valueType.classType.details.fields.get('__get__')) {
          isMemberOfEnumeration = false;
        }

        if (isMemberOfEnumeration) {
          return ObjectType.create(ClassType.cloneWithLiteral(enumClassInfo.classType, new EnumLiteral(enumClassInfo.classType.details.name, node.value, valueType)));
        }
      }
    }
  }

  function transformTypeForTypeAlias(type: Type, name: NameNode, errorNode: ParseNode): Type {
    if (!TypeBase.isInstantiable(type)) {
      return type;
    }

    if (isTypeAliasPlaceholder(type)) {
      return type;
    }

    let typeParameters: TypeVarType[] = [];

    if (!isTypeVar(type) || TypeBase.isAnnotated(type)) {
      doForEachSubtype(type, (subtype) => {
        addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(subtype));
      });
    }

    typeParameters = typeParameters.filter((typeVar) => !typeVar.details.isSynthesized);

    const variadics = typeParameters.filter((param) => isVariadicTypeVar(param));
    if (variadics.length > 1) {
      addError(
        Localizer.Diag.variadicTypeParamTooManyAlias().format({
          names: variadics.map((v) => `"${v.details.name}"`).join(', '),
        }),
        errorNode
      );
    }

    const fileInfo = getFileInfo(name);

    return TypeBase.cloneForTypeAlias(type, name.value, `${fileInfo.moduleName}.${name.value}`, getScopeIdForNode(name), typeParameters.length > 0 ? typeParameters : undefined);
  }

  function createSpecialBuiltInClass(node: ParseNode, assignedName: string, aliasMapEntry: AliasMapEntry): ClassType {
    const fileInfo = getFileInfo(node);
    let specialClassType = ClassType.create(
      assignedName,
      getClassFullName(node, fileInfo.moduleName, assignedName),
      fileInfo.moduleName,
      ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
      /* typeSourceId */ 0,
      /* declaredMetaclass */ undefined,
      /* effectiveMetaclass */ undefined
    );

    if (fileInfo.isTypingExtensionsStubFile) {
      specialClassType.details.flags |= ClassTypeFlags.TypingExtensionClass;
    }

    const baseClassName = aliasMapEntry.alias || 'object';

    let baseClass: Type | undefined;
    if (aliasMapEntry.module === 'builtins') {
      baseClass = getBuiltInType(node, baseClassName);
    } else if (aliasMapEntry.module === 'collections') {
      if (fileInfo.collectionsModulePath) {
        const lookupResult = importLookup(fileInfo.collectionsModulePath);
        if (lookupResult) {
          const symbol = lookupResult.symbolTable.get(baseClassName);
          if (symbol) {
            baseClass = getEffectiveTypeOfSymbol(symbol);
          }
        }
      }
    } else if (aliasMapEntry.module === 'self') {
      const symbolWithScope = lookUpSymbolRecursive(node, baseClassName, /* honorCodeFlow */ false);
      if (symbolWithScope) {
        baseClass = getEffectiveTypeOfSymbol(symbolWithScope.symbol);

        if (isClass(baseClass) && ClassType.isBuiltIn(baseClass, '_TypedDict')) {
          baseClass.details.flags &= ~(ClassTypeFlags.HasAbstractMethods | ClassTypeFlags.SupportsAbstractMethods);
        }
      }
    }

    if (baseClass && isClass(baseClass)) {
      if (aliasMapEntry.alias) {
        specialClassType = ClassType.cloneForTypingAlias(baseClass, assignedName);
      } else {
        specialClassType.details.baseClasses.push(baseClass);
        specialClassType.details.effectiveMetaclass = baseClass.details.effectiveMetaclass;
        computeMroLinearization(specialClassType);
      }
    } else {
      specialClassType.details.baseClasses.push(UnknownType.create());
      specialClassType.details.effectiveMetaclass = UnknownType.create();
      computeMroLinearization(specialClassType);
    }

    return specialClassType;
  }

  function handleTypingStubTypeAnnotation(node: ExpressionNode): ClassType | undefined {
    if (!node.parent || node.parent.nodeType !== ParseNodeType.TypeAnnotation) {
      return undefined;
    }

    if (node.parent.valueExpression.nodeType !== ParseNodeType.Name) {
      return undefined;
    }

    const nameNode = node.parent.valueExpression;
    const assignedName = nameNode.value;

    const specialTypes: { [name: string]: AliasMapEntry } = {
      Tuple: { alias: 'tuple', module: 'builtins' },
      Generic: { alias: '', module: 'builtins' },
      Protocol: { alias: '', module: 'builtins' },
      Callable: { alias: '', module: 'builtins' },
      Type: { alias: 'type', module: 'builtins' },
      ClassVar: { alias: '', module: 'builtins' },
      Final: { alias: '', module: 'builtins' },
      Literal: { alias: '', module: 'builtins' },
      TypedDict: { alias: '_TypedDict', module: 'self' },
      Union: { alias: '', module: 'builtins' },
      Optional: { alias: '', module: 'builtins' },
      Annotated: { alias: '', module: 'builtins' },
      TypeAlias: { alias: '', module: 'builtins' },
      Concatenate: { alias: '', module: 'builtins' },
      TypeGuard: { alias: '', module: 'builtins' },
      Unpack: { alias: '', module: 'builtins' },
      Required: { alias: '', module: 'builtins' },
      NotRequired: { alias: '', module: 'builtins' },
    };

    const aliasMapEntry = specialTypes[assignedName];
    if (aliasMapEntry) {
      const cachedType = readTypeCache(node);
      if (cachedType) {
        assert(isClass(cachedType));
        return cachedType as ClassType;
      }
      const specialType = createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
      writeTypeCache(node, specialType, /* isIncomplete */ false);
      return specialType;
    }

    return undefined;
  }

  function handleTypingStubAssignment(node: AssignmentNode): Type | undefined {
    if (node.leftExpression.nodeType !== ParseNodeType.Name) {
      return undefined;
    }

    const nameNode = node.leftExpression;
    const assignedName = nameNode.value;

    if (assignedName === 'Any') {
      return AnyType.create();
    }

    const specialTypes: { [name: string]: AliasMapEntry } = {
      overload: { alias: '', module: 'builtins' },
      TypeVar: { alias: '', module: 'builtins' },
      _promote: { alias: '', module: 'builtins' },
      no_type_check: { alias: '', module: 'builtins' },
      NoReturn: { alias: '', module: 'builtins' },
      Counter: { alias: 'Counter', module: 'collections' },
      List: { alias: 'list', module: 'builtins' },
      Dict: { alias: 'dict', module: 'builtins' },
      DefaultDict: { alias: 'defaultdict', module: 'collections' },
      Set: { alias: 'set', module: 'builtins' },
      FrozenSet: { alias: 'frozenset', module: 'builtins' },
      Deque: { alias: 'deque', module: 'collections' },
      ChainMap: { alias: 'ChainMap', module: 'collections' },
      OrderedDict: { alias: 'OrderedDict', module: 'collections' },
    };

    const aliasMapEntry = specialTypes[assignedName];
    if (aliasMapEntry) {
      return createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
    }

    return undefined;
  }

  function evaluateTypesForAssignmentStatement(node: AssignmentNode): void {
    const fileInfo = getFileInfo(node);

    if (readTypeCache(node)) {
      return;
    }

    let rightHandType = readTypeCache(node.rightExpression);
    let isIncomplete = false;
    let expectedTypeDiagAddendum: DiagAddendum | undefined;

    if (!rightHandType) {
      if (fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
        rightHandType = handleTypingStubAssignment(node);
        if (rightHandType) {
          writeTypeCache(node.rightExpression, rightHandType, /* isIncomplete */ false);
        }
      }

      if (!rightHandType) {
        const declaredType = getDeclaredTypeForExpression(node.leftExpression);

        let flags: EvaluatorFlags = EvaluatorFlags.DoNotSpecialize;
        if (fileInfo.isStubFile) {
          flags |= EvaluatorFlags.ConvertEllipsisToUnknown;
        }

        let typeAliasNameNode: NameNode | undefined;
        let isSpeculativeTypeAlias = false;

        if (isDeclaredTypeAlias(node.leftExpression)) {
          flags |= EvaluatorFlags.ExpectingType | EvaluatorFlags.EvaluateStringLiteralAsType | EvaluatorFlags.ParamSpecDisallowed | EvaluatorFlags.TypeVarTupleDisallowed;

          typeAliasNameNode = (node.leftExpression as TypeAnnotationNode).valueExpression as NameNode;
        } else if (node.leftExpression.nodeType === ParseNodeType.Name) {
          const symbolWithScope = lookUpSymbolRecursive(node.leftExpression, node.leftExpression.value, /* honorCodeFlow */ false);
          if (symbolWithScope) {
            const decls = symbolWithScope.symbol.getDeclarations();
            if (decls.length === 1 && isPossibleTypeAliasDeclaration(decls[0])) {
              typeAliasNameNode = node.leftExpression;
              isSpeculativeTypeAlias = true;
            }
          }
        }

        let typeAliasTypeVar: TypeVarType | undefined;
        if (typeAliasNameNode) {
          typeAliasTypeVar = TypeVarType.createInstantiable(`__type_alias_${typeAliasNameNode.value}`);
          typeAliasTypeVar.details.isSynthesized = true;
          typeAliasTypeVar.details.recursiveTypeAliasName = typeAliasNameNode.value;
          const scopeId = getScopeIdForNode(typeAliasNameNode);
          typeAliasTypeVar.details.recursiveTypeAliasScopeId = scopeId;
          typeAliasTypeVar.scopeId = scopeId;

          writeTypeCache(node, typeAliasTypeVar, /* isIncomplete */ false);
          writeTypeCache(node.leftExpression, typeAliasTypeVar, /* isIncomplete */ false);
        }

        const srcTypeResult = getTypeOfExpression(node.rightExpression, declaredType, flags);
        let srcType = srcTypeResult.type;
        expectedTypeDiagAddendum = srcTypeResult.expectedTypeDiagAddendum;
        if (srcTypeResult.isIncomplete) {
          isIncomplete = true;
        }

        const constExprValue = evaluateStaticBoolExpression(node.rightExpression, fileInfo.executionEnvironment);

        if (constExprValue !== undefined) {
          const boolType = getBuiltInObject(node, 'bool');
          if (isObject(boolType)) {
            srcType = ObjectType.create(ClassType.cloneWithLiteral(boolType.classType, constExprValue));
          }
        }

        if (declaredType) {
          const diagAddendum = new DiagAddendum();

          if (canAssignType(declaredType, srcType, diagAddendum)) {
            srcType = narrowTypeBasedOnAssignment(declaredType, srcType);
          }
        }

        rightHandType = srcType;
        if (node.leftExpression.nodeType === ParseNodeType.Name && !node.typeAnnotationComment) {
          rightHandType = transformTypeForPossibleEnumClass(node.leftExpression, () => rightHandType!) || rightHandType;
        }

        if (typeAliasNameNode) {
          deleteTypeCacheEntry(node);
          deleteTypeCacheEntry(node.leftExpression);

          if (!isSpeculativeTypeAlias || (TypeBase.isInstantiable(rightHandType) && !isUnknown(rightHandType))) {
            rightHandType = transformTypeForTypeAlias(rightHandType, typeAliasNameNode, node.rightExpression);

            if (isTypeAliasRecursive(typeAliasTypeVar!, rightHandType)) {
              addDiag(
                fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                Localizer.Diag.typeAliasIsRecursive().format({ name: typeAliasNameNode.value }),
                node.rightExpression
              );
            }

            typeAliasTypeVar!.details.boundType = rightHandType;

            typeAliasTypeVar!.details.recursiveTypeParameters = rightHandType.typeAliasInfo?.typeParameters;
          }
        }
      }
    }

    assignTypeToExpression(node.leftExpression, rightHandType, isIncomplete, node.rightExpression, expectedTypeDiagAddendum);

    writeTypeCache(node, rightHandType, isIncomplete);
  }

  function evaluateTypesForAugmentedAssignment(node: AugmentedAssignmentNode): void {
    if (readTypeCache(node)) {
      return;
    }

    const destTypeResult = getTypeFromAugmentedAssignment(node, /* expectedType */ undefined);
    assignTypeToExpression(node.destExpression, destTypeResult.type, !!destTypeResult.isIncomplete, node.rightExpression);

    writeTypeCache(node, destTypeResult.type, !!destTypeResult.isIncomplete);
  }

  function getTypeOfClass(node: ClassNode): ClassTypeResult | undefined {
    const cachedClassType = readTypeCache(node.name);

    if (cachedClassType) {
      if (!isClass(cachedClassType)) {
        return undefined;
      }
      return { classType: cachedClassType, decoratedType: readTypeCache(node) || UnknownType.create() };
    }

    const scope = ScopeUtils.getScopeForNode(node);

    const fileInfo = getFileInfo(node);
    let classFlags = ClassTypeFlags.None;
    if (scope?.type === ScopeType.Builtin || fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile || fileInfo.isBuiltInStubFile) {
      classFlags |= ClassTypeFlags.BuiltInClass;

      if (fileInfo.isTypingExtensionsStubFile) {
        classFlags |= ClassTypeFlags.TypingExtensionClass;
      }

      if (node.name.value === 'property') {
        classFlags |= ClassTypeFlags.PropertyClass;
      }

      if (node.name.value === 'tuple') {
        classFlags |= ClassTypeFlags.TupleClass;
      }
    }

    const classType = ClassType.create(
      node.name.value,
      getClassFullName(node, fileInfo.moduleName, node.name.value),
      fileInfo.moduleName,
      classFlags,
      /* typeSourceId */ 0,
      /* declaredMetaclass */ undefined,
      /* effectiveMetaclass */ undefined,
      ParseTreeUtils.getDocString(node.suite.statements)
    );

    classType.details.typeVarScopeId = getScopeIdForNode(node);

    const classSymbol = scope?.lookUpSymbol(node.name.value);
    let classDecl: ClassDeclaration | undefined;
    const decl = AnalyzerNodeInfo.getDeclaration(node);
    if (decl) {
      classDecl = decl as ClassDeclaration;
    }
    if (classDecl) {
      setSymbolResolutionPartialType(classSymbol!, classDecl, classType);
    }
    classType.details.flags |= ClassTypeFlags.PartiallyConstructed;
    writeTypeCache(node, classType, /* isIncomplete */ false);
    writeTypeCache(node.name, classType, /* isIncomplete */ false);

    const typeParameters: TypeVarType[] = [];

    let genericTypeParameters: TypeVarType[] | undefined;

    const initSubclassArgs: FunctionArgument[] = [];
    let metaclassNode: ExpressionNode | undefined;
    let exprFlags = EvaluatorFlags.ExpectingType | EvaluatorFlags.GenericClassTypeAllowed | EvaluatorFlags.DisallowTypeVarsWithScopeId | EvaluatorFlags.AssociateTypeVarsWithCurrentScope;
    if (fileInfo.isStubFile) {
      exprFlags |= EvaluatorFlags.AllowForwardReferences;
    }

    node.arguments.forEach((arg) => {
      if (!arg.name) {
        let argType = getTypeOfExpression(arg.valueExpression, undefined, exprFlags).type;

        if (isUnion(argType)) {
          argType = removeUnbound(argType);
        }

        if (!isAnyOrUnknown(argType) && !isUnbound(argType)) {
          argType = transformTypeObjectToClass(argType);
          if (!isClass(argType)) {
            addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.baseClassInvalid(), arg);
            argType = UnknownType.create();
          } else {
            if (ClassType.isBuiltIn(argType, 'Protocol')) {
              if (!fileInfo.isStubFile && !ClassType.isTypingExtensionClass(argType) && fileInfo.executionEnvironment.pythonVersion < PythonVersion.V3_7) {
                addError(Localizer.Diag.protocolIllegal(), arg.valueExpression);
              }
              classType.details.flags |= ClassTypeFlags.ProtocolClass;
            }

            if (ClassType.isBuiltIn(argType, 'property')) {
              classType.details.flags |= ClassTypeFlags.PropertyClass;
            }

            if (fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_6) {
              if (ClassType.isBuiltIn(argType, 'NamedTuple')) {
                classType.details.flags |= ClassTypeFlags.DataClass;
              }
            }

            if (ClassType.isBuiltIn(argType, 'TypedDict') || ClassType.isTypedDictClass(argType)) {
              classType.details.flags |= ClassTypeFlags.TypedDictClass;
            } else if (ClassType.isTypedDictClass(classType) && !ClassType.isTypedDictClass(argType)) {
              addError(Localizer.Diag.typedDictBaseClass(), arg);
            }

            if (derivesFromClassRecursive(argType, classType, /* ignoreUnknown */ true)) {
              addError(Localizer.Diag.baseClassCircular(), arg);
              argType = UnknownType.create();
            }
          }
        }

        if (isUnknown(argType)) {
          addDiag(fileInfo.diagnosticRuleSet.reportUntypedBaseClass, DiagRule.reportUntypedBaseClass, Localizer.Diag.baseClassUnknown(), arg);
        }

        if (
          classType.details.baseClasses.some((prevBaseClass) => {
            return isClass(prevBaseClass) && isClass(argType) && ClassType.isSameGenericClass(argType, prevBaseClass);
          })
        ) {
          addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.duplicateBaseClass(), arg.name || arg);
        }

        classType.details.baseClasses.push(argType);
        if (isClass(argType)) {
          if (ClassType.isEnumClass(argType)) {
            classType.details.flags |= ClassTypeFlags.EnumClass;
          }

          if (ClassType.supportsAbstractMethods(argType) || (ClassType.isProtocolClass(argType) && !ClassType.isBuiltIn(argType))) {
            classType.details.flags |= ClassTypeFlags.SupportsAbstractMethods;
          }

          if (ClassType.isPropertyClass(argType)) {
            classType.details.flags |= ClassTypeFlags.PropertyClass;
          }

          if (ClassType.isFinal(argType)) {
            const className = printObjectTypeForClass(argType);
            addError(Localizer.Diag.baseClassFinal().format({ type: className }), arg.valueExpression);
          }
        }

        addTypeVarsToListIfUnique(typeParameters, getTypeVarArgumentsRecursive(argType));
        if (isClass(argType) && ClassType.isBuiltIn(argType, 'Generic')) {
          if (!genericTypeParameters) {
            genericTypeParameters = [];
            addTypeVarsToListIfUnique(genericTypeParameters, getTypeVarArgumentsRecursive(argType));
          }
        }
      } else if (arg.name.value === 'metaclass') {
        if (metaclassNode) {
          addError(Localizer.Diag.metaclassDuplicate(), arg);
        } else {
          metaclassNode = arg.valueExpression;
        }
      } else if (arg.name.value === 'total' && ClassType.isTypedDictClass(classType)) {
        const constArgValue = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
        if (constArgValue === undefined) {
          addError(Localizer.Diag.typedDictTotalParam(), arg.valueExpression);
        } else if (!constArgValue) {
          classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
        }
      } else {
        initSubclassArgs.push({
          argumentCategory: ArgumentCategory.Simple,
          node: arg,
          name: arg.name,
          valueExpression: arg.valueExpression,
        });
      }
    });

    if (classType.details.baseClasses.length > 1) {
      if (classType.details.baseClasses.some((baseClass) => isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'NamedTuple'))) {
        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.namedTupleMultipleInheritance(), node.name);
      }
    }

    if (!ClassType.isBuiltIn(classType, 'object')) {
      classType.details.baseClasses.push(getBuiltInType(node, 'object'));
    }

    classType.details.typeParameters = genericTypeParameters || typeParameters;

    const variadics = classType.details.typeParameters.filter((param) => isVariadicTypeVar(param));
    if (variadics.length > 1) {
      addError(
        Localizer.Diag.variadicTypeParamTooManyClass().format({
          names: variadics.map((v) => `"${v.details.name}"`).join(', '),
        }),
        node.name,
        TextRange.combine(node.arguments) || node.name
      );
    }

    if (!computeMroLinearization(classType)) {
      addError(Localizer.Diag.methodOrdering(), node.name);
    }

    const innerScope = ScopeUtils.getScopeForNode(node.suite);
    classType.details.fields = innerScope?.symbolTable || new Map<string, Symbol>();

    if (ClassType.isTypedDictClass(classType)) {
      synthesizeTypedDictClassMethods(node, classType);
    }

    if (!fileInfo.isStubFile && classType.details.typeParameters.length === 0) {
      const initMethod = classType.details.fields.get('__init__');
      if (initMethod) {
        const initDecls = initMethod.getTypedDeclarations();
        if (initDecls.length === 1 && initDecls[0].type === DeclarationType.Function) {
          const initDeclNode = initDecls[0].node;
          const initParams = initDeclNode.parameters;

          if (initParams.length > 1 && !initParams.some((param, index) => !!getTypeAnnotationForParameter(initDeclNode, index))) {
            const genericParams = initParams.filter((param, index) => index > 0 && param.name && param.category === ParameterCategory.Simple);

            if (genericParams.length > 0) {
              classType.details.flags |= ClassTypeFlags.PseudoGenericClass;

              classType.details.typeParameters = genericParams.map((param) => {
                const typeVar = TypeVarType.createInstance(`__type_of_${param.name!.value}`);
                typeVar.details.isSynthesized = true;
                typeVar.scopeId = getScopeIdForNode(initDeclNode);
                typeVar.details.boundType = UnknownType.create();
                return TypeVarType.cloneForScopeId(typeVar, getScopeIdForNode(node), node.name.value);
              });
            }
          }
        }
      }
    }

    if (classType.details.typeParameters.length === 0) {
      if (classType.details.baseClasses.some((baseClass) => isClass(baseClass) && ClassType.hasCustomClassGetItem(baseClass)) || classType.details.fields.has('__class_getitem__')) {
        classType.details.flags |= ClassTypeFlags.HasCustomClassGetItem;
      }
    }

    if (metaclassNode) {
      const metaclassType = getTypeOfExpression(metaclassNode, undefined, exprFlags).type;
      if (isClass(metaclassType) || isUnknown(metaclassType)) {
        classType.details.declaredMetaclass = metaclassType;
        if (isClass(metaclassType)) {
          if (ClassType.isBuiltIn(metaclassType, 'EnumMeta')) {
            classType.details.flags |= ClassTypeFlags.EnumClass;
          } else if (ClassType.isBuiltIn(metaclassType, 'ABCMeta')) {
            classType.details.flags |= ClassTypeFlags.SupportsAbstractMethods;
          }
        }
      }
    }

    let effectiveMetaclass = classType.details.declaredMetaclass;
    let reportedMetaclassConflict = false;

    if (!effectiveMetaclass || isClass(effectiveMetaclass)) {
      for (const baseClass of classType.details.baseClasses) {
        if (isClass(baseClass)) {
          const baseClassMeta = baseClass.details.effectiveMetaclass || typeClassType;
          if (baseClassMeta && isClass(baseClassMeta)) {
            if (!effectiveMetaclass) {
              effectiveMetaclass = baseClassMeta;
            } else if (derivesFromClassRecursive(baseClassMeta, effectiveMetaclass, /* ignoreUnknown */ false)) {
              effectiveMetaclass = baseClassMeta;
            } else if (!derivesFromClassRecursive(effectiveMetaclass, baseClassMeta, /* ignoreUnknown */ false)) {
              if (!reportedMetaclassConflict) {
                addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.metaclassConflict(), node.name);

                reportedMetaclassConflict = true;
              }
            }
          } else {
            effectiveMetaclass = baseClassMeta ? UnknownType.create() : undefined;
            break;
          }
        } else {
          effectiveMetaclass = UnknownType.create();
          break;
        }
      }
    }

    if (!effectiveMetaclass) {
      const typeMetaclass = getBuiltInType(node, 'type');
      effectiveMetaclass = typeMetaclass && isClass(typeMetaclass) ? typeMetaclass : UnknownType.create();
    }

    classType.details.effectiveMetaclass = effectiveMetaclass;

    if (ClassType.supportsAbstractMethods(classType)) {
      if (getAbstractMethods(classType).length > 0) {
        classType.details.flags |= ClassTypeFlags.HasAbstractMethods;
      }
    }

    let decoratedType: Type = classType;
    let foundUnknown = false;

    for (let i = node.decorators.length - 1; i >= 0; i--) {
      const decorator = node.decorators[i];

      const newDecoratedType = applyClassDecorator(decoratedType, classType, decorator);
      if (containsUnknown(newDecoratedType)) {
        if (!foundUnknown) {
          addDiag(fileInfo.diagnosticRuleSet.reportUntypedClassDecorator, DiagRule.reportUntypedClassDecorator, Localizer.Diag.classDecoratorTypeUnknown(), node.decorators[i].expression);

          foundUnknown = true;
        }
      } else {
        decoratedType = newDecoratedType;
      }
    }

    if (ClassType.isDataClass(classType)) {
      let skipSynthesizedInit = ClassType.isSkipSynthesizedDataClassInit(classType);
      if (!skipSynthesizedInit) {
        const initSymbol = lookUpClassMember(classType, '__init__', ClassMemberLookupFlags.SkipBaseClasses);
        if (initSymbol) {
          const initSymbolType = getTypeOfMember(initSymbol);
          if (isFunction(initSymbolType)) {
            if (!FunctionType.isSynthesizedMethod(initSymbolType)) {
              skipSynthesizedInit = true;
            }
          } else {
            skipSynthesizedInit = true;
          }
        }
      }

      synthesizeDataClassMethods(node, classType, skipSynthesizedInit);
    }

    classType.details.flags &= ~ClassTypeFlags.PartiallyConstructed;

    writeTypeCache(node.name, classType, /* isIncomplete */ false);

    writeTypeCache(node, decoratedType, /* isIncomplete */ false);

    if (initSubclassArgs.length > 0) {
      validateInitSubclassArgs(node, classType, initSubclassArgs);
    }

    return { classType, decoratedType };
  }

  function applyClassDecorator(inputClassType: Type, originalClassType: ClassType, decoratorNode: DecoratorNode): Type {
    const decoratorType = getTypeOfExpression(decoratorNode.expression).type;

    if (isOverloadedFunction(decoratorType)) {
      if (decoratorType.overloads[0].details.builtInName === 'dataclass') {
        originalClassType.details.flags |= ClassTypeFlags.DataClass;
      }
    } else if (isFunction(decoratorType)) {
      if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
        const decoratorCallType = getTypeOfExpression(decoratorNode.expression.leftExpression).type;

        if (isOverloadedFunction(decoratorCallType) && decoratorCallType.overloads[0].details.builtInName === 'dataclass') {
          originalClassType.details.flags |= ClassTypeFlags.DataClass;

          if (decoratorNode.expression.arguments) {
            decoratorNode.expression.arguments.forEach((arg) => {
              if (arg.name) {
                if (arg.valueExpression) {
                  const fileInfo = getFileInfo(decoratorNode);
                  const value = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                  if (value === true) {
                    if (arg.name.value === 'order') {
                      originalClassType.details.flags |= ClassTypeFlags.SynthesizedDataClassOrder;
                    } else if (arg.name.value === 'frozen') {
                      originalClassType.details.flags |= ClassTypeFlags.FrozenDataClass;

                      if (originalClassType.details.baseClasses.some((baseClass) => isClass(baseClass) && ClassType.isDataClass(baseClass) && !ClassType.isFrozenDataClass(baseClass))) {
                        addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.dataClassBaseClassNotFrozen(), arg);
                      }
                    }
                  } else if (value === false) {
                    if (arg.name.value === 'init') {
                      originalClassType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassInit;
                    } else if (arg.name.value === 'eq') {
                      originalClassType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassEq;
                    }
                  }
                }
              }
            });
          }

          return inputClassType;
        }
      }

      if (decoratorType.details.builtInName === 'final') {
        originalClassType.details.flags |= ClassTypeFlags.Final;
      } else if (decoratorType.details.builtInName === 'runtime_checkable') {
        originalClassType.details.flags |= ClassTypeFlags.RuntimeCheckable;
      }
    }

    return getTypeFromDecorator(decoratorNode, inputClassType);
  }

  function validateInitSubclassArgs(node: ClassNode, classType: ClassType, argList: FunctionArgument[]) {
    const errorNode = argList[0].node!.name!;
    const initSubclassMethodInfo = getTypeFromClassMemberName(
      errorNode,
      classType,
      '__init_subclass__',
      { method: 'get' },
      new DiagAddendum(),
      MemberAccessFlags.AccessClassMembersOnly | MemberAccessFlags.SkipObjectBaseClass,
      classType
    );

    if (initSubclassMethodInfo) {
      const initSubclassMethodType = initSubclassMethodInfo.type;

      if (initSubclassMethodType) {
        validateCallArguments(errorNode, argList, initSubclassMethodType, new TypeVarMap(getTypeVarScopeId(initSubclassMethodType)), /* skipUnknownArgCheck */ false, NoneType.createInstance());
      }
    }
  }

  function getTypeOfFunction(node: FunctionNode): FunctionTypeResult | undefined {
    const fileInfo = getFileInfo(node);

    const cachedFunctionType = readTypeCache(node.name) as FunctionType;

    if (cachedFunctionType) {
      if (!isFunction(cachedFunctionType)) {
        return undefined;
      }
      return { functionType: cachedFunctionType, decoratedType: readTypeCache(node) || UnknownType.create() };
    }

    let functionDecl: FunctionDeclaration | undefined;
    const decl = AnalyzerNodeInfo.getDeclaration(node);
    if (decl) {
      functionDecl = decl as FunctionDeclaration;
    }

    const containingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);
    let containingClassType: ClassType | undefined;
    if (containingClassNode) {
      const classInfo = getTypeOfClass(containingClassNode);
      if (!classInfo) {
        return undefined;
      }
      containingClassType = classInfo.classType;
    }

    let functionFlags = getFunctionFlagsFromDecorators(node, !!containingClassNode);
    if (functionDecl?.isGenerator) {
      functionFlags |= FunctionTypeFlags.Generator;
    }

    if (containingClassNode && node.name.value === '__class_getitem__') {
      functionFlags |= FunctionTypeFlags.ClassMethod;
    }

    if (fileInfo.isStubFile) {
      functionFlags |= FunctionTypeFlags.StubDefinition;
    } else if (fileInfo.isInPyTypedPackage && evaluatorOptions.disableInferenceForPyTypedSources) {
      functionFlags |= FunctionTypeFlags.PyTypedDefinition;
    }

    if (node.isAsync) {
      functionFlags |= FunctionTypeFlags.Async;
    }

    const functionType = FunctionType.createInstance(
      node.name.value,
      getFunctionFullName(node, fileInfo.moduleName, node.name.value),
      fileInfo.moduleName,
      functionFlags,
      ParseTreeUtils.getDocString(node.suite.statements)
    );

    functionType.details.typeVarScopeId = getScopeIdForNode(node);

    if (fileInfo.isBuiltInStubFile || fileInfo.isTypingStubFile || fileInfo.isTypingExtensionsStubFile) {
      functionType.details.builtInName = node.name.value;
    }

    functionType.details.declaration = functionDecl;

    const scope = ScopeUtils.getScopeForNode(node);
    const functionSymbol = scope?.lookUpSymbolRecursive(node.name.value);
    if (functionDecl && functionSymbol) {
      setSymbolResolutionPartialType(functionSymbol.symbol, functionDecl, functionType);
    }
    writeTypeCache(node, functionType, /* isIncomplete */ false);
    writeTypeCache(node.name, functionType, /* isIncomplete */ false);

    const addGenericParamTypes = containingClassType && ClassType.isPseudoGenericClass(containingClassType) && node.name.value === '__init__';

    const paramTypes: Type[] = [];
    let typeParamIndex = 0;

    let firstCommentAnnotationIndex = 0;
    if (containingClassType && (functionType.details.flags & FunctionTypeFlags.StaticMethod) === 0) {
      firstCommentAnnotationIndex = 1;
    }

    if (node.functionAnnotationComment && !node.functionAnnotationComment.isParamListEllipsis) {
      const expected = node.parameters.length - firstCommentAnnotationIndex;
      const received = node.functionAnnotationComment.paramTypeAnnotations.length;

      if (firstCommentAnnotationIndex > 0 && received === node.parameters.length) {
        firstCommentAnnotationIndex = 0;
      } else if (received !== expected) {
        addError(
          Localizer.Diag.annotatedParamCountMismatch().format({
            expected,
            received,
          }),
          node.functionAnnotationComment
        );
      }
    }

    node.parameters.forEach((param, index) => {
      let paramType: Type | undefined;
      let annotatedType: Type | undefined;
      let isNoneWithoutOptional = false;
      let paramTypeNode: ExpressionNode | undefined;

      if (param.typeAnnotation) {
        paramTypeNode = param.typeAnnotation;
      } else if (param.typeAnnotationComment) {
        paramTypeNode = param.typeAnnotationComment;
      } else if (node.functionAnnotationComment && !node.functionAnnotationComment.isParamListEllipsis) {
        const adjustedIndex = index - firstCommentAnnotationIndex;
        if (adjustedIndex >= 0 && adjustedIndex < node.functionAnnotationComment.paramTypeAnnotations.length) {
          paramTypeNode = node.functionAnnotationComment.paramTypeAnnotations[adjustedIndex];
        }
      }

      if (paramTypeNode) {
        annotatedType = getTypeOfAnnotation(paramTypeNode, /* allowFinal */ false, /* associateTypeVarsWithScope */ true, /* allowTypeVarType */ param.category === ParameterCategory.VarArgList);

        if (isVariadicTypeVar(annotatedType) && !annotatedType.isVariadicUnpacked) {
          addError(
            Localizer.Diag.unpackedTypeVarTupleExpected().format({
              name1: annotatedType.details.name,
              name2: annotatedType.details.name,
            }),
            paramTypeNode
          );
          annotatedType = UnknownType.create();
        }
      }

      if (!annotatedType && addGenericParamTypes) {
        if (index > 0 && param.category === ParameterCategory.Simple && param.name) {
          annotatedType = containingClassType!.details.typeParameters[typeParamIndex];
          typeParamIndex++;
        }
      }

      if (annotatedType) {
        if (param.defaultValue && param.defaultValue.nodeType === ParseNodeType.Constant) {
          if (param.defaultValue.constType === KeywordType.None) {
            isNoneWithoutOptional = true;

            if (!fileInfo.diagnosticRuleSet.strictParameterNoneValue) {
              annotatedType = combineTypes([annotatedType, NoneType.createInstance()]);
            }
          }
        }
      }

      let defaultValueType: Type | undefined;
      if (param.defaultValue) {
        defaultValueType = getTypeOfExpression(param.defaultValue, annotatedType, EvaluatorFlags.ConvertEllipsisToAny).type;
      }

      if (annotatedType) {
        if (param.defaultValue && defaultValueType) {
          const diagAddendum = new DiagAddendum();
          const typeVarMap = new TypeVarMap(functionType.details.typeVarScopeId);
          if (containingClassType && containingClassType.details.typeVarScopeId !== undefined) {
            if (node.name.value === '__init__' || node.name.value === '__new__') {
              typeVarMap.addSolveForScope(containingClassType.details.typeVarScopeId);
            }
          }

          if (!canAssignType(annotatedType, defaultValueType, diagAddendum, typeVarMap)) {
            const diag = addDiag(
              fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.paramAssignmentMismatch().format({
                sourceType: printType(defaultValueType),
                paramType: printType(annotatedType),
              }) + diagAddendum.getString(),
              param.defaultValue
            );

            if (isNoneWithoutOptional && paramTypeNode) {
              const addOptionalAction: AddMissingOptionalToParamAction = {
                action: Commands.addMissingOptionalToParam,
                offsetOfTypeNode: paramTypeNode.start + 1,
              };
              if (diag) {
                diag.addAction(addOptionalAction);
              }
            }
          }
        }

        paramType = annotatedType;
      }

      const functionParam: FunctionParameter = {
        category: param.category,
        name: param.name ? param.name.value : undefined,
        hasDefault: !!param.defaultValue,
        defaultValueExpression: param.defaultValue,
        defaultType: defaultValueType,
        type: paramType || UnknownType.create(),
        typeAnnotation: paramTypeNode,
        hasDeclaredType: !!paramTypeNode,
      };

      FunctionType.addParameter(functionType, functionParam);

      if (param.name) {
        const variadicParamType = transformVariadicParamType(node, param.category, functionParam.type);
        paramTypes.push(variadicParamType);
      } else {
        paramTypes.push(functionParam.type);
      }
    });

    if (containingClassType) {
      if (functionType.details.parameters.length > 0) {
        const typeAnnotation = getTypeAnnotationForParameter(node, 0);
        if (!typeAnnotation) {
          const inferredParamType = inferFirstParamType(functionType.details.flags, containingClassType, node);
          if (inferredParamType) {
            functionType.details.parameters[0].type = inferredParamType;
            if (!isAnyOrUnknown(inferredParamType)) {
              functionType.details.parameters[0].isTypeInferred = true;
            }

            paramTypes[0] = inferredParamType;
          }
        }
      }
    }

    paramTypes.forEach((paramType, index) => {
      const paramNameNode = node.parameters[index].name;
      if (paramNameNode) {
        if (isUnknown(paramType)) {
          functionType.details.flags |= FunctionTypeFlags.UnannotatedParams;
        }
        writeTypeCache(paramNameNode, paramType, /* isIncomplete */ false);
      }
    });

    if (node.returnTypeAnnotation) {
      functionType.details.declaredReturnType = UnknownType.create();

      const returnType = getTypeOfAnnotation(node.returnTypeAnnotation, /* allowFinal */ false, /* associateTypeVarsWithScope */ true);
      functionType.details.declaredReturnType = returnType;
    } else if (node.functionAnnotationComment) {
      functionType.details.declaredReturnType = UnknownType.create();

      const returnType = getTypeOfAnnotation(node.functionAnnotationComment.returnTypeAnnotation, /* allowFinal */ false, /* associateTypeVarsWithScope */ true);
      functionType.details.declaredReturnType = returnType;
    } else {
      if (fileInfo.isStubFile) {
        if (node.name.value === '__init__') {
          functionType.details.declaredReturnType = NoneType.createInstance();
        } else {
          functionType.details.declaredReturnType = UnknownType.create();
        }
      }
    }

    const preDecoratedType = node.isAsync ? createAsyncFunction(node, functionType) : functionType;

    let decoratedType: Type = preDecoratedType;
    let foundUnknown = false;
    for (let i = node.decorators.length - 1; i >= 0; i--) {
      const decorator = node.decorators[i];

      const newDecoratedType = applyFunctionDecorator(decoratedType, functionType, decorator, node);
      if (containsUnknown(newDecoratedType)) {
        if (!foundUnknown) {
          addDiag(fileInfo.diagnosticRuleSet.reportUntypedFunctionDecorator, DiagRule.reportUntypedFunctionDecorator, Localizer.Diag.functionDecoratorTypeUnknown(), node.decorators[i].expression);

          foundUnknown = true;
        }
      } else {
        decoratedType = newDecoratedType;
      }
    }

    if (isFunction(decoratedType)) {
      decoratedType = addOverloadsToFunctionType(node, decoratedType);
    }

    writeTypeCache(node.name, functionType, /* isIncomplete */ false);
    writeTypeCache(node, decoratedType, /* isIncomplete */ false);

    return { functionType, decoratedType };
  }

  function inferFirstParamType(flags: FunctionTypeFlags, containingClassType: ClassType, functionNode: FunctionNode): Type | undefined {
    if ((flags & FunctionTypeFlags.StaticMethod) === 0) {
      if (containingClassType) {
        const hasClsParam = flags & (FunctionTypeFlags.ClassMethod | FunctionTypeFlags.ConstructorMethod);

        const selfType = TypeVarType.createInstance(`__type_of_self_${containingClassType.details.name}`);
        const scopeId = getScopeIdForNode(functionNode);
        selfType.details.isSynthesized = true;
        selfType.details.isSynthesizedSelfCls = true;
        selfType.nameWithScope = TypeVarType.makeNameWithScope(selfType.details.name, scopeId);
        selfType.scopeId = scopeId;

        selfType.details.boundType = ObjectType.create(selfSpecializeClassType(containingClassType, /* setSkipAbstractClassTest */ true));

        if (!hasClsParam) {
          return selfType;
        }

        const typeClass = getTypingType(functionNode, 'Type');
        if (typeClass && isClass(typeClass)) {
          return ObjectType.create(ClassType.cloneForSpecialization(typeClass, [selfType], /* isTypeArgumentExplicit */ true));
        } else {
          return AnyType.create();
        }
      }
    }

    return undefined;
  }

  function transformVariadicParamType(node: ParseNode, paramCategory: ParameterCategory, type: Type): Type {
    switch (paramCategory) {
      case ParameterCategory.Simple: {
        return type;
      }

      case ParameterCategory.VarArgList: {
        if (tupleClassType && isClass(tupleClassType)) {
          let tupleTypeArgs: Type[];
          let isForVariadic = false;

          if (isVariadicTypeVar(type) && type.isVariadicUnpacked) {
            tupleTypeArgs = [type];
            isForVariadic = true;
          } else {
            tupleTypeArgs = [type, AnyType.create(/* isEllipsis */ true)];
          }

          return ObjectType.create(specializeTupleClass(tupleClassType, tupleTypeArgs, /* isTypeArgumentExplicit */ true, /* stripLiterals */ true, isForVariadic));
        }

        return UnknownType.create();
      }

      case ParameterCategory.VarArgDictionary: {
        const dictType = getBuiltInType(node, 'dict');
        const strType = getBuiltInObject(node, 'str');

        if (isClass(dictType) && isObject(strType)) {
          return ObjectType.create(ClassType.cloneForSpecialization(dictType, [strType, type], /* isTypeArgumentExplicit */ true));
        }

        return UnknownType.create();
      }
    }
  }

  function getFunctionFlagsFromDecorators(node: FunctionNode, isInClass: boolean) {
    const fileInfo = getFileInfo(node);
    let flags = FunctionTypeFlags.None;

    if (node.name.value === '__new__' && isInClass) {
      flags |= FunctionTypeFlags.ConstructorMethod;
    }

    if (node.name.value === '__init_subclass__' && isInClass) {
      flags |= FunctionTypeFlags.ClassMethod;
    }

    for (const decoratorNode of node.decorators) {
      let evaluatorFlags = EvaluatorFlags.DoNotSpecialize;
      if (fileInfo.isStubFile) {
        evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
      }

      const decoratorType = getTypeOfExpression(decoratorNode.expression, /* expectedType */ undefined, evaluatorFlags).type;
      if (isFunction(decoratorType)) {
        if (decoratorType.details.builtInName === 'abstractmethod') {
          if (isInClass) {
            flags |= FunctionTypeFlags.AbstractMethod;
          }
        } else if (decoratorType.details.builtInName === 'final') {
          flags |= FunctionTypeFlags.Final;
        }
      } else if (isClass(decoratorType)) {
        if (ClassType.isBuiltIn(decoratorType, 'staticmethod')) {
          if (isInClass) {
            flags |= FunctionTypeFlags.StaticMethod;
          }
        } else if (ClassType.isBuiltIn(decoratorType, 'classmethod')) {
          if (isInClass) {
            flags |= FunctionTypeFlags.ClassMethod;
          }
        }
      }
    }

    return flags;
  }

  function applyFunctionDecorator(inputFunctionType: Type, undecoratedType: FunctionType, decoratorNode: DecoratorNode, functionNode: FunctionNode): Type {
    const fileInfo = getFileInfo(decoratorNode);

    let evaluatorFlags = EvaluatorFlags.DoNotSpecialize;
    if (fileInfo.isStubFile) {
      evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
    }

    const decoratorType = getTypeOfExpression(decoratorNode.expression, undefined, evaluatorFlags).type;

    if (isClass(decoratorType) && ClassType.isSpecialBuiltIn(decoratorType, 'overload')) {
      if (isFunction(inputFunctionType)) {
        inputFunctionType.details.flags |= FunctionTypeFlags.Overloaded;
        undecoratedType.details.flags |= FunctionTypeFlags.Overloaded;
        return inputFunctionType;
      }
    }

    let returnType = getTypeFromDecorator(decoratorNode, inputFunctionType);

    if (isFunction(decoratorType)) {
      if (decoratorType.details.builtInName === 'abstractmethod') {
        return inputFunctionType;
      }

      if (decoratorNode.expression.nodeType === ParseNodeType.MemberAccess) {
        const baseType = getTypeOfExpression(decoratorNode.expression.leftExpression).type;
        if (isProperty(baseType)) {
          const memberName = decoratorNode.expression.memberName.value;
          if (memberName === 'setter') {
            if (isFunction(inputFunctionType)) {
              validatePropertyMethod(inputFunctionType, decoratorNode);
              return clonePropertyWithSetter(baseType, inputFunctionType, functionNode);
            } else {
              return inputFunctionType;
            }
          } else if (memberName === 'deleter') {
            if (isFunction(inputFunctionType)) {
              validatePropertyMethod(inputFunctionType, decoratorNode);
              return clonePropertyWithDeleter(baseType, inputFunctionType);
            } else {
              return inputFunctionType;
            }
          }
        }
      }
    } else if (isClass(decoratorType)) {
      if (ClassType.isBuiltIn(decoratorType)) {
        switch (decoratorType.details.name) {
          case 'classmethod':
          case 'staticmethod': {
            return inputFunctionType;
          }
        }
      }

      if (ClassType.isPropertyClass(decoratorType)) {
        if (isFunction(inputFunctionType)) {
          validatePropertyMethod(inputFunctionType, decoratorNode);
          return createProperty(decoratorNode, decoratorType.details.name, inputFunctionType, getTypeSourceId(decoratorNode));
        } else {
          return UnknownType.create();
        }
      }
    }

    if (isFunction(inputFunctionType) && isFunction(returnType)) {
      returnType = FunctionType.clone(returnType);

      if (FunctionType.isOverloaded(inputFunctionType)) {
        returnType.details.flags |= FunctionTypeFlags.Overloaded;
      }

      if (!returnType.details.docString) {
        returnType.details.docString = inputFunctionType.details.docString;
      }
    }

    return returnType;
  }

  function validatePropertyMethod(method: FunctionType, errorNode: ParseNode) {
    if (FunctionType.isStaticMethod(method)) {
      addDiag(getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.propertyStaticMethod(), errorNode);
    }
  }

  function createProperty(decoratorNode: DecoratorNode, className: string, fget: FunctionType, typeSourceId: TypeSourceId): ObjectType {
    const fileInfo = getFileInfo(decoratorNode);
    const typeMetaclass = getBuiltInType(decoratorNode, 'type');
    const propertyClass = ClassType.create(
      className,
      getClassFullName(decoratorNode, fileInfo.moduleName, `__property_${fget.details.name}`),
      fileInfo.moduleName,
      ClassTypeFlags.PropertyClass,
      typeSourceId,
      /* declaredMetaclass */ undefined,
      isClass(typeMetaclass) ? typeMetaclass : UnknownType.create()
    );
    computeMroLinearization(propertyClass);

    const propertyObject = ObjectType.create(propertyClass);

    const fields = propertyClass.details.fields;
    const fgetSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fget);
    fields.set('fget', fgetSymbol);

    const getFunction1 = FunctionType.createInstance('__get__', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded);
    getFunction1.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'self',
      type: propertyObject,
      hasDeclaredType: true,
    });
    getFunction1.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'obj',
      type: NoneType.createInstance(),
      hasDeclaredType: true,
    });
    getFunction1.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'type',
      type: AnyType.create(),
      hasDeclaredType: true,
      hasDefault: true,
      defaultType: AnyType.create(),
    });
    getFunction1.details.declaredReturnType = FunctionType.isClassMethod(fget) ? fget.details.declaredReturnType : propertyObject;
    getFunction1.details.declaration = fget.details.declaration;

    const getFunction2 = FunctionType.createInstance('__get__', '', '', FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded);
    getFunction2.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'self',
      type: propertyObject,
      hasDeclaredType: true,
    });

    let objType = fget.details.parameters.length > 0 ? fget.details.parameters[0].type : AnyType.create();
    if (isTypeVar(objType) && objType.details.isSynthesized && objType.details.boundType) {
      objType = makeTopLevelTypeVarsConcrete(objType);
    }
    getFunction2.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'obj',
      type: FunctionType.isClassMethod(fget) ? convertToInstance(objType) : objType,
      hasDeclaredType: true,
    });
    getFunction2.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'type',
      type: AnyType.create(),
      hasDeclaredType: true,
      hasDefault: true,
      defaultType: AnyType.create(),
    });
    getFunction2.details.declaredReturnType = fget.details.declaredReturnType;
    getFunction2.details.declaration = fget.details.declaration;

    getFunction2.details.typeVarScopeId = getTypeVarScopeId(fget);

    const getFunctionOverload = OverloadedFunctionType.create([getFunction1, getFunction2]);
    const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunctionOverload);
    fields.set('__get__', getSymbol);

    ['getter', 'setter', 'deleter'].forEach((accessorName) => {
      const accessorFunction = FunctionType.createInstance(accessorName, '', '', FunctionTypeFlags.SynthesizedMethod);
      accessorFunction.details.parameters.push({
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
      });
      accessorFunction.details.parameters.push({
        category: ParameterCategory.Simple,
        name: 'accessor',
        type: AnyType.create(),
        hasDeclaredType: true,
      });
      accessorFunction.details.declaredReturnType = propertyObject;
      const accessorSymbol = Symbol.createWithType(SymbolFlags.ClassMember, accessorFunction);
      fields.set(accessorName, accessorSymbol);
    });

    return propertyObject;
  }

  function clonePropertyWithSetter(prop: Type, fset: FunctionType, errorNode: FunctionNode): Type {
    if (!isProperty(prop)) {
      return prop;
    }

    const classType = (prop as ObjectType).classType;
    const propertyClass = ClassType.create(
      classType.details.name,
      classType.details.fullName,
      classType.details.moduleName,
      classType.details.flags,
      classType.details.typeSourceId,
      classType.details.declaredMetaclass,
      classType.details.effectiveMetaclass
    );
    computeMroLinearization(propertyClass);

    const propertyObject = ObjectType.create(propertyClass);

    const fields = propertyClass.details.fields;
    classType.details.fields.forEach((symbol, name) => {
      if (!symbol.isIgnoredForProtocolMatch()) {
        fields.set(name, symbol);
      }
    });

    const fileInfo = getFileInfo(errorNode);
    if (fileInfo.diagnosticRuleSet.reportPropertyTypeMismatch !== 'none') {
      if (errorNode.parameters.length >= 2) {
        const typeAnnotation = getTypeAnnotationForParameter(errorNode, 1);
        if (typeAnnotation) {
          const fgetType = getGetterTypeFromProperty(classType, /* inferTypeIfNeeded */ false);
          if (fgetType && !isAnyOrUnknown(fgetType)) {
            const fsetType = getTypeOfAnnotation(typeAnnotation);

            const diag = new DiagAddendum();
            if (!canAssignType(fgetType, fsetType, diag)) {
              addDiag(fileInfo.diagnosticRuleSet.reportPropertyTypeMismatch, DiagRule.reportPropertyTypeMismatch, Localizer.Diag.setterGetterTypeMismatch() + diag.getString(), typeAnnotation);
            }
          }
        }
      }
    }

    const fsetSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fset);
    fields.set('fset', fsetSymbol);

    const setFunction = FunctionType.createInstance('__set__', '', '', FunctionTypeFlags.SynthesizedMethod);
    setFunction.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'self',
      type: prop,
      hasDeclaredType: true,
    });
    let objType = fset.details.parameters.length > 0 ? fset.details.parameters[0].type : AnyType.create();
    if (isTypeVar(objType) && objType.details.isSynthesized && objType.details.boundType) {
      objType = makeTopLevelTypeVarsConcrete(objType);
    }
    setFunction.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'obj',
      type: combineTypes([objType, NoneType.createInstance()]),
      hasDeclaredType: true,
    });
    setFunction.details.declaredReturnType = NoneType.createInstance();
    let setParamType: Type = UnknownType.create();
    if (fset.details.parameters.length >= 2 && fset.details.parameters[1].category === ParameterCategory.Simple && fset.details.parameters[1].name) {
      setParamType = fset.details.parameters[1].type;
    }
    setFunction.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'value',
      type: setParamType,
      hasDeclaredType: true,
    });
    const setSymbol = Symbol.createWithType(SymbolFlags.ClassMember, setFunction);
    fields.set('__set__', setSymbol);

    return propertyObject;
  }

  function clonePropertyWithDeleter(prop: Type, fdel: FunctionType): Type {
    if (!isProperty(prop)) {
      return prop;
    }

    const classType = (prop as ObjectType).classType;
    const propertyClass = ClassType.create(
      classType.details.name,
      classType.details.fullName,
      classType.details.moduleName,
      classType.details.flags,
      classType.details.typeSourceId,
      classType.details.declaredMetaclass,
      classType.details.effectiveMetaclass
    );
    computeMroLinearization(propertyClass);

    const propertyObject = ObjectType.create(propertyClass);

    const fields = propertyClass.details.fields;
    classType.details.fields.forEach((symbol, name) => {
      if (!symbol.isIgnoredForProtocolMatch()) {
        fields.set(name, symbol);
      }
    });

    const fdelSymbol = Symbol.createWithType(SymbolFlags.ClassMember, fdel);
    fields.set('fdel', fdelSymbol);

    const delFunction = FunctionType.createInstance('__delete__', '', '', FunctionTypeFlags.SynthesizedMethod);
    delFunction.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'self',
      type: prop,
      hasDeclaredType: true,
    });
    let objType = fdel.details.parameters.length > 0 ? fdel.details.parameters[0].type : AnyType.create();
    if (isTypeVar(objType) && objType.details.isSynthesized && objType.details.boundType) {
      objType = makeTopLevelTypeVarsConcrete(objType);
    }
    delFunction.details.parameters.push({
      category: ParameterCategory.Simple,
      name: 'obj',
      type: combineTypes([objType, NoneType.createInstance()]),
      hasDeclaredType: true,
    });
    delFunction.details.declaredReturnType = NoneType.createInstance();
    const delSymbol = Symbol.createWithType(SymbolFlags.ClassMember, delFunction);
    fields.set('__delete__', delSymbol);

    return propertyObject;
  }

  function addOverloadsToFunctionType(node: FunctionNode, type: FunctionType): Type {
    let functionDecl: FunctionDeclaration | undefined;
    const decl = AnalyzerNodeInfo.getDeclaration(node);
    if (decl) {
      functionDecl = decl as FunctionDeclaration;
    }
    const symbolWithScope = lookUpSymbolRecursive(node, node.name.value, /* honorCodeFlow */ false);
    if (symbolWithScope) {
      const decls = symbolWithScope.symbol.getDeclarations();

      const declIndex = decls.findIndex((decl) => decl === functionDecl);
      if (declIndex > 0) {
        for (let i = 0; i < declIndex; i++) {
          const decl = decls[i];
          if (decl.type === DeclarationType.Function) {
            getTypeOfFunction(decl.node);
          }
        }

        const overloadedTypes: FunctionType[] = [];

        const prevDecl = decls[declIndex - 1];
        if (prevDecl.type === DeclarationType.Function) {
          const prevDeclDeclTypeInfo = getTypeOfFunction(prevDecl.node);
          if (prevDeclDeclTypeInfo) {
            if (isFunction(prevDeclDeclTypeInfo.decoratedType)) {
              if (FunctionType.isOverloaded(prevDeclDeclTypeInfo.decoratedType)) {
                overloadedTypes.push(prevDeclDeclTypeInfo.decoratedType);
              }
            } else if (isOverloadedFunction(prevDeclDeclTypeInfo.decoratedType)) {
              overloadedTypes.push(...prevDeclDeclTypeInfo.decoratedType.overloads);
            }
          }
        }

        overloadedTypes.push(type);

        if (overloadedTypes.length === 1) {
          return overloadedTypes[0];
        }

        const newOverload = OverloadedFunctionType.create(overloadedTypes);

        const prevOverload = overloadedTypes[overloadedTypes.length - 2];
        const isPrevOverloadAbstract = FunctionType.isAbstractMethod(prevOverload);
        const isCurrentOverloadAbstract = FunctionType.isAbstractMethod(type);

        if (isPrevOverloadAbstract !== isCurrentOverloadAbstract) {
          addDiag(
            getFileInfo(node).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.overloadAbstractMismatch().format({ name: node.name.value }),
            node.name
          );
        }

        return newOverload;
      }
    }

    return type;
  }

  function createAsyncFunction(node: FunctionNode, functionType: FunctionType): FunctionType {
    const awaitableFunctionType = FunctionType.clone(functionType);

    if (functionType.details.declaredReturnType) {
      awaitableFunctionType.details.declaredReturnType = createAwaitableReturnType(node, functionType.details.declaredReturnType);
    }

    awaitableFunctionType.details.flags |= FunctionTypeFlags.WrapReturnTypeInAwait;

    return awaitableFunctionType;
  }

  function createAwaitableReturnType(node: ParseNode, returnType: Type): Type {
    let awaitableReturnType: Type | undefined;

    if (isObject(returnType)) {
      const classType = returnType.classType;
      if (ClassType.isBuiltIn(classType)) {
        if (classType.details.name === 'Generator') {
          const asyncGeneratorType = getTypingType(node, 'AsyncGenerator');
          if (asyncGeneratorType && isClass(asyncGeneratorType)) {
            const typeArgs: Type[] = [];
            const generatorTypeArgs = classType.typeArguments;
            if (generatorTypeArgs && generatorTypeArgs.length > 0) {
              typeArgs.push(generatorTypeArgs[0]);
            }
            if (generatorTypeArgs && generatorTypeArgs.length > 1) {
              typeArgs.push(generatorTypeArgs[1]);
            }
            awaitableReturnType = ObjectType.create(ClassType.cloneForSpecialization(asyncGeneratorType, typeArgs, /* isTypeArgumentExplicit */ true));
          }
        } else if (['AsyncGenerator', 'AsyncIterator', 'AsyncIterable'].some((name) => name === classType.details.name)) {
          awaitableReturnType = returnType;
        }
      }
    }

    if (!awaitableReturnType) {
      const coroutineType = getTypingType(node, 'Coroutine');
      if (coroutineType && isClass(coroutineType)) {
        awaitableReturnType = ObjectType.create(ClassType.cloneForSpecialization(coroutineType, [AnyType.create(), AnyType.create(), returnType], /* isTypeArgumentExplicit */ true));
      } else {
        awaitableReturnType = UnknownType.create();
      }
    }

    return awaitableReturnType;
  }

  function inferFunctionReturnType(node: FunctionNode, isAbstract: boolean): Type | undefined {
    const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;

    if (returnAnnotation) {
      return undefined;
    }

    let inferredReturnType = readTypeCache(node.suite);
    if (inferredReturnType) {
      return inferredReturnType;
    }

    if (!functionRecursionMap.has(node.id)) {
      functionRecursionMap.set(node.id, true);

      try {
        let functionDecl: FunctionDeclaration | undefined;
        const decl = AnalyzerNodeInfo.getDeclaration(node);
        if (decl) {
          functionDecl = decl as FunctionDeclaration;
        }

        const functionNeverReturns = !isAfterNodeReachable(node);
        const implicitlyReturnsNone = isAfterNodeReachable(node.suite);

        if (getFileInfo(node).isStubFile) {
          inferredReturnType = UnknownType.create();
        } else {
          if (functionNeverReturns) {
            if (isAbstract || methodAlwaysRaisesNotImplemented(functionDecl)) {
              inferredReturnType = UnknownType.create();
            } else {
              const noReturnClass = getTypingType(node, 'NoReturn');
              if (noReturnClass && isClass(noReturnClass)) {
                inferredReturnType = ObjectType.create(noReturnClass);
              } else {
                inferredReturnType = UnknownType.create();
              }
            }
          } else {
            const inferredReturnTypes: Type[] = [];
            if (functionDecl?.returnStatements) {
              functionDecl.returnStatements.forEach((returnNode) => {
                if (isNodeReachable(returnNode)) {
                  if (returnNode.returnExpression) {
                    const returnType = getTypeOfExpression(returnNode.returnExpression).type;
                    inferredReturnTypes.push(returnType || UnknownType.create());
                  } else {
                    inferredReturnTypes.push(NoneType.createInstance());
                  }
                }
              });
            }

            if (!functionNeverReturns && implicitlyReturnsNone) {
              inferredReturnTypes.push(NoneType.createInstance());
            }

            inferredReturnType = combineTypes(inferredReturnTypes);

            inferredReturnType = removeUnbound(inferredReturnType);

            inferredReturnType = removeNoReturnFromUnion(inferredReturnType);
          }

          if (functionDecl?.yieldStatements) {
            const inferredYieldTypes: Type[] = [];
            functionDecl.yieldStatements.forEach((yieldNode) => {
              if (isNodeReachable(yieldNode)) {
                if (yieldNode.nodeType === ParseNodeType.YieldFrom) {
                  const iteratorType = getTypeOfExpression(yieldNode.expression).type;
                  const yieldType = getTypeFromIterator(iteratorType, /* isAsync */ false, yieldNode);
                  inferredYieldTypes.push(yieldType || UnknownType.create());
                } else {
                  if (yieldNode.expression) {
                    const yieldType = getTypeOfExpression(yieldNode.expression).type;
                    inferredYieldTypes.push(yieldType || UnknownType.create());
                  } else {
                    inferredYieldTypes.push(NoneType.createInstance());
                  }
                }
              }
            });

            if (inferredYieldTypes.length === 0) {
              inferredYieldTypes.push(NoneType.createInstance());
            }
            const inferredYieldType = combineTypes(inferredYieldTypes);

            const generatorType = getTypingType(node, 'Generator');
            if (generatorType && isClass(generatorType)) {
              inferredReturnType = ObjectType.create(
                ClassType.cloneForSpecialization(
                  generatorType,
                  [inferredYieldType, NoneType.createInstance(), isNoReturnType(inferredReturnType) ? NoneType.createInstance() : inferredReturnType],
                  /* isTypeArgumentExplicit */ true
                )
              );
            } else {
              inferredReturnType = UnknownType.create();
            }
          }
        }

        writeTypeCache(node.suite, inferredReturnType, /* isIncomplete */ false);
      } finally {
        functionRecursionMap.delete(node.id);
      }
    }

    return inferredReturnType;
  }

  function methodAlwaysRaisesNotImplemented(functionDecl?: FunctionDeclaration): boolean {
    if (!functionDecl || !functionDecl.isMethod || functionDecl.returnStatements || functionDecl.yieldStatements || !functionDecl.raiseStatements) {
      return false;
    }

    for (const raiseStatement of functionDecl.raiseStatements) {
      if (!raiseStatement.typeExpression || raiseStatement.valueExpression) {
        return false;
      }
      const raiseType = getTypeOfExpression(raiseStatement.typeExpression).type;
      const classType = isClass(raiseType) ? raiseType : isObject(raiseType) ? raiseType.classType : undefined;
      if (!classType || !ClassType.isBuiltIn(classType, 'NotImplementedError')) {
        return false;
      }
    }

    return true;
  }

  function evaluateTypesForForStatement(node: ForNode): void {
    if (readTypeCache(node)) {
      return;
    }

    const iteratorTypeResult = getTypeOfExpression(node.iterableExpression);
    const iteratedType = getTypeFromIterator(iteratorTypeResult.type, !!node.isAsync, node.iterableExpression) || UnknownType.create();

    assignTypeToExpression(node.targetExpression, iteratedType, !!iteratorTypeResult.isIncomplete, node.targetExpression);

    writeTypeCache(node, iteratedType, !!iteratorTypeResult.isIncomplete);
  }

  function evaluateTypesForExceptStatement(node: ExceptNode): void {
    assert(node.typeExpression !== undefined);

    if (readTypeCache(node)) {
      return;
    }

    const exceptionTypes = getTypeOfExpression(node.typeExpression!).type;

    function getExceptionType(exceptionType: Type, errorNode: ParseNode) {
      exceptionType = makeTopLevelTypeVarsConcrete(exceptionType);

      if (isAnyOrUnknown(exceptionType)) {
        return exceptionType;
      }

      if (isObject(exceptionType)) {
        exceptionType = transformTypeObjectToClass(exceptionType);
      }

      if (isClass(exceptionType)) {
        return ObjectType.create(exceptionType);
      }

      if (isObject(exceptionType)) {
        const iterableType = getTypeFromIterator(exceptionType, /* isAsync */ false, errorNode) || UnknownType.create();

        return mapSubtypes(iterableType, (subtype) => {
          if (isAnyOrUnknown(subtype)) {
            return subtype;
          }

          const transformedSubtype = transformTypeObjectToClass(subtype);
          if (isClass(transformedSubtype)) {
            return ObjectType.create(transformedSubtype);
          }

          return UnknownType.create();
        });
      }

      return UnknownType.create();
    }

    const targetType = mapSubtypes(exceptionTypes, (subType) => {
      const tupleType = getSpecializedTupleType(subType);
      if (tupleType && tupleType.tupleTypeArguments) {
        const entryTypes = tupleType.tupleTypeArguments.map((t) => {
          return getExceptionType(t, node.typeExpression!);
        });
        return combineTypes(entryTypes);
      }

      return getExceptionType(subType, node.typeExpression!);
    });

    if (node.name) {
      assignTypeToExpression(node.name, targetType, /* isIncomplete */ false, node.name);
    }

    writeTypeCache(node, targetType, /* isIncomplete */ false);
  }

  function evaluateTypesForWithStatement(node: WithItemNode): void {
    if (readTypeCache(node)) {
      return;
    }

    const exprTypeResult = getTypeOfExpression(node.expression);
    let exprType = exprTypeResult.type;
    const isAsync = node.parent && node.parent.nodeType === ParseNodeType.With && !!node.parent.isAsync;

    if (isOptionalType(exprType)) {
      const fileInfo = getFileInfo(node);
      addDiag(fileInfo.diagnosticRuleSet.reportOptionalContextMgr, DiagRule.reportOptionalContextMgr, Localizer.Diag.noneNotUsableWith(), node.expression);
      exprType = removeNoneFromUnion(exprType);
    }

    const enterMethodName = isAsync ? '__aenter__' : '__enter__';
    const scopedType = mapSubtypes(exprType, (subtype) => {
      subtype = makeTopLevelTypeVarsConcrete(subtype);

      if (isAnyOrUnknown(subtype)) {
        return subtype;
      }

      const diag = new DiagAddendum();
      const additionalHelp = new DiagAddendum();

      if (isObject(subtype)) {
        const enterType = getTypeFromObjectMember(node.expression, subtype, enterMethodName, { method: 'get' }, diag)?.type;

        if (enterType) {
          let memberReturnType: Type;
          if (isFunction(enterType)) {
            memberReturnType = getFunctionEffectiveReturnType(enterType);
          } else {
            memberReturnType = UnknownType.create();
          }

          if (isAsync) {
            memberReturnType = getTypeFromAwaitable(memberReturnType, node);
          }

          return memberReturnType;
        }

        if (!isAsync) {
          const memberType = getTypeFromObjectMember(node.expression, subtype, '__aenter__', { method: 'get' }, diag);
          if (memberType) {
            additionalHelp.addMessage(Localizer.DiagAddendum.asyncHelp());
          }
        }
      }

      const fileInfo = getFileInfo(node);
      addDiag(
        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.Diag.typeNotUsableWith().format({ type: printType(subtype), method: enterMethodName }) + additionalHelp.getString(),
        node.expression
      );
      return UnknownType.create();
    });

    const exitMethodName = isAsync ? '__aexit__' : '__exit__';
    doForEachSubtype(exprType, (subtype) => {
      subtype = makeTopLevelTypeVarsConcrete(subtype);

      if (isAnyOrUnknown(subtype)) {
        return;
      }

      const diag = new DiagAddendum();

      if (isObject(subtype)) {
        const exitType = getTypeFromObjectMember(node.expression, subtype, exitMethodName, { method: 'get' }, diag);

        if (exitType) {
          return;
        }
      }

      const fileInfo = getFileInfo(node);
      addDiag(
        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.Diag.typeNotUsableWith().format({ type: printType(subtype), method: exitMethodName }),
        node.expression
      );
    });

    if (node.target) {
      assignTypeToExpression(node.target, scopedType, !!exprTypeResult.isIncomplete, node.target);
    }

    writeTypeCache(node, scopedType, !!exprTypeResult.isIncomplete);
  }

  function evaluateTypesForImportAs(node: ImportAsNode): void {
    if (readTypeCache(node)) {
      return;
    }

    let symbolNameNode: NameNode;
    if (node.alias) {
      symbolNameNode = node.alias;
    } else {
      symbolNameNode = node.module.nameParts[0];
    }

    if (!symbolNameNode) {
      return;
    }

    let symbolType = getAliasedSymbolTypeForName(node, symbolNameNode.value) || UnknownType.create();

    const cachedModuleType = readTypeCache(node) as ModuleType;
    if (cachedModuleType && isModule(cachedModuleType) && symbolType) {
      if (isTypeSame(symbolType, cachedModuleType)) {
        symbolType = cachedModuleType;
      }
    }

    assignTypeToNameNode(symbolNameNode, symbolType, /* isIncomplete */ false);

    writeTypeCache(node, symbolType, /* isIncomplete */ false);
  }

  function evaluateTypesForImportFromAs(node: ImportFromAsNode): void {
    if (readTypeCache(node)) {
      return;
    }

    const aliasNode = node.alias || node.name;
    const fileInfo = getFileInfo(node);

    if (node.alias?.value === node.name.value) {
      const symbolInScope = lookUpSymbolRecursive(node, node.name.value, /* honorCodeFlow */ true);
      if (symbolInScope) {
        setSymbolAccessed(fileInfo, symbolInScope.symbol, node);
      }
    }

    let symbolType = getAliasedSymbolTypeForName(node, aliasNode.value);
    if (!symbolType) {
      const parentNode = node.parent as ImportFromNode;
      assert(parentNode && parentNode.nodeType === ParseNodeType.ImportFrom);
      assert(!parentNode.isWildcardImport);

      const importInfo = AnalyzerNodeInfo.getImportInfo(parentNode.module);
      if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib) {
        const resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];

        const importLookupInfo = importLookup(resolvedPath);
        let reportError = false;

        if (importLookupInfo) {
          reportError = true;

          if (fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_7 || fileInfo.isStubFile) {
            const getAttrSymbol = importLookupInfo.symbolTable.get('__getattr__');
            if (getAttrSymbol) {
              const getAttrType = getEffectiveTypeOfSymbol(getAttrSymbol);
              if (isFunction(getAttrType)) {
                symbolType = getFunctionEffectiveReturnType(getAttrType);
                reportError = false;
              }
            }
          }
        } else if (!resolvedPath) {
          reportError = true;
        }

        if (reportError) {
          addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.importSymbolUnknown().format({ name: node.name.value }), node.name);
        }
      }

      if (!symbolType) {
        symbolType = UnknownType.create();
      }
    }

    assignTypeToNameNode(aliasNode, symbolType, /* isIncomplete */ false);
    writeTypeCache(node, symbolType, /* isIncomplete */ false);
  }

  function evaluateTypesForCaseNode(node: CaseNode) {
    if (readTypeCache(node)) {
      return;
    }

    if (!node.parent || node.parent.nodeType !== ParseNodeType.Match) {
      fail('Expected parent of case statement to be match statement');
      return;
    }

    const subjectTypeResult = getTypeOfExpression(node.parent.subjectExpression);
    assignTypeToPatternTargets(subjectTypeResult.type, !!subjectTypeResult.isIncomplete, node.pattern);

    writeTypeCache(node, subjectTypeResult.type, !!subjectTypeResult.isIncomplete);
  }

  function narrowTypeBasedOnPattern(type: Type, pattern: PatternAtomNode, isPositiveTest: boolean): Type {
    switch (pattern.nodeType) {
      case ParseNodeType.PatternSequence: {
        return narrowTypeBasedOnSequencePattern(type, pattern, isPositiveTest);
      }

      case ParseNodeType.PatternLiteral: {
        return narrowTypeBasedOnLiteralPattern(type, pattern, isPositiveTest);
      }

      case ParseNodeType.PatternClass: {
        return narrowTypeBasedOnClassPattern(type, pattern, isPositiveTest);
      }

      case ParseNodeType.PatternAs: {
        return narrowTypeBasedOnAsPattern(type, pattern, isPositiveTest);
      }

      case ParseNodeType.PatternMapping: {
        return narrowTypeBasedOnMappingPattern(type, pattern, isPositiveTest);
      }

      case ParseNodeType.PatternValue: {
        return narrowTypeBasedOnValuePattern(type, pattern, isPositiveTest);
      }

      case ParseNodeType.PatternCapture: {
        return isPositiveTest ? type : NeverType.create();
      }

      case ParseNodeType.Error: {
        return type;
      }
    }
  }

  function narrowTypeBasedOnSequencePattern(type: Type, pattern: PatternSequenceNode, isPositiveTest: boolean): Type {
    if (!isPositiveTest) {
      return type;
    }

    let sequenceInfo = getSequencePatternInfo(type, pattern.entries.length, pattern.starEntryIndex);

    sequenceInfo = sequenceInfo.filter((entry) => {
      let isPlausibleMatch = true;
      const narrowedEntryTypes: Type[] = [];
      let canNarrowTuple = entry.isTuple;

      pattern.entries.forEach((sequenceEntry, index) => {
        const entryType = getTypeForPatternSequenceEntry(entry, index, pattern.entries.length, pattern.starEntryIndex);

        const narrowedEntryType = narrowTypeBasedOnPattern(entryType, sequenceEntry, /* isPositiveTest */ true);
        if (index === pattern.starEntryIndex) {
          if (isObject(narrowedEntryType) && narrowedEntryType.classType.tupleTypeArguments && !isOpenEndedTupleClass(narrowedEntryType.classType) && narrowedEntryType.classType.tupleTypeArguments) {
            narrowedEntryTypes.push(...narrowedEntryType.classType.tupleTypeArguments);
          } else {
            canNarrowTuple = false;
          }
        } else {
          narrowedEntryTypes.push(narrowedEntryType);
        }

        if (isNever(narrowedEntryType)) {
          isPlausibleMatch = false;
        }
      });

      if (isPlausibleMatch && canNarrowTuple && tupleClassType && isClass(tupleClassType)) {
        entry.subtype = ObjectType.create(specializeTupleClass(tupleClassType, narrowedEntryTypes));
      }

      return isPlausibleMatch;
    });

    return combineTypes(sequenceInfo.map((entry) => entry.subtype));
  }

  function narrowTypeBasedOnAsPattern(type: Type, pattern: PatternAsNode, isPositiveTest: boolean): Type {
    let remainingType = type;

    if (!isPositiveTest) {
      pattern.orPatterns.forEach((subpattern) => {
        remainingType = narrowTypeBasedOnPattern(remainingType, subpattern, /* isPositiveTest */ false);
      });
      return remainingType;
    }

    const narrowedTypes = pattern.orPatterns.map((subpattern) => {
      const narrowedSubtype = narrowTypeBasedOnPattern(remainingType, subpattern, /* isPositiveTest */ true);
      remainingType = narrowTypeBasedOnPattern(remainingType, subpattern, /* isPositiveTest */ false);
      return narrowedSubtype;
    });
    return combineTypes(narrowedTypes);
  }

  function narrowTypeBasedOnMappingPattern(type: Type, pattern: PatternMappingNode, isPositiveTest: boolean): Type {
    if (!isPositiveTest) {
      return type;
    }

    let mappingInfo = getMappingPatternInfo(type);

    mappingInfo = mappingInfo.filter((mappingSubtypeInfo) => {
      let isPlausibleMatch = true;
      pattern.entries.forEach((mappingEntry) => {
        if (mappingSubtypeInfo.typedDict) {
          if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
            const narrowedKeyType = narrowTypeBasedOnPattern(getBuiltInObject(pattern, 'str'), mappingEntry.keyPattern, isPositiveTest);

            if (isNever(narrowedKeyType)) {
              isPlausibleMatch = false;
            }

            const valueType = mapSubtypes(narrowedKeyType, (keySubtype) => {
              if (isAnyOrUnknown(keySubtype)) {
                return keySubtype;
              }

              if (isObject(keySubtype) && ClassType.isBuiltIn(keySubtype.classType, 'str')) {
                if (!isLiteralType(keySubtype)) {
                  return UnknownType.create();
                }

                const tdEntries = getTypedDictMembersForClass(mappingSubtypeInfo.typedDict!);
                const valueEntry = tdEntries.get(keySubtype.classType.literalValue as string);
                if (valueEntry) {
                  const narrowedValueType = narrowTypeBasedOnPattern(valueEntry.valueType, mappingEntry.valuePattern, /* isPositiveTest */ true);
                  if (!isNever(narrowedValueType)) {
                    return narrowedValueType;
                  }
                }
              }

              return undefined;
            });

            if (isNever(valueType)) {
              isPlausibleMatch = false;
            }
          }
        } else if (mappingSubtypeInfo.dictTypeArgs) {
          if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
            const narrowedKeyType = narrowTypeBasedOnPattern(mappingSubtypeInfo.dictTypeArgs.key, mappingEntry.keyPattern, isPositiveTest);
            const narrowedValueType = narrowTypeBasedOnPattern(mappingSubtypeInfo.dictTypeArgs.value, mappingEntry.valuePattern, isPositiveTest);
            if (isNever(narrowedKeyType) || isNever(narrowedValueType)) {
              isPlausibleMatch = false;
            }
          }
        }
      });

      return isPlausibleMatch;
    });

    return combineTypes(mappingInfo.map((entry) => entry.subtype));
  }

  function getPositionalMatchArgNames(type: ClassType): string[] {
    const matchArgsMemberInfo = lookUpClassMember(type, '__match_args__');
    if (matchArgsMemberInfo) {
      const matchArgsType = getTypeOfMember(matchArgsMemberInfo);
      if (isObject(matchArgsType) && isTupleClass(matchArgsType.classType) && !isOpenEndedTupleClass(matchArgsType.classType) && matchArgsType.classType.tupleTypeArguments) {
        const tupleArgs = matchArgsType.classType.tupleTypeArguments;

        if (!tupleArgs.some((argType) => !isObject(argType) || !ClassType.isBuiltIn(argType.classType, 'str') || !isLiteralType(argType))) {
          return tupleArgs.map((argType) => (argType as ObjectType).classType.literalValue as string);
        }
      }
    }

    return [];
  }

  function narrowTypeBasedOnLiteralPattern(type: Type, pattern: PatternLiteralNode, isPositiveTest: boolean): Type {
    const literalType = getTypeOfExpression(pattern.expression).type;

    if (!isPositiveTest) {
      return mapSubtypes(type, (subtype) => {
        if (canAssignType(literalType, subtype, new DiagAddendum())) {
          return undefined;
        }

        if (
          isObject(subtype) &&
          ClassType.isBuiltIn(subtype.classType, 'bool') &&
          subtype.classType.literalValue === undefined &&
          isObject(literalType) &&
          ClassType.isBuiltIn(literalType.classType, 'bool') &&
          literalType.classType.literalValue !== undefined
        ) {
          return ObjectType.create(ClassType.cloneWithLiteral(literalType.classType, !(literalType.classType.literalValue as boolean)));
        }

        return subtype;
      });
    }

    return mapSubtypes(type, (subtype) => {
      if (canAssignType(subtype, literalType, new DiagAddendum())) {
        return literalType;
      }
      return undefined;
    });
  }

  function narrowTypeBasedOnClassPattern(type: Type, pattern: PatternClassNode, isPositiveTest: boolean): Type {
    const classType = getTypeOfExpression(pattern.className).type;

    if (!isPositiveTest) {
      if (pattern.arguments.length > 0) {
        return type;
      }

      if (!isClass(classType)) {
        return type;
      }

      if (classType.details.typeParameters.length > 0) {
        return type;
      }

      const diag = new DiagAddendum();
      const classInstance = convertToInstance(classType);
      return mapSubtypes(type, (subtype) => {
        if (canAssignType(classInstance, subtype, diag)) {
          return undefined;
        }

        return subtype;
      });
    }

    if (!TypeBase.isInstantiable(classType)) {
      addDiag(
        getFileInfo(pattern).diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        Localizer.DiagAddendum.typeNotClass().format({ type: printType(classType) }),
        pattern.className
      );
      return NeverType.create();
    }

    return mapSubtypesExpandTypeVars(classType, /* constraintFilter */ undefined, (expandedSubtype, unexpandedSubtype) => {
      if (isAnyOrUnknown(expandedSubtype)) {
        return unexpandedSubtype;
      }

      if (isClass(expandedSubtype)) {
        return mapSubtypes(type, (matchSubtype) => {
          const concreteSubtype = makeTopLevelTypeVarsConcrete(matchSubtype);

          if (isAnyOrUnknown(concreteSubtype)) {
            return matchSubtype;
          }

          if (isObject(concreteSubtype)) {
            let resultType: Type;

            if (canAssignType(expandedSubtype, concreteSubtype.classType, new DiagAddendum())) {
              resultType = matchSubtype;
            } else if (canAssignType(concreteSubtype.classType, expandedSubtype, new DiagAddendum())) {
              resultType = convertToInstance(unexpandedSubtype);
            } else {
              return undefined;
            }

            let positionalArgNames: string[] = [];
            if (pattern.arguments.some((arg) => !arg.name)) {
              positionalArgNames = getPositionalMatchArgNames(expandedSubtype);
            }

            let isMatchValid = true;
            pattern.arguments.forEach((arg, index) => {
              const narrowedArgType = narrowTypeOfClassPatternArgument(arg, index, positionalArgNames, expandedSubtype);

              if (isNever(narrowedArgType)) {
                isMatchValid = false;
              }
            });

            if (isMatchValid) {
              return resultType;
            }
          }

          return undefined;
        });
      }

      return undefined;
    });
  }

  function narrowTypeOfClassPatternArgument(arg: PatternClassArgumentNode, argIndex: number, positionalArgNames: string[], classType: ClassType) {
    let argName: string | undefined;
    if (arg.name) {
      argName = arg.name.value;
    } else if (argIndex < positionalArgNames.length) {
      argName = positionalArgNames[argIndex];
    }

    let argType: Type | undefined;
    if (argName) {
      const argMemberInfo = lookUpClassMember(classType, argName);
      if (argMemberInfo) {
        argType = getTypeOfMember(argMemberInfo);
      }
    }

    if (!argType) {
      argType = UnknownType.create();
    }

    return narrowTypeBasedOnPattern(argType, arg.pattern, /* isPositiveTest */ true);
  }

  function narrowTypeBasedOnValuePattern(type: Type, pattern: PatternValueNode, isPositiveTest: boolean): Type {
    if (!isPositiveTest) {
      return type;
    }

    const valueType = getTypeOfExpression(pattern.expression).type;
    const narrowedSubtypes: Type[] = [];

    mapSubtypesExpandTypeVars(valueType, /* constraintFilter */ undefined, (leftSubtypeExpanded, leftSubtypeUnexpanded, leftSubtypeConstraints) => {
      narrowedSubtypes.push(
        mapSubtypesExpandTypeVars(type, leftSubtypeConstraints, (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
          if (isNever(leftSubtypeExpanded) || isNever(rightSubtypeUnexpanded)) {
            return NeverType.create();
          }

          if (isAnyOrUnknown(leftSubtypeExpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
            return isUnknown(leftSubtypeExpanded) || isUnknown(rightSubtypeUnexpanded) ? UnknownType.create() : AnyType.create();
          }

          const magicMethodName = binaryOperatorMap[OperatorType.Equals][0];
          const returnType = suppressDiags(pattern.expression, () =>
            getTypeFromMagicMethodReturn(leftSubtypeExpanded, [rightSubtypeUnexpanded], magicMethodName, pattern.expression, /* expectedType */ undefined)
          );

          return returnType ? leftSubtypeUnexpanded : undefined;
        })
      );

      return undefined;
    });

    return combineTypes(narrowedSubtypes);
  }

  function getMappingPatternInfo(type: Type): MappingPatternInfo[] {
    const mappingInfo: MappingPatternInfo[] = [];

    doForEachSubtype(type, (subtype) => {
      const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

      if (isAnyOrUnknown(concreteSubtype)) {
        mappingInfo.push({
          subtype,
          dictTypeArgs: {
            key: concreteSubtype,
            value: concreteSubtype,
          },
        });
      } else if (isObject(concreteSubtype)) {
        if (ClassType.isTypedDictClass(concreteSubtype.classType)) {
          mappingInfo.push({
            subtype,
            typedDict: concreteSubtype.classType,
          });
        } else {
          let mroClassToSpecialize: ClassType | undefined;
          for (const mroClass of concreteSubtype.classType.details.mro) {
            if (isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'Mapping')) {
              mroClassToSpecialize = mroClass;
              break;
            }
          }

          if (mroClassToSpecialize) {
            const specializedMapping = partiallySpecializeType(mroClassToSpecialize, concreteSubtype.classType) as ClassType;
            if (specializedMapping.typeArguments && specializedMapping.typeArguments.length >= 2) {
              mappingInfo.push({
                subtype,
                dictTypeArgs: {
                  key: specializedMapping.typeArguments[0],
                  value: specializedMapping.typeArguments[1],
                },
              });
            }
          }
        }
      }
    });

    return mappingInfo;
  }

  function getSequencePatternInfo(type: Type, entryCount: number, starEntryIndex: number | undefined): SequencePatternInfo[] {
    const sequenceInfo: SequencePatternInfo[] = [];
    const minEntryCount = starEntryIndex === undefined ? entryCount : entryCount - 1;

    doForEachSubtype(type, (subtype) => {
      const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);
      let mroClassToSpecialize: ClassType | undefined;

      if (isAnyOrUnknown(concreteSubtype)) {
        sequenceInfo.push({
          subtype,
          entryTypes: [concreteSubtype],
          isIndeterminateLength: true,
          isTuple: false,
        });
      } else if (isObject(concreteSubtype)) {
        for (const mroClass of concreteSubtype.classType.details.mro) {
          if (!isClass(mroClass)) {
            break;
          }

          if (ClassType.isBuiltIn(mroClass, 'str')) {
            break;
          }

          if (ClassType.isBuiltIn(mroClass, 'bytes')) {
            break;
          }

          if (ClassType.isBuiltIn(mroClass, 'Sequence')) {
            mroClassToSpecialize = mroClass;
            break;
          }

          if (isTupleClass(mroClass)) {
            mroClassToSpecialize = mroClass;
            break;
          }
        }

        if (mroClassToSpecialize) {
          const specializedSequence = partiallySpecializeType(mroClassToSpecialize, concreteSubtype.classType) as ClassType;
          if (isTupleClass(specializedSequence)) {
            if (specializedSequence.tupleTypeArguments) {
              if (isOpenEndedTupleClass(specializedSequence)) {
                sequenceInfo.push({
                  subtype,
                  entryTypes: [specializedSequence.tupleTypeArguments[0]],
                  isIndeterminateLength: true,
                  isTuple: true,
                });
              } else {
                if (specializedSequence.tupleTypeArguments.length >= minEntryCount && (starEntryIndex !== undefined || specializedSequence.tupleTypeArguments.length === minEntryCount)) {
                  sequenceInfo.push({
                    subtype,
                    entryTypes: specializedSequence.tupleTypeArguments,
                    isIndeterminateLength: false,
                    isTuple: true,
                  });
                }
              }
            }
          } else {
            sequenceInfo.push({
              subtype,
              entryTypes: [specializedSequence.typeArguments && specializedSequence.typeArguments.length > 0 ? specializedSequence.typeArguments[0] : UnknownType.create()],
              isIndeterminateLength: true,
              isTuple: false,
            });
          }
        }
      }
    });

    return sequenceInfo;
  }

  function getTypeForPatternSequenceEntry(sequenceInfo: SequencePatternInfo, entryIndex: number, entryCount: number, starEntryIndex: number | undefined): Type {
    if (sequenceInfo.isIndeterminateLength) {
      if (starEntryIndex === entryIndex) {
        if (tupleClassType && isClass(tupleClassType)) {
          return ObjectType.create(specializeTupleClass(tupleClassType, [sequenceInfo.entryTypes[0], AnyType.create(/* isEllipsis */ true)]));
        } else {
          return UnknownType.create();
        }
      } else {
        return sequenceInfo.entryTypes[0];
      }
    } else if (starEntryIndex === undefined || entryIndex < starEntryIndex) {
      return sequenceInfo.entryTypes[entryIndex];
    } else if (entryIndex === starEntryIndex) {
      const starEntryTypes = sequenceInfo.entryTypes.slice(starEntryIndex, starEntryIndex + sequenceInfo.entryTypes.length - entryCount + 1);
      if (tupleClassType && isClass(tupleClassType)) {
        return ObjectType.create(specializeTupleClass(tupleClassType, starEntryTypes));
      } else {
        return UnknownType.create();
      }
    } else {
      const itemIndex = sequenceInfo.entryTypes.length - (entryCount - entryIndex);
      assert(itemIndex >= 0 && itemIndex < sequenceInfo.entryTypes.length);
      return sequenceInfo.entryTypes[itemIndex];
    }
  }

  function assignTypeToPatternTargets(type: Type, isTypeIncomplete: boolean, pattern: PatternAtomNode) {
    type = narrowTypeBasedOnPattern(type, pattern, /* positiveTest */ true);

    switch (pattern.nodeType) {
      case ParseNodeType.PatternSequence: {
        const sequenceInfo = getSequencePatternInfo(type, pattern.entries.length, pattern.starEntryIndex);

        pattern.entries.forEach((entry, index) => {
          const entryType = combineTypes(sequenceInfo.map((info) => getTypeForPatternSequenceEntry(info, index, pattern.entries.length, pattern.starEntryIndex)));

          assignTypeToPatternTargets(entryType, isTypeIncomplete, entry);
        });
        break;
      }

      case ParseNodeType.PatternAs: {
        if (pattern.target) {
          assignTypeToExpression(pattern.target, type, isTypeIncomplete, pattern.target);
        }

        pattern.orPatterns.forEach((orPattern) => {
          assignTypeToPatternTargets(type, isTypeIncomplete, orPattern);

          type = narrowTypeBasedOnPattern(type, orPattern, /* positiveTest */ false);
        });
        break;
      }

      case ParseNodeType.PatternCapture: {
        assignTypeToExpression(pattern.target, pattern.isWildcard ? AnyType.create() : type, isTypeIncomplete, pattern.target);
        break;
      }

      case ParseNodeType.PatternMapping: {
        const mappingInfo = getMappingPatternInfo(type);

        pattern.entries.forEach((mappingEntry) => {
          const keyTypes: Type[] = [];
          const valueTypes: Type[] = [];

          mappingInfo.forEach((mappingSubtypeInfo) => {
            if (mappingSubtypeInfo.typedDict) {
              if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                const keyType = narrowTypeBasedOnPattern(getBuiltInObject(pattern, 'str'), mappingEntry.keyPattern, /* isPositiveTest */ true);
                keyTypes.push(keyType);

                doForEachSubtype(keyType, (keySubtype) => {
                  if (isObject(keySubtype) && ClassType.isBuiltIn(keySubtype.classType, 'str') && isLiteralType(keySubtype)) {
                    const tdEntries = getTypedDictMembersForClass(mappingSubtypeInfo.typedDict!);
                    const valueInfo = tdEntries.get(keySubtype.classType.literalValue as string);
                    valueTypes.push(valueInfo ? valueInfo.valueType : UnknownType.create());
                  } else {
                    valueTypes.push(UnknownType.create());
                  }
                });
              } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                keyTypes.push(getBuiltInObject(pattern, 'str'));
                valueTypes.push(UnknownType.create());
              }
            } else if (mappingSubtypeInfo.dictTypeArgs) {
              if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                const keyType = narrowTypeBasedOnPattern(mappingSubtypeInfo.dictTypeArgs.key, mappingEntry.keyPattern, /* isPositiveTest */ true);
                keyTypes.push(keyType);
                valueTypes.push(narrowTypeBasedOnPattern(mappingSubtypeInfo.dictTypeArgs.value, mappingEntry.valuePattern, /* isPositiveTest */ true));
              } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                keyTypes.push(mappingSubtypeInfo.dictTypeArgs.key);
                valueTypes.push(mappingSubtypeInfo.dictTypeArgs.value);
              }
            }
          });

          const keyType = combineTypes(keyTypes);
          const valueType = combineTypes(valueTypes);

          if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
            assignTypeToPatternTargets(keyType, isTypeIncomplete, mappingEntry.keyPattern);
            assignTypeToPatternTargets(valueType, isTypeIncomplete, mappingEntry.valuePattern);
          } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
            const dictClass = getBuiltInType(pattern, 'dict');
            const strType = getBuiltInObject(pattern, 'str');
            const dictType =
              dictClass && isClass(dictClass) && isObject(strType)
                ? ObjectType.create(ClassType.cloneForSpecialization(dictClass, [keyType, valueType], /* isTypeArgumentExplicit */ true))
                : UnknownType.create();
            assignTypeToExpression(mappingEntry.target, dictType, isTypeIncomplete, mappingEntry.target);
          }
        });
        break;
      }

      case ParseNodeType.PatternClass: {
        const argTypes: Type[][] = pattern.arguments.map((arg) => []);

        mapSubtypesExpandTypeVars(type, /* constraintFilter */ undefined, (expandedSubtype) => {
          if (isObject(expandedSubtype)) {
            doForEachSubtype(type, (matchSubtype) => {
              const concreteSubtype = makeTopLevelTypeVarsConcrete(matchSubtype);

              if (isAnyOrUnknown(concreteSubtype)) {
                pattern.arguments.forEach((arg, index) => {
                  argTypes[index].push(concreteSubtype);
                });
              } else if (isObject(concreteSubtype)) {
                let positionalArgNames: string[] = [];
                if (pattern.arguments.some((arg) => !arg.name)) {
                  positionalArgNames = getPositionalMatchArgNames(expandedSubtype.classType);
                }

                pattern.arguments.forEach((arg, index) => {
                  const narrowedArgType = narrowTypeOfClassPatternArgument(arg, index, positionalArgNames, expandedSubtype.classType);
                  argTypes[index].push(narrowedArgType);
                });
              }
            });
          } else {
            pattern.arguments.forEach((arg, index) => {
              argTypes[index].push(UnknownType.create());
            });
          }

          return undefined;
        });

        pattern.arguments.forEach((arg, index) => {
          assignTypeToPatternTargets(combineTypes(argTypes[index]), isTypeIncomplete, arg.pattern);
        });
        break;
      }

      case ParseNodeType.PatternLiteral:
      case ParseNodeType.PatternValue:
      case ParseNodeType.Error: {
        break;
      }
    }
  }

  function evaluateTypesForImportFrom(node: ImportFromNode): void {
    if (readTypeCache(node)) {
      return;
    }

    const symbolNameNode = node.module.nameParts[0];

    let symbolType = getAliasedSymbolTypeForName(node, symbolNameNode.value) || UnknownType.create();

    const cachedModuleType = readTypeCache(node) as ModuleType;
    if (cachedModuleType && isModule(cachedModuleType) && symbolType) {
      if (isTypeSame(symbolType, cachedModuleType)) {
        symbolType = cachedModuleType;
      }
    }

    assignTypeToNameNode(symbolNameNode, symbolType, /* isIncomplete */ false);

    writeTypeCache(node, symbolType, /* isIncomplete */ false);
  }

  function getAliasedSymbolTypeForName(node: ImportAsNode | ImportFromAsNode | ImportFromNode, name: string): Type | undefined {
    const symbolWithScope = lookUpSymbolRecursive(node, name, /* honorCodeFlow */ true);
    if (!symbolWithScope) {
      return undefined;
    }

    const filteredDecls = symbolWithScope.symbol.getDeclarations().filter((decl) => ParseTreeUtils.isNodeContainedWithin(node, decl.node));
    let aliasDecl = filteredDecls.length > 0 ? filteredDecls[filteredDecls.length - 1] : undefined;

    if (!aliasDecl) {
      aliasDecl = symbolWithScope.symbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias);
    }

    if (!aliasDecl) {
      return undefined;
    }

    assert(aliasDecl.type === DeclarationType.Alias);

    const resolvedDecl = resolveAliasDeclaration(aliasDecl, /* resolveLocalNames */ true);
    if (!resolvedDecl) {
      return resolvedDecl;
    }

    return getInferredTypeOfDeclaration(aliasDecl);
  }

  function evaluateTypesForExpressionInContext(node: ExpressionNode): void {
    let lastContextualExpression = node;
    let curNode: ParseNode | undefined = node;

    function isContextual(node: ParseNode) {
      if (node.nodeType === ParseNodeType.Parameter && node.parent?.nodeType === ParseNodeType.Lambda) {
        return true;
      }

      if (node.nodeType === ParseNodeType.Argument && node.parent?.nodeType === ParseNodeType.Call) {
        return true;
      }

      if (node.parent?.nodeType === ParseNodeType.TypeAnnotation) {
        return true;
      }

      return (
        node.nodeType === ParseNodeType.Call ||
        node.nodeType === ParseNodeType.Dictionary ||
        node.nodeType === ParseNodeType.FormatString ||
        node.nodeType === ParseNodeType.List ||
        node.nodeType === ParseNodeType.Lambda ||
        node.nodeType === ParseNodeType.MemberAccess ||
        node.nodeType === ParseNodeType.Set ||
        node.nodeType === ParseNodeType.String ||
        node.nodeType === ParseNodeType.Tuple ||
        node.nodeType === ParseNodeType.Unpack ||
        node.nodeType === ParseNodeType.DictionaryKeyEntry ||
        node.nodeType === ParseNodeType.DictionaryExpandEntry ||
        node.nodeType === ParseNodeType.ListComprehension ||
        node.nodeType === ParseNodeType.ListComprehensionFor ||
        node.nodeType === ParseNodeType.ListComprehensionIf ||
        node.nodeType === ParseNodeType.PatternSequence ||
        node.nodeType === ParseNodeType.PatternLiteral ||
        node.nodeType === ParseNodeType.PatternClass ||
        node.nodeType === ParseNodeType.PatternAs ||
        node.nodeType === ParseNodeType.PatternCapture ||
        node.nodeType === ParseNodeType.PatternMapping ||
        node.nodeType === ParseNodeType.PatternValue
      );
    }

    if (node.nodeType === ParseNodeType.Name && node.parent) {
      if (node.parent.nodeType === ParseNodeType.Function && node.parent.name === node) {
        getTypeOfFunction(node.parent);
        return;
      } else if (node.parent.nodeType === ParseNodeType.Class && node.parent.name === node) {
        getTypeOfClass(node.parent);
        return;
      } else if (node.parent.nodeType === ParseNodeType.Global || node.parent.nodeType === ParseNodeType.Nonlocal) {
        getTypeOfExpression(node, /* expectedType */ undefined, EvaluatorFlags.AllowForwardReferences);
        return;
      }
    }

    while (curNode) {
      const isNodeContextual = isContextual(curNode);
      if (!isNodeContextual && !isExpressionNode(curNode)) {
        break;
      }
      if (isNodeContextual) {
        lastContextualExpression = curNode as ExpressionNode;
      }

      curNode = curNode.parent;
    }

    const parent = lastContextualExpression.parent!;
    if (parent.nodeType === ParseNodeType.Assignment) {
      if (lastContextualExpression === parent.typeAnnotationComment) {
        getTypeOfAnnotation(lastContextualExpression, ParseTreeUtils.isFinalAllowedForAssignmentTarget(parent.leftExpression));
      } else {
        evaluateTypesForAssignmentStatement(parent);
      }
      return;
    }

    if (parent.nodeType === ParseNodeType.AugmentedAssignment) {
      evaluateTypesForAugmentedAssignment(parent);
      return;
    }

    const evaluateTypeAnnotationExpression = (node: TypeAnnotationNode) => {
      const annotationParent = node.parent;
      if (annotationParent?.nodeType === ParseNodeType.Assignment && annotationParent.leftExpression === parent) {
        evaluateTypesForAssignmentStatement(annotationParent);
      } else {
        const annotationType = getTypeOfAnnotation(node.typeAnnotation, ParseTreeUtils.isFinalAllowedForAssignmentTarget(node.valueExpression));
        if (annotationType) {
          writeTypeCache(node.valueExpression, annotationType, /* isIncomplete */ false);
        }
      }
    };

    if (parent.nodeType === ParseNodeType.Case) {
      evaluateTypesForCaseNode(parent);
      return;
    }

    if (parent.nodeType === ParseNodeType.TypeAnnotation) {
      evaluateTypeAnnotationExpression(parent);
      return;
    }

    if (parent.nodeType === ParseNodeType.ModuleName) {
      return;
    }

    if (parent.nodeType === ParseNodeType.Argument && lastContextualExpression === parent.name) {
      return;
    }

    if (parent.nodeType === ParseNodeType.Return && parent.returnExpression) {
      const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
      const declaredReturnType = enclosingFunctionNode ? getFunctionDeclaredReturnType(enclosingFunctionNode) : undefined;
      getTypeOfExpression(parent.returnExpression, declaredReturnType, EvaluatorFlags.None);
      return;
    }

    const nodeToEvaluate = isExpressionNode(parent) && parent.nodeType !== ParseNodeType.Error ? (parent as ExpressionNode) : lastContextualExpression;

    if (nodeToEvaluate.nodeType === ParseNodeType.TypeAnnotation) {
      evaluateTypeAnnotationExpression(nodeToEvaluate);
    } else {
      const fileInfo = getFileInfo(nodeToEvaluate);
      const flags = fileInfo.isStubFile ? EvaluatorFlags.AllowForwardReferences : EvaluatorFlags.None;
      getTypeOfExpression(nodeToEvaluate, /* expectedType */ undefined, flags);
    }
  }

  function evaluateTypeOfParameter(node: ParameterNode): void {
    assert(node.name !== undefined);

    const parent = node.parent!;
    if (parent.nodeType === ParseNodeType.Lambda) {
      evaluateTypesForExpressionInContext(parent);
      return;
    }

    assert(parent.nodeType === ParseNodeType.Function);
    const functionNode = parent as FunctionNode;

    const paramIndex = functionNode.parameters.findIndex((param) => param === node);
    const typeAnnotation = getTypeAnnotationForParameter(functionNode, paramIndex);

    if (typeAnnotation) {
      writeTypeCache(
        node.name!,
        transformVariadicParamType(
          node,
          node.category,
          getTypeOfAnnotation(
            typeAnnotation,
            /* allowFinal */ false,
            /* associateTypeVarsWithScope */ true,
            /* allowTypeVarTuple */ functionNode.parameters[paramIndex].category === ParameterCategory.VarArgList
          )
        ),
        /* isIncomplete */ false
      );
      return;
    }

    if (paramIndex === 0) {
      const containingClassNode = ParseTreeUtils.getEnclosingClass(functionNode, /* stopAtFunction */ true);
      if (containingClassNode) {
        const classInfo = getTypeOfClass(containingClassNode);
        if (classInfo) {
          const functionFlags = getFunctionFlagsFromDecorators(functionNode, /* isInClass */ true);

          const inferredParamType = inferFirstParamType(functionFlags, classInfo.classType, functionNode);
          writeTypeCache(node.name!, inferredParamType || UnknownType.create(), /* isIncomplete */ false);
          return;
        }
      }
    }

    writeTypeCache(node.name!, transformVariadicParamType(node, node.category, UnknownType.create()), /* isIncomplete */ false);
  }

  function evaluateTypesForStatement(node: ParseNode): void {
    let curNode: ParseNode | undefined = node;

    while (curNode) {
      switch (curNode.nodeType) {
        case ParseNodeType.Assignment: {
          const isInAssignmentChain =
            curNode.parent &&
            (curNode.parent.nodeType === ParseNodeType.Assignment || curNode.parent.nodeType === ParseNodeType.AssignmentExpression || curNode.parent.nodeType === ParseNodeType.AugmentedAssignment) &&
            curNode.parent.rightExpression === curNode;
          if (!isInAssignmentChain) {
            evaluateTypesForAssignmentStatement(curNode);
            return;
          }
          break;
        }

        case ParseNodeType.AssignmentExpression: {
          getTypeOfExpression(curNode);
          return;
        }

        case ParseNodeType.AugmentedAssignment: {
          evaluateTypesForAugmentedAssignment(curNode);
          return;
        }

        case ParseNodeType.Class: {
          getTypeOfClass(curNode);
          return;
        }

        case ParseNodeType.Parameter: {
          evaluateTypeOfParameter(curNode);
          return;
        }

        case ParseNodeType.Lambda: {
          evaluateTypesForExpressionInContext(curNode);
          return;
        }

        case ParseNodeType.Function: {
          getTypeOfFunction(curNode);
          return;
        }

        case ParseNodeType.For: {
          evaluateTypesForForStatement(curNode);
          return;
        }

        case ParseNodeType.Except: {
          evaluateTypesForExceptStatement(curNode);
          return;
        }

        case ParseNodeType.WithItem: {
          evaluateTypesForWithStatement(curNode);
          return;
        }

        case ParseNodeType.ListComprehensionFor: {
          const listComprehension = curNode.parent as ListComprehensionNode;
          assert(listComprehension.nodeType === ParseNodeType.ListComprehension);
          evaluateTypesForExpressionInContext(listComprehension);
          return;
        }

        case ParseNodeType.ImportAs: {
          evaluateTypesForImportAs(curNode);
          return;
        }

        case ParseNodeType.ImportFromAs: {
          evaluateTypesForImportFromAs(curNode);
          return;
        }

        case ParseNodeType.ImportFrom: {
          evaluateTypesForImportFrom(curNode);
          return;
        }

        case ParseNodeType.Case: {
          evaluateTypesForCaseNode(curNode);
          return;
        }
      }

      curNode = curNode.parent;
    }

    fail('Unexpected assignment target');
    return undefined;
  }

  function getTypeFromWildcardImport(flowNode: FlowWildcardImport, name: string): Type {
    const importInfo = AnalyzerNodeInfo.getImportInfo(flowNode.node.module);
    assert(importInfo !== undefined && importInfo.isImportFound);
    assert(flowNode.node.isWildcardImport);

    const symbolWithScope = lookUpSymbolRecursive(flowNode.node, name, /* honorCodeFlow */ false);
    assert(symbolWithScope !== undefined);
    const decls = symbolWithScope!.symbol.getDeclarations();
    const wildcardDecl = decls.find((decl) => decl.node === flowNode.node);

    if (!wildcardDecl) {
      return UnknownType.create();
    }

    return getInferredTypeOfDeclaration(wildcardDecl) || UnknownType.create();
  }

  function getDeclaredCallBaseType(node: ExpressionNode): Type | undefined {
    if (node.nodeType === ParseNodeType.Name) {
      const symbolWithScope = lookUpSymbolRecursive(node, node.value, /* honorCodeFlow */ false);

      if (!symbolWithScope) {
        return undefined;
      }

      const symbol = symbolWithScope.symbol;
      const type = getDeclaredTypeOfSymbol(symbol);
      if (type) {
        return type;
      }

      const declarations = symbol.getDeclarations();
      if (declarations.length === 0) {
        return undefined;
      }

      const decl = declarations[declarations.length - 1];
      if (decl.type === DeclarationType.Parameter) {
        return evaluateTypeForSubnode(decl.node.name!, () => {
          evaluateTypeOfParameter(decl.node);
        })?.type;
      }

      if (decl.type === DeclarationType.Alias) {
        return getInferredTypeOfDeclaration(decl);
      }

      return undefined;
    }

    if (node.nodeType === ParseNodeType.MemberAccess) {
      const memberName = node.memberName.value;
      let baseType = getDeclaredCallBaseType(node.leftExpression);
      if (!baseType) {
        return undefined;
      }

      baseType = makeTopLevelTypeVarsConcrete(baseType);

      const declaredTypeOfSymbol = mapSubtypes(baseType, (subtype) => {
        let symbol: Symbol | undefined;
        if (isModule(subtype)) {
          symbol = ModuleType.getField(subtype, memberName);
        } else if (isClass(subtype)) {
          const classMemberInfo = lookUpClassMember(subtype, memberName);
          symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
        } else if (isObject(subtype)) {
          const classMemberInfo = lookUpClassMember(subtype.classType, memberName);
          symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
        }

        return symbol ? getDeclaredTypeOfSymbol(symbol) : undefined;
      });

      if (!isNever(declaredTypeOfSymbol)) {
        return declaredTypeOfSymbol;
      }
    }

    return undefined;
  }

  function evaluateTypeForSubnode(subnode: ParseNode, callback: () => void): TypeResult | undefined {
    let subnodeType = readTypeCache(subnode);
    if (subnodeType) {
      return { node: subnode, type: subnodeType };
    }

    const oldIncompleteCache = incompleteTypeCache;
    try {
      incompleteTypeCache = new Map<number, CachedType>();
      callback();
      subnodeType = readTypeCache(subnode);
      if (subnodeType) {
        return { node: subnode, type: subnodeType };
      }

      subnodeType = incompleteTypeCache.get(subnode.id) as Type | undefined;
      if (subnodeType) {
        return { node: subnode, type: subnodeType, isIncomplete: true };
      }
    } finally {
      incompleteTypeCache = oldIncompleteCache;
    }

    return undefined;
  }

  function isExceptionContextMgr(node: ExpressionNode, isAsync: boolean) {
    if (isExceptionContextMgrCache.has(node.id)) {
      return isExceptionContextMgrCache.get(node.id);
    }

    isExceptionContextMgrCache.set(node.id, false);

    let cmSwallowsExceptions = false;

    if (node.nodeType === ParseNodeType.Call) {
      const callType = getDeclaredCallBaseType(node.leftExpression);
      if (callType && isClass(callType)) {
        const exitMethodName = isAsync ? '__aexit__' : '__exit__';
        const exitType = getTypeFromObjectMember(node.leftExpression, ObjectType.create(callType), exitMethodName)?.type;

        if (exitType && isFunction(exitType) && exitType.details.declaredReturnType) {
          const returnType = exitType.details.declaredReturnType;
          cmSwallowsExceptions = isObject(returnType) && ClassType.isBuiltIn(returnType.classType, 'bool');
        }
      }
    }

    isExceptionContextMgrCache.set(node.id, cmSwallowsExceptions);

    return cmSwallowsExceptions;
  }

  function isCallNoReturn(node: CallNode) {
    if (callIsNoReturnCache.has(node.id)) {
      return callIsNoReturnCache.get(node.id);
    }

    callIsNoReturnCache.set(node.id, false);

    let callIsNoReturn = false;

    const callType = getDeclaredCallBaseType(node.leftExpression);
    if (callType) {
      doForEachSubtype(callType, (callSubtype) => {
        let functionType: FunctionType | undefined;
        if (isFunction(callSubtype)) {
          functionType = callSubtype;
        } else if (isOverloadedFunction(callSubtype)) {
          const overloadedFunction = callSubtype;
          functionType = overloadedFunction.overloads[overloadedFunction.overloads.length - 1];
        }

        if (functionType && !FunctionType.isAsync(functionType)) {
          if (functionType.details.declaredReturnType) {
            if (isNoReturnType(functionType.details.declaredReturnType)) {
              callIsNoReturn = true;
            }
          } else if (functionType.details.declaration) {
            if (
              !functionType.details.declaration.yieldStatements &&
              !FunctionType.isAbstractMethod(functionType) &&
              !FunctionType.isStubDefinition(functionType) &&
              !FunctionType.isPyTypedDefinition(functionType)
            ) {
              const functionStatements = functionType.details.declaration.node.suite.statements;

              let foundRaiseNotImplemented = false;
              for (const statement of functionStatements) {
                if (statement.nodeType !== ParseNodeType.StatementList || statement.statements.length !== 1) {
                  break;
                }

                const simpleStatement = statement.statements[0];
                if (simpleStatement.nodeType === ParseNodeType.StringList) {
                  continue;
                }

                if (simpleStatement.nodeType === ParseNodeType.Raise && simpleStatement.typeExpression) {
                  const isNotImplementedName = (node: ParseNode) => {
                    return node?.nodeType === ParseNodeType.Name && node.value === 'NotImplementedError';
                  };

                  if (isNotImplementedName(simpleStatement.typeExpression)) {
                    foundRaiseNotImplemented = true;
                  } else if (simpleStatement.typeExpression.nodeType === ParseNodeType.Call && isNotImplementedName(simpleStatement.typeExpression.leftExpression)) {
                    foundRaiseNotImplemented = true;
                  }
                }

                break;
              }

              if (!foundRaiseNotImplemented && !isAfterNodeReachable(functionType.details.declaration.node)) {
                callIsNoReturn = true;
              }
            }
          }
        }
      });
    }

    callIsNoReturnCache.set(node.id, callIsNoReturn);

    return callIsNoReturn;
  }

  function getCodeFlowAnalyzerForNode(nodeId: number) {
    let analyzer = codeFlowAnalyzerCache.get(nodeId);

    if (!analyzer) {
      analyzer = createCodeFlowAnalyzer();
      codeFlowAnalyzerCache.set(nodeId, analyzer);
    }

    return analyzer;
  }

  function getFlowTypeOfReference(reference: CodeFlowReferenceExpressionNode, targetSymbolId: number, initialType: Type | undefined): FlowNodeTypeResult {
    const referenceKey = createKeyForReference(reference);
    const executionScope = ParseTreeUtils.getExecutionScopeNode(reference);
    const codeFlowExpressions = AnalyzerNodeInfo.getCodeFlowExpressions(executionScope);

    assert(codeFlowExpressions !== undefined);
    if (!codeFlowExpressions!.has(referenceKey)) {
      return { type: undefined, isIncomplete: false };
    }

    const executionNode = ParseTreeUtils.getExecutionScopeNode(reference);
    let analyzer: CodeFlowAnalyzer | undefined;

    if (isNodeInReturnTypeInferenceContext(executionNode)) {
      analyzer = getCodeFlowAnalyzerForReturnTypeInferenceContext();
    } else {
      analyzer = getCodeFlowAnalyzerForNode(executionNode.id);
    }

    const flowNode = AnalyzerNodeInfo.getFlowNode(reference);
    if (flowNode === undefined) {
      return { type: undefined, isIncomplete: false };
    }

    return getTypeFromCodeFlow(analyzer, flowNode!, reference, targetSymbolId, initialType);
  }

  function getTypeFromCodeFlow(
    analyzer: CodeFlowAnalyzer,
    flowNode: FlowNode,
    reference: CodeFlowReferenceExpressionNode | undefined,
    targetSymbolId: number | undefined,
    initialType: Type | undefined
  ) {
    incompleteTypeTracker.enterTrackingScope();
    let codeFlowResult: FlowNodeTypeResult;

    try {
      codeFlowResult = analyzer.getTypeFromCodeFlow(flowNode!, reference, targetSymbolId, initialType);
    } finally {
      incompleteTypeTracker.exitTrackingScope();
    }

    if (codeFlowResult.isIncomplete) {
      incompleteTypeTracker.enableUndoTracking();
    }

    return { type: codeFlowResult.type, isIncomplete: codeFlowResult.isIncomplete };
  }

  function createCodeFlowAnalyzer(): CodeFlowAnalyzer {
    const flowNodeTypeCacheSet = new Map<string, TypeCache>();

    function getTypeFromCodeFlow(flowNode: FlowNode, reference: CodeFlowReferenceExpressionNode | undefined, targetSymbolId: number | undefined, initialType: Type | undefined): FlowNodeTypeResult {
      const referenceKey = reference !== undefined && targetSymbolId !== undefined ? createKeyForReference(reference) + `.${targetSymbolId.toString()}` : '.';
      let flowNodeTypeCache = flowNodeTypeCacheSet.get(referenceKey);
      if (!flowNodeTypeCache) {
        flowNodeTypeCache = new Map<number, CachedType | undefined>();
        flowNodeTypeCacheSet.set(referenceKey, flowNodeTypeCache);
      }

      function setCacheEntry(flowNode: FlowNode, type: Type | undefined, isIncomplete: boolean): FlowNodeTypeResult {
        if (!isIncomplete) {
          flowIncompleteGeneration++;
        } else {
          const prevEntry = flowNodeTypeCache!.get(flowNode.id);
          if (prevEntry === undefined) {
            flowIncompleteGeneration++;
          } else if (type && (prevEntry as IncompleteType).isIncompleteType) {
            const prevIncompleteType = prevEntry as IncompleteType;
            if (prevIncompleteType.type && !isTypeSame(prevIncompleteType.type, type)) {
              flowIncompleteGeneration++;
            }
          }
        }

        const entry: CachedType | undefined = isIncomplete
          ? {
              isIncompleteType: true,
              type,
              incompleteSubtypes: [],
              generationCount: flowIncompleteGeneration,
            }
          : type;

        flowNodeTypeCache!.set(flowNode.id, entry);
        speculativeTypeTracker.trackEntry(flowNodeTypeCache!, flowNode.id);

        return {
          type,
          isIncomplete,
          generationCount: flowIncompleteGeneration,
          incompleteSubtypes: isIncomplete ? [] : undefined,
        };
      }

      function setIncompleteSubtype(flowNode: FlowNode, index: number, type: Type | undefined) {
        const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
        if (cachedEntry === undefined || !isIncompleteType(cachedEntry)) {
          fail('setIncompleteSubtype can be called only on a valid incomplete cache entry');
        }

        const incompleteEntries = cachedEntry.incompleteSubtypes;
        if (index < incompleteEntries.length) {
          incompleteEntries[index] = type;
        } else {
          assert(incompleteEntries.length === index);
          incompleteEntries.push(type);
        }

        flowIncompleteGeneration++;

        return getCacheEntry(flowNode);
      }

      function deleteCacheEntry(flowNode: FlowNode) {
        flowNodeTypeCache!.delete(flowNode.id);
      }

      function getCacheEntry(flowNode: FlowNode): FlowNodeTypeResult | undefined {
        if (!flowNodeTypeCache!.has(flowNode.id)) {
          return undefined;
        }

        const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
        if (cachedEntry === undefined) {
          return {
            type: cachedEntry,
            isIncomplete: false,
          };
        }

        if (!isIncompleteType(cachedEntry)) {
          return {
            type: cachedEntry,
            isIncomplete: false,
          };
        }

        let type = cachedEntry.type;

        if (cachedEntry.incompleteSubtypes.length > 0) {
          const typesToCombine: Type[] = [];
          cachedEntry.incompleteSubtypes.forEach((t) => {
            if (t) {
              typesToCombine.push(t);
            }
          });
          type = typesToCombine.length > 0 ? combineTypes(typesToCombine) : undefined;
        }

        return {
          type,
          isIncomplete: true,
          incompleteSubtypes: cachedEntry.incompleteSubtypes,
          generationCount: cachedEntry.generationCount,
        };
      }

      function evaluateAssignmentFlowNode(flowNode: FlowAssignment): TypeResult | undefined {
        let nodeForCacheLookup: ParseNode = flowNode.node;
        const parentNode = flowNode.node.parent;
        if (parentNode) {
          if (parentNode.nodeType === ParseNodeType.Function || parentNode.nodeType === ParseNodeType.Class) {
            nodeForCacheLookup = parentNode;
          }
        }

        return evaluateTypeForSubnode(nodeForCacheLookup, () => {
          evaluateTypesForStatement(flowNode.node);
        });
      }

      function getTypeFromFlowNode(flowNode: FlowNode, reference: CodeFlowReferenceExpressionNode | undefined, targetSymbolId: number | undefined, initialType: Type | undefined): FlowNodeTypeResult {
        let curFlowNode = flowNode;

        checkForCancellation();

        while (true) {
          const cachedEntry = getCacheEntry(curFlowNode);
          if (cachedEntry) {
            if (!cachedEntry.isIncomplete || cachedEntry.generationCount === flowIncompleteGeneration) {
              return cachedEntry;
            }
          }

          if (curFlowNode.flags & FlowFlags.Unreachable) {
            return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
          }

          if (curFlowNode.flags & FlowFlags.VariableAnnotation) {
            const varAnnotationNode = curFlowNode as FlowVariableAnnotation;
            curFlowNode = varAnnotationNode.antecedent;
            continue;
          }

          if (curFlowNode.flags & FlowFlags.Call) {
            const callFlowNode = curFlowNode as FlowCall;

            if (isCallNoReturn(callFlowNode.node)) {
              return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
            }

            curFlowNode = callFlowNode.antecedent;
            continue;
          }

          if (curFlowNode.flags & FlowFlags.Assignment) {
            const assignmentFlowNode = curFlowNode as FlowAssignment;

            if (reference) {
              if (targetSymbolId === assignmentFlowNode.targetSymbolId && ParseTreeUtils.isMatchingExpression(reference, assignmentFlowNode.node)) {
                if (curFlowNode.flags & FlowFlags.Unbind) {
                  return setCacheEntry(curFlowNode, UnboundType.create(), /* isIncomplete */ false);
                }

                if (cachedEntry && cachedEntry.type === undefined) {
                  return { type: undefined, isIncomplete: true };
                }

                setCacheEntry(curFlowNode, undefined, /* isIncomplete */ true);
                let flowTypeResult = evaluateAssignmentFlowNode(assignmentFlowNode);
                if (flowTypeResult && isTypeAliasPlaceholder(flowTypeResult.type)) {
                  flowTypeResult = undefined;
                }
                return setCacheEntry(curFlowNode, flowTypeResult?.type, !!flowTypeResult?.isIncomplete);
              } else if (ParseTreeUtils.isPartialMatchingExpression(reference, assignmentFlowNode.node)) {
                return setCacheEntry(curFlowNode, initialType, /* isIncomplete */ false);
              }
            }

            curFlowNode = assignmentFlowNode.antecedent;
            continue;
          }

          if (curFlowNode.flags & FlowFlags.AssignmentAlias) {
            const aliasFlowNode = curFlowNode as FlowAssignmentAlias;

            if (targetSymbolId === aliasFlowNode.targetSymbolId) {
              targetSymbolId = aliasFlowNode.aliasSymbolId;
            }
            curFlowNode = aliasFlowNode.antecedent;
            continue;
          }

          if (curFlowNode.flags & FlowFlags.BranchLabel) {
            if (curFlowNode.flags & FlowFlags.PostContextMgr) {
              const contextMgrNode = curFlowNode as FlowPostContextMgrLabel;
              if (!contextMgrNode.expressions.some((expr) => isExceptionContextMgr(expr, contextMgrNode.isAsync))) {
                return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
              }
            }

            const labelNode = curFlowNode as FlowLabel;
            const typesToCombine: Type[] = [];

            let sawIncomplete = false;

            labelNode.antecedents.forEach((antecedent) => {
              const flowTypeResult = getTypeFromFlowNode(antecedent, reference, targetSymbolId, initialType);

              if (flowTypeResult.isIncomplete) {
                sawIncomplete = true;
              }

              if (flowTypeResult.type) {
                typesToCombine.push(flowTypeResult.type);
              }
            });

            const effectiveType = combineTypes(typesToCombine);
            return setCacheEntry(curFlowNode, effectiveType, sawIncomplete);
          }

          if (curFlowNode.flags & FlowFlags.LoopLabel) {
            const labelNode = curFlowNode as FlowLabel;

            let firstWasIncomplete = false;
            let isFirstTimeInLoop = false;

            let cacheEntry = getCacheEntry(curFlowNode);
            if (cacheEntry === undefined) {
              isFirstTimeInLoop = true;
              cacheEntry = setCacheEntry(curFlowNode, undefined, /* isIncomplete */ true);
            }

            labelNode.antecedents.forEach((antecedent, index) => {
              if (index >= cacheEntry!.incompleteSubtypes!.length) {
                cacheEntry = setIncompleteSubtype(curFlowNode, index, undefined);
                const flowTypeResult = getTypeFromFlowNode(antecedent, reference, targetSymbolId, initialType);

                if (flowTypeResult.isIncomplete && index === 0) {
                  firstWasIncomplete = true;
                }

                cacheEntry = setIncompleteSubtype(curFlowNode, index, flowTypeResult.type);
              }
            });

            if (!isFirstTimeInLoop) {
              return cacheEntry;
            }

            if (firstWasIncomplete) {
              deleteCacheEntry(curFlowNode);
              return { type: cacheEntry!.type, isIncomplete: true };
            }

            return setCacheEntry(curFlowNode, cacheEntry!.type, /* isIncomplete */ false);
          }

          if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
            const conditionalFlowNode = curFlowNode as FlowCondition;

            if (reference) {
              const typeNarrowingCallback = getTypeNarrowingCallback(reference, conditionalFlowNode);
              if (typeNarrowingCallback) {
                const flowTypeResult = getTypeFromFlowNode(conditionalFlowNode.antecedent, reference, targetSymbolId, initialType);
                let flowType = flowTypeResult.type;
                if (flowType) {
                  flowType = typeNarrowingCallback(flowType);
                }

                return setCacheEntry(curFlowNode, flowType, flowTypeResult.isIncomplete);
              }
            }

            curFlowNode = conditionalFlowNode.antecedent;
            continue;
          }

          if (curFlowNode.flags & (FlowFlags.TrueNeverCondition | FlowFlags.FalseNeverCondition)) {
            const conditionalFlowNode = curFlowNode as FlowCondition;
            if (conditionalFlowNode.reference) {
              const symbolWithScope = lookUpSymbolRecursive(conditionalFlowNode.reference, conditionalFlowNode.reference.value, /* honorCodeFlow */ false);
              if (symbolWithScope && symbolWithScope.symbol.getTypedDeclarations().length > 0) {
                const typeNarrowingCallback = getTypeNarrowingCallback(conditionalFlowNode.reference, conditionalFlowNode);
                if (typeNarrowingCallback) {
                  const refTypeInfo = getTypeOfExpression(conditionalFlowNode.reference!);
                  const narrowedType = typeNarrowingCallback(refTypeInfo.type) || refTypeInfo.type;

                  if (isNever(narrowedType)) {
                    return setCacheEntry(curFlowNode, undefined, !!refTypeInfo.isIncomplete);
                  }
                }
              }
            }
            curFlowNode = conditionalFlowNode.antecedent;
            continue;
          }

          if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
            const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
            if (preFinallyFlowNode.isGateClosed) {
              return { type: undefined, isIncomplete: false };
            }
            curFlowNode = preFinallyFlowNode.antecedent;
            continue;
          }

          if (curFlowNode.flags & FlowFlags.PostFinally) {
            const postFinallyFlowNode = curFlowNode as FlowPostFinally;
            const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;
            try {
              postFinallyFlowNode.preFinallyGate.isGateClosed = true;
              let flowTypeResult: FlowNodeTypeResult | undefined;

              useSpeculativeMode(postFinallyFlowNode.finallyNode, () => {
                flowTypeResult = getTypeFromFlowNode(postFinallyFlowNode.antecedent, reference, targetSymbolId, initialType);
              });

              return flowTypeResult!.isIncomplete ? flowTypeResult! : setCacheEntry(curFlowNode, flowTypeResult!.type, /* isIncomplete */ false);
            } finally {
              postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
            }
          }

          if (curFlowNode.flags & FlowFlags.Start) {
            return setCacheEntry(curFlowNode, initialType, /* isIncomplete */ false);
          }

          if (curFlowNode.flags & FlowFlags.WildcardImport) {
            const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
            if (reference && reference.nodeType === ParseNodeType.Name) {
              const nameValue = reference.value;
              if (wildcardImportFlowNode.names.some((name) => name === nameValue)) {
                const type = getTypeFromWildcardImport(wildcardImportFlowNode, nameValue);
                return setCacheEntry(curFlowNode, type, /* isIncomplete */ false);
              }
            }

            curFlowNode = wildcardImportFlowNode.antecedent;
            continue;
          }

          fail('Unexpected flow node flags');
          return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
        }
      }

      if (!flowNode) {
        return {
          type: initialType,
          isIncomplete: false,
        };
      }

      return getTypeFromFlowNode(flowNode, reference, targetSymbolId, initialType);
    }

    return {
      getTypeFromCodeFlow,
    };
  }

  function isFlowNodeReachable(flowNode: FlowNode, sourceFlowNode?: FlowNode): boolean {
    const visitedFlowNodeMap = new Map<number, true>();

    function isFlowNodeReachableRecursive(flowNode: FlowNode, sourceFlowNode: FlowNode | undefined): boolean {
      let curFlowNode = flowNode;

      while (true) {
        if (visitedFlowNodeMap.has(curFlowNode.id)) {
          return false;
        }

        visitedFlowNodeMap.set(curFlowNode.id, true);

        if (curFlowNode.flags & FlowFlags.Unreachable) {
          return false;
        }

        if (curFlowNode === sourceFlowNode) {
          return true;
        }

        if (
          curFlowNode.flags &
          (FlowFlags.VariableAnnotation |
            FlowFlags.Assignment |
            FlowFlags.AssignmentAlias |
            FlowFlags.TrueCondition |
            FlowFlags.FalseCondition |
            FlowFlags.WildcardImport |
            FlowFlags.TrueNeverCondition |
            FlowFlags.FalseNeverCondition)
        ) {
          const typedFlowNode = curFlowNode as FlowVariableAnnotation | FlowAssignment | FlowAssignmentAlias | FlowCondition | FlowWildcardImport | FlowCondition;
          curFlowNode = typedFlowNode.antecedent;
          continue;
        }

        if (curFlowNode.flags & FlowFlags.Call) {
          const callFlowNode = curFlowNode as FlowCall;

          if (sourceFlowNode === undefined) {
            if (isCallNoReturn(callFlowNode.node)) {
              return false;
            }
          }

          curFlowNode = callFlowNode.antecedent;
          continue;
        }

        if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
          if (curFlowNode.flags & FlowFlags.PostContextMgr) {
            const contextMgrNode = curFlowNode as FlowPostContextMgrLabel;
            if (!contextMgrNode.expressions.some((expr) => isExceptionContextMgr(expr, contextMgrNode.isAsync))) {
              return false;
            }
          }

          const labelNode = curFlowNode as FlowLabel;
          for (const antecedent of labelNode.antecedents) {
            if (isFlowNodeReachableRecursive(antecedent, sourceFlowNode)) {
              return true;
            }
          }
          return false;
        }

        if (curFlowNode.flags & FlowFlags.Start) {
          return sourceFlowNode ? false : true;
        }

        if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
          const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
          return !preFinallyFlowNode.isGateClosed;
        }

        if (curFlowNode.flags & FlowFlags.PostFinally) {
          const postFinallyFlowNode = curFlowNode as FlowPostFinally;
          const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;

          try {
            postFinallyFlowNode.preFinallyGate.isGateClosed = true;
            return isFlowNodeReachableRecursive(postFinallyFlowNode.antecedent, sourceFlowNode);
          } finally {
            postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
          }
        }

        fail('Unexpected flow node flags');
        return false;
      }
    }

    if (isReachableRecursionMap.has(flowNode.id)) {
      return true;
    }
    isReachableRecursionMap.set(flowNode.id, true);

    try {
      return isFlowNodeReachableRecursive(flowNode, sourceFlowNode);
    } finally {
      isReachableRecursionMap.delete(flowNode.id);
    }
  }

  function getTypeNarrowingCallback(reference: ExpressionNode, flowNode: FlowCondition): TypeNarrowingCallback | undefined {
    let testExpression = flowNode.expression;
    const isPositiveTest = !!(flowNode.flags & (FlowFlags.TrueCondition | FlowFlags.TrueNeverCondition));

    if (testExpression.nodeType === ParseNodeType.AssignmentExpression) {
      if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
        testExpression = testExpression.rightExpression;
      } else if (ParseTreeUtils.isMatchingExpression(reference, testExpression.name)) {
        testExpression = testExpression.name;
      }
    }

    if (testExpression.nodeType === ParseNodeType.BinaryOp) {
      const isOrIsNotOperator = testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.IsNot;
      const equalsOrNotEqualsOperator = testExpression.operator === OperatorType.Equals || testExpression.operator === OperatorType.NotEquals;

      if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
        const adjIsPositiveTest = testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.Equals ? isPositiveTest : !isPositiveTest;

        if (testExpression.rightExpression.nodeType === ParseNodeType.Constant && testExpression.rightExpression.constType === KeywordType.None) {
          let leftExpression = testExpression.leftExpression;
          if (leftExpression.nodeType === ParseNodeType.AssignmentExpression) {
            leftExpression = leftExpression.name;
          }

          if (ParseTreeUtils.isMatchingExpression(reference, leftExpression)) {
            return (type: Type) => {
              const expandedType = mapSubtypes(type, (subtype) => {
                return transformPossibleRecursiveTypeAlias(subtype);
              });
              return mapSubtypes(expandedType, (subtype) => {
                if (isAnyOrUnknown(subtype)) {
                  return subtype;
                }

                if (isNone(subtype) === adjIsPositiveTest) {
                  return subtype;
                }

                return undefined;
              });
            };
          }
        }

        if (isOrIsNotOperator && testExpression.leftExpression.nodeType === ParseNodeType.Call) {
          const callType = getTypeOfExpression(testExpression.leftExpression.leftExpression).type;
          if (
            isClass(callType) &&
            ClassType.isBuiltIn(callType, 'type') &&
            testExpression.leftExpression.arguments.length === 1 &&
            testExpression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple
          ) {
            const arg0Expr = testExpression.leftExpression.arguments[0].valueExpression;
            if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
              const classType = getTypeOfExpression(testExpression.rightExpression).type;
              if (isClass(classType)) {
                return (type: Type) => {
                  return mapSubtypes(type, (subtype) => {
                    if (isObject(subtype)) {
                      const matches = ClassType.isDerivedFrom(classType, subtype.classType);
                      if (adjIsPositiveTest) {
                        return matches ? ObjectType.create(classType) : undefined;
                      } else {
                        return subtype;
                      }
                    } else if (isNone(subtype)) {
                      return adjIsPositiveTest ? undefined : subtype;
                    }

                    return subtype;
                  });
                };
              }
            }
          }
        }

        if (isOrIsNotOperator) {
          if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
            const rightType = getTypeOfExpression(testExpression.rightExpression).type;
            if (isObject(rightType) && ClassType.isEnumClass(rightType.classType) && rightType.classType.literalValue !== undefined) {
              return (type: Type) => {
                return narrowTypeForLiteralComparison(type, rightType, adjIsPositiveTest, /* isIsOperator */ true);
              };
            }
          }
        }

        if (equalsOrNotEqualsOperator) {
          const adjIsPositiveTest = testExpression.operator === OperatorType.Equals ? isPositiveTest : !isPositiveTest;

          if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
            const rightType = getTypeOfExpression(testExpression.rightExpression).type;
            if (isObject(rightType) && rightType.classType.literalValue !== undefined) {
              return (type: Type) => {
                return narrowTypeForLiteralComparison(type, rightType, adjIsPositiveTest, /* isIsOperator */ false);
              };
            }
          }

          if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
            const leftType = getTypeOfExpression(testExpression.leftExpression).type;
            if (isObject(leftType) && leftType.classType.literalValue !== undefined) {
              return (type: Type) => {
                return narrowTypeForLiteralComparison(type, leftType, adjIsPositiveTest, /* isIsOperator */ false);
              };
            }
          }

          if (testExpression.leftExpression.nodeType === ParseNodeType.MemberAccess && ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.leftExpression)) {
            const rightType = getTypeOfExpression(testExpression.rightExpression).type;
            const memberName = testExpression.leftExpression.memberName;
            if (isObject(rightType) && rightType.classType.literalValue !== undefined) {
              return (type: Type) => {
                return narrowTypeForDiscriminatedFieldComparison(type, memberName.value, rightType, adjIsPositiveTest);
              };
            }
          }
        }
      }

      if (testExpression.operator === OperatorType.In) {
        if (isPositiveTest && ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
          const rightType = getTypeOfExpression(testExpression.rightExpression).type;
          return (type: Type) => {
            return narrowTypeForContains(type, rightType);
          };
        }
      }

      if (testExpression.operator === OperatorType.In || testExpression.operator === OperatorType.NotIn) {
        if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
          const leftType = getTypeOfExpression(testExpression.leftExpression).type;
          if (isObject(leftType) && ClassType.isBuiltIn(leftType.classType, 'str') && isLiteralType(leftType)) {
            const adjIsPositiveTest = testExpression.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;
            return (type: Type) => {
              return narrowTypeForTypedDictKey(type, leftType.classType, adjIsPositiveTest);
            };
          }
        }
      }
    }

    if (testExpression.nodeType === ParseNodeType.Call) {
      if (testExpression.leftExpression.nodeType === ParseNodeType.Name) {
        if ((testExpression.leftExpression.value === 'isinstance' || testExpression.leftExpression.value === 'issubclass') && testExpression.arguments.length === 2) {
          const isInstanceCheck = testExpression.leftExpression.value === 'isinstance';
          const arg0Expr = testExpression.arguments[0].valueExpression;
          const arg1Expr = testExpression.arguments[1].valueExpression;
          if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
            const arg1Type = getTypeOfExpression(arg1Expr, undefined, EvaluatorFlags.EvaluateStringLiteralAsType | EvaluatorFlags.ParamSpecDisallowed | EvaluatorFlags.TypeVarTupleDisallowed).type;
            const classTypeList = getIsInstanceClassTypes(arg1Type);
            if (classTypeList) {
              return (type: Type) => {
                return narrowTypeForIsInstance(type, classTypeList, isInstanceCheck, isPositiveTest);
              };
            }
          }
        } else if (testExpression.leftExpression.value === 'callable' && testExpression.arguments.length === 1) {
          const arg0Expr = testExpression.arguments[0].valueExpression;
          if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
            return (type: Type) => {
              return narrowTypeForCallable(type, isPositiveTest, testExpression);
            };
          }
        }
      }

      if (testExpression.arguments.length >= 1) {
        const arg0Expr = testExpression.arguments[0].valueExpression;
        if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
          const functionType = getTypeOfExpression(testExpression.leftExpression).type;

          if (
            isFunction(functionType) &&
            functionType.details.declaredReturnType &&
            isObject(functionType.details.declaredReturnType) &&
            ClassType.isBuiltIn(functionType.details.declaredReturnType.classType, 'TypeGuard')
          ) {
            const functionReturnType = getTypeOfExpression(testExpression).type;
            if (isObject(functionReturnType) && ClassType.isBuiltIn(functionReturnType.classType, 'TypeGuard')) {
              const typeGuardTypeArgs = functionReturnType.classType.typeArguments;
              const typeGuardTypeArg = typeGuardTypeArgs && typeGuardTypeArgs.length > 0 ? typeGuardTypeArgs[0] : UnknownType.create();

              return (type: Type) => {
                return isPositiveTest ? typeGuardTypeArg : type;
              };
            }
          }
        }
      }
    }

    if (ParseTreeUtils.isMatchingExpression(reference, testExpression)) {
      return (type: Type) => {
        return mapSubtypes(type, (subtype) => {
          if (isPositiveTest) {
            if (canBeTruthy(subtype)) {
              return removeFalsinessFromType(subtype);
            }
          } else {
            if (canBeFalsy(subtype)) {
              return removeTruthinessFromType(subtype);
            }
          }
          return undefined;
        });
      };
    }

    return undefined;
  }

  function getIsInstanceClassTypes(argType: Type): (ClassType | TypeVarType)[] | undefined {
    argType = transformTypeObjectToClass(argType);

    if (isClass(argType) || (isTypeVar(argType) && TypeBase.isInstantiable(argType))) {
      return [argType];
    }

    if (isObject(argType)) {
      const objClass = argType.classType;
      if (isTupleClass(objClass) && objClass.tupleTypeArguments) {
        let foundNonClassType = false;
        const classTypeList: (ClassType | TypeVarType)[] = [];
        objClass.tupleTypeArguments.forEach((typeArg) => {
          typeArg = transformTypeObjectToClass(typeArg);
          if (isClass(typeArg) || (isTypeVar(typeArg) && TypeBase.isInstantiable(typeArg))) {
            classTypeList.push(typeArg);
          } else {
            foundNonClassType = true;
          }
        });

        if (!foundNonClassType) {
          return classTypeList;
        }
      }
    }

    if (isUnion(argType)) {
      let isValid = true;
      const classList: (ClassType | TypeVarType)[] = [];
      doForEachSubtype(argType, (subtype) => {
        if (isClass(subtype) || (isTypeVar(subtype) && TypeBase.isInstantiable(subtype))) {
          classList.push(subtype);
        } else {
          isValid = false;
        }
      });

      if (isValid && classList.length > 0) {
        return classList;
      }
    }

    return undefined;
  }

  function narrowTypeForIsInstance(type: Type, classTypeList: (ClassType | TypeVarType)[], isInstanceCheck: boolean, isPositiveTest: boolean): Type {
    const expandedTypes = mapSubtypes(type, (subtype) => {
      return transformPossibleRecursiveTypeAlias(subtype);
    });
    const effectiveType = mapSubtypes(expandedTypes, (subtype) => {
      return transformTypeObjectToClass(subtype);
    });

    const filterType = (varType: ClassType, unexpandedType: Type, negativeFallbackType: Type): Type[] => {
      const filteredTypes: Type[] = [];

      let foundSuperclass = false;
      let isClassRelationshipIndeterminate = false;

      for (const filterType of classTypeList) {
        const concreteFilterType = makeTopLevelTypeVarsConcrete(filterType);

        if (isClass(concreteFilterType)) {
          const filterIsSuperclass =
            !isTypeVar(filterType) && (ClassType.isDerivedFrom(varType, concreteFilterType) || (ClassType.isBuiltIn(concreteFilterType, 'dict') && ClassType.isTypedDictClass(varType)));
          const filterIsSubclass = ClassType.isDerivedFrom(concreteFilterType, varType);

          if (filterIsSuperclass) {
            foundSuperclass = true;
          }

          if (filterIsSubclass && filterIsSuperclass && !ClassType.isSameGenericClass(varType, concreteFilterType)) {
            isClassRelationshipIndeterminate = true;
          }

          if (isPositiveTest) {
            if (filterIsSuperclass) {
              if (isTypeVar(unexpandedType) && unexpandedType.details.constraints.length === 0) {
                filteredTypes.push(unexpandedType);
              } else {
                filteredTypes.push(varType);
              }
            } else if (filterIsSubclass) {
              filteredTypes.push(filterType);
            }
          }
        }
      }

      if (!isPositiveTest) {
        if (!foundSuperclass || isClassRelationshipIndeterminate) {
          filteredTypes.push(negativeFallbackType);
        }
      }

      if (!isInstanceCheck) {
        return filteredTypes;
      }

      return filteredTypes.map((t) => convertToInstance(t));
    };

    const anyOrUnknownSubstitutions: Type[] = [];
    const anyOrUnknown: Type[] = [];

    const filteredType = mapSubtypesExpandTypeVars(effectiveType, /* constraintFilter */ undefined, (subtype, unexpandedSubtype, constraints) => {
      const negativeFallback = constraints ? subtype : unexpandedSubtype;

      if (isInstanceCheck && isObject(subtype)) {
        return combineTypes(filterType(subtype.classType, convertToInstance(unexpandedSubtype), negativeFallback));
      } else if (!isInstanceCheck && isClass(subtype)) {
        return combineTypes(filterType(subtype, unexpandedSubtype, negativeFallback));
      } else if (!isInstanceCheck && isObject(subtype) && ClassType.isBuiltIn(subtype.classType, 'type') && objectType && isObject(objectType)) {
        return combineTypes(filterType(objectType.classType, convertToInstantiable(unexpandedSubtype), negativeFallback));
      } else if (isPositiveTest && isAnyOrUnknown(subtype)) {
        if (isInstanceCheck) {
          anyOrUnknownSubstitutions.push(combineTypes(classTypeList.map((classType) => convertToInstance(classType))));
        } else {
          anyOrUnknownSubstitutions.push(combineTypes(classTypeList));
        }

        anyOrUnknown.push(subtype);
        return undefined;
      }

      return isPositiveTest ? undefined : negativeFallback;
    });

    if (isNever(filteredType) && anyOrUnknownSubstitutions.length > 0) {
      return combineTypes(anyOrUnknownSubstitutions);
    }

    if (anyOrUnknown.length > 0) {
      return combineTypes([filteredType, ...anyOrUnknown]);
    }

    return filteredType;
  }

  function narrowTypeForContains(referenceType: Type, containerType: Type) {
    if (!isObject(containerType) || !ClassType.isBuiltIn(containerType.classType)) {
      return referenceType;
    }

    const classType = containerType.classType;
    const builtInName = classType.details.name;

    if (!['list', 'set', 'frozenset', 'deque'].some((name) => name === builtInName)) {
      return referenceType;
    }

    if (!classType.typeArguments || classType.typeArguments.length !== 1) {
      return referenceType;
    }

    const typeArg = classType.typeArguments[0];
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
      if (isAnyOrUnknown(subtype)) {
        canNarrow = false;
        return subtype;
      }

      if (!canAssignType(typeArg, subtype, new DiagAddendum())) {
        return undefined;
      }

      return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
  }

  function narrowTypeForTypedDictKey(referenceType: Type, literalKey: ClassType, isPositiveTest: boolean): Type {
    const narrowedType = mapSubtypes(referenceType, (subtype) => {
      if (isObject(subtype) && ClassType.isTypedDictClass(subtype.classType)) {
        const entries = getTypedDictMembersForClass(subtype.classType, /* allowNarrowed */ true);
        const tdEntry = entries.get(literalKey.literalValue as string);

        if (isPositiveTest) {
          if (!tdEntry) {
            return undefined;
          }

          if (tdEntry.isRequired) {
            return subtype;
          }

          const oldNarrowedEntriesMap = subtype.classType.typedDictNarrowedEntries;
          const newNarrowedEntriesMap = new Map<string, TypedDictEntry>();
          if (oldNarrowedEntriesMap) {
            oldNarrowedEntriesMap.forEach((value, key) => {
              newNarrowedEntriesMap.set(key, value);
            });
          }

          newNarrowedEntriesMap.set(literalKey.literalValue as string, {
            valueType: tdEntry.valueType,
            isRequired: true,
            isProvided: true,
          });

          return ObjectType.create(ClassType.cloneForNarrowedTypedDictEntries(subtype.classType, newNarrowedEntriesMap));
        } else {
          return tdEntry !== undefined && tdEntry.isRequired ? undefined : subtype;
        }
      }

      return subtype;
    });

    return narrowedType;
  }

  function narrowTypeForDiscriminatedFieldComparison(referenceType: Type, memberName: string, literalType: ObjectType, isPositiveTest: boolean): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
      subtype = transformTypeObjectToClass(subtype);

      let memberInfo: ClassMember | undefined;
      if (isObject(subtype)) {
        memberInfo = lookUpObjectMember(subtype, memberName);
      } else if (isClass(subtype)) {
        memberInfo = lookUpClassMember(subtype, memberName);
      }

      if (memberInfo && memberInfo.isTypeDeclared) {
        const memberType = getTypeOfMember(memberInfo);

        if (isLiteralTypeOrUnion(memberType)) {
          if (isPositiveTest) {
            return canAssignType(memberType, literalType, new DiagAddendum()) ? subtype : undefined;
          } else {
            return canAssignType(literalType, memberType, new DiagAddendum()) ? undefined : subtype;
          }
        }
      }

      canNarrow = false;
      return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
  }

  function narrowTypeForLiteralComparison(referenceType: Type, literalType: ObjectType, isPositiveTest: boolean, isIsOperator: boolean): Type {
    return mapSubtypes(referenceType, (subtype) => {
      if (isObject(subtype) && ClassType.isSameGenericClass(literalType.classType, subtype.classType)) {
        if (subtype.classType.literalValue !== undefined) {
          const literalValueMatches = ClassType.isLiteralValueSame(subtype.classType, literalType.classType);
          if ((literalValueMatches && !isPositiveTest) || (!literalValueMatches && isPositiveTest)) {
            return undefined;
          }
          return subtype;
        } else if (isPositiveTest) {
          return literalType;
        } else {
          const allLiteralTypes = enumerateLiteralsForType(subtype);
          if (allLiteralTypes) {
            return combineTypes(allLiteralTypes.filter((type) => !ClassType.isLiteralValueSame(type.classType, literalType.classType)));
          }
        }
      } else if (isIsOperator && isPositiveTest) {
        return undefined;
      }

      return subtype;
    });
  }

  function enumerateLiteralsForType(type: ObjectType): ObjectType[] | undefined {
    if (ClassType.isBuiltIn(type.classType, 'bool')) {
      return [ObjectType.create(ClassType.cloneWithLiteral(type.classType, true)), ObjectType.create(ClassType.cloneWithLiteral(type.classType, false))];
    }

    if (ClassType.isEnumClass(type.classType)) {
      const enumList: ObjectType[] = [];
      const fields = type.classType.details.fields;
      fields.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch() && !symbol.isInstanceMember()) {
          const symbolType = getEffectiveTypeOfSymbol(symbol);
          if (isObject(symbolType) && ClassType.isSameGenericClass(type.classType, symbolType.classType) && symbolType.classType.literalValue !== undefined) {
            enumList.push(symbolType);
          }
        }
      });

      return enumList;
    }

    return undefined;
  }

  function narrowTypeForCallable(type: Type, isPositiveTest: boolean, errorNode: ExpressionNode): Type {
    return mapSubtypes(type, (subtype) => {
      switch (subtype.category) {
        case TypeCategory.Function:
        case TypeCategory.OverloadedFunction:
        case TypeCategory.Class: {
          return isPositiveTest ? subtype : undefined;
        }

        case TypeCategory.None:
        case TypeCategory.Module: {
          return isPositiveTest ? undefined : subtype;
        }

        case TypeCategory.Object: {
          const classFromTypeObject = transformTypeObjectToClass(subtype);
          if (TypeBase.isInstantiable(classFromTypeObject)) {
            return isPositiveTest ? subtype : undefined;
          }

          const callMemberType = getTypeFromObjectMember(errorNode, subtype, '__call__');
          if (!callMemberType) {
            return isPositiveTest ? undefined : subtype;
          } else {
            return isPositiveTest ? subtype : undefined;
          }
        }

        default: {
          return subtype;
        }
      }
    });
  }

  function createSpecializedClassType(classType: ClassType, typeArgs: TypeResult[] | undefined, flags: EvaluatorFlags, errorNode: ParseNode): Type {
    if (ClassType.isSpecialBuiltIn(classType)) {
      const aliasedName = classType.aliasName || classType.details.name;
      switch (aliasedName) {
        case 'Callable': {
          return createCallableType(typeArgs, errorNode);
        }

        case 'Optional': {
          return createOptionalType(errorNode, typeArgs);
        }

        case 'Type': {
          return createSpecialType(classType, typeArgs, 1);
        }

        case 'ClassVar': {
          return createClassVarType(errorNode, typeArgs);
        }

        case 'Protocol': {
          return createSpecialType(classType, typeArgs, /* paramLimit */ undefined);
        }

        case 'Tuple': {
          return createSpecialType(classType, typeArgs, /* paramLimit */ undefined);
        }

        case 'Union': {
          return createUnionType(typeArgs);
        }

        case 'Generic': {
          return createGenericType(errorNode, classType, typeArgs);
        }

        case 'Final': {
          return createFinalType(classType, errorNode, typeArgs, flags);
        }

        case 'Annotated': {
          return createAnnotatedType(errorNode, typeArgs);
        }

        case 'Concatenate': {
          return createConcatenateType(errorNode, classType, typeArgs);
        }

        case 'TypeGuard': {
          return createTypeGuardType(errorNode, classType, typeArgs);
        }

        case 'Unpack': {
          return createUnpackType(errorNode, typeArgs);
        }

        case 'Required':
        case 'NotRequired': {
          return createRequiredType(classType, errorNode, aliasedName === 'Required', typeArgs);
        }
      }
    }

    const fileInfo = getFileInfo(errorNode);
    if (
      fileInfo.isStubFile ||
      fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_9 ||
      isAnnotationEvaluationPostponed(getFileInfo(errorNode)) ||
      (flags & EvaluatorFlags.AllowForwardReferences) !== 0
    ) {
      if (ClassType.isBuiltIn(classType, 'type') && typeArgs) {
        const typeClass = getTypingType(errorNode, 'Type');
        if (typeClass && isClass(typeClass)) {
          return createSpecialType(typeClass, typeArgs, 1);
        }
      }

      if (isTupleClass(classType)) {
        return createSpecialType(classType, typeArgs, /* paramLimit */ undefined);
      }
    }

    let typeArgCount = typeArgs ? typeArgs.length : 0;

    const typeParameters = ClassType.getTypeParameters(classType);

    if (typeParameters.length === 0 && typeArgCount === 0) {
      return classType;
    }

    const variadicTypeParamIndex = typeParameters.findIndex((param) => isVariadicTypeVar(param));

    if (typeArgs) {
      if (typeArgCount > typeParameters.length) {
        if (!ClassType.isPartiallyConstructed(classType) && !ClassType.isTupleClass(classType)) {
          const fileInfo = getFileInfo(errorNode);
          if (typeParameters.length === 0) {
            addDiag(fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.typeArgsExpectingNone(), typeArgs[typeParameters.length].node);
          } else {
            addDiag(
              fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.typeArgsTooMany().format({
                name: classType.aliasName || classType.details.name,
                expected: typeParameters.length,
                received: typeArgCount,
              }),
              typeArgs[typeParameters.length].node
            );
          }
        }
        typeArgCount = typeParameters.length;
      } else if (typeArgCount < typeParameters.length) {
        const fileInfo = getFileInfo(errorNode);
        addDiag(
          fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.typeArgsTooFew().format({
            name: classType.aliasName || classType.details.name,
            expected: typeParameters.length,
            received: typeArgCount,
          }),
          typeArgs.length > 0 ? typeArgs[0].node.parent! : errorNode
        );
      }

      typeArgs.forEach((typeArg, index) => {
        if (index === variadicTypeParamIndex) {
          if (isObject(typeArg.type) && isTupleClass(typeArg.type.classType)) {
            return;
          }

          if (isVariadicTypeVar(typeArg.type)) {
            validateVariadicTypeVarIsUnpacked(typeArg.type, typeArg.node);
            return;
          }
        }

        validateTypeArg(typeArg);
      });
    }

    const typeArgTypes = typeArgs ? typeArgs.map((t) => convertToInstance(t.type)) : [];
    const typeParams = ClassType.getTypeParameters(classType);
    for (let i = typeArgTypes.length; i < typeParams.length; i++) {
      typeArgTypes.push(UnknownType.create());
    }

    typeArgTypes.forEach((typeArgType, index) => {
      if (index < typeArgCount) {
        const diag = new DiagAddendum();
        if (!canAssignToTypeVar(typeParameters[index], typeArgType, diag)) {
          const fileInfo = getFileInfo(typeArgs![index].node);
          addDiag(
            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.typeVarAssignmentMismatch().format({
              type: printType(typeArgType),
              name: TypeVarType.getReadableName(typeParameters[index]),
            }) + diag.getString(),
            typeArgs![index].node
          );
        }
      }
    });

    const specializedClass = ClassType.cloneForSpecialization(classType, typeArgTypes, typeArgs !== undefined);

    return specializedClass;
  }

  function getTypeForArgument(arg: FunctionArgument): Type {
    if (arg.type) {
      return arg.type;
    }

    return getTypeOfExpression(arg.valueExpression!).type;
  }

  function getTypeForArgumentExpectingType(arg: FunctionArgument): Type {
    if (arg.type) {
      return arg.type;
    }

    return getTypeForExpressionExpectingType(arg.valueExpression!);
  }

  function getTypeForExpressionExpectingType(node: ExpressionNode, allowFinal = false) {
    let flags = EvaluatorFlags.ExpectingType | EvaluatorFlags.EvaluateStringLiteralAsType | EvaluatorFlags.ParamSpecDisallowed | EvaluatorFlags.TypeVarTupleDisallowed;

    const fileInfo = getFileInfo(node);
    if (fileInfo.isStubFile) {
      flags |= EvaluatorFlags.AllowForwardReferences;
    }

    if (!allowFinal) {
      flags |= EvaluatorFlags.FinalDisallowed;
    }

    return getTypeOfExpression(node, undefined, flags).type;
  }

  function getBuiltInType(node: ParseNode, name: string): Type {
    const scope = ScopeUtils.getScopeForNode(node);
    if (scope) {
      const builtInScope = ScopeUtils.getBuiltInScope(scope);
      const nameType = builtInScope.lookUpSymbol(name);
      if (nameType) {
        return getEffectiveTypeOfSymbol(nameType);
      }
    }

    return UnknownType.create();
  }

  function getBuiltInObject(node: ParseNode, name: string, typeArguments?: Type[]) {
    const nameType = getBuiltInType(node, name);
    if (isClass(nameType)) {
      let classType = nameType;
      if (typeArguments) {
        classType = ClassType.cloneForSpecialization(classType, typeArguments, /* isTypeArgumentExplicit */ typeArguments !== undefined);
      }

      return ObjectType.create(classType);
    }

    return nameType;
  }

  function lookUpSymbolRecursive(node: ParseNode, name: string, honorCodeFlow: boolean) {
    const scope = ScopeUtils.getScopeForNode(node);
    let symbolWithScope = scope?.lookUpSymbolRecursive(name);

    if (symbolWithScope && honorCodeFlow) {
      const decls = symbolWithScope.symbol.getDeclarations().filter((decl) => {
        if (decl.type !== DeclarationType.Alias) {
          const usageScope = ParseTreeUtils.getExecutionScopeNode(node);
          const declNode = decl.type === DeclarationType.Class || decl.type === DeclarationType.Function ? decl.node.name : decl.node;
          const declScope = ParseTreeUtils.getExecutionScopeNode(declNode);
          if (usageScope === declScope) {
            if (!isFlowPathBetweenNodes(declNode, node)) {
              const flowNode = AnalyzerNodeInfo.getFlowNode(node);
              const isReachable = flowNode && isFlowNodeReachable(flowNode);
              return !isReachable;
            }
          }
        }

        return true;
      });

      if (decls.length === 0) {
        if (symbolWithScope.scope.parent) {
          symbolWithScope = symbolWithScope.scope.parent.lookUpSymbolRecursive(
            name,
            symbolWithScope.isOutsideCallerModule || symbolWithScope.scope.type === ScopeType.Module,
            symbolWithScope.isBeyondExecutionScope || symbolWithScope.scope.isIndependentlyExecutable()
          );
        } else {
          symbolWithScope = undefined;
        }
      }
    }

    return symbolWithScope;
  }

  function suppressDiags<T>(node: ParseNode, callback: () => T) {
    suppressedNodeStack.push(node);
    try {
      return callback();
    } finally {
      suppressedNodeStack.pop();
    }
  }

  function useSpeculativeMode<T>(speculativeNode: ParseNode, callback: () => T, allowCacheRetention = true) {
    speculativeTypeTracker.enterSpeculativeContext(speculativeNode, allowCacheRetention);

    try {
      return callback();
    } finally {
      speculativeTypeTracker.leaveSpeculativeContext();
    }
  }

  function disableSpeculativeMode(callback: () => void) {
    const stack = speculativeTypeTracker.disableSpeculativeMode();
    try {
      callback();
    } finally {
      speculativeTypeTracker.enableSpeculativeMode(stack);
    }
  }

  function getFileInfo(node: ParseNode): AnalyzerFileInfo {
    while (node.nodeType !== ParseNodeType.Module) {
      node = node.parent!;
    }
    return AnalyzerNodeInfo.getFileInfo(node)!;
  }

  function getDeclarationFromFunctionNamedParameter(type: FunctionType, paramName: string): Declaration | undefined {
    if (isFunction(type)) {
      if (type.details.declaration) {
        const functionDecl = type.details.declaration;
        if (functionDecl.type === DeclarationType.Function) {
          const functionNode = functionDecl.node;
          const functionScope = AnalyzerNodeInfo.getScope(functionNode);
          if (functionScope) {
            const paramSymbol = functionScope.lookUpSymbol(paramName)!;
            if (paramSymbol) {
              return paramSymbol.getDeclarations().find((decl) => decl.type === DeclarationType.Parameter);
            }
          }
        }
      }
    }

    return undefined;
  }

  function getDeclarationsForNameNode(node: NameNode): Declaration[] | undefined {
    if (AnalyzerNodeInfo.isCodeUnreachable(node)) {
      return undefined;
    }

    const declarations: Declaration[] = [];

    if (node.parent && node.parent.nodeType === ParseNodeType.ImportFromAs && node.parent.alias && node === node.parent.name) {
      const scope = ScopeUtils.getScopeForNode(node);
      if (scope) {
        const symbolInScope = scope.lookUpSymbolRecursive(node.parent.alias.value);
        if (symbolInScope) {
          const declsForThisImport = symbolInScope.symbol.getDeclarations().filter((decl) => {
            return decl.type === DeclarationType.Alias && decl.node === node.parent;
          });

          const nonLocalDecls = declsForThisImport.map((localDecl) => {
            if (localDecl.type === DeclarationType.Alias) {
              const nonLocalDecl: AliasDeclaration = { ...localDecl };
              nonLocalDecl.usesLocalName = false;
              return nonLocalDecl;
            }
            return localDecl;
          });

          declarations.push(...nonLocalDecls);
        }
      }
    } else if (node.parent && node.parent.nodeType === ParseNodeType.MemberAccess && node === node.parent.memberName) {
      let baseType = getType(node.parent.leftExpression);
      if (baseType) {
        baseType = transformTypeObjectToClass(makeTopLevelTypeVarsConcrete(baseType));
        const memberName = node.parent.memberName.value;
        doForEachSubtype(baseType, (subtype) => {
          let symbol: Symbol | undefined;

          subtype = makeTopLevelTypeVarsConcrete(subtype);

          if (isClass(subtype)) {
            let member = lookUpClassMember(subtype, memberName, ClassMemberLookupFlags.DeclaredTypesOnly);
            if (!member) {
              member = lookUpClassMember(subtype, memberName);
            }
            if (member) {
              symbol = member.symbol;
            }
          } else if (isObject(subtype)) {
            let member = lookUpObjectMember(subtype, memberName, ClassMemberLookupFlags.DeclaredTypesOnly);
            if (!member) {
              member = lookUpObjectMember(subtype, memberName);
            }
            if (member) {
              symbol = member.symbol;
            }
          } else if (isModule(subtype)) {
            symbol = ModuleType.getField(subtype, memberName);
          }

          if (symbol) {
            const typedDecls = symbol.getTypedDeclarations();
            if (typedDecls.length > 0) {
              declarations.push(...typedDecls);
            } else {
              declarations.push(...symbol.getDeclarations());
            }
          }
        });
      }
    } else if (node.parent && node.parent.nodeType === ParseNodeType.ModuleName) {
      const namePartIndex = node.parent.nameParts.findIndex((part) => part === node);
      const importInfo = AnalyzerNodeInfo.getImportInfo(node.parent);
      if (namePartIndex >= 0 && importInfo && !importInfo.isNativeLib && namePartIndex < importInfo.resolvedPaths.length) {
        if (importInfo.resolvedPaths[namePartIndex]) {
          evaluateTypesForStatement(node);

          const aliasDeclaration: AliasDeclaration = {
            type: DeclarationType.Alias,
            node: undefined!,
            path: importInfo.resolvedPaths[namePartIndex],
            range: getEmptyRange(),
            implicitImports: new Map<string, ModuleLoaderActions>(),
            usesLocalName: false,
            moduleName: '',
          };
          declarations.push(aliasDeclaration);
        }
      }
    } else if (node.parent && node.parent.nodeType === ParseNodeType.Argument && node === node.parent.name) {
      const argNode = node.parent;
      const paramName = node.value;
      if (argNode.parent && argNode.parent.nodeType === ParseNodeType.Call) {
        const baseType = getType(argNode.parent.leftExpression);

        if (baseType) {
          if (isFunction(baseType) && baseType.details.declaration) {
            const paramDecl = getDeclarationFromFunctionNamedParameter(baseType, paramName);
            if (paramDecl) {
              declarations.push(paramDecl);
            }
          } else if (isOverloadedFunction(baseType)) {
            baseType.overloads.forEach((f) => {
              const paramDecl = getDeclarationFromFunctionNamedParameter(f, paramName);
              if (paramDecl) {
                declarations.push(paramDecl);
              }
            });
          } else if (isClass(baseType)) {
            const initMethodType = getTypeFromObjectMember(
              argNode.parent.leftExpression,
              ObjectType.create(baseType),
              '__init__',
              { method: 'get' },
              new DiagAddendum(),
              MemberAccessFlags.SkipObjectBaseClass
            )?.type;

            if (initMethodType && isFunction(initMethodType)) {
              const paramDecl = getDeclarationFromFunctionNamedParameter(initMethodType, paramName);
              if (paramDecl) {
                declarations.push(paramDecl);
              } else if (ClassType.isDataClass(baseType)) {
                const lookupResults = lookUpClassMember(baseType, paramName);
                if (lookupResults) {
                  declarations.push(...lookupResults.symbol.getDeclarations());
                }
              }
            }
          }
        }
      }
    } else {
      const fileInfo = getFileInfo(node);
      let allowForwardReferences = fileInfo.isStubFile;

      if (ParseTreeUtils.isWithinTypeAnnotation(node, !isAnnotationEvaluationPostponed(getFileInfo(node)))) {
        allowForwardReferences = true;
      }

      const symbolWithScope = lookUpSymbolRecursive(node, node.value, !allowForwardReferences);
      if (symbolWithScope) {
        declarations.push(...symbolWithScope.symbol.getDeclarations());
      }
    }

    return declarations;
  }

  function getTypeForDeclaration(declaration: Declaration): Type | undefined {
    switch (declaration.type) {
      case DeclarationType.Intrinsic: {
        if (declaration.intrinsicType === 'Any') {
          return AnyType.create();
        }

        if (declaration.intrinsicType === 'class') {
          const classNode = ParseTreeUtils.getEnclosingClass(declaration.node) as ClassNode;
          const classTypeInfo = getTypeOfClass(classNode);
          return classTypeInfo ? classTypeInfo.classType : undefined;
        }

        const strType = getBuiltInObject(declaration.node, 'str');
        const intType = getBuiltInObject(declaration.node, 'int');
        if (isObject(intType) && isObject(strType)) {
          if (declaration.intrinsicType === 'str') {
            return strType;
          }

          if (declaration.intrinsicType === 'int') {
            return intType;
          }

          if (declaration.intrinsicType === 'List[str]') {
            const listType = getBuiltInType(declaration.node, 'list');
            if (isClass(listType)) {
              return ObjectType.create(ClassType.cloneForSpecialization(listType, [strType], /* isTypeArgumentExplicit */ true));
            }
          }

          if (declaration.intrinsicType === 'Dict[str, Any]') {
            const dictType = getBuiltInType(declaration.node, 'dict');
            if (isClass(dictType)) {
              return ObjectType.create(ClassType.cloneForSpecialization(dictType, [strType, AnyType.create()], /* isTypeArgumentExplicit */ true));
            }
          }
        }

        return UnknownType.create();
      }

      case DeclarationType.Class: {
        const classTypeInfo = getTypeOfClass(declaration.node);
        return classTypeInfo ? classTypeInfo.decoratedType : undefined;
      }

      case DeclarationType.SpecialBuiltInClass: {
        return getTypeOfAnnotation(declaration.node.typeAnnotation);
      }

      case DeclarationType.Function: {
        const functionTypeInfo = getTypeOfFunction(declaration.node);
        return functionTypeInfo ? functionTypeInfo.decoratedType : undefined;
      }

      case DeclarationType.Parameter: {
        let typeAnnotationNode = declaration.node.typeAnnotation || declaration.node.typeAnnotationComment;

        if (!typeAnnotationNode) {
          if (declaration.node.parent?.nodeType === ParseNodeType.Function) {
            const functionNode = declaration.node.parent;
            if (functionNode.functionAnnotationComment && !functionNode.functionAnnotationComment.isParamListEllipsis) {
              const paramIndex = functionNode.parameters.findIndex((param) => param === declaration.node);
              typeAnnotationNode = getTypeAnnotationForParameter(functionNode, paramIndex);
            }
          }
        }

        if (typeAnnotationNode) {
          const declaredType = getTypeOfAnnotation(
            typeAnnotationNode,
            /* allowFinal */ false,
            /* associateTypeVarsWithScope */ true,
            /* allowTypeVarTuple */ declaration.node.category === ParameterCategory.VarArgList
          );
          return transformVariadicParamType(declaration.node, declaration.node.category, declaredType);
        }

        return undefined;
      }

      case DeclarationType.Variable: {
        const typeAnnotationNode = declaration.typeAnnotationNode;

        if (typeAnnotationNode) {
          const typeAliasNode = isDeclaredTypeAlias(typeAnnotationNode) ? ParseTreeUtils.getTypeAnnotationNode(typeAnnotationNode) : undefined;
          let declaredType = getTypeOfAnnotation(typeAnnotationNode);

          if (declaredType) {
            if (declaration.node.nodeType === ParseNodeType.Name) {
              declaredType = transformTypeForPossibleEnumClass(declaration.node, () => declaredType) || declaredType;
            }

            if (typeAliasNode && typeAliasNode.valueExpression.nodeType === ParseNodeType.Name) {
              declaredType = transformTypeForTypeAlias(declaredType, typeAliasNode.valueExpression, declaration.node);
            }

            return declaredType;
          }
        }

        return undefined;
      }

      case DeclarationType.Alias: {
        return undefined;
      }
    }
  }

  function getInferredTypeOfDeclaration(decl: Declaration): Type | undefined {
    const resolvedDecl = resolveAliasDeclaration(decl, /* resolveLocalNames */ true);

    if (!resolvedDecl) {
      return UnknownType.create();
    }

    function applyLoaderActionsToModuleType(moduleType: ModuleType, loaderActions: ModuleLoaderActions, importLookup: ImportLookup): Type {
      if (loaderActions.path) {
        const lookupResults = importLookup(loaderActions.path);
        if (lookupResults) {
          moduleType.fields = lookupResults.symbolTable;
          moduleType.docString = lookupResults.docString;
        } else {
          return UnknownType.create();
        }
      }

      if (loaderActions.implicitImports) {
        loaderActions.implicitImports.forEach((implicitImport, name) => {
          const moduleName = moduleType.moduleName ? moduleType.moduleName + '.' + name : '';
          const importedModuleType = ModuleType.create(moduleName);
          const symbolType = applyLoaderActionsToModuleType(importedModuleType, implicitImport, importLookup);

          const importedModuleSymbol = Symbol.createWithType(SymbolFlags.None, symbolType);
          moduleType.loaderFields.set(name, importedModuleSymbol);
        });
      }

      return moduleType;
    }

    if (resolvedDecl.type === DeclarationType.Alias) {
      const moduleType = ModuleType.create(resolvedDecl.moduleName);
      if (resolvedDecl.symbolName && resolvedDecl.submoduleFallback) {
        return applyLoaderActionsToModuleType(moduleType, resolvedDecl.submoduleFallback, importLookup);
      } else {
        return applyLoaderActionsToModuleType(moduleType, resolvedDecl, importLookup);
      }
    }

    const declaredType = getTypeForDeclaration(resolvedDecl);
    if (declaredType) {
      return declaredType;
    }

    const fileInfo = getFileInfo(resolvedDecl.node);
    let isSpeculativeTypeAliasFromPyTypedFile = false;

    if (fileInfo.isInPyTypedPackage && !fileInfo.isStubFile && evaluatorOptions.disableInferenceForPyTypedSources) {
      if (resolvedDecl.type !== DeclarationType.Variable) {
        return UnknownType.create();
      }

      const enclosingClass = ParseTreeUtils.getEnclosingClass(resolvedDecl.node, /* stopAtFunction */ true);
      let isEnumValue = false;
      if (enclosingClass) {
        const classTypeInfo = getTypeOfClass(enclosingClass);
        if (classTypeInfo && ClassType.isEnumClass(classTypeInfo.classType)) {
          isEnumValue = true;
        }
      }

      if (!resolvedDecl.isFinal && !resolvedDecl.isConstant && !isEnumValue) {
        if (!resolvedDecl.typeAliasName) {
          return UnknownType.create();
        } else if (!resolvedDecl.typeAliasAnnotation) {
          isSpeculativeTypeAliasFromPyTypedFile = true;
        }
      }
    }

    if (resolvedDecl.type === DeclarationType.Parameter) {
      return evaluateTypeForSubnode(resolvedDecl.node.name!, () => {
        evaluateTypeOfParameter(resolvedDecl.node);
      })?.type;
    }

    if (resolvedDecl.type === DeclarationType.Variable && resolvedDecl.inferredTypeSource) {
      const typeSource = resolvedDecl.typeAliasName && resolvedDecl.inferredTypeSource.parent ? resolvedDecl.inferredTypeSource.parent : resolvedDecl.inferredTypeSource;
      let inferredType = evaluateTypeForSubnode(resolvedDecl.node, () => {
        evaluateTypesForStatement(typeSource);
      })?.type;

      if (inferredType && resolvedDecl.node.nodeType === ParseNodeType.Name) {
        const enumMemberType = transformTypeForPossibleEnumClass(resolvedDecl.node, () => {
          return (
            evaluateTypeForSubnode(resolvedDecl.inferredTypeSource!, () => {
              evaluateTypesForStatement(resolvedDecl.inferredTypeSource!);
            })?.type || UnknownType.create()
          );
        });
        if (enumMemberType) {
          inferredType = enumMemberType;
        }
      }

      if (inferredType && resolvedDecl.typeAliasName) {
        if (TypeBase.isInstantiable(inferredType) && !isAnyOrUnknown(inferredType)) {
          inferredType = transformTypeForTypeAlias(inferredType, resolvedDecl.typeAliasName, resolvedDecl.node);
        } else if (isSpeculativeTypeAliasFromPyTypedFile) {
          return UnknownType.create();
        }
      }

      return inferredType;
    }

    return undefined;
  }

  function resolveAliasDeclaration(declaration: Declaration, resolveLocalNames: boolean): Declaration | undefined {
    return DeclarationUtils.resolveAliasDeclaration(importLookup, declaration, resolveLocalNames);
  }

  function getEffectiveTypeOfSymbol(symbol: Symbol): Type {
    return getEffectiveTypeOfSymbolForUsage(symbol).type;
  }

  const getEffectiveTypeOfSymbolForUsage = evaluatorOptions.logCalls
    ? (s: Symbol, u?: NameNode, l = false) => logInternalCall('getEffectiveTypeOfSymbolForUsage', () => getEffectiveTypeOfSymbolForUsageInternal(s, u, l), s)
    : getEffectiveTypeOfSymbolForUsageInternal;

  function getEffectiveTypeOfSymbolForUsageInternal(symbol: Symbol, usageNode?: NameNode, useLastDecl = false): EffectiveTypeResult {
    if (symbol.hasTypedDeclarations()) {
      const declaredType = getDeclaredTypeOfSymbol(symbol);
      return {
        type: declaredType || UnknownType.create(),
        isIncomplete: false,
        includesVariableDecl: symbol.getTypedDeclarations().some((decl) => decl.type === DeclarationType.Variable),
        isRecursiveDefinition: !declaredType,
      };
    }

    let cacheEntries = effectiveTypeCache.get(symbol.id);
    const usageNodeId = usageNode ? usageNode.id : undefined;
    if (cacheEntries) {
      for (const entry of cacheEntries) {
        if (entry.usageNodeId === usageNodeId && entry.useLastDecl === useLastDecl) {
          return entry.result;
        }
      }
    }

    const typesToCombine: Type[] = [];
    const isPrivate = symbol.isPrivateMember();
    const decls = symbol.getDeclarations();
    const isFinalVar = isFinalVariable(symbol);
    let isIncomplete = false;
    let includesVariableDecl = false;

    decls.forEach((decl, index) => {
      let considerDecl = !useLastDecl || index === decls.length - 1;

      if (usageNode !== undefined) {
        if (decl.type !== DeclarationType.Alias) {
          const usageScope = ParseTreeUtils.getExecutionScopeNode(usageNode);
          const declScope = ParseTreeUtils.getExecutionScopeNode(decl.node);
          if (usageScope === declScope) {
            if (!isFlowPathBetweenNodes(decl.node, usageNode)) {
              considerDecl = false;
            }
          }
        }
      }

      if (considerDecl) {
        const isTypeAlias = isExplicitTypeAliasDeclaration(decl) || isPossibleTypeAliasDeclaration(decl);

        if (isTypeAlias && decl.type === DeclarationType.Variable && decl.inferredTypeSource?.parent?.nodeType === ParseNodeType.Assignment) {
          evaluateTypesForAssignmentStatement(decl.inferredTypeSource.parent);

          if (decl.typeAliasAnnotation) {
            getTypeOfExpression(decl.typeAliasAnnotation);
          }
        }

        if (pushSymbolResolution(symbol, decl)) {
          try {
            let type = getInferredTypeOfDeclaration(decl);

            if (!popSymbolResolution(symbol)) {
              isIncomplete = true;
            }

            if (type) {
              if (decl.type === DeclarationType.Variable) {
                includesVariableDecl = true;

                let isConstant = decl.type === DeclarationType.Variable && !!decl.isConstant;

                if (isObject(type) && ClassType.isEnumClass(type.classType) && isDeclInEnumClass(decl)) {
                  isConstant = true;
                }

                if (TypeBase.isInstance(type) && !isTypeAlias && !isPrivate && !isConstant && !isFinalVar) {
                  type = stripLiteralValue(type);
                }
              }
              typesToCombine.push(type);
            } else {
              isIncomplete = true;
            }
          } catch (e) {
            popSymbolResolution(symbol);
            throw e;
          }
        } else {
          isIncomplete = true;
        }
      }
    });

    if (typesToCombine.length > 0) {
      const result: EffectiveTypeResult = {
        type: combineTypes(typesToCombine),
        isIncomplete: false,
        includesVariableDecl,
        isRecursiveDefinition: false,
      };

      if (!cacheEntries) {
        cacheEntries = [];
        effectiveTypeCache.set(symbol.id, cacheEntries);
      }

      cacheEntries.push({
        usageNodeId,
        useLastDecl,
        result,
      });

      return result;
    }

    return {
      type: UnboundType.create(),
      isIncomplete,
      includesVariableDecl,
      isRecursiveDefinition: false,
    };
  }

  function getDeclaredTypeOfSymbol(symbol: Symbol): Type | undefined {
    const synthesizedType = symbol.getSynthesizedType();
    if (synthesizedType) {
      return synthesizedType;
    }

    const typedDecls = symbol.getTypedDeclarations();

    if (typedDecls.length === 0) {
      return undefined;
    }

    let declIndex = typedDecls.length - 1;
    while (declIndex >= 0) {
      const decl = typedDecls[declIndex];

      const partialType = getSymbolResolutionPartialType(symbol, decl);
      if (partialType) {
        return partialType;
      }

      if (getIndexOfSymbolResolution(symbol, decl) < 0) {
        if (pushSymbolResolution(symbol, decl)) {
          try {
            const type = getTypeForDeclaration(decl);

            if (popSymbolResolution(symbol) || decl.type === DeclarationType.Class) {
              return type;
            }
          } catch (e) {
            popSymbolResolution(symbol);
            throw e;
          }
        }
      }

      declIndex--;
    }

    return undefined;
  }

  function isDeclInEnumClass(decl: VariableDeclaration): boolean {
    const classNode = ParseTreeUtils.getEnclosingClass(decl.node, /* stopAtFunction */ true);
    if (!classNode) {
      return false;
    }

    const classInfo = getTypeOfClass(classNode);
    if (!classInfo) {
      return false;
    }

    return ClassType.isEnumClass(classInfo.classType);
  }

  function getFunctionEffectiveReturnType(type: FunctionType, args?: ValidateArgTypeParams[], inferTypeIfNeeded = true) {
    const specializedReturnType = FunctionType.getSpecializedReturnType(type);
    if (specializedReturnType) {
      return specializedReturnType;
    }

    if (inferTypeIfNeeded) {
      return getFunctionInferredReturnType(type, args);
    }

    return UnknownType.create();
  }

  const getFunctionInferredReturnType = evaluatorOptions.logCalls
    ? (t: FunctionType, a?: ValidateArgTypeParams[]) => logInternalCall('getFunctionInferredReturnType', () => getFunctionInferredReturnTypeInternal(t, a), t)
    : getFunctionInferredReturnTypeInternal;

  function getFunctionInferredReturnTypeInternal(type: FunctionType, args?: ValidateArgTypeParams[]) {
    let returnType: Type | undefined;

    if (FunctionType.isStubDefinition(type) || FunctionType.isPyTypedDefinition(type)) {
      return UnknownType.create();
    }

    if (type.inferredReturnType) {
      returnType = type.inferredReturnType;
    } else {
      if (type.details.declaration) {
        const functionNode = type.details.declaration.node;

        disableSpeculativeMode(() => {
          returnType = inferFunctionReturnType(functionNode, FunctionType.isAbstractMethod(type));
        });

        if (returnType && FunctionType.isWrapReturnTypeInAwait(type)) {
          returnType = createAwaitableReturnType(functionNode, returnType);
        }
      }

      if (!returnType) {
        returnType = UnknownType.create();
      }

      type.inferredReturnType = returnType;
    }

    if (isPartlyUnknown(returnType) && FunctionType.hasUnannotatedParams(type) && !FunctionType.isStubDefinition(type) && !FunctionType.isPyTypedDefinition(type) && args) {
      const contextualReturnType = getFunctionInferredReturnTypeUsingArguments(type, args);
      if (contextualReturnType) {
        returnType = removeNoReturnFromUnion(contextualReturnType);
      }
    }

    return returnType;
  }

  function getFunctionInferredReturnTypeUsingArguments(type: FunctionType, args: ValidateArgTypeParams[]): Type | undefined {
    let contextualReturnType: Type | undefined;

    if (!type.details.declaration) {
      return undefined;
    }
    const functionNode = type.details.declaration.node;

    if (args.some((arg) => !arg.paramName)) {
      return undefined;
    }

    if (returnTypeInferenceContextStack.some((context) => context.functionNode === functionNode)) {
      return undefined;
    }

    const functionType = getTypeOfFunction(functionNode);
    if (!functionType) {
      return undefined;
    }

    if (args.length > maxReturnTypeInferenceArgumentCount) {
      return undefined;
    }

    if (returnTypeInferenceContextStack.length >= maxReturnTypeInferenceStackSize) {
      return undefined;
    }

    suppressDiags(functionNode, () => {
      const prevTypeCache = returnTypeInferenceTypeCache;
      returnTypeInferenceContextStack.push({
        functionNode,
        codeFlowAnalyzer: createCodeFlowAnalyzer(),
      });

      try {
        returnTypeInferenceTypeCache = new Map<number, CachedType>();

        let allArgTypesAreUnknown = true;
        functionNode.parameters.forEach((param, index) => {
          if (param.name) {
            let paramType: Type | undefined;
            const arg = args.find((arg) => param.name!.value === arg.paramName);
            if (arg && arg.argument.valueExpression) {
              paramType = getTypeOfExpression(arg.argument.valueExpression).type;
              if (!isUnknown(paramType)) {
                allArgTypesAreUnknown = false;
              }
            } else if (param.defaultValue) {
              paramType = getTypeOfExpression(param.defaultValue).type;
              if (!isUnknown(paramType)) {
                allArgTypesAreUnknown = false;
              }
            } else if (index === 0) {
              if (FunctionType.isInstanceMethod(functionType.functionType) || FunctionType.isClassMethod(functionType.functionType)) {
                if (functionType.functionType.details.parameters.length > 0) {
                  if (functionNode.parameters[0].name) {
                    paramType = functionType.functionType.details.parameters[0].type;
                  }
                }
              }
            }

            if (!paramType) {
              paramType = UnknownType.create();
            }

            writeTypeCache(param.name, paramType, /* isIncomplete */ false);
          }
        });

        if (!allArgTypesAreUnknown) {
          contextualReturnType = inferFunctionReturnType(functionNode, FunctionType.isAbstractMethod(type));
        }
      } finally {
        returnTypeInferenceContextStack.pop();
        returnTypeInferenceTypeCache = prevTypeCache;
      }
    });

    if (contextualReturnType) {
      contextualReturnType = removeUnbound(contextualReturnType);

      if (FunctionType.isWrapReturnTypeInAwait(type) && !isNoReturnType(contextualReturnType)) {
        contextualReturnType = createAwaitableReturnType(functionNode, contextualReturnType);
      }

      return contextualReturnType;
    }

    return undefined;
  }

  function getFunctionDeclaredReturnType(node: FunctionNode): Type | undefined {
    const functionTypeInfo = getTypeOfFunction(node)!;
    if (!functionTypeInfo) {
      return AnyType.create();
    }

    if (FunctionType.isAbstractMethod(functionTypeInfo.functionType)) {
      return AnyType.create();
    }

    if (FunctionType.isGenerator(functionTypeInfo.functionType)) {
      return getDeclaredGeneratorReturnType(functionTypeInfo.functionType);
    }

    return functionTypeInfo.functionType.details.declaredReturnType;
  }

  function getTypeOfMember(member: ClassMember): Type {
    if (isClass(member.classType)) {
      return partiallySpecializeType(getEffectiveTypeOfSymbol(member.symbol), member.classType);
    }
    return UnknownType.create();
  }

  function getTypeOfMemberInternal(node: ParseNode, member: ClassMember): TypeResult | undefined {
    if (isClass(member.classType)) {
      const typeResult = getEffectiveTypeOfSymbolForUsage(member.symbol);
      if (typeResult) {
        return {
          node,
          type: partiallySpecializeType(typeResult.type, member.classType),
          isIncomplete: !!typeResult.isIncomplete,
        };
      }
    }
    return undefined;
  }

  function canAssignClassToProtocol(
    destType: ClassType,
    srcType: ClassType,
    diag: DiagAddendum,
    typeVarMap: TypeVarMap | undefined,
    flags: CanAssignFlags,
    allowMetaclassForProtocols: boolean,
    recursionCount: number
  ): boolean {
    if (recursionCount > maxTypeRecursionCount) {
      return true;
    }

    const destClassFields = destType.details.fields;

    if (ClassType.isSameGenericClass(srcType, destType)) {
      if (isTypeSame(srcType, destType)) {
        return true;
      }

      return verifyTypeArgumentsAssignable(destType, srcType, diag, typeVarMap, flags, recursionCount + 1);
    }

    const genericDestType = ClassType.cloneForSpecialization(destType, undefined, /* isTypeArgumentExplicit */ false);
    const genericDestTypeVarMap = new TypeVarMap(getTypeVarScopeId(destType));

    let typesAreConsistent = true;
    const srcClassTypeVarMap = buildTypeVarMapFromSpecializedClass(srcType);

    destClassFields.forEach((symbol, name) => {
      if (symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
        let isMemberFromMetaclass = false;
        let memberInfo: ClassMember | undefined;

        if (allowMetaclassForProtocols && srcType.details.effectiveMetaclass && isClass(srcType.details.effectiveMetaclass)) {
          memberInfo = lookUpClassMember(srcType.details.effectiveMetaclass, name);
          srcClassTypeVarMap.addSolveForScope(getTypeVarScopeId(srcType.details.effectiveMetaclass));
          isMemberFromMetaclass = true;
        }

        if (!memberInfo) {
          memberInfo = lookUpClassMember(srcType, name);
        }

        if (!memberInfo) {
          diag.addMessage(Localizer.DiagAddendum.protocolMemberMissing().format({ name }));
          typesAreConsistent = false;
        } else {
          let destMemberType = getDeclaredTypeOfSymbol(symbol);
          if (destMemberType) {
            let srcMemberType = getTypeOfMember(memberInfo);

            if (isFunction(srcMemberType) || isOverloadedFunction(srcMemberType)) {
              if (isMemberFromMetaclass) {
                const boundSrcFunction = bindFunctionToClassOrObject(
                  srcType,
                  srcMemberType,
                  /* memberClass */ undefined,
                  /* errorNode */ undefined,
                  recursionCount + 1,
                  /* treatConstructorAsClassMember */ false,
                  srcType
                );
                if (boundSrcFunction) {
                  srcMemberType = boundSrcFunction;
                }

                if (isFunction(destMemberType) || isOverloadedFunction(destMemberType)) {
                  const boundDeclaredType = bindFunctionToClassOrObject(
                    srcType,
                    destMemberType,
                    /* memberClass */ undefined,
                    /* errorNode */ undefined,
                    recursionCount + 1,
                    /* treatConstructorAsClassMember */ false,
                    srcType
                  );
                  if (boundDeclaredType) {
                    destMemberType = boundDeclaredType;
                  }
                }
              } else if (isClass(memberInfo.classType)) {
                const boundSrcFunction = bindFunctionToClassOrObject(ObjectType.create(srcType), srcMemberType, memberInfo.classType);
                if (boundSrcFunction) {
                  srcMemberType = boundSrcFunction;
                }

                if (isFunction(destMemberType) || isOverloadedFunction(destMemberType)) {
                  const boundDeclaredType = bindFunctionToClassOrObject(ObjectType.create(srcType), destMemberType, memberInfo.classType, /* errorNode */ undefined, recursionCount + 1);
                  if (boundDeclaredType) {
                    destMemberType = boundDeclaredType;
                  }
                }
              }
            }

            const subDiag = diag.createAddendum();

            if (isObject(destMemberType) && ClassType.isPropertyClass(destMemberType.classType) && isObject(srcMemberType) && ClassType.isPropertyClass(srcMemberType.classType)) {
              if (!canAssignProperty(destMemberType.classType, srcMemberType.classType, srcType, subDiag.createAddendum(), genericDestTypeVarMap, recursionCount + 1)) {
                subDiag.addMessage(Localizer.DiagAddendum.memberTypeMismatch().format({ name }));
                typesAreConsistent = false;
              }
            } else if (!canAssignType(destMemberType, srcMemberType, subDiag.createAddendum(), genericDestTypeVarMap, CanAssignFlags.Default, recursionCount + 1)) {
              subDiag.addMessage(Localizer.DiagAddendum.memberTypeMismatch().format({ name }));
              typesAreConsistent = false;
            }
          }

          if (symbol.isClassVar() && !memberInfo.symbol.isClassMember()) {
            diag.addMessage(Localizer.DiagAddendum.protocolMemberClassVar().format({ name }));
            typesAreConsistent = false;
          }
        }
      }
    });

    destType.details.baseClasses.forEach((baseClass) => {
      if (isClass(baseClass) && !ClassType.isBuiltIn(baseClass, 'object') && !ClassType.isBuiltIn(baseClass, 'Protocol')) {
        const specializedBaseClass = specializeForBaseClass(destType, baseClass);
        if (!canAssignClassToProtocol(specializedBaseClass, srcType, diag.createAddendum(), typeVarMap, flags, allowMetaclassForProtocols, recursionCount + 1)) {
          typesAreConsistent = false;
        }
      }
    });

    if (typesAreConsistent && destType.details.typeParameters.length > 0 && destType.typeArguments) {
      const specializedDestProtocol = applySolvedTypeVars(genericDestType, genericDestTypeVarMap) as ClassType;

      if (!verifyTypeArgumentsAssignable(destType, specializedDestProtocol, diag, typeVarMap, flags, recursionCount)) {
        typesAreConsistent = false;
      }
    }

    return typesAreConsistent;
  }

  function canAssignModuleToProtocol(destType: ClassType, srcType: ModuleType, diag: DiagAddendum, typeVarMap: TypeVarMap | undefined, flags: CanAssignFlags, recursionCount: number): boolean {
    if (recursionCount > maxTypeRecursionCount) {
      return true;
    }

    let typesAreConsistent = true;
    const destClassFields = destType.details.fields;

    const genericDestType = ClassType.cloneForSpecialization(destType, undefined, /* isTypeArgumentExplicit */ false);
    const genericDestTypeVarMap = new TypeVarMap(getTypeVarScopeId(destType));

    destClassFields.forEach((symbol, name) => {
      if (symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
        const memberSymbol = srcType.fields.get(name);

        if (!memberSymbol) {
          diag.addMessage(Localizer.DiagAddendum.protocolMemberMissing().format({ name }));
          typesAreConsistent = false;
        } else {
          let declaredType = getDeclaredTypeOfSymbol(symbol);
          if (declaredType) {
            const srcMemberType = getEffectiveTypeOfSymbol(memberSymbol);

            if (isFunction(srcMemberType) || isOverloadedFunction(srcMemberType)) {
              if (isFunction(declaredType) || isOverloadedFunction(declaredType)) {
                const boundDeclaredType = bindFunctionToClassOrObject(ObjectType.create(destType), declaredType, destType);
                if (boundDeclaredType) {
                  declaredType = boundDeclaredType;
                }
              }
            }

            const subDiag = diag.createAddendum();

            if (!canAssignType(declaredType, srcMemberType, subDiag.createAddendum(), genericDestTypeVarMap, CanAssignFlags.Default, recursionCount + 1)) {
              subDiag.addMessage(Localizer.DiagAddendum.memberTypeMismatch().format({ name }));
              typesAreConsistent = false;
            }
          }
        }
      }
    });

    destType.details.baseClasses.forEach((baseClass) => {
      if (isClass(baseClass) && !ClassType.isBuiltIn(baseClass, 'object') && !ClassType.isBuiltIn(baseClass, 'Protocol')) {
        const specializedBaseClass = specializeForBaseClass(destType, baseClass);
        if (!canAssignModuleToProtocol(specializedBaseClass, srcType, diag.createAddendum(), typeVarMap, flags, recursionCount + 1)) {
          typesAreConsistent = false;
        }
      }
    });

    if (typesAreConsistent && destType.details.typeParameters.length > 0 && destType.typeArguments) {
      const specializedSrcProtocol = applySolvedTypeVars(genericDestType, genericDestTypeVarMap) as ClassType;

      if (!verifyTypeArgumentsAssignable(destType, specializedSrcProtocol, diag, typeVarMap, flags, recursionCount)) {
        typesAreConsistent = false;
      }
    }

    return typesAreConsistent;
  }

  function canAssignProperty(destPropertyType: ClassType, srcPropertyType: ClassType, srcClass: ClassType, diag: DiagAddendum, typeVarMap?: TypeVarMap, recursionCount = 0): boolean {
    const objectToBind = ObjectType.create(srcClass);
    let isAssignable = true;
    const accessors: { name: string; missingDiagMsg: () => string; incompatibleDiagMsg: () => string }[] = [
      {
        name: 'fget',
        missingDiagMsg: Localizer.DiagAddendum.missingGetter,
        incompatibleDiagMsg: Localizer.DiagAddendum.incompatibleGetter,
      },
      {
        name: 'fset',
        missingDiagMsg: Localizer.DiagAddendum.missingSetter,
        incompatibleDiagMsg: Localizer.DiagAddendum.incompatibleSetter,
      },
      {
        name: 'fdel',
        missingDiagMsg: Localizer.DiagAddendum.missingDeleter,
        incompatibleDiagMsg: Localizer.DiagAddendum.incompatibleDeleter,
      },
    ];

    accessors.forEach((accessorInfo) => {
      const destAccessSymbol = destPropertyType.details.fields.get(accessorInfo.name);
      const destAccessType = destAccessSymbol ? getDeclaredTypeOfSymbol(destAccessSymbol) : undefined;

      if (destAccessType && isFunction(destAccessType)) {
        const srcAccessSymbol = srcPropertyType.details.fields.get(accessorInfo.name);
        const srcAccessType = srcAccessSymbol ? getDeclaredTypeOfSymbol(srcAccessSymbol) : undefined;

        if (!srcAccessType || !isFunction(srcAccessType)) {
          diag.addMessage(accessorInfo.missingDiagMsg());
          isAssignable = false;
          return;
        }

        const boundDestAccessType = bindFunctionToClassOrObject(objectToBind, destAccessType);
        const boundSrcAccessType = bindFunctionToClassOrObject(objectToBind, srcAccessType);

        if (!boundDestAccessType || !boundSrcAccessType || !canAssignType(boundDestAccessType, boundSrcAccessType, diag.createAddendum(), typeVarMap, CanAssignFlags.Default, recursionCount + 1)) {
          diag.addMessage('getter type is incompatible');
          isAssignable = false;
          return;
        }
      }
    });

    return isAssignable;
  }

  function canAssignProtocolClassToSelf(destType: ClassType, srcType: ClassType, recursionCount = 1): boolean {
    assert(ClassType.isProtocolClass(destType));
    assert(ClassType.isProtocolClass(srcType));
    assert(ClassType.isSameGenericClass(destType, srcType));
    assert(destType.details.typeParameters.length > 0);

    const diag = new DiagAddendum();
    const typeVarMap = new TypeVarMap();
    let isAssignable = true;

    destType.details.fields.forEach((symbol, name) => {
      if (isAssignable && symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
        const memberInfo = lookUpClassMember(srcType, name);
        assert(memberInfo !== undefined);

        let destMemberType = getDeclaredTypeOfSymbol(symbol);
        if (destMemberType) {
          const srcMemberType = getTypeOfMember(memberInfo!);
          destMemberType = partiallySpecializeType(destMemberType, destType);

          if (isObject(destMemberType) && ClassType.isPropertyClass(destMemberType.classType) && isObject(srcMemberType) && ClassType.isPropertyClass(srcMemberType.classType)) {
            if (!canAssignProperty(destMemberType.classType, srcMemberType.classType, srcType, diag, typeVarMap, recursionCount + 1)) {
              isAssignable = false;
            }
          } else if (!canAssignType(destMemberType, srcMemberType, diag, typeVarMap, CanAssignFlags.Default, recursionCount + 1)) {
            isAssignable = false;
          }
        }
      }
    });

    destType.details.baseClasses.forEach((baseClass) => {
      if (isClass(baseClass) && !ClassType.isBuiltIn(baseClass, 'object') && !ClassType.isBuiltIn(baseClass, 'Protocol')) {
        const specializedDestBaseClass = specializeForBaseClass(destType, baseClass);
        const specializedSrcBaseClass = specializeForBaseClass(srcType, baseClass);
        if (!canAssignProtocolClassToSelf(specializedDestBaseClass, specializedSrcBaseClass, recursionCount + 1)) {
          isAssignable = false;
        }
      }
    });

    return isAssignable;
  }

  function canAssignTypedDict(destType: ClassType, srcType: ClassType, diag: DiagAddendum, recursionCount: number) {
    let typesAreConsistent = true;
    const destEntries = getTypedDictMembersForClass(destType);
    const srcEntries = getTypedDictMembersForClass(srcType, /* allowNarrowed */ true);

    destEntries.forEach((destEntry, name) => {
      const srcEntry = srcEntries.get(name);
      if (!srcEntry) {
        diag.addMessage(Localizer.DiagAddendum.typedDictFieldMissing().format({ name, type: printType(srcType) }));
        typesAreConsistent = false;
      } else {
        if (destEntry.isRequired && !srcEntry.isRequired) {
          diag.addMessage(
            Localizer.DiagAddendum.typedDictFieldRequired().format({
              name,
              type: printType(destType),
            })
          );
          typesAreConsistent = false;
        } else if (!destEntry.isRequired && srcEntry.isRequired) {
          diag.addMessage(
            Localizer.DiagAddendum.typedDictFieldNotRequired().format({
              name,
              type: printType(destType),
            })
          );
          typesAreConsistent = false;
        }

        if (!isTypeSame(destEntry.valueType, srcEntry.valueType, recursionCount + 1)) {
          diag.addMessage(Localizer.DiagAddendum.memberTypeMismatch().format({ name }));
          typesAreConsistent = false;
        }
      }
    });

    return typesAreConsistent;
  }

  function canAssignClass(
    destType: ClassType,
    srcType: ClassType,
    diag: DiagAddendum,
    typeVarMap: TypeVarMap | undefined,
    flags: CanAssignFlags,
    recursionCount: number,
    reportErrorsUsingObjType: boolean,
    allowMetaclassForProtocols = false
  ): boolean {
    if (ClassType.isTypedDictClass(destType) && ClassType.isTypedDictClass(srcType)) {
      return canAssignTypedDict(destType, srcType, diag, recursionCount);
    }

    const promotionList = typePromotions[destType.details.fullName];
    if (promotionList && promotionList.some((srcName) => srcName === srcType.details.fullName)) {
      if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
        return true;
      }
    }

    const inheritanceChain: InheritanceChain = [];
    const isDerivedFrom = ClassType.isDerivedFrom(srcType, destType, inheritanceChain);

    if (ClassType.isProtocolClass(destType) && (!isDerivedFrom || allowMetaclassForProtocols)) {
      return canAssignClassToProtocol(destType, srcType, diag, typeVarMap, flags, allowMetaclassForProtocols, recursionCount + 1);
    }

    if ((flags & CanAssignFlags.EnforceInvariance) === 0 || ClassType.isSameGenericClass(srcType, destType)) {
      if (isDerivedFrom) {
        assert(inheritanceChain.length > 0);

        return canAssignClassWithTypeArgs(destType, srcType, inheritanceChain, diag, typeVarMap, flags, recursionCount + 1);
      }
    }

    if (ClassType.isBuiltIn(destType, 'object')) {
      if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
        return true;
      }
    }

    const destErrorType = reportErrorsUsingObjType ? ObjectType.create(destType) : destType;
    const srcErrorType = reportErrorsUsingObjType ? ObjectType.create(srcType) : srcType;
    diag.addMessage(
      Localizer.DiagAddendum.typeIncompatible().format({
        sourceType: printType(srcErrorType),
        destType: printType(destErrorType),
      })
    );
    return false;
  }

  function canAssignClassWithTypeArgs(
    destType: ClassType,
    srcType: ClassType,
    inheritanceChain: InheritanceChain,
    diag: DiagAddendum,
    typeVarMap: TypeVarMap | undefined,
    flags: CanAssignFlags,
    recursionCount: number
  ): boolean {
    let curSrcType = srcType;
    let curTypeVarMap = typeVarMap || new TypeVarMap(getTypeVarScopeId(destType));
    let effectiveFlags = flags;

    if (!typeVarMap) {
      effectiveFlags &= ~CanAssignFlags.SkipSolveTypeVars;
    }

    for (let ancestorIndex = inheritanceChain.length - 1; ancestorIndex >= 0; ancestorIndex--) {
      const ancestorType = inheritanceChain[ancestorIndex];

      if (isUnknown(ancestorType)) {
        return true;
      }

      if (ClassType.isBuiltIn(ancestorType, 'object')) {
        return true;
      }

      if (ancestorIndex < inheritanceChain.length - 1) {
        curSrcType = specializeForBaseClass(curSrcType, ancestorType);
      }

      if (ancestorIndex === 0) {
        if (ClassType.isTupleClass(destType)) {
          if (destType.tupleTypeArguments && curSrcType.tupleTypeArguments) {
            const destTypeArgs = destType.tupleTypeArguments;
            let destArgCount = destTypeArgs.length;

            const isDestHomogenousType = destArgCount === 2 && isEllipsisType(destTypeArgs[1]);
            if (isDestHomogenousType) {
              destArgCount = 1;
            }

            const isDestVariadic = destArgCount > 0 && isVariadicTypeVar(destTypeArgs[destArgCount - 1]);

            const srcTypeArgs = curSrcType.tupleTypeArguments;
            let srcArgCount = srcTypeArgs.length;
            const isSrcHomogeneousType = srcArgCount === 2 && isEllipsisType(srcTypeArgs[1]);
            if (isSrcHomogeneousType) {
              srcArgCount = 1;
            }

            if (isDestVariadic && isSrcHomogeneousType) {
              diag.addMessage(Localizer.DiagAddendum.typeVarTupleRequiresKnownLength());
              return false;
            }

            if ((srcTypeArgs.length === destArgCount && !isSrcHomogeneousType) || isDestHomogenousType || isDestVariadic) {
              const maxArgCount = Math.max(destArgCount, srcArgCount);
              for (let argIndex = 0; argIndex < maxArgCount; argIndex++) {
                let srcTypeArgType: Type;
                let destTypeArgType: Type;
                let isSourceTypeMissing = false;

                if (isSrcHomogeneousType) {
                  srcTypeArgType = srcTypeArgs[0];
                } else if (argIndex < srcTypeArgs.length) {
                  srcTypeArgType = srcTypeArgs[argIndex];
                } else {
                  srcTypeArgType = AnyType.create();
                  if (destType.isTypeArgumentExplicit) {
                    if (isDestVariadic && argIndex < destArgCount - 1 && !isDestHomogenousType) {
                      isSourceTypeMissing = true;
                    }
                  }
                }

                let movePastSourceArgs = false;
                if (isDestVariadic && argIndex >= destArgCount - 1) {
                  destTypeArgType = destTypeArgs[destArgCount - 1];
                  if (tupleClassType && isClass(tupleClassType)) {
                    const remainingSrcTypeArgs = srcTypeArgs.slice(argIndex);
                    srcTypeArgType = convertToInstance(
                      specializeTupleClass(
                        tupleClassType,
                        remainingSrcTypeArgs.map((type) => stripLiteralValue(type)),
                        /* isTypeArgumentExplicit */ true,
                        /* stripLiterals */ true,
                        /* isForUnpackedVariadicTypeVar */ true
                      )
                    );
                    movePastSourceArgs = true;
                  }
                } else if (isDestHomogenousType) {
                  destTypeArgType = destTypeArgs[0];
                } else {
                  destTypeArgType = argIndex < destTypeArgs.length ? destTypeArgs[argIndex] : AnyType.create();
                }

                const entryDiag = diag.createAddendum();

                if (isSourceTypeMissing || !canAssignType(destTypeArgType, srcTypeArgType, entryDiag.createAddendum(), curTypeVarMap, effectiveFlags, recursionCount + 1)) {
                  entryDiag.addMessage(
                    Localizer.DiagAddendum.tupleEntryTypeMismatch().format({
                      entry: argIndex + 1,
                    })
                  );
                  return false;
                }

                if (movePastSourceArgs) {
                  argIndex = srcArgCount;
                }
              }
            } else {
              if (isSrcHomogeneousType) {
                diag.addMessage(
                  Localizer.DiagAddendum.tupleSizeMismatchIndeterminate().format({
                    expected: destArgCount,
                  })
                );
              } else {
                diag.addMessage(
                  Localizer.DiagAddendum.tupleSizeMismatch().format({
                    expected: destArgCount,
                    received: srcTypeArgs.length,
                  })
                );
              }
              return false;
            }
          }

          return true;
        }
      }

      const ancestorTypeParams = ClassType.getTypeParameters(ancestorType);
      if (ancestorTypeParams.length === 0) {
        continue;
      }

      if (!ancestorType.typeArguments) {
        return true;
      }

      if (!verifyTypeArgumentsAssignable(ancestorType, curSrcType, diag, curTypeVarMap, effectiveFlags, recursionCount)) {
        return false;
      }

      curTypeVarMap = new TypeVarMap(getTypeVarScopeId(ancestorType));
      effectiveFlags &= ~CanAssignFlags.SkipSolveTypeVars;
    }

    if (destType.typeArguments) {
      if (!verifyTypeArgumentsAssignable(destType, curSrcType, diag, typeVarMap, flags, recursionCount)) {
        return false;
      }
    } else if (typeVarMap && destType.details.typeParameters.length > 0 && curSrcType.typeArguments && !typeVarMap.isLocked()) {
      const srcTypeArgs = curSrcType.typeArguments;
      for (let i = 0; i < destType.details.typeParameters.length; i++) {
        const typeArgType = i < srcTypeArgs.length ? srcTypeArgs[i] : UnknownType.create();
        typeVarMap.setTypeVarType(destType.details.typeParameters[i], undefined, typeArgType);
      }

      if (ClassType.isTupleClass(curSrcType) && curSrcType.tupleTypeArguments && destType.details.typeParameters.length >= 1) {
        typeVarMap.setVariadicTypeVar(destType.details.typeParameters[0], curSrcType.tupleTypeArguments);
      }
    }

    return true;
  }

  function getGetterTypeFromProperty(propertyClass: ClassType, inferTypeIfNeeded: boolean): Type | undefined {
    if (!ClassType.isPropertyClass(propertyClass)) {
      return undefined;
    }

    const fgetSymbol = propertyClass.details.fields.get('fget');

    if (fgetSymbol) {
      const fgetType = getDeclaredTypeOfSymbol(fgetSymbol);
      if (fgetType && isFunction(fgetType)) {
        return getFunctionEffectiveReturnType(fgetType, /* args */ undefined, inferTypeIfNeeded);
      }
    }

    return undefined;
  }

  function verifyTypeArgumentsAssignable(destType: ClassType, srcType: ClassType, diag: DiagAddendum, typeVarMap: TypeVarMap | undefined, flags: CanAssignFlags, recursionCount: number) {
    assert(ClassType.isSameGenericClass(destType, srcType));

    const destTypeParams = ClassType.getTypeParameters(destType);
    let destTypeArgs: Type[];
    let srcTypeArgs: Type[] | undefined;

    if (!destType.typeArguments || !srcType.typeArguments) {
      return true;
    }

    if (ClassType.isTupleClass(destType)) {
      destTypeArgs = destType.tupleTypeArguments || [];
      srcTypeArgs = srcType.tupleTypeArguments;
    } else {
      destTypeArgs = destType.typeArguments!;
      srcTypeArgs = srcType.typeArguments;
    }

    if (srcTypeArgs && srcType.isTypeArgumentExplicit) {
      for (let srcArgIndex = 0; srcArgIndex < srcTypeArgs.length; srcArgIndex++) {
        const srcTypeArg = srcTypeArgs[srcArgIndex];

        const destArgIndex = srcArgIndex >= destTypeArgs.length ? destTypeArgs.length - 1 : srcArgIndex;
        const destTypeArg = destArgIndex >= 0 ? destTypeArgs[destArgIndex] : UnknownType.create();
        const destTypeParam = destArgIndex < destTypeParams.length ? destTypeParams[destArgIndex] : undefined;
        const assignmentDiag = new DiagAddendum();

        if (!destTypeParam || destTypeParam.details.variance === Variance.Covariant) {
          if (!canAssignType(destTypeArg, srcTypeArg, assignmentDiag, typeVarMap, flags, recursionCount + 1)) {
            if (destTypeParam) {
              const childDiag = diag.createAddendum();
              childDiag.addMessage(
                Localizer.DiagAddendum.typeVarIsCovariant().format({
                  name: TypeVarType.getReadableName(destTypeParam),
                })
              );
              childDiag.addAddendum(assignmentDiag);
            }
            return false;
          }
        } else if (destTypeParam.details.variance === Variance.Contravariant) {
          if (!canAssignType(srcTypeArg, destTypeArg, assignmentDiag, typeVarMap, flags ^ CanAssignFlags.ReverseTypeVarMatching, recursionCount + 1)) {
            const childDiag = diag.createAddendum();
            childDiag.addMessage(
              Localizer.DiagAddendum.typeVarIsContravariant().format({
                name: TypeVarType.getReadableName(destTypeParam),
              })
            );
            childDiag.addAddendum(assignmentDiag);
            return false;
          }
        } else {
          if (!canAssignType(destTypeArg, srcTypeArg, assignmentDiag, typeVarMap, flags | CanAssignFlags.EnforceInvariance, recursionCount + 1)) {
            const childDiag = diag.createAddendum();
            childDiag.addMessage(
              Localizer.DiagAddendum.typeVarIsInvariant().format({
                name: TypeVarType.getReadableName(destTypeParam),
              })
            );
            childDiag.addAddendum(assignmentDiag);
            return false;
          }
        }
      }
    }

    return true;
  }

  function canAssignTypeToTypeVar(destType: TypeVarType, srcType: Type, diag: DiagAddendum, typeVarMap: TypeVarMap, flags = CanAssignFlags.Default, recursionCount = 0): boolean {
    let isTypeVarInScope = true;
    const isContravariant = (flags & CanAssignFlags.ReverseTypeVarMatching) !== 0;

    if (!destType.scopeId) {
      return true;
    }

    if (!typeVarMap.hasSolveForScope(destType.scopeId)) {
      if (isAnyOrUnknown(srcType)) {
        return true;
      }

      isTypeVarInScope = false;
      if (!destType.details.isSynthesized) {
        diag.addMessage(
          Localizer.DiagAddendum.typeAssignmentMismatch().format({
            sourceType: printType(srcType),
            destType: printType(destType),
          })
        );
        return false;
      }
    }

    if (destType.details.isParamSpec) {
      diag.addMessage(
        Localizer.DiagAddendum.typeParamSpec().format({
          type: printType(srcType),
          name: destType.details.name,
        })
      );
      return false;
    }

    if (destType.details.isVariadic) {
      const isVariadicTuple = isObject(srcType) && isTupleClass(srcType.classType) && !!srcType.classType.isTupleForUnpackedVariadicTypeVar;

      if (!isVariadicTypeVar(srcType) && !isVariadicTuple) {
        if (tupleClassType && isClass(tupleClassType)) {
          srcType = convertToInstance(specializeTupleClass(tupleClassType, [srcType], /* isTypeArgumentExplicit */ true, /* stripLiterals */ true, /* isForUnpackedVariadicTypeVar */ true));
        } else {
          srcType = UnknownType.create();
        }
      }
    }

    const curEntry = typeVarMap.getTypeVar(destType);
    const curNarrowTypeBound = curEntry?.narrowBound;
    const curWideTypeBound = curEntry?.wideBound;

    if (destType.details.constraints.length > 0) {
      let constrainedType: Type | undefined;
      const concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);

      if (isTypeVar(srcType)) {
        if (canAssignType(destType, concreteSrcType, new DiagAddendum(), new TypeVarMap(destType.scopeId))) {
          constrainedType = srcType;
        }
      } else {
        let isCompatible = true;

        constrainedType = mapSubtypes(concreteSrcType, (srcSubtype) => {
          let constrainedSubtype: Type | undefined;

          if (isAnyOrUnknown(srcSubtype)) {
            return srcSubtype;
          }

          destType.details.constraints.forEach((t) => {
            if (canAssignType(t, srcSubtype, new DiagAddendum())) {
              if (!constrainedSubtype || canAssignType(constrainedSubtype, t, new DiagAddendum())) {
                constrainedSubtype = t;
              }
            }
          });

          if (!constrainedSubtype) {
            if (!isContravariant) {
              isCompatible = false;
            }
          }

          return constrainedSubtype;
        });

        if (isNever(constrainedType) || !isCompatible) {
          constrainedType = undefined;
        }
      }

      if (!constrainedType || (isUnion(constrainedType) && !constrainedType.constraints)) {
        diag.addMessage(
          Localizer.DiagAddendum.typeConstrainedTypeVar().format({
            type: printType(srcType),
            name: destType.details.name,
          })
        );
        return false;
      }

      if (curNarrowTypeBound && !isAnyOrUnknown(curNarrowTypeBound)) {
        if (!canAssignType(curNarrowTypeBound, constrainedType, new DiagAddendum())) {
          if (canAssignType(constrainedType, curNarrowTypeBound, new DiagAddendum())) {
            if (!typeVarMap.isLocked() && isTypeVarInScope) {
              typeVarMap.setTypeVarType(destType, constrainedType);
            }
          } else {
            diag.addMessage(
              Localizer.DiagAddendum.typeConstrainedTypeVar().format({
                type: printType(constrainedType),
                name: printType(curNarrowTypeBound),
              })
            );
            return false;
          }
        }
      } else {
        if (!typeVarMap.isLocked() && isTypeVarInScope) {
          typeVarMap.setTypeVarType(destType, constrainedType);
        }
      }

      return true;
    }

    let newNarrowTypeBound = curNarrowTypeBound;
    let newWideTypeBound = curWideTypeBound;
    const diagAddendum = new DiagAddendum();

    const retainLiterals =
      (flags & CanAssignFlags.RetainLiteralsForTypeVar) !== 0 ||
      typeVarMap.getRetainLiterals(destType) ||
      (destType.details.boundType && containsLiteralType(destType.details.boundType)) ||
      destType.details.constraints.some((t) => containsLiteralType(t));
    const adjSrcType = retainLiterals ? srcType : stripLiteralValue(srcType);

    if (isContravariant || (flags & CanAssignFlags.AllowTypeVarNarrowing) !== 0) {
      if (!curWideTypeBound) {
        newWideTypeBound = adjSrcType;
      } else if (!isTypeSame(curWideTypeBound, adjSrcType)) {
        if (canAssignType(curWideTypeBound, adjSrcType, diagAddendum)) {
          newWideTypeBound = srcType;
        } else if (!canAssignType(adjSrcType, curWideTypeBound, diagAddendum)) {
          diag.addMessage(
            Localizer.DiagAddendum.typeAssignmentMismatch().format({
              sourceType: printType(adjSrcType),
              destType: printType(curWideTypeBound),
            })
          );
          diag.addAddendum(diagAddendum);
          return false;
        }
      }

      if (curNarrowTypeBound) {
        if (!canAssignType(newWideTypeBound!, curNarrowTypeBound, new DiagAddendum())) {
          diag.addMessage(
            Localizer.DiagAddendum.typeAssignmentMismatch().format({
              sourceType: printType(adjSrcType),
              destType: printType(curNarrowTypeBound),
            })
          );
          diag.addAddendum(diagAddendum);
          return false;
        }
      }
    } else {
      if (!curNarrowTypeBound) {
        newNarrowTypeBound = adjSrcType;
      } else if (!isTypeSame(curNarrowTypeBound, adjSrcType)) {
        if (canAssignType(curNarrowTypeBound, adjSrcType, diagAddendum, typeVarMap, flags, recursionCount + 1)) {
          newNarrowTypeBound = isUnknown(curNarrowTypeBound) ? adjSrcType : curNarrowTypeBound;
        } else {
          if (typeVarMap.isLocked() || isTypeVar(adjSrcType)) {
            diag.addMessage(
              Localizer.DiagAddendum.typeAssignmentMismatch().format({
                sourceType: printType(curNarrowTypeBound),
                destType: printType(adjSrcType),
              })
            );
            return false;
          }

          if (isVariadicTypeVar(destType)) {
            diag.addMessage(
              Localizer.DiagAddendum.typeAssignmentMismatch().format({
                sourceType: printType(curNarrowTypeBound),
                destType: printType(adjSrcType),
              })
            );
            return false;
          }

          if (canAssignType(adjSrcType, curNarrowTypeBound, new DiagAddendum(), typeVarMap, flags, recursionCount + 1)) {
            newNarrowTypeBound = adjSrcType;
          } else {
            newNarrowTypeBound = combineTypes([curNarrowTypeBound, adjSrcType]);
          }
        }
      }

      if (curWideTypeBound) {
        if (!canAssignType(makeTopLevelTypeVarsConcrete(curWideTypeBound), newNarrowTypeBound!, new DiagAddendum(), typeVarMap, flags, recursionCount + 1)) {
          diag.addMessage(
            Localizer.DiagAddendum.typeAssignmentMismatch().format({
              sourceType: printType(curWideTypeBound),
              destType: printType(adjSrcType),
            })
          );
          return false;
        }
      }
    }

    if (destType.details.boundType) {
      const boundType = TypeBase.isInstantiable(destType) ? convertToInstantiable(destType.details.boundType) : destType.details.boundType;
      const updatedType = (newNarrowTypeBound || newWideTypeBound)!;
      const adjustedUpdatedType = isTypeVar(srcType) && TypeBase.isInstantiable(srcType) ? convertToInstantiable(updatedType) : updatedType;
      if (!canAssignType(boundType, adjustedUpdatedType, diag.createAddendum(), typeVarMap, CanAssignFlags.Default, recursionCount + 1)) {
        if (!destType.details.isSynthesized) {
          diag.addMessage(
            Localizer.DiagAddendum.typeBound().format({
              sourceType: printType(adjustedUpdatedType),
              destType: printType(boundType),
              name: TypeVarType.getReadableName(destType),
            })
          );
        }
        return false;
      }
    }

    if (!typeVarMap.isLocked() && isTypeVarInScope) {
      typeVarMap.setTypeVarType(destType, newNarrowTypeBound, newWideTypeBound, retainLiterals);
    }

    return true;
  }

  function canAssignType(destType: Type, srcType: Type, diag: DiagAddendum, typeVarMap?: TypeVarMap, flags = CanAssignFlags.Default, recursionCount = 0): boolean {
    destType = transformPossibleRecursiveTypeAlias(destType);
    srcType = transformPossibleRecursiveTypeAlias(srcType);

    if (isUnion(destType) && destType.subtypes.length === 1 && isVariadicTypeVar(destType.subtypes[0])) {
      destType = destType.subtypes[0];
    }

    if (isUnion(srcType) && srcType.subtypes.length === 1 && isVariadicTypeVar(srcType.subtypes[0])) {
      srcType = srcType.subtypes[0];
    }

    if (recursionCount > maxTypeRecursionCount) {
      return true;
    }

    if (destType === srcType) {
      return true;
    }

    if (isUnbound(destType) || isUnbound(srcType)) {
      return true;
    }

    const originalFlags = flags;
    flags &= ~(CanAssignFlags.AllowBoolTypeGuard | CanAssignFlags.AllowTypeVarNarrowing);

    if (isTypeVar(destType)) {
      if (isTypeSame(destType, srcType)) {
        return true;
      }

      const destTypeVar = destType;
      if (destTypeVar.details.constraints.length > 0) {
        if (
          findSubtype(srcType, (srcSubtype, constraints) => {
            if (isTypeSame(destTypeVar, srcSubtype)) {
              return false;
            }

            if (constraints?.find((constraint) => constraint.typeVarName === TypeVarType.getNameWithScope(destTypeVar))) {
              if (
                destTypeVar.details.constraints.some((constraintType) => {
                  return canAssignType(constraintType, srcSubtype, new DiagAddendum());
                })
              ) {
                return false;
              }
            }

            return true;
          }) === undefined
        ) {
          return true;
        }
      }

      if (isVariadicTypeVar(destTypeVar) && isObject(srcType) && isTupleClass(srcType.classType) && srcType.classType.tupleTypeArguments && srcType.classType.tupleTypeArguments.length === 1) {
        if (isTypeSame(destTypeVar, srcType.classType.tupleTypeArguments[0])) {
          return true;
        }
      }

      if ((flags & CanAssignFlags.ReverseTypeVarMatching) === 0) {
        if (flags & CanAssignFlags.SkipSolveTypeVars) {
          return canAssignType(makeTopLevelTypeVarsConcrete(destType), makeTopLevelTypeVarsConcrete(srcType), diag, /* typeVarMap */ undefined, flags, recursionCount + 1);
        } else {
          return canAssignTypeToTypeVar(destType, srcType, diag, typeVarMap || new TypeVarMap(), originalFlags, recursionCount + 1);
        }
      }
    }

    if (isAnyOrUnknown(destType)) {
      return true;
    }

    if (isAnyOrUnknown(srcType)) {
      if (typeVarMap) {
        const typeVarSubstitution = isEllipsisType(srcType) ? AnyType.create() : srcType;
        setTypeArgumentsRecursive(destType, typeVarSubstitution, typeVarMap);
      }
      if ((flags & CanAssignFlags.DisallowAssignFromAny) === 0) {
        return true;
      }
    }

    if (isNever(srcType)) {
      if (typeVarMap) {
        setTypeArgumentsRecursive(destType, UnknownType.create(), typeVarMap);
      }
      return true;
    }

    if (isTypeVar(srcType)) {
      if ((flags & CanAssignFlags.ReverseTypeVarMatching) !== 0) {
        if ((flags & CanAssignFlags.SkipSolveTypeVars) !== 0) {
          return canAssignType(makeTopLevelTypeVarsConcrete(srcType), makeTopLevelTypeVarsConcrete(destType), diag, /* typeVarMap */ undefined, flags, recursionCount + 1);
        } else {
          return canAssignTypeToTypeVar(srcType, destType, diag, typeVarMap || new TypeVarMap(getTypeVarScopeId(srcType)), originalFlags, recursionCount + 1);
        }
      }
    }

    if (isUnion(srcType)) {
      if (isTypeSame(srcType, destType)) {
        return true;
      }

      let isIncompatible = false;

      doForEachSubtype(srcType, (subtype) => {
        if (!canAssignType(destType, subtype, new DiagAddendum(), typeVarMap, flags, recursionCount + 1)) {
          if (!canAssignType(destType, makeTopLevelTypeVarsConcrete(subtype), diag.createAddendum(), typeVarMap, flags, recursionCount + 1)) {
            isIncompatible = true;
          }
        }
      });

      if (isIncompatible) {
        diag.addMessage(
          Localizer.DiagAddendum.typeAssignmentMismatch().format({
            sourceType: printType(srcType),
            destType: printType(destType),
          })
        );
        return false;
      }

      return true;
    }

    if (isUnion(destType)) {
      if (flags & CanAssignFlags.EnforceInvariance) {
        let isIncompatible = false;

        doForEachSubtype(destType, (subtype, index) => {
          let skipSubtype = false;

          if (!isAnyOrUnknown(subtype)) {
            doForEachSubtype(destType, (otherSubtype, otherIndex) => {
              if (index !== otherIndex && !skipSubtype) {
                if (canAssignType(otherSubtype, subtype, new DiagAddendum(), /* typeVarMap */ undefined, CanAssignFlags.Default, recursionCount + 1)) {
                  skipSubtype = true;
                }
              }
            });
          }

          if (!skipSubtype && !canAssignType(subtype, srcType, diag.createAddendum(), typeVarMap, flags, recursionCount + 1)) {
            isIncompatible = true;
          }
        });

        if (isIncompatible) {
          diag.addMessage(
            Localizer.DiagAddendum.typeAssignmentMismatch().format({
              sourceType: printType(srcType),
              destType: printType(destType),
            })
          );
          return false;
        }

        return true;
      }

      const diagAddendum = new DiagAddendum();

      let foundMatch = false;

      if (isNone(srcType) && isOptionalType(destType)) {
        foundMatch = true;
      } else {
        let bestTypeVarMap: TypeVarMap | undefined;
        let bestTypeVarMapScore: number | undefined;

        doForEachSubtype(destType, (subtype) => {
          const typeVarMapClone = typeVarMap?.clone();
          if (canAssignType(subtype, srcType, diagAddendum, typeVarMapClone, flags, recursionCount + 1)) {
            foundMatch = true;

            if (typeVarMapClone) {
              const typeVarMapScore = typeVarMapClone.getScore();
              if (bestTypeVarMapScore === undefined || bestTypeVarMapScore <= typeVarMapScore) {
                bestTypeVarMapScore = typeVarMapScore;
                bestTypeVarMap = typeVarMapClone;
              }
            }
          }
        });

        if (typeVarMap && bestTypeVarMap) {
          typeVarMap.copyFromClone(bestTypeVarMap);
        }
      }

      if (!foundMatch) {
        if (isTypeVar(srcType) && srcType.details.constraints.length > 0) {
          foundMatch = canAssignType(destType, makeTopLevelTypeVarsConcrete(srcType), diagAddendum, typeVarMap, flags, recursionCount + 1);
        }
      }

      if (!foundMatch) {
        diag.addMessage(
          Localizer.DiagAddendum.typeAssignmentMismatch().format({
            sourceType: printType(srcType),
            destType: printType(destType),
          })
        );
        diag.addAddendum(diagAddendum);
        return false;
      }
      return true;
    }

    if (isNone(destType) && isNone(srcType)) {
      return true;
    }

    if (isObject(srcType) && ClassType.isBuiltIn(srcType.classType, 'type')) {
      const srcTypeArgs = srcType.classType.typeArguments;
      if (srcTypeArgs && srcTypeArgs.length >= 1) {
        if (isAnyOrUnknown(srcTypeArgs[0])) {
          return TypeBase.isInstantiable(destType);
        } else if (isObject(srcTypeArgs[0]) || isTypeVar(srcTypeArgs[0])) {
          if (canAssignType(transformTypeObjectToClass(destType), convertToInstantiable(srcTypeArgs[0]), diag.createAddendum(), typeVarMap, flags, recursionCount + 1)) {
            return true;
          }

          diag.addMessage(
            Localizer.DiagAddendum.typeAssignmentMismatch().format({
              sourceType: printType(srcType),
              destType: printType(destType),
            })
          );
          return false;
        }
      }
    }

    if (isClass(destType)) {
      const concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);
      if (isClass(concreteSrcType)) {
        if (canAssignClass(destType, concreteSrcType, diag, typeVarMap, flags, recursionCount + 1, /* reportErrorsUsingObjType */ false)) {
          return true;
        }

        diag.addMessage(
          Localizer.DiagAddendum.typeAssignmentMismatch().format({
            sourceType: printType(srcType),
            destType: printType(destType),
          })
        );
        return false;
      }
    }

    if (isObject(destType)) {
      const destClassType = destType.classType;

      if (ClassType.isBuiltIn(destClassType, 'Type')) {
        const destTypeArgs = destClassType.typeArguments;
        if (destTypeArgs && destTypeArgs.length >= 1) {
          const convertedSrc = transformTypeObjectToClass(srcType);
          if (TypeBase.isInstance(destTypeArgs[0]) && TypeBase.isInstantiable(convertedSrc)) {
            return canAssignType(destTypeArgs[0], convertToInstance(convertedSrc), diag, typeVarMap, flags, recursionCount + 1);
          }
        }
      } else if (ClassType.isBuiltIn(destClassType, 'type')) {
        if (TypeBase.isInstantiable(srcType)) {
          return true;
        }
      } else if (ClassType.isBuiltIn(destClassType, 'TypeGuard')) {
        if ((originalFlags & CanAssignFlags.AllowBoolTypeGuard) !== 0) {
          if (isObject(srcType) && ClassType.isBuiltIn(srcType.classType, 'bool')) {
            return true;
          }
        }
      }

      const concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);
      if (isObject(concreteSrcType)) {
        if (destType.classType.literalValue !== undefined) {
          const srcLiteral = concreteSrcType.classType.literalValue;
          if (srcLiteral === undefined || !ClassType.isLiteralValueSame(concreteSrcType.classType, destType.classType)) {
            diag.addMessage(
              Localizer.DiagAddendum.literalAssignmentMismatch().format({
                sourceType: printType(srcType),
                destType: printType(destType),
              })
            );

            return false;
          }
        }

        if (!canAssignClass(destClassType, concreteSrcType.classType, diag, typeVarMap, flags, recursionCount + 1, /* reportErrorsUsingObjType */ true)) {
          return false;
        }

        return true;
      } else if (isFunction(concreteSrcType)) {
        const callbackType = getCallbackProtocolType(destType);
        if (callbackType) {
          return canAssignFunction(callbackType, concreteSrcType, diag, typeVarMap || new TypeVarMap(), flags, recursionCount + 1);
        }

        if (objectType && isObject(objectType)) {
          return canAssignType(destType, objectType, diag, typeVarMap, flags, recursionCount + 1);
        }
      } else if (isModule(concreteSrcType)) {
        if (ClassType.isBuiltIn(destClassType, 'ModuleType')) {
          return true;
        }

        if (ClassType.isProtocolClass(destType.classType)) {
          return canAssignModuleToProtocol(destType.classType, concreteSrcType, diag, typeVarMap, flags, recursionCount + 1);
        }
      } else if (isClass(concreteSrcType)) {
        const callbackType = getCallbackProtocolType(destType);
        if (callbackType) {
          return canAssignType(callbackType, concreteSrcType, diag, typeVarMap, flags, recursionCount + 1);
        }

        const metaclass = concreteSrcType.details.effectiveMetaclass;
        if (metaclass) {
          if (isAnyOrUnknown(metaclass)) {
            return true;
          } else {
            return canAssignClass(
              destClassType,
              ClassType.isProtocolClass(destClassType) ? concreteSrcType : metaclass,
              diag,
              typeVarMap,
              flags,
              recursionCount + 1,
              /* reportErrorsUsingObjType */ false,
              /* allowMetaclassForProtocols */ true
            );
          }
        }
      } else if (isAnyOrUnknown(concreteSrcType)) {
        return (flags & CanAssignFlags.DisallowAssignFromAny) === 0;
      }
    }

    if (isFunction(destType)) {
      let srcFunction: FunctionType | undefined;
      let concreteSrcType = makeTopLevelTypeVarsConcrete(srcType);

      if (isObject(concreteSrcType)) {
        const callMember = lookUpObjectMember(concreteSrcType, '__call__');
        if (callMember) {
          const memberType = getTypeOfMember(callMember);
          if (isFunction(memberType) || isOverloadedFunction(memberType)) {
            const boundMethod = bindFunctionToClassOrObject(concreteSrcType, memberType);
            if (boundMethod) {
              concreteSrcType = boundMethod;
            }
          }
        }
      }

      if (isOverloadedFunction(concreteSrcType)) {
        if (destType.details.paramSpec) {
          diag.addMessage(Localizer.DiagAddendum.paramSpecOverload());
          return false;
        }

        const overloads = concreteSrcType.overloads;
        const overloadIndex = overloads.findIndex((overload) => {
          if (!FunctionType.isOverloaded(overload)) {
            return false;
          }
          const typeVarMapClone = typeVarMap ? typeVarMap.clone() : undefined;
          return canAssignType(destType, overload, diag.createAddendum(), typeVarMapClone, flags, recursionCount + 1);
        });

        if (overloadIndex < 0) {
          diag.addMessage(Localizer.DiagAddendum.noOverloadAssignable().format({ type: printType(destType) }));
          return false;
        }
        srcFunction = overloads[overloadIndex];
      } else if (isFunction(concreteSrcType)) {
        srcFunction = concreteSrcType;
      } else if (isClass(concreteSrcType) && concreteSrcType.literalValue === undefined) {
        const constructorFunction = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod);
        constructorFunction.details.declaredReturnType = ObjectType.create(concreteSrcType);

        let constructorInfo = lookUpClassMember(concreteSrcType, '__init__', ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);

        if (!constructorInfo) {
          constructorInfo = lookUpClassMember(concreteSrcType, '__new__', ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);
        }

        const constructorType = constructorInfo ? getTypeOfMember(constructorInfo) : undefined;
        if (constructorType && isFunction(constructorType)) {
          constructorType.details.parameters.forEach((param, index) => {
            if (index > 0) {
              FunctionType.addParameter(constructorFunction, param);
            }
          });
        } else {
          FunctionType.addDefaultParameters(constructorFunction);
        }

        srcFunction = constructorFunction;
      } else if (isAnyOrUnknown(concreteSrcType)) {
        return (flags & CanAssignFlags.DisallowAssignFromAny) === 0;
      }

      if (srcFunction) {
        if (canAssignFunction(destType, srcFunction, diag.createAddendum(), typeVarMap || new TypeVarMap(), flags, recursionCount + 1)) {
          return true;
        }
      }
    }

    if (isOverloadedFunction(destType)) {
      const overloadDiag = diag.createAddendum();

      const isAssignable = !destType.overloads.some((destOverload) => {
        if (!FunctionType.isOverloaded(destOverload)) {
          return false;
        }

        if (typeVarMap) {
          typeVarMap.addSolveForScope(getTypeVarScopeId(destOverload));
        }

        return !canAssignType(destOverload, srcType, overloadDiag.createAddendum(), typeVarMap || new TypeVarMap(getTypeVarScopeId(destOverload)), flags, recursionCount + 1);
      });

      if (!isAssignable) {
        overloadDiag.addMessage(
          Localizer.DiagAddendum.overloadNotAssignable().format({
            name: destType.overloads[0].details.name,
          })
        );
        return false;
      }

      return true;
    }

    if (isObject(destType) && ClassType.isBuiltIn(destType.classType, 'object')) {
      if ((flags & CanAssignFlags.EnforceInvariance) === 0) {
        return true;
      }
    }

    if (isNone(srcType) && isObject(destType) && ClassType.isProtocolClass(destType.classType)) {
      if (noneType && isClass(noneType)) {
        return canAssignClassToProtocol(destType.classType, noneType, diag, typeVarMap, flags, /* allowMetaclassForProtocols */ false, recursionCount);
      }
    }

    if (isNone(destType)) {
      diag.addMessage(Localizer.DiagAddendum.assignToNone());
      return false;
    }

    diag.addMessage(
      Localizer.DiagAddendum.typeAssignmentMismatch().format({
        sourceType: printType(srcType),
        destType: printType(destType),
      })
    );

    return false;
  }

  function getCallbackProtocolType(objType: ObjectType): FunctionType | undefined {
    if (!ClassType.isProtocolClass(objType.classType)) {
      return undefined;
    }

    const callMember = lookUpObjectMember(objType, '__call__');
    if (!callMember) {
      return undefined;
    }

    const memberType = getTypeOfMember(callMember);
    if (isFunction(memberType)) {
      const boundMethod = bindFunctionToClassOrObject(objType, memberType);

      if (boundMethod) {
        return boundMethod as FunctionType;
      }
    }

    return undefined;
  }

  function canAssignFunctionParameter(
    destType: Type,
    srcType: Type,
    paramIndex: number,
    diag: DiagAddendum,
    destTypeVarMap: TypeVarMap,
    srcTypeVarMap: TypeVarMap,
    flags: CanAssignFlags,
    recursionCount: number
  ) {
    if (
      isTypeVar(destType) &&
      destType.details.isSynthesized &&
      destType.details.boundType &&
      isObject(destType.details.boundType) &&
      ClassType.isProtocolClass(destType.details.boundType.classType)
    ) {
      return true;
    }

    canAssignType(srcType, destType, new DiagAddendum(), destTypeVarMap, flags ^ CanAssignFlags.ReverseTypeVarMatching, recursionCount + 1);

    const specializedDestType = applySolvedTypeVars(destType, destTypeVarMap);

    if (!canAssignType(srcType, specializedDestType, diag.createAddendum(), srcTypeVarMap, flags, recursionCount + 1)) {
      diag.addMessage(
        Localizer.DiagAddendum.paramAssignment().format({
          index: paramIndex + 1,
          sourceType: printType(destType),
          destType: printType(srcType),
        })
      );
      return false;
    }

    return true;
  }

  function canAssignFunction(destType: FunctionType, srcType: FunctionType, diag: DiagAddendum, typeVarMap: TypeVarMap, flags: CanAssignFlags, recursionCount: number): boolean {
    let canAssign = true;
    const checkReturnType = (flags & CanAssignFlags.SkipFunctionReturnTypeCheck) === 0;
    flags &= ~CanAssignFlags.SkipFunctionReturnTypeCheck;

    const srcParams = srcType.details.parameters;
    const destParams = destType.details.parameters;

    let srcStartOfNamed = srcParams.findIndex(
      (p, index) =>
        p.category === ParameterCategory.VarArgDictionary || (p.category === ParameterCategory.VarArgList && !p.name) || (index > 0 && srcParams[index - 1].category === ParameterCategory.VarArgList)
    );
    let srcPositionals = srcStartOfNamed < 0 ? srcParams : srcParams.slice(0, srcStartOfNamed);
    const srcArgsIndex = srcPositionals.findIndex((p) => p.category === ParameterCategory.VarArgList && p.name);
    srcPositionals = srcPositionals.filter((p) => p.category === ParameterCategory.Simple && p.name);

    const destStartOfNamed = destParams.findIndex(
      (p, index) =>
        p.category === ParameterCategory.VarArgDictionary || (p.category === ParameterCategory.VarArgList && !p.name) || (index > 0 && destParams[index - 1].category === ParameterCategory.VarArgList)
    );
    let destPositionals = destStartOfNamed < 0 ? destParams : destParams.slice(0, destStartOfNamed);
    const destArgsIndex = destPositionals.findIndex((p) => p.category === ParameterCategory.VarArgList && p.name);

    const destVariadicArgsList = destArgsIndex >= 0 && isVariadicTypeVar(destPositionals[destArgsIndex].type) ? destPositionals[destArgsIndex] : undefined;
    destPositionals = destPositionals.filter((p) => p.category === ParameterCategory.Simple && p.name);

    const destVariadicParamIndex = destPositionals.findIndex((p) => p.category === ParameterCategory.Simple && isVariadicTypeVar(p.type));
    if (destVariadicParamIndex >= 0) {
      const srcPositionalsToPack = srcPositionals.slice(destVariadicParamIndex, destVariadicParamIndex + 1 + srcPositionals.length - destPositionals.length);

      if (srcArgsIndex < 0) {
        const srcTupleTypes: Type[] = srcPositionalsToPack.map((entry) => {
          const srcParamIndex = srcParams.findIndex((p) => p === entry);
          return FunctionType.getEffectiveParameterType(srcType, srcParamIndex);
        });

        if (srcTupleTypes.length !== 1 || !isVariadicTypeVar(srcTupleTypes[0])) {
          let srcPositionalsType: Type;
          if (tupleClassType && isClass(tupleClassType)) {
            srcPositionalsType = convertToInstance(
              specializeTupleClass(tupleClassType, srcTupleTypes, /* isTypeArgumentExplicit */ true, /* stripLiterals */ true, /* isForUnpackedVariadicTypeVar */ true)
            );
          } else {
            srcPositionalsType = UnknownType.create();
          }

          srcPositionals = [
            ...srcPositionals.slice(0, destVariadicParamIndex),
            {
              category: ParameterCategory.Simple,
              name: '_arg_combined',
              isNameSynthesized: true,
              hasDeclaredType: true,
              type: srcPositionalsType,
            },
            ...srcPositionals.slice(destVariadicParamIndex + 1 + srcPositionals.length - destPositionals.length, srcPositionals.length),
          ];
        }
      }
    }

    const positionalsToMatch = Math.min(srcPositionals.length, destPositionals.length);
    const srcTypeVarMap = new TypeVarMap(getTypeVarScopeId(srcType));

    const srcKwargsIndex = srcParams.findIndex((p) => p.category === ParameterCategory.VarArgDictionary && p.name);
    const destKwargsIndex = destParams.findIndex((p) => p.category === ParameterCategory.VarArgDictionary && p.name);

    const srcPositionalOnlyIndex = srcParams.findIndex((p) => p.category === ParameterCategory.Simple && !p.name);
    const destPositionalOnlyIndex = destParams.findIndex((p) => p.category === ParameterCategory.Simple && !p.name);

    if (!FunctionType.shouldSkipParamCompatibilityCheck(destType)) {
      for (let paramIndex = 0; paramIndex < positionalsToMatch; paramIndex++) {
        const srcParamIndex = srcParams.findIndex((p) => p === srcPositionals[paramIndex]);
        const srcParamType = srcParamIndex >= 0 ? FunctionType.getEffectiveParameterType(srcType, srcParamIndex) : srcPositionals[paramIndex].type;
        const destParamIndex = destParams.findIndex((p) => p === destPositionals[paramIndex]);
        const destParamType = FunctionType.getEffectiveParameterType(destType, destParamIndex);

        const destParamName = destPositionals[paramIndex].name;
        const srcParamName = srcPositionals[paramIndex].name || '';
        if (destParamName && !isPrivateOrProtectedName(destParamName) && !isPrivateOrProtectedName(srcParamName)) {
          const isPositionalOnly = srcPositionalOnlyIndex >= 0 && paramIndex < srcPositionalOnlyIndex && destPositionalOnlyIndex >= 0 && paramIndex < destPositionalOnlyIndex;
          if (!isPositionalOnly && destParamName !== srcParamName) {
            diag.createAddendum().addMessage(
              Localizer.DiagAddendum.functionParamName().format({
                srcName: srcParamName,
                destName: destParamName,
              })
            );
            canAssign = false;
          }
        }

        if (
          paramIndex === 0 &&
          srcType.details.name === '__init__' &&
          FunctionType.isInstanceMethod(srcType) &&
          destType.details.name === '__init__' &&
          FunctionType.isInstanceMethod(destType) &&
          FunctionType.isOverloaded(destType) &&
          destPositionals[paramIndex].hasDeclaredType
        ) {
          continue;
        }

        if (!canAssignFunctionParameter(destParamType, srcParamType, paramIndex, diag.createAddendum(), typeVarMap, srcTypeVarMap, flags, recursionCount)) {
          canAssign = false;
        }
      }

      if (destVariadicArgsList) {
        const remainingSrcPositionals = srcPositionals.slice(destPositionals.length).map((param) => param.type);
        let isSourceNonVariadicArgs = false;
        if (srcArgsIndex >= 0) {
          const srcArgsType = FunctionType.getEffectiveParameterType(srcType, srcArgsIndex);
          if (isVariadicTypeVar(srcArgsType)) {
            remainingSrcPositionals.push(srcArgsType);
          } else {
            isSourceNonVariadicArgs = true;
          }
        }

        let srcPositionalsType: Type;
        if (remainingSrcPositionals.length === 1 && isVariadicTypeVar(remainingSrcPositionals[0])) {
          srcPositionalsType = remainingSrcPositionals[0];
        } else {
          if (tupleClassType && isClass(tupleClassType)) {
            srcPositionalsType = convertToInstance(
              specializeTupleClass(tupleClassType, remainingSrcPositionals, /* isTypeArgumentExplicit */ true, /* stripLiterals */ true, /* isForUnpackedVariadicTypeVar */ true)
            );
          } else {
            srcPositionalsType = UnknownType.create();
          }
        }

        if (isSourceNonVariadicArgs) {
          diag.createAddendum().addMessage(
            Localizer.DiagAddendum.argsParamWithVariadic().format({
              paramName: srcParams[srcArgsIndex].name!,
            })
          );
          canAssign = false;
        } else if (
          !canAssignFunctionParameter(
            FunctionType.getEffectiveParameterType(destType, destArgsIndex),
            srcPositionalsType,
            destArgsIndex,
            diag.createAddendum(),
            typeVarMap,
            srcTypeVarMap,
            flags,
            recursionCount
          )
        ) {
          canAssign = false;
        }
      } else if (destPositionals.length < srcPositionals.length) {
        if (!destType.details.paramSpec) {
          const nonDefaultSrcParamCount = srcParams.filter((p) => !!p.name && !p.hasDefault).length;
          if (destArgsIndex < 0) {
            if (destPositionals.length < nonDefaultSrcParamCount) {
              diag.createAddendum().addMessage(
                Localizer.DiagAddendum.functionTooFewParams().format({
                  expected: nonDefaultSrcParamCount,
                  received: destPositionals.length,
                })
              );
              canAssign = false;
            }
          } else {
            const destArgsType = FunctionType.getEffectiveParameterType(destType, destArgsIndex);
            if (!isAnyOrUnknown(destArgsType)) {
              for (let paramIndex = destPositionals.length; paramIndex < srcPositionals.length; paramIndex++) {
                const srcParamType = FunctionType.getEffectiveParameterType(
                  srcType,
                  srcParams.findIndex((p) => p === srcPositionals[paramIndex])
                );
                if (!canAssignFunctionParameter(destArgsType, srcParamType, paramIndex, diag.createAddendum(), typeVarMap, srcTypeVarMap, flags, recursionCount)) {
                  canAssign = false;
                }
              }
            }
          }
        }
      } else if (srcPositionals.length < destPositionals.length) {
        if (srcArgsIndex >= 0) {
          const srcArgsType = FunctionType.getEffectiveParameterType(srcType, srcArgsIndex);
          for (let paramIndex = srcPositionals.length; paramIndex < destPositionals.length; paramIndex++) {
            const destParamType = FunctionType.getEffectiveParameterType(
              destType,
              destParams.findIndex((p) => p === destPositionals[paramIndex])
            );
            if (isVariadicTypeVar(destParamType) && !isVariadicTypeVar(srcArgsType)) {
              diag.addMessage(Localizer.DiagAddendum.typeVarTupleRequiresKnownLength());
              canAssign = false;
            } else if (!canAssignFunctionParameter(destParamType, srcArgsType, paramIndex, diag.createAddendum(), typeVarMap, srcTypeVarMap, flags, recursionCount)) {
              canAssign = false;
            }
          }
        } else {
          diag.addMessage(
            Localizer.DiagAddendum.functionTooManyParams().format({
              expected: srcPositionals.length,
              received: destPositionals.length,
            })
          );
          canAssign = false;
        }
      }

      if (srcArgsIndex >= 0 && destArgsIndex >= 0) {
        const srcArgsType = FunctionType.getEffectiveParameterType(srcType, srcArgsIndex);
        const destArgsType = FunctionType.getEffectiveParameterType(destType, destArgsIndex);
        if (!canAssignFunctionParameter(destArgsType, srcArgsType, destArgsIndex, diag.createAddendum(), typeVarMap, srcTypeVarMap, flags, recursionCount)) {
          canAssign = false;
        }
      }

      if (srcArgsIndex < 0 && destArgsIndex >= 0 && !destVariadicArgsList) {
        diag.createAddendum().addMessage(
          Localizer.DiagAddendum.argsParamMissing().format({
            paramName: destParams[destArgsIndex].name!,
          })
        );
        canAssign = false;
      }

      if (!destType.details.paramSpec) {
        const destParamMap = new Map<string, FunctionParameter>();
        let destHasKwargsParam = false;
        if (destStartOfNamed >= 0) {
          destParams.forEach((param, index) => {
            if (index >= destStartOfNamed) {
              if (param.category === ParameterCategory.VarArgDictionary) {
                destHasKwargsParam = true;
              } else if (param.name && param.category === ParameterCategory.Simple) {
                destParamMap.set(param.name, param);
              }
            }
          });
        }

        if (destPositionals.length < srcPositionals.length && destArgsIndex < 0) {
          srcStartOfNamed = destPositionals.length;
        }

        if (srcStartOfNamed >= 0) {
          srcParams.forEach((srcParam, index) => {
            if (index >= srcStartOfNamed) {
              if (srcParam.name && srcParam.category === ParameterCategory.Simple) {
                const destParam = destParamMap.get(srcParam.name);
                const paramDiag = diag.createAddendum();
                if (!destParam) {
                  if (!destHasKwargsParam && !srcParam.hasDefault) {
                    paramDiag.addMessage(
                      Localizer.DiagAddendum.namedParamMissingInDest().format({
                        name: srcParam.name,
                      })
                    );
                    canAssign = false;
                  } else if (destHasKwargsParam) {
                    const destKwargsType = FunctionType.getEffectiveParameterType(destType, destKwargsIndex);
                    if (!canAssignFunctionParameter(destKwargsType, srcParam.type, destKwargsIndex, diag.createAddendum(), typeVarMap, srcTypeVarMap, flags, recursionCount)) {
                      canAssign = false;
                    }
                  }
                } else {
                  const specializedDestParamType = typeVarMap ? applySolvedTypeVars(destParam.type, typeVarMap) : destParam.type;
                  if (!canAssignType(srcParam.type, specializedDestParamType, paramDiag.createAddendum(), undefined, flags, recursionCount + 1)) {
                    paramDiag.addMessage(
                      Localizer.DiagAddendum.namedParamTypeMismatch().format({
                        name: srcParam.name,
                        sourceType: printType(specializedDestParamType),
                        destType: printType(srcParam.type),
                      })
                    );
                    canAssign = false;
                  }
                  destParamMap.delete(srcParam.name);
                }
              }
            }
          });
        }

        destParamMap.forEach((destParam, paramName) => {
          if (srcKwargsIndex >= 0 && destParam.name) {
            const srcKwargsType = FunctionType.getEffectiveParameterType(srcType, srcKwargsIndex);
            if (!canAssignFunctionParameter(destParam.type, srcKwargsType, destKwargsIndex, diag.createAddendum(), typeVarMap, srcTypeVarMap, flags, recursionCount)) {
              canAssign = false;
            }
            destParamMap.delete(destParam.name);
          } else {
            const paramDiag = diag.createAddendum();
            paramDiag.addMessage(Localizer.DiagAddendum.namedParamMissingInSource().format({ name: paramName }));
            canAssign = false;
          }
        });

        if (srcKwargsIndex >= 0 && destKwargsIndex >= 0) {
          const srcKwargsType = FunctionType.getEffectiveParameterType(srcType, srcKwargsIndex);
          const destKwargsType = FunctionType.getEffectiveParameterType(destType, destKwargsIndex);
          if (!canAssignFunctionParameter(destKwargsType, srcKwargsType, destKwargsIndex, diag.createAddendum(), typeVarMap, srcTypeVarMap, flags, recursionCount)) {
            canAssign = false;
          }
        }

        if (srcKwargsIndex < 0 && destKwargsIndex >= 0) {
          diag.createAddendum().addMessage(
            Localizer.DiagAddendum.argsParamMissing().format({
              paramName: destParams[destKwargsIndex].name!,
            })
          );
          canAssign = false;
        }
      }
    }

    if (typeVarMap && !typeVarMap.isLocked()) {
      srcTypeVarMap.getTypeVars().forEach((typeVarEntry) => {
        canAssignType(typeVarEntry.typeVar, srcTypeVarMap.getTypeVarType(typeVarEntry.typeVar)!, new DiagAddendum(), typeVarMap);
      });

      typeVarMap.getTypeVars().forEach((entry) => {
        if (entry.narrowBound) {
          const specializedType = applySolvedTypeVars(entry.narrowBound, typeVarMap);
          if (specializedType !== entry.narrowBound) {
            typeVarMap.setTypeVarType(entry.typeVar, specializedType, entry.wideBound, entry.retainLiteral);
          }
        }
      });

      if (destType.details.paramSpec) {
        typeVarMap.setParamSpec(
          destType.details.paramSpec,
          srcType.details.parameters
            .map((p, index) => {
              const paramSpecEntry: ParamSpecEntry = {
                category: p.category,
                name: p.name,
                hasDefault: !!p.hasDefault,
                type: FunctionType.getEffectiveParameterType(srcType, index),
              };
              return paramSpecEntry;
            })
            .slice(destType.details.parameters.length, srcType.details.parameters.length)
        );
      }
    }

    if (checkReturnType) {
      const destReturnType = getFunctionEffectiveReturnType(destType);
      if (!isAnyOrUnknown(destReturnType)) {
        const srcReturnType = applySolvedTypeVars(getFunctionEffectiveReturnType(srcType), srcTypeVarMap);
        const returnDiag = diag.createAddendum();

        if (!canAssignType(destReturnType, srcReturnType, returnDiag.createAddendum(), typeVarMap, flags, recursionCount + 1)) {
          returnDiag.addMessage(
            Localizer.DiagAddendum.functionReturnTypeMismatch().format({
              sourceType: printType(srcReturnType),
              destType: printType(destReturnType),
            })
          );
          canAssign = false;
        }
      }
    }

    return canAssign;
  }

  function replaceTypeArgsWithAny(declaredType: ClassType, assignedType: ClassType): ClassType | undefined {
    if (assignedType.details.typeParameters.length > 0 && assignedType.typeArguments && assignedType.typeArguments.length <= assignedType.details.typeParameters.length) {
      const typeVarMap = new TypeVarMap(getTypeVarScopeId(assignedType));
      populateTypeVarMapBasedOnExpectedType(
        ClassType.cloneForSpecialization(assignedType, /* typeArguments */ undefined, /* isTypeArgumentExplicit */ false),
        ObjectType.create(declaredType),
        typeVarMap,
        []
      );

      let replacedTypeArg = false;
      const newTypeArgs = assignedType.typeArguments.map((typeArg, index) => {
        const typeParam = assignedType.details.typeParameters[index];
        const expectedTypeArgType = typeVarMap.getTypeVarType(typeParam);

        if (expectedTypeArgType) {
          if (isAny(expectedTypeArgType) || isAnyOrUnknown(typeArg)) {
            replacedTypeArg = true;
            return expectedTypeArgType;
          }
        }

        return typeArg;
      });

      if (replacedTypeArg) {
        return ClassType.cloneForSpecialization(assignedType, newTypeArgs, /* isTypeArgumentExplicit */ true);
      }
    }

    return undefined;
  }

  function narrowTypeBasedOnAssignment(declaredType: Type, assignedType: Type): Type {
    const diag = new DiagAddendum();

    const narrowedType = mapSubtypes(assignedType, (assignedSubtype) => {
      const narrowedSubtype = mapSubtypes(declaredType, (declaredSubtype) => {
        if (isAnyOrUnknown(declaredType)) {
          return declaredType;
        }

        if (canAssignType(declaredSubtype, assignedSubtype, diag)) {
          if (isClass(declaredSubtype) && isClass(assignedSubtype)) {
            const result = replaceTypeArgsWithAny(declaredSubtype, assignedSubtype);
            if (result) {
              assignedSubtype = result;
            }
          } else if (isObject(declaredSubtype) && isObject(assignedSubtype)) {
            const result = replaceTypeArgsWithAny(declaredSubtype.classType, assignedSubtype.classType);
            if (result) {
              assignedSubtype = ObjectType.create(result);
            }
          } else if (isAnyOrUnknown(assignedSubtype)) {
            return declaredType;
          }

          return assignedSubtype;
        }

        return undefined;
      });

      if (isNever(narrowedSubtype)) {
        return assignedSubtype;
      }

      return narrowedSubtype;
    });

    if (isAnyOrUnknown(assignedType)) {
      return declaredType;
    }

    return narrowedType;
  }

  function canOverrideMethod(baseMethod: Type, overrideMethod: FunctionType, diag: DiagAddendum): boolean {
    if (isOverloadedFunction(baseMethod)) {
      baseMethod = baseMethod.overloads[baseMethod.overloads.length - 1];
    }

    if (!isFunction(baseMethod)) {
      diag.addMessage(Localizer.DiagAddendum.overrideType().format({ type: printType(baseMethod) }));
      return false;
    }

    let canOverride = true;
    const baseParams = baseMethod.details.parameters;
    const overrideParams = overrideMethod.details.parameters;
    const overrideArgsParam = overrideParams.find((param) => param.category === ParameterCategory.VarArgList && !!param.name);
    const overrideKwargsParam = overrideParams.find((param) => param.category === ParameterCategory.VarArgDictionary && !!param.name);

    let foundParamCountMismatch = false;
    if (overrideParams.length < baseParams.length) {
      if (!overrideArgsParam || !overrideKwargsParam) {
        foundParamCountMismatch = true;
      }
    } else if (overrideParams.length > baseParams.length) {
      for (let i = baseParams.length; i < overrideParams.length; i++) {
        const overrideParam = overrideParams[i];

        if (overrideParam.category === ParameterCategory.Simple && overrideParam.name && !overrideParam.hasDefault) {
          foundParamCountMismatch = true;
        }
      }
    }

    if (foundParamCountMismatch) {
      diag.addMessage(
        Localizer.DiagAddendum.overrideParamCount().format({
          baseCount: baseParams.length,
          overrideCount: overrideParams.length,
        })
      );
      canOverride = false;
    }

    const paramCount = Math.min(baseParams.length, overrideParams.length);
    const positionOnlyIndex = baseParams.findIndex((param) => !param.name && param.category === ParameterCategory.Simple);

    for (let i = 0; i < paramCount; i++) {
      if (i === 0) {
        if (FunctionType.isInstanceMethod(overrideMethod) || FunctionType.isClassMethod(overrideMethod) || FunctionType.isConstructorMethod(overrideMethod)) {
          continue;
        }
      }

      const baseParam = baseParams[i];
      const overrideParam = overrideParams[i];

      if (i > positionOnlyIndex && !isPrivateOrProtectedName(baseParam.name || '') && baseParam.category === ParameterCategory.Simple && baseParam.name !== overrideParam.name) {
        if (overrideParam.category === ParameterCategory.Simple) {
          diag.addMessage(
            Localizer.DiagAddendum.overrideParamName().format({
              index: i + 1,
              baseName: baseParam.name || '*',
              overrideName: overrideParam.name || '*',
            })
          );
          canOverride = false;
        }
      } else {
        const baseParamType = FunctionType.getEffectiveParameterType(baseMethod, i);
        const overrideParamType = FunctionType.getEffectiveParameterType(overrideMethod, i);

        const baseIsSynthesizedTypeVar = isTypeVar(baseParamType) && baseParamType.details.isSynthesized;
        const overrideIsSynthesizedTypeVar = isTypeVar(overrideParamType) && overrideParamType.details.isSynthesized;
        if (!baseIsSynthesizedTypeVar && !overrideIsSynthesizedTypeVar) {
          if (baseParam.category !== overrideParam.category || !canAssignType(overrideParamType, baseParamType, diag.createAddendum(), /* typeVarMap */ undefined, CanAssignFlags.SkipSolveTypeVars)) {
            diag.addMessage(
              Localizer.DiagAddendum.overrideParamType().format({
                index: i + 1,
                baseType: printType(baseParamType),
                overrideType: printType(overrideParamType),
              })
            );
            canOverride = false;
          }
        }
      }
    }

    const baseReturnType = getFunctionEffectiveReturnType(baseMethod);
    const overrideReturnType = getFunctionEffectiveReturnType(overrideMethod);
    if (!canAssignType(baseReturnType, overrideReturnType, diag.createAddendum(), /* typeVarMap */ undefined, CanAssignFlags.SkipSolveTypeVars)) {
      diag.addMessage(
        Localizer.DiagAddendum.overrideReturnType().format({
          baseType: printType(baseReturnType),
          overrideType: printType(overrideReturnType),
        })
      );

      canOverride = false;
    }

    return canOverride;
  }

  function canAssignToTypeVar(destType: TypeVarType, srcType: Type, diag: DiagAddendum, flags = CanAssignFlags.Default, recursionCount = 0): boolean {
    if (recursionCount > maxTypeRecursionCount) {
      return true;
    }

    if (isAnyOrUnknown(srcType)) {
      return true;
    }

    let effectiveSrcType: Type = srcType;

    if (isTypeVar(srcType)) {
      if (isTypeSame(srcType, destType)) {
        return true;
      }

      effectiveSrcType = makeTopLevelTypeVarsConcrete(srcType);
    }

    const boundType = destType.details.boundType;
    if (boundType) {
      if (!canAssignType(boundType, effectiveSrcType, diag.createAddendum(), undefined, flags, recursionCount + 1)) {
        if (!destType.details.isSynthesized) {
          diag.addMessage(
            Localizer.DiagAddendum.typeBound().format({
              sourceType: printType(effectiveSrcType),
              destType: printType(boundType),
              name: TypeVarType.getReadableName(destType),
            })
          );
        }
        return false;
      }
    }

    const constraints = destType.details.constraints;
    if (constraints.length === 0) {
      return true;
    }

    for (const constraint of constraints) {
      if (isAnyOrUnknown(constraint)) {
        return true;
      } else if (isUnion(effectiveSrcType)) {
        if (findSubtype(effectiveSrcType, (subtype) => canAssignType(constraint, subtype, new DiagAddendum()))) {
          return true;
        }
      } else if (canAssignType(constraint, effectiveSrcType, new DiagAddendum())) {
        return true;
      }
    }

    diag.addMessage(
      Localizer.DiagAddendum.typeConstrainedTypeVar().format({
        type: printType(effectiveSrcType),
        name: TypeVarType.getReadableName(destType),
      })
    );

    return false;
  }

  function getAbstractMethods(classType: ClassType): AbstractMethod[] {
    const symbolTable = new Map<string, AbstractMethod>();

    classType.details.mro.forEach((mroClass) => {
      if (isClass(mroClass)) {
        mroClass.details.fields.forEach((symbol, symbolName) => {
          if (symbol.isClassMember()) {
            let isAbstract: boolean;

            const decl = getLastTypedDeclaredForSymbol(symbol);
            if (decl && decl.type === DeclarationType.Function) {
              const functionFlags = getFunctionFlagsFromDecorators(decl.node, true);
              isAbstract = !!(functionFlags & FunctionTypeFlags.AbstractMethod);
            } else {
              isAbstract = false;
            }

            if (!symbolTable.has(symbolName)) {
              symbolTable.set(symbolName, {
                symbol,
                symbolName,
                isAbstract,
                classType: mroClass,
              });
            }
          }
        });
      }
    });

    const methodList: AbstractMethod[] = [];
    symbolTable.forEach((method) => {
      if (method.isAbstract) {
        methodList.push(method);
      }
    });

    return methodList;
  }

  function canAssignToTypedDict(classType: ClassType, keyTypes: Type[], valueTypes: Type[], diagAddendum: DiagAddendum): boolean {
    assert(ClassType.isTypedDictClass(classType));
    assert(keyTypes.length === valueTypes.length);

    let isMatch = true;

    const symbolMap = getTypedDictMembersForClass(classType);

    keyTypes.forEach((keyType, index) => {
      if (!isObject(keyType) || !ClassType.isBuiltIn(keyType.classType, 'str') || !isLiteralType(keyType)) {
        isMatch = false;
      } else {
        const keyValue = keyType.classType.literalValue as string;
        const symbolEntry = symbolMap.get(keyValue);

        if (!symbolEntry) {
          isMatch = false;
          diagAddendum.addMessage(
            Localizer.DiagAddendum.typedDictFieldUndefined().format({
              name: keyType.classType.literalValue as string,
              type: printType(ObjectType.create(classType)),
            })
          );
        } else {
          const assignDiag = new DiagAddendum();
          if (!canAssignType(symbolEntry.valueType, valueTypes[index], assignDiag)) {
            diagAddendum.addMessage(
              Localizer.DiagAddendum.typedDictFieldTypeMismatch().format({
                name: keyType.classType.literalValue as string,
                type: printType(valueTypes[index]),
              })
            );
            isMatch = false;
          }
          symbolEntry.isProvided = true;
        }
      }
    });

    if (!isMatch) {
      return false;
    }

    symbolMap.forEach((entry, name) => {
      if (entry.isRequired && !entry.isProvided) {
        diagAddendum.addMessage(
          Localizer.DiagAddendum.typedDictFieldRequired().format({
            name,
            type: printType(ObjectType.create(classType)),
          })
        );
        isMatch = false;
      }
    });

    return isMatch;
  }

  function getTypedDictMembersForClass(classType: ClassType, allowNarrowed = false) {
    if (!classType.details.typedDictEntries) {
      const entries = new Map<string, TypedDictEntry>();
      getTypedDictMembersForClassRecursive(classType, entries);

      classType.details.typedDictEntries = entries;
    }

    const entries = new Map<string, TypedDictEntry>();
    classType.details.typedDictEntries!.forEach((value, key) => {
      entries.set(key, { ...value });
    });

    if (allowNarrowed && classType.typedDictNarrowedEntries) {
      classType.typedDictNarrowedEntries.forEach((value, key) => {
        entries.set(key, { ...value });
      });
    }

    return entries;
  }

  function getTypedDictMembersForClassRecursive(classType: ClassType, keyMap: Map<string, TypedDictEntry>, recursionCount = 0) {
    assert(ClassType.isTypedDictClass(classType));
    if (recursionCount > maxTypeRecursionCount) {
      return;
    }

    classType.details.baseClasses.forEach((baseClassType) => {
      if (isClass(baseClassType) && ClassType.isTypedDictClass(baseClassType)) {
        getTypedDictMembersForClassRecursive(baseClassType, keyMap, recursionCount + 1);
      }
    });

    classType.details.fields.forEach((symbol, name) => {
      if (!symbol.isIgnoredForProtocolMatch()) {
        const lastDecl = getLastTypedDeclaredForSymbol(symbol);
        if (lastDecl && lastDecl.type === DeclarationType.Variable) {
          const valueType = getDeclaredTypeOfSymbol(symbol) || UnknownType.create();
          let isRequired = !ClassType.isCanOmitDictValues(classType);

          if (isRequiredTypedDictVariable(symbol)) {
            isRequired = true;
          } else if (isNotRequiredTypedDictVariable(symbol)) {
            isRequired = false;
          }

          const existingEntry = keyMap.get(name);
          if (existingEntry) {
            if (!isTypeSame(existingEntry.valueType, valueType)) {
              const diag = new DiagAddendum();
              diag.addMessage(
                Localizer.DiagAddendum.typedDictFieldRedefinition().format({
                  parentType: printType(existingEntry.valueType),
                  childType: printType(valueType),
                })
              );
              addDiag(
                getFileInfo(lastDecl.node).diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                Localizer.Diag.typedDictFieldRedefinition().format({
                  name,
                }) + diag.getString(),
                lastDecl.node
              );
            }
          }

          keyMap.set(name, {
            valueType,
            isRequired,
            isProvided: false,
          });
        }
      }
    });
  }

  function bindFunctionToClassOrObject(
    baseType: ClassType | ObjectType | undefined,
    memberType: FunctionType | OverloadedFunctionType,
    memberClass?: ClassType,
    errorNode?: ParseNode,
    recursionCount = 0,
    treatConstructorAsClassMember = false,
    firstParamType?: ClassType | ObjectType | TypeVarType
  ): FunctionType | OverloadedFunctionType | undefined {
    if (isFunction(memberType)) {
      if (!baseType) {
        return FunctionType.clone(memberType, /* stripFirstParam */ true);
      }

      if (FunctionType.isInstanceMethod(memberType)) {
        const baseObj = isObject(baseType) ? baseType : ObjectType.create(specializeClassType(baseType));
        return partiallySpecializeFunctionForBoundClassOrObject(
          baseType,
          memberType,
          memberClass || baseObj.classType,
          errorNode,
          recursionCount + 1,
          firstParamType || baseObj,
          /* stripFirstParam */ isObject(baseType)
        );
      }

      if (FunctionType.isClassMethod(memberType) || (treatConstructorAsClassMember && FunctionType.isConstructorMethod(memberType))) {
        const baseClass = isClass(baseType) ? baseType : baseType.classType;

        const effectiveFirstParamType = firstParamType ? (isClass(baseType) ? firstParamType : (convertToInstantiable(firstParamType) as ClassType | TypeVarType)) : baseClass;

        return partiallySpecializeFunctionForBoundClassOrObject(baseType, memberType, memberClass || baseClass, errorNode, recursionCount + 1, effectiveFirstParamType, /* stripFirstParam */ true);
      }

      if (FunctionType.isStaticMethod(memberType)) {
        const baseClass = isClass(baseType) ? baseType : baseType.classType;

        return partiallySpecializeFunctionForBoundClassOrObject(
          baseType,
          memberType,
          memberClass || baseClass,
          errorNode,
          recursionCount + 1,
          /* effectiveFirstParamType */ undefined,
          /* stripFirstParam */ false
        );
      }
    } else if (isOverloadedFunction(memberType)) {
      const newOverloadType = OverloadedFunctionType.create();
      memberType.overloads.forEach((overload) => {
        const boundMethod = bindFunctionToClassOrObject(baseType, overload, memberClass, /* errorNode */ undefined, recursionCount + 1, treatConstructorAsClassMember, firstParamType);
        if (boundMethod) {
          OverloadedFunctionType.addOverload(newOverloadType, boundMethod as FunctionType);
        }
      });

      if (newOverloadType.overloads.length === 1) {
        return newOverloadType.overloads[0];
      } else if (newOverloadType.overloads.length === 0) {
        if (errorNode) {
          memberType.overloads.forEach((overload) => {
            bindFunctionToClassOrObject(baseType, overload, memberClass, errorNode, recursionCount + 1, treatConstructorAsClassMember, firstParamType);
          });
        }
        return undefined;
      }

      return newOverloadType;
    }

    return memberType;
  }

  function partiallySpecializeFunctionForBoundClassOrObject(
    baseType: ClassType | ObjectType,
    memberType: FunctionType,
    memberClass: ClassType,
    errorNode: ParseNode | undefined,
    recursionCount: number,
    firstParamType: ClassType | ObjectType | TypeVarType | undefined,
    stripFirstParam = true
  ): FunctionType | undefined {
    const typeVarMap = memberClass.typeArguments ? buildTypeVarMapFromSpecializedClass(memberClass) : new TypeVarMap(getTypeVarScopeId(memberClass));

    if (firstParamType && memberType.details.parameters.length > 0) {
      const memberTypeFirstParam = memberType.details.parameters[0];
      const memberTypeFirstParamType = FunctionType.getEffectiveParameterType(memberType, 0);

      const nonLiteralFirstParamType = stripLiteralValue(firstParamType);

      typeVarMap.addSolveForScope(getTypeVarScopeId(memberType));
      const diag = new DiagAddendum();

      if (
        isTypeVar(memberTypeFirstParamType) &&
        memberTypeFirstParamType.details.boundType &&
        isObject(memberTypeFirstParamType.details.boundType) &&
        ClassType.isProtocolClass(memberTypeFirstParamType.details.boundType.classType)
      ) {
        if (!typeVarMap.isLocked()) {
          typeVarMap.setTypeVarType(memberTypeFirstParamType, nonLiteralFirstParamType);
        }
      } else if (!canAssignType(memberTypeFirstParamType, nonLiteralFirstParamType, diag, typeVarMap, /* flags */ undefined, recursionCount + 1)) {
        if (memberTypeFirstParam.name && !memberTypeFirstParam.isNameSynthesized && memberTypeFirstParam.hasDeclaredType) {
          if (errorNode) {
            addDiag(
              getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.bindTypeMismatch().format({
                type: printType(baseType),
                methodName: memberType.details.name,
                paramName: memberTypeFirstParam.name,
              }) + diag.getString(),
              errorNode
            );
          } else {
            return undefined;
          }
        }
      }
    }

    getFunctionEffectiveReturnType(memberType);

    const specializedFunction = applySolvedTypeVars(memberType, typeVarMap) as FunctionType;

    return FunctionType.clone(specializedFunction, stripFirstParam, baseType, getTypeVarScopeId(baseType));
  }

  function printObjectTypeForClass(type: ClassType): string {
    return TypePrinter.printObjectTypeForClass(type, evaluatorOptions.printTypeFlags, getFunctionEffectiveReturnType);
  }

  function printFunctionParts(type: FunctionType): [string[], string] {
    return TypePrinter.printFunctionParts(type, evaluatorOptions.printTypeFlags, getFunctionEffectiveReturnType);
  }

  function printType(type: Type, expandTypeAlias = false): string {
    return TypePrinter.printType(type, evaluatorOptions.printTypeFlags, getFunctionEffectiveReturnType, expandTypeAlias);
  }

  function parseStringAsTypeAnnotation(node: StringListNode): ExpressionNode | undefined {
    const fileInfo = getFileInfo(node);
    const parser = new Parser();
    const textValue = node.strings[0].value;

    const valueOffset = node.strings[0].start + node.strings[0].token.prefixLength + node.strings[0].token.quoteMarkLength;

    const parseOptions = new ParseOptions();
    parseOptions.isStubFile = fileInfo.isStubFile;
    parseOptions.pythonVersion = fileInfo.executionEnvironment.pythonVersion;

    const parseResults = parser.parseTextExpression(fileInfo.fileContents, valueOffset, textValue.length, parseOptions);

    if (parseResults.parseTree) {
      parseResults.diagnostics.forEach((diag) => {
        addError(diag.message, node);
      });

      parseResults.parseTree.parent = node;
      return parseResults.parseTree;
    }

    return undefined;
  }

  function getTypeSourceId(node: ParseNode): TypeSourceId {
    return node.start;
  }

  return {
    runWithCancellationToken,
    getType,
    getTypeOfClass,
    getTypeOfFunction,
    evaluateTypesForStatement,
    getDeclaredTypeForExpression,
    verifyRaiseExceptionType,
    verifyDeleteExpression,
    isAfterNodeReachable,
    isNodeReachable,
    suppressDiags,
    getDeclarationsForNameNode,
    getTypeForDeclaration,
    resolveAliasDeclaration,
    getTypeFromIterable,
    getTypeFromIterator,
    getTypedDictMembersForClass,
    getGetterTypeFromProperty,
    markNamesAccessed,
    getScopeIdForNode,
    makeTopLevelTypeVarsConcrete,
    getEffectiveTypeOfSymbol,
    getFunctionDeclaredReturnType,
    getFunctionInferredReturnType,
    getBuiltInType,
    getTypeOfMember,
    bindFunctionToClassOrObject,
    getCallSignatureInfo,
    getTypeAnnotationForParameter,
    canAssignType,
    canOverrideMethod,
    canAssignProtocolClassToSelf,
    addError,
    addWarning,
    addInformation,
    addUnusedCode,
    addDiag,
    addDiagForTextRange,
    printType,
    printFunctionParts,
    getTypeCacheSize,
  };
}
