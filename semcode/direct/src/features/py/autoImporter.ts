import { CancellationToken, CompletionItemKind, SymbolKind } from 'vscode-languageserver';

import { DeclarationType } from '../analyzer/declaration';
import { ImportResolver, ModuleNameAndType } from '../analyzer/importResolver';
import { ImportType } from '../analyzer/importResult';
import { getImportGroup, getTextEditsForAutoImportInsertion, getTextEditsForAutoImportSymbolAddition, getTopLevelImports, ImportGroup, ImportStatements } from '../analyzer/importStatementUtils';
import { SourceFileInfo } from '../analyzer/program';
import { Symbol } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ExecutionEnvironment } from '../common/configOptions';
import { TextEditAction } from '../common/editAction';
import { combinePaths, getDirPath, getFileName, stripFileExtension } from '../common/pathUtils';
import * as StringUtils from '../common/stringUtils';
import { Position } from '../common/textRange';
import { Duration } from '../common/timing';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { IndexAliasData, IndexResults } from './documentSymbolProvider';

export interface AutoImportSymbol {
  readonly importAlias?: IndexAliasData;
  readonly symbol?: Symbol;
  readonly kind?: SymbolKind;
}

export interface ModuleSymbolTable {
  forEach(callbackfn: (symbol: AutoImportSymbol, name: string, library: boolean) => void): void;
}

export type ModuleSymbolMap = Map<string, ModuleSymbolTable>;

export function buildModuleSymbolsMap(files: SourceFileInfo[], includeIndexUserSymbols: boolean, token: CancellationToken): ModuleSymbolMap {
  const moduleSymbolMap = new Map<string, ModuleSymbolTable>();

  files.forEach((file) => {
    throwIfCancellationRequested(token);
    if (file.shadows.length > 0) {
      return;
    }
    const filePath = file.sourceFile.getFilePath();
    const symbolTable = file.sourceFile.getModuleSymbolTable();
    if (symbolTable) {
      const fileName = stripFileExtension(getFileName(filePath));
      if (SymbolNameUtils.isPrivateOrProtectedName(fileName)) {
        return;
      }
      moduleSymbolMap.set(filePath, {
        forEach(callbackfn: (value: AutoImportSymbol, key: string, library: boolean) => void): void {
          symbolTable.forEach((symbol, name) => {
            if (symbol.isExternallyHidden()) {
              return;
            }
            const declarations = symbol.getDeclarations();
            if (!declarations || declarations.length === 0) {
              return;
            }
            const declaration = declarations[0];
            if (!declaration) {
              return;
            }
            if (declaration.type === DeclarationType.Alias) {
              return;
            }
            const variableKind = declaration.type === DeclarationType.Variable && !declaration.isConstant && !declaration.isFinal ? SymbolKind.Variable : undefined;
            callbackfn({ symbol, kind: variableKind }, name, /* library */ false);
          });
        },
      });
      return;
    }
    const indexResults = file.sourceFile.getCachedIndexResults();
    if (indexResults && includeIndexUserSymbols && !indexResults.privateOrProtected) {
      moduleSymbolMap.set(filePath, createModuleSymbolTableFromIndexResult(indexResults, /* library */ false));
      return;
    }
  });

  return moduleSymbolMap;
}

export interface AbbreviationInfo {
  importFrom?: string;
  importName: string;
}

export interface AutoImportResult {
  name: string;
  symbol?: Symbol;
  source?: string;
  insertionText: string;
  edits?: TextEditAction[];
  alias?: string;
  kind?: CompletionItemKind;
}

export interface AutoImportOptions {
  libraryMap?: Map<string, IndexResults>;
  patternMatcher?: (pattern: string, name: string) => boolean;
  allowVariableInAll?: boolean;
  lazyEdit?: boolean;
}

interface ImportParts {
  importName: string;
  symbolName?: string;
  importFrom?: string;
  filePath: string;
  dotCount: number;
  moduleNameAndType: ModuleNameAndType;
}

interface ImportAliasData {
  importParts: ImportParts;
  importGroup: ImportGroup;
  symbol?: Symbol;
  kind?: SymbolKind;
}

type AutoImportResultMap = Map<string, AutoImportResult[]>;

