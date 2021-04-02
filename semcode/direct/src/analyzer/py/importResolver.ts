import { Dirent } from 'fs';

import { getOrAdd } from '../common/collectionUtils';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { FileSystem } from '../common/fileSystem';
import { stubsSuffix } from '../common/pathConsts';
import {
  changeAnyExtension,
  combinePathComponents,
  combinePaths,
  containsPath,
  ensureTrailingDirSeparator,
  getDirPath,
  getFileExtension,
  getFileName,
  getFileSystemEntriesFromDirEntries,
  getPathComponents,
  getRelativePathComponentsFromDir,
  isDir,
  isFile,
  resolvePaths,
  stripFileExtension,
  stripTrailingDirSeparator,
  tryStat,
} from '../common/pathUtils';
import { equateStringsCaseInsensitive } from '../common/stringUtils';
import * as StringUtils from '../common/stringUtils';
import { isIdentifierChar, isIdentifierStartChar } from '../parser/characters';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import * as PythonPathUtils from './pythonPathUtils';
import { getPyTypedInfo, PyTypedInfo } from './pyTypedUtils';
import { isDunderName } from './symbolNameUtils';

export interface ImportedModuleDescriptor {
  leadingDots: number;
  nameParts: string[];
  hasTrailingDot?: boolean;
  importedSymbols: string[] | undefined;
}

export interface ModuleNameAndType {
  moduleName: string;
  importType: ImportType;
  isLocalTypingsFile: boolean;
}

type CachedImportResults = Map<string, ImportResult>;

const supportedNativeLibExtensions = ['.pyd', '.so', '.dylib'];
const supportedFileExtensions = ['.py', '.pyi', ...supportedNativeLibExtensions];

const allowPartialResolutionForThirdPartyPackages = false;

export class ImportResolver {
  protected _configOptions: ConfigOptions;

  private _cachedPythonSearchPaths = new Map<string, string[]>();
  private _cachedImportResults = new Map<string, CachedImportResults>();
  private _cachedModuleNameResults = new Map<string, Map<string, ModuleNameAndType>>();
  private _cachedTypeshedStdLibPath: string | undefined;
  private _cachedTypeshedThirdPartyPath: string | undefined;
  private _cachedTypeshedThirdPartyPackagePaths: Map<string, string> | undefined;
  private _cachedTypeshedThirdPartyPackageRoots: string[] | undefined;
  private _cachedEntriesForPath = new Map<string, Dirent[]>();

  readonly fileSystem: FileSystem;

  constructor(fs: FileSystem, configOptions: ConfigOptions) {
    this.fileSystem = fs;
    this._configOptions = configOptions;
  }

  invalidateCache() {
    this._cachedPythonSearchPaths = new Map<string, string[]>();
    this._cachedImportResults = new Map<string, CachedImportResults>();
    this._cachedModuleNameResults = new Map<string, Map<string, ModuleNameAndType>>();
    this._invalidateFileSystemCache();

    if (this.fileSystem instanceof PyrightFileSystem) {
      this.fileSystem.clearPartialStubs();
    }
  }

  resolveImport(sourceFilePath: string, execEnv: ExecutionEnvironment, moduleDescriptor: ImportedModuleDescriptor): ImportResult {
    const importName = this.formatImportName(moduleDescriptor);
    const importFailureInfo: string[] = [];

    const notFoundResult: ImportResult = {
      importName,
      isRelative: false,
      isImportFound: false,
      isPartlyResolved: false,
      isNamespacePackage: false,
      isStubPackage: false,
      importFailureInfo,
      resolvedPaths: [],
      importType: ImportType.Local,
      isStubFile: false,
      isNativeLib: false,
      implicitImports: [],
      filteredImplicitImports: [],
      nonStubImportResult: undefined,
    };

    this.ensurePartialStubPackages(execEnv);

    if (moduleDescriptor.leadingDots > 0) {
      const relativeImport = this._resolveRelativeImport(sourceFilePath, execEnv, moduleDescriptor, importName, importFailureInfo);

      if (relativeImport) {
        relativeImport.isRelative = true;
        return relativeImport;
      }
    } else {
      const cachedResults = this._lookUpResultsInCache(execEnv, importName, moduleDescriptor.importedSymbols);
      if (cachedResults) {
        const isUnresolvedNamespace = cachedResults.isImportFound && cachedResults.isNamespacePackage && !this._isNamespacePackageResolved(moduleDescriptor, cachedResults.implicitImports);

        if (!isUnresolvedNamespace) {
          return cachedResults;
        }
      }

      const bestImport = this._resolveBestAbsoluteImport(sourceFilePath, execEnv, moduleDescriptor, true);
      if (bestImport) {
        if (bestImport.isStubFile) {
          bestImport.nonStubImportResult = this._resolveBestAbsoluteImport(sourceFilePath, execEnv, moduleDescriptor, false) || notFoundResult;
        }
        return this.addResultsToCache(execEnv, importName, bestImport, moduleDescriptor.importedSymbols);
      }
    }

    return this.addResultsToCache(execEnv, importName, notFoundResult, undefined);
  }

  getCompletionSuggestions(sourceFilePath: string, execEnv: ExecutionEnvironment, moduleDescriptor: ImportedModuleDescriptor, similarityLimit: number): string[] {
    const importFailureInfo: string[] = [];
    const suggestions: string[] = [];

    if (moduleDescriptor.leadingDots > 0) {
      this._getCompletionSuggestionsRelative(sourceFilePath, moduleDescriptor, suggestions, similarityLimit);
    } else {
      if (moduleDescriptor.nameParts.length > 0) {
        this._getCompletionSuggestionsTypeshedPath(execEnv, moduleDescriptor, true, suggestions, similarityLimit);
      }

      this._getCompletionSuggestionsAbsolute(execEnv.root, moduleDescriptor, suggestions, similarityLimit);

      for (const extraPath of execEnv.extraPaths) {
        this._getCompletionSuggestionsAbsolute(extraPath, moduleDescriptor, suggestions, similarityLimit);
      }

      if (this._configOptions.stubPath) {
        this._getCompletionSuggestionsAbsolute(this._configOptions.stubPath, moduleDescriptor, suggestions, similarityLimit);
      }

      this._getCompletionSuggestionsTypeshedPath(execEnv, moduleDescriptor, false, suggestions, similarityLimit);

      const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
      for (const searchPath of pythonSearchPaths) {
        this._getCompletionSuggestionsAbsolute(searchPath, moduleDescriptor, suggestions, similarityLimit);
      }
    }

    return suggestions;
  }

