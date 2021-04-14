import { CancellationToken, CompletionItem, DocumentHighlight, DocumentSymbol, MarkupKind } from 'vscode-languageserver';
import { TextDocument, TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import { isMainThread } from 'worker_threads';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { OpCanceledException } from '../common/cancellationUtils';
import { ConfigOptions, ExecutionEnvironment, getBasicDiagRuleSet } from '../common/configOptions';
import { Console, StdConsole } from '../common/console';
import { assert } from '../common/debug';
import { convertLevelToCategory, Diag, DiagCategory } from '../common/diagnostic';
import { DiagSink, TextRangeDiagSink } from '../common/diagnosticSink';
import { TextEditAction } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import { LogTracker } from '../common/logTracker';
import { getFileName, normalizeSlashes, stripFileExtension } from '../common/pathUtils';
import * as StringUtils from '../common/stringUtils';
import { DocumentRange, getEmptyRange, Position, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { timingStats } from '../common/timing';
import { ModuleSymbolMap } from '../languageService/autoImporter';
import { AbbreviationMap, CompletionOptions, CompletionResults } from '../languageService/completionProvider';
import { CompletionItemData, CompletionProvider } from '../languageService/completionProvider';
import { DefinitionFilter, DefinitionProvider } from '../languageService/definitionProvider';
import { DocumentHighlightProvider } from '../languageService/documentHighlightProvider';
import { DocumentSymbolProvider, IndexOptions, IndexResults } from '../languageService/documentSymbolProvider';
import { HoverProvider, HoverResults } from '../languageService/hoverProvider';
import { performQuickAction } from '../languageService/quickActions';
import { ReferenceCallback, ReferencesProvider, ReferencesResult } from '../languageService/referencesProvider';
import { SignatureHelpProvider, SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { Localizer } from '../localization/localize';
import { ModuleNode } from '../parser/parseNodes';
import { ModuleImport, ParseOptions, Parser, ParseResults } from '../parser/parser';
import { Token } from '../parser/tokenizerTypes';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { AnalyzerFileInfo, ImportLookup } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Binder, BinderResults } from './binder';
import { Checker } from './checker';
import { CircularDependency } from './circularDependency';
import * as CommentUtils from './commentUtils';
import { ImportResolver } from './importResolver';
import { ImportResult } from './importResult';
import { ParseTreeCleanerWalker } from './parseTreeCleaner';
import { Scope } from './scope';
import { SourceMapper } from './sourceMapper';
import { SymbolTable } from './symbol';
import { TestWalker } from './testWalker';
import { TypeEvaluator } from './typeEvaluator';
const _maxImportCyclesPerFile = 4;
interface ResolveImportResult {
  imports: ImportResult[];
  builtinsImportResult?: ImportResult;
  typingModulePath?: string;
  typeshedModulePath?: string;
  collectionsModulePath?: string;
}
export class SourceFile {
  private _console: Console;
  private readonly _filePath: string;
  private readonly _moduleName: string;
  private readonly _isStubFile: boolean;
  private readonly _isThirdPartyImport: boolean;
  private readonly _isTypingStubFile: boolean;
  private readonly _isTypingExtensionsStubFile: boolean;
  private readonly _isBuiltInStubFile: boolean;
  private readonly _isThirdPartyPyTypedPresent: boolean;
  private _isFileDeleted = false;
  private _diagnosticVersion = 0;
  private _fileContentsVersion = 0;
  private _lastFileContentLength: number | undefined = undefined;
  private _lastFileContentHash: number | undefined = undefined;
  private _clientDocument?: TextDocument;
  private _analyzedFileContentsVersion = -1;
  private _parseTreeNeedsCleaning = false;
  private _parseResults?: ParseResults;
  private _moduleSymbolTable?: SymbolTable;
  private _binderResults?: BinderResults;
  private _cachedIndexResults?: IndexResults;
  private _isBindingInProgress = false;
  private _parseDiags: Diag[] = [];
  private _bindDiags: Diag[] = [];
  private _checkerDiags: Diag[] = [];
  private _diagnosticRuleSet = getBasicDiagRuleSet();
  private _circularDependencies: CircularDependency[] = [];
  private _hitMaxImportDepth?: number;
  private _isBindingNeeded = true;
  private _isCheckingNeeded = true;
  private _indexingNeeded = true;
  private _imports?: ImportResult[];
  private _builtinsImport?: ImportResult;
  private _typingModulePath?: string;
  private _typeshedModulePath?: string;
  private _collectionsModulePath?: string;
  private _logTracker: LogTracker;
  readonly fileSystem: FileSystem;
  constructor(fs: FileSystem, filePath: string, moduleName: string, isThirdPartyImport: boolean, isThirdPartyPyTypedPresent: boolean, console?: Console, logTracker?: LogTracker) {
    this.fileSystem = fs;
    this._console = console || new StdConsole();
    this._filePath = filePath;
    this._moduleName = moduleName;
    this._isStubFile = filePath.endsWith('.pyi');
    this._isThirdPartyImport = isThirdPartyImport;
    this._isThirdPartyPyTypedPresent = isThirdPartyPyTypedPresent;
    const fileName = getFileName(filePath);
    this._isTypingStubFile = this._isStubFile && (this._filePath.endsWith(normalizeSlashes('stdlib/typing.pyi')) || fileName === 'typing_extensions.pyi');
    this._isTypingExtensionsStubFile = this._isStubFile && fileName === 'typing_extensions.pyi';
    this._isBuiltInStubFile = false;
    if (this._isStubFile) {
      if (
        this._filePath.endsWith(normalizeSlashes('stdlib/collections/__init__.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/asyncio/futures.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/builtins.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/_importlib_modulespec.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/dataclasses.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/abc.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/enum.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/queue.pyi')) ||
        this._filePath.endsWith(normalizeSlashes('stdlib/types.pyi'))
      ) {
        this._isBuiltInStubFile = true;
      }
    }
    this._logTracker = logTracker ?? new LogTracker(console, isMainThread ? 'FG' : 'BG');
  }
  getFilePath(): string {
    return this._filePath;
  }
  getDiagVersion(): number {
    return this._diagnosticVersion;
  }
  isStubFile() {
    return this._isStubFile;
  }
  getDiags(options: ConfigOptions, prevDiagVersion?: number): Diag[] | undefined {
    if (this._diagnosticVersion === prevDiagVersion) {
      return undefined;
    }
    let includeWarningsAndErrors = true;
    if (this._isThirdPartyImport) {
      includeWarningsAndErrors = false;
    }
    let diagList: Diag[] = [];
    diagList = diagList.concat(this._parseDiags, this._bindDiags, this._checkerDiags);
    if (options.diagnosticRuleSet.enableTypeIgnoreComments) {
      const typeIgnoreLines = this._parseResults ? this._parseResults.tokenizerOutput.typeIgnoreLines : {};
      if (Object.keys(typeIgnoreLines).length > 0) {
        diagList = diagList.filter((d) => {
          if (d.category !== DiagCategory.UnusedCode) {
            for (let line = d.range.start.line; line <= d.range.end.line; line++) {
              if (typeIgnoreLines[line]) {
                return false;
              }
            }
          }
          return true;
        });
      }
    }
    if (options.diagnosticRuleSet.reportImportCycles !== 'none' && this._circularDependencies.length > 0) {
      const category = convertLevelToCategory(options.diagnosticRuleSet.reportImportCycles);
      this._circularDependencies.forEach((cirDep) => {
        diagList.push(
          new Diag(
            category,
            Localizer.Diag.importCycleDetected() +
              '\n' +
              cirDep
                .getPaths()
                .map((path) => '  ' + path)
                .join('\n'),
            getEmptyRange()
          )
        );
      });
    }
    if (this._hitMaxImportDepth !== undefined) {
      diagList.push(new Diag(DiagCategory.Error, Localizer.Diag.importDepthExceeded().format({ depth: this._hitMaxImportDepth }), getEmptyRange()));
    }
    if (options.ignore.find((ignoreFileSpec) => ignoreFileSpec.regExp.test(this._filePath))) {
      diagList = [];
    }
    if (options.diagnosticRuleSet.enableTypeIgnoreComments) {
      if (this._parseResults && this._parseResults.tokenizerOutput.typeIgnoreAll) {
        diagList = [];
      }
    }
    if (!includeWarningsAndErrors) {
      diagList = diagList.filter((diag) => diag.category === DiagCategory.UnusedCode);
    }
    return diagList;
  }
  getImports(): ImportResult[] {
    return this._imports || [];
  }
  getBuiltinsImport(): ImportResult | undefined {
    return this._builtinsImport;
  }
  getModuleSymbolTable(): SymbolTable | undefined {
    return this._moduleSymbolTable;
  }
  getModuleDocString(): string | undefined {
    return this._binderResults ? this._binderResults.moduleDocString : undefined;
  }
  didContentsChangeOnDisk(): boolean {
    if (this._clientDocument) {
      return false;
    }
    if (this._lastFileContentLength === undefined) {
      return false;
    }
    try {
      const fileContents = this.fileSystem.readFileSync(this._filePath, 'utf8');
      if (fileContents.length !== this._lastFileContentLength) {
        return true;
      }
      if (StringUtils.hashString(fileContents) !== this._lastFileContentHash) {
        return true;
      }
    } catch (error) {
      return true;
    }
    return false;
  }
  dropParseAndBindInfo(): void {
    this._parseResults = undefined;
    this._moduleSymbolTable = undefined;
    this._isBindingNeeded = true;
    this._binderResults = undefined;
  }
  markDirty(): void {
    this._fileContentsVersion++;
    this._isCheckingNeeded = true;
    this._isBindingNeeded = true;
    this._indexingNeeded = true;
    this._moduleSymbolTable = undefined;
    this._binderResults = undefined;
    this._cachedIndexResults = undefined;
  }
  markReanalysisRequired(): void {
    this._isCheckingNeeded = true;
    if (this._parseResults) {
      if (this._parseResults.containsWildcardImport || AnalyzerNodeInfo.getDunderAllNames(this._parseResults.parseTree)) {
        this._parseTreeNeedsCleaning = true;
        this._isBindingNeeded = true;
        this._indexingNeeded = true;
        this._moduleSymbolTable = undefined;
        this._binderResults = undefined;
        this._cachedIndexResults = undefined;
      }
    }
  }
  getClientVersion() {
    return this._clientDocument?.version;
  }
  getFileContents() {
    return this._clientDocument?.getText();
  }
  setClientVersion(version: number | null, contents: TextDocumentContentChangeEvent[]): void {
    if (version === null) {
      this._clientDocument = undefined;
    } else {
      if (!this._clientDocument) {
        this._clientDocument = TextDocument.create(this._filePath, 'python', version, '');
      }
      this._clientDocument = TextDocument.update(this._clientDocument, contents, version);
      this.markDirty();
    }
  }
  prepareForClose() {}
  isFileDeleted() {
    return this._isFileDeleted;
  }
  isParseRequired() {
    return !this._parseResults || this._analyzedFileContentsVersion !== this._fileContentsVersion;
  }
  isBindingRequired() {
    if (this._isBindingInProgress) {
      return false;
    }
    if (this.isParseRequired()) {
      return true;
    }
    return this._isBindingNeeded;
  }
  isIndexingRequired() {
    return this._indexingNeeded;
  }
  isCheckingRequired() {
    return this._isCheckingNeeded;
  }
  getParseResults(): ParseResults | undefined {
    if (!this.isParseRequired()) {
      return this._parseResults;
    }
    return undefined;
  }
  getCachedIndexResults(): IndexResults | undefined {
    return this._cachedIndexResults;
  }
  cacheIndexResults(indexResults: IndexResults) {
    this._cachedIndexResults = indexResults;
  }
  addCircularDependency(circDependency: CircularDependency) {
    let updatedDependencyList = false;
    if (this._circularDependencies.length < _maxImportCyclesPerFile) {
      if (!this._circularDependencies.some((dep) => dep.isEqual(circDependency))) {
        this._circularDependencies.push(circDependency);
        updatedDependencyList = true;
      }
    }
    if (updatedDependencyList) {
      this._diagnosticVersion++;
    }
  }
  setHitMaxImportDepth(maxImportDepth: number) {
    this._hitMaxImportDepth = maxImportDepth;
  }
  parse(configOptions: ConfigOptions, importResolver: ImportResolver, content?: string): boolean {
    return this._logTracker.log(`parsing: ${this._getPathForLogging(this._filePath)}`, (logState) => {
      if (!this.isParseRequired()) {
        logState.suppress();
        return false;
      }
      const diagSink = new DiagSink();
      let fileContents = this.getFileContents();
      if (fileContents === undefined) {
        try {
          const startTime = timingStats.readFileTime.totalTime;
          timingStats.readFileTime.timeOp(() => {
            fileContents = content ?? this.fileSystem.readFileSync(this._filePath, 'utf8');
            this._lastFileContentLength = fileContents.length;
            this._lastFileContentHash = StringUtils.hashString(fileContents);
          });
          logState.add(`fs read ${timingStats.readFileTime.totalTime - startTime}ms`);
        } catch (error) {
          diagSink.addError(`Source file could not be read`, getEmptyRange());
          fileContents = '';
          if (!this.fileSystem.existsSync(this._filePath)) {
            this._isFileDeleted = true;
          }
        }
      }
      const execEnvironment = configOptions.findExecEnvironment(this._filePath);
      const parseOptions = new ParseOptions();
      if (this._filePath.endsWith('pyi')) {
        parseOptions.isStubFile = true;
      }
      parseOptions.pythonVersion = execEnvironment.pythonVersion;
      try {
        const parser = new Parser();
        const parseResults = parser.parseSourceFile(fileContents!, parseOptions, diagSink);
        assert(parseResults !== undefined && parseResults.tokenizerOutput !== undefined);
        this._parseResults = parseResults;
        timingStats.resolveImportsTime.timeOp(() => {
          const importResult = this._resolveImports(importResolver, parseResults.importedModules, execEnvironment);
          this._imports = importResult.imports;
          this._builtinsImport = importResult.builtinsImportResult;
          this._typingModulePath = importResult.typingModulePath;
          this._typeshedModulePath = importResult.typeshedModulePath;
          this._collectionsModulePath = importResult.collectionsModulePath;
          this._parseDiags = diagSink.fetchAndClear();
        });
        const useStrict = configOptions.strict.find((strictFileSpec) => strictFileSpec.regExp.test(this._filePath)) !== undefined;
        this._diagnosticRuleSet = CommentUtils.getFileLevelDirectives(this._parseResults.tokenizerOutput.tokens, configOptions.diagnosticRuleSet, useStrict);
      } catch (e) {
        const message: string = (e.stack ? e.stack.toString() : undefined) || (typeof e.message === 'string' ? e.message : undefined) || JSON.stringify(e);
        this._console.error(Localizer.Diag.internalParseError().format({ file: this.getFilePath(), message }));
        this._parseResults = {
          text: '',
          parseTree: ModuleNode.create({ start: 0, length: 0 }),
          importedModules: [],
          futureImports: new Map<string, boolean>(),
          tokenizerOutput: {
            tokens: new TextRangeCollection<Token>([]),
            lines: new TextRangeCollection<TextRange>([]),
            typeIgnoreAll: false,
            typeIgnoreLines: {},
            predominantEndOfLineSequence: '\n',
            predominantTabSequence: '    ',
            predominantSingleQuoteCharacter: "'",
          },
          containsWildcardImport: false,
        };
        this._imports = undefined;
        this._builtinsImport = undefined;
        const diagSink = new DiagSink();
        diagSink.addError(Localizer.Diag.internalParseError().format({ file: this.getFilePath(), message }), getEmptyRange());
        this._parseDiags = diagSink.fetchAndClear();
      }
      this._analyzedFileContentsVersion = this._fileContentsVersion;
      this._indexingNeeded = true;
      this._isBindingNeeded = true;
      this._isCheckingNeeded = true;
      this._parseTreeNeedsCleaning = false;
      this._hitMaxImportDepth = undefined;
      this._diagnosticVersion++;
      return true;
    });
  }
  index(options: IndexOptions, token: CancellationToken): IndexResults | undefined {
    return this._logTracker.log(`indexing: ${this._getPathForLogging(this._filePath)}`, (ls) => {
      if (!this._parseResults || !this.isIndexingRequired()) {
        ls.suppress();
        return undefined;
      }
      this._indexingNeeded = false;
      const symbols = DocumentSymbolProvider.indexSymbols(AnalyzerNodeInfo.getFileInfo(this._parseResults.parseTree)!, this._parseResults, options, token);
      ls.add(`found ${symbols.length}`);
      const name = stripFileExtension(getFileName(this._filePath));
      const privateOrProtected = SymbolNameUtils.isPrivateOrProtectedName(name);
      return { privateOrProtected, symbols };
    });
  }
  getDefinitionsForPosition(sourceMapper: SourceMapper, position: Position, filter: DefinitionFilter, evaluator: TypeEvaluator, token: CancellationToken): DocumentRange[] | undefined {
    if (!this._parseResults) {
      return undefined;
    }
    return DefinitionProvider.getDefinitionsForPosition(sourceMapper, this._parseResults, position, filter, evaluator, token);
  }
  getDeclarationForPosition(sourceMapper: SourceMapper, position: Position, evaluator: TypeEvaluator, reporter: ReferenceCallback | undefined, token: CancellationToken): ReferencesResult | undefined {
    if (!this._parseResults) {
      return undefined;
    }
    return ReferencesProvider.getDeclarationForPosition(sourceMapper, this._parseResults, this._filePath, position, evaluator, reporter, token);
  }
  addReferences(referencesResult: ReferencesResult, includeDeclaration: boolean, evaluator: TypeEvaluator, token: CancellationToken): void {
    if (!this._parseResults) return;
    ReferencesProvider.addReferences(this._parseResults, this._filePath, referencesResult, includeDeclaration, evaluator, token);
  }
  addHierarchicalSymbolsForDocument(symbolList: DocumentSymbol[], token: CancellationToken) {
    if (!this._parseResults && !this._cachedIndexResults) return;
    DocumentSymbolProvider.addHierarchicalSymbolsForDocument(
      this._parseResults ? AnalyzerNodeInfo.getFileInfo(this._parseResults.parseTree) : undefined,
      this.getCachedIndexResults(),
      this._parseResults,
      symbolList,
      token
    );
  }
  getSymbolsForDocument(query: string, token: CancellationToken) {
    if (!this._parseResults && !this._cachedIndexResults) {
      return [];
    }
    return DocumentSymbolProvider.getSymbolsForDocument(
      this._parseResults ? AnalyzerNodeInfo.getFileInfo(this._parseResults.parseTree) : undefined,
      this.getCachedIndexResults(),
      this._parseResults,
      this._filePath,
      query,
      token
    );
  }
  getHoverForPosition(sourceMapper: SourceMapper, position: Position, format: MarkupKind, evaluator: TypeEvaluator, token: CancellationToken): HoverResults | undefined {
    if (this._isBindingNeeded || !this._parseResults) {
      return undefined;
    }
    return HoverProvider.getHoverForPosition(sourceMapper, this._parseResults, position, format, evaluator, token);
  }
  getDocumentHighlight(sourceMapper: SourceMapper, position: Position, evaluator: TypeEvaluator, token: CancellationToken): DocumentHighlight[] | undefined {
    if (this._isBindingNeeded || !this._parseResults) {
      return undefined;
    }
    return DocumentHighlightProvider.getDocumentHighlight(this._parseResults, position, evaluator, token);
  }
  getSignatureHelpForPosition(position: Position, importLookup: ImportLookup, evaluator: TypeEvaluator, format: MarkupKind, token: CancellationToken): SignatureHelpResults | undefined {
    if (!this._parseResults) {
      return undefined;
    }
    return SignatureHelpProvider.getSignatureHelpForPosition(this._parseResults, position, evaluator, format, token);
  }
  getCompletionsForPosition(
    position: Position,
    workspacePath: string,
    configOptions: ConfigOptions,
    importResolver: ImportResolver,
    importLookup: ImportLookup,
    evaluator: TypeEvaluator,
    options: CompletionOptions,
    sourceMapper: SourceMapper,
    nameMap: AbbreviationMap | undefined,
    libraryMap: Map<string, IndexResults> | undefined,
    moduleSymbolsCallback: () => ModuleSymbolMap,
    token: CancellationToken
  ): CompletionResults | undefined {
    if (!this._parseResults) {
      return undefined;
    }
    const fileContents = this.getFileContents();
    if (fileContents === undefined) {
      return undefined;
    }
    const completionProvider = new CompletionProvider(
      workspacePath,
      this._parseResults,
      fileContents,
      importResolver,
      position,
      this._filePath,
      configOptions,
      importLookup,
      evaluator,
      options,
      sourceMapper,
      {
        nameMap,
        libraryMap,
        getModuleSymbolsMap: moduleSymbolsCallback,
      },
      token
    );
    return completionProvider.getCompletionsForPosition();
  }
  resolveCompletionItem(
    configOptions: ConfigOptions,
    importResolver: ImportResolver,
    importLookup: ImportLookup,
    evaluator: TypeEvaluator,
    options: CompletionOptions,
    sourceMapper: SourceMapper,
    nameMap: AbbreviationMap | undefined,
    libraryMap: Map<string, IndexResults> | undefined,
    moduleSymbolsCallback: () => ModuleSymbolMap,
    completionItem: CompletionItem,
    token: CancellationToken
  ) {
    const fileContents = this.getFileContents();
    if (!this._parseResults || fileContents === undefined) return;
    const completionData = completionItem.data as CompletionItemData;
    const completionProvider = new CompletionProvider(
      completionData.workspacePath,
      this._parseResults,
      fileContents,
      importResolver,
      completionData.position,
      this._filePath,
      configOptions,
      importLookup,
      evaluator,
      options,
      sourceMapper,
      {
        nameMap,
        libraryMap,
        getModuleSymbolsMap: moduleSymbolsCallback,
      },
      token
    );
    completionProvider.resolveCompletionItem(completionItem);
  }
  performQuickAction(command: string, args: any[], token: CancellationToken): TextEditAction[] | undefined {
    if (!this._parseResults) {
      return undefined;
    }
    if (this.getClientVersion() === undefined) {
      return undefined;
    }
    return performQuickAction(command, args, this._parseResults, token);
  }
  bind(configOptions: ConfigOptions, importLookup: ImportLookup, builtinsScope: Scope | undefined) {
    assert(!this.isParseRequired());
    assert(this.isBindingRequired());
    assert(!this._isBindingInProgress);
    assert(this._parseResults !== undefined);
    return this._logTracker.log(`binding: ${this._getPathForLogging(this._filePath)}`, () => {
      try {
        timingStats.bindTime.timeOp(() => {
          this._cleanParseTreeIfRequired();
          const fileInfo = this._buildFileInfo(configOptions, this._parseResults!.text, importLookup, builtinsScope);
          AnalyzerNodeInfo.setFileInfo(this._parseResults!.parseTree, fileInfo);
          const binder = new Binder(fileInfo);
          this._isBindingInProgress = true;
          this._binderResults = binder.bindModule(this._parseResults!.parseTree);
          if (configOptions.internalTestMode) {
            const testWalker = new TestWalker();
            testWalker.walk(this._parseResults!.parseTree);
          }
          this._bindDiags = fileInfo.diagnosticSink.fetchAndClear();
          const moduleScope = AnalyzerNodeInfo.getScope(this._parseResults!.parseTree);
          assert(moduleScope !== undefined);
          this._moduleSymbolTable = moduleScope!.symbolTable;
        });
      } catch (e) {
        const message: string = (e.stack ? e.stack.toString() : undefined) || (typeof e.message === 'string' ? e.message : undefined) || JSON.stringify(e);
        this._console.error(Localizer.Diag.internalBindError().format({ file: this.getFilePath(), message }));
        const diagSink = new DiagSink();
        diagSink.addError(Localizer.Diag.internalBindError().format({ file: this.getFilePath(), message }), getEmptyRange());
        this._bindDiags = diagSink.fetchAndClear();
      } finally {
        this._isBindingInProgress = false;
      }
      this._diagnosticVersion++;
      this._isCheckingNeeded = true;
      this._indexingNeeded = true;
      this._isBindingNeeded = false;
    });
  }
  check(evaluator: TypeEvaluator) {
    assert(!this.isParseRequired());
    assert(!this.isBindingRequired());
    assert(!this._isBindingInProgress);
    assert(this.isCheckingRequired());
    assert(this._parseResults !== undefined);
    return this._logTracker.log(`checking: ${this._getPathForLogging(this._filePath)}`, () => {
      try {
        timingStats.typeCheckerTime.timeOp(() => {
          const checker = new Checker(this._parseResults!.parseTree, evaluator);
          checker.check();
          this._isCheckingNeeded = false;
          const fileInfo = AnalyzerNodeInfo.getFileInfo(this._parseResults!.parseTree)!;
          this._checkerDiags = fileInfo.diagnosticSink.fetchAndClear();
        });
      } catch (e) {
        const isCancellation = OpCanceledException.is(e);
        if (!isCancellation) {
          const message: string = (e.stack ? e.stack.toString() : undefined) || (typeof e.message === 'string' ? e.message : undefined) || JSON.stringify(e);
          this._console.error(Localizer.Diag.internalTypeCheckingError().format({ file: this.getFilePath(), message }));
          const diagSink = new DiagSink();
          diagSink.addError(Localizer.Diag.internalTypeCheckingError().format({ file: this.getFilePath(), message }), getEmptyRange());
          this._checkerDiags = diagSink.fetchAndClear();
          this._isCheckingNeeded = false;
        }
        throw e;
      } finally {
        this._circularDependencies = [];
        this._diagnosticVersion++;
      }
    });
  }
  private _buildFileInfo(configOptions: ConfigOptions, fileContents: string, importLookup: ImportLookup, builtinsScope?: Scope) {
    assert(this._parseResults !== undefined);
    const analysisDiags = new TextRangeDiagSink(this._parseResults!.tokenizerOutput.lines);
    const fileInfo: AnalyzerFileInfo = {
      importLookup,
      futureImports: this._parseResults!.futureImports,
      builtinsScope,
      typingModulePath: this._typingModulePath,
      typeshedModulePath: this._typeshedModulePath,
      collectionsModulePath: this._collectionsModulePath,
      diagnosticSink: analysisDiags,
      executionEnvironment: configOptions.findExecEnvironment(this._filePath),
      diagnosticRuleSet: this._diagnosticRuleSet,
      fileContents,
      lines: this._parseResults!.tokenizerOutput.lines,
      filePath: this._filePath,
      moduleName: this._moduleName,
      isStubFile: this._isStubFile,
      isTypingStubFile: this._isTypingStubFile,
      isTypingExtensionsStubFile: this._isTypingExtensionsStubFile,
      isBuiltInStubFile: this._isBuiltInStubFile,
      isInPyTypedPackage: this._isThirdPartyPyTypedPresent,
      accessedSymbolMap: new Map<number, true>(),
    };
    return fileInfo;
  }
  private _cleanParseTreeIfRequired() {
    if (this._parseResults) {
      if (this._parseTreeNeedsCleaning) {
        const cleanerWalker = new ParseTreeCleanerWalker(this._parseResults.parseTree);
        cleanerWalker.clean();
        this._parseTreeNeedsCleaning = false;
      }
    }
  }
  private _resolveImports(importResolver: ImportResolver, moduleImports: ModuleImport[], execEnv: ExecutionEnvironment): ResolveImportResult {
    const imports: ImportResult[] = [];
    let builtinsImportResult: ImportResult | undefined = importResolver.resolveImport(this._filePath, execEnv, {
      leadingDots: 0,
      nameParts: ['builtins'],
      importedSymbols: undefined,
    });
    if (builtinsImportResult.resolvedPaths.length === 0 || builtinsImportResult.resolvedPaths[0] !== this.getFilePath()) {
      imports.push(builtinsImportResult);
    } else {
      builtinsImportResult = undefined;
    }
    const typingImportResult: ImportResult | undefined = importResolver.resolveImport(this._filePath, execEnv, {
      leadingDots: 0,
      nameParts: ['typing'],
      importedSymbols: undefined,
    });
    let typingModulePath: string | undefined;
    if (typingImportResult.resolvedPaths.length === 0 || typingImportResult.resolvedPaths[0] !== this.getFilePath()) {
      imports.push(typingImportResult);
      typingModulePath = typingImportResult.resolvedPaths[0];
    }
    const typeshedImportResult: ImportResult | undefined = importResolver.resolveImport(this._filePath, execEnv, {
      leadingDots: 0,
      nameParts: ['_typeshed'],
      importedSymbols: undefined,
    });
    let typeshedModulePath: string | undefined;
    if (typeshedImportResult.resolvedPaths.length === 0 || typeshedImportResult.resolvedPaths[0] !== this.getFilePath()) {
      imports.push(typeshedImportResult);
      typeshedModulePath = typeshedImportResult.resolvedPaths[0];
    }
    let collectionsModulePath: string | undefined;
    for (const moduleImport of moduleImports) {
      const importResult = importResolver.resolveImport(this._filePath, execEnv, {
        leadingDots: moduleImport.leadingDots,
        nameParts: moduleImport.nameParts,
        importedSymbols: moduleImport.importedSymbols,
      });
      if (importResult.isImportFound && importResult.isTypeshedFile) {
        if (moduleImport.nameParts.length >= 1 && moduleImport.nameParts[0] === 'collections') {
          collectionsModulePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
        }
      }
      imports.push(importResult);
      AnalyzerNodeInfo.setImportInfo(moduleImport.nameNode, importResult);
    }
    return {
      imports,
      builtinsImportResult,
      typingModulePath,
      typeshedModulePath,
      collectionsModulePath,
    };
  }
  private _getPathForLogging(filepath: string) {
    if (!(this.fileSystem instanceof PyrightFileSystem) || !this.fileSystem.isMappedFilePath(filepath)) {
      return filepath;
    }
    return '[virtual] ' + filepath;
  }
}