export class AutoImporter {
  private _importStatements: ImportStatements;
  private _stopWatch = new Duration();
  private _perfInfo = {
    indexUsed: false,
    totalInMs: 0,

    moduleTimeInMS: 0,
    indexTimeInMS: 0,
    importAliasTimeInMS: 0,

    symbolCount: 0,
    userIndexCount: 0,
    indexCount: 0,
    importAliasCount: 0,

    editTimeInMS: 0,
    moduleResolveTimeInMS: 0,
  };

  constructor(
    private _execEnvironment: ExecutionEnvironment,
    private _importResolver: ImportResolver,
    private _parseResults: ParseResults,
    private _invocationPosition: Position,
    private _excludes: Set<string>,
    private _moduleSymbolMap: ModuleSymbolMap,
    private _options: AutoImportOptions
  ) {
    this._options.patternMatcher = this._options.patternMatcher ?? StringUtils.isPatternInSymbol;
    this._importStatements = getTopLevelImports(this._parseResults.parseTree, true);
    this._perfInfo.indexUsed = !!this._options.libraryMap;
  }

  getAutoImportCandidatesForAbbr(abbr: string | undefined, abbrInfo: AbbreviationInfo, token: CancellationToken) {
    const map = this._getCandidates(abbrInfo.importName, /* similarityLimit */ 1, abbr, token);
    const result = map.get(abbrInfo.importName);
    if (!result) {
      return [];
    }
    return result.filter((r) => r.source === abbrInfo.importFrom);
  }

  getAutoImportCandidates(word: string, similarityLimit: number, abbrFromUsers: string | undefined, token: CancellationToken) {
    const results: AutoImportResult[] = [];
    const map = this._getCandidates(word, similarityLimit, abbrFromUsers, token);
    map.forEach((v) => results.push(...v));
    return results;
  }

  getPerfInfo() {
    this._perfInfo.totalInMs = this._stopWatch.getDurationInMilliseconds();
    return this._perfInfo;
  }

  private _getCandidates(word: string, similarityLimit: number, abbrFromUsers: string | undefined, token: CancellationToken) {
    const resultMap = new Map<string, AutoImportResult[]>();
    const importAliasMap = new Map<string, Map<string, ImportAliasData>>();
    this._addImportsFromModuleMap(word, similarityLimit, abbrFromUsers, importAliasMap, resultMap, token);
    this._addImportsFromLibraryMap(word, similarityLimit, abbrFromUsers, importAliasMap, resultMap, token);
    this._addImportsFromImportAliasMap(importAliasMap, abbrFromUsers, resultMap, token);
    return resultMap;
  }

  private _addImportsFromLibraryMap(
    word: string,
    similarityLimit: number,
    abbrFromUsers: string | undefined,
    aliasMap: Map<string, Map<string, ImportAliasData>>,
    results: AutoImportResultMap,
    token: CancellationToken
  ) {
    const startTime = this._stopWatch.getDurationInMilliseconds();

    this._options.libraryMap?.forEach((indexResults, filePath) => {
      if (indexResults.privateOrProtected) {
        return;
      }
      if (this._moduleSymbolMap.has(filePath)) {
        return;
      }
      const isStubFileOrHasInit = this._isStubFileOrHasInit(this._options.libraryMap!, filePath);
      this._processModuleSymbolTable(
        createModuleSymbolTableFromIndexResult(indexResults, /* library */ true),
        filePath,
        word,
        similarityLimit,
        isStubFileOrHasInit,
        abbrFromUsers,
        aliasMap,
        results,
        token
      );
    });
    this._perfInfo.indexTimeInMS = this._stopWatch.getDurationInMilliseconds() - startTime;
  }

  private _addImportsFromModuleMap(
    word: string,
    similarityLimit: number,
    abbrFromUsers: string | undefined,
    aliasMap: Map<string, Map<string, ImportAliasData>>,
    results: AutoImportResultMap,
    token: CancellationToken
  ) {
    const startTime = this._stopWatch.getDurationInMilliseconds();
    this._moduleSymbolMap.forEach((topLevelSymbols, filePath) => {
      const isStubFileOrHasInit = this._isStubFileOrHasInit(this._moduleSymbolMap!, filePath);
      this._processModuleSymbolTable(topLevelSymbols, filePath, word, similarityLimit, isStubFileOrHasInit, abbrFromUsers, aliasMap, results, token);
    });
    this._perfInfo.moduleTimeInMS = this._stopWatch.getDurationInMilliseconds() - startTime;
  }

