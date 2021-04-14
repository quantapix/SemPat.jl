import { Commands } from '../commands/commands';
import { DiagLevel } from '../common/configOptions';
import { assert } from '../common/debug';
import { Diag, DiagAddendum } from '../common/diagnostic';
import { DiagRule } from '../common/diagnosticRules';
import { TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
  AssertNode,
  AssignmentExpressionNode,
  AssignmentNode,
  AugmentedAssignmentNode,
  AwaitNode,
  BinaryOpNode,
  CallNode,
  CaseNode,
  ClassNode,
  DelNode,
  ErrorNode,
  ExceptNode,
  FormatStringNode,
  ForNode,
  FunctionNode,
  IfNode,
  ImportAsNode,
  ImportFromAsNode,
  ImportFromNode,
  IndexNode,
  isExpressionNode,
  LambdaNode,
  ListComprehensionNode,
  MatchNode,
  MemberAccessNode,
  ModuleNode,
  NameNode,
  ParameterCategory,
  ParseNode,
  ParseNodeType,
  RaiseNode,
  ReturnNode,
  SliceNode,
  StatementListNode,
  StatementNode,
  StringListNode,
  SuiteNode,
  TernaryNode,
  TupleNode,
  TypeAnnotationNode,
  UnaryOpNode,
  UnpackNode,
  WhileNode,
  WithNode,
  YieldFromNode,
  YieldNode,
} from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration, DeclarationType } from './declaration';
import { isExplicitTypeAliasDeclaration, isFinalVariableDeclaration } from './declarationUtils';
import { ImportType } from './importResult';
import { getTopLevelImports } from './importStatementUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { getLastTypedDeclaredForSymbol, isFinalVariable } from './symbolUtils';
import { TypeEvaluator } from './typeEvaluator';
import {
  AnyType,
  ClassType,
  combineTypes,
  FunctionType,
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
  isUnion,
  isUnknown,
  NoneType,
  ObjectType,
  Type,
  TypeBase,
  TypeCategory,
  TypeVarType,
  UnknownType,
  Variance,
} from './types';
import {
  CanAssignFlags,
  ClassMemberLookupFlags,
  derivesFromAnyOrUnknown,
  derivesFromClassRecursive,
  doForEachSubtype,
  getDeclaredGeneratorReturnType,
  getGeneratorTypeArgs,
  isEllipsisType,
  isLiteralTypeOrUnion,
  isNoReturnType,
  isOpenEndedTupleClass,
  isPartlyUnknown,
  isProperty,
  isTupleClass,
  lookUpClassMember,
  mapSubtypes,
  partiallySpecializeType,
  transformPossibleRecursiveTypeAlias,
  transformTypeObjectToClass,
} from './typeUtils';
import { TypeVarMap } from './typeVarMap';
interface LocalTypeVarInfo {
  isExempt: boolean;
  nodes: NameNode[];
}
export class Checker extends ParseTreeWalker {
  private readonly _moduleNode: ModuleNode;
  private readonly _fileInfo: AnalyzerFileInfo;
  private readonly _evaluator: TypeEvaluator;
  private _scopedNodes: AnalyzerNodeInfo.ScopedNode[] = [];
  constructor(node: ModuleNode, evaluator: TypeEvaluator) {
    super();
    this._moduleNode = node;
    this._fileInfo = AnalyzerNodeInfo.getFileInfo(node)!;
    this._evaluator = evaluator;
  }
  check() {
    this._scopedNodes.push(this._moduleNode);
    this._walkStatementsAndReportUnreachable(this._moduleNode.statements);
    const dunderAllNames = AnalyzerNodeInfo.getDunderAllNames(this._moduleNode);
    if (dunderAllNames) {
      this._evaluator.markNamesAccessed(this._moduleNode, dunderAllNames);
    }
    this._validateSymbolTables();
    this._reportDuplicateImports();
  }
  walk(node: ParseNode) {
    if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
      super.walk(node);
    } else {
      this._evaluator.suppressDiags(node, () => {
        super.walk(node);
      });
    }
  }
  visitSuite(node: SuiteNode): boolean {
    this._walkStatementsAndReportUnreachable(node.statements);
    return false;
  }
  visitStatementList(node: StatementListNode) {
    node.statements.forEach((statement) => {
      if (isExpressionNode(statement)) {
        this._evaluator.getType(statement);
      }
    });
    return true;
  }
  visitClass(node: ClassNode): boolean {
    const classTypeResult = this._evaluator.getTypeOfClass(node);
    this.walk(node.suite);
    this.walkMultiple(node.decorators);
    this.walkMultiple(node.arguments);
    if (classTypeResult) {
      if (ClassType.isProtocolClass(classTypeResult.classType)) {
        node.arguments.forEach((arg) => {
          if (!arg.name) {
            const baseClassType = this._evaluator.getType(arg.valueExpression);
            if (baseClassType && isClass(baseClassType) && !ClassType.isBuiltIn(baseClassType, 'Protocol')) {
              if (!ClassType.isProtocolClass(baseClassType)) {
                this._evaluator.addError(
                  Localizer.Diag.protocolBaseClass().format({
                    classType: this._evaluator.printType(classTypeResult.classType, /* expandTypeAlias */ false),
                    baseType: this._evaluator.printType(baseClassType, /* expandTypeAlias */ false),
                  }),
                  arg.valueExpression
                );
              }
            }
          }
        });
        this._validateProtocolTypeParamVariance(node, classTypeResult.classType);
      }
      this._validateClassMethods(classTypeResult.classType);
      this._validateFinalMemberOverrides(classTypeResult.classType);
      if (ClassType.isTypedDictClass(classTypeResult.classType)) {
        this._validateTypedDictClassSuite(node.suite);
      }
    }
    this._scopedNodes.push(node);
    return false;
  }
  visitFunction(node: FunctionNode): boolean {
    const functionTypeResult = this._evaluator.getTypeOfFunction(node);
    const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
    if (functionTypeResult) {
      let sawParamSpecArgs = false;
      node.parameters.forEach((param, index) => {
        if (param.name) {
          if (param.category === ParameterCategory.VarArgList) {
            const annotationExpr = param.typeAnnotation || param.typeAnnotationComment;
            if (annotationExpr && annotationExpr.nodeType === ParseNodeType.MemberAccess && annotationExpr.memberName.value === 'args') {
              const baseType = this._evaluator.getType(annotationExpr.leftExpression);
              if (baseType && isTypeVar(baseType) && baseType.details.isParamSpec) {
                sawParamSpecArgs = true;
              }
            }
          } else if (param.category === ParameterCategory.VarArgDictionary) {
            sawParamSpecArgs = false;
          }
        }
        if (param.name && param.category === ParameterCategory.Simple && sawParamSpecArgs) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.namedParamAfterParamSpecArgs().format({ name: param.name.value }),
            param.name
          );
        }
        if (param.name && param.name.value !== '_') {
          const paramType = functionTypeResult.functionType.details.parameters[index].type;
          if (isUnknown(paramType) || (isTypeVar(paramType) && paramType.details.isSynthesized && !paramType.details.isSynthesizedSelfCls)) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
              DiagRule.reportUnknownParameterType,
              Localizer.Diag.paramTypeUnknown().format({ paramName: param.name.value }),
              param.name
            );
          } else if (isPartlyUnknown(paramType)) {
            const diagAddendum = new DiagAddendum();
            diagAddendum.addMessage(
              Localizer.DiagAddendum.paramType().format({
                paramType: this._evaluator.printType(paramType, /* expandTypeAlias */ true),
              })
            );
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
              DiagRule.reportUnknownParameterType,
              Localizer.Diag.paramTypePartiallyUnknown().format({ paramName: param.name.value }) + diagAddendum.getString(),
              param.name
            );
          }
        }
        if (param.defaultValue && this._fileInfo.isStubFile) {
          const defaultValueType = this._evaluator.getType(param.defaultValue);
          if (!defaultValueType || !isEllipsisType(defaultValueType)) {
            this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportInvalidStubStatement, DiagRule.reportInvalidStubStatement, Localizer.Diag.defaultValueNotEllipsis(), param.defaultValue);
          }
        }
      });
      const paramSpecParams = node.parameters.filter((param, index) => {
        const paramInfo = functionTypeResult.functionType.details.parameters[index];
        if (paramInfo.typeAnnotation && isTypeVar(paramInfo.type) && isParamSpec(paramInfo.type)) {
          if (paramInfo.category !== ParameterCategory.Simple && paramInfo.typeAnnotation.nodeType === ParseNodeType.MemberAccess) {
            return true;
          }
        }
        return false;
      });
      if (paramSpecParams.length === 1) {
        this._evaluator.addError(Localizer.Diag.paramSpecArgsKwargsUsage(), paramSpecParams[0].typeAnnotation || paramSpecParams[0].typeAnnotationComment!);
      }
      if (this._fileInfo.isStubFile) {
        const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
        if (!returnAnnotation) {
          this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportUnknownParameterType, DiagRule.reportUnknownParameterType, Localizer.Diag.returnTypeUnknown(), node.name);
        }
      }
      if (containingClassNode) {
        this._validateMethod(node, functionTypeResult.functionType, containingClassNode);
      }
    }
    node.parameters.forEach((param, index) => {
      if (param.defaultValue) {
        this.walk(param.defaultValue);
      }
      if (param.typeAnnotation) {
        this.walk(param.typeAnnotation);
      }
      if (param.typeAnnotationComment) {
        this.walk(param.typeAnnotationComment);
      }
      if (functionTypeResult) {
        const annotationNode = param.typeAnnotation || param.typeAnnotationComment;
        if (annotationNode) {
          const paramType = functionTypeResult.functionType.details.parameters[index].type;
          if (isTypeVar(paramType) && paramType.details.variance === Variance.Covariant && !paramType.details.isSynthesized && functionTypeResult.functionType.details.name !== '__init__') {
            this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.paramTypeCovariant(), annotationNode);
          }
        }
      }
    });
    if (node.returnTypeAnnotation) {
      this.walk(node.returnTypeAnnotation);
    }
    if (node.functionAnnotationComment) {
      this.walk(node.functionAnnotationComment);
    }
    this.walkMultiple(node.decorators);
    node.parameters.forEach((param) => {
      if (param.name) {
        this.walk(param.name);
      }
    });
    this.walk(node.suite);
    if (functionTypeResult) {
      this._validateFunctionReturn(node, functionTypeResult.functionType);
    }
    if (this._fileInfo.isStubFile && node.name.value === '__getattr__') {
      const scope = getScopeForNode(node);
      if (scope?.type === ScopeType.Module) {
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportUnknownMemberType, DiagRule.reportUnknownMemberType, Localizer.Diag.stubUsesGetAttr(), node.name);
      }
    }
    this._scopedNodes.push(node);
    this._validateFunctionTypeVarUsage(node);
    if (functionTypeResult && isOverloadedFunction(functionTypeResult.decoratedType)) {
      const overloads = functionTypeResult.decoratedType.overloads;
      if (overloads.length > 1) {
        const maxOverloadConsistencyCheckLength = 100;
        if (overloads.length < maxOverloadConsistencyCheckLength) {
          this._validateOverloadConsistency(node, overloads[overloads.length - 1], overloads.slice(0, overloads.length - 1));
        }
      }
    }
    return false;
  }
  visitLambda(node: LambdaNode): boolean {
    this._evaluator.getType(node);
    this.walkMultiple([...node.parameters, node.expression]);
    node.parameters.forEach((param) => {
      if (param.name) {
        const paramType = this._evaluator.getType(param.name);
        if (paramType) {
          if (isUnknown(paramType)) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType,
              DiagRule.reportUnknownLambdaType,
              Localizer.Diag.paramTypeUnknown().format({ paramName: param.name.value }),
              param.name
            );
          } else if (isPartlyUnknown(paramType)) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType,
              DiagRule.reportUnknownLambdaType,
              Localizer.Diag.paramTypePartiallyUnknown().format({ paramName: param.name.value }),
              param.name
            );
          }
        }
      }
    });
    const returnType = this._evaluator.getType(node.expression);
    if (returnType) {
      if (isUnknown(returnType)) {
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType, DiagRule.reportUnknownLambdaType, Localizer.Diag.lambdaReturnTypeUnknown(), node.expression);
      } else if (isPartlyUnknown(returnType)) {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType,
          DiagRule.reportUnknownLambdaType,
          Localizer.Diag.lambdaReturnTypePartiallyUnknown().format({
            returnType: this._evaluator.printType(returnType, /* expandTypeAlias */ true),
          }),
          node.expression
        );
      }
    }
    this._scopedNodes.push(node);
    return false;
  }
  visitCall(node: CallNode): boolean {
    this._validateIsInstanceCall(node);
    if (ParseTreeUtils.isWithinDefaultParamInitializer(node) && !this._fileInfo.isStubFile) {
      this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportCallInDefaultInitializer, DiagRule.reportCallInDefaultInitializer, Localizer.Diag.defaultValueContainsCall(), node);
    }
    if (this._fileInfo.diagnosticRuleSet.reportUnusedCallResult !== 'none' || this._fileInfo.diagnosticRuleSet.reportUnusedCoroutine !== 'none') {
      if (node.parent?.nodeType === ParseNodeType.StatementList) {
        const returnType = this._evaluator.getType(node);
        if (returnType && this._isTypeValidForUnusedValueTest(returnType)) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportUnusedCallResult,
            DiagRule.reportUnusedCallResult,
            Localizer.Diag.unusedCallResult().format({
              type: this._evaluator.printType(returnType, /* expandTypeAlias */ false),
            }),
            node
          );
          if (isObject(returnType) && ClassType.isBuiltIn(returnType.classType, 'Coroutine')) {
            this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportUnusedCoroutine, DiagRule.reportUnusedCoroutine, Localizer.Diag.unusedCoroutine(), node);
          }
        }
      }
    }
    return true;
  }
  visitAwait(node: AwaitNode) {
    if (this._fileInfo.diagnosticRuleSet.reportUnusedCallResult !== 'none') {
      if (node.parent?.nodeType === ParseNodeType.StatementList && node.expression.nodeType === ParseNodeType.Call) {
        const returnType = this._evaluator.getType(node);
        if (returnType && this._isTypeValidForUnusedValueTest(returnType)) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportUnusedCallResult,
            DiagRule.reportUnusedCallResult,
            Localizer.Diag.unusedCallResult().format({
              type: this._evaluator.printType(returnType, /* expandTypeAlias */ false),
            }),
            node
          );
        }
      }
    }
    return true;
  }
  visitFor(node: ForNode): boolean {
    this._evaluator.evaluateTypesForStatement(node);
    return true;
  }
  visitListComprehension(node: ListComprehensionNode): boolean {
    this._scopedNodes.push(node);
    return true;
  }
  visitIf(node: IfNode): boolean {
    if (
      node.testExpression.nodeType === ParseNodeType.BinaryOp &&
      node.testExpression.operator === OperatorType.Equals &&
      evaluateStaticBoolExpression(node.testExpression, this._fileInfo.executionEnvironment) === undefined
    ) {
      const rightType = this._evaluator.getType(node.testExpression.rightExpression);
      if (rightType && isLiteralTypeOrUnion(rightType)) {
        const leftType = this._evaluator.getType(node.testExpression.leftExpression);
        if (leftType && isLiteralTypeOrUnion(leftType)) {
          let isPossiblyTrue = false;
          doForEachSubtype(leftType, (leftSubtype) => {
            if (this._evaluator.canAssignType(rightType, leftSubtype, new DiagAddendum())) {
              isPossiblyTrue = true;
            }
          });
          if (!isPossiblyTrue) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.comparisonAlwaysFalse().format({
                leftType: this._evaluator.printType(leftType, /* expandTypeAlias */ true),
                rightType: this._evaluator.printType(rightType, /* expandTypeAlias */ true),
              }),
              node.testExpression
            );
          }
        }
      }
    }
    this._evaluator.getType(node.testExpression);
    return true;
  }
  visitWhile(node: WhileNode): boolean {
    this._evaluator.getType(node.testExpression);
    return true;
  }
  visitWith(node: WithNode): boolean {
    node.withItems.forEach((item) => {
      this._evaluator.evaluateTypesForStatement(item);
    });
    return true;
  }
  visitReturn(node: ReturnNode): boolean {
    let returnType: Type;
    const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
    const declaredReturnType = enclosingFunctionNode ? this._evaluator.getFunctionDeclaredReturnType(enclosingFunctionNode) : undefined;
    if (node.returnExpression) {
      returnType = this._evaluator.getType(node.returnExpression) || UnknownType.create();
    } else {
      returnType = NoneType.createInstance();
    }
    if (this._evaluator.isNodeReachable(node) && enclosingFunctionNode) {
      if (declaredReturnType) {
        if (isNoReturnType(declaredReturnType)) {
          this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.noReturnContainsReturn(), node);
        } else {
          const diagAddendum = new DiagAddendum();
          if (!this._evaluator.canAssignType(declaredReturnType, returnType, diagAddendum, /* typeVarMap */ undefined, CanAssignFlags.AllowBoolTypeGuard)) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.returnTypeMismatch().format({
                exprType: this._evaluator.printType(returnType, /* expandTypeAlias */ false),
                returnType: this._evaluator.printType(declaredReturnType, /* expandTypeAlias */ false),
              }) + diagAddendum.getString(),
              node.returnExpression ? node.returnExpression : node
            );
          }
        }
      }
      if (isUnknown(returnType)) {
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportUnknownVariableType, DiagRule.reportUnknownVariableType, Localizer.Diag.returnTypeUnknown(), node.returnExpression!);
      } else if (isPartlyUnknown(returnType)) {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportUnknownVariableType,
          DiagRule.reportUnknownVariableType,
          Localizer.Diag.returnTypePartiallyUnknown().format({
            returnType: this._evaluator.printType(returnType, /* expandTypeAlias */ true),
          }),
          node.returnExpression!
        );
      }
    }
    return true;
  }
  visitYield(node: YieldNode) {
    const yieldType = node.expression ? this._evaluator.getType(node.expression) : NoneType.createInstance();
    this._validateYieldType(node, yieldType || UnknownType.create());
    return true;
  }
  visitYieldFrom(node: YieldFromNode) {
    const yieldFromType = this._evaluator.getType(node.expression) || UnknownType.create();
    let yieldType = this._evaluator.getTypeFromIterable(yieldFromType, /* isAsync */ false, node) || UnknownType.create();
    const generatorTypeArgs = getGeneratorTypeArgs(yieldType);
    if (generatorTypeArgs) {
      yieldType = generatorTypeArgs.length >= 1 ? generatorTypeArgs[0] : UnknownType.create();
    } else {
      yieldType = this._evaluator.getTypeFromIterator(yieldFromType, /* isAsync */ false, node) || UnknownType.create();
    }
    this._validateYieldType(node, yieldType);
    return true;
  }
  visitRaise(node: RaiseNode): boolean {
    this._evaluator.verifyRaiseExceptionType(node);
    if (node.valueExpression) {
      const baseExceptionType = this._evaluator.getBuiltInType(node, 'BaseException') as ClassType;
      const exceptionType = this._evaluator.getType(node.valueExpression);
      if (exceptionType && baseExceptionType && isClass(baseExceptionType)) {
        const diagAddendum = new DiagAddendum();
        doForEachSubtype(exceptionType, (subtype) => {
          subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);
          if (!isAnyOrUnknown(subtype) && !isNone(subtype)) {
            if (isObject(subtype)) {
              if (!derivesFromClassRecursive(subtype.classType, baseExceptionType, /* ignoreUnknown */ false)) {
                diagAddendum.addMessage(
                  Localizer.Diag.exceptionTypeIncorrect().format({
                    type: this._evaluator.printType(subtype, /* expandTypeAlias */ false),
                  })
                );
              }
            } else {
              diagAddendum.addMessage(
                Localizer.Diag.exceptionTypeIncorrect().format({
                  type: this._evaluator.printType(subtype, /* expandTypeAlias */ false),
                })
              );
            }
          }
        });
        if (!diagAddendum.isEmpty()) {
          this._evaluator.addError(Localizer.Diag.expectedExceptionObj() + diagAddendum.getString(), node.valueExpression);
        }
      }
    }
    return true;
  }
  visitExcept(node: ExceptNode): boolean {
    if (node.typeExpression) {
      this._evaluator.evaluateTypesForStatement(node);
      const exceptionType = this._evaluator.getType(node.typeExpression);
      if (exceptionType) {
        this._validateExceptionType(exceptionType, node.typeExpression);
      }
    }
    return true;
  }
  visitAssert(node: AssertNode) {
    if (node.exceptionExpression) {
      this._evaluator.getType(node.exceptionExpression);
    }
    const type = this._evaluator.getType(node.testExpression);
    if (type && isObject(type)) {
      if (isTupleClass(type.classType) && type.classType.tupleTypeArguments) {
        if (type.classType.tupleTypeArguments.length > 0) {
          if (!isOpenEndedTupleClass(type.classType)) {
            this._evaluator.addDiagForTextRange(
              this._fileInfo,
              this._fileInfo.diagnosticRuleSet.reportAssertAlwaysTrue,
              DiagRule.reportAssertAlwaysTrue,
              Localizer.Diag.assertAlwaysTrue(),
              node.testExpression
            );
          }
        }
      }
    }
    return true;
  }
  visitAssignment(node: AssignmentNode): boolean {
    this._evaluator.evaluateTypesForStatement(node);
    if (node.typeAnnotationComment) {
      this._evaluator.getType(node.typeAnnotationComment);
    }
    return true;
  }
  visitAssignmentExpression(node: AssignmentExpressionNode): boolean {
    this._evaluator.getType(node);
    return true;
  }
  visitAugmentedAssignment(node: AugmentedAssignmentNode): boolean {
    this._evaluator.evaluateTypesForStatement(node);
    return true;
  }
  visitIndex(node: IndexNode): boolean {
    this._evaluator.getType(node);
    const subscriptValue = ParseTreeUtils.getIntegerSubscriptValue(node);
    if (subscriptValue !== undefined) {
      const baseType = this._evaluator.getType(node.baseExpression);
      if (baseType && isObject(baseType) && baseType.classType.tupleTypeArguments && !isOpenEndedTupleClass(baseType.classType)) {
        const tupleLength = baseType.classType.tupleTypeArguments.length;
        if (subscriptValue >= tupleLength) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.tupleIndexOutOfRange().format({
              length: tupleLength,
              index: subscriptValue,
            }),
            node
          );
        }
      }
    }
    return true;
  }
  visitBinaryOp(node: BinaryOpNode): boolean {
    this._evaluator.getType(node);
    return true;
  }
  visitSlice(node: SliceNode): boolean {
    this._evaluator.getType(node);
    return true;
  }
  visitUnpack(node: UnpackNode): boolean {
    this._evaluator.getType(node);
    return true;
  }
  visitTuple(node: TupleNode): boolean {
    this._evaluator.getType(node);
    return true;
  }
  visitUnaryOp(node: UnaryOpNode): boolean {
    this._evaluator.getType(node);
    return true;
  }
  visitTernary(node: TernaryNode): boolean {
    this._evaluator.getType(node);
    return true;
  }
  visitStringList(node: StringListNode): boolean {
    if (node.typeAnnotation) {
      this._evaluator.getType(node);
    }
    if (node.strings.length > 1) {
      this._evaluator.addDiagForTextRange(
        this._fileInfo,
        this._fileInfo.diagnosticRuleSet.reportImplicitStringConcatenation,
        DiagRule.reportImplicitStringConcatenation,
        Localizer.Diag.implicitStringConcat(),
        node
      );
    }
    return true;
  }
  visitFormatString(node: FormatStringNode): boolean {
    node.expressions.forEach((formatExpr) => {
      this._evaluator.getType(formatExpr);
    });
    return true;
  }
  visitName(node: NameNode) {
    this._conditionallyReportPrivateUsage(node);
    return true;
  }
  visitDel(node: DelNode) {
    node.expressions.forEach((expr) => {
      this._evaluator.verifyDeleteExpression(expr);
    });
    return true;
  }
  visitMemberAccess(node: MemberAccessNode) {
    this._evaluator.getType(node);
    this._conditionallyReportPrivateUsage(node.memberName);
    this.walk(node.leftExpression);
    return false;
  }
  visitImportAs(node: ImportAsNode): boolean {
    this._evaluator.evaluateTypesForStatement(node);
    return false;
  }
  visitImportFrom(node: ImportFromNode): boolean {
    if (!node.isWildcardImport) {
      node.imports.forEach((importAs) => {
        this._evaluator.evaluateTypesForStatement(importAs);
      });
    } else {
      const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
      if (importInfo && importInfo.isImportFound && importInfo.importType !== ImportType.Local && !this._fileInfo.isStubFile) {
        this._evaluator.addDiagForTextRange(
          this._fileInfo,
          this._fileInfo.diagnosticRuleSet.reportWildcardImportFromLibrary,
          DiagRule.reportWildcardImportFromLibrary,
          Localizer.Diag.wildcardLibraryImport(),
          node.wildcardToken || node
        );
      }
    }
    return false;
  }
  visitTypeAnnotation(node: TypeAnnotationNode): boolean {
    this._evaluator.getType(node.typeAnnotation);
    return true;
  }
  visitMatch(node: MatchNode): boolean {
    this._evaluator.getType(node.subjectExpression);
    return true;
  }
  visitCase(node: CaseNode): boolean {
    if (node.guardExpression) {
      this._evaluator.getType(node.guardExpression);
    }
    this._evaluator.evaluateTypesForStatement(node.pattern);
    return true;
  }
  visitError(node: ErrorNode) {
    if (node.child) {
      this._evaluator.getType(node.child);
    }
    return false;
  }
  private _isTypeValidForUnusedValueTest(type: Type) {
    return !isNone(type) && !isNoReturnType(type) && !isNever(type) && !isAnyOrUnknown(type);
  }
  private _validateFunctionTypeVarUsage(node: FunctionNode) {
    if (this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse === 'none') return;
    const localTypeVarUsage = new Map<string, LocalTypeVarInfo>();
    const nameWalker = new ParseTreeUtils.NameNodeWalker((nameNode, subscriptIndex, baseExpression) => {
      const nameType = this._evaluator.getType(nameNode);
      ``;
      if (nameType && isTypeVar(nameType)) {
        if (nameType.scopeId === this._evaluator.getScopeIdForNode(node)) {
          let isExempt = nameType.details.constraints.length > 0 || (nameType.details.boundType !== undefined && subscriptIndex !== undefined) || isParamSpec(nameType);
          if (!isExempt && baseExpression && subscriptIndex !== undefined) {
            const baseType = this._evaluator.getType(baseExpression);
            if (baseType?.typeAliasInfo && baseType.typeAliasInfo.typeParameters && subscriptIndex < baseType.typeAliasInfo.typeParameters.length) {
              isExempt = true;
            }
          }
          if (!localTypeVarUsage.has(nameType.details.name)) {
            localTypeVarUsage.set(nameType.details.name, {
              nodes: [nameNode],
              isExempt,
            });
          } else {
            localTypeVarUsage.get(nameType.details.name)!.nodes.push(nameNode);
          }
        }
      }
    });
    node.parameters.forEach((param) => {
      const annotation = param.typeAnnotation || param.typeAnnotationComment;
      if (annotation) {
        nameWalker.walk(annotation);
      }
    });
    if (node.returnTypeAnnotation) {
      nameWalker.walk(node.returnTypeAnnotation);
    }
    localTypeVarUsage.forEach((usage) => {
      if (usage.nodes.length === 1 && !usage.isExempt) {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse,
          DiagRule.reportInvalidTypeVarUse,
          Localizer.Diag.typeVarUsedOnlyOnce().format({
            name: usage.nodes[0].value,
          }),
          usage.nodes[0]
        );
      }
    });
  }
  private _validateOverloadConsistency(node: FunctionNode, functionType: FunctionType, prevOverloads: FunctionType[]) {
    for (let i = 0; i < prevOverloads.length; i++) {
      const prevOverload = prevOverloads[i];
      if (FunctionType.isOverloaded(functionType) && FunctionType.isOverloaded(prevOverload) && this._isOverlappingOverload(functionType, prevOverload)) {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportOverlappingOverload,
          DiagRule.reportOverlappingOverload,
          Localizer.Diag.overlappingOverload().format({
            name: node.name.value,
            obscured: prevOverloads.length + 1,
            obscuredBy: i + 1,
          }),
          node.name
        );
        break;
      }
    }
    for (let i = 0; i < prevOverloads.length; i++) {
      const prevOverload = prevOverloads[i];
      if (FunctionType.isOverloaded(functionType) && FunctionType.isOverloaded(prevOverload) && this._isOverlappingOverload(prevOverload, functionType)) {
        const prevReturnType = FunctionType.getSpecializedReturnType(prevOverload);
        const returnType = FunctionType.getSpecializedReturnType(functionType);
        if (prevReturnType && returnType && !this._evaluator.canAssignType(returnType, prevReturnType, new DiagAddendum(), new TypeVarMap(), CanAssignFlags.SkipSolveTypeVars)) {
          const altNode = this._findNodeForOverload(node, prevOverload);
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportOverlappingOverload,
            DiagRule.reportOverlappingOverload,
            Localizer.Diag.overloadReturnTypeMismatch().format({
              name: node.name.value,
              newIndex: prevOverloads.length + 1,
              prevIndex: i + 1,
            }),
            (altNode || node).name
          );
          break;
        }
      }
    }
  }
  private _findNodeForOverload(functionNode: FunctionNode, overloadType: FunctionType): FunctionNode | undefined {
    const decls = this._evaluator.getDeclarationsForNameNode(functionNode.name);
    if (!decls) {
      return undefined;
    }
    for (const decl of decls) {
      if (decl.type === DeclarationType.Function) {
        const functionType = this._evaluator.getTypeOfFunction(decl.node);
        if (functionType?.functionType === overloadType) {
          return decl.node;
        }
      }
    }
    return undefined;
  }
  private _isOverlappingOverload(functionType: FunctionType, prevOverload: FunctionType) {
    return this._evaluator.canAssignType(
      functionType,
      prevOverload,
      new DiagAddendum(),
      /* typeVarMap */ undefined,
      CanAssignFlags.SkipSolveTypeVars | CanAssignFlags.SkipFunctionReturnTypeCheck | CanAssignFlags.DisallowAssignFromAny
    );
  }
  private _isLegalOverloadImplementation(overload: FunctionType, implementation: FunctionType, diag: DiagAddendum): boolean {
    let isLegal = this._evaluator.canAssignType(
      overload,
      implementation,
      diag,
      /* typeVarMap */ undefined,
      CanAssignFlags.SkipSolveTypeVars | CanAssignFlags.SkipFunctionReturnTypeCheck | CanAssignFlags.DisallowAssignFromAny
    );
    const overloadReturnType = overload.details.declaredReturnType || this._evaluator.getFunctionInferredReturnType(overload);
    const implementationReturnType = implementation.details.declaredReturnType || this._evaluator.getFunctionInferredReturnType(implementation);
    const returnDiag = new DiagAddendum();
    if (!this._evaluator.canAssignType(implementationReturnType, overloadReturnType, returnDiag.createAddendum(), /* typeVarMap */ undefined, CanAssignFlags.SkipSolveTypeVars)) {
      returnDiag.addMessage(
        Localizer.DiagAddendum.functionReturnTypeMismatch().format({
          sourceType: this._evaluator.printType(overloadReturnType, /* expandTypeAlias */ false),
          destType: this._evaluator.printType(implementationReturnType, /* expandTypeAlias */ false),
        })
      );
      diag.addAddendum(returnDiag);
      isLegal = false;
    }
    return isLegal;
  }
  private _walkStatementsAndReportUnreachable(statements: StatementNode[]) {
    let reportedUnreachable = false;
    for (const statement of statements) {
      if (!reportedUnreachable) {
        if (!this._evaluator.isNodeReachable(statement)) {
          const start = statement.start;
          const lastStatement = statements[statements.length - 1];
          const end = TextRange.getEnd(lastStatement);
          this._evaluator.addUnusedCode(statement, { start, length: end - start });
          reportedUnreachable = true;
        }
      }
      if (!reportedUnreachable && this._fileInfo.isStubFile) {
        this._validateStubStatement(statement);
      }
      this.walk(statement);
    }
  }
  private _validateStubStatement(statement: StatementNode) {
    switch (statement.nodeType) {
      case ParseNodeType.If:
      case ParseNodeType.Function:
      case ParseNodeType.Class:
      case ParseNodeType.Error: {
        break;
      }
      case ParseNodeType.While:
      case ParseNodeType.For:
      case ParseNodeType.Try:
      case ParseNodeType.With: {
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportInvalidStubStatement, DiagRule.reportInvalidStubStatement, Localizer.Diag.invalidStubStatement(), statement);
        break;
      }
      case ParseNodeType.StatementList: {
        for (const substatement of statement.statements) {
          switch (substatement.nodeType) {
            case ParseNodeType.Assert:
            case ParseNodeType.AssignmentExpression:
            case ParseNodeType.AugmentedAssignment:
            case ParseNodeType.Await:
            case ParseNodeType.BinaryOp:
            case ParseNodeType.Call:
            case ParseNodeType.Constant:
            case ParseNodeType.Del:
            case ParseNodeType.Dictionary:
            case ParseNodeType.Index:
            case ParseNodeType.For:
            case ParseNodeType.FormatString:
            case ParseNodeType.Global:
            case ParseNodeType.Lambda:
            case ParseNodeType.List:
            case ParseNodeType.MemberAccess:
            case ParseNodeType.Name:
            case ParseNodeType.Nonlocal:
            case ParseNodeType.Number:
            case ParseNodeType.Raise:
            case ParseNodeType.Return:
            case ParseNodeType.Set:
            case ParseNodeType.Slice:
            case ParseNodeType.Ternary:
            case ParseNodeType.Tuple:
            case ParseNodeType.Try:
            case ParseNodeType.UnaryOp:
            case ParseNodeType.Unpack:
            case ParseNodeType.While:
            case ParseNodeType.With:
            case ParseNodeType.WithItem:
            case ParseNodeType.Yield:
            case ParseNodeType.YieldFrom: {
              this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportInvalidStubStatement, DiagRule.reportInvalidStubStatement, Localizer.Diag.invalidStubStatement(), substatement);
            }
          }
        }
      }
    }
  }
  private _validateExceptionType(exceptionType: Type, errorNode: ParseNode) {
    const baseExceptionType = this._evaluator.getBuiltInType(errorNode, 'BaseException');
    const derivesFromBaseException = (classType: ClassType) => {
      if (!baseExceptionType || !isClass(baseExceptionType)) {
        return true;
      }
      return derivesFromClassRecursive(classType, baseExceptionType, /* ignoreUnknown */ false);
    };
    const diagAddendum = new DiagAddendum();
    let resultingExceptionType: Type | undefined;
    if (isAnyOrUnknown(exceptionType)) {
      resultingExceptionType = exceptionType;
    } else {
      if (isObject(exceptionType)) {
        exceptionType = transformTypeObjectToClass(exceptionType);
      }
      if (isClass(exceptionType)) {
        if (!derivesFromBaseException(exceptionType)) {
          diagAddendum.addMessage(
            Localizer.Diag.exceptionTypeIncorrect().format({
              type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
            })
          );
        }
        resultingExceptionType = ObjectType.create(exceptionType);
      } else if (isObject(exceptionType)) {
        const iterableType = this._evaluator.getTypeFromIterator(exceptionType, /* isAsync */ false, errorNode) || UnknownType.create();
        resultingExceptionType = mapSubtypes(iterableType, (subtype) => {
          if (isAnyOrUnknown(subtype)) {
            return subtype;
          }
          const transformedSubtype = transformTypeObjectToClass(subtype);
          if (isClass(transformedSubtype)) {
            if (!derivesFromBaseException(transformedSubtype)) {
              diagAddendum.addMessage(
                Localizer.Diag.exceptionTypeIncorrect().format({
                  type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
                })
              );
            }
            return ObjectType.create(transformedSubtype);
          }
          diagAddendum.addMessage(
            Localizer.Diag.exceptionTypeIncorrect().format({
              type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
            })
          );
          return UnknownType.create();
        });
      }
    }
    if (!diagAddendum.isEmpty()) {
      this._evaluator.addError(
        Localizer.Diag.exceptionTypeNotClass().format({
          type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
        }),
        errorNode
      );
    }
    return resultingExceptionType || UnknownType.create();
  }
  private _validateSymbolTables() {
    for (const scopedNode of this._scopedNodes) {
      const scope = AnalyzerNodeInfo.getScope(scopedNode);
      if (scope) {
        scope.symbolTable.forEach((symbol, name) => {
          this._conditionallyReportUnusedSymbol(name, symbol, scope.type);
          this._reportIncompatibleDeclarations(name, symbol);
          this._reportMultipleFinalDeclarations(name, symbol);
          this._reportMultipleTypeAliasDeclarations(name, symbol);
          this._reportInvalidOverload(name, symbol);
        });
      }
    }
  }
  private _reportInvalidOverload(name: string, symbol: Symbol) {
    const typedDecls = symbol.getTypedDeclarations();
    if (typedDecls.length >= 1) {
      const primaryDecl = typedDecls[0];
      if (primaryDecl.type === DeclarationType.Function) {
        const type = this._evaluator.getEffectiveTypeOfSymbol(symbol);
        const functions = isOverloadedFunction(type) ? type.overloads : isFunction(type) ? [type] : [];
        const overloadedFunctions = functions.filter((func) => FunctionType.isOverloaded(func));
        if (overloadedFunctions.length === 1) {
          this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.singleOverload().format({ name }), primaryDecl.node.name);
        }
        if (!this._fileInfo.isStubFile && overloadedFunctions.length > 0) {
          let implementationFunction: FunctionType | undefined;
          if (isOverloadedFunction(type) && !FunctionType.isOverloaded(type.overloads[type.overloads.length - 1])) {
            implementationFunction = type.overloads[type.overloads.length - 1];
          } else if (isFunction(type) && !FunctionType.isOverloaded(type)) {
            implementationFunction = type;
          }
          if (!implementationFunction) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.overloadWithoutImplementation().format({
                name: primaryDecl.node.name.value,
              }),
              primaryDecl.node.name
            );
          } else if (isOverloadedFunction(type)) {
            type.overloads.forEach((overload, index) => {
              if (overload === implementationFunction || !FunctionType.isOverloaded(overload)) return;
              const diag = new DiagAddendum();
              if (!this._isLegalOverloadImplementation(overload, implementationFunction!, diag)) {
                if (implementationFunction!.details.declaration) {
                  const diagnostic = this._evaluator.addDiag(
                    this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagRule.reportGeneralTypeIssues,
                    Localizer.Diag.overloadImplementationMismatch().format({
                      name,
                      index: index + 1,
                    }) + diag.getString(),
                    implementationFunction!.details.declaration.node.name
                  );
                  if (diagnostic && overload.details.declaration) {
                    diagnostic.addRelatedInfo(Localizer.DiagAddendum.overloadMethod(), primaryDecl.path, primaryDecl.range);
                  }
                }
              }
            });
          }
        }
      }
    }
  }
  private _reportMultipleFinalDeclarations(name: string, symbol: Symbol) {
    if (!isFinalVariable(symbol)) return;
    const decls = symbol.getDeclarations();
    let sawFinal = false;
    let sawAssignment = false;
    decls.forEach((decl) => {
      if (isFinalVariableDeclaration(decl)) {
        if (sawFinal) {
          this._evaluator.addError(Localizer.Diag.finalRedeclaration().format({ name }), decl.node);
        }
        sawFinal = true;
      }
      if (decl.type === DeclarationType.Variable && decl.inferredTypeSource) {
        if (sawAssignment) {
          this._evaluator.addError(Localizer.Diag.finalReassigned().format({ name }), decl.node);
        }
        sawAssignment = true;
      }
    });
    if (!sawAssignment && !this._fileInfo.isStubFile) {
      const firstDecl = decls.find((decl) => decl.type === DeclarationType.Variable && decl.isFinal);
      if (firstDecl) {
        this._evaluator.addError(Localizer.Diag.finalUnassigned().format({ name }), firstDecl.node);
      }
    }
  }
  private _reportMultipleTypeAliasDeclarations(name: string, symbol: Symbol) {
    const decls = symbol.getDeclarations();
    const typeAliasDecl = decls.find((decl) => isExplicitTypeAliasDeclaration(decl));
    if (typeAliasDecl && decls.length > 1) {
      decls.forEach((decl) => {
        if (decl !== typeAliasDecl) {
          this._evaluator.addError(Localizer.Diag.typeAliasRedeclared().format({ name }), decl.node);
        }
      });
    }
  }
  private _reportIncompatibleDeclarations(name: string, symbol: Symbol) {
    const primaryDecl = getLastTypedDeclaredForSymbol(symbol);
    if (!primaryDecl) return;
    let otherDecls = symbol.getDeclarations().filter((decl) => decl !== primaryDecl);
    if (primaryDecl.type === DeclarationType.Function) {
      const primaryDeclTypeInfo = this._evaluator.getTypeOfFunction(primaryDecl.node);
      otherDecls = otherDecls.filter((decl) => {
        if (decl.type !== DeclarationType.Function) {
          return true;
        }
        const funcTypeInfo = this._evaluator.getTypeOfFunction(decl.node);
        if (!funcTypeInfo) {
          return true;
        }
        if (
          primaryDeclTypeInfo &&
          isObject(primaryDeclTypeInfo.decoratedType) &&
          ClassType.isPropertyClass(primaryDeclTypeInfo.decoratedType.classType) &&
          isObject(funcTypeInfo.decoratedType) &&
          ClassType.isPropertyClass(funcTypeInfo.decoratedType.classType)
        ) {
          return funcTypeInfo.decoratedType.classType.details.typeSourceId !== primaryDeclTypeInfo!.decoratedType.classType.details.typeSourceId;
        }
        return !FunctionType.isOverloaded(funcTypeInfo.functionType);
      });
    }
    if (otherDecls.length === 0) return;
    let primaryDeclInfo: string;
    if (primaryDecl.type === DeclarationType.Function) {
      if (primaryDecl.isMethod) {
        primaryDeclInfo = Localizer.DiagAddendum.seeMethodDeclaration();
      } else {
        primaryDeclInfo = Localizer.DiagAddendum.seeFunctionDeclaration();
      }
    } else if (primaryDecl.type === DeclarationType.Class) {
      primaryDeclInfo = Localizer.DiagAddendum.seeClassDeclaration();
    } else if (primaryDecl.type === DeclarationType.Parameter) {
      primaryDeclInfo = Localizer.DiagAddendum.seeParameterDeclaration();
    } else if (primaryDecl.type === DeclarationType.Variable) {
      primaryDeclInfo = Localizer.DiagAddendum.seeVariableDeclaration();
    } else {
      primaryDeclInfo = Localizer.DiagAddendum.seeDeclaration();
    }
    const addPrimaryDeclInfo = (diag?: Diag) => {
      if (diag) {
        let primaryDeclNode: ParseNode | undefined;
        if (primaryDecl.type === DeclarationType.Function || primaryDecl.type === DeclarationType.Class) {
          primaryDeclNode = primaryDecl.node.name;
        } else if (primaryDecl.type === DeclarationType.Variable) {
          if (primaryDecl.node.nodeType === ParseNodeType.Name) {
            primaryDeclNode = primaryDecl.node;
          }
        } else if (primaryDecl.type === DeclarationType.Parameter) {
          if (primaryDecl.node.name) {
            primaryDeclNode = primaryDecl.node.name;
          }
        }
        if (primaryDeclNode) {
          diag.addRelatedInfo(primaryDeclInfo, primaryDecl.path, primaryDecl.range);
        }
      }
    };
    for (const otherDecl of otherDecls) {
      if (otherDecl.type === DeclarationType.Class) {
        const diag = this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          Localizer.Diag.obscuredClassDeclaration().format({ name }),
          otherDecl.node.name
        );
        addPrimaryDeclInfo(diag);
      } else if (otherDecl.type === DeclarationType.Function) {
        const diag = this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
          DiagRule.reportGeneralTypeIssues,
          otherDecl.isMethod ? Localizer.Diag.obscuredMethodDeclaration().format({ name }) : Localizer.Diag.obscuredFunctionDeclaration().format({ name }),
          otherDecl.node.name
        );
        addPrimaryDeclInfo(diag);
      } else if (otherDecl.type === DeclarationType.Parameter) {
        if (otherDecl.node.name) {
          const diag = this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.obscuredParameterDeclaration().format({ name }),
            otherDecl.node.name
          );
          addPrimaryDeclInfo(diag);
        }
      } else if (otherDecl.type === DeclarationType.Variable) {
        const primaryType = this._evaluator.getTypeForDeclaration(primaryDecl);
        if (otherDecl.typeAnnotationNode) {
          if (otherDecl.node.nodeType === ParseNodeType.Name) {
            let duplicateIsOk = false;
            if (primaryDecl.type === DeclarationType.Variable) {
              const otherType = this._evaluator.getTypeForDeclaration(otherDecl);
              if (primaryType && otherType && isTypeSame(primaryType, otherType)) {
                duplicateIsOk = true;
              }
            }
            if (!duplicateIsOk) {
              const diag = this._evaluator.addDiag(
                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                Localizer.Diag.obscuredVariableDeclaration().format({ name }),
                otherDecl.node
              );
              addPrimaryDeclInfo(diag);
            }
          }
        } else if (primaryType && !isProperty(primaryType)) {
          if (primaryDecl.type === DeclarationType.Function || primaryDecl.type === DeclarationType.Class) {
            const diag = this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
              DiagRule.reportGeneralTypeIssues,
              Localizer.Diag.obscuredVariableDeclaration().format({ name }),
              otherDecl.node
            );
            addPrimaryDeclInfo(diag);
          }
        }
      }
    }
  }
  private _conditionallyReportUnusedSymbol(name: string, symbol: Symbol, scopeType: ScopeType) {
    const accessedSymbolMap = this._fileInfo.accessedSymbolMap;
    if (symbol.isIgnoredForProtocolMatch() || accessedSymbolMap.has(symbol.id)) return;
    if (name === '_') return;
    if (SymbolNameUtils.isDunderName(name)) return;
    const decls = symbol.getDeclarations();
    decls.forEach((decl) => {
      this._conditionallyReportUnusedDeclaration(decl, this._isSymbolPrivate(name, scopeType));
    });
  }
  private _conditionallyReportUnusedDeclaration(decl: Declaration, isPrivate: boolean) {
    let diagnosticLevel: DiagLevel;
    let nameNode: NameNode | undefined;
    let message: string | undefined;
    let rule: DiagRule | undefined;
    switch (decl.type) {
      case DeclarationType.Alias:
        diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedImport;
        rule = DiagRule.reportUnusedImport;
        if (decl.node.nodeType === ParseNodeType.ImportAs) {
          if (decl.node.alias) {
            if (!this._fileInfo.isStubFile) {
              nameNode = decl.node.alias;
            }
          } else {
            const nameParts = decl.node.module.nameParts;
            if (nameParts.length > 0) {
              const multipartName = nameParts.map((np) => np.value).join('.');
              const textRange: TextRange = { start: nameParts[0].start, length: nameParts[0].length };
              TextRange.extend(textRange, nameParts[nameParts.length - 1]);
              this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(Localizer.Diag.unaccessedSymbol().format({ name: multipartName }), textRange, { action: Commands.unusedImport });
              this._evaluator.addDiagForTextRange(
                this._fileInfo,
                this._fileInfo.diagnosticRuleSet.reportUnusedImport,
                DiagRule.reportUnusedImport,
                Localizer.Diag.unaccessedImport().format({ name: multipartName }),
                textRange
              );
              return;
            }
          }
        } else if (decl.node.nodeType === ParseNodeType.ImportFromAs) {
          const importFrom = decl.node.parent as ImportFromNode;
          const isReexport = this._fileInfo.isStubFile && decl.node.alias !== undefined;
          const isFuture = importFrom.module.nameParts.length === 1 && importFrom.module.nameParts[0].value === '__future__';
          if (!isReexport && !isFuture) {
            nameNode = decl.node.alias || decl.node.name;
          }
        }
        if (nameNode) {
          message = Localizer.Diag.unaccessedImport().format({ name: nameNode.value });
        }
        break;
      case DeclarationType.Variable:
      case DeclarationType.Parameter:
        if (!isPrivate) return;
        if (this._fileInfo.isStubFile) return;
        diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedVariable;
        if (decl.node.nodeType === ParseNodeType.Name) {
          nameNode = decl.node;
        } else if (decl.node.nodeType === ParseNodeType.Parameter) {
          nameNode = decl.node.name;
          diagnosticLevel = 'none';
        }
        if (nameNode) {
          rule = DiagRule.reportUnusedVariable;
          message = Localizer.Diag.unaccessedVariable().format({ name: nameNode.value });
        }
        break;
      case DeclarationType.Class:
        if (!isPrivate) return;
        if (this._fileInfo.isStubFile) return;
        diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedClass;
        nameNode = decl.node.name;
        rule = DiagRule.reportUnusedClass;
        message = Localizer.Diag.unaccessedClass().format({ name: nameNode.value });
        break;
      case DeclarationType.Function:
        if (!isPrivate) return;
        if (this._fileInfo.isStubFile) return;
        diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedFunction;
        nameNode = decl.node.name;
        rule = DiagRule.reportUnusedFunction;
        message = Localizer.Diag.unaccessedFunction().format({ name: nameNode.value });
        break;
      default:
        return;
    }
    if (nameNode && rule !== undefined && message) {
      const action = rule === DiagRule.reportUnusedImport ? { action: Commands.unusedImport } : undefined;
      this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(Localizer.Diag.unaccessedSymbol().format({ name: nameNode.value }), nameNode, action);
      this._evaluator.addDiag(diagnosticLevel, rule, message, nameNode);
    }
  }
  private _validateIsInstanceCall(node: CallNode) {
    if (node.leftExpression.nodeType !== ParseNodeType.Name || (node.leftExpression.value !== 'isinstance' && node.leftExpression.value !== 'issubclass') || node.arguments.length !== 2) return;
    const callName = node.leftExpression.value;
    const isInstanceCheck = callName === 'isinstance';
    let arg0Type = this._evaluator.getType(node.arguments[0].valueExpression);
    if (!arg0Type) return;
    arg0Type = mapSubtypes(arg0Type, (subtype) => {
      return transformPossibleRecursiveTypeAlias(transformTypeObjectToClass(subtype));
    });
    if (derivesFromAnyOrUnknown(arg0Type)) return;
    const arg1Type = this._evaluator.getType(node.arguments[1].valueExpression);
    if (!arg1Type) return;
    const isSupportedTypeForIsInstance = (type: Type) => {
      let isSupported = true;
      doForEachSubtype(type, (subtype) => {
        subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);
        switch (subtype.category) {
          case TypeCategory.Any:
          case TypeCategory.Unknown:
          case TypeCategory.Unbound:
            break;
          case TypeCategory.Object:
            isSupported = ClassType.isBuiltIn(subtype.classType, 'type');
            break;
          case TypeCategory.Class:
            if (subtype.isTypeArgumentExplicit) {
              isSupported = false;
            }
            break;
          case TypeCategory.Function:
            isSupported = TypeBase.isInstantiable(subtype);
            break;
          default:
            isSupported = false;
            break;
        }
      });
      return isSupported;
    };
    let isValidType = true;
    if (isObject(arg1Type) && ClassType.isTupleClass(arg1Type.classType) && arg1Type.classType.tupleTypeArguments) {
      isValidType = !arg1Type.classType.tupleTypeArguments.some((typeArg) => !isSupportedTypeForIsInstance(typeArg));
    } else {
      isValidType = isSupportedTypeForIsInstance(arg1Type);
    }
    if (!isValidType) {
      const diag = new DiagAddendum();
      diag.addMessage(Localizer.DiagAddendum.typeVarNotAllowed());
      this._evaluator.addDiag(
        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
        DiagRule.reportGeneralTypeIssues,
        isInstanceCheck
          ? Localizer.Diag.isInstanceInvalidType().format({
              type: this._evaluator.printType(arg1Type, /* expandTypeAlias */ false),
            }) + diag.getString()
          : Localizer.Diag.isSubclassInvalidType().format({
              type: this._evaluator.printType(arg1Type, /* expandTypeAlias */ false),
            }) + diag.getString(),
        node.arguments[1]
      );
    }
    let curNode: ParseNode | undefined = node;
    while (curNode) {
      if (curNode.nodeType === ParseNodeType.Assert) return;
      curNode = curNode.parent;
    }
    const nonstandardClassTypes = ['FunctionType', 'LambdaType', 'BuiltinFunctionType', 'BuiltinMethodType', 'type', 'Type'];
    const classTypeList: ClassType[] = [];
    if (isClass(arg1Type)) {
      classTypeList.push(arg1Type);
      if (ClassType.isBuiltIn(arg1Type) && nonstandardClassTypes.some((name) => name === arg1Type.details.name)) return;
    } else if (isObject(arg1Type)) {
      const objClass = arg1Type.classType;
      if (isTupleClass(objClass) && objClass.tupleTypeArguments) {
        objClass.tupleTypeArguments.forEach((typeArg) => {
          if (isClass(typeArg)) {
            classTypeList.push(typeArg);
          } else return;
        });
      }
      if (ClassType.isBuiltIn(objClass) && nonstandardClassTypes.some((name) => name === objClass.details.name)) return;
    } else return;
    if (classTypeList.some((type) => ClassType.isProtocolClass(type) && !ClassType.isRuntimeCheckable(type))) {
      this._evaluator.addError(Localizer.Diag.protocolUsedInCall().format({ name: callName }), node.arguments[1].valueExpression);
    }
    const finalizeFilteredTypeList = (types: Type[]): Type => {
      return combineTypes(types);
    };
    const filterType = (varType: ClassType): Type[] => {
      const filteredTypes: Type[] = [];
      for (const filterType of classTypeList) {
        const filterIsSuperclass = ClassType.isDerivedFrom(varType, filterType) || (ClassType.isBuiltIn(filterType, 'dict') && ClassType.isTypedDictClass(varType));
        const filterIsSubclass = ClassType.isDerivedFrom(filterType, varType);
        const isClassRelationshipIndeterminate = filterIsSubclass && filterIsSubclass && !ClassType.isSameGenericClass(varType, filterType);
        if (isClassRelationshipIndeterminate) {
          filteredTypes.push(UnknownType.create());
        } else if (filterIsSuperclass) {
          filteredTypes.push(varType);
        } else if (filterIsSubclass) {
          filteredTypes.push(filterType);
        }
      }
      if (!isInstanceCheck) {
        return filteredTypes;
      }
      return filteredTypes.map((t) => (isClass(t) ? ObjectType.create(t) : t));
    };
    let filteredType: Type;
    if (isInstanceCheck && isObject(arg0Type)) {
      const remainingTypes = filterType(arg0Type.classType);
      filteredType = finalizeFilteredTypeList(remainingTypes);
    } else if (!isInstanceCheck && isClass(arg0Type)) {
      const remainingTypes = filterType(arg0Type);
      filteredType = finalizeFilteredTypeList(remainingTypes);
    } else if (isUnion(arg0Type)) {
      let remainingTypes: Type[] = [];
      let foundAnyType = false;
      doForEachSubtype(arg0Type, (subtype) => {
        if (isAnyOrUnknown(subtype)) {
          foundAnyType = true;
        }
        if (isInstanceCheck && isObject(subtype)) {
          remainingTypes = remainingTypes.concat(filterType(subtype.classType));
        } else if (!isInstanceCheck && isClass(subtype)) {
          remainingTypes = remainingTypes.concat(filterType(subtype));
        }
      });
      filteredType = finalizeFilteredTypeList(remainingTypes);
      if (foundAnyType) return;
    } else return;
    const getTestType = () => {
      const objTypeList = classTypeList.map((t) => ObjectType.create(t));
      return combineTypes(objTypeList);
    };
    if (isNever(filteredType)) {
      this._evaluator.addDiag(
        this._fileInfo.diagnosticRuleSet.reportUnnecessaryIsInstance,
        DiagRule.reportUnnecessaryIsInstance,
        isInstanceCheck
          ? Localizer.Diag.unnecessaryIsInstanceNever().format({
              testType: this._evaluator.printType(arg0Type, /* expandTypeAlias */ false),
              classType: this._evaluator.printType(getTestType(), /* expandTypeAlias */ false),
            })
          : Localizer.Diag.unnecessaryIsSubclassNever().format({
              testType: this._evaluator.printType(arg0Type, /* expandTypeAlias */ false),
              classType: this._evaluator.printType(getTestType(), /* expandTypeAlias */ false),
            }),
        node
      );
    } else if (isTypeSame(filteredType, arg0Type)) {
      this._evaluator.addDiag(
        this._fileInfo.diagnosticRuleSet.reportUnnecessaryIsInstance,
        DiagRule.reportUnnecessaryIsInstance,
        isInstanceCheck
          ? Localizer.Diag.unnecessaryIsInstanceAlways().format({
              testType: this._evaluator.printType(arg0Type, /* expandTypeAlias */ false),
              classType: this._evaluator.printType(getTestType(), /* expandTypeAlias */ false),
            })
          : Localizer.Diag.unnecessaryIsSubclassAlways().format({
              testType: this._evaluator.printType(arg0Type, /* expandTypeAlias */ false),
              classType: this._evaluator.printType(getTestType(), /* expandTypeAlias */ false),
            }),
        node
      );
    }
  }
  private _isSymbolPrivate(nameValue: string, scopeType: ScopeType) {
    if (scopeType === ScopeType.Function || scopeType === ScopeType.ListComprehension) {
      return true;
    }
    if (SymbolNameUtils.isPrivateName(nameValue)) {
      return true;
    }
    if (SymbolNameUtils.isProtectedName(nameValue)) {
      const isClassScope = scopeType === ScopeType.Class;
      return !isClassScope;
    }
    return false;
  }
  private _conditionallyReportPrivateUsage(node: NameNode) {
    if (this._fileInfo.diagnosticRuleSet.reportPrivateUsage === 'none') return;
    if (this._fileInfo.isStubFile) return;
    if (node.parent?.nodeType === ParseNodeType.Argument && node.parent.name === node) return;
    const nameValue = node.value;
    const isPrivateName = SymbolNameUtils.isPrivateName(nameValue);
    const isProtectedName = SymbolNameUtils.isProtectedName(nameValue);
    if (!isPrivateName && !isProtectedName) return;
    const declarations = this._evaluator.getDeclarationsForNameNode(node);
    let primaryDeclaration = declarations && declarations.length > 0 ? declarations[declarations.length - 1] : undefined;
    if (!primaryDeclaration || primaryDeclaration.node === node) return;
    if (primaryDeclaration.type === DeclarationType.Alias && primaryDeclaration.usesLocalName) return;
    primaryDeclaration = this._evaluator.resolveAliasDeclaration(primaryDeclaration, /* resolveLocalNames */ true);
    if (!primaryDeclaration || primaryDeclaration.node === node) return;
    let classOrModuleNode: ClassNode | ModuleNode | undefined;
    if (primaryDeclaration.node) {
      classOrModuleNode = ParseTreeUtils.getEnclosingClassOrModule(primaryDeclaration.node);
    }
    if (primaryDeclaration.node && primaryDeclaration.node.parent && primaryDeclaration.node.parent === classOrModuleNode && classOrModuleNode.nodeType === ParseNodeType.Class) {
      classOrModuleNode = ParseTreeUtils.getEnclosingClassOrModule(classOrModuleNode);
    }
    let isProtectedAccess = false;
    if (classOrModuleNode && classOrModuleNode.nodeType === ParseNodeType.Class) {
      if (isProtectedName) {
        const declClassTypeInfo = this._evaluator.getTypeOfClass(classOrModuleNode);
        if (declClassTypeInfo && isClass(declClassTypeInfo.decoratedType)) {
          isProtectedAccess = true;
          const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node);
          if (enclosingClassNode) {
            isProtectedAccess = true;
            const enclosingClassTypeInfo = this._evaluator.getTypeOfClass(enclosingClassNode);
            if (enclosingClassTypeInfo && isClass(enclosingClassTypeInfo.decoratedType)) {
              if (derivesFromClassRecursive(enclosingClassTypeInfo.decoratedType, declClassTypeInfo.decoratedType, /* ignoreUnknown */ true)) return;
            }
          }
        }
      }
    }
    if (classOrModuleNode && !ParseTreeUtils.isNodeContainedWithin(node, classOrModuleNode)) {
      if (isProtectedAccess) {
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportPrivateUsage, DiagRule.reportPrivateUsage, Localizer.Diag.protectedUsedOutsideOfClass().format({ name: nameValue }), node);
      } else {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportPrivateUsage,
          DiagRule.reportPrivateUsage,
          classOrModuleNode.nodeType === ParseNodeType.Class
            ? Localizer.Diag.privateUsedOutsideOfClass().format({ name: nameValue })
            : Localizer.Diag.privateUsedOutsideOfModule().format({ name: nameValue }),
          node
        );
      }
    }
  }
  private _validateTypedDictClassSuite(suiteNode: SuiteNode) {
    const emitBadStatementError = (node: ParseNode) => {
      this._evaluator.addError(Localizer.Diag.typedDictBadVar(), node);
    };
    suiteNode.statements.forEach((statement) => {
      if (!AnalyzerNodeInfo.isCodeUnreachable(statement)) {
        if (statement.nodeType === ParseNodeType.StatementList) {
          for (const substatement of statement.statements) {
            if (
              substatement.nodeType !== ParseNodeType.TypeAnnotation &&
              substatement.nodeType !== ParseNodeType.Ellipsis &&
              substatement.nodeType !== ParseNodeType.StringList &&
              substatement.nodeType !== ParseNodeType.Pass
            ) {
              emitBadStatementError(substatement);
            }
          }
        } else {
          emitBadStatementError(statement);
        }
      }
    });
  }
  private _validateFunctionReturn(node: FunctionNode, functionType: FunctionType) {
    if (this._fileInfo.isStubFile) return;
    const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
    if (returnAnnotation) {
      const functionNeverReturns = !this._evaluator.isAfterNodeReachable(node);
      const implicitlyReturnsNone = this._evaluator.isAfterNodeReachable(node.suite);
      let declaredReturnType = functionType.details.declaredReturnType;
      if (declaredReturnType) {
        if (isUnknown(declaredReturnType)) {
          this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportUnknownVariableType, DiagRule.reportUnknownVariableType, Localizer.Diag.declaredReturnTypeUnknown(), returnAnnotation);
        } else if (isPartlyUnknown(declaredReturnType)) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportUnknownVariableType,
            DiagRule.reportUnknownVariableType,
            Localizer.Diag.declaredReturnTypePartiallyUnknown().format({
              returnType: this._evaluator.printType(declaredReturnType, /* expandTypeAlias */ true),
            }),
            returnAnnotation
          );
        }
        const diag = new DiagAddendum();
        const scopeId = this._evaluator.getScopeIdForNode(node);
        if (this._containsContravariantTypeVar(declaredReturnType, scopeId, diag)) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.returnTypeContravariant() + diag.getString(),
            returnAnnotation
          );
        }
      }
      if (FunctionType.isGenerator(functionType)) {
        declaredReturnType = getDeclaredGeneratorReturnType(functionType);
      }
      if (declaredReturnType && !functionNeverReturns && implicitlyReturnsNone) {
        if (isNoReturnType(declaredReturnType)) {
          if (!ParseTreeUtils.isSuiteEmpty(node.suite)) {
            this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.noReturnReturnsNone(), returnAnnotation);
          }
        } else if (!FunctionType.isAbstractMethod(functionType)) {
          const diagAddendum = new DiagAddendum();
          if (!this._evaluator.canAssignType(declaredReturnType, NoneType.createInstance(), diagAddendum)) {
            if (!ParseTreeUtils.isSuiteEmpty(node.suite)) {
              this._evaluator.addDiag(
                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagRule.reportGeneralTypeIssues,
                Localizer.Diag.returnMissing().format({
                  returnType: this._evaluator.printType(declaredReturnType, /* expandTypeAlias */ false),
                }) + diagAddendum.getString(),
                returnAnnotation
              );
            }
          }
        }
      }
    } else {
      const inferredReturnType = this._evaluator.getFunctionInferredReturnType(functionType);
      if (isUnknown(inferredReturnType)) {
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportUnknownParameterType, DiagRule.reportUnknownParameterType, Localizer.Diag.returnTypeUnknown(), node.name);
      } else if (isPartlyUnknown(inferredReturnType)) {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
          DiagRule.reportUnknownParameterType,
          Localizer.Diag.returnTypePartiallyUnknown().format({
            returnType: this._evaluator.printType(inferredReturnType, /* expandTypeAlias */ true),
          }),
          node.name
        );
      }
    }
  }
  private _containsContravariantTypeVar(type: Type, scopeId: string, diag: DiagAddendum): boolean {
    let isValid = true;
    doForEachSubtype(type, (subtype) => {
      if (isTypeVar(subtype) && subtype.details.variance === Variance.Contravariant) {
        if (subtype.scopeId !== scopeId) {
          diag.addMessage(
            Localizer.DiagAddendum.typeVarIsContravariant().format({
              name: TypeVarType.getReadableName(subtype),
            })
          );
          isValid = false;
        }
      }
    });
    return !isValid;
  }
  private _validateFinalMemberOverrides(classType: ClassType) {
    classType.details.fields.forEach((localSymbol, name) => {
      const parentSymbol = lookUpClassMember(classType, name, ClassMemberLookupFlags.SkipOriginalClass);
      if (parentSymbol && isClass(parentSymbol.classType) && isFinalVariable(parentSymbol.symbol) && !SymbolNameUtils.isPrivateName(name)) {
        const decl = localSymbol.getDeclarations()[0];
        this._evaluator.addError(
          Localizer.Diag.finalRedeclarationBySubclass().format({
            name,
            className: parentSymbol.classType.details.name,
          }),
          decl.node
        );
      }
    });
  }
  private _validateProtocolTypeParamVariance(errorNode: ClassNode, classType: ClassType) {
    const origTypeParams = classType.details.typeParameters;
    if (origTypeParams.length === 0) return;
    const objectType = this._evaluator.getBuiltInType(errorNode, 'object');
    if (!isClass(objectType)) return;
    const updatedTypeParams = origTypeParams.map((typeParam) => TypeVarType.cloneAsInvariant(typeParam));
    const updatedClassType = ClassType.cloneWithNewTypeParameters(classType, updatedTypeParams);
    const objectObject = ObjectType.create(objectType);
    updatedTypeParams.forEach((param, paramIndex) => {
      const srcTypeArgs = updatedTypeParams.map((_, i) => {
        return i === paramIndex ? objectObject : AnyType.create();
      });
      const destTypeArgs = updatedTypeParams.map((p, i) => {
        return i === paramIndex ? p : AnyType.create();
      });
      const srcType = ClassType.cloneForSpecialization(updatedClassType, srcTypeArgs, /* isTypeArgumentExplicit */ true);
      const destType = ClassType.cloneForSpecialization(updatedClassType, destTypeArgs, /* isTypeArgumentExplicit */ true);
      const isDestSubtypeOfSrc = this._evaluator.canAssignProtocolClassToSelf(srcType, destType);
      let expectedVariance: Variance;
      if (isDestSubtypeOfSrc) {
        expectedVariance = Variance.Covariant;
      } else {
        const isSrcSubtypeOfDest = this._evaluator.canAssignProtocolClassToSelf(destType, srcType);
        if (isSrcSubtypeOfDest) {
          expectedVariance = Variance.Contravariant;
        } else {
          expectedVariance = Variance.Invariant;
        }
      }
      if (expectedVariance !== origTypeParams[paramIndex].details.variance) {
        let message: string;
        if (expectedVariance === Variance.Covariant) {
          message = Localizer.Diag.protocolVarianceCovariant().format({
            variable: param.details.name,
            class: classType.details.name,
          });
        } else if (expectedVariance === Variance.Contravariant) {
          message = Localizer.Diag.protocolVarianceContravariant().format({
            variable: param.details.name,
            class: classType.details.name,
          });
        } else {
          message = Localizer.Diag.protocolVarianceInvariant().format({
            variable: param.details.name,
            class: classType.details.name,
          });
        }
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse, DiagRule.reportInvalidTypeVarUse, message, errorNode.name);
      }
    });
  }
  private _validateClassMethods(classType: ClassType) {
    if (!this._fileInfo.isStubFile) {
      this._validateBaseClassOverrides(classType);
    }
  }
  private _validateBaseClassOverrides(classType: ClassType) {
    classType.details.fields.forEach((symbol, name) => {
      if (!symbol.isClassMember()) return;
      if (SymbolNameUtils.isPrivateName(name)) return;
      const typeOfSymbol = this._evaluator.getEffectiveTypeOfSymbol(symbol);
      if (isAnyOrUnknown(typeOfSymbol)) return;
      const baseClassAndSymbol = lookUpClassMember(classType, name, ClassMemberLookupFlags.SkipOriginalClass);
      if (!baseClassAndSymbol || !isClass(baseClassAndSymbol.classType)) return;
      if (!baseClassAndSymbol.symbol.hasTypedDeclarations()) return;
      const baseClassSymbolType = partiallySpecializeType(this._evaluator.getEffectiveTypeOfSymbol(baseClassAndSymbol.symbol), baseClassAndSymbol.classType);
      if (isFunction(baseClassSymbolType) || isOverloadedFunction(baseClassSymbolType)) {
        const diagAddendum = new DiagAddendum();
        let overrideFunction: FunctionType | undefined;
        if (isFunction(typeOfSymbol)) {
          overrideFunction = typeOfSymbol;
        } else if (isOverloadedFunction(typeOfSymbol)) {
          overrideFunction = typeOfSymbol.overloads[typeOfSymbol.overloads.length - 1];
        }
        if (overrideFunction) {
          if (!SymbolNameUtils.isDunderName(name) && !SymbolNameUtils.isPrivateName(name)) {
            if (!this._evaluator.canOverrideMethod(baseClassSymbolType, overrideFunction, diagAddendum)) {
              const decl = overrideFunction.details.declaration;
              if (decl && decl.type === DeclarationType.Function) {
                const diag = this._evaluator.addDiag(
                  this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                  DiagRule.reportIncompatibleMethodOverride,
                  Localizer.Diag.incompatibleMethodOverride().format({
                    name,
                    className: baseClassAndSymbol.classType.details.name,
                  }) + diagAddendum.getString(),
                  decl.node.name
                );
                const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                if (diag && origDecl) {
                  diag.addRelatedInfo(Localizer.DiagAddendum.overriddenMethod(), origDecl.path, origDecl.range);
                }
              }
            }
          }
          if (isFunction(baseClassSymbolType)) {
            if (!SymbolNameUtils.isPrivateName(name) && FunctionType.isFinal(baseClassSymbolType)) {
              const decl = getLastTypedDeclaredForSymbol(symbol);
              if (decl && decl.type === DeclarationType.Function) {
                const diag = this._evaluator.addError(
                  Localizer.Diag.finalMethodOverride().format({
                    name,
                    className: baseClassAndSymbol.classType.details.name,
                  }),
                  decl.node.name
                );
                const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                if (diag && origDecl) {
                  diag.addRelatedInfo(Localizer.DiagAddendum.finalMethod(), origDecl.path, origDecl.range);
                }
              }
            }
          }
        } else if (!isAnyOrUnknown(typeOfSymbol)) {
          const decls = symbol.getDeclarations();
          if (decls.length > 0) {
            const lastDecl = decls[decls.length - 1];
            const diag = this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
              DiagRule.reportIncompatibleMethodOverride,
              Localizer.Diag.methodOverridden().format({
                name,
                className: baseClassAndSymbol.classType.details.name,
                type: this._evaluator.printType(typeOfSymbol, /* expandTypeAlias */ false),
              }),
              lastDecl.node
            );
            const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
            if (diag && origDecl) {
              diag.addRelatedInfo(Localizer.DiagAddendum.overriddenMethod(), origDecl.path, origDecl.range);
            }
          }
        }
      } else if (isProperty(baseClassSymbolType)) {
        if (!isProperty(typeOfSymbol)) {
          const decls = symbol.getDeclarations();
          if (decls.length > 0) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
              DiagRule.reportIncompatibleMethodOverride,
              Localizer.Diag.propertyOverridden().format({
                name,
                className: baseClassAndSymbol.classType.details.name,
              }),
              decls[decls.length - 1].node
            );
          }
        } else {
          const basePropFields = baseClassSymbolType.classType.details.fields;
          const subclassPropFields = typeOfSymbol.classType.details.fields;
          const baseClassType = baseClassAndSymbol.classType;
          ['fget', 'fset', 'fdel'].forEach((methodName) => {
            const diagAddendum = new DiagAddendum();
            const baseClassPropMethod = basePropFields.get(methodName);
            const subclassPropMethod = subclassPropFields.get(methodName);
            if (baseClassPropMethod) {
              const baseClassMethodType = partiallySpecializeType(this._evaluator.getEffectiveTypeOfSymbol(baseClassPropMethod), baseClassType);
              if (isFunction(baseClassMethodType)) {
                if (!subclassPropMethod) {
                  diagAddendum.addMessage(
                    Localizer.DiagAddendum.propertyMethodMissing().format({
                      name: methodName,
                    })
                  );
                  const decls = symbol.getDeclarations();
                  if (decls.length > 0) {
                    const diag = this._evaluator.addDiag(
                      this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                      DiagRule.reportIncompatibleMethodOverride,
                      Localizer.Diag.propertyOverridden().format({
                        name,
                        className: baseClassType.details.name,
                      }) + diagAddendum.getString(),
                      decls[decls.length - 1].node
                    );
                    const origDecl = baseClassMethodType.details.declaration;
                    if (diag && origDecl) {
                      diag.addRelatedInfo(Localizer.DiagAddendum.overriddenMethod(), origDecl.path, origDecl.range);
                    }
                  }
                } else {
                  const subclassMethodType = partiallySpecializeType(this._evaluator.getEffectiveTypeOfSymbol(subclassPropMethod), classType);
                  if (isFunction(subclassMethodType)) {
                    if (!this._evaluator.canOverrideMethod(baseClassMethodType, subclassMethodType, diagAddendum.createAddendum())) {
                      diagAddendum.addMessage(
                        Localizer.DiagAddendum.propertyMethodIncompatible().format({
                          name: methodName,
                        })
                      );
                      const decl = subclassMethodType.details.declaration;
                      if (decl && decl.type === DeclarationType.Function) {
                        const diag = this._evaluator.addDiag(
                          this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                          DiagRule.reportIncompatibleMethodOverride,
                          Localizer.Diag.propertyOverridden().format({
                            name,
                            className: baseClassType.details.name,
                          }) + diagAddendum.getString(),
                          decl.node.name
                        );
                        const origDecl = baseClassMethodType.details.declaration;
                        if (diag && origDecl) {
                          diag.addRelatedInfo(Localizer.DiagAddendum.overriddenMethod(), origDecl.path, origDecl.range);
                        }
                      }
                    }
                  }
                }
              }
            }
          });
        }
      } else {
        if (this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride !== 'none') {
          const diagAddendum = new DiagAddendum();
          if (!this._evaluator.canAssignType(baseClassSymbolType, typeOfSymbol, diagAddendum)) {
            const decls = symbol.getDeclarations();
            if (decls.length > 0) {
              const lastDecl = decls[decls.length - 1];
              if (lastDecl) {
                const diag = this._evaluator.addDiag(
                  this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride,
                  DiagRule.reportIncompatibleVariableOverride,
                  Localizer.Diag.symbolOverridden().format({
                    name,
                    className: baseClassAndSymbol.classType.details.name,
                  }) + diagAddendum.getString(),
                  lastDecl.node
                );
                const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                if (diag && origDecl) {
                  diag.addRelatedInfo(Localizer.DiagAddendum.overriddenSymbol(), origDecl.path, origDecl.range);
                }
              }
            }
          }
        }
      }
    });
  }
  private _validateMethod(node: FunctionNode, functionType: FunctionType, classNode: ClassNode) {
    if (node.name && node.name.value === '__new__') {
      if (node.parameters.length === 0 || !node.parameters[0].name || !['cls', '_cls', '__cls', '__mcls'].some((name) => node.parameters[0].name!.value === name)) {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
          DiagRule.reportSelfClsParameterName,
          Localizer.Diag.newClsParam(),
          node.parameters.length > 0 ? node.parameters[0] : node.name
        );
      }
    } else if (node.name && node.name.value === '__init_subclass__') {
      if (node.parameters.length === 0 || !node.parameters[0].name || node.parameters[0].name.value !== 'cls') {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
          DiagRule.reportSelfClsParameterName,
          Localizer.Diag.initSubclassClsParam(),
          node.parameters.length > 0 ? node.parameters[0] : node.name
        );
      }
    } else if (node.name && node.name.value === '__class_getitem__') {
      if (node.parameters.length === 0 || !node.parameters[0].name || node.parameters[0].name.value !== 'cls') {
        this._evaluator.addDiag(
          this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
          DiagRule.reportSelfClsParameterName,
          Localizer.Diag.classGetItemClsParam(),
          node.parameters.length > 0 ? node.parameters[0] : node.name
        );
      }
    } else if (FunctionType.isStaticMethod(functionType)) {
      if (node.parameters.length > 0 && node.parameters[0].name) {
        const paramName = node.parameters[0].name.value;
        if (paramName === 'self' || paramName === 'cls') {
          this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName, DiagRule.reportSelfClsParameterName, Localizer.Diag.staticClsSelfParam(), node.parameters[0].name);
        }
      }
    } else if (FunctionType.isClassMethod(functionType)) {
      let paramName = '';
      if (node.parameters.length > 0 && node.parameters[0].name) {
        paramName = node.parameters[0].name.value;
      }
      if (paramName !== 'cls') {
        if (!this._fileInfo.isStubFile || (!paramName.startsWith('_') && paramName !== 'metacls')) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
            DiagRule.reportSelfClsParameterName,
            Localizer.Diag.classMethodClsParam(),
            node.parameters.length > 0 ? node.parameters[0] : node.name
          );
        }
      }
    } else {
      if (node.decorators.length === 0) {
        let paramName = '';
        let firstParamIsSimple = true;
        if (node.parameters.length > 0) {
          if (node.parameters[0].name) {
            paramName = node.parameters[0].name.value;
          }
          if (node.parameters[0].category !== ParameterCategory.Simple) {
            firstParamIsSimple = false;
          }
        }
        if (firstParamIsSimple && paramName !== 'self') {
          let isLegalMetaclassName = false;
          if (paramName === 'cls') {
            const classTypeInfo = this._evaluator.getTypeOfClass(classNode);
            const typeType = this._evaluator.getBuiltInType(classNode, 'type');
            if (typeType && isClass(typeType) && classTypeInfo && isClass(classTypeInfo.classType)) {
              if (derivesFromClassRecursive(classTypeInfo.classType, typeType, /* ignoreUnknown */ true)) {
                isLegalMetaclassName = true;
              }
            }
          }
          const isPrivateName = SymbolNameUtils.isPrivateOrProtectedName(paramName);
          if (!isLegalMetaclassName && !isPrivateName) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
              DiagRule.reportSelfClsParameterName,
              Localizer.Diag.instanceMethodSelfParam(),
              node.parameters.length > 0 ? node.parameters[0] : node.name
            );
          }
        }
      }
    }
  }
  private _validateYieldType(node: YieldNode | YieldFromNode, yieldType: Type) {
    let declaredReturnType: Type | undefined;
    let declaredYieldType: Type | undefined;
    const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
    if (enclosingFunctionNode) {
      const functionTypeResult = this._evaluator.getTypeOfFunction(enclosingFunctionNode);
      if (functionTypeResult) {
        assert(isFunction(functionTypeResult.functionType));
        declaredReturnType = FunctionType.getSpecializedReturnType(functionTypeResult.functionType);
        if (declaredReturnType) {
          declaredYieldType = this._evaluator.getTypeFromIterator(declaredReturnType, !!enclosingFunctionNode.isAsync, /* errorNode */ undefined);
        }
        if (declaredYieldType && !declaredYieldType && enclosingFunctionNode.returnTypeAnnotation) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            enclosingFunctionNode.isAsync ? Localizer.Diag.generatorAsyncReturnType() : Localizer.Diag.generatorSyncReturnType(),
            enclosingFunctionNode.returnTypeAnnotation
          );
        }
      }
    }
    if (this._evaluator.isNodeReachable(node)) {
      if (declaredReturnType && isNoReturnType(declaredReturnType)) {
        this._evaluator.addDiag(this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, Localizer.Diag.noReturnContainsYield(), node);
      } else if (declaredYieldType) {
        const diagAddendum = new DiagAddendum();
        if (!this._evaluator.canAssignType(declaredYieldType, yieldType, diagAddendum)) {
          this._evaluator.addDiag(
            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagRule.reportGeneralTypeIssues,
            Localizer.Diag.yieldTypeMismatch().format({
              exprType: this._evaluator.printType(yieldType, /* expandTypeAlias */ false),
              yieldType: this._evaluator.printType(declaredYieldType, /* expandTypeAlias */ false),
            }) + diagAddendum.getString(),
            node.expression || node
          );
        }
      }
    }
  }
  private _reportDuplicateImports() {
    const importStatements = getTopLevelImports(this._moduleNode);
    const importModuleMap = new Map<string, ImportAsNode>();
    importStatements.orderedImports.forEach((importStatement) => {
      if (importStatement.node.nodeType === ParseNodeType.ImportFrom) {
        const symbolMap = new Map<string, ImportFromAsNode>();
        importStatement.node.imports.forEach((importFromAs) => {
          if (!importFromAs.alias) {
            const prevImport = symbolMap.get(importFromAs.name.value);
            if (prevImport) {
              this._evaluator.addDiag(
                this._fileInfo.diagnosticRuleSet.reportDuplicateImport,
                DiagRule.reportDuplicateImport,
                Localizer.Diag.duplicateImport().format({ importName: importFromAs.name.value }),
                importFromAs.name
              );
            } else {
              symbolMap.set(importFromAs.name.value, importFromAs);
            }
          }
        });
      } else if (importStatement.subnode) {
        if (!importStatement.subnode.alias) {
          const prevImport = importModuleMap.get(importStatement.moduleName);
          if (prevImport) {
            this._evaluator.addDiag(
              this._fileInfo.diagnosticRuleSet.reportDuplicateImport,
              DiagRule.reportDuplicateImport,
              Localizer.Diag.duplicateImport().format({ importName: importStatement.moduleName }),
              importStatement.subnode
            );
          } else {
            importModuleMap.set(importStatement.moduleName, importStatement.subnode);
          }
        }
      }
    });
  }
}
