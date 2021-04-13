import * as child_process from 'child_process';
import { isAbsolute } from 'path';
import { DiagSeverityOverridesMap } from './commandLineOptions';
import { Console } from './console';
import { DiagRule } from './py/diagnosticRules';
import { FileSystem } from './files';
import { combinePaths, ensureTrailingDirSeparator, FileSpec, getFileSpec, normalizePath, resolvePaths } from './py/paths';
import { latestStablePythonVersion, PythonVersion, versionFromMajorMinor, versionFromString, versionToString } from './py/version';
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
export type DiagLevel = 'none' | 'information' | 'warning' | 'error';
export interface DiagRuleSet {
  printUnknownAsAny: boolean;
  omitTypeArgsIfAny: boolean;
  omitUnannotatedParamType: boolean;
  pep604Printing: boolean;
  strictListInference: boolean;
  strictDictionaryInference: boolean;
  strictParameterNoneValue: boolean;
  enableTypeIgnoreComments: boolean;
  reportGeneralTypeIssues: DiagLevel;
  reportPropertyTypeMismatch: DiagLevel;
  reportFunctionMemberAccess: DiagLevel;
  reportMissingImports: DiagLevel;
  reportMissingModuleSource: DiagLevel;
  reportMissingTypeStubs: DiagLevel;
  reportImportCycles: DiagLevel;
  reportUnusedImport: DiagLevel;
  reportUnusedClass: DiagLevel;
  reportUnusedFunction: DiagLevel;
  reportUnusedVariable: DiagLevel;
  reportDuplicateImport: DiagLevel;
  reportWildcardImportFromLibrary: DiagLevel;
  reportOptionalSubscript: DiagLevel;
  reportOptionalMemberAccess: DiagLevel;
  reportOptionalCall: DiagLevel;
  reportOptionalIterable: DiagLevel;
  reportOptionalContextMgr: DiagLevel;
  reportOptionalOperand: DiagLevel;
  reportUntypedFunctionDecorator: DiagLevel;
  reportUntypedClassDecorator: DiagLevel;
  reportUntypedBaseClass: DiagLevel;
  reportUntypedNamedTuple: DiagLevel;
  reportPrivateUsage: DiagLevel;
  reportConstantRedefinition: DiagLevel;
  reportIncompatibleMethodOverride: DiagLevel;
  reportIncompatibleVariableOverride: DiagLevel;
  reportOverlappingOverload: DiagLevel;
  reportInvalidStringEscapeSequence: DiagLevel;
  reportUnknownParameterType: DiagLevel;
  reportUnknownArgumentType: DiagLevel;
  reportUnknownLambdaType: DiagLevel;
  reportUnknownVariableType: DiagLevel;
  reportUnknownMemberType: DiagLevel;
  reportMissingTypeArgument: DiagLevel;
  reportInvalidTypeVarUse: DiagLevel;
  reportCallInDefaultInitializer: DiagLevel;
  reportUnnecessaryIsInstance: DiagLevel;
  reportUnnecessaryCast: DiagLevel;
  reportAssertAlwaysTrue: DiagLevel;
  reportSelfClsParameterName: DiagLevel;
  reportImplicitStringConcatenation: DiagLevel;
  reportUndefinedVariable: DiagLevel;
  reportUnboundVariable: DiagLevel;
  reportInvalidStubStatement: DiagLevel;
  reportUnsupportedDunderAll: DiagLevel;
  reportUnusedCallResult: DiagLevel;
  reportUnusedCoroutine: DiagLevel;
}
export function cloneDiagRuleSet(diagSettings: DiagRuleSet): DiagRuleSet {
  return Object.assign({}, diagSettings);
}
export function getBooleanDiagRules() {
  return [DiagRule.strictListInference, DiagRule.strictDictionaryInference, DiagRule.strictParameterNoneValue];
}
export function getDiagLevelDiagRules() {
  return [
    DiagRule.reportGeneralTypeIssues,
    DiagRule.reportPropertyTypeMismatch,
    DiagRule.reportFunctionMemberAccess,
    DiagRule.reportMissingImports,
    DiagRule.reportMissingModuleSource,
    DiagRule.reportMissingTypeStubs,
    DiagRule.reportImportCycles,
    DiagRule.reportUnusedImport,
    DiagRule.reportUnusedClass,
    DiagRule.reportUnusedFunction,
    DiagRule.reportUnusedVariable,
    DiagRule.reportDuplicateImport,
    DiagRule.reportWildcardImportFromLibrary,
    DiagRule.reportOptionalSubscript,
    DiagRule.reportOptionalMemberAccess,
    DiagRule.reportOptionalCall,
    DiagRule.reportOptionalIterable,
    DiagRule.reportOptionalContextMgr,
    DiagRule.reportOptionalOperand,
    DiagRule.reportUntypedFunctionDecorator,
    DiagRule.reportUntypedClassDecorator,
    DiagRule.reportUntypedBaseClass,
    DiagRule.reportUntypedNamedTuple,
    DiagRule.reportPrivateUsage,
    DiagRule.reportConstantRedefinition,
    DiagRule.reportIncompatibleMethodOverride,
    DiagRule.reportIncompatibleVariableOverride,
    DiagRule.reportOverlappingOverload,
    DiagRule.reportInvalidStringEscapeSequence,
    DiagRule.reportUnknownParameterType,
    DiagRule.reportUnknownArgumentType,
    DiagRule.reportUnknownLambdaType,
    DiagRule.reportUnknownVariableType,
    DiagRule.reportUnknownMemberType,
    DiagRule.reportMissingTypeArgument,
    DiagRule.reportInvalidTypeVarUse,
    DiagRule.reportCallInDefaultInitializer,
    DiagRule.reportUnnecessaryIsInstance,
    DiagRule.reportUnnecessaryCast,
    DiagRule.reportAssertAlwaysTrue,
    DiagRule.reportSelfClsParameterName,
    DiagRule.reportImplicitStringConcatenation,
    DiagRule.reportUndefinedVariable,
    DiagRule.reportUnboundVariable,
    DiagRule.reportInvalidStubStatement,
    DiagRule.reportUnsupportedDunderAll,
    DiagRule.reportUnusedCallResult,
    DiagRule.reportUnusedCoroutine,
  ];
}
export function getStrictModeNotOverriddenRules() {
  return [DiagRule.reportMissingModuleSource];
}
export function getOffDiagRuleSet(): DiagRuleSet {
  const diagSettings: DiagRuleSet = {
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
    reportOptionalContextMgr: 'none',
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
export function getBasicDiagRuleSet(): DiagRuleSet {
  const diagSettings: DiagRuleSet = {
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
    reportOptionalContextMgr: 'none',
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
export function getStrictDiagRuleSet(): DiagRuleSet {
  const diagSettings: DiagRuleSet = {
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
    reportOptionalContextMgr: 'error',
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
    this.diagnosticRuleSet = ConfigOptions.getDiagRuleSet(typeCheckingMode);
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
  diagnosticRuleSet: DiagRuleSet;
  executionEnvironments: ExecutionEnvironment[] = [];
  venvPath?: string;
  venv?: string;
  defaultPythonVersion?: PythonVersion;
  defaultPythonPlatform?: string;
  defaultExtraPaths?: string[];
  internalTestMode?: boolean;
  static getDiagRuleSet(typeCheckingMode?: string): DiagRuleSet {
    if (typeCheckingMode === 'strict') {
      return getStrictDiagRuleSet();
    }
    if (typeCheckingMode === 'off') {
      return getOffDiagRuleSet();
    }
    return getBasicDiagRuleSet();
  }
  findExecEnvironment(filePath: string): ExecutionEnvironment {
    let execEnv = this.executionEnvironments.find((env) => {
      const envRoot = ensureTrailingDirSeparator(normalizePath(combinePaths(this.projectRoot, env.root)));
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
  initializeFromJson(configObj: any, typeCheckingMode: string | undefined, console: Console, diagnosticOverrides?: DiagSeverityOverridesMap, pythonPath?: string, skipIncludeSection = false) {
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
    const defaultSettings = ConfigOptions.getDiagRuleSet(effectiveTypeCheckingMode);
    if (effectiveTypeCheckingMode === 'off') {
      this.disableInferenceForPyTypedSources = false;
    }
    this.applyDiagOverrides(diagnosticOverrides);
    this.diagnosticRuleSet = {
      printUnknownAsAny: defaultSettings.printUnknownAsAny,
      omitTypeArgsIfAny: defaultSettings.omitTypeArgsIfAny,
      omitUnannotatedParamType: defaultSettings.omitUnannotatedParamType,
      pep604Printing: defaultSettings.pep604Printing,
      strictListInference: this._convertBoolean(configObj.strictListInference, DiagRule.strictListInference, defaultSettings.strictListInference),
      strictDictionaryInference: this._convertBoolean(configObj.strictDictionaryInference, DiagRule.strictDictionaryInference, defaultSettings.strictDictionaryInference),
      strictParameterNoneValue: this._convertBoolean(configObj.strictParameterNoneValue, DiagRule.strictParameterNoneValue, defaultSettings.strictParameterNoneValue),
      enableTypeIgnoreComments: this._convertBoolean(configObj.enableTypeIgnoreComments, DiagRule.enableTypeIgnoreComments, defaultSettings.enableTypeIgnoreComments),
      reportGeneralTypeIssues: this._convertDiagLevel(configObj.reportGeneralTypeIssues, DiagRule.reportGeneralTypeIssues, defaultSettings.reportGeneralTypeIssues),
      reportPropertyTypeMismatch: this._convertDiagLevel(configObj.reportPropertyTypeMismatch, DiagRule.reportPropertyTypeMismatch, defaultSettings.reportPropertyTypeMismatch),
      reportFunctionMemberAccess: this._convertDiagLevel(configObj.reportFunctionMemberAccess, DiagRule.reportFunctionMemberAccess, defaultSettings.reportFunctionMemberAccess),
      reportMissingImports: this._convertDiagLevel(configObj.reportMissingImports, DiagRule.reportMissingImports, defaultSettings.reportMissingImports),
      reportUnusedImport: this._convertDiagLevel(configObj.reportUnusedImport, DiagRule.reportUnusedImport, defaultSettings.reportUnusedImport),
      reportUnusedClass: this._convertDiagLevel(configObj.reportUnusedClass, DiagRule.reportUnusedClass, defaultSettings.reportUnusedClass),
      reportUnusedFunction: this._convertDiagLevel(configObj.reportUnusedFunction, DiagRule.reportUnusedFunction, defaultSettings.reportUnusedFunction),
      reportUnusedVariable: this._convertDiagLevel(configObj.reportUnusedVariable, DiagRule.reportUnusedVariable, defaultSettings.reportUnusedVariable),
      reportDuplicateImport: this._convertDiagLevel(configObj.reportDuplicateImport, DiagRule.reportDuplicateImport, defaultSettings.reportDuplicateImport),
      reportWildcardImportFromLibrary: this._convertDiagLevel(configObj.reportWildcardImportFromLibrary, DiagRule.reportWildcardImportFromLibrary, defaultSettings.reportWildcardImportFromLibrary),
      reportMissingModuleSource: this._convertDiagLevel(configObj.reportMissingModuleSource, DiagRule.reportMissingModuleSource, defaultSettings.reportMissingModuleSource),
      reportMissingTypeStubs: this._convertDiagLevel(configObj.reportMissingTypeStubs, DiagRule.reportMissingTypeStubs, defaultSettings.reportMissingTypeStubs),
      reportImportCycles: this._convertDiagLevel(configObj.reportImportCycles, DiagRule.reportImportCycles, defaultSettings.reportImportCycles),
      reportOptionalSubscript: this._convertDiagLevel(configObj.reportOptionalSubscript, DiagRule.reportOptionalSubscript, defaultSettings.reportOptionalSubscript),
      reportOptionalMemberAccess: this._convertDiagLevel(configObj.reportOptionalMemberAccess, DiagRule.reportOptionalMemberAccess, defaultSettings.reportOptionalMemberAccess),
      reportOptionalCall: this._convertDiagLevel(configObj.reportOptionalCall, DiagRule.reportOptionalCall, defaultSettings.reportOptionalCall),
      reportOptionalIterable: this._convertDiagLevel(configObj.reportOptionalIterable, DiagRule.reportOptionalIterable, defaultSettings.reportOptionalIterable),
      reportOptionalContextMgr: this._convertDiagLevel(configObj.reportOptionalContextMgr, DiagRule.reportOptionalContextMgr, defaultSettings.reportOptionalContextMgr),
      reportOptionalOperand: this._convertDiagLevel(configObj.reportOptionalOperand, DiagRule.reportOptionalOperand, defaultSettings.reportOptionalOperand),
      reportUntypedFunctionDecorator: this._convertDiagLevel(configObj.reportUntypedFunctionDecorator, DiagRule.reportUntypedFunctionDecorator, defaultSettings.reportUntypedFunctionDecorator),
      reportUntypedClassDecorator: this._convertDiagLevel(configObj.reportUntypedClassDecorator, DiagRule.reportUntypedClassDecorator, defaultSettings.reportUntypedClassDecorator),
      reportUntypedBaseClass: this._convertDiagLevel(configObj.reportUntypedBaseClass, DiagRule.reportUntypedBaseClass, defaultSettings.reportUntypedBaseClass),
      reportUntypedNamedTuple: this._convertDiagLevel(configObj.reportUntypedNamedTuple, DiagRule.reportUntypedNamedTuple, defaultSettings.reportUntypedNamedTuple),
      reportPrivateUsage: this._convertDiagLevel(configObj.reportPrivateUsage, DiagRule.reportPrivateUsage, defaultSettings.reportPrivateUsage),
      reportConstantRedefinition: this._convertDiagLevel(configObj.reportConstantRedefinition, DiagRule.reportConstantRedefinition, defaultSettings.reportConstantRedefinition),
      reportIncompatibleMethodOverride: this._convertDiagLevel(configObj.reportIncompatibleMethodOverride, DiagRule.reportIncompatibleMethodOverride, defaultSettings.reportIncompatibleMethodOverride),
      reportIncompatibleVariableOverride: this._convertDiagLevel(
        configObj.reportIncompatibleVariableOverride,
        DiagRule.reportIncompatibleVariableOverride,
        defaultSettings.reportIncompatibleVariableOverride
      ),
      reportOverlappingOverload: this._convertDiagLevel(configObj.reportOverlappingOverload, DiagRule.reportOverlappingOverload, defaultSettings.reportOverlappingOverload),
      reportInvalidStringEscapeSequence: this._convertDiagLevel(
        configObj.reportInvalidStringEscapeSequence,
        DiagRule.reportInvalidStringEscapeSequence,
        defaultSettings.reportInvalidStringEscapeSequence
      ),
      reportUnknownParameterType: this._convertDiagLevel(configObj.reportUnknownParameterType, DiagRule.reportUnknownParameterType, defaultSettings.reportUnknownParameterType),
      reportUnknownArgumentType: this._convertDiagLevel(configObj.reportUnknownArgumentType, DiagRule.reportUnknownArgumentType, defaultSettings.reportUnknownArgumentType),
      reportUnknownLambdaType: this._convertDiagLevel(configObj.reportUnknownLambdaType, DiagRule.reportUnknownLambdaType, defaultSettings.reportUnknownLambdaType),
      reportUnknownVariableType: this._convertDiagLevel(configObj.reportUnknownVariableType, DiagRule.reportUnknownVariableType, defaultSettings.reportUnknownVariableType),
      reportUnknownMemberType: this._convertDiagLevel(configObj.reportUnknownMemberType, DiagRule.reportUnknownMemberType, defaultSettings.reportUnknownMemberType),
      reportMissingTypeArgument: this._convertDiagLevel(configObj.reportMissingTypeArgument, DiagRule.reportMissingTypeArgument, defaultSettings.reportMissingTypeArgument),
      reportInvalidTypeVarUse: this._convertDiagLevel(configObj.reportInvalidTypeVarUse, DiagRule.reportInvalidTypeVarUse, defaultSettings.reportInvalidTypeVarUse),
      reportCallInDefaultInitializer: this._convertDiagLevel(configObj.reportCallInDefaultInitializer, DiagRule.reportCallInDefaultInitializer, defaultSettings.reportCallInDefaultInitializer),
      reportUnnecessaryIsInstance: this._convertDiagLevel(configObj.reportUnnecessaryIsInstance, DiagRule.reportUnnecessaryIsInstance, defaultSettings.reportUnnecessaryIsInstance),
      reportUnnecessaryCast: this._convertDiagLevel(configObj.reportUnnecessaryCast, DiagRule.reportUnnecessaryCast, defaultSettings.reportUnnecessaryCast),
      reportAssertAlwaysTrue: this._convertDiagLevel(configObj.reportAssertAlwaysTrue, DiagRule.reportAssertAlwaysTrue, defaultSettings.reportAssertAlwaysTrue),
      reportSelfClsParameterName: this._convertDiagLevel(configObj.reportSelfClsParameterName, DiagRule.reportSelfClsParameterName, defaultSettings.reportSelfClsParameterName),
      reportImplicitStringConcatenation: this._convertDiagLevel(
        configObj.reportImplicitStringConcatenation,
        DiagRule.reportImplicitStringConcatenation,
        defaultSettings.reportImplicitStringConcatenation
      ),
      reportUndefinedVariable: this._convertDiagLevel(configObj.reportUndefinedVariable, DiagRule.reportUndefinedVariable, defaultSettings.reportUndefinedVariable),
      reportUnboundVariable: this._convertDiagLevel(configObj.reportUnboundVariable, DiagRule.reportUnboundVariable, defaultSettings.reportUnboundVariable),
      reportInvalidStubStatement: this._convertDiagLevel(configObj.reportInvalidStubStatement, DiagRule.reportInvalidStubStatement, defaultSettings.reportInvalidStubStatement),
      reportUnsupportedDunderAll: this._convertDiagLevel(configObj.reportUnsupportedDunderAll, DiagRule.reportUnsupportedDunderAll, defaultSettings.reportUnsupportedDunderAll),
      reportUnusedCallResult: this._convertDiagLevel(configObj.reportUnusedCallResult, DiagRule.reportUnusedCallResult, defaultSettings.reportUnusedCallResult),
      reportUnusedCoroutine: this._convertDiagLevel(configObj.reportUnusedCoroutine, DiagRule.reportUnusedCoroutine, defaultSettings.reportUnusedCoroutine),
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
  ensureDefaultPythonPlatform(console: Console) {
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
  ensureDefaultPythonVersion(pythonPath: string | undefined, console: Console) {
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
  applyDiagOverrides(diagnosticSeverityOverrides: DiagSeverityOverridesMap | undefined) {
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
  private _convertDiagLevel(value: any, fieldName: string, defaultValue: DiagLevel): DiagLevel {
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
  private _initExecutionEnvironmentFromJson(envObj: any, index: number, console: Console): ExecutionEnvironment | undefined {
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
  private _getPythonVersionFromPythonInterpreter(interpreterPath: string | undefined, console: Console): PythonVersion | undefined {
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
export const enum DiagSeverityOverrides {
  Error = 'error',
  Warning = 'warning',
  Information = 'information',
  None = 'none',
}
export function getDiagSeverityOverrides() {
  return [DiagSeverityOverrides.Error, DiagSeverityOverrides.Warning, DiagSeverityOverrides.Information, DiagSeverityOverrides.None];
}
export type DiagSeverityOverridesMap = { [ruleName: string]: DiagSeverityOverrides };
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
  diagnosticSeverityOverrides?: DiagSeverityOverridesMap;
  autoImportCompletions?: boolean;
  indexing?: boolean;
  logTypeEvaluationTime = false;
  typeEvaluationTimeThreshold = 50;
}