  private _isStubFileOrHasInit<T>(map: Map<string, T>, filePath: string) {
    const fileDir = getDirPath(filePath);
    const initPathPy = combinePaths(fileDir, '__init__.py');
    const initPathPyi = initPathPy + 'i';
    const isStub = filePath.endsWith('.pyi');
    const hasInit = map.has(initPathPy) || map.has(initPathPyi);
    return { isStub, hasInit };
  }

  private _processModuleSymbolTable(
    topLevelSymbols: ModuleSymbolTable,
    filePath: string,
    word: string,
    similarityLimit: number,
    isStubOrHasInit: { isStub: boolean; hasInit: boolean },
    abbrFromUsers: string | undefined,
    importAliasMap: Map<string, Map<string, ImportAliasData>>,
    results: AutoImportResultMap,
    token: CancellationToken
  ) {
    throwIfCancellationRequested(token);
    const [importSource, importGroup, moduleNameAndType] = this._getImportPartsForSymbols(filePath);
    if (!importSource) {
      return;
    }
    const dotCount = StringUtils.getCharacterCount(importSource, '.');
    topLevelSymbols.forEach((autoImportSymbol, name, library) => {
      throwIfCancellationRequested(token);
      this._perfIndexCount(autoImportSymbol, library);
      if (!this._shouldIncludeVariable(autoImportSymbol, name, isStubOrHasInit.isStub, library)) {
        return;
      }
      const isSimilar = this._isSimilar(word, name, similarityLimit);
      if (!isSimilar) {
        return;
      }
      const alreadyIncluded = this._containsName(name, importSource, results);
      if (alreadyIncluded) {
        return;
      }
      if (autoImportSymbol.importAlias) {
        this._addToImportAliasMap(
          autoImportSymbol.importAlias,
          {
            importParts: {
              symbolName: name,
              importName: name,
              importFrom: importSource,
              filePath,
              dotCount,
              moduleNameAndType,
            },
            importGroup,
            symbol: autoImportSymbol.symbol,
            kind: autoImportSymbol.importAlias.kind,
          },
          importAliasMap
        );
        return;
      }
      const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(importSource, name, abbrFromUsers, name, importGroup, filePath);
      this._addResult(results, {
        name,
        alias: abbrFromUsers,
        symbol: autoImportSymbol.symbol,
        source: importSource,
        kind: convertSymbolKindToCompletionItemKind(autoImportSymbol.kind),
        insertionText: autoImportTextEdits.insertionText,
        edits: autoImportTextEdits.edits,
      });
    });
    if (!isStubOrHasInit.isStub && !isStubOrHasInit.hasInit) {
      return;
    }
    const importParts = this._getImportParts(filePath);
    if (!importParts) {
      return;
    }
    const isSimilar = this._isSimilar(word, importParts.importName, similarityLimit);
    if (!isSimilar) {
      return;
    }
    const alreadyIncluded = this._containsName(importParts.importName, importParts.importFrom, results);
    if (alreadyIncluded) {
      return;
    }
    this._addToImportAliasMap({ modulePath: filePath, originalName: importParts.importName, kind: SymbolKind.Module }, { importParts, importGroup }, importAliasMap);
  }

  private _shouldIncludeVariable(autoImportSymbol: AutoImportSymbol, name: string, isStub: boolean, library: boolean) {
    if (isStub || autoImportSymbol.kind !== SymbolKind.Variable) {
      return true;
    }
    if (this._options.allowVariableInAll && !library && autoImportSymbol.symbol?.isInDunderAll()) {
      return true;
    }
    return SymbolNameUtils.isPublicConstantOrTypeAlias(name);
  }