  getSourceFilesFromStub(stubFilePath: string, execEnv: ExecutionEnvironment, _mapCompiled: boolean): string[] {
    const sourceFilePaths: string[] = [];

    this._cachedImportResults.forEach((map) => {
      map.forEach((result) => {
        if (result.isStubFile && result.isImportFound && result.nonStubImportResult) {
          if (result.resolvedPaths[result.resolvedPaths.length - 1] === stubFilePath) {
            if (result.nonStubImportResult.isImportFound) {
              const nonEmptyPath = result.nonStubImportResult.resolvedPaths[result.nonStubImportResult.resolvedPaths.length - 1];

              if (nonEmptyPath.endsWith('.py')) {
                sourceFilePaths.push(nonEmptyPath);
              }
            }
          }
        }
      });
    });

    if (sourceFilePaths.length === 0) {
      const sourceFilePath = changeAnyExtension(stubFilePath, '.py');
      if (this.dirExistsCached(sourceFilePath)) {
        sourceFilePaths.push(sourceFilePath);
      }
    }

    if (sourceFilePaths.length === 0) {
      const importRootPaths = this.getImportRoots(execEnv);

      const relativeStubPaths: string[] = [];
      for (const importRootPath of importRootPaths) {
        if (containsPath(importRootPath, stubFilePath, true)) {
          const parts = getRelativePathComponentsFromDir(importRootPath, stubFilePath, true);

          if (parts.length > 1) {
            if (parts[1].endsWith(stubsSuffix)) {
              parts[1] = parts[1].substr(0, parts[1].length - stubsSuffix.length);
            }

            const relativeStubPath = combinePathComponents(parts);
            if (relativeStubPath) {
              relativeStubPaths.push(relativeStubPath);
            }
          }
        }
      }

      for (const relativeStubPath of relativeStubPaths) {
        for (const importRootPath of importRootPaths) {
          const absoluteStubPath = resolvePaths(importRootPath, relativeStubPath);
          let absoluteSourcePath = changeAnyExtension(absoluteStubPath, '.py');
          if (this.fileExistsCached(absoluteSourcePath)) {
            sourceFilePaths.push(absoluteSourcePath);
          } else {
            const filePathWithoutExtension = stripFileExtension(absoluteSourcePath);

            if (filePathWithoutExtension.endsWith('__init__')) {
              absoluteSourcePath = filePathWithoutExtension.substr(0, filePathWithoutExtension.length - 9) + '.py';
              if (this.fileExistsCached(absoluteSourcePath)) {
                sourceFilePaths.push(absoluteSourcePath);
              }
            } else {
              absoluteSourcePath = combinePaths(filePathWithoutExtension, '__init__.py');
              if (this.fileExistsCached(absoluteSourcePath)) {
                sourceFilePaths.push(absoluteSourcePath);
              }
            }
          }
        }
      }
    }

    return sourceFilePaths;
  }

  getModuleNameForImport(filePath: string, execEnv: ExecutionEnvironment) {
    const cache = getOrAdd(this._cachedModuleNameResults, execEnv.root, () => new Map<string, ModuleNameAndType>());
    return getOrAdd(cache, filePath, () => this._getModuleNameForImport(filePath, execEnv));
  }

  private _getModuleNameForImport(filePath: string, execEnv: ExecutionEnvironment): ModuleNameAndType {
    let moduleName: string | undefined;
    let importType = ImportType.BuiltIn;
    let isLocalTypingsFile = false;

    const importFailureInfo: string[] = [];

    const stdLibTypeshedPath = this._getStdlibTypeshedPath(execEnv, importFailureInfo);
    if (stdLibTypeshedPath) {
      moduleName = this._getModuleNameFromPath(stdLibTypeshedPath, filePath);
      if (moduleName) {
        return { moduleName, importType, isLocalTypingsFile };
      }
    }

    moduleName = this._getModuleNameFromPath(execEnv.root, filePath);

    for (const extraPath of execEnv.extraPaths) {
      const candidateModuleName = this._getModuleNameFromPath(extraPath, filePath);

      if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
        moduleName = candidateModuleName;
        importType = ImportType.Local;
      }
    }

