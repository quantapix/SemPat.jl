import * as child_process from 'child_process';
import { isAbsolute } from 'path';
import { DiagnosticSeverityOverridesMap } from './commandLineOptions';
import { ConsoleInterface } from './console';
import { DiagnosticRule } from './diagnosticRules';
import { FileSystem } from './files';
import { combinePaths, ensureTrailingDirectorySeparator, FileSpec, getFileSpec, normalizePath, resolvePaths } from './paths';
import { latestStablePythonVersion, PythonVersion, versionFromMajorMinor, versionFromString, versionToString } from './version';
export const typeshedFallback = 'typeshed-fallback';
export const lib = 'lib';
export const libAlternate = 'Lib';
export const lib64 = 'lib64';
export const sitePackages = 'site-packages';
export const src = 'src';
export const stubsSuffix = '-stubs';
export enum PythonPlatform {
  Darwin = 'Darwin',
  Windows = 'Windows',
  Linux = 'Linux',
}
export class ExecutionEnvironment {
  constructor(root: string, defaultPythonVersion: PythonVersion | undefined, defaultPythonPlatform: string | undefined, defaultExtraPaths: string[] | undefined) {
    this.root = root;
    this.pythonVersion = defaultPythonVersion || latestStablePythonVersion;
    this.pythonPlatform = defaultPythonPlatform;
    this.extraPaths = defaultExtraPaths || [];
  }
  root: string;
  pythonVersion: PythonVersion;
  pythonPlatform?: string;
  extraPaths: string[] = [];
}
export type DiagnosticLevel = 'none' | 'information' | 'warning' | 'error';
export interface DiagnosticRuleSet {
  printUnknownAsAny: boolean;
  omitTypeArgsIfAny: boolean;
  omitUnannotatedParamType: boolean;
  pep604Printing: boolean;
  strictListInference: boolean;
  strictDictionaryInference: boolean;
  strictParameterNoneValue: boolean;
  enableTypeIgnoreComments: boolean;
  reportGeneralTypeIssues: DiagnosticLevel;
  reportPropertyTypeMismatch: DiagnosticLevel;
  reportFunctionMemberAccess: DiagnosticLevel;
  reportMissingImports: DiagnosticLevel;
  reportMissingModuleSource: DiagnosticLevel;
  reportMissingTypeStubs: DiagnosticLevel;
  reportImportCycles: DiagnosticLevel;
  reportUnusedImport: DiagnosticLevel;
  reportUnusedClass: DiagnosticLevel;
  reportUnusedFunction: DiagnosticLevel;
  reportUnusedVariable: DiagnosticLevel;
  reportDuplicateImport: DiagnosticLevel;
  reportWildcardImportFromLibrary: DiagnosticLevel;
  reportOptionalSubscript: DiagnosticLevel;
  reportOptionalMemberAccess: DiagnosticLevel;
  reportOptionalCall: DiagnosticLevel;
  reportOptionalIterable: DiagnosticLevel;
  reportOptionalContextManager: DiagnosticLevel;
  reportOptionalOperand: DiagnosticLevel;
  reportUntypedFunctionDecorator: DiagnosticLevel;
  reportUntypedClassDecorator: DiagnosticLevel;
  reportUntypedBaseClass: DiagnosticLevel;
  reportUntypedNamedTuple: DiagnosticLevel;
  reportPrivateUsage: DiagnosticLevel;
  reportConstantRedefinition: DiagnosticLevel;
  reportIncompatibleMethodOverride: DiagnosticLevel;
  reportIncompatibleVariableOverride: DiagnosticLevel;
  reportOverlappingOverload: DiagnosticLevel;
  reportInvalidStringEscapeSequence: DiagnosticLevel;
  reportUnknownParameterType: DiagnosticLevel;
  reportUnknownArgumentType: DiagnosticLevel;
  reportUnknownLambdaType: DiagnosticLevel;
  reportUnknownVariableType: DiagnosticLevel;
  reportUnknownMemberType: DiagnosticLevel;
  reportMissingTypeArgument: DiagnosticLevel;
  reportInvalidTypeVarUse: DiagnosticLevel;
  reportCallInDefaultInitializer: DiagnosticLevel;
  reportUnnecessaryIsInstance: DiagnosticLevel;
  reportUnnecessaryCast: DiagnosticLevel;
  reportAssertAlwaysTrue: DiagnosticLevel;
  reportSelfClsParameterName: DiagnosticLevel;
  reportImplicitStringConcatenation: DiagnosticLevel;
  reportUndefinedVariable: DiagnosticLevel;
  reportUnboundVariable: DiagnosticLevel;
  reportInvalidStubStatement: DiagnosticLevel;
  reportUnsupportedDunderAll: DiagnosticLevel;
  reportUnusedCallResult: DiagnosticLevel;
  reportUnusedCoroutine: DiagnosticLevel;
}
export function cloneDiagnosticRuleSet(diagSettings: DiagnosticRuleSet): DiagnosticRuleSet {
  return Object.assign({}, diagSettings);
}
export function getBooleanDiagnosticRules() {
  return [DiagnosticRule.strictListInference, DiagnosticRule.strictDictionaryInference, DiagnosticRule.strictParameterNoneValue];
}
export function getDiagLevelDiagnosticRules() {
  return [
    DiagnosticRule.reportGeneralTypeIssues,
    DiagnosticRule.reportPropertyTypeMismatch,
    DiagnosticRule.reportFunctionMemberAccess,
    DiagnosticRule.reportMissingImports,
    DiagnosticRule.reportMissingModuleSource,
    DiagnosticRule.reportMissingTypeStubs,
    DiagnosticRule.reportImportCycles,
    DiagnosticRule.reportUnusedImport,
    DiagnosticRule.reportUnusedClass,
    DiagnosticRule.reportUnusedFunction,
    DiagnosticRule.reportUnusedVariable,
    DiagnosticRule.reportDuplicateImport,
    DiagnosticRule.reportWildcardImportFromLibrary,
    DiagnosticRule.reportOptionalSubscript,
    DiagnosticRule.reportOptionalMemberAccess,
    DiagnosticRule.reportOptionalCall,
    DiagnosticRule.reportOptionalIterable,
    DiagnosticRule.reportOptionalContextManager,
    DiagnosticRule.reportOptionalOperand,
    DiagnosticRule.reportUntypedFunctionDecorator,
    DiagnosticRule.reportUntypedClassDecorator,
    DiagnosticRule.reportUntypedBaseClass,
    DiagnosticRule.reportUntypedNamedTuple,
    DiagnosticRule.reportPrivateUsage,
    DiagnosticRule.reportConstantRedefinition,
    DiagnosticRule.reportIncompatibleMethodOverride,
    DiagnosticRule.reportIncompatibleVariableOverride,
    DiagnosticRule.reportOverlappingOverload,
    DiagnosticRule.reportInvalidStringEscapeSequence,
    DiagnosticRule.reportUnknownParameterType,
    DiagnosticRule.reportUnknownArgumentType,
    DiagnosticRule.reportUnknownLambdaType,
    DiagnosticRule.reportUnknownVariableType,
    DiagnosticRule.reportUnknownMemberType,
    DiagnosticRule.reportMissingTypeArgument,
    DiagnosticRule.reportInvalidTypeVarUse,
    DiagnosticRule.reportCallInDefaultInitializer,
    DiagnosticRule.reportUnnecessaryIsInstance,
    DiagnosticRule.reportUnnecessaryCast,
    DiagnosticRule.reportAssertAlwaysTrue,
    DiagnosticRule.reportSelfClsParameterName,
    DiagnosticRule.reportImplicitStringConcatenation,
    DiagnosticRule.reportUndefinedVariable,
    DiagnosticRule.reportUnboundVariable,
    DiagnosticRule.reportInvalidStubStatement,
    DiagnosticRule.reportUnsupportedDunderAll,
    DiagnosticRule.reportUnusedCallResult,
    DiagnosticRule.reportUnusedCoroutine,
  ];
}
export function getStrictModeNotOverriddenRules() {
  return [DiagnosticRule.reportMissingModuleSource];
}
export function getOffDiagnosticRuleSet(): DiagnosticRuleSet {
  const diagSettings: DiagnosticRuleSet = {
    printUnknownAsAny: true,
    omitTypeArgsIfAny: true,
    omitUnannotatedParamType: true,
    pep604Printing: true,
    strictListInference: false,
    strictDictionaryInference: false,
    strictParameterNoneValue: false,
    enableTypeIgnoreComments: true,
    reportGeneralTypeIssues: 'none',
    reportPropertyTypeMismatch: 'none',
    reportFunctionMemberAccess: 'none',
    reportMissingImports: 'warning',
    reportMissingModuleSource: 'warning',
    reportMissingTypeStubs: 'none',
    reportImportCycles: 'none',
    reportUnusedImport: 'none',
    reportUnusedClass: 'none',
    reportUnusedFunction: 'none',
    reportUnusedVariable: 'none',
    reportDuplicateImport: 'none',
    reportWildcardImportFromLibrary: 'none',
    reportOptionalSubscript: 'none',
    reportOptionalMemberAccess: 'none',
    reportOptionalCall: 'none',
    reportOptionalIterable: 'none',
    reportOptionalContextManager: 'none',
    reportOptionalOperand: 'none',
    reportUntypedFunctionDecorator: 'none',
    reportUntypedClassDecorator: 'none',
    reportUntypedBaseClass: 'none',
    reportUntypedNamedTuple: 'none',
    reportPrivateUsage: 'none',
    reportConstantRedefinition: 'none',
    reportIncompatibleMethodOverride: 'none',
    reportIncompatibleVariableOverride: 'none',
    reportOverlappingOverload: 'none',
    reportInvalidStringEscapeSequence: 'none',
    reportUnknownParameterType: 'none',
    reportUnknownArgumentType: 'none',
    reportUnknownLambdaType: 'none',
    reportUnknownVariableType: 'none',
    reportUnknownMemberType: 'none',
    reportMissingTypeArgument: 'none',
    reportInvalidTypeVarUse: 'none',
    reportCallInDefaultInitializer: 'none',
    reportUnnecessaryIsInstance: 'none',
    reportUnnecessaryCast: 'none',
    reportAssertAlwaysTrue: 'none',
    reportSelfClsParameterName: 'none',
    reportImplicitStringConcatenation: 'none',
    reportUnboundVariable: 'none',
    reportUndefinedVariable: 'warning',
    reportInvalidStubStatement: 'none',
    reportUnsupportedDunderAll: 'none',
    reportUnusedCallResult: 'none',
    reportUnusedCoroutine: 'none',
  };
  return diagSettings;
}
export function getBasicDiagnosticRuleSet(): DiagnosticRuleSet {
  const diagSettings: DiagnosticRuleSet = {
    printUnknownAsAny: false,
    omitTypeArgsIfAny: false,
    omitUnannotatedParamType: true,
    pep604Printing: true,
    strictListInference: false,
    strictDictionaryInference: false,
    strictParameterNoneValue: false,
    enableTypeIgnoreComments: true,
    reportGeneralTypeIssues: 'error',
    reportPropertyTypeMismatch: 'error',
    reportFunctionMemberAccess: 'none',
    reportMissingImports: 'error',
    reportMissingModuleSource: 'warning',
    reportMissingTypeStubs: 'none',
    reportImportCycles: 'none',
    reportUnusedImport: 'none',
    reportUnusedClass: 'none',
    reportUnusedFunction: 'none',
    reportUnusedVariable: 'none',
    reportDuplicateImport: 'none',
    reportWildcardImportFromLibrary: 'warning',
    reportOptionalSubscript: 'none',
    reportOptionalMemberAccess: 'none',
    reportOptionalCall: 'none',
    reportOptionalIterable: 'none',
    reportOptionalContextManager: 'none',
    reportOptionalOperand: 'none',
    reportUntypedFunctionDecorator: 'none',
    reportUntypedClassDecorator: 'none',
    reportUntypedBaseClass: 'none',
    reportUntypedNamedTuple: 'none',
    reportPrivateUsage: 'none',
    reportConstantRedefinition: 'none',
    reportIncompatibleMethodOverride: 'none',
    reportIncompatibleVariableOverride: 'none',
    reportOverlappingOverload: 'none',
    reportInvalidStringEscapeSequence: 'warning',
    reportUnknownParameterType: 'none',
    reportUnknownArgumentType: 'none',
    reportUnknownLambdaType: 'none',
    reportUnknownVariableType: 'none',
    reportUnknownMemberType: 'none',
    reportMissingTypeArgument: 'none',
    reportInvalidTypeVarUse: 'warning',
    reportCallInDefaultInitializer: 'none',
    reportUnnecessaryIsInstance: 'none',
    reportUnnecessaryCast: 'none',
    reportAssertAlwaysTrue: 'warning',
    reportSelfClsParameterName: 'warning',
    reportImplicitStringConcatenation: 'none',
    reportUnboundVariable: 'error',
    reportUndefinedVariable: 'error',
    reportInvalidStubStatement: 'none',
    reportUnsupportedDunderAll: 'warning',
    reportUnusedCallResult: 'none',
    reportUnusedCoroutine: 'error',
  };
  return diagSettings;
}
export function getStrictDiagnosticRuleSet(): DiagnosticRuleSet {
  const diagSettings: DiagnosticRuleSet = {
    printUnknownAsAny: false,
    omitTypeArgsIfAny: false,
    omitUnannotatedParamType: false,
    pep604Printing: true,
    strictListInference: true,
    strictDictionaryInference: true,
    strictParameterNoneValue: true,
    enableTypeIgnoreComments: true,
    reportGeneralTypeIssues: 'error',
    reportPropertyTypeMismatch: 'error',
    reportFunctionMemberAccess: 'error',
    reportMissingImports: 'error',
    reportMissingModuleSource: 'warning',
    reportMissingTypeStubs: 'error',
    reportImportCycles: 'error',
    reportUnusedImport: 'error',
    reportUnusedClass: 'error',
    reportUnusedFunction: 'error',
    reportUnusedVariable: 'error',
    reportDuplicateImport: 'error',
    reportWildcardImportFromLibrary: 'error',
    reportOptionalSubscript: 'error',
    reportOptionalMemberAccess: 'error',
    reportOptionalCall: 'error',
    reportOptionalIterable: 'error',
    reportOptionalContextManager: 'error',
    reportOptionalOperand: 'error',
    reportUntypedFunctionDecorator: 'error',
    reportUntypedClassDecorator: 'error',
    reportUntypedBaseClass: 'error',
    reportUntypedNamedTuple: 'error',
    reportPrivateUsage: 'error',
    reportConstantRedefinition: 'error',
    reportIncompatibleMethodOverride: 'error',
    reportIncompatibleVariableOverride: 'error',
    reportOverlappingOverload: 'error',
    reportInvalidStringEscapeSequence: 'error',
    reportUnknownParameterType: 'error',
    reportUnknownArgumentType: 'error',
    reportUnknownLambdaType: 'error',
    reportUnknownVariableType: 'error',
    reportUnknownMemberType: 'error',
    reportMissingTypeArgument: 'error',
    reportInvalidTypeVarUse: 'error',
    reportCallInDefaultInitializer: 'none',
    reportUnnecessaryIsInstance: 'error',
    reportUnnecessaryCast: 'error',
    reportAssertAlwaysTrue: 'error',
    reportSelfClsParameterName: 'error',
    reportImplicitStringConcatenation: 'none',
    reportUnboundVariable: 'error',
    reportUndefinedVariable: 'error',
    reportInvalidStubStatement: 'error',
    reportUnsupportedDunderAll: 'error',
    reportUnusedCallResult: 'none',
    reportUnusedCoroutine: 'error',
  };
  return diagSettings;
}
export class ConfigOptions {
  constructor(projectRoot: string, typeCheckingMode?: string) {
    this.projectRoot = projectRoot;
    this.diagnosticRuleSet = ConfigOptions.getDiagnosticRuleSet(typeCheckingMode);
    if (typeCheckingMode === 'off') {
      this.disableInferenceForPyTypedSources = false;
    }
  }
  projectRoot: string;
  pythonPath?: string;
  typeshedPath?: string;
  stubPath?: string;
  include: FileSpec[] = [];
  exclude: FileSpec[] = [];
  autoExcludeVenv?: boolean;
  ignore: FileSpec[] = [];
  strict: FileSpec[] = [];
  verboseOutput?: boolean;
  checkOnlyOpenFiles?: boolean;
  useLibraryCodeForTypes?: boolean;
  autoImportCompletions = true;
  indexing = false;
  logTypeEvaluationTime = false;
  typeEvaluationTimeThreshold = 50;
  disableInferenceForPyTypedSources = true;
  diagnosticRuleSet: DiagnosticRuleSet;
  executionEnvironments: ExecutionEnvironment[] = [];
  venvPath?: string;
  venv?: string;
  defaultPythonVersion?: PythonVersion;
  defaultPythonPlatform?: string;
  defaultExtraPaths?: string[];
  internalTestMode?: boolean;
  static getDiagnosticRuleSet(typeCheckingMode?: string): DiagnosticRuleSet {
    if (typeCheckingMode === 'strict') {
      return getStrictDiagnosticRuleSet();
    }
    if (typeCheckingMode === 'off') {
      return getOffDiagnosticRuleSet();
    }
    return getBasicDiagnosticRuleSet();
  }
  findExecEnvironment(filePath: string): ExecutionEnvironment {
    let execEnv = this.executionEnvironments.find((env) => {
      const envRoot = ensureTrailingDirectorySeparator(normalizePath(combinePaths(this.projectRoot, env.root)));
      return filePath.startsWith(envRoot);
    });
    if (!execEnv) {
      execEnv = new ExecutionEnvironment(this.projectRoot, this.defaultPythonVersion, this.defaultPythonPlatform, this.defaultExtraPaths);
    }
    return execEnv;
  }
  getDefaultExecEnvironment(): ExecutionEnvironment {
    return new ExecutionEnvironment(this.projectRoot, this.defaultPythonVersion, this.defaultPythonPlatform, this.defaultExtraPaths);
  }
  initializeFromJson(
    configObj: any,
    typeCheckingMode: string | undefined,
    console: ConsoleInterface,
    diagnosticOverrides?: DiagnosticSeverityOverridesMap,
    pythonPath?: string,
    skipIncludeSection = false
  ) {
    if (!skipIncludeSection) {
      this.include = [];
      if (configObj.include !== undefined) {
        if (!Array.isArray(configObj.include)) {
          console.error(`Config "include" entry must must contain an array.`);
        } else {
          const filesList = configObj.include as string[];
          filesList.forEach((fileSpec, index) => {
            if (typeof fileSpec !== 'string') {
              console.error(`Index ${index} of "include" array should be a string.`);
            } else if (isAbsolute(fileSpec)) {
              console.error(`Ignoring path "${fileSpec}" in "include" array because it is not relative.`);
            } else {
              this.include.push(getFileSpec(this.projectRoot, fileSpec));
            }
          });
        }
      }
    }
    this.exclude = [];
    if (configObj.exclude !== undefined) {
      if (!Array.isArray(configObj.exclude)) {
        console.error(`Config "exclude" entry must contain an array.`);
      } else {
        const filesList = configObj.exclude as string[];
        filesList.forEach((fileSpec, index) => {
          if (typeof fileSpec !== 'string') {
            console.error(`Index ${index} of "exclude" array should be a string.`);
          } else if (isAbsolute(fileSpec)) {
            console.error(`Ignoring path "${fileSpec}" in "exclude" array because it is not relative.`);
          } else {
            this.exclude.push(getFileSpec(this.projectRoot, fileSpec));
          }
        });
      }
    }
    this.ignore = [];
    if (configObj.ignore !== undefined) {
      if (!Array.isArray(configObj.ignore)) {
        console.error(`Config "ignore" entry must contain an array.`);
      } else {
        const filesList = configObj.ignore as string[];
        filesList.forEach((fileSpec, index) => {
          if (typeof fileSpec !== 'string') {
            console.error(`Index ${index} of "ignore" array should be a string.`);
          } else if (isAbsolute(fileSpec)) {
            console.error(`Ignoring path "${fileSpec}" in "ignore" array because it is not relative.`);
          } else {
            this.ignore.push(getFileSpec(this.projectRoot, fileSpec));
          }
        });
      }
    }
    this.strict = [];
    if (configObj.strict !== undefined) {
      if (!Array.isArray(configObj.strict)) {
        console.error(`Config "strict" entry must contain an array.`);
      } else {
        const filesList = configObj.strict as string[];
        filesList.forEach((fileSpec, index) => {
          if (typeof fileSpec !== 'string') {
            console.error(`Index ${index} of "strict" array should be a string.`);
          } else if (isAbsolute(fileSpec)) {
            console.error(`Ignoring path "${fileSpec}" in "strict" array because it is not relative.`);
          } else {
            this.strict.push(getFileSpec(this.projectRoot, fileSpec));
          }
        });
      }
    }
    let configTypeCheckingMode: string | undefined;
    if (configObj.typeCheckingMode !== undefined) {
      if (configObj.typeCheckingMode === 'off' || configObj.typeCheckingMode === 'basic' || configObj.typeCheckingMode === 'strict') {
        configTypeCheckingMode = configObj.typeCheckingMode;
      } else {
        console.error(`Config "typeCheckingMode" entry must contain "off", "basic", or "strict".`);
      }
    }
    if (configObj.useLibraryCodeForTypes !== undefined) {
      if (typeof configObj.useLibraryCodeForTypes === 'boolean') {
        this.useLibraryCodeForTypes = configObj.useLibraryCodeForTypes;
      } else {
        console.error(`Config "useLibraryCodeForTypes" entry must be true or false.`);
      }
    }
    const effectiveTypeCheckingMode = configTypeCheckingMode || typeCheckingMode;
    const defaultSettings = ConfigOptions.getDiagnosticRuleSet(effectiveTypeCheckingMode);
    if (effectiveTypeCheckingMode === 'off') {
      this.disableInferenceForPyTypedSources = false;
    }
    this.applyDiagnosticOverrides(diagnosticOverrides);
    this.diagnosticRuleSet = {
      printUnknownAsAny: defaultSettings.printUnknownAsAny,
      omitTypeArgsIfAny: defaultSettings.omitTypeArgsIfAny,
      omitUnannotatedParamType: defaultSettings.omitUnannotatedParamType,
      pep604Printing: defaultSettings.pep604Printing,
      strictListInference: this._convertBoolean(configObj.strictListInference, DiagnosticRule.strictListInference, defaultSettings.strictListInference),
      strictDictionaryInference: this._convertBoolean(configObj.strictDictionaryInference, DiagnosticRule.strictDictionaryInference, defaultSettings.strictDictionaryInference),
      strictParameterNoneValue: this._convertBoolean(configObj.strictParameterNoneValue, DiagnosticRule.strictParameterNoneValue, defaultSettings.strictParameterNoneValue),
      enableTypeIgnoreComments: this._convertBoolean(configObj.enableTypeIgnoreComments, DiagnosticRule.enableTypeIgnoreComments, defaultSettings.enableTypeIgnoreComments),
      reportGeneralTypeIssues: this._convertDiagnosticLevel(configObj.reportGeneralTypeIssues, DiagnosticRule.reportGeneralTypeIssues, defaultSettings.reportGeneralTypeIssues),
      reportPropertyTypeMismatch: this._convertDiagnosticLevel(configObj.reportPropertyTypeMismatch, DiagnosticRule.reportPropertyTypeMismatch, defaultSettings.reportPropertyTypeMismatch),
      reportFunctionMemberAccess: this._convertDiagnosticLevel(configObj.reportFunctionMemberAccess, DiagnosticRule.reportFunctionMemberAccess, defaultSettings.reportFunctionMemberAccess),
      reportMissingImports: this._convertDiagnosticLevel(configObj.reportMissingImports, DiagnosticRule.reportMissingImports, defaultSettings.reportMissingImports),
      reportUnusedImport: this._convertDiagnosticLevel(configObj.reportUnusedImport, DiagnosticRule.reportUnusedImport, defaultSettings.reportUnusedImport),
      reportUnusedClass: this._convertDiagnosticLevel(configObj.reportUnusedClass, DiagnosticRule.reportUnusedClass, defaultSettings.reportUnusedClass),
      reportUnusedFunction: this._convertDiagnosticLevel(configObj.reportUnusedFunction, DiagnosticRule.reportUnusedFunction, defaultSettings.reportUnusedFunction),
      reportUnusedVariable: this._convertDiagnosticLevel(configObj.reportUnusedVariable, DiagnosticRule.reportUnusedVariable, defaultSettings.reportUnusedVariable),
      reportDuplicateImport: this._convertDiagnosticLevel(configObj.reportDuplicateImport, DiagnosticRule.reportDuplicateImport, defaultSettings.reportDuplicateImport),
      reportWildcardImportFromLibrary: this._convertDiagnosticLevel(
        configObj.reportWildcardImportFromLibrary,
        DiagnosticRule.reportWildcardImportFromLibrary,
        defaultSettings.reportWildcardImportFromLibrary
      ),
      reportMissingModuleSource: this._convertDiagnosticLevel(configObj.reportMissingModuleSource, DiagnosticRule.reportMissingModuleSource, defaultSettings.reportMissingModuleSource),
      reportMissingTypeStubs: this._convertDiagnosticLevel(configObj.reportMissingTypeStubs, DiagnosticRule.reportMissingTypeStubs, defaultSettings.reportMissingTypeStubs),
      reportImportCycles: this._convertDiagnosticLevel(configObj.reportImportCycles, DiagnosticRule.reportImportCycles, defaultSettings.reportImportCycles),
      reportOptionalSubscript: this._convertDiagnosticLevel(configObj.reportOptionalSubscript, DiagnosticRule.reportOptionalSubscript, defaultSettings.reportOptionalSubscript),
      reportOptionalMemberAccess: this._convertDiagnosticLevel(configObj.reportOptionalMemberAccess, DiagnosticRule.reportOptionalMemberAccess, defaultSettings.reportOptionalMemberAccess),
      reportOptionalCall: this._convertDiagnosticLevel(configObj.reportOptionalCall, DiagnosticRule.reportOptionalCall, defaultSettings.reportOptionalCall),
      reportOptionalIterable: this._convertDiagnosticLevel(configObj.reportOptionalIterable, DiagnosticRule.reportOptionalIterable, defaultSettings.reportOptionalIterable),
      reportOptionalContextManager: this._convertDiagnosticLevel(configObj.reportOptionalContextManager, DiagnosticRule.reportOptionalContextManager, defaultSettings.reportOptionalContextManager),
      reportOptionalOperand: this._convertDiagnosticLevel(configObj.reportOptionalOperand, DiagnosticRule.reportOptionalOperand, defaultSettings.reportOptionalOperand),
      reportUntypedFunctionDecorator: this._convertDiagnosticLevel(
        configObj.reportUntypedFunctionDecorator,
        DiagnosticRule.reportUntypedFunctionDecorator,
        defaultSettings.reportUntypedFunctionDecorator
      ),
      reportUntypedClassDecorator: this._convertDiagnosticLevel(configObj.reportUntypedClassDecorator, DiagnosticRule.reportUntypedClassDecorator, defaultSettings.reportUntypedClassDecorator),
      reportUntypedBaseClass: this._convertDiagnosticLevel(configObj.reportUntypedBaseClass, DiagnosticRule.reportUntypedBaseClass, defaultSettings.reportUntypedBaseClass),
      reportUntypedNamedTuple: this._convertDiagnosticLevel(configObj.reportUntypedNamedTuple, DiagnosticRule.reportUntypedNamedTuple, defaultSettings.reportUntypedNamedTuple),
      reportPrivateUsage: this._convertDiagnosticLevel(configObj.reportPrivateUsage, DiagnosticRule.reportPrivateUsage, defaultSettings.reportPrivateUsage),
      reportConstantRedefinition: this._convertDiagnosticLevel(configObj.reportConstantRedefinition, DiagnosticRule.reportConstantRedefinition, defaultSettings.reportConstantRedefinition),
      reportIncompatibleMethodOverride: this._convertDiagnosticLevel(
        configObj.reportIncompatibleMethodOverride,
        DiagnosticRule.reportIncompatibleMethodOverride,
        defaultSettings.reportIncompatibleMethodOverride
      ),
      reportIncompatibleVariableOverride: this._convertDiagnosticLevel(
        configObj.reportIncompatibleVariableOverride,
        DiagnosticRule.reportIncompatibleVariableOverride,
        defaultSettings.reportIncompatibleVariableOverride
      ),
      reportOverlappingOverload: this._convertDiagnosticLevel(configObj.reportOverlappingOverload, DiagnosticRule.reportOverlappingOverload, defaultSettings.reportOverlappingOverload),
      reportInvalidStringEscapeSequence: this._convertDiagnosticLevel(
        configObj.reportInvalidStringEscapeSequence,
        DiagnosticRule.reportInvalidStringEscapeSequence,
        defaultSettings.reportInvalidStringEscapeSequence
      ),
      reportUnknownParameterType: this._convertDiagnosticLevel(configObj.reportUnknownParameterType, DiagnosticRule.reportUnknownParameterType, defaultSettings.reportUnknownParameterType),
      reportUnknownArgumentType: this._convertDiagnosticLevel(configObj.reportUnknownArgumentType, DiagnosticRule.reportUnknownArgumentType, defaultSettings.reportUnknownArgumentType),
      reportUnknownLambdaType: this._convertDiagnosticLevel(configObj.reportUnknownLambdaType, DiagnosticRule.reportUnknownLambdaType, defaultSettings.reportUnknownLambdaType),
      reportUnknownVariableType: this._convertDiagnosticLevel(configObj.reportUnknownVariableType, DiagnosticRule.reportUnknownVariableType, defaultSettings.reportUnknownVariableType),
      reportUnknownMemberType: this._convertDiagnosticLevel(configObj.reportUnknownMemberType, DiagnosticRule.reportUnknownMemberType, defaultSettings.reportUnknownMemberType),
      reportMissingTypeArgument: this._convertDiagnosticLevel(configObj.reportMissingTypeArgument, DiagnosticRule.reportMissingTypeArgument, defaultSettings.reportMissingTypeArgument),
      reportInvalidTypeVarUse: this._convertDiagnosticLevel(configObj.reportInvalidTypeVarUse, DiagnosticRule.reportInvalidTypeVarUse, defaultSettings.reportInvalidTypeVarUse),
      reportCallInDefaultInitializer: this._convertDiagnosticLevel(
        configObj.reportCallInDefaultInitializer,
        DiagnosticRule.reportCallInDefaultInitializer,
        defaultSettings.reportCallInDefaultInitializer
      ),
      reportUnnecessaryIsInstance: this._convertDiagnosticLevel(configObj.reportUnnecessaryIsInstance, DiagnosticRule.reportUnnecessaryIsInstance, defaultSettings.reportUnnecessaryIsInstance),
      reportUnnecessaryCast: this._convertDiagnosticLevel(configObj.reportUnnecessaryCast, DiagnosticRule.reportUnnecessaryCast, defaultSettings.reportUnnecessaryCast),
      reportAssertAlwaysTrue: this._convertDiagnosticLevel(configObj.reportAssertAlwaysTrue, DiagnosticRule.reportAssertAlwaysTrue, defaultSettings.reportAssertAlwaysTrue),
      reportSelfClsParameterName: this._convertDiagnosticLevel(configObj.reportSelfClsParameterName, DiagnosticRule.reportSelfClsParameterName, defaultSettings.reportSelfClsParameterName),
      reportImplicitStringConcatenation: this._convertDiagnosticLevel(
        configObj.reportImplicitStringConcatenation,
        DiagnosticRule.reportImplicitStringConcatenation,
        defaultSettings.reportImplicitStringConcatenation
      ),
      reportUndefinedVariable: this._convertDiagnosticLevel(configObj.reportUndefinedVariable, DiagnosticRule.reportUndefinedVariable, defaultSettings.reportUndefinedVariable),
      reportUnboundVariable: this._convertDiagnosticLevel(configObj.reportUnboundVariable, DiagnosticRule.reportUnboundVariable, defaultSettings.reportUnboundVariable),
      reportInvalidStubStatement: this._convertDiagnosticLevel(configObj.reportInvalidStubStatement, DiagnosticRule.reportInvalidStubStatement, defaultSettings.reportInvalidStubStatement),
      reportUnsupportedDunderAll: this._convertDiagnosticLevel(configObj.reportUnsupportedDunderAll, DiagnosticRule.reportUnsupportedDunderAll, defaultSettings.reportUnsupportedDunderAll),
      reportUnusedCallResult: this._convertDiagnosticLevel(configObj.reportUnusedCallResult, DiagnosticRule.reportUnusedCallResult, defaultSettings.reportUnusedCallResult),
      reportUnusedCoroutine: this._convertDiagnosticLevel(configObj.reportUnusedCoroutine, DiagnosticRule.reportUnusedCoroutine, defaultSettings.reportUnusedCoroutine),
    };
    this.venvPath = undefined;
    if (configObj.venvPath !== undefined) {
      if (typeof configObj.venvPath !== 'string') {
        console.error(`Config "venvPath" field must contain a string.`);
      } else {
        this.venvPath = normalizePath(combinePaths(this.projectRoot, configObj.venvPath));
      }
    }
    this.venv = undefined;
    if (configObj.venv !== undefined) {
      if (typeof configObj.venv !== 'string') {
        console.error(`Config "venv" field must contain a string.`);
      } else {
        this.venv = configObj.venv;
      }
    }
    if (configObj.extraPaths !== undefined) {
      this.defaultExtraPaths = [];
      if (!Array.isArray(configObj.extraPaths)) {
        console.error(`Config "extraPaths" field must contain an array.`);
      } else {
        const pathList = configObj.extraPaths as string[];
        pathList.forEach((path, pathIndex) => {
          if (typeof path !== 'string') {
            console.error(`Config "extraPaths" field ${pathIndex} must be a string.`);
          } else {
            this.defaultExtraPaths!.push(normalizePath(combinePaths(this.projectRoot, path)));
          }
        });
      }
    }
    if (configObj.pythonVersion !== undefined) {
      if (typeof configObj.pythonVersion === 'string') {
        const version = versionFromString(configObj.pythonVersion);
        if (version) {
          this.defaultPythonVersion = version;
        } else {
          console.error(`Config "pythonVersion" field contains unsupported version.`);
        }
      } else {
        console.error(`Config "pythonVersion" field must contain a string.`);
      }
    }
    this.ensureDefaultPythonVersion(pythonPath, console);
    if (configObj.pythonPlatform !== undefined) {
      if (typeof configObj.pythonPlatform !== 'string') {
        console.error(`Config "pythonPlatform" field must contain a string.`);
      } else {
        this.defaultPythonPlatform = configObj.pythonPlatform;
      }
    }
    this.ensureDefaultPythonPlatform(console);
    this.typeshedPath = undefined;
    if (configObj.typeshedPath !== undefined) {
      if (typeof configObj.typeshedPath !== 'string') {
        console.error(`Config "typeshedPath" field must contain a string.`);
      } else {
        this.typeshedPath = configObj.typeshedPath ? normalizePath(combinePaths(this.projectRoot, configObj.typeshedPath)) : '';
      }
    }
    this.stubPath = undefined;
    if (configObj.typingsPath !== undefined) {
      if (typeof configObj.typingsPath !== 'string') {
        console.error(`Config "typingsPath" field must contain a string.`);
      } else {
        console.error(`Config "typingsPath" is now deprecated. Please, use stubPath instead.`);
        this.stubPath = normalizePath(combinePaths(this.projectRoot, configObj.typingsPath));
      }
    }
    if (configObj.stubPath !== undefined) {
      if (typeof configObj.stubPath !== 'string') {
        console.error(`Config "stubPath" field must contain a string.`);
      } else {
        this.stubPath = normalizePath(combinePaths(this.projectRoot, configObj.stubPath));
      }
    }
    if (configObj.verboseOutput !== undefined) {
      if (typeof configObj.verboseOutput !== 'boolean') {
        console.error(`Config "verboseOutput" field must be true or false.`);
      } else {
        this.verboseOutput = configObj.verboseOutput;
      }
    }
    if (configObj.useLibraryCodeForTypes !== undefined) {
      if (typeof configObj.useLibraryCodeForTypes !== 'boolean') {
        console.error(`Config "useLibraryCodeForTypes" field must be true or false.`);
      } else {
        this.useLibraryCodeForTypes = configObj.useLibraryCodeForTypes;
      }
    }
    this.executionEnvironments = [];
    if (configObj.executionEnvironments !== undefined) {
      if (!Array.isArray(configObj.executionEnvironments)) {
        console.error(`Config "executionEnvironments" field must contain an array.`);
      } else {
        const execEnvironments = configObj.executionEnvironments as ExecutionEnvironment[];
        execEnvironments.forEach((env, index) => {
          const execEnv = this._initExecutionEnvironmentFromJson(env, index, console);
          if (execEnv) {
            this.executionEnvironments.push(execEnv);
          }
        });
      }
    }
    if (configObj.autoImportCompletions !== undefined) {
      if (typeof configObj.autoImportCompletions !== 'boolean') {
        console.error(`Config "autoImportCompletions" field must be true or false.`);
      } else {
        this.autoImportCompletions = configObj.autoImportCompletions;
      }
    }
    if (configObj.indexing !== undefined) {
      if (typeof configObj.indexing !== 'boolean') {
        console.error(`Config "indexing" field must be true or false.`);
      } else {
        this.indexing = configObj.indexing;
      }
    }
    if (configObj.logTypeEvaluationTime !== undefined) {
      if (typeof configObj.logTypeEvaluationTime !== 'boolean') {
        console.error(`Config "logTypeEvaluationTime" field must be true or false.`);
      } else {
        this.logTypeEvaluationTime = configObj.logTypeEvaluationTime;
      }
    }
    if (configObj.typeEvaluationTimeThreshold !== undefined) {
      if (typeof configObj.typeEvaluationTimeThreshold !== 'number') {
        console.error(`Config "typeEvaluationTimeThreshold" field must be a number.`);
      } else {
        this.typeEvaluationTimeThreshold = configObj.typeEvaluationTimeThreshold;
      }
    }
  }
  ensureDefaultPythonPlatform(console: ConsoleInterface) {
    if (this.defaultPythonPlatform !== undefined) {
      return;
    }
    if (process.platform === 'darwin') {
      this.defaultPythonPlatform = PythonPlatform.Darwin;
    } else if (process.platform === 'linux') {
      this.defaultPythonPlatform = PythonPlatform.Linux;
    } else if (process.platform === 'win32') {
      this.defaultPythonPlatform = PythonPlatform.Windows;
    }
    if (this.defaultPythonPlatform !== undefined) {
      console.info(`Assuming Python platform ${this.defaultPythonPlatform}`);
    }
  }
  ensureDefaultPythonVersion(pythonPath: string | undefined, console: ConsoleInterface) {
    if (this.defaultPythonVersion !== undefined) {
      return;
    }
    this.defaultPythonVersion = this._getPythonVersionFromPythonInterpreter(pythonPath, console);
    if (this.defaultPythonVersion !== undefined) {
      console.info(`Assuming Python version ${versionToString(this.defaultPythonVersion)}`);
    }
  }
  ensureDefaultExtraPaths(fs: FileSystem, autoSearchPaths: boolean, extraPaths: string[] | undefined) {
    const paths: string[] = [];
    if (autoSearchPaths) {
      const srcPath = resolvePaths(this.projectRoot, pathConsts.src);
      if (fs.existsSync(srcPath) && !fs.existsSync(resolvePaths(srcPath, '__init__.py'))) {
        paths.push(srcPath);
      }
    }
    if (extraPaths && extraPaths.length > 0) {
      for (const p of extraPaths) {
        paths.push(resolvePaths(this.projectRoot, p));
      }
    }
    if (paths.length > 0) {
      this.defaultExtraPaths = paths;
    }
  }
  applyDiagnosticOverrides(diagnosticSeverityOverrides: DiagnosticSeverityOverridesMap | undefined) {
    if (!diagnosticSeverityOverrides) {
      return;
    }
    for (const [ruleName, severity] of Object.entries(diagnosticSeverityOverrides)) {
      (this.diagnosticRuleSet as any)[ruleName] = severity;
    }
  }
  private _convertBoolean(value: any, fieldName: string, defaultValue: boolean): boolean {
    if (value === undefined) {
      return defaultValue;
    } else if (typeof value === 'boolean') {
      return value ? true : false;
    }
    console.log(`Config "${fieldName}" entry must be true or false.`);
    return defaultValue;
  }
  private _convertDiagnosticLevel(value: any, fieldName: string, defaultValue: DiagnosticLevel): DiagnosticLevel {
    if (value === undefined) {
      return defaultValue;
    } else if (typeof value === 'boolean') {
      return value ? 'error' : 'none';
    } else if (typeof value === 'string') {
      if (value === 'error' || value === 'warning' || value === 'information' || value === 'none') {
        return value;
      }
    }
    console.log(`Config "${fieldName}" entry must be true, false, "error", "warning", "information" or "none".`);
    return defaultValue;
  }
  private _initExecutionEnvironmentFromJson(envObj: any, index: number, console: ConsoleInterface): ExecutionEnvironment | undefined {
    try {
      const newExecEnv = new ExecutionEnvironment(this.projectRoot, this.defaultPythonVersion, this.defaultPythonPlatform, this.defaultExtraPaths);
      if (envObj.root && typeof envObj.root === 'string') {
        newExecEnv.root = normalizePath(combinePaths(this.projectRoot, envObj.root));
      } else {
        console.error(`Config executionEnvironments index ${index}: missing root value.`);
      }
      if (envObj.extraPaths) {
        if (!Array.isArray(envObj.extraPaths)) {
          console.error(`Config executionEnvironments index ${index}: extraPaths field must contain an array.`);
        } else {
          const pathList = envObj.extraPaths as string[];
          pathList.forEach((path, pathIndex) => {
            if (typeof path !== 'string') {
              console.error(`Config executionEnvironments index ${index}:` + ` extraPaths field ${pathIndex} must be a string.`);
            } else {
              newExecEnv.extraPaths.push(normalizePath(combinePaths(this.projectRoot, path)));
            }
          });
        }
      }
      if (envObj.pythonVersion) {
        if (typeof envObj.pythonVersion === 'string') {
          const version = versionFromString(envObj.pythonVersion);
          if (version) {
            newExecEnv.pythonVersion = version;
          } else {
            console.warn(`Config executionEnvironments index ${index} contains unsupported pythonVersion.`);
          }
        } else {
          console.error(`Config executionEnvironments index ${index} pythonVersion must be a string.`);
        }
      }
      if (envObj.pythonPlatform) {
        if (typeof envObj.pythonPlatform === 'string') {
          newExecEnv.pythonPlatform = envObj.pythonPlatform;
        } else {
          console.error(`Config executionEnvironments index ${index} pythonPlatform must be a string.`);
        }
      }
      return newExecEnv;
    } catch {
      console.error(`Config executionEnvironments index ${index} is not accessible.`);
    }
    return undefined;
  }
  private _getPythonVersionFromPythonInterpreter(interpreterPath: string | undefined, console: ConsoleInterface): PythonVersion | undefined {
    try {
      const commandLineArgs: string[] = ['-c', 'import sys, json; json.dump(dict(major=sys.version_info[0], minor=sys.version_info[1]), sys.stdout)'];
      let execOutput: string;
      if (interpreterPath) {
        execOutput = child_process.execFileSync(interpreterPath, commandLineArgs, { encoding: 'utf8' });
      } else {
        execOutput = child_process.execFileSync('python', commandLineArgs, { encoding: 'utf8' });
      }
      const versionJson: { major: number; minor: number } = JSON.parse(execOutput);
      const version = versionFromMajorMinor(versionJson.major, versionJson.minor);
      if (version === undefined) {
        console.warn(`Python version ${versionJson.major}.${versionJson.minor} from interpreter is unsupported`);
        return undefined;
      }
      return version;
    } catch {
      console.info('Unable to get Python version from interpreter');
      return undefined;
    }
  }
}
export const enum DiagnosticSeverityOverrides {
  Error = 'error',
  Warning = 'warning',
  Information = 'information',
  None = 'none',
}
export function getDiagnosticSeverityOverrides() {
  return [DiagnosticSeverityOverrides.Error, DiagnosticSeverityOverrides.Warning, DiagnosticSeverityOverrides.Information, DiagnosticSeverityOverrides.None];
}
export type DiagnosticSeverityOverridesMap = { [ruleName: string]: DiagnosticSeverityOverrides };
export class CommandLineOptions {
  constructor(executionRoot: string, fromVsCodeExtension: boolean) {
    this.executionRoot = executionRoot;
    this.fromVsCodeExtension = fromVsCodeExtension;
  }
  fileSpecs: string[] = [];
  watchForSourceChanges?: boolean;
  watchForLibraryChanges?: boolean;
  configFilePath?: string;
  venvPath?: string;
  pythonPath?: string;
  pythonPlatform?: 'Darwin' | 'Linux' | 'Windows';
  pythonVersion?: PythonVersion;
  typeshedPath?: string;
  stubPath?: string;
  executionRoot: string;
  typeStubTargetImportName?: string;
  verboseOutput?: boolean;
  checkOnlyOpenFiles?: boolean;
  useLibraryCodeForTypes?: boolean;
  autoSearchPaths?: boolean;
  extraPaths?: string[];
  typeCheckingMode?: string;
  fromVsCodeExtension: boolean;
  diagnosticSeverityOverrides?: DiagnosticSeverityOverridesMap;
  autoImportCompletions?: boolean;
  indexing?: boolean;
  logTypeEvaluationTime = false;
  typeEvaluationTimeThreshold = 50;
}
