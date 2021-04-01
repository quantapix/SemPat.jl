import { CancellationToken, CompletionItem, DocumentSymbol } from 'vscode-languageserver';
import { TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, DocumentHighlight, MarkupKind } from 'vscode-languageserver-types';

import { OperationCanceledException, throwIfCancellationRequested } from '../common/cancellationUtils';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { isDebugMode } from '../common/core';
import { assert } from '../common/debug';
import { Diagnostic } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { FileEditAction, TextEditAction } from '../common/editAction';
import { LanguageServiceExtension } from '../common/extensibility';
import { LogTracker } from '../common/logTracker';
import { combinePaths, getDirectoryPath, getFileName, getRelativePath, makeDirectories, normalizePath, normalizePathCase, stripFileExtension } from '../common/pathUtils';
import { convertPositionToOffset, convertRangeToTextRange } from '../common/positionUtils';
import { computeCompletionSimilarity } from '../common/stringUtils';
import { DocumentRange, doesRangeContain, doRangesIntersect, Position, Range } from '../common/textRange';
import { Duration, timingStats } from '../common/timing';
import { AutoImporter, AutoImportResult, buildModuleSymbolsMap, ModuleSymbolMap } from '../languageService/autoImporter';
import { CallHierarchyProvider } from '../languageService/callHierarchyProvider';
import { AbbreviationMap, CompletionOptions, CompletionResults } from '../languageService/completionProvider';
import { DefinitionFilter } from '../languageService/definitionProvider';
import { IndexOptions, IndexResults, WorkspaceSymbolCallback } from '../languageService/documentSymbolProvider';
import { HoverResults } from '../languageService/hoverProvider';
import { ReferenceCallback, ReferencesResult } from '../languageService/referencesProvider';
import { SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { ImportLookupResult } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { CircularDependency } from './circularDependency';
import { ImportResolver } from './importResolver';
import { ImportResult, ImportType } from './importResult';
import { findNodeByOffset } from './parseTreeUtils';
import { Scope } from './scope';
import { getScopeForNode } from './scopeUtils';
import { SourceFile } from './sourceFile';
import { SourceMapper } from './sourceMapper';
import { Symbol } from './symbol';
import { isPrivateOrProtectedName } from './symbolNameUtils';
import { createTracePrinter } from './tracePrinter';
import { TypeEvaluator } from './typeEvaluator';
import { createTypeEvaluatorWithTracker } from './typeEvaluatorWithTracker';
import { PrintTypeFlags } from './typePrinter';
import { Type } from './types';
import { TypeStubWriter } from './typeStubWriter';

const _maxImportDepth = 256;

export interface SourceFileInfo {
  sourceFile: SourceFile;

  isTypeshedFile: boolean;
  isThirdPartyImport: boolean;
  isThirdPartyPyTypedPresent: boolean;
  diagnosticsVersion?: number;
  builtinsImport?: SourceFileInfo;

  isTracked: boolean;
  isOpenByClient: boolean;
  imports: SourceFileInfo[];
  importedBy: SourceFileInfo[];
  shadows: SourceFileInfo[];
  shadowedBy: SourceFileInfo[];
}

export interface MaxAnalysisTime {
  openFilesTimeInMs: number;

  noOpenFilesTimeInMs: number;
}

export interface Indices {
  setWorkspaceIndex(path: string, indexResults: IndexResults): void;
  getIndex(execEnv: string): Map<string, IndexResults> | undefined;
  setIndex(execEnv: string, path: string, indexResults: IndexResults): void;
  reset(): void;
}

interface UpdateImportInfo {
  path: string;
  isTypeshedFile: boolean;
  isThirdPartyImport: boolean;
  isPyTypedPresent: boolean;
}

export class Program {
  private _console: ConsoleInterface;
  private _sourceFileList: SourceFileInfo[] = [];
  private _sourceFileMap = new Map<string, SourceFileInfo>();
  private _allowedThirdPartyImports: string[] | undefined;
  private _evaluator: TypeEvaluator | undefined;
  private _configOptions: ConfigOptions;
  private _importResolver: ImportResolver;
  private _logTracker: LogTracker;
  private _parsedFileCount = 0;

  constructor(initialImportResolver: ImportResolver, initialConfigOptions: ConfigOptions, console?: ConsoleInterface, private _extension?: LanguageServiceExtension, logTracker?: LogTracker) {
    this._console = console || new StandardConsole();
    this._logTracker = logTracker ?? new LogTracker(console, 'FG');
    this._importResolver = initialImportResolver;
    this._configOptions = initialConfigOptions;

    this._createNewEvaluator();
  }

  get evaluator(): TypeEvaluator | undefined {
    return this._evaluator;
  }

  setConfigOptions(configOptions: ConfigOptions) {
    this._configOptions = configOptions;

    this._createNewEvaluator();
  }

  setImportResolver(importResolver: ImportResolver) {
    this._importResolver = importResolver;

    this._createNewEvaluator();
  }

  setTrackedFiles(filePaths: string[]): FileDiagnostics[] {
    if (this._sourceFileList.length > 0) {
      const newFileMap = new Map<string, string>();
      filePaths.forEach((path) => {
        newFileMap.set(normalizePathCase(this._fs, path), path);
      });

      this._sourceFileList.forEach((oldFile) => {
        const filePath = normalizePathCase(this._fs, oldFile.sourceFile.getFilePath());
        if (!newFileMap.has(filePath)) {
          oldFile.isTracked = false;
        }
      });
    }

    this.addTrackedFiles(filePaths);

    return this._removeUnneededFiles();
  }

  setAllowedThirdPartyImports(importNames: string[]) {
    this._allowedThirdPartyImports = importNames;
  }

  addTrackedFiles(filePaths: string[], isThirdPartyImport = false, isInPyTypedPackage = false) {
    filePaths.forEach((filePath) => {
      this.addTrackedFile(filePath, isThirdPartyImport, isInPyTypedPackage);
    });
  }

  addTrackedFile(filePath: string, isThirdPartyImport = false, isInPyTypedPackage = false): SourceFile {
    let sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (sourceFileInfo) {
      sourceFileInfo.isTracked = true;
      return sourceFileInfo.sourceFile;
    }

    const importName = this._getImportNameForFile(filePath);
    const sourceFile = new SourceFile(this._fs, filePath, importName, isThirdPartyImport, isInPyTypedPackage, this._console, this._logTracker);
    sourceFileInfo = {
      sourceFile,
      isTracked: true,
      isOpenByClient: false,
      isTypeshedFile: false,
      isThirdPartyImport,
      isThirdPartyPyTypedPresent: isInPyTypedPackage,
      diagnosticsVersion: undefined,
      imports: [],
      importedBy: [],
      shadows: [],
      shadowedBy: [],
    };
    this._addToSourceFileListAndMap(sourceFileInfo);
    return sourceFile;
  }

  setFileOpened(filePath: string, version: number | null, contents: TextDocumentContentChangeEvent[]) {
    let sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      const importName = this._getImportNameForFile(filePath);
      const sourceFile = new SourceFile(this._fs, filePath, importName, /* isThirdPartyImport */ false, /* isInPyTypedPackage */ false, this._console, this._logTracker);
      sourceFileInfo = {
        sourceFile,
        isTracked: false,
        isOpenByClient: true,
        isTypeshedFile: false,
        isThirdPartyImport: false,
        isThirdPartyPyTypedPresent: false,
        diagnosticsVersion: undefined,
        imports: [],
        importedBy: [],
        shadows: [],
        shadowedBy: [],
      };
      this._addToSourceFileListAndMap(sourceFileInfo);
    } else {
      sourceFileInfo.isOpenByClient = true;

      sourceFileInfo.diagnosticsVersion = undefined;
    }

    sourceFileInfo.sourceFile.setClientVersion(version, contents);
  }

  setFileClosed(filePath: string): FileDiagnostics[] {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (sourceFileInfo) {
      sourceFileInfo.isOpenByClient = false;
      sourceFileInfo.sourceFile.setClientVersion(null, []);
    }

    return this._removeUnneededFiles();
  }

  markAllFilesDirty(evenIfContentsAreSame: boolean) {
    const markDirtyMap = new Map<string, boolean>();

    this._sourceFileList.forEach((sourceFileInfo) => {
      if (evenIfContentsAreSame) {
        sourceFileInfo.sourceFile.markDirty();
      } else if (sourceFileInfo.sourceFile.didContentsChangeOnDisk()) {
        sourceFileInfo.sourceFile.markDirty();

        this._markFileDirtyRecursive(sourceFileInfo, markDirtyMap);
      }
    });

    if (markDirtyMap.size > 0) {
      this._createNewEvaluator();
    }
  }

  markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
    const markDirtyMap = new Map<string, boolean>();
    filePaths.forEach((filePath) => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (sourceFileInfo) {
        if (evenIfContentsAreSame || (!sourceFileInfo.isOpenByClient && sourceFileInfo.sourceFile.didContentsChangeOnDisk())) {
          sourceFileInfo.sourceFile.markDirty();

          this._markFileDirtyRecursive(sourceFileInfo, markDirtyMap);
        }
      }
    });

    if (markDirtyMap.size > 0) {
      this._createNewEvaluator();
    }
  }

  getFileCount() {
    return this._sourceFileList.length;
  }

  getFilesToAnalyzeCount() {
    let sourceFileCount = 0;

    this._sourceFileList.forEach((fileInfo) => {
      if (fileInfo.sourceFile.isCheckingRequired()) {
        if (this._shouldCheckFile(fileInfo)) {
          sourceFileCount++;
        }
      }
    });

    return sourceFileCount;
  }

  isCheckingOnlyOpenFiles() {
    return this._configOptions.checkOnlyOpenFiles || false;
  }

  getSourceFile(filePath: string): SourceFile | undefined {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }

    return sourceFileInfo.sourceFile;
  }

  getBoundSourceFile(filePath: string): SourceFile | undefined {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }

    this._bindFile(sourceFileInfo);
    return this.getSourceFile(filePath);
  }

  analyze(maxTime?: MaxAnalysisTime, token: CancellationToken = CancellationToken.None): boolean {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const elapsedTime = new Duration();

      const openFiles = this._sourceFileList.filter((sf) => sf.isOpenByClient && sf.sourceFile.isCheckingRequired());

      if (openFiles.length > 0) {
        const effectiveMaxTime = maxTime ? maxTime.openFilesTimeInMs : Number.MAX_VALUE;

        for (const sourceFileInfo of openFiles) {
          if (this._checkTypes(sourceFileInfo)) {
            if (elapsedTime.getDurationInMilliseconds() > effectiveMaxTime) {
              return true;
            }
          }
        }

        if (maxTime !== undefined) {
          return true;
        }
      }

      if (!this._configOptions.checkOnlyOpenFiles) {
        const effectiveMaxTime = maxTime ? maxTime.noOpenFilesTimeInMs : Number.MAX_VALUE;

        for (const sourceFileInfo of this._sourceFileList) {
          if (!this._isUserCode(sourceFileInfo)) {
            continue;
          }

          if (this._checkTypes(sourceFileInfo)) {
            if (elapsedTime.getDurationInMilliseconds() > effectiveMaxTime) {
              return true;
            }
          }
        }
      }

      return false;
    });
  }

  indexWorkspace(callback: (path: string, results: IndexResults) => void, token: CancellationToken): number {
    if (!this._configOptions.indexing) {
      return 0;
    }

    return this._runEvaluatorWithCancellationToken(token, () => {
      let count = 0;
      for (const sourceFileInfo of this._sourceFileList) {
        if (!this._isUserCode(sourceFileInfo)) {
          continue;
        }

        this._bindFile(sourceFileInfo);
        const results = sourceFileInfo.sourceFile.index({ indexingForAutoImportMode: false }, token);
        if (results) {
          if (++count > 2000) {
            this._console.warn(`Workspace indexing has hit its upper limit: 2000 files`);
            return count;
          }

          callback(sourceFileInfo.sourceFile.getFilePath(), results);
        }

        this._handleMemoryHighUsage();
      }

      return count;
    });
  }

  printDependencies(projectRootDir: string, verbose: boolean) {
    const sortedFiles = this._sourceFileList
      .filter((s) => !s.isTypeshedFile)
      .sort((a, b) => {
        return a.sourceFile.getFilePath() < b.sourceFile.getFilePath() ? 1 : -1;
      });

    const zeroImportFiles: SourceFile[] = [];

    sortedFiles.forEach((sfInfo) => {
      this._console.info('');
      let filePath = sfInfo.sourceFile.getFilePath();
      const relPath = getRelativePath(filePath, projectRootDir);
      if (relPath) {
        filePath = relPath;
      }

      this._console.info(`${filePath}`);

      this._console.info(` Imports     ${sfInfo.imports.length} ` + `file${sfInfo.imports.length === 1 ? '' : 's'}`);
      if (verbose) {
        sfInfo.imports.forEach((importInfo) => {
          this._console.info(`    ${importInfo.sourceFile.getFilePath()}`);
        });
      }

      this._console.info(` Imported by ${sfInfo.importedBy.length} ` + `file${sfInfo.importedBy.length === 1 ? '' : 's'}`);
      if (verbose) {
        sfInfo.importedBy.forEach((importInfo) => {
          this._console.info(`    ${importInfo.sourceFile.getFilePath()}`);
        });
      }

      if (sfInfo.importedBy.length === 0) {
        zeroImportFiles.push(sfInfo.sourceFile);
      }
    });

    if (zeroImportFiles.length > 0) {
      this._console.info('');
      this._console.info(`${zeroImportFiles.length} file${zeroImportFiles.length === 1 ? '' : 's'}` + ` not explicitly imported`);
      zeroImportFiles.forEach((importFile) => {
        this._console.info(`    ${importFile.getFilePath()}`);
      });
    }
  }

  writeTypeStub(targetImportPath: string, targetIsSingleFile: boolean, stubPath: string, token: CancellationToken) {
    for (const sourceFileInfo of this._sourceFileList) {
      throwIfCancellationRequested(token);

      const filePath = sourceFileInfo.sourceFile.getFilePath();

      const relativePath = getRelativePath(filePath, targetImportPath);
      if (relativePath !== undefined) {
        let typeStubPath = normalizePath(combinePaths(stubPath, relativePath));

        if (targetIsSingleFile) {
          typeStubPath = combinePaths(getDirectoryPath(typeStubPath), '__init__.pyi');
        } else {
          typeStubPath = stripFileExtension(typeStubPath) + '.pyi';
        }

        const typeStubDir = getDirectoryPath(typeStubPath);

        try {
          makeDirectories(this._fs, typeStubDir, stubPath);
        } catch (e) {
          const errMsg = `Could not create directory for '${typeStubDir}'`;
          throw new Error(errMsg);
        }

        this._bindFile(sourceFileInfo);

        this._runEvaluatorWithCancellationToken(token, () => {
          const writer = new TypeStubWriter(typeStubPath, sourceFileInfo.sourceFile, this._evaluator!);
          writer.write();
        });

        this._handleMemoryHighUsage();
      }
    }
  }

  getTypeForSymbol(symbol: Symbol) {
    this._handleMemoryHighUsage();

    const evaluator = this._evaluator || this._createNewEvaluator();
    return evaluator.getEffectiveTypeOfSymbol(symbol);
  }

  printType(type: Type, expandTypeAlias: boolean): string {
    this._handleMemoryHighUsage();

    const evaluator = this._evaluator || this._createNewEvaluator();
    return evaluator.printType(type, expandTypeAlias);
  }

  private static _getPrintTypeFlags(configOptions: ConfigOptions): PrintTypeFlags {
    let flags = PrintTypeFlags.None;

    if (configOptions.diagnosticRuleSet.printUnknownAsAny) {
      flags |= PrintTypeFlags.PrintUnknownWithAny;
    }

    if (configOptions.diagnosticRuleSet.omitTypeArgsIfAny) {
      flags |= PrintTypeFlags.OmitTypeArgumentsIfAny;
    }

    if (configOptions.diagnosticRuleSet.omitUnannotatedParamType) {
      flags |= PrintTypeFlags.OmitUnannotatedParamType;
    }

    if (configOptions.diagnosticRuleSet.pep604Printing) {
      flags |= PrintTypeFlags.PEP604;
    }

    return flags;
  }

  private get _fs() {
    return this._importResolver.fileSystem;
  }

  private _getImportNameForFile(filePath: string) {
    const moduleNameAndType = this._importResolver.getModuleNameForImport(filePath, this._configOptions.getDefaultExecEnvironment());
    return moduleNameAndType.moduleName;
  }

  private _addShadowedFile(stubFile: SourceFileInfo, shadowImplPath: string): SourceFile {
    let shadowFileInfo = this._getSourceFileInfoFromPath(shadowImplPath);

    if (!shadowFileInfo) {
      const importName = this._getImportNameForFile(shadowImplPath);
      const sourceFile = new SourceFile(this._fs, shadowImplPath, importName, /* isThirdPartyImport */ false, /* isInPyTypedPackage */ false, this._console, this._logTracker);
      shadowFileInfo = {
        sourceFile,
        isTracked: false,
        isOpenByClient: false,
        isTypeshedFile: false,
        isThirdPartyImport: false,
        isThirdPartyPyTypedPresent: false,
        diagnosticsVersion: undefined,
        imports: [],
        importedBy: [],
        shadows: [],
        shadowedBy: [],
      };
      this._addToSourceFileListAndMap(shadowFileInfo);
    }

    if (!shadowFileInfo.shadows.includes(stubFile)) {
      shadowFileInfo.shadows.push(stubFile);
    }

    if (!stubFile.shadowedBy.includes(shadowFileInfo)) {
      stubFile.shadowedBy.push(shadowFileInfo);
    }

    return shadowFileInfo.sourceFile;
  }

  private _createNewEvaluator() {
    this._evaluator = createTypeEvaluatorWithTracker(
      this._lookUpImport,
      {
        disableInferenceForPyTypedSources: this._configOptions.disableInferenceForPyTypedSources,
        printTypeFlags: Program._getPrintTypeFlags(this._configOptions),
        logCalls: this._configOptions.logTypeEvaluationTime,
        minimumLoggingThreshold: this._configOptions.typeEvaluationTimeThreshold,
      },
      this._logTracker,
      this._configOptions.logTypeEvaluationTime ? createTracePrinter(this._importResolver.getImportRoots(this._configOptions.findExecEnvironment(this._configOptions.projectRoot))) : undefined
    );

    return this._evaluator;
  }

  private _parseFile(fileToParse: SourceFileInfo, content?: string) {
    if (!this._isFileNeeded(fileToParse) || !fileToParse.sourceFile.isParseRequired()) {
      return;
    }

    if (fileToParse.sourceFile.parse(this._configOptions, this._importResolver, content)) {
      this._parsedFileCount++;
      this._updateSourceFileImports(fileToParse, this._configOptions);
    }

    if (fileToParse.sourceFile.isFileDeleted()) {
      fileToParse.isTracked = false;

      const markDirtyMap = new Map<string, boolean>();
      this._markFileDirtyRecursive(fileToParse, markDirtyMap);

      this._importResolver.invalidateCache();
    }
  }

  private _bindFile(fileToAnalyze: SourceFileInfo, content?: string): void {
    if (!this._isFileNeeded(fileToAnalyze) || !fileToAnalyze.sourceFile.isBindingRequired()) {
      return;
    }

    this._parseFile(fileToAnalyze, content);

    let builtinsScope: Scope | undefined;
    if (fileToAnalyze.builtinsImport) {
      this._bindFile(fileToAnalyze.builtinsImport);

      const parseResults = fileToAnalyze.builtinsImport.sourceFile.getParseResults();
      if (parseResults) {
        builtinsScope = AnalyzerNodeInfo.getScope(parseResults.parseTree);
        assert(builtinsScope !== undefined);
      }
    }

    fileToAnalyze.sourceFile.bind(this._configOptions, this._lookUpImport, builtinsScope);
  }

  private _lookUpImport = (filePath: string): ImportLookupResult | undefined => {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }

    if (sourceFileInfo.sourceFile.isBindingRequired()) {
      timingStats.typeCheckerTime.subtractFromTime(() => {
        this._bindFile(sourceFileInfo);
      });
    }

    const symbolTable = sourceFileInfo.sourceFile.getModuleSymbolTable();
    if (!symbolTable) {
      return undefined;
    }

    const docString = sourceFileInfo.sourceFile.getModuleDocString();
    const parseResults = sourceFileInfo.sourceFile.getParseResults();

    return {
      symbolTable,
      dunderAllNames: AnalyzerNodeInfo.getDunderAllNames(parseResults!.parseTree),
      docString,
    };
  };

  private _buildModuleSymbolsMap(sourceFileToExclude: SourceFileInfo, userFileOnly: boolean, includeIndexUserSymbols: boolean, token: CancellationToken): ModuleSymbolMap {
    return buildModuleSymbolsMap(
      this._sourceFileList.filter((s) => s !== sourceFileToExclude && (userFileOnly ? this._isUserCode(s) : true)),
      includeIndexUserSymbols,
      token
    );
  }

  private _shouldCheckFile(fileInfo: SourceFileInfo) {
    if (fileInfo.isOpenByClient) {
      return true;
    }

    if (!this._configOptions.checkOnlyOpenFiles && fileInfo.isTracked) {
      return true;
    }

    return false;
  }

  private _checkTypes(fileToCheck: SourceFileInfo) {
    return this._logTracker.log(`analyzing: ${fileToCheck.sourceFile.getFilePath()}`, (logState) => {
      if (!this._isFileNeeded(fileToCheck)) {
        logState.suppress();
        return false;
      }

      if (!fileToCheck.sourceFile.isCheckingRequired()) {
        logState.suppress();
        return false;
      }

      if (!this._shouldCheckFile(fileToCheck)) {
        logState.suppress();
        return false;
      }

      this._bindFile(fileToCheck);

      fileToCheck.sourceFile.check(this._evaluator!);

      this._handleMemoryHighUsage();

      if (this._configOptions.diagnosticRuleSet.reportImportCycles !== 'none') {
        if (!this._allowedThirdPartyImports) {
          const closureMap = new Map<string, SourceFileInfo>();
          this._getImportsRecursive(fileToCheck, closureMap, 0);

          closureMap.forEach((file) => {
            timingStats.cycleDetectionTime.timeOperation(() => {
              this._detectAndReportImportCycles(file);
            });
          });
        }
      }

      return true;
    });
  }

  private _getImportsRecursive(file: SourceFileInfo, closureMap: Map<string, SourceFileInfo>, recursionCount: number) {
    const filePath = normalizePathCase(this._fs, file.sourceFile.getFilePath());
    if (closureMap.has(filePath)) {
      return;
    }

    if (recursionCount > _maxImportDepth) {
      file.sourceFile.setHitMaxImportDepth(_maxImportDepth);
      return;
    }

    closureMap.set(filePath, file);

    for (const importedFileInfo of file.imports) {
      this._getImportsRecursive(importedFileInfo, closureMap, recursionCount + 1);
    }
  }

  private _detectAndReportImportCycles(sourceFileInfo: SourceFileInfo, dependencyChain: SourceFileInfo[] = [], dependencyMap = new Map<string, boolean>()): void {
    if (sourceFileInfo.sourceFile.isStubFile() || sourceFileInfo.isThirdPartyImport) {
      return;
    }

    const filePath = normalizePathCase(this._fs, sourceFileInfo.sourceFile.getFilePath());
    if (dependencyMap.has(filePath)) {
      if (dependencyChain.length > 1 && sourceFileInfo === dependencyChain[0]) {
        this._logImportCycle(dependencyChain);
      }
    } else {
      if (dependencyMap.has(filePath)) {
        return;
      }

      dependencyMap.set(filePath, true);
      dependencyChain.push(sourceFileInfo);

      for (const imp of sourceFileInfo.imports) {
        this._detectAndReportImportCycles(imp, dependencyChain, dependencyMap);
      }

      dependencyMap.set(filePath, false);
      dependencyChain.pop();
    }
  }

  private _logImportCycle(dependencyChain: SourceFileInfo[]) {
    const circDep = new CircularDependency();
    dependencyChain.forEach((sourceFileInfo) => {
      circDep.appendPath(sourceFileInfo.sourceFile.getFilePath());
    });

    circDep.normalizeOrder();
    const firstFilePath = circDep.getPaths()[0];
    const firstSourceFile = this._getSourceFileInfoFromPath(firstFilePath)!;
    assert(firstSourceFile !== undefined);
    firstSourceFile.sourceFile.addCircularDependency(circDep);
  }

  private _markFileDirtyRecursive(sourceFileInfo: SourceFileInfo, markMap: Map<string, boolean>) {
    const filePath = normalizePathCase(this._fs, sourceFileInfo.sourceFile.getFilePath());

    if (!markMap.has(filePath)) {
      sourceFileInfo.sourceFile.markReanalysisRequired();
      markMap.set(filePath, true);

      sourceFileInfo.importedBy.forEach((dep) => {
        this._markFileDirtyRecursive(dep, markMap);
      });
    }
  }

  getTextOnRange(filePath: string, range: Range, token: CancellationToken): string | undefined {
    const sourceFileInfo = this._sourceFileMap.get(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }

    const sourceFile = sourceFileInfo.sourceFile;
    const fileContents = sourceFile.getFileContents();
    if (fileContents === undefined) {
      return undefined;
    }

    return this._runEvaluatorWithCancellationToken(token, () => {
      this._parseFile(sourceFileInfo);

      const parseTree = sourceFile.getParseResults()!;
      const textRange = convertRangeToTextRange(range, parseTree.tokenizerOutput.lines);
      if (!textRange) {
        return undefined;
      }

      return fileContents.substr(textRange.start, textRange.length);
    });
  }

  getAutoImports(
    filePath: string,
    range: Range,
    similarityLimit: number,
    nameMap: AbbreviationMap | undefined,
    libraryMap: Map<string, IndexResults> | undefined,
    lazyEdit: boolean,
    allowVariableInAll: boolean,
    token: CancellationToken
  ): AutoImportResult[] {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return [];
    }

    const sourceFile = sourceFileInfo.sourceFile;
    const fileContents = sourceFile.getFileContents();
    if (fileContents === undefined) {
      return [];
    }

    return this._runEvaluatorWithCancellationToken(token, () => {
      this._bindFile(sourceFileInfo);

      const parseTree = sourceFile.getParseResults()!;
      const textRange = convertRangeToTextRange(range, parseTree.tokenizerOutput.lines);
      if (!textRange) {
        return [];
      }

      const currentNode = findNodeByOffset(parseTree.parseTree, textRange.start);
      if (!currentNode) {
        return [];
      }

      const writtenWord = fileContents.substr(textRange.start, textRange.length);
      const map = this._buildModuleSymbolsMap(sourceFileInfo, !!libraryMap, /* includeIndexUserSymbols */ true, token);
      const autoImporter = new AutoImporter(this._configOptions.findExecEnvironment(filePath), this._importResolver, parseTree, range.start, new Set(), map, {
        lazyEdit,
        allowVariableInAll,
        libraryMap,
        patternMatcher: (p, t) => computeCompletionSimilarity(p, t) > similarityLimit,
      });

      const results: AutoImportResult[] = [];

      const currentScope = getScopeForNode(currentNode);
      if (currentScope) {
        const info = nameMap?.get(writtenWord);
        if (info) {
          results.push(...autoImporter.getAutoImportCandidatesForAbbr(writtenWord, info, token));
        }

        results.push(...autoImporter.getAutoImportCandidates(writtenWord, similarityLimit, undefined, token).filter((r) => !currentScope.lookUpSymbolRecursive(r.name)));
      }

      return results;
    });
  }

  getDiagnostics(options: ConfigOptions): FileDiagnostics[] {
    const fileDiagnostics: FileDiagnostics[] = this._removeUnneededFiles();

    this._sourceFileList.forEach((sourceFileInfo) => {
      if (this._shouldCheckFile(sourceFileInfo)) {
        const diagnostics = sourceFileInfo.sourceFile.getDiagnostics(options, sourceFileInfo.diagnosticsVersion);
        if (diagnostics !== undefined) {
          fileDiagnostics.push({
            filePath: sourceFileInfo.sourceFile.getFilePath(),
            diagnostics,
          });

          sourceFileInfo.diagnosticsVersion = sourceFileInfo.sourceFile.getDiagnosticVersion();
        }
      } else if (!sourceFileInfo.isOpenByClient && options.checkOnlyOpenFiles && sourceFileInfo.diagnosticsVersion !== undefined) {
        fileDiagnostics.push({
          filePath: sourceFileInfo.sourceFile.getFilePath(),
          diagnostics: [],
        });
        sourceFileInfo.diagnosticsVersion = undefined;
      }
    });

    return fileDiagnostics;
  }

  getDiagnosticsForRange(filePath: string, range: Range): Diagnostic[] {
    const sourceFile = this.getSourceFile(filePath);
    if (!sourceFile) {
      return [];
    }

    const unfilteredDiagnostics = sourceFile.getDiagnostics(this._configOptions);
    if (!unfilteredDiagnostics) {
      return [];
    }

    return unfilteredDiagnostics.filter((diag) => {
      return doRangesIntersect(diag.range, range);
    });
  }

  getDefinitionsForPosition(filePath: string, position: Position, filter: DefinitionFilter, token: CancellationToken): DocumentRange[] | undefined {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return undefined;
      }

      this._bindFile(sourceFileInfo);

      const execEnv = this._configOptions.findExecEnvironment(filePath);
      return sourceFileInfo.sourceFile.getDefinitionsForPosition(this._createSourceMapper(execEnv), position, filter, this._evaluator!, token);
    });
  }

  reportReferencesForPosition(filePath: string, position: Position, includeDeclaration: boolean, reporter: ReferenceCallback, token: CancellationToken) {
    this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return;
      }

      const invokedFromUserFile = this._isUserCode(sourceFileInfo);
      this._bindFile(sourceFileInfo);

      const execEnv = this._configOptions.findExecEnvironment(filePath);
      const referencesResult = sourceFileInfo.sourceFile.getDeclarationForPosition(this._createSourceMapper(execEnv), position, this._evaluator!, reporter, token);

      if (!referencesResult) {
        return;
      }

      if (referencesResult.requiresGlobalSearch) {
        for (const curSourceFileInfo of this._sourceFileList) {
          throwIfCancellationRequested(token);

          if (curSourceFileInfo.isOpenByClient || !invokedFromUserFile || this._isUserCode(curSourceFileInfo)) {
            this._bindFile(curSourceFileInfo);

            curSourceFileInfo.sourceFile.addReferences(referencesResult, includeDeclaration, this._evaluator!, token);
          }

          this._handleMemoryHighUsage();
        }

        if (includeDeclaration) {
          for (const decl of referencesResult.declarations) {
            throwIfCancellationRequested(token);

            if (referencesResult.locations.some((l) => l.path === decl.path)) {
              continue;
            }

            const declFileInfo = this._getSourceFileInfoFromPath(decl.path);
            if (!declFileInfo) {
              continue;
            }

            const tempResult = new ReferencesResult(referencesResult.requiresGlobalSearch, referencesResult.nodeAtOffset, referencesResult.symbolName, referencesResult.declarations);

            declFileInfo.sourceFile.addReferences(tempResult, includeDeclaration, this._evaluator!, token);
            for (const loc of tempResult.locations) {
              if (loc.path === decl.path && doesRangeContain(decl.range, loc.range)) {
                referencesResult.addLocations(loc);
              }
            }
          }
        }
      } else {
        sourceFileInfo.sourceFile.addReferences(referencesResult, includeDeclaration, this._evaluator!, token);
      }
    });
  }

  getFileIndex(filePath: string, options: IndexOptions, token: CancellationToken): IndexResults | undefined {
    if (options.indexingForAutoImportMode) {
      const name = stripFileExtension(getFileName(filePath));
      if (isPrivateOrProtectedName(name)) {
        return undefined;
      }
    }

    this._handleMemoryHighUsage();

    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return undefined;
      }

      let content: string | undefined = undefined;
      if (options.indexingForAutoImportMode && !sourceFileInfo.sourceFile.isStubFile() && sourceFileInfo.sourceFile.getClientVersion() === undefined) {
        try {
          content = this._fs.readFileSync(filePath, 'utf8');
          if (content.indexOf('__all__') < 0) {
            return undefined;
          }
        } catch (error) {
          content = undefined;
        }
      }

      this._bindFile(sourceFileInfo, content);
      return sourceFileInfo.sourceFile.index(options, token);
    });
  }

  addSymbolsForDocument(filePath: string, symbolList: DocumentSymbol[], token: CancellationToken) {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (sourceFileInfo) {
        if (!sourceFileInfo.sourceFile.getCachedIndexResults()) {
          this._bindFile(sourceFileInfo);
        }

        sourceFileInfo.sourceFile.addHierarchicalSymbolsForDocument(symbolList, token);
      }
    });
  }

  reportSymbolsForWorkspace(query: string, reporter: WorkspaceSymbolCallback, token: CancellationToken) {
    this._runEvaluatorWithCancellationToken(token, () => {
      if (!query) {
        return;
      }

      for (const sourceFileInfo of this._sourceFileList) {
        if (!this._isUserCode(sourceFileInfo)) {
          continue;
        }

        if (!sourceFileInfo.sourceFile.getCachedIndexResults()) {
          this._bindFile(sourceFileInfo);
        }

        const symbolList = sourceFileInfo.sourceFile.getSymbolsForDocument(query, token);
        if (symbolList.length > 0) {
          reporter(symbolList);
        }

        this._handleMemoryHighUsage();
      }
    });
  }

  getHoverForPosition(filePath: string, position: Position, format: MarkupKind, token: CancellationToken): HoverResults | undefined {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return undefined;
      }

      this._bindFile(sourceFileInfo);

      const execEnv = this._configOptions.findExecEnvironment(filePath);
      return sourceFileInfo.sourceFile.getHoverForPosition(this._createSourceMapper(execEnv, /* mapCompiled */ true), position, format, this._evaluator!, token);
    });
  }

  getDocumentHighlight(filePath: string, position: Position, token: CancellationToken): DocumentHighlight[] | undefined {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return undefined;
      }

      this._bindFile(sourceFileInfo);

      const execEnv = this._configOptions.findExecEnvironment(filePath);
      return sourceFileInfo.sourceFile.getDocumentHighlight(this._createSourceMapper(execEnv), position, this._evaluator!, token);
    });
  }

  getSignatureHelpForPosition(filePath: string, position: Position, format: MarkupKind, token: CancellationToken): SignatureHelpResults | undefined {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return undefined;
      }

      this._bindFile(sourceFileInfo);

      return sourceFileInfo.sourceFile.getSignatureHelpForPosition(position, this._lookUpImport, this._evaluator!, format, token);
    });
  }

  async getCompletionsForPosition(
    filePath: string,
    position: Position,
    workspacePath: string,
    options: CompletionOptions,
    nameMap: AbbreviationMap | undefined,
    libraryMap: Map<string, IndexResults> | undefined,
    token: CancellationToken
  ): Promise<CompletionResults | undefined> {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }

    const completionResult = this._logTracker.log(`completion at ${filePath}:${position.line}:${position.character}`, (ls) => {
      const result = this._runEvaluatorWithCancellationToken(token, () => {
        this._bindFile(sourceFileInfo);

        const execEnv = this._configOptions.findExecEnvironment(filePath);
        return sourceFileInfo.sourceFile.getCompletionsForPosition(
          position,
          workspacePath,
          this._configOptions,
          this._importResolver,
          this._lookUpImport,
          this._evaluator!,
          options,
          this._createSourceMapper(execEnv, /* mapCompiled */ true),
          nameMap,
          libraryMap,
          () => this._buildModuleSymbolsMap(sourceFileInfo, !!libraryMap, /* includeIndexUserSymbols */ false, token),
          token
        );
      });

      ls.add(`found ${result?.completionList?.items.length ?? 'null'} items`);
      return result;
    });

    if (!completionResult?.completionList || !this._extension?.completionListExtension) {
      return completionResult;
    }

    const pr = sourceFileInfo.sourceFile.getParseResults();
    const content = sourceFileInfo.sourceFile.getFileContents();
    if (pr?.parseTree && content !== undefined) {
      const offset = convertPositionToOffset(position, pr.tokenizerOutput.lines);
      if (offset !== undefined) {
        completionResult.completionList = await this._extension.completionListExtension.updateCompletionList(
          completionResult.completionList,
          pr.parseTree,
          content,
          offset,
          this._configOptions,
          token
        );
      }
    }

    return completionResult;
  }

  resolveCompletionItem(
    filePath: string,
    completionItem: CompletionItem,
    options: CompletionOptions,
    nameMap: AbbreviationMap | undefined,
    libraryMap: Map<string, IndexResults> | undefined,
    token: CancellationToken
  ) {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return;
      }

      this._bindFile(sourceFileInfo);

      const execEnv = this._configOptions.findExecEnvironment(filePath);
      sourceFileInfo.sourceFile.resolveCompletionItem(
        this._configOptions,
        this._importResolver,
        this._lookUpImport,
        this._evaluator!,
        options,
        this._createSourceMapper(execEnv, /* mapCompiled */ true),
        nameMap,
        libraryMap,
        () => this._buildModuleSymbolsMap(sourceFileInfo, !!libraryMap, /* includeIndexUserSymbols */ false, token),
        completionItem,
        token
      );
    });
  }

  renameSymbolAtPosition(filePath: string, position: Position, newName: string, token: CancellationToken): FileEditAction[] | undefined {
    return this._runEvaluatorWithCancellationToken(token, () => {
      const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
      if (!sourceFileInfo) {
        return undefined;
      }

      this._bindFile(sourceFileInfo);

      const execEnv = this._configOptions.findExecEnvironment(filePath);
      const referencesResult = sourceFileInfo.sourceFile.getDeclarationForPosition(this._createSourceMapper(execEnv), position, this._evaluator!, undefined, token);

      if (!referencesResult) {
        return undefined;
      }

      if (referencesResult.declarations.some((d) => !this._isUserCode(this._getSourceFileInfoFromPath(d.path)))) {
        return undefined;
      }

      if (referencesResult.declarations.length === 0) {
        return undefined;
      }

      if (referencesResult.requiresGlobalSearch) {
        for (const curSourceFileInfo of this._sourceFileList) {
          if (this._isUserCode(curSourceFileInfo)) {
            this._bindFile(curSourceFileInfo);

            curSourceFileInfo.sourceFile.addReferences(referencesResult, true, this._evaluator!, token);
          }

          this._handleMemoryHighUsage();
        }
      } else if (this._isUserCode(sourceFileInfo)) {
        sourceFileInfo.sourceFile.addReferences(referencesResult, true, this._evaluator!, token);
      }

      const editActions: FileEditAction[] = [];

      referencesResult.locations.forEach((loc) => {
        editActions.push({
          filePath: loc.path,
          range: loc.range,
          replacementText: newName,
        });
      });

      return editActions;
    });
  }

  getCallForPosition(filePath: string, position: Position, token: CancellationToken): CallHierarchyItem | undefined {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }
    this._bindFile(sourceFileInfo);

    const execEnv = this._configOptions.findExecEnvironment(filePath);
    const referencesResult = sourceFileInfo.sourceFile.getDeclarationForPosition(this._createSourceMapper(execEnv), position, this._evaluator!, undefined, token);

    if (!referencesResult || referencesResult.declarations.length === 0) {
      return undefined;
    }

    const targetDecl = CallHierarchyProvider.getTargetDeclaration(referencesResult.declarations, referencesResult.nodeAtOffset);

    return CallHierarchyProvider.getCallForDeclaration(referencesResult.symbolName, targetDecl, this._evaluator!, token);
  }

  getIncomingCallsForPosition(filePath: string, position: Position, token: CancellationToken): CallHierarchyIncomingCall[] | undefined {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }
    this._bindFile(sourceFileInfo);

    const execEnv = this._configOptions.findExecEnvironment(filePath);
    const referencesResult = sourceFileInfo.sourceFile.getDeclarationForPosition(this._createSourceMapper(execEnv), position, this._evaluator!, undefined, token);

    if (!referencesResult || referencesResult.declarations.length === 0) {
      return undefined;
    }

    const targetDecl = CallHierarchyProvider.getTargetDeclaration(referencesResult.declarations, referencesResult.nodeAtOffset);
    let items: CallHierarchyIncomingCall[] = [];

    for (const curSourceFileInfo of this._sourceFileList) {
      if (this._isUserCode(curSourceFileInfo) || curSourceFileInfo.isOpenByClient) {
        this._bindFile(curSourceFileInfo);

        const itemsToAdd = CallHierarchyProvider.getIncomingCallsForDeclaration(
          curSourceFileInfo.sourceFile.getFilePath(),
          referencesResult.symbolName,
          targetDecl,
          curSourceFileInfo.sourceFile.getParseResults()!,
          this._evaluator!,
          token
        );

        if (itemsToAdd) {
          items = items.concat(...itemsToAdd);
        }

        this._handleMemoryHighUsage();
      }
    }

    return items;
  }

  getOutgoingCallsForPosition(filePath: string, position: Position, token: CancellationToken): CallHierarchyOutgoingCall[] | undefined {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }
    this._bindFile(sourceFileInfo);

    const execEnv = this._configOptions.findExecEnvironment(filePath);
    const referencesResult = sourceFileInfo.sourceFile.getDeclarationForPosition(this._createSourceMapper(execEnv), position, this._evaluator!, undefined, token);

    if (!referencesResult || referencesResult.declarations.length === 0) {
      return undefined;
    }
    const targetDecl = CallHierarchyProvider.getTargetDeclaration(referencesResult.declarations, referencesResult.nodeAtOffset);

    return CallHierarchyProvider.getOutgoingCallsForDeclaration(targetDecl, sourceFileInfo.sourceFile.getParseResults()!, this._evaluator!, token);
  }

  performQuickAction(filePath: string, command: string, args: any[], token: CancellationToken): TextEditAction[] | undefined {
    const sourceFileInfo = this._getSourceFileInfoFromPath(filePath);
    if (!sourceFileInfo) {
      return undefined;
    }

    this._bindFile(sourceFileInfo);

    return sourceFileInfo.sourceFile.performQuickAction(command, args, token);
  }

  private _handleMemoryHighUsage() {
    const typeCacheSize = this._evaluator!.getTypeCacheSize();

    if (typeCacheSize > 750000 || this._parsedFileCount > 1000) {
      const heapSizeInMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));

      if (heapSizeInMb > 1536) {
        this._console.info(`Emptying type cache to avoid heap overflow. Heap size used: ${heapSizeInMb}MB`);
        this._createNewEvaluator();
        this._discardCachedParseResults();
        this._parsedFileCount = 0;
      }
    }
  }

  private _discardCachedParseResults() {
    for (const sourceFileInfo of this._sourceFileList) {
      sourceFileInfo.sourceFile.dropParseAndBindInfo();
    }
  }

  private _isUserCode(fileInfo: SourceFileInfo | undefined) {
    return fileInfo && fileInfo.isTracked && !fileInfo.isThirdPartyImport && !fileInfo.isTypeshedFile;
  }

  private _runEvaluatorWithCancellationToken<T>(token: CancellationToken | undefined, callback: () => T): T {
    try {
      if (token && !isDebugMode()) {
        return this._evaluator!.runWithCancellationToken(token, callback);
      } else {
        return callback();
      }
    } catch (e) {
      if (!(e instanceof OperationCanceledException)) {
        this._createNewEvaluator();
      }
      throw e;
    }
  }

  private _removeUnneededFiles(): FileDiagnostics[] {
    const fileDiagnostics: FileDiagnostics[] = [];

    for (let i = 0; i < this._sourceFileList.length; ) {
      const fileInfo = this._sourceFileList[i];
      if (!this._isFileNeeded(fileInfo)) {
        fileDiagnostics.push({
          filePath: fileInfo.sourceFile.getFilePath(),
          diagnostics: [],
        });

        fileInfo.sourceFile.prepareForClose();
        this._removeSourceFileFromListAndMap(fileInfo.sourceFile.getFilePath(), i);

        fileInfo.imports.forEach((importedFile) => {
          const indexToRemove = importedFile.importedBy.findIndex((fi) => fi === fileInfo);
          assert(indexToRemove >= 0);
          importedFile.importedBy.splice(indexToRemove, 1);

          if (!this._isFileNeeded(importedFile)) {
            const indexToRemove = this._sourceFileList.findIndex((fi) => fi === importedFile);
            if (indexToRemove >= 0 && indexToRemove < i) {
              fileDiagnostics.push({
                filePath: importedFile.sourceFile.getFilePath(),
                diagnostics: [],
              });

              importedFile.sourceFile.prepareForClose();
              this._removeSourceFileFromListAndMap(importedFile.sourceFile.getFilePath(), indexToRemove);
              i--;
            }
          }
        });

        fileInfo.shadowedBy.forEach((shadowedFile) => {
          shadowedFile.shadows = shadowedFile.shadows.filter((f) => f !== fileInfo);
        });
        fileInfo.shadowedBy = [];
      } else {
        if (!this._shouldCheckFile(fileInfo) && fileInfo.diagnosticsVersion !== undefined) {
          fileDiagnostics.push({
            filePath: fileInfo.sourceFile.getFilePath(),
            diagnostics: [],
          });
          fileInfo.diagnosticsVersion = undefined;
        }

        i++;
      }
    }

    return fileDiagnostics;
  }

  private _isFileNeeded(fileInfo: SourceFileInfo) {
    if (fileInfo.sourceFile.isFileDeleted()) {
      return false;
    }

    if (fileInfo.isTracked || fileInfo.isOpenByClient) {
      return true;
    }

    if (fileInfo.shadows.length > 0) {
      return true;
    }

    if (fileInfo.importedBy.length === 0) {
      return false;
    }

    return this._isImportNeededRecursive(fileInfo, new Map<string, boolean>());
  }

  private _isImportNeededRecursive(fileInfo: SourceFileInfo, recursionMap: Map<string, boolean>) {
    if (fileInfo.isTracked || fileInfo.isOpenByClient || fileInfo.shadows.length > 0) {
      return true;
    }

    const filePath = normalizePathCase(this._fs, fileInfo.sourceFile.getFilePath());

    if (recursionMap.has(filePath)) {
      return false;
    }

    recursionMap.set(filePath, true);

    for (const importerInfo of fileInfo.importedBy) {
      if (this._isImportNeededRecursive(importerInfo, recursionMap)) {
        return true;
      }
    }

    return false;
  }

  private _createSourceMapper(execEnv: ExecutionEnvironment, mapCompiled?: boolean) {
    const sourceMapper = new SourceMapper(
      this._importResolver,
      execEnv,
      this._evaluator!,
      (stubFilePath: string, implFilePath: string) => {
        const stubFileInfo = this._getSourceFileInfoFromPath(stubFilePath);
        if (!stubFileInfo) {
          return undefined;
        }
        this._addShadowedFile(stubFileInfo, implFilePath);
        return this.getBoundSourceFile(implFilePath);
      },
      (f) => this.getBoundSourceFile(f),
      mapCompiled ?? false
    );
    return sourceMapper;
  }

  private _isImportAllowed(importer: SourceFileInfo, importResult: ImportResult, isImportStubFile: boolean): boolean {
    if (importResult.isNativeLib) {
      return false;
    }

    let thirdPartyImportAllowed =
      this._configOptions.useLibraryCodeForTypes ||
      (importResult.importType === ImportType.ThirdParty && !!importResult.pyTypedInfo) ||
      (importResult.importType === ImportType.Local && importer.isThirdPartyPyTypedPresent);

    if (importResult.importType === ImportType.ThirdParty || (importer.isThirdPartyImport && importResult.importType === ImportType.Local)) {
      if (this._allowedThirdPartyImports) {
        if (importResult.isRelative) {
          thirdPartyImportAllowed = true;
        } else if (
          this._allowedThirdPartyImports.some((importName: string) => {
            if (importResult.importName === importName) {
              return true;
            }

            if (importResult.importName.startsWith(importName + '.')) {
              return true;
            }

            return false;
          })
        ) {
          thirdPartyImportAllowed = true;
        }
      }

      if (!isImportStubFile) {
        return thirdPartyImportAllowed;
      }
    }

    return true;
  }

  private _updateSourceFileImports(sourceFileInfo: SourceFileInfo, options: ConfigOptions): SourceFileInfo[] {
    const filesAdded: SourceFileInfo[] = [];

    const imports = sourceFileInfo.sourceFile.getImports();

    const getThirdPartyImportInfo = (importResult: ImportResult) => {
      let isThirdPartyImport = false;
      let isPyTypedPresent = false;

      if (importResult.importType === ImportType.ThirdParty) {
        isThirdPartyImport = true;
        if (importResult.pyTypedInfo) {
          isPyTypedPresent = true;
        }
      } else if (sourceFileInfo.isThirdPartyImport && importResult.importType === ImportType.Local) {
        isThirdPartyImport = true;
        if (sourceFileInfo.isThirdPartyPyTypedPresent) {
          isPyTypedPresent = true;
        }
      }

      return {
        isThirdPartyImport,
        isPyTypedPresent,
      };
    };

    const newImportPathMap = new Map<string, UpdateImportInfo>();
    imports.forEach((importResult) => {
      if (importResult.isImportFound) {
        if (this._isImportAllowed(sourceFileInfo, importResult, importResult.isStubFile)) {
          if (importResult.resolvedPaths.length > 0) {
            const filePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            if (filePath) {
              const thirdPartyTypeInfo = getThirdPartyImportInfo(importResult);
              newImportPathMap.set(normalizePathCase(this._fs, filePath), {
                path: filePath,
                isTypeshedFile: !!importResult.isTypeshedFile,
                isThirdPartyImport: thirdPartyTypeInfo.isThirdPartyImport,
                isPyTypedPresent: thirdPartyTypeInfo.isPyTypedPresent,
              });
            }
          }
        }

        importResult.filteredImplicitImports.forEach((implicitImport) => {
          if (this._isImportAllowed(sourceFileInfo, importResult, implicitImport.isStubFile)) {
            if (!implicitImport.isNativeLib) {
              const thirdPartyTypeInfo = getThirdPartyImportInfo(importResult);
              newImportPathMap.set(normalizePathCase(this._fs, implicitImport.path), {
                path: implicitImport.path,
                isTypeshedFile: !!importResult.isTypeshedFile,
                isThirdPartyImport: thirdPartyTypeInfo.isThirdPartyImport,
                isPyTypedPresent: thirdPartyTypeInfo.isPyTypedPresent,
              });
            }
          }
        });
      } else if (options.verboseOutput) {
        this._console.info(`Could not import '${importResult.importName}' ` + `in file '${sourceFileInfo.sourceFile.getFilePath()}'`);
        if (importResult.importFailureInfo) {
          importResult.importFailureInfo.forEach((diag) => {
            this._console.info(`  ${diag}`);
          });
        }
      }
    });

    const updatedImportMap = new Map<string, SourceFileInfo>();
    sourceFileInfo.imports.forEach((importInfo) => {
      const oldFilePath = normalizePathCase(this._fs, importInfo.sourceFile.getFilePath());

      if (!newImportPathMap.has(oldFilePath)) {
        importInfo.importedBy = importInfo.importedBy.filter((fi) => normalizePathCase(this._fs, fi.sourceFile.getFilePath()) !== normalizePathCase(this._fs, sourceFileInfo.sourceFile.getFilePath()));
      } else {
        updatedImportMap.set(oldFilePath, importInfo);
      }
    });

    newImportPathMap.forEach((importInfo, normalizedImportPath) => {
      if (!updatedImportMap.has(normalizedImportPath)) {
        let importedFileInfo: SourceFileInfo;
        if (this._getSourceFileInfoFromPath(importInfo.path)) {
          importedFileInfo = this._getSourceFileInfoFromPath(importInfo.path)!;
        } else {
          const importName = this._getImportNameForFile(importInfo.path);
          const sourceFile = new SourceFile(this._fs, importInfo.path, importName, importInfo.isThirdPartyImport, importInfo.isPyTypedPresent, this._console, this._logTracker);
          importedFileInfo = {
            sourceFile,
            isTracked: false,
            isOpenByClient: false,
            isTypeshedFile: importInfo.isTypeshedFile,
            isThirdPartyImport: importInfo.isThirdPartyImport,
            isThirdPartyPyTypedPresent: importInfo.isPyTypedPresent,
            diagnosticsVersion: undefined,
            imports: [],
            importedBy: [],
            shadows: [],
            shadowedBy: [],
          };

          this._addToSourceFileListAndMap(importedFileInfo);
          filesAdded.push(importedFileInfo);
        }

        importedFileInfo.importedBy.push(sourceFileInfo);
        updatedImportMap.set(normalizedImportPath, importedFileInfo);
      }
    });

    sourceFileInfo.imports = [];
    newImportPathMap.forEach((_, path) => {
      if (this._getSourceFileInfoFromPath(path)) {
        sourceFileInfo.imports.push(this._getSourceFileInfoFromPath(path)!);
      }
    });

    sourceFileInfo.builtinsImport = undefined;
    const builtinsImport = sourceFileInfo.sourceFile.getBuiltinsImport();
    if (builtinsImport && builtinsImport.isImportFound) {
      const resolvedBuiltinsPath = builtinsImport.resolvedPaths[builtinsImport.resolvedPaths.length - 1];
      sourceFileInfo.builtinsImport = this._getSourceFileInfoFromPath(resolvedBuiltinsPath);
    }

    return filesAdded;
  }

  private _getSourceFileInfoFromPath(filePath: string): SourceFileInfo | undefined {
    return this._sourceFileMap.get(normalizePathCase(this._fs, filePath));
  }

  private _removeSourceFileFromListAndMap(filePath: string, indexToRemove: number) {
    this._sourceFileMap.delete(normalizePathCase(this._fs, filePath));
    this._sourceFileList.splice(indexToRemove, 1);
  }

  private _addToSourceFileListAndMap(fileInfo: SourceFileInfo) {
    const filePath = normalizePathCase(this._fs, fileInfo.sourceFile.getFilePath());

    assert(!this._sourceFileMap.has(filePath));

    this._sourceFileList.push(fileInfo);
    this._sourceFileMap.set(filePath, fileInfo);
  }
}