  private _addImportsFromImportAliasMap(importAliasMap: Map<string, Map<string, ImportAliasData>>, abbrFromUsers: string | undefined, results: AutoImportResultMap, token: CancellationToken) {
    throwIfCancellationRequested(token);
    const startTime = this._stopWatch.getDurationInMilliseconds();
    importAliasMap.forEach((mapPerSymbolName) => {
      this._perfInfo.importAliasCount += mapPerSymbolName.size;
      mapPerSymbolName.forEach((importAliasData) => {
        throwIfCancellationRequested(token);
        if (abbrFromUsers) {
          if (this._importStatements.mapByFilePath.has(importAliasData.importParts.filePath)) {
            return;
          }
          if (importAliasData.importParts.importFrom) {
            const imported = this._importStatements.orderedImports.find((i) => i.moduleName === importAliasData.importParts.importFrom);
            if (imported && imported.node.nodeType === ParseNodeType.ImportFrom && imported.node.imports.some((i) => i.name.value === importAliasData.importParts.symbolName)) {
              return;
            }
          }
        }
        const alreadyIncluded = this._containsName(importAliasData.importParts.importName, importAliasData.importParts.importFrom, results);
        if (alreadyIncluded) {
          return;
        }
        const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
          importAliasData.importParts.importFrom ?? importAliasData.importParts.importName,
          importAliasData.importParts.symbolName,
          abbrFromUsers,
          importAliasData.importParts.importName,
          importAliasData.importGroup,
          importAliasData.importParts.filePath
        );
        this._addResult(results, {
          name: importAliasData.importParts.importName,
          alias: abbrFromUsers,
          symbol: importAliasData.symbol,
          kind: convertSymbolKindToCompletionItemKind(importAliasData.kind),
          source: importAliasData.importParts.importFrom,
          insertionText: autoImportTextEdits.insertionText,
          edits: autoImportTextEdits.edits,
        });
      });
    });

