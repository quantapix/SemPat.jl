import { Commands } from '../commands/commands';
import { DiagLevel } from '../common/configOptions';
import { assert, assertNever, fail } from '../common/debug';
import { CreateTypeStubFileAction, Diag } from '../common/diagnostic';
import { DiagRule } from '../common/diagnosticRules';
import { getFileName, stripFileExtension } from '../common/pathUtils';
import { convertOffsetsToRange } from '../common/positionUtils';
import { getEmptyRange } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
  ArgumentCategory,
  AssertNode,
  AssignmentExpressionNode,
  AssignmentNode,
  AugmentedAssignmentNode,
  AwaitNode,
  BinaryOpNode,
  BreakNode,
  CallNode,
  ClassNode,
  ContinueNode,
  DelNode,
  ExceptNode,
  ExpressionNode,
  ForNode,
  FunctionNode,
  GlobalNode,
  IfNode,
  ImportAsNode,
  ImportFromNode,
  IndexNode,
  LambdaNode,
  ListComprehensionNode,
  MatchNode,
  MemberAccessNode,
  ModuleNameNode,
  ModuleNode,
  NameNode,
  NonlocalNode,
  ParseNode,
  ParseNodeType,
  PatternAsNode,
  PatternCaptureNode,
  PatternMappingExpandEntryNode,
  RaiseNode,
  ReturnNode,
  StatementNode,
  StringListNode,
  SuiteNode,
  TernaryNode,
  TryNode,
  TypeAnnotationNode,
  UnaryOpNode,
  WhileNode,
  WithNode,
  YieldFromNode,
  YieldNode,
} from '../parser/parseNodes';
import * as StringTokenUtils from '../parser/stringTokenUtils';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo, ImportLookupResult } from './analyzerFileInfo';
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
  getUniqueFlowNodeId,
  isCodeFlowSupportedForReference,
} from './codeFlow';
import { AliasDeclaration, ClassDeclaration, DeclarationType, FunctionDeclaration, IntrinsicType, ModuleLoaderActions, ParameterDeclaration, VariableDeclaration } from './declaration';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { NameBindingType, Scope, ScopeType } from './scope';
import * as StaticExpressions from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateName, isPrivateOrProtectedName } from './symbolNameUtils';
interface MemberAccessInfo {
  classNode: ClassNode;
  methodNode: FunctionNode;
  classScope: Scope;
  isInstanceMember: boolean;
}
interface DeferredBindingTask {
  scope: Scope;
  codeFlowExpressionMap: Map<string, string>;
  callback: () => void;
}
interface FinalInfo {
  isFinal: boolean;
  finalTypeNode?: ExpressionNode;
}
export interface BinderResults {
  moduleDocString?: string;
}
export class Binder extends ParseTreeWalker {
  private readonly _fileInfo: AnalyzerFileInfo;
  private _deferredBindingTasks: DeferredBindingTask[] = [];
  private _currentScope!: Scope;
  private _nestedExceptDepth = 0;
  private _currentFlowNode: FlowNode | undefined;
  private _targetFunctionDeclaration: FunctionDeclaration | undefined;
  private _currentBreakTarget?: FlowLabel;
  private _currentContinueTarget?: FlowLabel;
  private _currentTrueTarget?: FlowLabel;
  private _currentFalseTarget?: FlowLabel;
  private _currentExceptTargets?: FlowLabel[];
  private _finallyTargets: FlowLabel[] = [];
  private _currentReturnTarget?: FlowLabel;
  private _currentExecutionScopeReferenceMap: Map<string, string> | undefined;
  private _typingImportAliases: string[] = [];
  private _sysImportAliases: string[] = [];
  private _typingSymbolAliases: Map<string, string> = new Map<string, string>();
  private _dunderAllNames: string[] | undefined;
  private static _unreachableFlowNode: FlowNode = {
    flags: FlowFlags.Unreachable,
    id: getUniqueFlowNodeId(),
  };
  private _potentialPrivateSymbols = new Map<string, Symbol>();
  constructor(fileInfo: AnalyzerFileInfo) {
    super();
    this._fileInfo = fileInfo;
  }
  bindModule(node: ModuleNode): BinderResults {
    const isBuiltInModule = this._fileInfo.builtinsScope === undefined;
    this._createNewScope(isBuiltInModule ? ScopeType.Builtin : ScopeType.Module, this._fileInfo.builtinsScope, () => {
      AnalyzerNodeInfo.setScope(node, this._currentScope);
      AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
      this._addBuiltInSymbolToCurrentScope('__doc__', node, 'str');
      this._addBuiltInSymbolToCurrentScope('__name__', node, 'str');
      this._addBuiltInSymbolToCurrentScope('__loader__', node, 'Any');
      this._addBuiltInSymbolToCurrentScope('__package__', node, 'str');
      this._addBuiltInSymbolToCurrentScope('__spec__', node, 'Any');
      this._addBuiltInSymbolToCurrentScope('__path__', node, 'List[str]');
      this._addBuiltInSymbolToCurrentScope('__file__', node, 'str');
      this._addBuiltInSymbolToCurrentScope('__cached__', node, 'str');
      this._addBuiltInSymbolToCurrentScope('__dict__', node, 'Dict[str, Any]');
      this._currentFlowNode = this._createStartFlowNode();
      this._walkStatementsAndReportUnreachable(node.statements);
      AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentExecutionScopeReferenceMap!);
      AnalyzerNodeInfo.setAfterFlowNode(node, this._currentFlowNode);
    });
    this._bindDeferred();
    this._potentialPrivateSymbols.forEach((symbol, name) => {
      if (!this._dunderAllNames?.some((sym) => sym === name)) {
        symbol.setIsExternallyHidden();
      }
    });
    AnalyzerNodeInfo.setDunderAllNames(node, this._dunderAllNames);
    const scope = AnalyzerNodeInfo.getScope(node);
    if (scope && this._dunderAllNames) {
      for (const name of this._dunderAllNames) {
        scope.symbolTable.get(name)?.setIsInDunderAll();
      }
    }
    return {
      moduleDocString: ParseTreeUtils.getDocString(node.statements),
    };
  }
  visitModule(node: ModuleNode): boolean {
    fail('We should never get here');
    return false;
  }
  visitSuite(node: SuiteNode): boolean {
    this._walkStatementsAndReportUnreachable(node.statements);
    return false;
  }
  visitModuleName(node: ModuleNameNode): boolean {
    const importResult = AnalyzerNodeInfo.getImportInfo(node);
    assert(importResult !== undefined);
    if (!importResult || importResult.isNativeLib) {
      return true;
    }
    if (!importResult.isImportFound) {
      this._addDiag(this._fileInfo.diagnosticRuleSet.reportMissingImports, DiagRule.reportMissingImports, Localizer.Diag.importResolveFailure().format({ importName: importResult.importName }), node);
      return true;
    }
    if (!importResult.isStubFile && importResult.importType === ImportType.ThirdParty && !importResult.pyTypedInfo) {
      const diagnostic = this._addDiag(
        this._fileInfo.diagnosticRuleSet.reportMissingTypeStubs,
        DiagRule.reportMissingTypeStubs,
        Localizer.Diag.stubFileMissing().format({ importName: importResult.importName }),
        node
      );
      if (diagnostic) {
        const createTypeStubAction: CreateTypeStubFileAction = {
          action: Commands.createTypeStub,
          moduleName: importResult.importName,
        };
        diagnostic.addAction(createTypeStubAction);
      }
    }
    if (importResult.isStubFile && importResult.importType !== ImportType.BuiltIn && importResult.nonStubImportResult && !importResult.nonStubImportResult.isImportFound) {
      if (!this._fileInfo.isStubFile) {
        this._addDiag(
          this._fileInfo.diagnosticRuleSet.reportMissingModuleSource,
          DiagRule.reportMissingModuleSource,
          Localizer.Diag.importSourceResolveFailure().format({
            importName: importResult.importName,
          }),
          node
        );
      }
    }
    return true;
  }
  visitClass(node: ClassNode): boolean {
    this.walkMultiple(node.decorators);
    const classDeclaration: ClassDeclaration = {
      type: DeclarationType.Class,
      node,
      path: this._fileInfo.filePath,
      range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name), this._fileInfo.lines),
      moduleName: this._fileInfo.moduleName,
    };
    const symbol = this._bindNameToScope(this._currentScope, node.name.value);
    if (symbol) {
      symbol.addDeclaration(classDeclaration);
    }
    AnalyzerNodeInfo.setDeclaration(node, classDeclaration);
    this.walkMultiple(node.arguments);
    let parentScope = this._currentScope;
    while (parentScope.type === ScopeType.Class) {
      parentScope = parentScope.parent!;
    }
    this._createNewScope(ScopeType.Class, parentScope, () => {
      AnalyzerNodeInfo.setScope(node, this._currentScope);
      this.walk(node.suite);
    });
    this._bindNameToScope(this._currentScope, node.name.value);
    this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ false, /* unbound */ false);
    return false;
  }
  visitFunction(node: FunctionNode): boolean {
    const symbol = this._bindNameToScope(this._currentScope, node.name.value);
    const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
    const functionDeclaration: FunctionDeclaration = {
      type: DeclarationType.Function,
      node,
      isMethod: !!containingClassNode,
      isGenerator: false,
      path: this._fileInfo.filePath,
      range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name), this._fileInfo.lines),
      moduleName: this._fileInfo.moduleName,
    };
    if (symbol) {
      symbol.addDeclaration(functionDeclaration);
    }
    AnalyzerNodeInfo.setDeclaration(node, functionDeclaration);
    this.walkMultiple(node.decorators);
    node.parameters.forEach((param) => {
      if (param.defaultValue) {
        this.walk(param.defaultValue);
      }
      if (param.typeAnnotation) {
        this.walk(param.typeAnnotation);
      }
      if (param.typeAnnotationComment) {
        this.walk(param.typeAnnotationComment);
      }
    });
    if (node.returnTypeAnnotation) {
      this.walk(node.returnTypeAnnotation);
    }
    if (node.functionAnnotationComment) {
      this.walk(node.functionAnnotationComment);
    }
    let functionOrModuleNode: ParseNode | undefined = node.parent;
    while (functionOrModuleNode) {
      if (functionOrModuleNode.nodeType === ParseNodeType.Module || functionOrModuleNode.nodeType === ParseNodeType.Function) {
        break;
      }
      functionOrModuleNode = functionOrModuleNode.parent;
    }
    assert(functionOrModuleNode !== undefined);
    const functionOrModuleScope = AnalyzerNodeInfo.getScope(functionOrModuleNode!);
    assert(functionOrModuleScope !== undefined);
    this._createNewScope(ScopeType.Function, functionOrModuleScope, () => {
      AnalyzerNodeInfo.setScope(node, this._currentScope);
      const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
      if (enclosingClass) {
        this._addBuiltInSymbolToCurrentScope('__class__', node, 'class');
      }
      this._deferBinding(() => {
        this._currentFlowNode = this._createStartFlowNode();
        node.parameters.forEach((paramNode) => {
          if (paramNode.name) {
            const symbol = this._bindNameToScope(this._currentScope, paramNode.name.value);
            if (symbol) {
              const paramDeclaration: ParameterDeclaration = {
                type: DeclarationType.Parameter,
                node: paramNode,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(paramNode.start, TextRange.getEnd(paramNode), this._fileInfo.lines),
                moduleName: this._fileInfo.moduleName,
              };
              symbol.addDeclaration(paramDeclaration);
              AnalyzerNodeInfo.setDeclaration(paramNode.name, paramDeclaration);
            }
            this._createFlowAssignment(paramNode.name);
          }
        });
        this._targetFunctionDeclaration = functionDeclaration;
        this._currentReturnTarget = this._createBranchLabel();
        this.walk(node.suite);
        AnalyzerNodeInfo.setAfterFlowNode(node.suite, this._currentFlowNode);
        this._addAntecedent(this._currentReturnTarget, this._currentFlowNode);
        const returnFlowNode = this._finishFlowLabel(this._currentReturnTarget);
        AnalyzerNodeInfo.setAfterFlowNode(node, returnFlowNode);
      });
      AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentExecutionScopeReferenceMap!);
    });
    this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ false, /* unbound */ false);
    return false;
  }
  visitLambda(node: LambdaNode): boolean {
    node.parameters.forEach((param) => {
      if (param.defaultValue) {
        this.walk(param.defaultValue);
      }
    });
    this._createNewScope(ScopeType.Function, this._currentScope, () => {
      AnalyzerNodeInfo.setScope(node, this._currentScope);
      this._deferBinding(() => {
        this._currentFlowNode = this._createStartFlowNode();
        node.parameters.forEach((paramNode) => {
          if (paramNode.name) {
            const symbol = this._bindNameToScope(this._currentScope, paramNode.name.value);
            if (symbol) {
              const paramDeclaration: ParameterDeclaration = {
                type: DeclarationType.Parameter,
                node: paramNode,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(paramNode.start, TextRange.getEnd(paramNode), this._fileInfo.lines),
                moduleName: this._fileInfo.moduleName,
              };
              symbol.addDeclaration(paramDeclaration);
              AnalyzerNodeInfo.setDeclaration(paramNode.name, paramDeclaration);
            }
            this._createFlowAssignment(paramNode.name);
            this.walk(paramNode.name);
          }
        });
        this.walk(node.expression);
        AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentExecutionScopeReferenceMap!);
      });
    });
    return false;
  }
  visitCall(node: CallNode): boolean {
    this.walk(node.leftExpression);
    this.walkMultiple(node.arguments);
    this._createCallFlowNode(node);
    if (
      this._currentScope.type === ScopeType.Module &&
      node.leftExpression.nodeType === ParseNodeType.MemberAccess &&
      node.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
      node.leftExpression.leftExpression.value === '__all__'
    ) {
      let emitDunderAllWarning = true;
      if (node.leftExpression.memberName.value === 'extend' && node.arguments.length === 1) {
        const argExpr = node.arguments[0].valueExpression;
        if (argExpr.nodeType === ParseNodeType.List) {
          argExpr.entries.forEach((listEntryNode) => {
            if (listEntryNode.nodeType === ParseNodeType.StringList && listEntryNode.strings.length === 1 && listEntryNode.strings[0].nodeType === ParseNodeType.String) {
              this._dunderAllNames?.push(listEntryNode.strings[0].value);
              emitDunderAllWarning = false;
            }
          });
        } else if (argExpr.nodeType === ParseNodeType.MemberAccess && argExpr.leftExpression.nodeType === ParseNodeType.Name && argExpr.memberName.value === '__all__') {
          const namesToAdd = this._getDunderAllNamesFromImport(argExpr.leftExpression.value);
          if (namesToAdd && namesToAdd.length > 0) {
            namesToAdd.forEach((name) => {
              this._dunderAllNames?.push(name);
            });
            emitDunderAllWarning = false;
          }
        }
      } else if (node.leftExpression.memberName.value === 'remove' && node.arguments.length === 1) {
        const argExpr = node.arguments[0].valueExpression;
        if (argExpr.nodeType === ParseNodeType.StringList && argExpr.strings.length === 1 && argExpr.strings[0].nodeType === ParseNodeType.String && this._dunderAllNames) {
          this._dunderAllNames = this._dunderAllNames.filter((name) => name !== argExpr.strings[0].value);
          emitDunderAllWarning = false;
        }
      } else if (node.leftExpression.memberName.value === 'append' && node.arguments.length === 1) {
        const argExpr = node.arguments[0].valueExpression;
        if (argExpr.nodeType === ParseNodeType.StringList && argExpr.strings.length === 1 && argExpr.strings[0].nodeType === ParseNodeType.String) {
          this._dunderAllNames?.push(argExpr.strings[0].value);
          emitDunderAllWarning = false;
        }
      }
      if (emitDunderAllWarning) {
        this._addDiag(this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll, DiagRule.reportUnsupportedDunderAll, Localizer.Diag.unsupportedDunderAllOp(), node);
      }
    }
    return false;
  }
  visitAssignment(node: AssignmentNode): boolean {
    if (this._handleTypingStubAssignmentOrAnnotation(node)) {
      return false;
    }
    this._bindPossibleTupleNamedTarget(node.leftExpression);
    if (node.typeAnnotationComment) {
      this.walk(node.typeAnnotationComment);
      this._addTypeDeclarationForVariable(node.leftExpression, node.typeAnnotationComment);
    }
    this.walk(node.rightExpression);
    let isPossibleTypeAlias = true;
    if (ParseTreeUtils.getEnclosingFunction(node)) {
      isPossibleTypeAlias = false;
    } else if (node.rightExpression.nodeType === ParseNodeType.Call && this._fileInfo.isTypingStubFile) {
      isPossibleTypeAlias = false;
    } else if (ParseTreeUtils.isWithinLoop(node)) {
      isPossibleTypeAlias = false;
    }
    this._addInferredTypeAssignmentForVariable(node.leftExpression, node.rightExpression, isPossibleTypeAlias);
    this._createAssignmentTargetFlowNodes(node.leftExpression, /* walkTargets */ true, /* unbound */ false);
    if (this._currentScope.type === ScopeType.Module) {
      if (
        (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === '__all__') ||
        (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
          node.leftExpression.valueExpression.nodeType === ParseNodeType.Name &&
          node.leftExpression.valueExpression.value === '__all__')
      ) {
        const expr = node.rightExpression;
        this._dunderAllNames = [];
        let emitDunderAllWarning = false;
        if (expr.nodeType === ParseNodeType.List) {
          expr.entries.forEach((listEntryNode) => {
            if (listEntryNode.nodeType === ParseNodeType.StringList && listEntryNode.strings.length === 1 && listEntryNode.strings[0].nodeType === ParseNodeType.String) {
              this._dunderAllNames!.push(listEntryNode.strings[0].value);
            } else {
              emitDunderAllWarning = true;
            }
          });
        } else if (expr.nodeType === ParseNodeType.Tuple) {
          expr.expressions.forEach((tupleEntryNode) => {
            if (tupleEntryNode.nodeType === ParseNodeType.StringList && tupleEntryNode.strings.length === 1 && tupleEntryNode.strings[0].nodeType === ParseNodeType.String) {
              this._dunderAllNames!.push(tupleEntryNode.strings[0].value);
            } else {
              emitDunderAllWarning = true;
            }
          });
        } else {
          emitDunderAllWarning = true;
        }
        if (emitDunderAllWarning) {
          this._addDiag(this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll, DiagRule.reportUnsupportedDunderAll, Localizer.Diag.unsupportedDunderAllOp(), node);
        }
      }
    }
    return false;
  }
  visitAssignmentExpression(node: AssignmentExpressionNode) {
    this._disableTrueFalseTargets(() => {
      this.walk(node.rightExpression);
    });
    const evaluationNode = ParseTreeUtils.getEvaluationNodeForAssignmentExpression(node);
    if (!evaluationNode) {
      this._addError(Localizer.Diag.assignmentExprContext(), node);
      this.walk(node.name);
    } else {
      const containerScope = AnalyzerNodeInfo.getScope(evaluationNode)!;
      let curScope: Scope | undefined = this._currentScope;
      while (curScope && curScope !== containerScope) {
        const localSymbol = curScope.lookUpSymbol(node.name.value);
        if (localSymbol) {
          this._addError(Localizer.Diag.assignmentExprComprehension().format({ name: node.name.value }), node.name);
          break;
        }
        curScope = curScope.parent;
      }
      this._bindNameToScope(containerScope, node.name.value);
      this._addInferredTypeAssignmentForVariable(node.name, node.rightExpression);
      this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ true, /* unbound */ false);
    }
    return false;
  }
  visitAugmentedAssignment(node: AugmentedAssignmentNode) {
    this.walk(node.leftExpression);
    this.walk(node.rightExpression);
    this._addInferredTypeAssignmentForVariable(node.destExpression, node.rightExpression);
    this._bindPossibleTupleNamedTarget(node.destExpression);
    this._createAssignmentTargetFlowNodes(node.destExpression, /* walkTargets */ false, /* unbound */ false);
    if (node.operator === OperatorType.AddEqual && this._currentScope.type === ScopeType.Module && node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === '__all__') {
      const expr = node.rightExpression;
      let emitDunderAllWarning = true;
      if (expr.nodeType === ParseNodeType.List) {
        expr.entries.forEach((listEntryNode) => {
          if (listEntryNode.nodeType === ParseNodeType.StringList && listEntryNode.strings.length === 1 && listEntryNode.strings[0].nodeType === ParseNodeType.String) {
            this._dunderAllNames?.push(listEntryNode.strings[0].value);
          }
        });
        emitDunderAllWarning = false;
      } else if (expr.nodeType === ParseNodeType.MemberAccess && expr.leftExpression.nodeType === ParseNodeType.Name && expr.memberName.value === '__all__') {
        const namesToAdd = this._getDunderAllNamesFromImport(expr.leftExpression.value);
        if (namesToAdd) {
          namesToAdd.forEach((name) => {
            this._dunderAllNames?.push(name);
          });
          emitDunderAllWarning = false;
        }
      }
      if (emitDunderAllWarning) {
        this._addDiag(this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll, DiagRule.reportUnsupportedDunderAll, Localizer.Diag.unsupportedDunderAllOp(), node);
      }
    }
    return false;
  }
  visitDel(node: DelNode) {
    node.expressions.forEach((expr) => {
      this._bindPossibleTupleNamedTarget(expr);
      this.walk(expr);
      this._createAssignmentTargetFlowNodes(expr, /* walkTargets */ false, /* unbound */ true);
    });
    return false;
  }
  visitTypeAnnotation(node: TypeAnnotationNode): boolean {
    if (this._handleTypingStubAssignmentOrAnnotation(node)) {
      return false;
    }
    this.walk(node.typeAnnotation);
    this._createVariableAnnotationFlowNode();
    this._bindPossibleTupleNamedTarget(node.valueExpression);
    this._addTypeDeclarationForVariable(node.valueExpression, node.typeAnnotation);
    const expressionList: CodeFlowReferenceExpressionNode[] = [];
    if (this._isNarrowingExpression(node.valueExpression, expressionList)) {
      expressionList.forEach((expr) => {
        const referenceKey = createKeyForReference(expr);
        this._currentExecutionScopeReferenceMap!.set(referenceKey, referenceKey);
      });
    }
    this.walk(node.valueExpression);
    return false;
  }
  visitFor(node: ForNode) {
    this._bindPossibleTupleNamedTarget(node.targetExpression);
    this._addInferredTypeAssignmentForVariable(node.targetExpression, node);
    this.walk(node.iterableExpression);
    const preForLabel = this._createLoopLabel();
    const preElseLabel = this._createBranchLabel();
    const postForLabel = this._createBranchLabel();
    this._addAntecedent(preForLabel, this._currentFlowNode!);
    this._currentFlowNode = preForLabel;
    this._addAntecedent(preElseLabel, this._currentFlowNode);
    this._createAssignmentTargetFlowNodes(node.targetExpression, /* walkTargets */ true, /* unbound */ false);
    this._bindLoopStatement(preForLabel, postForLabel, () => {
      this.walk(node.forSuite);
      this._addAntecedent(preForLabel, this._currentFlowNode!);
    });
    this._currentFlowNode = this._finishFlowLabel(preElseLabel);
    if (node.elseSuite) {
      this.walk(node.elseSuite);
    }
    this._addAntecedent(postForLabel, this._currentFlowNode);
    this._currentFlowNode = this._finishFlowLabel(postForLabel);
    return false;
  }
  visitContinue(node: ContinueNode): boolean {
    if (this._currentContinueTarget) {
      this._addAntecedent(this._currentContinueTarget, this._currentFlowNode!);
    }
    this._currentFlowNode = Binder._unreachableFlowNode;
    return false;
  }
  visitBreak(node: BreakNode): boolean {
    if (this._currentBreakTarget) {
      this._addAntecedent(this._currentBreakTarget, this._currentFlowNode!);
    }
    this._currentFlowNode = Binder._unreachableFlowNode;
    return false;
  }
  visitReturn(node: ReturnNode): boolean {
    if (this._targetFunctionDeclaration) {
      if (!this._targetFunctionDeclaration.returnStatements) {
        this._targetFunctionDeclaration.returnStatements = [];
      }
      this._targetFunctionDeclaration.returnStatements.push(node);
    }
    if (node.returnExpression) {
      this.walk(node.returnExpression);
    }
    AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    if (this._currentReturnTarget) {
      this._addAntecedent(this._currentReturnTarget, this._currentFlowNode!);
    }
    this._finallyTargets.forEach((target) => {
      this._addAntecedent(target, this._currentFlowNode!);
    });
    this._currentFlowNode = Binder._unreachableFlowNode;
    return false;
  }
  visitYield(node: YieldNode): boolean {
    if (this._isInListComprehension(node)) {
      this._addError(Localizer.Diag.yieldWithinListCompr(), node);
    }
    this._bindYield(node);
    return false;
  }
  visitYieldFrom(node: YieldFromNode): boolean {
    if (this._isInListComprehension(node)) {
      this._addError(Localizer.Diag.yieldWithinListCompr(), node);
    }
    this._bindYield(node);
    return false;
  }
  visitMemberAccess(node: MemberAccessNode): boolean {
    AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    return true;
  }
  visitName(node: NameNode): boolean {
    AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    return false;
  }
  visitIndex(node: IndexNode): boolean {
    AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    return true;
  }
  visitIf(node: IfNode): boolean {
    const thenLabel = this._createBranchLabel();
    const elseLabel = this._createBranchLabel();
    const postIfLabel = this._createBranchLabel();
    const constExprValue = StaticExpressions.evaluateStaticBoolLikeExpression(node.testExpression, this._fileInfo.executionEnvironment, this._typingImportAliases, this._sysImportAliases);
    this._bindConditional(node.testExpression, thenLabel, elseLabel);
    this._currentFlowNode = constExprValue === false ? Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
    this.walk(node.ifSuite);
    this._addAntecedent(postIfLabel, this._currentFlowNode);
    this._currentFlowNode = constExprValue === true ? Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
    if (node.elseSuite) {
      this.walk(node.elseSuite);
    } else {
      this._bindNeverCondition(node.testExpression, postIfLabel, /* isPositiveTest */ false);
    }
    this._addAntecedent(postIfLabel, this._currentFlowNode);
    this._currentFlowNode = this._finishFlowLabel(postIfLabel);
    return false;
  }
  visitWhile(node: WhileNode): boolean {
    const thenLabel = this._createBranchLabel();
    const elseLabel = this._createBranchLabel();
    const postWhileLabel = this._createBranchLabel();
    const constExprValue = StaticExpressions.evaluateStaticBoolLikeExpression(node.testExpression, this._fileInfo.executionEnvironment, this._typingImportAliases, this._sysImportAliases);
    const preLoopLabel = this._createLoopLabel();
    this._addAntecedent(preLoopLabel, this._currentFlowNode!);
    this._currentFlowNode = preLoopLabel;
    this._bindConditional(node.testExpression, thenLabel, elseLabel);
    this._currentFlowNode = constExprValue === false ? Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
    this._bindLoopStatement(preLoopLabel, postWhileLabel, () => {
      this.walk(node.whileSuite);
    });
    this._addAntecedent(preLoopLabel, this._currentFlowNode);
    this._currentFlowNode = constExprValue === true ? Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
    if (node.elseSuite) {
      this.walk(node.elseSuite);
    }
    this._addAntecedent(postWhileLabel, this._currentFlowNode);
    this._currentFlowNode = this._finishFlowLabel(postWhileLabel);
    return false;
  }
  visitAssert(node: AssertNode): boolean {
    const assertTrueLabel = this._createBranchLabel();
    const assertFalseLabel = this._createBranchLabel();
    this._bindConditional(node.testExpression, assertTrueLabel, assertFalseLabel);
    if (node.exceptionExpression) {
      this._currentFlowNode = this._finishFlowLabel(assertFalseLabel);
      this.walk(node.exceptionExpression);
    }
    this._currentFlowNode = this._finishFlowLabel(assertTrueLabel);
    return false;
  }
  visitExcept(node: ExceptNode): boolean {
    if (node.typeExpression) {
      this.walk(node.typeExpression);
    }
    if (node.name) {
      this.walk(node.name);
      const symbol = this._bindNameToScope(this._currentScope, node.name.value);
      this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ true, /* unbound */ false);
      if (symbol) {
        const declaration: VariableDeclaration = {
          type: DeclarationType.Variable,
          node: node.name,
          isConstant: isConstantName(node.name.value),
          inferredTypeSource: node,
          path: this._fileInfo.filePath,
          range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name), this._fileInfo.lines),
          moduleName: this._fileInfo.moduleName,
        };
        symbol.addDeclaration(declaration);
      }
    }
    this.walk(node.exceptSuite);
    if (node.name) {
      this._createFlowAssignment(node.name, /* unbound */ true);
    }
    return false;
  }
  visitRaise(node: RaiseNode): boolean {
    if (this._targetFunctionDeclaration) {
      if (!this._targetFunctionDeclaration.raiseStatements) {
        this._targetFunctionDeclaration.raiseStatements = [];
      }
      this._targetFunctionDeclaration.raiseStatements.push(node);
    }
    if (!node.typeExpression && this._nestedExceptDepth === 0) {
      this._addError(Localizer.Diag.raiseParams(), node);
    }
    if (node.typeExpression) {
      this.walk(node.typeExpression);
    }
    if (node.valueExpression) {
      this.walk(node.valueExpression);
    }
    if (node.tracebackExpression) {
      this.walk(node.tracebackExpression);
    }
    this._finallyTargets.forEach((target) => {
      this._addAntecedent(target, this._currentFlowNode!);
    });
    this._currentFlowNode = Binder._unreachableFlowNode;
    return false;
  }
  visitTry(node: TryNode): boolean {
    const curExceptTargets = node.exceptClauses.map(() => this._createBranchLabel());
    const preFinallyLabel = this._createBranchLabel();
    const preFinallyReturnOrRaiseLabel = this._createBranchLabel();
    let isAfterElseAndExceptsReachable = false;
    const preFinallyGate: FlowPreFinallyGate = {
      flags: FlowFlags.PreFinallyGate,
      id: getUniqueFlowNodeId(),
      antecedent: preFinallyReturnOrRaiseLabel,
      isGateClosed: false,
    };
    if (node.finallySuite) {
      this._addAntecedent(preFinallyLabel, preFinallyGate);
    }
    const hasBareExceptClause = node.exceptClauses.some((except) => !except.typeExpression);
    if (!hasBareExceptClause) {
      curExceptTargets.push(preFinallyReturnOrRaiseLabel);
    }
    curExceptTargets.forEach((exceptLabel) => {
      this._addAntecedent(exceptLabel, this._currentFlowNode!);
    });
    if (node.finallySuite) {
      this._finallyTargets.push(preFinallyReturnOrRaiseLabel);
    }
    this._useExceptTargets(curExceptTargets, () => {
      this.walk(node.trySuite);
    });
    if (node.elseSuite) {
      this.walk(node.elseSuite);
    }
    this._addAntecedent(preFinallyLabel, this._currentFlowNode!);
    if (!this._isCodeUnreachable()) {
      isAfterElseAndExceptsReachable = true;
    }
    this._nestedExceptDepth++;
    node.exceptClauses.forEach((exceptNode, index) => {
      this._currentFlowNode = this._finishFlowLabel(curExceptTargets[index]);
      this.walk(exceptNode);
      this._addAntecedent(preFinallyLabel, this._currentFlowNode);
      if (!this._isCodeUnreachable()) {
        isAfterElseAndExceptsReachable = true;
      }
    });
    this._nestedExceptDepth--;
    if (node.finallySuite) {
      this._finallyTargets.pop();
    }
    this._currentFlowNode = this._finishFlowLabel(preFinallyLabel);
    if (node.finallySuite) {
      this.walk(node.finallySuite);
      const postFinallyNode: FlowPostFinally = {
        flags: FlowFlags.PostFinally,
        id: getUniqueFlowNodeId(),
        finallyNode: node.finallySuite,
        antecedent: this._currentFlowNode,
        preFinallyGate,
      };
      this._currentFlowNode = isAfterElseAndExceptsReachable ? postFinallyNode : Binder._unreachableFlowNode;
    }
    return false;
  }
  visitAwait(node: AwaitNode) {
    const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
    if (enclosingFunction === undefined || !enclosingFunction.isAsync) {
      this._addError(Localizer.Diag.awaitNotInAsync(), node);
    }
    return true;
  }
  visitStringList(node: StringListNode): boolean {
    for (const stringNode of node.strings) {
      if (stringNode.hasUnescapeErrors) {
        const unescapedResult = StringTokenUtils.getUnescapedString(stringNode.token);
        unescapedResult.unescapeErrors.forEach((error: StringTokenUtils.UnescapeError) => {
          const start = stringNode.token.start + stringNode.token.prefixLength + stringNode.token.quoteMarkLength + error.offset;
          const textRange = { start, length: error.length };
          if (error.errorType === StringTokenUtils.UnescapeErrorType.InvalidEscapeSequence) {
            this._addDiag(this._fileInfo.diagnosticRuleSet.reportInvalidStringEscapeSequence, DiagRule.reportInvalidStringEscapeSequence, Localizer.Diag.stringUnsupportedEscape(), textRange);
          } else if (error.errorType === StringTokenUtils.UnescapeErrorType.EscapeWithinFormatExpression) {
            this._addError(Localizer.Diag.formatStringEscape(), textRange);
          } else if (error.errorType === StringTokenUtils.UnescapeErrorType.SingleCloseBraceWithinFormatLiteral) {
            this._addError(Localizer.Diag.formatStringBrace(), textRange);
          } else if (error.errorType === StringTokenUtils.UnescapeErrorType.UnterminatedFormatExpression) {
            this._addError(Localizer.Diag.formatStringUnterminated(), textRange);
          }
        });
      }
    }
    return true;
  }
  visitGlobal(node: GlobalNode): boolean {
    const globalScope = this._currentScope.getGlobalScope();
    node.nameList.forEach((name) => {
      const nameValue = name.value;
      if (this._currentScope.getBindingType(nameValue) === NameBindingType.Nonlocal) {
        this._addError(Localizer.Diag.nonLocalRedefinition().format({ name: nameValue }), name);
      }
      const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);
      if (valueWithScope && valueWithScope.scope === this._currentScope) {
        this._addError(Localizer.Diag.globalReassignment().format({ name: nameValue }), name);
      }
      this._bindNameToScope(globalScope, nameValue);
      if (this._currentScope !== globalScope) {
        this._currentScope.setBindingType(nameValue, NameBindingType.Global);
      }
    });
    return true;
  }
  visitNonlocal(node: NonlocalNode): boolean {
    const globalScope = this._currentScope.getGlobalScope();
    if (this._currentScope === globalScope) {
      this._addError(Localizer.Diag.nonLocalInModule(), node);
    } else {
      node.nameList.forEach((name) => {
        const nameValue = name.value;
        if (this._currentScope.getBindingType(nameValue) === NameBindingType.Global) {
          this._addError(Localizer.Diag.globalRedefinition().format({ name: nameValue }), name);
        }
        const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);
        if (valueWithScope && valueWithScope.scope === this._currentScope) {
          this._addError(Localizer.Diag.nonLocalReassignment().format({ name: nameValue }), name);
        } else if (!valueWithScope || valueWithScope.scope === globalScope) {
          this._addError(Localizer.Diag.nonLocalNoBinding().format({ name: nameValue }), name);
        }
        if (valueWithScope) {
          this._currentScope.setBindingType(nameValue, NameBindingType.Nonlocal);
        }
      });
    }
    return true;
  }
  visitImportAs(node: ImportAsNode): boolean {
    if (node.module.nameParts.length > 0) {
      const firstNamePartValue = node.module.nameParts[0].value;
      let symbolName: string | undefined;
      if (node.alias) {
        symbolName = node.alias.value;
      } else {
        symbolName = firstNamePartValue;
      }
      const symbol = this._bindNameToScope(this._currentScope, symbolName);
      if (symbol && (!node.alias || node.module.nameParts.length !== 1 || node.module.nameParts[0].value !== node.alias.value)) {
        if (this._fileInfo.isStubFile) {
          symbol.setIsExternallyHidden();
        } else if (this._fileInfo.isInPyTypedPackage && this._currentScope.type === ScopeType.Module) {
          this._potentialPrivateSymbols.set(symbolName, symbol);
        }
      }
      const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
      assert(importInfo !== undefined);
      if (symbol) {
        this._createAliasDeclarationForMultipartImportName(node, node.alias, importInfo, symbol);
      }
      this._createFlowAssignment(node.alias ? node.alias : node.module.nameParts[0]);
      if (node.module.nameParts.length === 1) {
        if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
          this._typingImportAliases.push(node.alias?.value || firstNamePartValue);
        } else if (firstNamePartValue === 'sys') {
          this._sysImportAliases.push(node.alias?.value || firstNamePartValue);
        }
      }
    }
    return true;
  }
  visitImportFrom(node: ImportFromNode): boolean {
    const typingSymbolsOfInterest = ['Final', 'TypeAlias', 'ClassVar', 'Required', 'NotRequired'];
    const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
    let resolvedPath = '';
    if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib) {
      resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
    }
    const fileName = stripFileExtension(getFileName(this._fileInfo.filePath));
    const isModuleInitFile = fileName === '__init__' && node.module.leadingDots === 1 && node.module.nameParts.length > 0;
    let isTypingImport = false;
    if (node.module.nameParts.length === 1) {
      const firstNamePartValue = node.module.nameParts[0].value;
      if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
        isTypingImport = true;
      }
    }
    if (node.isWildcardImport) {
      if (ParseTreeUtils.getEnclosingClass(node) || ParseTreeUtils.getEnclosingFunction(node)) {
        this._addError(Localizer.Diag.wildcardInFunction(), node);
      }
      if (importInfo) {
        const names: string[] = [];
        const lookupInfo = this._fileInfo.importLookup(resolvedPath);
        if (lookupInfo) {
          const wildcardNames = this._getWildcardImportNames(lookupInfo);
          if (isModuleInitFile) {
            const isImmediatelyReplaced = wildcardNames.some((name) => {
              return name === node.module.nameParts[0].value;
            });
            if (!isImmediatelyReplaced) {
              this._addImplicitFromImport(node, importInfo);
            }
          }
          wildcardNames.forEach((name) => {
            const localSymbol = this._bindNameToScope(this._currentScope, name);
            if (localSymbol) {
              const importedSymbol = lookupInfo.symbolTable.get(name)!;
              if (importedSymbol) {
                const aliasDecl: AliasDeclaration = {
                  type: DeclarationType.Alias,
                  node,
                  path: resolvedPath,
                  range: getEmptyRange(),
                  usesLocalName: false,
                  symbolName: name,
                  moduleName: this._fileInfo.moduleName,
                };
                localSymbol.addDeclaration(aliasDecl);
                names.push(name);
              } else {
                if (importInfo && importInfo.filteredImplicitImports) {
                  const implicitImport = importInfo.filteredImplicitImports.find((imp) => imp.name === name);
                  if (implicitImport) {
                    const submoduleFallback: AliasDeclaration = {
                      type: DeclarationType.Alias,
                      node,
                      path: implicitImport.path,
                      range: getEmptyRange(),
                      usesLocalName: false,
                      moduleName: this._fileInfo.moduleName,
                    };
                    const aliasDecl: AliasDeclaration = {
                      type: DeclarationType.Alias,
                      node,
                      path: resolvedPath,
                      usesLocalName: false,
                      symbolName: name,
                      submoduleFallback,
                      range: getEmptyRange(),
                      moduleName: this._fileInfo.moduleName,
                    };
                    localSymbol.addDeclaration(aliasDecl);
                  }
                }
              }
            }
          });
        }
        this._createFlowWildcardImport(node, names);
        if (isTypingImport) {
          typingSymbolsOfInterest.forEach((s) => {
            this._typingSymbolAliases.set(s, s);
          });
        }
      }
    } else {
      if (isModuleInitFile) {
        this._addImplicitFromImport(node, importInfo);
      }
      node.imports.forEach((importSymbolNode) => {
        const importedName = importSymbolNode.name.value;
        const nameNode = importSymbolNode.alias || importSymbolNode.name;
        const symbol = this._bindNameToScope(this._currentScope, nameNode.value);
        if (symbol) {
          if (node.module.nameParts.length > 0) {
            if (!importSymbolNode.alias || importSymbolNode.alias.value !== importSymbolNode.name.value) {
              if (this._fileInfo.isStubFile) {
                symbol.setIsExternallyHidden();
              } else if (this._fileInfo.isInPyTypedPackage && this._currentScope.type === ScopeType.Module) {
                this._potentialPrivateSymbols.set(nameNode.value, symbol);
              }
            }
          }
          let implicitImport: ImplicitImport | undefined;
          if (importInfo && importInfo.filteredImplicitImports) {
            implicitImport = importInfo.filteredImplicitImports.find((imp) => imp.name === importedName);
          }
          let submoduleFallback: AliasDeclaration | undefined;
          if (implicitImport) {
            submoduleFallback = {
              type: DeclarationType.Alias,
              node: importSymbolNode,
              path: implicitImport.path,
              range: getEmptyRange(),
              usesLocalName: false,
              moduleName: this._fileInfo.moduleName,
            };
            if (fileName === '__init__' && node.module.leadingDots === 1 && node.module.nameParts.length === 0) {
              resolvedPath = '';
            }
          }
          const aliasDecl: AliasDeclaration = {
            type: DeclarationType.Alias,
            node: importSymbolNode,
            path: resolvedPath,
            usesLocalName: !!importSymbolNode.alias,
            symbolName: importedName,
            submoduleFallback,
            range: getEmptyRange(),
            moduleName: this._fileInfo.moduleName,
          };
          symbol.addDeclaration(aliasDecl);
          this._createFlowAssignment(importSymbolNode.alias || importSymbolNode.name);
          if (isTypingImport) {
            if (typingSymbolsOfInterest.some((s) => s === importSymbolNode.name.value)) {
              this._typingSymbolAliases.set(nameNode.value, importSymbolNode.name.value);
            }
          }
        }
      });
    }
    return true;
  }
  visitWith(node: WithNode): boolean {
    node.withItems.forEach((item) => {
      this.walk(item.expression);
      if (item.target) {
        this._bindPossibleTupleNamedTarget(item.target);
        this._addInferredTypeAssignmentForVariable(item.target, item);
        this._createAssignmentTargetFlowNodes(item.target, /* walkTargets */ true, /* unbound */ false);
      }
    });
    const contextMgrExceptionTarget = this._createContextMgrLabel(
      node.withItems.map((item) => item.expression),
      !!node.isAsync
    );
    this._addAntecedent(contextMgrExceptionTarget, this._currentFlowNode!);
    const postContextMgrLabel = this._createBranchLabel();
    this._addAntecedent(postContextMgrLabel, contextMgrExceptionTarget!);
    this._useExceptTargets([contextMgrExceptionTarget], () => {
      this.walk(node.suite);
    });
    this._addAntecedent(postContextMgrLabel, this._currentFlowNode!);
    this._currentFlowNode = postContextMgrLabel;
    return false;
  }
  visitTernary(node: TernaryNode): boolean {
    const trueLabel = this._createBranchLabel();
    const falseLabel = this._createBranchLabel();
    const postExpressionLabel = this._createBranchLabel();
    this._bindConditional(node.testExpression, trueLabel, falseLabel);
    this._currentFlowNode = this._finishFlowLabel(trueLabel);
    this.walk(node.ifExpression);
    this._addAntecedent(postExpressionLabel, this._currentFlowNode);
    this._currentFlowNode = this._finishFlowLabel(falseLabel);
    this.walk(node.elseExpression);
    this._addAntecedent(postExpressionLabel, this._currentFlowNode);
    this._currentFlowNode = this._finishFlowLabel(postExpressionLabel);
    return false;
  }
  visitUnaryOp(node: UnaryOpNode): boolean {
    if (node.operator === OperatorType.Not && this._currentFalseTarget && this._currentTrueTarget) {
      this._bindConditional(node.expression, this._currentFalseTarget, this._currentTrueTarget);
    } else {
      this._disableTrueFalseTargets(() => {
        this.walk(node.expression);
      });
    }
    return false;
  }
  visitBinaryOp(node: BinaryOpNode): boolean {
    if (node.operator === OperatorType.And || node.operator === OperatorType.Or) {
      let trueTarget = this._currentTrueTarget;
      let falseTarget = this._currentFalseTarget;
      let postRightLabel: FlowLabel | undefined;
      if (!trueTarget || !falseTarget) {
        postRightLabel = this._createBranchLabel();
        trueTarget = falseTarget = postRightLabel;
      }
      const preRightLabel = this._createBranchLabel();
      if (node.operator === OperatorType.And) {
        this._bindConditional(node.leftExpression, preRightLabel, falseTarget);
      } else {
        this._bindConditional(node.leftExpression, trueTarget, preRightLabel);
      }
      this._currentFlowNode = this._finishFlowLabel(preRightLabel);
      this._bindConditional(node.rightExpression, trueTarget, falseTarget);
      if (postRightLabel) {
        this._currentFlowNode = this._finishFlowLabel(postRightLabel);
      }
    } else {
      this._disableTrueFalseTargets(() => {
        this.walk(node.leftExpression);
        this.walk(node.rightExpression);
      });
    }
    return false;
  }
  visitListComprehension(node: ListComprehensionNode): boolean {
    this._createNewScope(ScopeType.ListComprehension, this._currentScope, () => {
      AnalyzerNodeInfo.setScope(node, this._currentScope);
      const falseLabel = this._createBranchLabel();
      const boundSymbols: Map<string, Symbol>[] = [];
      for (let i = 0; i < node.comprehensions.length; i++) {
        const compr = node.comprehensions[i];
        const addedSymbols = new Map<string, Symbol>();
        if (compr.nodeType === ParseNodeType.ListComprehensionFor) {
          this._bindPossibleTupleNamedTarget(compr.targetExpression, addedSymbols);
          this._addInferredTypeAssignmentForVariable(compr.targetExpression, compr);
        }
        boundSymbols.push(addedSymbols);
      }
      for (let i = 0; i < node.comprehensions.length; i++) {
        const compr = node.comprehensions[i];
        if (compr.nodeType === ParseNodeType.ListComprehensionFor) {
          const addedSymbols = boundSymbols[i];
          for (const addedSymbol of addedSymbols) {
            const aliasSymbol = this._currentScope.parent!.lookUpSymbol(addedSymbol[0]);
            if (aliasSymbol) {
              this._createAssignmentAliasFlowNode(addedSymbol[1].id, aliasSymbol.id);
            }
          }
          this.walk(compr.iterableExpression);
          this._createAssignmentTargetFlowNodes(compr.targetExpression, /* walkTargets */ true, /* unbound */ false);
        } else {
          const trueLabel = this._createBranchLabel();
          this._bindConditional(compr.testExpression, trueLabel, falseLabel);
          this._currentFlowNode = this._finishFlowLabel(trueLabel);
        }
      }
      this.walk(node.expression);
      this._addAntecedent(falseLabel, this._currentFlowNode!);
      this._currentFlowNode = this._finishFlowLabel(falseLabel);
    });
    return false;
  }
  visitMatch(node: MatchNode) {
    this.walk(node.subjectExpression);
    const postMatchLabel = this._createBranchLabel();
    node.cases.forEach((caseStatement) => {
      const postCaseLabel = this._createBranchLabel();
      const preGuardLabel = this._createBranchLabel();
      const preSuiteLabel = this._createBranchLabel();
      this._addAntecedent(preGuardLabel, this._currentFlowNode!);
      const isWildcardPattern =
        caseStatement.pattern.nodeType === ParseNodeType.PatternAs &&
        caseStatement.pattern.orPatterns.length === 1 &&
        caseStatement.pattern.orPatterns[0].nodeType === ParseNodeType.PatternCapture &&
        caseStatement.pattern.orPatterns[0].isWildcard;
      if (!isWildcardPattern) {
        this._addAntecedent(postCaseLabel, this._currentFlowNode!);
      }
      this._currentFlowNode = this._finishFlowLabel(preGuardLabel);
      this.walk(caseStatement.pattern);
      if (caseStatement.guardExpression) {
        this._bindConditional(caseStatement.guardExpression, preSuiteLabel, postCaseLabel);
      } else {
        this._addAntecedent(preSuiteLabel, this._currentFlowNode);
      }
      this._currentFlowNode = this._finishFlowLabel(preSuiteLabel);
      this.walk(caseStatement.suite);
      this._addAntecedent(postMatchLabel, this._currentFlowNode);
      this._currentFlowNode = this._finishFlowLabel(postCaseLabel);
    });
    this._addAntecedent(postMatchLabel, this._currentFlowNode!);
    this._currentFlowNode = this._finishFlowLabel(postMatchLabel);
    return false;
  }
  visitPatternAs(node: PatternAsNode) {
    const postOrLabel = this._createBranchLabel();
    node.orPatterns.forEach((orPattern) => {
      this.walk(orPattern);
      this._addAntecedent(postOrLabel, this._currentFlowNode!);
    });
    this._currentFlowNode = this._finishFlowLabel(postOrLabel);
    if (node.target) {
      this.walk(node.target);
      const symbol = this._bindNameToScope(this._currentScope, node.target.value);
      this._createAssignmentTargetFlowNodes(node.target, /* walkTargets */ false, /* unbound */ false);
      if (symbol) {
        const declaration: VariableDeclaration = {
          type: DeclarationType.Variable,
          node: node.target,
          isConstant: isConstantName(node.target.value),
          inferredTypeSource: node,
          path: this._fileInfo.filePath,
          range: convertOffsetsToRange(node.target.start, TextRange.getEnd(node.target), this._fileInfo.lines),
          moduleName: this._fileInfo.moduleName,
        };
        symbol.addDeclaration(declaration);
      }
    }
    return false;
  }
  visitPatternCapture(node: PatternCaptureNode) {
    if (!node.isWildcard) {
      this._addPatternCaptureTarget(node.target);
    }
    return true;
  }
  visitPatternMappingExpandEntry(node: PatternMappingExpandEntryNode) {
    if (node.target.value !== '_') {
      this._addPatternCaptureTarget(node.target);
    }
    return true;
  }
  private _isInListComprehension(node: ParseNode) {
    let curNode: ParseNode | undefined = node;
    while (curNode) {
      if (curNode.nodeType === ParseNodeType.ListComprehension) {
        return true;
      }
      curNode = curNode.parent;
    }
    return false;
  }
  private _addPatternCaptureTarget(target: NameNode) {
    const symbol = this._bindNameToScope(this._currentScope, target.value);
    this._createAssignmentTargetFlowNodes(target, /* walkTargets */ false, /* unbound */ false);
    if (symbol) {
      const declaration: VariableDeclaration = {
        type: DeclarationType.Variable,
        node: target,
        isConstant: isConstantName(target.value),
        inferredTypeSource: target.parent,
        path: this._fileInfo.filePath,
        range: convertOffsetsToRange(target.start, TextRange.getEnd(target), this._fileInfo.lines),
        moduleName: this._fileInfo.moduleName,
      };
      symbol.addDeclaration(declaration);
    }
  }
  private _useExceptTargets(targets: FlowLabel[], callback: () => void) {
    const prevExceptTargets = this._currentExceptTargets;
    this._currentExceptTargets = targets;
    callback();
    this._currentExceptTargets = prevExceptTargets;
  }
  private _disableTrueFalseTargets(callback: () => void): void {
    const savedTrueTarget = this._currentTrueTarget;
    const savedFalseTarget = this._currentFalseTarget;
    this._currentTrueTarget = undefined;
    this._currentFalseTarget = undefined;
    callback();
    this._currentFalseTarget = savedFalseTarget;
    this._currentTrueTarget = savedTrueTarget;
  }
  private _getDunderAllNamesFromImport(varName: string): string[] | undefined {
    const varSymbol = this._currentScope.lookUpSymbol(varName);
    if (!varSymbol) {
      return undefined;
    }
    const aliasDecl = varSymbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias) as AliasDeclaration | undefined;
    const resolvedPath = aliasDecl?.path || aliasDecl?.submoduleFallback?.path;
    if (!resolvedPath) {
      return undefined;
    }
    const lookupInfo = this._fileInfo.importLookup(resolvedPath);
    if (!lookupInfo) {
      return undefined;
    }
    return lookupInfo.dunderAllNames;
  }
  private _addImplicitFromImport(node: ImportFromNode, importInfo?: ImportResult) {
    const symbolName = node.module.nameParts[0].value;
    const symbol = this._bindNameToScope(this._currentScope, symbolName);
    if (symbol) {
      this._createAliasDeclarationForMultipartImportName(node, undefined, importInfo, symbol);
    }
    this._createFlowAssignment(node.module.nameParts[0]);
  }
  private _createAliasDeclarationForMultipartImportName(node: ImportAsNode | ImportFromNode, importAlias: NameNode | undefined, importInfo: ImportResult | undefined, symbol: Symbol) {
    const firstNamePartValue = node.module.nameParts[0].value;
    if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib && importInfo.resolvedPaths.length > 0) {
      const existingDecl = symbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias && decl.firstNamePart === firstNamePartValue);
      let newDecl: AliasDeclaration;
      if (existingDecl) {
        newDecl = existingDecl as AliasDeclaration;
      } else {
        newDecl = {
          type: DeclarationType.Alias,
          node,
          path: '',
          moduleName: importInfo.importName,
          range: getEmptyRange(),
          firstNamePart: firstNamePartValue,
          usesLocalName: !!importAlias,
        };
      }
      if (importAlias || node.module.nameParts.length === 1) {
        newDecl.path = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
        this._addImplicitImportsToLoaderActions(importInfo, newDecl);
      } else {
        let curLoaderActions: ModuleLoaderActions = newDecl;
        for (let i = 1; i < node.module.nameParts.length; i++) {
          if (i >= importInfo.resolvedPaths.length) {
            break;
          }
          const namePartValue = node.module.nameParts[i].value;
          let loaderActions = curLoaderActions.implicitImports ? curLoaderActions.implicitImports.get(namePartValue) : undefined;
          if (!loaderActions) {
            loaderActions = {
              path: '',
              implicitImports: new Map<string, ModuleLoaderActions>(),
            };
            if (!curLoaderActions.implicitImports) {
              curLoaderActions.implicitImports = new Map<string, ModuleLoaderActions>();
            }
            curLoaderActions.implicitImports.set(namePartValue, loaderActions);
          }
          if (i === node.module.nameParts.length - 1) {
            loaderActions.path = importInfo.resolvedPaths[i];
            this._addImplicitImportsToLoaderActions(importInfo, loaderActions);
          }
          curLoaderActions = loaderActions;
        }
      }
      if (!existingDecl) {
        symbol.addDeclaration(newDecl);
      }
    } else {
      const newDecl: AliasDeclaration = {
        type: DeclarationType.Alias,
        node,
        path: '*** unresolved ***',
        range: getEmptyRange(),
        usesLocalName: !!importAlias,
        moduleName: '',
        isUnresolved: true,
      };
      symbol.addDeclaration(newDecl);
    }
  }
  private _getWildcardImportNames(lookupInfo: ImportLookupResult): string[] {
    if (lookupInfo.dunderAllNames) {
      return lookupInfo.dunderAllNames;
    }
    const namesToImport: string[] = [];
    lookupInfo.symbolTable.forEach((symbol, name) => {
      if (!symbol.isExternallyHidden()) {
        namesToImport!.push(name);
      }
    });
    return namesToImport;
  }
  private _walkStatementsAndReportUnreachable(statements: StatementNode[]) {
    let foundUnreachableStatement = false;
    for (const statement of statements) {
      AnalyzerNodeInfo.setFlowNode(statement, this._currentFlowNode!);
      if (!foundUnreachableStatement) {
        foundUnreachableStatement = this._isCodeUnreachable();
      }
      if (!foundUnreachableStatement) {
        this.walk(statement);
      } else {
        if (this._targetFunctionDeclaration && !this._targetFunctionDeclaration.isGenerator) {
          const yieldFinder = new YieldFinder();
          if (yieldFinder.checkContainsYield(statement)) {
            this._targetFunctionDeclaration.isGenerator = true;
          }
        }
      }
    }
    return false;
  }
  private _createStartFlowNode() {
    const flowNode: FlowNode = {
      flags: FlowFlags.Start,
      id: getUniqueFlowNodeId(),
    };
    return flowNode;
  }
  private _createBranchLabel() {
    const flowNode: FlowLabel = {
      flags: FlowFlags.BranchLabel,
      id: getUniqueFlowNodeId(),
      antecedents: [],
    };
    return flowNode;
  }
  private _createContextMgrLabel(expressions: ExpressionNode[], isAsync: boolean) {
    const flowNode: FlowPostContextMgrLabel = {
      flags: FlowFlags.PostContextMgr | FlowFlags.BranchLabel,
      id: getUniqueFlowNodeId(),
      antecedents: [],
      expressions,
      isAsync,
    };
    return flowNode;
  }
  private _createLoopLabel() {
    const flowNode: FlowLabel = {
      flags: FlowFlags.LoopLabel,
      id: getUniqueFlowNodeId(),
      antecedents: [],
    };
    return flowNode;
  }
  private _finishFlowLabel(node: FlowLabel) {
    if (node.antecedents.length === 0) {
      return Binder._unreachableFlowNode;
    }
    if (node.antecedents.length === 1 && node.flags === FlowFlags.BranchLabel) {
      return node.antecedents[0];
    }
    return node;
  }
  private _bindNeverCondition(node: ExpressionNode, target: FlowLabel, isPositiveTest: boolean) {
    const expressionList: CodeFlowReferenceExpressionNode[] = [];
    if (node.nodeType === ParseNodeType.UnaryOp && node.operator === OperatorType.Not) {
      this._bindNeverCondition(node.expression, target, !isPositiveTest);
    } else if (node.nodeType === ParseNodeType.BinaryOp && (node.operator === OperatorType.And || node.operator === OperatorType.Or)) {
      if (node.operator === OperatorType.And) {
        const savedCurrentFlowNode = this._currentFlowNode;
        this._bindNeverCondition(node.leftExpression, target, isPositiveTest);
        this._currentFlowNode = savedCurrentFlowNode;
        this._bindNeverCondition(node.rightExpression, target, isPositiveTest);
      } else {
        const initialCurrentFlowNode = this._currentFlowNode;
        const afterLabel = this._createBranchLabel();
        this._bindNeverCondition(node.leftExpression, afterLabel, isPositiveTest);
        if (initialCurrentFlowNode !== this._currentFlowNode) {
          this._currentFlowNode = this._finishFlowLabel(afterLabel);
          const prevCurrentNode = this._currentFlowNode;
          this._bindNeverCondition(node.rightExpression, target, isPositiveTest);
          if (prevCurrentNode === this._currentFlowNode) {
            this._currentFlowNode = initialCurrentFlowNode;
          }
        }
      }
    } else {
      if (this._isNarrowingExpression(node, expressionList, /* neverNarrowingExpressions */ true)) {
        const filteredExprList = expressionList.filter((expr) => expr.nodeType === ParseNodeType.Name);
        if (filteredExprList.length > 0) {
          this._currentFlowNode = this._createFlowConditional(isPositiveTest ? FlowFlags.TrueNeverCondition : FlowFlags.FalseNeverCondition, this._currentFlowNode!, node);
        }
      }
      this._addAntecedent(target, this._currentFlowNode!);
    }
  }
  private _bindConditional(node: ExpressionNode, trueTarget: FlowLabel, falseTarget: FlowLabel) {
    const savedTrueTarget = this._currentTrueTarget;
    const savedFalseTarget = this._currentFalseTarget;
    this._currentTrueTarget = trueTarget;
    this._currentFalseTarget = falseTarget;
    this.walk(node);
    this._currentTrueTarget = savedTrueTarget;
    this._currentFalseTarget = savedFalseTarget;
    if (!this._isLogicalExpression(node)) {
      this._addAntecedent(trueTarget, this._createFlowConditional(FlowFlags.TrueCondition, this._currentFlowNode!, node));
      this._addAntecedent(falseTarget, this._createFlowConditional(FlowFlags.FalseCondition, this._currentFlowNode!, node));
    }
  }
  private _createFlowConditional(flags: FlowFlags, antecedent: FlowNode, expression: ExpressionNode): FlowNode {
    if (antecedent.flags & FlowFlags.Unreachable) {
      return antecedent;
    }
    const staticValue = StaticExpressions.evaluateStaticBoolLikeExpression(expression, this._fileInfo.executionEnvironment, this._typingImportAliases, this._sysImportAliases);
    if ((staticValue === true && flags & FlowFlags.FalseCondition) || (staticValue === false && flags & FlowFlags.TrueCondition)) {
      return Binder._unreachableFlowNode;
    }
    const expressionList: CodeFlowReferenceExpressionNode[] = [];
    if (!this._isNarrowingExpression(expression, expressionList)) {
      return antecedent;
    }
    expressionList.forEach((expr) => {
      const referenceKey = createKeyForReference(expr);
      this._currentExecutionScopeReferenceMap!.set(referenceKey, referenceKey);
    });
    const filteredExprList = expressionList.filter((expr) => expr.nodeType === ParseNodeType.Name);
    const conditionalFlowNode: FlowCondition = {
      flags,
      id: getUniqueFlowNodeId(),
      reference: filteredExprList.length > 0 ? (filteredExprList[0] as NameNode) : undefined,
      expression,
      antecedent,
    };
    this._addExceptTargets(conditionalFlowNode);
    return conditionalFlowNode;
  }
  private _isLogicalExpression(expression: ExpressionNode): boolean {
    switch (expression.nodeType) {
      case ParseNodeType.UnaryOp: {
        return expression.operator === OperatorType.Not;
      }
      case ParseNodeType.BinaryOp: {
        return expression.operator === OperatorType.And || expression.operator === OperatorType.Or;
      }
    }
    return false;
  }
  private _isNarrowingExpression(expression: ExpressionNode, expressionList: CodeFlowReferenceExpressionNode[], filterForNeverNarrowing = false, isComplexExpression = false): boolean {
    switch (expression.nodeType) {
      case ParseNodeType.Name:
      case ParseNodeType.MemberAccess:
      case ParseNodeType.Index: {
        if (filterForNeverNarrowing) {
          if (expression.nodeType !== ParseNodeType.Name) {
            return false;
          }
          if (!isComplexExpression) {
            return false;
          }
        }
        if (isCodeFlowSupportedForReference(expression)) {
          expressionList.push(expression);
          return true;
        }
        return false;
      }
      case ParseNodeType.AssignmentExpression: {
        expressionList.push(expression.name);
        return true;
      }
      case ParseNodeType.BinaryOp: {
        const isOrIsNotOperator = expression.operator === OperatorType.Is || expression.operator === OperatorType.IsNot;
        const equalsOrNotEqualsOperator = expression.operator === OperatorType.Equals || expression.operator === OperatorType.NotEquals;
        if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
          if (expression.rightExpression.nodeType === ParseNodeType.Constant && expression.rightExpression.constType === KeywordType.None) {
            return this._isNarrowingExpression(expression.leftExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
          }
          if (
            isOrIsNotOperator &&
            expression.leftExpression.nodeType === ParseNodeType.Call &&
            expression.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
            expression.leftExpression.leftExpression.value === 'type' &&
            expression.leftExpression.arguments.length === 1 &&
            expression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple
          ) {
            return this._isNarrowingExpression(expression.leftExpression.arguments[0].valueExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
          }
          const isLeftNarrowing = this._isNarrowingExpression(expression.leftExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
          if (isOrIsNotOperator) {
            return isLeftNarrowing;
          }
          if (equalsOrNotEqualsOperator) {
            const isRightNarrowing = this._isNarrowingExpression(expression.rightExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
            return isLeftNarrowing || isRightNarrowing;
          }
        }
        if (expression.operator === OperatorType.In || expression.operator === OperatorType.NotIn) {
          if (this._isNarrowingExpression(expression.rightExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true)) {
            return true;
          }
        }
        if (expression.operator === OperatorType.In) {
          return this._isNarrowingExpression(expression.leftExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
        }
        return false;
      }
      case ParseNodeType.UnaryOp: {
        return expression.operator === OperatorType.Not && this._isNarrowingExpression(expression.expression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ false);
      }
      case ParseNodeType.AugmentedAssignment: {
        return this._isNarrowingExpression(expression.rightExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
      }
      case ParseNodeType.Call: {
        if (
          expression.leftExpression.nodeType === ParseNodeType.Name &&
          (expression.leftExpression.value === 'isinstance' || expression.leftExpression.value === 'issubclass') &&
          expression.arguments.length === 2
        ) {
          return this._isNarrowingExpression(expression.arguments[0].valueExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
        }
        if (expression.leftExpression.nodeType === ParseNodeType.Name && expression.leftExpression.value === 'callable' && expression.arguments.length === 1) {
          return this._isNarrowingExpression(expression.arguments[0].valueExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
        }
        if (expression.arguments.length >= 1) {
          if (filterForNeverNarrowing) {
            return false;
          }
          return this._isNarrowingExpression(expression.arguments[0].valueExpression, expressionList, filterForNeverNarrowing, /* isComplexExpression */ true);
        }
      }
    }
    return false;
  }
  private _createAssignmentTargetFlowNodes(target: ExpressionNode, walkTargets: boolean, unbound: boolean) {
    switch (target.nodeType) {
      case ParseNodeType.Name:
      case ParseNodeType.MemberAccess: {
        this._createFlowAssignment(target, unbound);
        if (walkTargets) {
          this.walk(target);
        }
        break;
      }
      case ParseNodeType.Index: {
        this._createFlowAssignment(target, unbound);
        if (walkTargets) {
          this.walk(target);
        }
        break;
      }
      case ParseNodeType.Tuple: {
        target.expressions.forEach((expr) => {
          this._createAssignmentTargetFlowNodes(expr, walkTargets, unbound);
        });
        break;
      }
      case ParseNodeType.TypeAnnotation: {
        this._createAssignmentTargetFlowNodes(target.valueExpression, /* walkTargets */ false, unbound);
        if (walkTargets) {
          this.walk(target);
        }
        break;
      }
      case ParseNodeType.Unpack: {
        this._createAssignmentTargetFlowNodes(target.expression, /* walkTargets */ false, unbound);
        if (walkTargets) {
          this.walk(target);
        }
        break;
      }
      case ParseNodeType.List: {
        target.entries.forEach((entry) => {
          this._createAssignmentTargetFlowNodes(entry, walkTargets, unbound);
        });
        break;
      }
      default: {
        if (walkTargets) {
          this.walk(target);
        }
      }
    }
  }
  private _createCallFlowNode(node: CallNode) {
    if (!this._isCodeUnreachable()) {
      const flowNode: FlowCall = {
        flags: FlowFlags.Call,
        id: getUniqueFlowNodeId(),
        node,
        antecedent: this._currentFlowNode!,
      };
      this._currentFlowNode = flowNode;
    }
    AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    if (!this._isCodeUnreachable()) {
      this._addExceptTargets(this._currentFlowNode!);
    }
  }
  private _createAssignmentAliasFlowNode(targetSymbolId: number, aliasSymbolId: number) {
    if (!this._isCodeUnreachable()) {
      const flowNode: FlowAssignmentAlias = {
        flags: FlowFlags.AssignmentAlias,
        id: getUniqueFlowNodeId(),
        antecedent: this._currentFlowNode!,
        targetSymbolId,
        aliasSymbolId,
      };
      this._currentFlowNode = flowNode;
    }
  }
  private _createVariableAnnotationFlowNode() {
    if (!this._isCodeUnreachable()) {
      const flowNode: FlowVariableAnnotation = {
        flags: FlowFlags.VariableAnnotation,
        id: getUniqueFlowNodeId(),
        antecedent: this._currentFlowNode!,
      };
      this._currentFlowNode = flowNode;
    }
  }
  private _createFlowAssignment(node: CodeFlowReferenceExpressionNode, unbound = false) {
    let targetSymbolId = indeterminateSymbolId;
    if (node.nodeType === ParseNodeType.Name) {
      const symbolWithScope = this._currentScope.lookUpSymbolRecursive(node.value);
      assert(symbolWithScope !== undefined);
      targetSymbolId = symbolWithScope!.symbol.id;
    }
    const prevFlowNode = this._currentFlowNode!;
    if (!this._isCodeUnreachable() && isCodeFlowSupportedForReference(node)) {
      const flowNode: FlowAssignment = {
        flags: FlowFlags.Assignment,
        id: getUniqueFlowNodeId(),
        node,
        antecedent: this._currentFlowNode!,
        targetSymbolId,
      };
      const referenceKey = createKeyForReference(node);
      this._currentExecutionScopeReferenceMap!.set(referenceKey, referenceKey);
      if (unbound) {
        flowNode.flags |= FlowFlags.Unbind;
      }
      if (node.nodeType === ParseNodeType.MemberAccess) {
        this._addExceptTargets(flowNode);
      }
      this._currentFlowNode = flowNode;
    }
    if (!unbound || AnalyzerNodeInfo.getFlowNode(node) === undefined) {
      AnalyzerNodeInfo.setFlowNode(node, unbound ? prevFlowNode : this._currentFlowNode!);
    }
  }
  private _createFlowWildcardImport(node: ImportFromNode, names: string[]) {
    if (!this._isCodeUnreachable()) {
      const flowNode: FlowWildcardImport = {
        flags: FlowFlags.WildcardImport,
        id: getUniqueFlowNodeId(),
        node,
        names,
        antecedent: this._currentFlowNode!,
      };
      this._addExceptTargets(flowNode);
      this._currentFlowNode = flowNode;
    }
    AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
  }
  private _isCodeUnreachable() {
    return !!(this._currentFlowNode!.flags & FlowFlags.Unreachable);
  }
  private _addExceptTargets(flowNode: FlowNode) {
    if (this._currentExceptTargets) {
      this._currentExceptTargets.forEach((label) => {
        this._addAntecedent(label, flowNode);
      });
    }
  }
  private _bindLoopStatement(preLoopLabel: FlowLabel, postLoopLabel: FlowLabel, callback: () => void) {
    const savedContinueTarget = this._currentContinueTarget;
    const savedBreakTarget = this._currentBreakTarget;
    this._currentContinueTarget = preLoopLabel;
    this._currentBreakTarget = postLoopLabel;
    callback();
    this._currentContinueTarget = savedContinueTarget;
    this._currentBreakTarget = savedBreakTarget;
  }
  private _addAntecedent(label: FlowLabel, antecedent: FlowNode) {
    if (!(this._currentFlowNode!.flags & FlowFlags.Unreachable)) {
      if (!label.antecedents.some((existing) => existing.id === antecedent.id)) {
        label.antecedents.push(antecedent);
      }
    }
  }
  private _bindNameToScope(scope: Scope, name: string, addedSymbols?: Map<string, Symbol>) {
    const bindingType = this._currentScope.getBindingType(name);
    if (bindingType !== undefined) {
      const scopeToUse = bindingType === NameBindingType.Nonlocal ? this._currentScope.parent! : this._currentScope.getGlobalScope();
      const symbolWithScope = scopeToUse.lookUpSymbolRecursive(name);
      if (symbolWithScope) {
        return symbolWithScope.symbol;
      }
    } else {
      let symbol = scope.lookUpSymbol(name);
      if (!symbol) {
        symbol = scope.addSymbol(name, SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember);
        if (scope.type === ScopeType.Class) {
          const aliasSymbol = scope.parent!.lookUpSymbol(name);
          if (aliasSymbol) {
            this._createAssignmentAliasFlowNode(symbol.id, aliasSymbol.id);
          }
        }
        if (isPrivateOrProtectedName(name)) {
          if (this._fileInfo.isStubFile || isPrivateName(name)) {
            symbol.setIsExternallyHidden();
          } else if (this._fileInfo.isInPyTypedPackage && this._currentScope.type === ScopeType.Module) {
            this._potentialPrivateSymbols.set(name, symbol);
          }
        }
        if (addedSymbols) {
          addedSymbols.set(name, symbol);
        }
      }
      return symbol;
    }
    return undefined;
  }
  private _bindPossibleTupleNamedTarget(target: ExpressionNode, addedSymbols?: Map<string, Symbol>) {
    switch (target.nodeType) {
      case ParseNodeType.Name: {
        this._bindNameToScope(this._currentScope, target.value, addedSymbols);
        break;
      }
      case ParseNodeType.Tuple: {
        target.expressions.forEach((expr) => {
          this._bindPossibleTupleNamedTarget(expr, addedSymbols);
        });
        break;
      }
      case ParseNodeType.List: {
        target.entries.forEach((expr) => {
          this._bindPossibleTupleNamedTarget(expr, addedSymbols);
        });
        break;
      }
      case ParseNodeType.TypeAnnotation: {
        this._bindPossibleTupleNamedTarget(target.valueExpression, addedSymbols);
        break;
      }
      case ParseNodeType.Unpack: {
        this._bindPossibleTupleNamedTarget(target.expression, addedSymbols);
        break;
      }
    }
  }
  private _addBuiltInSymbolToCurrentScope(nameValue: string, node: ModuleNode | ClassNode | FunctionNode, type: IntrinsicType) {
    const symbol = this._addSymbolToCurrentScope(nameValue, /* isInitiallyUnbound */ false);
    if (symbol) {
      symbol.addDeclaration({
        type: DeclarationType.Intrinsic,
        node,
        intrinsicType: type,
        path: this._fileInfo.filePath,
        range: getEmptyRange(),
        moduleName: this._fileInfo.moduleName,
      });
      symbol.setIsIgnoredForProtocolMatch();
    }
  }
  private _addSymbolToCurrentScope(nameValue: string, isInitiallyUnbound: boolean) {
    let symbol = this._currentScope.lookUpSymbol(nameValue);
    if (!symbol) {
      let symbolFlags = SymbolFlags.None;
      if (isInitiallyUnbound) {
        symbolFlags |= SymbolFlags.InitiallyUnbound;
      }
      if (this._currentScope.type === ScopeType.Class) {
        symbolFlags |= SymbolFlags.ClassMember;
      }
      if (this._fileInfo.isStubFile && isPrivateOrProtectedName(nameValue)) {
        symbolFlags |= SymbolFlags.ExternallyHidden;
      }
      symbol = this._currentScope.addSymbol(nameValue, symbolFlags);
    }
    return symbol;
  }
  private _createNewScope(scopeType: ScopeType, parentScope: Scope | undefined, callback: () => void) {
    const prevScope = this._currentScope;
    const newScope = new Scope(scopeType, parentScope);
    this._currentScope = newScope;
    const isExecutionScope = scopeType === ScopeType.Builtin || scopeType === ScopeType.Module || scopeType === ScopeType.Function;
    const prevReferenceMap = this._currentExecutionScopeReferenceMap;
    if (isExecutionScope) {
      this._currentExecutionScopeReferenceMap = new Map<string, string>();
    }
    callback();
    this._currentExecutionScopeReferenceMap = prevReferenceMap;
    this._currentScope = prevScope;
    return newScope;
  }
  private _addInferredTypeAssignmentForVariable(target: ExpressionNode, source: ParseNode, isPossibleTypeAlias = false) {
    switch (target.nodeType) {
      case ParseNodeType.Name: {
        const name = target;
        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
        if (symbolWithScope && symbolWithScope.symbol) {
          const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: target,
            isConstant: isConstantName(target.value),
            inferredTypeSource: source,
            typeAliasName: isPossibleTypeAlias ? target : undefined,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
          };
          symbolWithScope.symbol.addDeclaration(declaration);
        }
        break;
      }
      case ParseNodeType.MemberAccess: {
        const memberAccessInfo = this._getMemberAccessInfo(target);
        if (memberAccessInfo) {
          const name = target.memberName;
          let symbol = memberAccessInfo.classScope.lookUpSymbol(name.value);
          if (!symbol) {
            symbol = memberAccessInfo.classScope.addSymbol(name.value, SymbolFlags.InitiallyUnbound);
            const honorPrivateNaming = this._fileInfo.diagnosticRuleSet.reportPrivateUsage !== 'none';
            if (isPrivateOrProtectedName(name.value) && honorPrivateNaming) {
              symbol.setIsPrivateMember();
            }
          }
          if (memberAccessInfo.isInstanceMember) {
            if (!symbol.isClassMember() || !symbol.getDeclarations().some((decl) => decl.type === DeclarationType.Function && decl.isMethod)) {
              symbol.setIsInstanceMember();
            }
          } else {
            symbol.setIsClassMember();
          }
          const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: target.memberName,
            isConstant: isConstantName(name.value),
            inferredTypeSource: source,
            isDefinedByMemberAccess: true,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(target.memberName.start, target.memberName.start + target.memberName.length, this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
          };
          symbol.addDeclaration(declaration);
        }
        break;
      }
      case ParseNodeType.Tuple: {
        target.expressions.forEach((expr) => {
          this._addInferredTypeAssignmentForVariable(expr, source);
        });
        break;
      }
      case ParseNodeType.TypeAnnotation: {
        this._addInferredTypeAssignmentForVariable(target.valueExpression, source);
        break;
      }
      case ParseNodeType.Unpack: {
        this._addInferredTypeAssignmentForVariable(target.expression, source);
        break;
      }
      case ParseNodeType.List: {
        target.entries.forEach((entry) => {
          this._addInferredTypeAssignmentForVariable(entry, source);
        });
        break;
      }
    }
  }
  private _addTypeDeclarationForVariable(target: ExpressionNode, typeAnnotation: ExpressionNode) {
    let declarationHandled = false;
    switch (target.nodeType) {
      case ParseNodeType.Name: {
        const name = target;
        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
        if (symbolWithScope && symbolWithScope.symbol) {
          const finalInfo = this._isAnnotationFinal(typeAnnotation);
          const isExplicitTypeAlias = this._isAnnotationTypeAlias(typeAnnotation);
          let typeAnnotationNode: ExpressionNode | undefined = typeAnnotation;
          if (isExplicitTypeAlias) {
            typeAnnotationNode = undefined;
            if (this._currentScope.type !== ScopeType.Module) {
              this._addError(Localizer.Diag.typeAliasNotInModule(), typeAnnotation);
            }
          } else if (finalInfo.isFinal) {
            typeAnnotationNode = finalInfo.finalTypeNode;
          }
          const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: target,
            isConstant: isConstantName(name.value),
            isFinal: finalInfo.isFinal,
            isRequired: this._isRequiredAnnotation(typeAnnotationNode),
            isNotRequired: this._isNotRequiredAnnotation(typeAnnotationNode),
            typeAliasAnnotation: isExplicitTypeAlias ? typeAnnotation : undefined,
            typeAliasName: isExplicitTypeAlias ? target : undefined,
            path: this._fileInfo.filePath,
            typeAnnotationNode,
            range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
          };
          symbolWithScope.symbol.addDeclaration(declaration);
          const isClassVar = typeAnnotation.nodeType === ParseNodeType.Index && this._isTypingAnnotation(typeAnnotation.baseExpression, 'ClassVar');
          if (isClassVar) {
            symbolWithScope.symbol.setIsClassVar();
          } else {
            symbolWithScope.symbol.setIsInstanceMember();
          }
        }
        declarationHandled = true;
        break;
      }
      case ParseNodeType.MemberAccess: {
        const memberAccessInfo = this._getMemberAccessInfo(target);
        if (memberAccessInfo) {
          const name = target.memberName;
          let symbol = memberAccessInfo.classScope.lookUpSymbol(name.value);
          if (!symbol) {
            symbol = memberAccessInfo.classScope.addSymbol(name.value, SymbolFlags.InitiallyUnbound);
            const honorPrivateNaming = this._fileInfo.diagnosticRuleSet.reportPrivateUsage !== 'none';
            if (isPrivateOrProtectedName(name.value) && honorPrivateNaming) {
              symbol.setIsPrivateMember();
            }
          }
          if (memberAccessInfo.isInstanceMember) {
            symbol.setIsInstanceMember();
          } else {
            symbol.setIsClassMember();
          }
          const finalInfo = this._isAnnotationFinal(typeAnnotation);
          const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: target.memberName,
            isConstant: isConstantName(name.value),
            isDefinedByMemberAccess: true,
            isFinal: finalInfo.isFinal,
            path: this._fileInfo.filePath,
            typeAnnotationNode: finalInfo.isFinal ? finalInfo.finalTypeNode : typeAnnotation,
            range: convertOffsetsToRange(target.memberName.start, target.memberName.start + target.memberName.length, this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
          };
          symbol.addDeclaration(declaration);
          declarationHandled = true;
        }
        break;
      }
    }
    if (!declarationHandled) {
      this._addError(Localizer.Diag.annotationNotSupported(), typeAnnotation);
    }
  }
  private _isTypingAnnotation(typeAnnotation: ExpressionNode, name: string): boolean {
    if (typeAnnotation.nodeType === ParseNodeType.Name) {
      const alias = this._typingSymbolAliases.get(typeAnnotation.value);
      if (alias === name) {
        return true;
      }
    } else if (typeAnnotation.nodeType === ParseNodeType.MemberAccess) {
      if (typeAnnotation.leftExpression.nodeType === ParseNodeType.Name && typeAnnotation.memberName.value === name) {
        const baseName = typeAnnotation.leftExpression.value;
        return this._typingImportAliases.some((alias) => alias === baseName);
      }
    }
    return false;
  }
  private _isAnnotationFinal(typeAnnotation: ExpressionNode | undefined): FinalInfo {
    let isFinal = false;
    let finalTypeNode: ExpressionNode | undefined;
    if (typeAnnotation) {
      if (this._isTypingAnnotation(typeAnnotation, 'Final')) {
        isFinal = true;
      } else if (typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.items.length === 1) {
        const finalInfo = this._isAnnotationFinal(typeAnnotation.baseExpression);
        if (finalInfo.isFinal && typeAnnotation.items[0].argumentCategory === ArgumentCategory.Simple && !typeAnnotation.items[0].name && !typeAnnotation.trailingComma) {
          isFinal = true;
          finalTypeNode = typeAnnotation.items[0].valueExpression;
        }
      }
    }
    return { isFinal, finalTypeNode };
  }
  private _isRequiredAnnotation(typeAnnotation: ExpressionNode | undefined): boolean {
    if (typeAnnotation && typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.items.length === 1) {
      if (this._isTypingAnnotation(typeAnnotation.baseExpression, 'Required')) {
        return true;
      }
    }
    return false;
  }
  private _isNotRequiredAnnotation(typeAnnotation: ExpressionNode | undefined): boolean {
    if (typeAnnotation && typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.items.length === 1) {
      if (this._isTypingAnnotation(typeAnnotation.baseExpression, 'NotRequired')) {
        return true;
      }
    }
    return false;
  }
  private _isAnnotationTypeAlias(typeAnnotation: ExpressionNode | undefined) {
    if (!typeAnnotation) {
      return false;
    }
    return this._isTypingAnnotation(typeAnnotation, 'TypeAlias');
  }
  private _getMemberAccessInfo(node: MemberAccessNode): MemberAccessInfo | undefined {
    if (node.leftExpression.nodeType !== ParseNodeType.Name) {
      return undefined;
    }
    const leftSymbolName = node.leftExpression.value;
    const methodNode = ParseTreeUtils.getEnclosingFunction(node);
    if (!methodNode) {
      return undefined;
    }
    const classNode = ParseTreeUtils.getEnclosingClass(methodNode);
    if (!classNode) {
      return undefined;
    }
    let isInstanceMember = false;
    if (methodNode.parameters.length < 1 || !methodNode.parameters[0].name) {
      return undefined;
    }
    const className = classNode.name.value;
    const firstParamName = methodNode.parameters[0].name.value;
    if (leftSymbolName === className) {
      isInstanceMember = false;
    } else {
      if (leftSymbolName !== firstParamName) {
        return undefined;
      }
      if (methodNode.name.value === '__new__') {
        isInstanceMember = false;
      } else {
        isInstanceMember = true;
        for (const decorator of methodNode.decorators) {
          if (decorator.expression.nodeType === ParseNodeType.Name) {
            const decoratorName = decorator.expression.value;
            if (decoratorName === 'staticmethod') {
              return undefined;
            } else if (decoratorName === 'classmethod') {
              isInstanceMember = false;
              break;
            }
          }
        }
      }
    }
    const classScope = AnalyzerNodeInfo.getScope(classNode)!;
    assert(classScope !== undefined);
    return {
      classNode,
      methodNode,
      classScope,
      isInstanceMember,
    };
  }
  private _addImplicitImportsToLoaderActions(importResult: ImportResult, loaderActions: ModuleLoaderActions) {
    importResult.filteredImplicitImports.forEach((implicitImport) => {
      const existingLoaderAction = loaderActions.implicitImports ? loaderActions.implicitImports.get(implicitImport.name) : undefined;
      if (existingLoaderAction) {
        existingLoaderAction.path = implicitImport.path;
      } else {
        if (!loaderActions.implicitImports) {
          loaderActions.implicitImports = new Map<string, ModuleLoaderActions>();
        }
        loaderActions.implicitImports.set(implicitImport.name, {
          path: implicitImport.path,
          implicitImports: new Map<string, ModuleLoaderActions>(),
        });
      }
    });
  }
  private _handleTypingStubAssignmentOrAnnotation(node: AssignmentNode | TypeAnnotationNode) {
    if (!this._fileInfo.isTypingStubFile) {
      return false;
    }
    let annotationNode: TypeAnnotationNode;
    if (node.nodeType === ParseNodeType.TypeAnnotation) {
      annotationNode = node;
    } else {
      if (node.leftExpression.nodeType !== ParseNodeType.TypeAnnotation) {
        return false;
      }
      annotationNode = node.leftExpression;
    }
    if (annotationNode.valueExpression.nodeType !== ParseNodeType.Name) {
      return false;
    }
    const assignedNameNode = annotationNode.valueExpression;
    const specialTypes: { [name: string]: boolean } = {
      Tuple: true,
      Generic: true,
      Protocol: true,
      Callable: true,
      Type: true,
      ClassVar: true,
      Final: true,
      Literal: true,
      TypedDict: true,
      Union: true,
      Optional: true,
      Annotated: true,
      TypeAlias: true,
      OrderedDict: true,
      Concatenate: true,
      TypeGuard: true,
      Unpack: true,
    };
    const assignedName = assignedNameNode.value;
    if (!specialTypes[assignedName]) {
      return false;
    }
    const symbol = this._bindNameToScope(this._currentScope, assignedName);
    if (symbol) {
      symbol.addDeclaration({
        type: DeclarationType.SpecialBuiltInClass,
        node: annotationNode,
        path: this._fileInfo.filePath,
        range: convertOffsetsToRange(annotationNode.start, TextRange.getEnd(annotationNode), this._fileInfo.lines),
        moduleName: this._fileInfo.moduleName,
      });
    }
    return true;
  }
  private _deferBinding(callback: () => void) {
    this._deferredBindingTasks.push({
      scope: this._currentScope,
      codeFlowExpressionMap: this._currentExecutionScopeReferenceMap!,
      callback,
    });
  }
  private _bindDeferred() {
    while (this._deferredBindingTasks.length > 0) {
      const nextItem = this._deferredBindingTasks.shift()!;
      this._currentScope = nextItem.scope;
      this._nestedExceptDepth = 0;
      this._currentExecutionScopeReferenceMap = nextItem.codeFlowExpressionMap;
      nextItem.callback();
    }
  }
  private _bindYield(node: YieldNode | YieldFromNode) {
    const functionNode = ParseTreeUtils.getEnclosingFunction(node);
    if (!functionNode) {
      if (!ParseTreeUtils.getEnclosingLambda(node)) {
        this._addError(Localizer.Diag.yieldOutsideFunction(), node);
      }
    } else if (functionNode.isAsync && node.nodeType === ParseNodeType.YieldFrom) {
      this._addError(Localizer.Diag.yieldFromOutsideAsync(), node);
    }
    if (this._targetFunctionDeclaration) {
      if (!this._targetFunctionDeclaration.yieldStatements) {
        this._targetFunctionDeclaration.yieldStatements = [];
      }
      this._targetFunctionDeclaration.yieldStatements.push(node);
      this._targetFunctionDeclaration.isGenerator = true;
    }
    if (node.expression) {
      this.walk(node.expression);
    }
    AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
  }
  private _addDiag(diagLevel: DiagLevel, rule: string, message: string, textRange: TextRange) {
    let diagnostic: Diag | undefined;
    switch (diagLevel) {
      case 'error':
        diagnostic = this._addError(message, textRange);
        break;
      case 'warning':
        diagnostic = this._addWarning(message, textRange);
        break;
      case 'information':
        diagnostic = this._addInformation(message, textRange);
        break;
      case 'none':
        break;
      default:
        return assertNever(diagLevel, `${diagLevel} is not expected`);
    }
    if (diagnostic) {
      diagnostic.setRule(rule);
    }
    return diagnostic;
  }
  private _addError(message: string, textRange: TextRange) {
    return this._fileInfo.diagnosticSink.addDiagWithTextRange('error', message, textRange);
  }
  private _addWarning(message: string, textRange: TextRange) {
    return this._fileInfo.diagnosticSink.addDiagWithTextRange('warning', message, textRange);
  }
  private _addInformation(message: string, textRange: TextRange) {
    return this._fileInfo.diagnosticSink.addDiagWithTextRange('information', message, textRange);
  }
}
export class YieldFinder extends ParseTreeWalker {
  private _containsYield = false;
  checkContainsYield(node: ParseNode) {
    this.walk(node);
    return this._containsYield;
  }
  visitYield(node: YieldNode): boolean {
    this._containsYield = true;
    return false;
  }
  visitYieldFrom(node: YieldFromNode): boolean {
    this._containsYield = true;
    return false;
  }
}
export class ReturnFinder extends ParseTreeWalker {
  private _containsReturn = false;
  checkContainsReturn(node: ParseNode) {
    this.walk(node);
    return this._containsReturn;
  }
  visitReturn(node: ReturnNode): boolean {
    this._containsReturn = true;
    return false;
  }
}