    if (this._configOptions.stubPath) {
      const candidateModuleName = this._getModuleNameFromPath(this._configOptions.stubPath, filePath);

      if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
        moduleName = candidateModuleName;

        importType = ImportType.Local;
        isLocalTypingsFile = true;
      }
    }

    const thirdPartyTypeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);
    if (thirdPartyTypeshedPath) {
      const candidateModuleName = this._getModuleNameFromPath(thirdPartyTypeshedPath, filePath, /* stripTopContainerDir */ true);

      if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
        moduleName = candidateModuleName;
        importType = ImportType.ThirdParty;
      }
    }

    const thirdPartyTypeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
    if (thirdPartyTypeshedPathEx) {
      const candidateModuleName = this._getModuleNameFromPath(thirdPartyTypeshedPathEx, filePath);

      if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
        moduleName = candidateModuleName;
        importType = ImportType.ThirdParty;
      }
    }

    const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
    for (const searchPath of pythonSearchPaths) {
      const candidateModuleName = this._getModuleNameFromPath(searchPath, filePath);

      if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
        moduleName = candidateModuleName;
        importType = ImportType.ThirdParty;
      }
    }

    if (moduleName) {
      return { moduleName, importType, isLocalTypingsFile };
    }

    return { moduleName: '', importType: ImportType.Local, isLocalTypingsFile };
  }

  getTypeshedStdLibPath(execEnv: ExecutionEnvironment) {
    const unused: string[] = [];
    return this._getStdlibTypeshedPath(execEnv, unused);
  }

  getImportRoots(execEnv: ExecutionEnvironment) {
    const importFailureInfo: string[] = [];
    const roots = [];

    const stdTypeshed = this._getStdlibTypeshedPath(execEnv, importFailureInfo);
    if (stdTypeshed) {
      roots.push(stdTypeshed);
    }

    roots.push(execEnv.root);
    roots.push(...execEnv.extraPaths);

    if (this._configOptions.stubPath) {
      roots.push(this._configOptions.stubPath);
    }

    const thirdPartyPaths = this._getThirdPartyTypeshedPackagePaths(execEnv, importFailureInfo);
    roots.push(...thirdPartyPaths);

    const typeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
    if (typeshedPathEx) {
      roots.push(typeshedPathEx);
    }

    const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
    if (pythonSearchPaths.length > 0) {
      roots.push(...pythonSearchPaths);
    }

    return roots;
  }

  protected readdirEntriesCached(path: string): Dirent[] {
    const cachedValue = this._cachedEntriesForPath.get(path);
    if (cachedValue) {
      return cachedValue;
    }

    let newCacheValue: Dirent[];
    try {
      newCacheValue = this.fileSystem.readdirEntriesSync(path);
    } catch {
      newCacheValue = [];
    }

    this._cachedEntriesForPath.set(path, newCacheValue);
    return newCacheValue;
  }

  protected fileExistsCached(path: string): boolean {
    const splitPath = this._splitPath(path);

    if (!splitPath[0] || !splitPath[1]) {
      if (!this.fileSystem.existsSync(path)) {
        return false;
      }
      return tryStat(this.fileSystem, path)?.isFile() ?? false;
    }

    const entries = this.readdirEntriesCached(splitPath[0]);
    const entry = entries.find((entry) => entry.name === splitPath[1]);
    if (entry?.isFile()) {
      return true;
    }

    if (entry?.isSymbolicLink()) {
      const realPath = this.fileSystem.realpathSync(path);
      if (this.fileSystem.existsSync(realPath) && isFile(this.fileSystem, realPath)) {
        return true;
      }
    }

    return false;
  }

  protected dirExistsCached(path: string): boolean {
    const splitPath = this._splitPath(path);

    if (!splitPath[0] || !splitPath[1]) {
      if (!this.fileSystem.existsSync(path)) {
        return false;
      }
      return tryStat(this.fileSystem, path)?.isDir() ?? false;
    }

    const entries = this.readdirEntriesCached(splitPath[0]);
    const entry = entries.find((entry) => entry.name === splitPath[1]);
    if (entry?.isDir()) {
      return true;
    }

    if (entry?.isSymbolicLink()) {
      const realPath = this.fileSystem.realpathSync(path);
      if (this.fileSystem.existsSync(realPath) && isDir(this.fileSystem, realPath)) {
        return true;
      }
    }

    return false;
  }

  ensurePartialStubPackages(execEnv: ExecutionEnvironment) {
    if (!(this.fileSystem instanceof PyrightFileSystem)) {
      return false;
    }

    if (this.fileSystem.isPartialStubPackagesScanned(execEnv)) {
      return false;
    }

    const fs = this.fileSystem;
    const ignored: string[] = [];
    const paths: string[] = [];

    addPaths(this._configOptions.stubPath);
    addPaths(execEnv.root);
    execEnv.extraPaths.forEach((p) => addPaths(p));
    addPaths(this.getTypeshedPathEx(execEnv, ignored));
    this._getPythonSearchPaths(execEnv, ignored).forEach((p) => addPaths(p));

    this.fileSystem.processPartialStubPackages(paths, this.getImportRoots(execEnv));
    this._invalidateFileSystemCache();
    return true;

    function addPaths(path?: string) {
      if (!path || fs.isPathScanned(path)) {
        return;
      }

      paths.push(path);
    }
  }

  protected addResultsToCache(execEnv: ExecutionEnvironment, importName: string, importResult: ImportResult, importedSymbols: string[] | undefined) {
    getOrAdd(this._cachedImportResults, execEnv.root, () => new Map<string, ImportResult>()).set(importName, importResult);

    return this._filterImplicitImports(importResult, importedSymbols);
  }

  protected resolveAbsoluteImport(
    rootPath: string,
    execEnv: ExecutionEnvironment,
    moduleDescriptor: ImportedModuleDescriptor,
    importName: string,
    importFailureInfo: string[],
    allowPartial = false,
    allowNativeLib = false,
    useStubPackage = false,
    allowPyi = true,
    lookForPyTyped = false
  ): ImportResult {
    if (allowPyi && useStubPackage) {
      const importResult = this._resolveAbsoluteImport(
        rootPath,
        execEnv,
        moduleDescriptor,
        importName,
        importFailureInfo,
        allowPartial,
        /* allowNativeLib */ false,
        /* useStubPackage */ true,
        /* allowPyi */ true,
        /* lookForPyTyped */ true
      );

      if (importResult.packageDir) {
        return importResult;
      }
    }

    return this._resolveAbsoluteImport(rootPath, execEnv, moduleDescriptor, importName, importFailureInfo, allowPartial, allowNativeLib, /* useStubPackage */ false, allowPyi, lookForPyTyped);
  }

  private _invalidateFileSystemCache() {
    this._cachedEntriesForPath.clear();
  }

  private _splitPath(path: string): [string, string] {
    const pathComponents = getPathComponents(path);
    if (pathComponents.length <= 1) {
      return [path, ''];
    }

    const containingPath = combinePathComponents(pathComponents.slice(0, -1));
    const fileOrDirName = pathComponents[pathComponents.length - 1];

    return [containingPath, fileOrDirName];
  }

  private _resolveAbsoluteImport(
    rootPath: string,
    execEnv: ExecutionEnvironment,
    moduleDescriptor: ImportedModuleDescriptor,
    importName: string,
    importFailureInfo: string[],
    allowPartial: boolean,
    allowNativeLib: boolean,
    useStubPackage: boolean,
    allowPyi: boolean,
    lookForPyTyped: boolean
  ): ImportResult {
    importFailureInfo.push(`Attempting to resolve using root path '${rootPath}'`);

    const resolvedPaths: string[] = [];
    let dirPath = rootPath;
    let isNamespacePackage = false;
    let isStubPackage = false;
    let isStubFile = false;
    let isNativeLib = false;
    let implicitImports: ImplicitImport[] = [];
    let packageDir: string | undefined;
    let pyTypedInfo: PyTypedInfo | undefined;

    if (moduleDescriptor.nameParts.length === 0) {
      const fileNameWithoutExtension = '__init__';
      const pyFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.py');
      const pyiFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.pyi');

      if (allowPyi && this.fileExistsCached(pyiFilePath)) {
        importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
        resolvedPaths.push(pyiFilePath);
        isStubFile = true;
      } else if (this.fileExistsCached(pyFilePath)) {
        importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
        resolvedPaths.push(pyFilePath);
      } else {
        importFailureInfo.push(`Partially resolved import with directory '${dirPath}'`);
        resolvedPaths.push('');
        isNamespacePackage = true;
      }

      implicitImports = this._findImplicitImports(importName, dirPath, [pyFilePath, pyiFilePath]);
    } else {
      for (let i = 0; i < moduleDescriptor.nameParts.length; i++) {
        const isFirstPart = i === 0;
        const isLastPart = i === moduleDescriptor.nameParts.length - 1;
        dirPath = combinePaths(dirPath, moduleDescriptor.nameParts[i]);

        if (useStubPackage && isFirstPart) {
          dirPath += stubsSuffix;
          isStubPackage = true;
        }

        const foundDir = this.dirExistsCached(dirPath);

        if (foundDir) {
          if (isFirstPart) {
            packageDir = dirPath;
          }

          const fileNameWithoutExtension = '__init__';
          const pyFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.py');
          const pyiFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.pyi');
          let foundInit = false;

          if (allowPyi && this.fileExistsCached(pyiFilePath)) {
            importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
            resolvedPaths.push(pyiFilePath);
            if (isLastPart) {
              isStubFile = true;
            }
            foundInit = true;
          } else if (this.fileExistsCached(pyFilePath)) {
            importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
            resolvedPaths.push(pyFilePath);
            foundInit = true;
          }

          if (foundInit && !pyTypedInfo && lookForPyTyped) {
            if (this.fileExistsCached(combinePaths(dirPath, 'py.typed'))) {
              pyTypedInfo = getPyTypedInfo(this.fileSystem, dirPath);
            }
          }

          if (!isLastPart) {
            if (!foundInit) {
              resolvedPaths.push('');
              isNamespacePackage = true;
              pyTypedInfo = undefined;
            }
            continue;
          }

          if (foundInit) {
            implicitImports = this._findImplicitImports(moduleDescriptor.nameParts.join('.'), dirPath, [pyFilePath, pyiFilePath]);
            break;
          }
        }

        let fileDir = stripTrailingDirSeparator(dirPath);
        const fileNameWithoutExtension = getFileName(fileDir);
        fileDir = getDirPath(fileDir);
        const pyFilePath = combinePaths(fileDir, fileNameWithoutExtension + '.py');
        const pyiFilePath = combinePaths(fileDir, fileNameWithoutExtension + '.pyi');

        if (allowPyi && this.fileExistsCached(pyiFilePath)) {
          importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
          resolvedPaths.push(pyiFilePath);
          if (isLastPart) {
            isStubFile = true;
          }
        } else if (this.fileExistsCached(pyFilePath)) {
          importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
          resolvedPaths.push(pyFilePath);
        } else {
          if (allowNativeLib && this.dirExistsCached(fileDir)) {
            const filesInDir = this._getFilesInDir(fileDir);
            const nativeLibFileName = filesInDir.find((f) => this._isNativeModuleFileName(fileNameWithoutExtension, f));
            if (nativeLibFileName) {
              const nativeLibPath = combinePaths(fileDir, nativeLibFileName);

              isNativeLib = this._resolveNativeModuleStub(nativeLibPath, execEnv, importName, moduleDescriptor, importFailureInfo, resolvedPaths);
            }
          }

          if (!isNativeLib && foundDir) {
            importFailureInfo.push(`Partially resolved import with directory '${dirPath}'`);
            resolvedPaths.push('');
            if (isLastPart) {
              implicitImports = this._findImplicitImports(importName, dirPath, [pyFilePath, pyiFilePath]);
              isNamespacePackage = true;
            }
          } else if (isNativeLib) {
            importFailureInfo.push(`Did not find file '${pyiFilePath}' or '${pyFilePath}'`);
          }
        }
        break;
      }
    }

    let importFound: boolean;
    const isPartlyResolved = resolvedPaths.length > 0 && resolvedPaths.length < moduleDescriptor.nameParts.length;
    if (allowPartial) {
      importFound = resolvedPaths.length > 0;
    } else {
      importFound = resolvedPaths.length >= moduleDescriptor.nameParts.length;
    }

    return {
      importName,
      isRelative: false,
      isNamespacePackage,
      isStubPackage,
      isImportFound: importFound,
      isPartlyResolved,
      importFailureInfo,
      importType: ImportType.Local,
      resolvedPaths,
      searchPath: rootPath,
      isStubFile,
      isNativeLib,
      implicitImports,
      pyTypedInfo,
      filteredImplicitImports: implicitImports,
      packageDir,
    };
  }

  protected getTypeshedPathEx(execEnv: ExecutionEnvironment, importFailureInfo: string[]): string | undefined {
    return undefined;
  }

  protected resolveImportEx(
    sourceFilePath: string,
    execEnv: ExecutionEnvironment,
    moduleDescriptor: ImportedModuleDescriptor,
    importName: string,
    importFailureInfo: string[] = [],
    allowPyi = true
  ): ImportResult | undefined {
    return undefined;
  }

  protected resolveNativeImportEx(libraryFilePath: string, importName: string, importFailureInfo: string[] = []): string | undefined {
    return undefined;
  }

  protected getNativeModuleName(fileName: string): string | undefined {
    const fileExtension = getFileExtension(fileName, /* multiDotExtension */ false).toLowerCase();
    if (this._isNativeModuleFileExtension(fileExtension)) {
      return stripFileExtension(stripFileExtension(fileName));
    }
  }

  private _lookUpResultsInCache(execEnv: ExecutionEnvironment, importName: string, importedSymbols: string[] | undefined) {
    const cacheForExecEnv = this._cachedImportResults.get(execEnv.root);
    if (!cacheForExecEnv) {
      return undefined;
    }

    const cachedEntry = cacheForExecEnv.get(importName);
    if (!cachedEntry) {
      return undefined;
    }

    return this._filterImplicitImports(cachedEntry, importedSymbols);
  }

  private _isNamespacePackageResolved(moduleDescriptor: ImportedModuleDescriptor, implicitImports: ImplicitImport[]) {
    if (moduleDescriptor.importedSymbols) {
      if (
        !moduleDescriptor.importedSymbols.some((symbol) => {
          return implicitImports.some((implicitImport) => {
            return implicitImport.name === symbol;
          });
        })
      ) {
        return false;
      }
    } else if (implicitImports.length === 0) {
      return false;
    }
    return true;
  }

  private _getModuleNameFromPath(containerPath: string, filePath: string, stripTopContainerDir = false): string | undefined {
    containerPath = ensureTrailingDirSeparator(containerPath);
    let filePathWithoutExtension = stripFileExtension(filePath);

    if (this._isNativeModuleFileExtension(getFileExtension(filePath))) {
      filePathWithoutExtension = stripFileExtension(filePathWithoutExtension);
    }

    if (!filePathWithoutExtension.startsWith(containerPath)) {
      return undefined;
    }

    if (filePathWithoutExtension.endsWith('__init__')) {
      filePathWithoutExtension = filePathWithoutExtension.substr(0, filePathWithoutExtension.length - 9);
    }

    const relativeFilePath = filePathWithoutExtension.substr(containerPath.length);
    const parts = getPathComponents(relativeFilePath);
    parts.shift();
    if (stripTopContainerDir) {
      if (parts.length === 0) {
        return undefined;
      }
      parts.shift();
    }

    if (parts.length === 0) {
      return undefined;
    }

    if (parts[0].endsWith(stubsSuffix)) {
      parts[0] = parts[0].substr(0, parts[0].length - stubsSuffix.length);
    }

    if (parts.some((p) => !this._isIdentifier(p))) {
      return undefined;
    }

    return parts.join('.');
  }

  private _resolveBestAbsoluteImport(sourceFilePath: string, execEnv: ExecutionEnvironment, moduleDescriptor: ImportedModuleDescriptor, allowPyi: boolean): ImportResult | undefined {
    const importName = this.formatImportName(moduleDescriptor);
    const importFailureInfo: string[] = [];

    if (allowPyi && moduleDescriptor.nameParts.length > 0) {
      const builtInImport = this._findTypeshedPath(execEnv, moduleDescriptor, importName, /* isStdLib */ true, importFailureInfo);
      if (builtInImport) {
        builtInImport.isTypeshedFile = true;
        return builtInImport;
      }
    }

    if (allowPyi) {
      if (this._configOptions.stubPath) {
        importFailureInfo.push(`Looking in stubPath '${this._configOptions.stubPath}'`);
        const typingsImport = this.resolveAbsoluteImport(
          this._configOptions.stubPath,
          execEnv,
          moduleDescriptor,
          importName,
          importFailureInfo,
          /* allowPartial */ undefined,
          /* allowNativeLib */ false,
          /* useStubPackage */ true,
          allowPyi,
          /* lookForPyTyped */ false
        );

        if (typingsImport.isImportFound) {
          typingsImport.importType = ImportType.Local;
          typingsImport.isLocalTypingsFile = true;
          return typingsImport;
        }
      }
    }

    let bestResultSoFar: ImportResult | undefined;

    importFailureInfo.push(`Looking in root directory of execution environment ` + `'${execEnv.root}'`);
    let localImport = this.resolveAbsoluteImport(
      execEnv.root,
      execEnv,
      moduleDescriptor,
      importName,
      importFailureInfo,
      /* allowPartial */ undefined,
      /* allowNativeLib */ true,
      /* useStubPackage */ true,
      allowPyi,
      /* lookForPyTyped */ false
    );
    bestResultSoFar = localImport;

    for (const extraPath of execEnv.extraPaths) {
      importFailureInfo.push(`Looking in extraPath '${extraPath}'`);
      localImport = this.resolveAbsoluteImport(
        extraPath,
        execEnv,
        moduleDescriptor,
        importName,
        importFailureInfo,
        /* allowPartial */ undefined,
        /* allowNativeLib */ true,
        /* useStubPackage */ true,
        allowPyi,
        /* lookForPyTyped */ false
      );
      bestResultSoFar = this._pickBestImport(bestResultSoFar, localImport);
    }

    const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
    if (pythonSearchPaths.length > 0) {
      for (const searchPath of pythonSearchPaths) {
        importFailureInfo.push(`Looking in python search path '${searchPath}'`);

        const thirdPartyImport = this.resolveAbsoluteImport(
          searchPath,
          execEnv,
          moduleDescriptor,
          importName,
          importFailureInfo,
          /* allowPartial */ allowPartialResolutionForThirdPartyPackages,
          /* allowNativeLib */ true,
          /* useStubPackage */ true,
          allowPyi,
          /* lookForPyTyped */ true
        );

        if (thirdPartyImport) {
          thirdPartyImport.importType = ImportType.ThirdParty;

          if (thirdPartyImport.isImportFound && thirdPartyImport.isStubFile) {
            return thirdPartyImport;
          }

          bestResultSoFar = this._pickBestImport(bestResultSoFar, thirdPartyImport);
        }
      }
    } else {
      importFailureInfo.push('No python interpreter search path');
    }

    const extraResults = this.resolveImportEx(sourceFilePath, execEnv, moduleDescriptor, importName, importFailureInfo, allowPyi);
    if (extraResults !== undefined) {
      return extraResults;
    }

    if (allowPyi) {
      importFailureInfo.push(`Looking for typeshed path`);
      const typeshedImport = this._findTypeshedPath(execEnv, moduleDescriptor, importName, /* isStdLib */ false, importFailureInfo);
      if (typeshedImport) {
        typeshedImport.isTypeshedFile = true;
        return typeshedImport;
      }
    }

    return bestResultSoFar;
  }

  private _pickBestImport(bestImportSoFar: ImportResult | undefined, newImport: ImportResult | undefined) {
    if (!bestImportSoFar) {
      return newImport;
    }

    if (!newImport) {
      return bestImportSoFar;
    }

    if (newImport.isImportFound) {
      if (!bestImportSoFar.isImportFound) {
        return newImport;
      }

      if (bestImportSoFar.isNamespacePackage && !newImport.isNamespacePackage) {
        return newImport;
      }

      if (bestImportSoFar.resolvedPaths.length > newImport.resolvedPaths.length) {
        return newImport;
      }
    } else if (newImport.isPartlyResolved && bestImportSoFar.isNamespacePackage && !newImport.isNamespacePackage) {
      return newImport;
    }

    return bestImportSoFar;
  }

  private _isIdentifier(value: string) {
    for (let i = 0; i < value.length; i++) {
      if (i === 0 ? !isIdentifierStartChar(value.charCodeAt(i)) : !isIdentifierChar(value.charCodeAt(i))) {
        return false;
      }
    }

    return true;
  }

  private _getPythonSearchPaths(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
    const cacheKey = '<default>';

    if (!this._cachedPythonSearchPaths.has(cacheKey)) {
      let paths = PythonPathUtils.findPythonSearchPaths(this.fileSystem, this._configOptions, importFailureInfo) || [];

      paths = [...new Set(paths)];

      this._cachedPythonSearchPaths.set(cacheKey, paths);
    }

    return this._cachedPythonSearchPaths.get(cacheKey)!;
  }

  private _findTypeshedPath(execEnv: ExecutionEnvironment, moduleDescriptor: ImportedModuleDescriptor, importName: string, isStdLib: boolean, importFailureInfo: string[]): ImportResult | undefined {
    importFailureInfo.push(`Looking for typeshed ${isStdLib ? PythonPathUtils.stdLibFolderName : PythonPathUtils.thirdPartyFolderName} path`);

    const typeshedPath = isStdLib ? this._getStdlibTypeshedPath(execEnv, importFailureInfo) : this._getThirdPartyTypeshedPackagePath(moduleDescriptor, execEnv, importFailureInfo);

    if (typeshedPath && this.dirExistsCached(typeshedPath)) {
      const importInfo = this.resolveAbsoluteImport(typeshedPath, execEnv, moduleDescriptor, importName, importFailureInfo);
      if (importInfo.isImportFound) {
        importInfo.importType = isStdLib ? ImportType.BuiltIn : ImportType.ThirdParty;
        return importInfo;
      }
    }

    importFailureInfo.push(`Typeshed path not found`);
    return undefined;
  }

  private _buildTypeshedThirdPartyPackageMap(thirdPartyDir: string | undefined) {
    this._cachedTypeshedThirdPartyPackagePaths = new Map<string, string>();

    if (thirdPartyDir) {
      this.readdirEntriesCached(thirdPartyDir).forEach((outerEntry) => {
        if (outerEntry.isDir()) {
          const innerDirPath = combinePaths(thirdPartyDir, outerEntry.name);

          this.readdirEntriesCached(innerDirPath).forEach((innerEntry) => {
            if (innerEntry.name === '@python2') {
              return;
            }

            if (innerEntry.isDir()) {
              this._cachedTypeshedThirdPartyPackagePaths!.set(innerEntry.name, innerDirPath);
            } else if (innerEntry.isFile()) {
              if (innerEntry.name.endsWith('.pyi')) {
                this._cachedTypeshedThirdPartyPackagePaths!.set(stripFileExtension(innerEntry.name), innerDirPath);
              }
            }
          });
        }
      });
    }

    this._cachedTypeshedThirdPartyPackageRoots = [...new Set(this._cachedTypeshedThirdPartyPackagePaths.values())].sort();
  }

  private _getCompletionSuggestionsTypeshedPath(execEnv: ExecutionEnvironment, moduleDescriptor: ImportedModuleDescriptor, isStdLib: boolean, suggestions: string[], similarityLimit: number) {
    const importFailureInfo: string[] = [];

    const typeshedPath = isStdLib ? this._getStdlibTypeshedPath(execEnv, importFailureInfo) : this._getThirdPartyTypeshedPackagePath(moduleDescriptor, execEnv, importFailureInfo);

    if (!typeshedPath) {
      return;
    }

    if (this.dirExistsCached(typeshedPath)) {
      this._getCompletionSuggestionsAbsolute(typeshedPath, moduleDescriptor, suggestions, similarityLimit);
    }
  }

  private _getStdlibTypeshedPath(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
    return this._getTypeshedSubdirectory(/* isStdLib */ true, execEnv, importFailureInfo);
  }

  private _getThirdPartyTypeshedPath(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
    return this._getTypeshedSubdirectory(/* isStdLib */ false, execEnv, importFailureInfo);
  }

  private _getThirdPartyTypeshedPackagePath(moduleDescriptor: ImportedModuleDescriptor, execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
    const typeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);

    if (!this._cachedTypeshedThirdPartyPackagePaths) {
      this._buildTypeshedThirdPartyPackageMap(typeshedPath);
    }

    const firstNamePart = moduleDescriptor.nameParts.length > 0 ? moduleDescriptor.nameParts[0] : '';
    return this._cachedTypeshedThirdPartyPackagePaths!.get(firstNamePart);
  }

  private _getThirdPartyTypeshedPackagePaths(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
    const typeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);

    if (!this._cachedTypeshedThirdPartyPackagePaths) {
      this._buildTypeshedThirdPartyPackageMap(typeshedPath);
    }

    return this._cachedTypeshedThirdPartyPackageRoots!;
  }

  private _getTypeshedSubdirectory(isStdLib: boolean, execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
    if (isStdLib) {
      if (this._cachedTypeshedStdLibPath !== undefined) {
        return this._cachedTypeshedStdLibPath;
      }
    } else {
      if (this._cachedTypeshedThirdPartyPath !== undefined) {
        return this._cachedTypeshedThirdPartyPath;
      }
    }

    let typeshedPath = '';

    if (this._configOptions.typeshedPath) {
      const possibleTypeshedPath = this._configOptions.typeshedPath;
      if (this.dirExistsCached(possibleTypeshedPath)) {
        typeshedPath = possibleTypeshedPath;
      }
    } else {
      const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
      for (const searchPath of pythonSearchPaths) {
        const possibleTypeshedPath = combinePaths(searchPath, 'typeshed');
        if (this.dirExistsCached(possibleTypeshedPath)) {
          typeshedPath = possibleTypeshedPath;
          break;
        }
      }
    }

    if (!typeshedPath) {
      typeshedPath = PythonPathUtils.getTypeShedFallbackPath(this.fileSystem) || '';
    }

    typeshedPath = PythonPathUtils.getTypeshedSubdirectory(typeshedPath, isStdLib);

    if (!this.dirExistsCached(typeshedPath)) {
      return undefined;
    }

    if (isStdLib) {
      this._cachedTypeshedStdLibPath = typeshedPath;
    } else {
      this._cachedTypeshedThirdPartyPath = typeshedPath;
    }

    return typeshedPath;
  }

  private _resolveRelativeImport(
    sourceFilePath: string,
    execEnv: ExecutionEnvironment,
    moduleDescriptor: ImportedModuleDescriptor,
    importName: string,
    importFailureInfo: string[]
  ): ImportResult | undefined {
    importFailureInfo.push('Attempting to resolve relative import');

    let curDir = getDirPath(sourceFilePath);
    for (let i = 1; i < moduleDescriptor.leadingDots; i++) {
      if (curDir === '') {
        importFailureInfo.push(`Invalid relative path '${importName}'`);
        return undefined;
      }
      curDir = getDirPath(curDir);
    }

    const absImport = this.resolveAbsoluteImport(curDir, execEnv, moduleDescriptor, importName, importFailureInfo, /* allowPartial */ false, /* allowNativeLib */ true);
    return this._filterImplicitImports(absImport, moduleDescriptor.importedSymbols);
  }

  private _getCompletionSuggestionsRelative(sourceFilePath: string, moduleDescriptor: ImportedModuleDescriptor, suggestions: string[], similarityLimit: number) {
    let curDir = getDirPath(sourceFilePath);
    for (let i = 1; i < moduleDescriptor.leadingDots; i++) {
      if (curDir === '') {
        return;
      }
      curDir = getDirPath(curDir);
    }

    this._getCompletionSuggestionsAbsolute(curDir, moduleDescriptor, suggestions, similarityLimit);
  }

  private _getFilesInDir(dirPath: string): string[] {
    const entriesInDir = this.readdirEntriesCached(dirPath);
    const filesInDir = entriesInDir.filter((f) => f.isFile()).map((f) => f.name);

    entriesInDir.forEach((f) => {
      const linkPath = combinePaths(dirPath, f.name);
      if (f.isSymbolicLink() && tryStat(this.fileSystem, linkPath)?.isFile()) {
        filesInDir.push(f.name);
      }
    });

    return filesInDir;
  }

  private _getCompletionSuggestionsAbsolute(rootPath: string, moduleDescriptor: ImportedModuleDescriptor, suggestions: string[], similarityLimit: number) {
    let dirPath = rootPath;

    const nameParts = moduleDescriptor.nameParts.map((name) => name);
    if (moduleDescriptor.hasTrailingDot) {
      nameParts.push('');
    }

    if (nameParts.length === 0) {
      this._addFilteredSuggestions(dirPath, '', suggestions, similarityLimit);
    } else {
      for (let i = 0; i < nameParts.length; i++) {
        if (i === nameParts.length - 1) {
          this._addFilteredSuggestions(dirPath, nameParts[i], suggestions, similarityLimit);
        }

        dirPath = combinePaths(dirPath, nameParts[i]);
        if (!this.dirExistsCached(dirPath)) {
          break;
        }
      }
    }
  }

  private _addFilteredSuggestions(dirPath: string, filter: string, suggestions: string[], similarityLimit: number) {
    const entries = getFileSystemEntriesFromDirEntries(this.readdirEntriesCached(dirPath), this.fileSystem, dirPath);

    entries.files.forEach((file) => {
      const fileExtension = getFileExtension(file, /* multiDotExtension */ false).toLowerCase();
      const fileWithoutExtension = stripFileExtension(file, /* multiDotExtension */ true);

      if (supportedFileExtensions.some((ext) => ext === fileExtension)) {
        if (fileWithoutExtension !== '__init__') {
          if (!filter || StringUtils.isPatternInSymbol(filter, fileWithoutExtension)) {
            this._addUniqueSuggestion(fileWithoutExtension, suggestions);
          }
        }
      }
    });

    entries.directories.forEach((dir) => {
      if (!filter || dir.startsWith(filter)) {
        this._addUniqueSuggestion(dir, suggestions);
      }
    });
  }

  private _addUniqueSuggestion(suggestionToAdd: string, suggestions: string[]) {
    if (suggestions.some((s) => s === suggestionToAdd)) {
      return;
    }

    if (/[.-]/.test(suggestionToAdd)) {
      return;
    }

    if (isDunderName(suggestionToAdd) && suggestionToAdd !== '__future__') {
      return;
    }

    suggestions.push(suggestionToAdd);
  }

  private _filterImplicitImports(importResult: ImportResult, importedSymbols: string[] | undefined): ImportResult {
    if (importedSymbols === undefined) {
      const newImportResult = Object.assign({}, importResult);
      newImportResult.filteredImplicitImports = [];
      return newImportResult;
    }

    if (importedSymbols.length === 0) {
      return importResult;
    }

    if (importResult.implicitImports.length === 0) {
      return importResult;
    }

    const filteredImplicitImports = importResult.implicitImports.filter((implicitImport) => {
      return importedSymbols.some((sym) => sym === implicitImport.name);
    });

    if (filteredImplicitImports.length === importResult.implicitImports.length) {
      return importResult;
    }

    const newImportResult = Object.assign({}, importResult);
    newImportResult.filteredImplicitImports = filteredImplicitImports;
    return newImportResult;
  }

  private _findImplicitImports(importingModuleName: string, dirPath: string, exclusions: string[]): ImplicitImport[] {
    const implicitImportMap = new Map<string, ImplicitImport>();

    const entries = getFileSystemEntriesFromDirEntries(this.readdirEntriesCached(dirPath), this.fileSystem, dirPath);

    for (const fileName of entries.files) {
      const fileExt = getFileExtension(fileName);
      let strippedFileName: string;
      let isNativeLib = false;

      if (fileExt === '.py' || fileExt === '.pyi') {
        strippedFileName = stripFileExtension(fileName);
      } else if (this._isNativeModuleFileExtension(fileExt) && !this.fileExistsCached(`${fileName}.py`) && !this.fileExistsCached(`${fileName}.pyi`)) {
        strippedFileName = fileName.substr(0, fileName.indexOf('.'));
        isNativeLib = true;
      } else {
        continue;
      }

      const filePath = combinePaths(dirPath, fileName);
      if (!exclusions.find((exclusion) => exclusion === filePath)) {
        const implicitImport: ImplicitImport = {
          isStubFile: fileName.endsWith('.pyi'),
          isNativeLib,
          name: strippedFileName,
          path: filePath,
        };

        const entry = implicitImportMap.get(implicitImport.name);
        if (!entry || !entry.isStubFile) {
          if (isNativeLib) {
            const nativeLibPath = combinePaths(dirPath, fileName);
            const nativeStubPath = this.resolveNativeImportEx(nativeLibPath, `${importingModuleName}.${strippedFileName}`, []);
            if (nativeStubPath) {
              implicitImport.path = nativeStubPath;
            }
          }
          implicitImportMap.set(implicitImport.name, implicitImport);
        }
      }
    }

    for (const dirName of entries.directories) {
      const pyFilePath = combinePaths(dirPath, dirName, '__init__.py');
      const pyiFilePath = pyFilePath + 'i';
      let isStubFile = false;
      let path = '';

      if (this.fileExistsCached(pyiFilePath)) {
        isStubFile = true;
        path = pyiFilePath;
      } else if (this.fileExistsCached(pyFilePath)) {
        path = pyFilePath;
      }

      if (path) {
        if (!exclusions.find((exclusion) => exclusion === path)) {
          const implicitImport: ImplicitImport = {
            isStubFile,
            isNativeLib: false,
            name: dirName,
            path,
          };

          implicitImportMap.set(implicitImport.name, implicitImport);
        }
      }
    }

    return [...implicitImportMap.values()];
  }

  protected formatImportName(moduleDescriptor: ImportedModuleDescriptor) {
    let name = '';
    for (let i = 0; i < moduleDescriptor.leadingDots; i++) {
      name += '.';
    }

    return name + moduleDescriptor.nameParts.map((part) => part).join('.');
  }

  private _resolveNativeModuleStub(
    nativeLibPath: string,
    execEnv: ExecutionEnvironment,
    importName: string,
    moduleDescriptor: ImportedModuleDescriptor,
    importFailureInfo: string[],
    resolvedPaths: string[]
  ): boolean {
    let moduleFullName = importName;

    if (moduleDescriptor.leadingDots > 0) {
      const info = this.getModuleNameForImport(nativeLibPath, execEnv);
      moduleFullName = info.moduleName.length > 0 ? info.moduleName : moduleFullName;
    }

    const compiledStubPath = this.resolveNativeImportEx(nativeLibPath, moduleFullName, importFailureInfo);
    if (compiledStubPath) {
      importFailureInfo.push(`Resolved native import ${importName} with stub '${compiledStubPath}'`);
      resolvedPaths.push(compiledStubPath);
      return false; // Resolved to a stub.
    }

    importFailureInfo.push(`Resolved import with file '${nativeLibPath}'`);
    resolvedPaths.push(nativeLibPath);
    return true;
  }

  private _isNativeModuleFileName(moduleName: string, fileName: string): boolean {
    const fileExtension = getFileExtension(fileName, /* multiDotExtension */ false).toLowerCase();
    const withoutExtension = stripFileExtension(fileName, /* multiDotExtension */ true);
    return this._isNativeModuleFileExtension(fileExtension) && equateStringsCaseInsensitive(moduleName, withoutExtension);
  }

  private _isNativeModuleFileExtension(fileExtension: string): boolean {
    return supportedNativeLibExtensions.some((ext) => ext === fileExtension);
  }
}

export type ImportResolverFact = (fs: FileSystem, options: ConfigOptions) => ImportResolver;