    this._perfInfo.importAliasTimeInMS = this._stopWatch.getDurationInMilliseconds() - startTime;
  }

  private _addToImportAliasMap(alias: IndexAliasData, data: ImportAliasData, importAliasMap: Map<string, Map<string, ImportAliasData>>) {
    if (!importAliasMap.has(alias.modulePath)) {
      const map = new Map<string, ImportAliasData>();
      map.set(alias.originalName, data);
      importAliasMap.set(alias.modulePath, map);
      return;
    }
    const map = importAliasMap.get(alias.modulePath)!;
    if (!map.has(alias.originalName)) {
      map.set(alias.originalName, data);
      return;
    }
    const existingData = map.get(alias.originalName)!;
    const comparison = this._compareImportAliasData(existingData, data);
    if (comparison <= 0) {
      return;
    }
    map.set(alias.originalName, data);
  }

  private _compareImportAliasData(left: ImportAliasData, right: ImportAliasData) {
    const groupComparison = left.importGroup - right.importGroup;
    if (groupComparison !== 0) {
      return groupComparison;
    }
    const dotComparison = left.importParts.dotCount - right.importParts.dotCount;
    if (dotComparison !== 0) {
      return dotComparison;
    }
    if (left.symbol && !right.symbol) {
      return -1;
    }
    if (!left.symbol && right.symbol) {
      return 1;
    }
    return StringUtils.getStringComparer()(left.importParts.importName, right.importParts.importName);
  }

  private _getImportPartsForSymbols(filePath: string): [string | undefined, ImportGroup, ModuleNameAndType] {
    const localImport = this._importStatements.mapByFilePath.get(filePath);
    if (localImport) {
      return [
        localImport.moduleName,
        getImportGroup(localImport),
        {
          importType: ImportType.Local,
          isLocalTypingsFile: false,
          moduleName: localImport.moduleName,
        },
      ];
    } else {
      const moduleNameAndType = this._getModuleNameAndTypeFromFilePath(filePath);
      return [moduleNameAndType.moduleName, this._getImportGroupFromModuleNameAndType(moduleNameAndType), moduleNameAndType];
    }
  }

  private _getImportParts(filePath: string) {
    const name = stripFileExtension(getFileName(filePath));
    if (name === '__init__') {
      return createImportParts(this._getModuleNameAndTypeFromFilePath(getDirPath(filePath)));
    }
    return createImportParts(this._getModuleNameAndTypeFromFilePath(filePath));

    function createImportParts(module: ModuleNameAndType): ImportParts | undefined {
      const moduleName = module.moduleName;
      if (!moduleName) {
        return undefined;
      }
      const index = moduleName.lastIndexOf('.');
      const importNamePart = index > 0 ? moduleName.substring(index + 1) : undefined;
      const importFrom = index > 0 ? moduleName.substring(0, index) : undefined;
      return {
        symbolName: importNamePart,
        importName: importNamePart ?? moduleName,
        importFrom,
        filePath,
        dotCount: StringUtils.getCharacterCount(moduleName, '.'),
        moduleNameAndType: module,
      };
    }
  }

  private _isSimilar(word: string, name: string, similarityLimit: number) {
    if (similarityLimit === 1) {
      return word === name;
    }
    return word.length > 0 && this._options.patternMatcher!(word, name);
  }

  private _containsName(name: string, source: string | undefined, results: AutoImportResultMap) {
    if (this._excludes.has(name)) {
      return true;
    }
    const match = results.get(name);
    if (match?.some((r) => r.source === source)) {
      return true;
    }
    return false;
  }

  private _getModuleNameAndTypeFromFilePath(filePath: string): ModuleNameAndType {
    const startTime = this._stopWatch.getDurationInMilliseconds();
    try {
      return this._importResolver.getModuleNameForImport(filePath, this._execEnvironment);
    } finally {
      const endTime = this._stopWatch.getDurationInMilliseconds();
      this._perfInfo.moduleResolveTimeInMS += endTime - startTime;
    }
  }

  private _getImportGroupFromModuleNameAndType(moduleNameAndType: ModuleNameAndType): ImportGroup {
    let importGroup = ImportGroup.Local;
    if (moduleNameAndType.isLocalTypingsFile || moduleNameAndType.importType === ImportType.ThirdParty) {
      importGroup = ImportGroup.ThirdParty;
    } else if (moduleNameAndType.importType === ImportType.BuiltIn) {
      importGroup = ImportGroup.BuiltIn;
    }
    return importGroup;
  }

  private _getTextEditsForAutoImportByFilePath(
    moduleName: string,
    importName: string | undefined,
    abbrFromUsers: string | undefined,
    insertionText: string,
    importGroup: ImportGroup,
    filePath: string
  ) {
    const startTime = this._stopWatch.getDurationInMilliseconds();
    try {
      return this._getTextEditsForAutoImportByFilePathInternal(moduleName, importName, abbrFromUsers, insertionText, importGroup, filePath);
    } finally {
      const endTime = this._stopWatch.getDurationInMilliseconds();
      this._perfInfo.editTimeInMS += endTime - startTime;
    }
  }

  private _getTextEditsForAutoImportByFilePathInternal(
    moduleName: string,
    importName: string | undefined,
    abbrFromUsers: string | undefined,
    insertionText: string,
    importGroup: ImportGroup,
    filePath: string
  ): { insertionText: string; edits?: TextEditAction[] } {
    const importStatement = this._importStatements.mapByFilePath.get(filePath);
    if (importStatement) {
      if (importStatement.node.nodeType === ParseNodeType.Import) {
        const importAlias = importStatement.subnode?.alias?.value;
        if (importName) {
          return {
            insertionText: `${importAlias ?? importStatement.moduleName}.${importName}`,
            edits: [],
          };
        } else if (importAlias) {
          return {
            insertionText: `${importAlias}`,
            edits: [],
          };
        }
      }
      if (importName && importStatement.node.nodeType === ParseNodeType.ImportFrom) {
        const importNode = importStatement.node.imports.find((i) => i.name.value === importName);
        if (importNode) {
          const importAlias = importNode.alias?.value;
          return {
            insertionText: `${importAlias ?? importName}`,
            edits: [],
          };
        }
        if (moduleName === importStatement.moduleName) {
          return {
            insertionText: abbrFromUsers ?? insertionText,
            edits: this._options.lazyEdit ? undefined : getTextEditsForAutoImportSymbolAddition(importName, importStatement, this._parseResults, abbrFromUsers),
          };
        }
      }
    } else if (importName) {
      const imported = this._importStatements.orderedImports.find((i) => i.moduleName === moduleName);
      if (imported && imported.node.nodeType === ParseNodeType.ImportFrom) {
        const importFrom = imported.node.imports.find((i) => i.name.value === importName);
        if (importFrom) {
          const importAlias = importFrom.alias?.value;
          if (importAlias) {
            return {
              insertionText: `${importAlias}`,
              edits: [],
            };
          }
        } else {
          return {
            insertionText: abbrFromUsers ?? insertionText,
            edits: this._options.lazyEdit ? undefined : getTextEditsForAutoImportSymbolAddition(importName, imported, this._parseResults, abbrFromUsers),
          };
        }
      }
      const importFrom = this._importStatements.implicitImports?.get(filePath);
      if (importFrom) {
        const importAlias = importFrom.alias?.value;
        return {
          insertionText: `${importAlias ?? importFrom.name.value}.${importName}`,
          edits: [],
        };
      }
    }
    return {
      insertionText: abbrFromUsers ?? insertionText,
      edits: this._options.lazyEdit
        ? undefined
        : getTextEditsForAutoImportInsertion(importName, this._importStatements, moduleName, importGroup, this._parseResults, this._invocationPosition, abbrFromUsers),
    };
  }

  private _perfIndexCount(autoImportSymbol: AutoImportSymbol, library: boolean) {
    if (autoImportSymbol.symbol) {
      this._perfInfo.symbolCount++;
    } else if (library) {
      this._perfInfo.indexCount++;
    } else {
      this._perfInfo.userIndexCount++;
    }
  }

  private _addResult(results: AutoImportResultMap, result: AutoImportResult) {
    let entries = results.get(result.name);
    if (!entries) {
      entries = [];
      results.set(result.name, entries);
    }
    entries.push(result);
  }
}

