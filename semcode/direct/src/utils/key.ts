import * as qv from 'vscode';
import type * as qp from '../server/proto';
export enum Kind {
  alias = 'alias',
  callSignature = 'call',
  class = 'class',
  const = 'const',
  constructorImplementation = 'constructor',
  constructSignature = 'construct',
  directory = 'directory',
  enum = 'enum',
  enumMember = 'enum member',
  externalModuleName = 'external module name',
  function = 'function',
  indexSignature = 'index',
  interface = 'interface',
  keyword = 'keyword',
  let = 'let',
  localFunction = 'local function',
  localVariable = 'local var',
  memberGetAccessor = 'getter',
  memberSetAccessor = 'setter',
  memberVariable = 'property',
  method = 'method',
  module = 'module',
  parameter = 'parameter',
  primitiveType = 'primitive type',
  script = 'script',
  string = 'string',
  type = 'type',
  typeParameter = 'type parameter',
  variable = 'var',
  warning = 'warning',
}
export enum DiagCategory {
  error = 'error',
  suggestion = 'suggestion',
  warning = 'warning',
}
export enum KindModifiers {
  color = 'color',
  depreacted = 'deprecated',
  dtsFile = '.d.ts',
  jsFile = '.js',
  jsonFile = '.json',
  jsxFile = '.jsx',
  optional = 'optional',
  tsFile = '.ts',
  tsxFile = '.tsx',
}
export enum DisplayPartKind {
  functionName = 'functionName',
  methodName = 'methodName',
  parameterName = 'parameterName',
  propertyName = 'propertyName',
  punctuation = 'punctuation',
  text = 'text',
}
export enum EventName {
  beginInstallTypes = 'beginInstallTypes',
  configFileDiag = 'configFileDiag',
  endInstallTypes = 'endInstallTypes',
  projectLangServiceState = 'projectLangServiceState',
  projectLoadingFinish = 'projectLoadingFinish',
  projectLoadingStart = 'projectLoadingStart',
  projectsUpdatedInBackground = 'projectsUpdatedInBackground',
  semanticDiag = 'semanticDiag',
  suggestionDiag = 'suggestionDiag',
  surveyReady = 'surveyReady',
  syntaxDiag = 'syntaxDiag',
  telemetry = 'telemetry',
  typesInstallerInitializationFailed = 'typesInstallerInitializationFailed',
}
fileExtensionKindModifiers = [KindModifiers.dtsFile, KindModifiers.tsFile, KindModifiers.tsxFile, KindModifiers.jsFile, KindModifiers.jsxFile, KindModifiers.jsonFile];

export namespace SymbolKind {
  export function fromProtocolScriptElementKind(x: qp.ScriptElementKind) {
    const k = x as Kind;
    switch (k) {
      case Kind.module:
        return qv.SymbolKind.Module;
      case Kind.class:
        return qv.SymbolKind.Class;
      case Kind.enum:
        return qv.SymbolKind.Enum;
      case Kind.enumMember:
        return qv.SymbolKind.EnumMember;
      case Kind.interface:
        return qv.SymbolKind.Interface;
      case Kind.indexSignature:
        return qv.SymbolKind.Method;
      case Kind.callSignature:
        return qv.SymbolKind.Method;
      case Kind.method:
        return qv.SymbolKind.Method;
      case Kind.memberVariable:
        return qv.SymbolKind.Property;
      case Kind.memberGetAccessor:
        return qv.SymbolKind.Property;
      case Kind.memberSetAccessor:
        return qv.SymbolKind.Property;
      case Kind.variable:
        return qv.SymbolKind.Variable;
      case Kind.let:
        return qv.SymbolKind.Variable;
      case Kind.const:
        return qv.SymbolKind.Variable;
      case Kind.localVariable:
        return qv.SymbolKind.Variable;
      case Kind.alias:
        return qv.SymbolKind.Variable;
      case Kind.function:
        return qv.SymbolKind.Function;
      case Kind.localFunction:
        return qv.SymbolKind.Function;
      case Kind.constructSignature:
        return qv.SymbolKind.Constructor;
      case Kind.constructorImplementation:
        return qv.SymbolKind.Constructor;
      case Kind.typeParameter:
        return qv.SymbolKind.TypeParameter;
      case Kind.string:
        return qv.SymbolKind.String;
      default:
        return qv.SymbolKind.Variable;
    }
  }
}
