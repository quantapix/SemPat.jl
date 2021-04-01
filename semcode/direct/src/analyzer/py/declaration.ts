import { Range } from '../common/textRange';
import {
  ClassNode,
  ExpressionNode,
  FunctionNode,
  ImportAsNode,
  ImportFromAsNode,
  ImportFromNode,
  ModuleNode,
  NameNode,
  ParameterNode,
  ParseNode,
  RaiseNode,
  ReturnNode,
  StringListNode,
  TypeAnnotationNode,
  YieldFromNode,
  YieldNode,
} from '../parser/parseNodes';

export const enum DeclarationType {
  Intrinsic,
  Variable,
  Parameter,
  Function,
  Class,
  SpecialBuiltInClass,
  Alias,
}

export type IntrinsicType = 'Any' | 'str' | 'int' | 'List[str]' | 'class' | 'Dict[str, Any]';

export interface DeclarationBase {
  type: DeclarationType;

  node: ParseNode;

  path: string;
  range: Range;

  moduleName: string;
}

export interface IntrinsicDeclaration extends DeclarationBase {
  type: DeclarationType.Intrinsic;
  node: ModuleNode | FunctionNode | ClassNode;
  intrinsicType: IntrinsicType;
}

export interface ClassDeclaration extends DeclarationBase {
  type: DeclarationType.Class;
  node: ClassNode;
}

export interface SpecialBuiltInClassDeclaration extends DeclarationBase {
  type: DeclarationType.SpecialBuiltInClass;
  node: TypeAnnotationNode;
}

export interface FunctionDeclaration extends DeclarationBase {
  type: DeclarationType.Function;
  node: FunctionNode;
  isMethod: boolean;
  isGenerator: boolean;
  returnStatements?: ReturnNode[];
  yieldStatements?: (YieldNode | YieldFromNode)[];
  raiseStatements?: RaiseNode[];
}

export interface ParameterDeclaration extends DeclarationBase {
  type: DeclarationType.Parameter;
  node: ParameterNode;
}

export interface VariableDeclaration extends DeclarationBase {
  type: DeclarationType.Variable;
  node: NameNode | StringListNode;

  typeAnnotationNode?: ExpressionNode;

  inferredTypeSource?: ParseNode;

  isConstant?: boolean;

  isFinal?: boolean;

  isRequired?: boolean;

  isNotRequired?: boolean;

  typeAliasAnnotation?: ExpressionNode;

  typeAliasName?: NameNode;

  isDefinedByMemberAccess?: boolean;
}

export interface AliasDeclaration extends DeclarationBase {
  type: DeclarationType.Alias;
  node: ImportAsNode | ImportFromAsNode | ImportFromNode;

  usesLocalName: boolean;

  symbolName?: string;

  submoduleFallback?: AliasDeclaration;

  firstNamePart?: string;

  implicitImports?: Map<string, ModuleLoaderActions>;

  isUnresolved?: boolean;
}

export interface ModuleLoaderActions {
  path: string;

  implicitImports?: Map<string, ModuleLoaderActions>;
}

export type Declaration = IntrinsicDeclaration | ClassDeclaration | SpecialBuiltInClassDeclaration | FunctionDeclaration | ParameterDeclaration | VariableDeclaration | AliasDeclaration;

export function isFunctionDeclaration(decl: Declaration): decl is FunctionDeclaration {
  return decl.type === DeclarationType.Function;
}

export function isClassDeclaration(decl: Declaration): decl is ClassDeclaration {
  return decl.type === DeclarationType.Class;
}

export function isParameterDeclaration(decl: Declaration): decl is ParameterDeclaration {
  return decl.type === DeclarationType.Parameter;
}

export function isVariableDeclaration(decl: Declaration): decl is VariableDeclaration {
  return decl.type === DeclarationType.Variable;
}

export function isAliasDeclaration(decl: Declaration): decl is AliasDeclaration {
  return decl.type === DeclarationType.Alias;
}

export function isSpecialBuiltInClassDeclarations(decl: Declaration): decl is SpecialBuiltInClassDeclaration {
  return decl.type === DeclarationType.SpecialBuiltInClass;
}