function createModuleSymbolTableFromIndexResult(indexResults: IndexResults, library: boolean): ModuleSymbolTable {
  return {
    forEach(callbackfn: (value: AutoImportSymbol, key: string, library: boolean) => void): void {
      indexResults.symbols.forEach((data) => {
        if (!data.externallyVisible) {
          return;
        }
        callbackfn(
          {
            importAlias: data.alias,
            kind: data.kind,
          },
          data.name,
          library
        );
      });
    },
  };
}

function convertSymbolKindToCompletionItemKind(kind: SymbolKind | undefined) {
  switch (kind) {
    case SymbolKind.File:
      return CompletionItemKind.File;

    case SymbolKind.Module:
    case SymbolKind.Namespace:
      return CompletionItemKind.Module;

    case SymbolKind.Package:
      return CompletionItemKind.Folder;

    case SymbolKind.Class:
      return CompletionItemKind.Class;

    case SymbolKind.Method:
      return CompletionItemKind.Method;

    case SymbolKind.Property:
      return CompletionItemKind.Property;

    case SymbolKind.Field:
      return CompletionItemKind.Field;

    case SymbolKind.Constructor:
      return CompletionItemKind.Constructor;

    case SymbolKind.Enum:
      return CompletionItemKind.Enum;

    case SymbolKind.Interface:
      return CompletionItemKind.Interface;

    case SymbolKind.Function:
      return CompletionItemKind.Function;

    case SymbolKind.Variable:
    case SymbolKind.Array:
      return CompletionItemKind.Variable;

    case SymbolKind.String:
      return CompletionItemKind.Constant;

    case SymbolKind.Number:
    case SymbolKind.Boolean:
      return CompletionItemKind.Value;

    case SymbolKind.Constant:
    case SymbolKind.Null:
      return CompletionItemKind.Constant;

    case SymbolKind.Object:
    case SymbolKind.Key:
      return CompletionItemKind.Value;

    case SymbolKind.EnumMember:
      return CompletionItemKind.EnumMember;

    case SymbolKind.Struct:
      return CompletionItemKind.Struct;

    case SymbolKind.Event:
      return CompletionItemKind.Event;

    case SymbolKind.Operator:
      return CompletionItemKind.Operator;

    case SymbolKind.TypeParameter:
      return CompletionItemKind.TypeParameter;

    default:
      return undefined;
  }
}
