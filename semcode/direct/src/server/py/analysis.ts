import { AnalysisCompleteCallback, AnalysisResults, analyzeProgram, nullCallback } from './analyzer/analysis';
import { CancellationToken } from 'vscode-languageserver/node';
import { ConfigOptions } from './common/configOptions';
import { Console, log, LogLevel } from './common/console';
import { createFromRealFileSystem, FileSystem } from './common/fileSystem';
import { Diag } from './common/diagnostic';
import { disposeCancellationToken, getCancellationTokenFromId, getCancellationTokenId, throwIfCancellationRequested } from './common/cancellationUtils';
import { FileDiags } from './common/diagnosticSink';
import { FileSpec } from './common/pathUtils';
import { ImportResolver } from './analyzer/importResolver';
import { IndexResults } from './languageService/documentSymbolProvider';
import { Indices, Program } from './analyzer/program';
import { LangServiceExtension } from './common/extensibility';
import { LogTracker } from './common/logTracker';
import { MessageChannel, MessagePort, parentPort, threadId, Worker, workerData } from 'worker_threads';
import { OpCanceledException, setCancellationFolderName } from './common/cancellationUtils';
import { PyrightFileSystem } from './fileSystem';
import { Range } from './common/textRange';
import { TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import * as debug from './common/debug';
import { getCancellationFolderName } from './common/cancellationUtils';

export class BackgroundThreadBase {
  protected fs: FileSystem;

  protected constructor(data: InitializationData) {
    setCancellationFolderName(data.cancellationFolderName);
    (global as any).__rootDir = data.rootDir;
    this.fs = new PyrightFileSystem(createFromRealFileSystem(this.getConsole()));
  }

  protected log(level: LogLevel, msg: string) {
    parentPort?.postMessage({ requestType: 'log', data: { level: level, message: msg } });
  }

  protected getConsole() {
    return {
      log: (msg: string) => {
        this.log(LogLevel.Log, msg);
      },
      info: (msg: string) => {
        this.log(LogLevel.Info, msg);
      },
      warn: (msg: string) => {
        this.log(LogLevel.Warn, msg);
      },
      error: (msg: string) => {
        this.log(LogLevel.Error, msg);
      },
      level: LogLevel.Log,
    };
  }
}

export function createConfigOptionsFrom(jsonObject: any): ConfigOptions {
  const configOptions = new ConfigOptions(jsonObject.projectRoot);
  const getFileSpec = (fileSpec: any): FileSpec => {
    return { wildcardRoot: fileSpec.wildcardRoot, regExp: new RegExp(fileSpec.regExp.source) };
  };

  configOptions.pythonPath = jsonObject.pythonPath;
  configOptions.typeshedPath = jsonObject.typeshedPath;
  configOptions.stubPath = jsonObject.stubPath;
  configOptions.autoExcludeVenv = jsonObject.autoExcludeVenv;
  configOptions.verboseOutput = jsonObject.verboseOutput;
  configOptions.checkOnlyOpenFiles = jsonObject.checkOnlyOpenFiles;
  configOptions.useLibraryCodeForTypes = jsonObject.useLibraryCodeForTypes;
  configOptions.internalTestMode = jsonObject.internalTestMode;
  configOptions.venvPath = jsonObject.venvPath;
  configOptions.venv = jsonObject.venv;
  configOptions.defaultPythonVersion = jsonObject.defaultPythonVersion;
  configOptions.defaultPythonPlatform = jsonObject.defaultPythonPlatform;
  configOptions.defaultExtraPaths = jsonObject.defaultExtraPaths;
  configOptions.diagnosticRuleSet = jsonObject.diagnosticRuleSet;
  configOptions.executionEnvironments = jsonObject.executionEnvironments;
  configOptions.autoImportCompletions = jsonObject.autoImportCompletions;
  configOptions.indexing = jsonObject.indexing;
  configOptions.logTypeEvaluationTime = jsonObject.logTypeEvaluationTime;
  configOptions.typeEvaluationTimeThreshold = jsonObject.typeEvaluationTimeThreshold;
  configOptions.include = jsonObject.include.map((f: any) => getFileSpec(f));
  configOptions.exclude = jsonObject.exclude.map((f: any) => getFileSpec(f));
  configOptions.ignore = jsonObject.ignore.map((f: any) => getFileSpec(f));
  configOptions.strict = jsonObject.strict.map((f: any) => getFileSpec(f));

  return configOptions;
}

export function run(code: () => any, port: MessagePort) {
  try {
    const result = code();
    port.postMessage({ kind: 'ok', data: result });
  } catch (e) {
    if (OpCanceledException.is(e)) {
      port.postMessage({ kind: 'cancelled', data: e.message });
      return;
    }

    port.postMessage({ kind: 'failed', data: `Exception: ${e.message} in ${e.stack}` });
  }
}

export function getBackgroundWaiter<T>(port: MessagePort): Promise<T> {
  return new Promise((resolve, reject) => {
    port.on('message', (m: RequestResponse) => {
      switch (m.kind) {
        case 'ok':
          resolve(m.data);
          break;

        case 'cancelled':
          reject(new OpCanceledException());
          break;

        case 'failed':
          reject(m.data);
          break;

        default:
          debug.fail(`unknown kind ${m.kind}`);
      }
    });
  });
}

export interface InitializationData {
  rootDir: string;
  cancellationFolderName?: string;
  runner?: string;
}

export interface RequestResponse {
  kind: 'ok' | 'failed' | 'cancelled';
  data: any;
}

export interface LogData {
  level: LogLevel;
  message: string;
}

export class BackgroundAnalysisBase {
  private _worker: Worker | undefined;
  private _onAnalysisCompletion: AnalysisCompleteCallback = nullCallback;

  protected constructor(protected console: Console) {}

  protected setup(worker: Worker) {
    this._worker = worker;

    worker.on('message', (msg: AnalysisResponse) => this.onMessage(msg));

    worker.on('error', (msg) => {
      this.log(LogLevel.Error, `Error occurred on background thread: ${JSON.stringify(msg)}`);
    });
  }

  protected onMessage(msg: AnalysisResponse) {
    switch (msg.requestType) {
      case 'log': {
        const logData = msg.data as LogData;
        this.log(logData.level, logData.message);
        break;
      }

      case 'analysisResult': {
        this._onAnalysisCompletion(convertAnalysisResults(msg.data));
        break;
      }

      default:
        debug.fail(`${msg.requestType} is not expected`);
    }
  }

  setCompletionCallback(callback?: AnalysisCompleteCallback) {
    this._onAnalysisCompletion = callback ?? nullCallback;
  }

  setConfigOptions(configOptions: ConfigOptions) {
    this.enqueueRequest({ requestType: 'setConfigOptions', data: configOptions });
  }

  setTrackedFiles(filePaths: string[]) {
    this.enqueueRequest({ requestType: 'setTrackedFiles', data: filePaths });
  }

  setAllowedThirdPartyImports(importNames: string[]) {
    this.enqueueRequest({ requestType: 'setAllowedThirdPartyImports', data: importNames });
  }

  ensurePartialStubPackages(filePath: string) {
    this.enqueueRequest({ requestType: 'ensurePartialStubPackages', data: { filePath } });
  }

  setFileOpened(filePath: string, version: number | null, contents: TextDocumentContentChangeEvent[]) {
    this.enqueueRequest({ requestType: 'setFileOpened', data: { filePath, version, contents } });
  }

  setFileClosed(filePath: string) {
    this.enqueueRequest({ requestType: 'setFileClosed', data: filePath });
  }

  markAllFilesDirty(evenIfContentsAreSame: boolean) {
    this.enqueueRequest({ requestType: 'markAllFilesDirty', data: evenIfContentsAreSame });
  }

  markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
    this.enqueueRequest({ requestType: 'markFilesDirty', data: { filePaths, evenIfContentsAreSame } });
  }

  startAnalysis(indices: Indices | undefined, token: CancellationToken) {
    this._startOrResumeAnalysis('analyze', indices, token);
  }

  private _startOrResumeAnalysis(requestType: 'analyze' | 'resumeAnalysis', indices: Indices | undefined, token: CancellationToken) {
    const { port1, port2 } = new MessageChannel();

    port1.on('message', (msg: AnalysisResponse) => {
      switch (msg.requestType) {
        case 'analysisResult': {
          this._onAnalysisCompletion(convertAnalysisResults(msg.data));
          break;
        }

        case 'analysisPaused': {
          disposeCancellationToken(token);
          port2.close();
          port1.close();

          this._startOrResumeAnalysis('resumeAnalysis', indices, token);
          break;
        }

        case 'indexResult': {
          const { path, indexResults } = msg.data;
          indices?.setWorkspaceIndex(path, indexResults);
          break;
        }

        case 'analysisDone': {
          disposeCancellationToken(token);
          port2.close();
          port1.close();
          break;
        }

        default:
          debug.fail(`${msg.requestType} is not expected`);
      }
    });

    const cancellationId = getCancellationTokenId(token);
    this.enqueueRequest({ requestType, data: cancellationId, port: port2 });
  }

  startIndexing(configOptions: ConfigOptions, indices: Indices) {
    /* noop */
  }

  refreshIndexing(configOptions: ConfigOptions, indices?: Indices) {
    /* noop */
  }

  cancelIndexing(configOptions: ConfigOptions) {
    /* noop */
  }

  async getDiagsForRange(filePath: string, range: Range, token: CancellationToken): Promise<Diag[]> {
    throwIfCancellationRequested(token);

    const { port1, port2 } = new MessageChannel();
    const waiter = getBackgroundWaiter<Diag[]>(port1);

    const cancellationId = getCancellationTokenId(token);
    this.enqueueRequest({
      requestType: 'getDiagsForRange',
      data: { filePath, range, cancellationId },
      port: port2,
    });

    const result = await waiter;

    port2.close();
    port1.close();

    return convertDiags(result);
  }

  async writeTypeStub(targetImportPath: string, targetIsSingleFile: boolean, stubPath: string, token: CancellationToken): Promise<any> {
    throwIfCancellationRequested(token);

    const { port1, port2 } = new MessageChannel();
    const waiter = getBackgroundWaiter(port1);

    const cancellationId = getCancellationTokenId(token);
    this.enqueueRequest({
      requestType: 'writeTypeStub',
      data: { targetImportPath, targetIsSingleFile, stubPath, cancellationId },
      port: port2,
    });

    await waiter;

    port2.close();
    port1.close();
  }

  invalidateAndForceReanalysis() {
    this.enqueueRequest({ requestType: 'invalidateAndForceReanalysis', data: null });
  }

  restart() {
    this.enqueueRequest({ requestType: 'restart', data: null });
  }

  protected enqueueRequest(request: AnalysisRequest) {
    if (this._worker) {
      this._worker.postMessage(request, request.port ? [request.port] : undefined);
    }
  }

  protected log(level: LogLevel, msg: string) {
    log(this.console, level, msg);
  }
}

export class BackgroundAnalysisRunnerBase extends BackgroundThreadBase {
  private _configOptions: ConfigOptions;
  protected _importResolver: ImportResolver;
  private _program: Program;
  protected _logTracker: LogTracker;

  get program(): Program {
    return this._program;
  }

  protected constructor(private _extension?: LangServiceExtension) {
    super(workerData as InitializationData);

    const data = workerData as InitializationData;
    this.log(LogLevel.Info, `Background analysis(${threadId}) root directory: ${data.rootDir}`);

    this._configOptions = new ConfigOptions(data.rootDir);
    this._importResolver = this.createImportResolver(this.fs, this._configOptions);

    const console = this.getConsole();
    this._logTracker = new LogTracker(console, `BG(${threadId})`);

    this._program = new Program(this._importResolver, this._configOptions, console, this._extension, this._logTracker);
  }

  start() {
    this.log(LogLevel.Info, `Background analysis(${threadId}) started`);

    parentPort?.on('message', (msg: AnalysisRequest) => this.onMessage(msg));

    parentPort?.on('error', (msg) => debug.fail(`failed ${msg}`));
    parentPort?.on('exit', (c) => {
      if (c !== 0) {
        debug.fail(`worker stopped with exit code ${c}`);
      }
    });
  }

  protected onMessage(msg: AnalysisRequest) {
    this.log(LogLevel.Log, `Background analysis message: ${msg.requestType}`);

    switch (msg.requestType) {
      case 'analyze': {
        const port = msg.port!;
        const token = getCancellationTokenFromId(msg.data);

        const filesLeftToAnalyze = this.program.getFilesToAnalyzeCount();

        this._onAnalysisCompletion(port, {
          diagnostics: [],
          filesInProgram: this.program.getFileCount(),
          filesRequiringAnalysis: filesLeftToAnalyze,
          checkingOnlyOpenFiles: this.program.isCheckingOnlyOpenFiles(),
          fatalErrorOccurred: false,
          configParseErrorOccurred: false,
          elapsedTime: 0,
        });

        this._analyzeOneChunk(port, token, msg);
        break;
      }

      case 'resumeAnalysis': {
        const port = msg.port!;
        const token = getCancellationTokenFromId(msg.data);

        this._analyzeOneChunk(port, token, msg);
        break;
      }

      case 'getDiagsForRange': {
        run(() => {
          const { filePath, range, cancellationId } = msg.data;
          const token = getCancellationTokenFromId(cancellationId);
          throwIfCancellationRequested(token);

          return this.program.getDiagsForRange(filePath, range);
        }, msg.port!);
        break;
      }

      case 'writeTypeStub': {
        run(() => {
          const { targetImportPath, targetIsSingleFile, stubPath, cancellationId } = msg.data;
          const token = getCancellationTokenFromId(cancellationId);

          analyzeProgram(this.program, undefined, this._configOptions, nullCallback, this.getConsole(), token);
          this.program.writeTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
        }, msg.port!);
        break;
      }

      case 'setConfigOptions': {
        this._configOptions = createConfigOptionsFrom(msg.data);
        this._importResolver = this.createImportResolver(this.fs, this._configOptions);
        this.program.setConfigOptions(this._configOptions);
        this.program.setImportResolver(this._importResolver);
        break;
      }

      case 'setTrackedFiles': {
        const diagnostics = this.program.setTrackedFiles(msg.data);
        this._reportDiags(diagnostics, this.program.getFilesToAnalyzeCount(), 0);
        break;
      }

      case 'setAllowedThirdPartyImports': {
        this.program.setAllowedThirdPartyImports(msg.data);
        break;
      }

      case 'ensurePartialStubPackages': {
        const { filePath } = msg.data;
        this._importResolver.ensurePartialStubPackages(this._configOptions.findExecEnvironment(filePath));
        break;
      }

      case 'setFileOpened': {
        const { filePath, version, contents } = msg.data;
        this.program.setFileOpened(filePath, version, contents);
        break;
      }

      case 'setFileClosed': {
        const diagnostics = this.program.setFileClosed(msg.data);
        this._reportDiags(diagnostics, this.program.getFilesToAnalyzeCount(), 0);
        break;
      }

      case 'markAllFilesDirty': {
        this.program.markAllFilesDirty(msg.data);
        break;
      }

      case 'markFilesDirty': {
        const { filePaths, evenIfContentsAreSame } = msg.data;
        this.program.markFilesDirty(filePaths, evenIfContentsAreSame);
        break;
      }

      case 'invalidateAndForceReanalysis': {
        this._importResolver.invalidateCache();

        this.program.markAllFilesDirty(true);
        break;
      }

      case 'restart': {
        this._importResolver = this.createImportResolver(this.fs, this._configOptions);
        this.program.setImportResolver(this._importResolver);
        break;
      }

      default: {
        debug.fail(`${msg.requestType} is not expected`);
      }
    }
  }

  private _analyzeOneChunk(port: MessagePort, token: CancellationToken, msg: AnalysisRequest) {
    const maxTime = { openFilesTimeInMs: 50, noOpenFilesTimeInMs: 200 };
    const moreToAnalyze = analyzeProgram(this.program, maxTime, this._configOptions, (result) => this._onAnalysisCompletion(port, result), this.getConsole(), token);

    if (moreToAnalyze) {
      this._analysisPaused(port, msg.data);
    } else {
      this.processIndexing(port, token);
      this._analysisDone(port, msg.data);
    }
  }

  protected createImportResolver(fs: FileSystem, options: ConfigOptions): ImportResolver {
    return new ImportResolver(fs, options);
  }

  protected processIndexing(port: MessagePort, token: CancellationToken) {
    /* noop */
  }

  protected reportIndex(port: MessagePort, result: { path: string; indexResults: IndexResults }) {
    port.postMessage({ requestType: 'indexResult', data: result });
  }

  private _reportDiags(diagnostics: FileDiags[], filesLeftToAnalyze: number, elapsedTime: number) {
    if (parentPort) {
      this._onAnalysisCompletion(parentPort, {
        diagnostics,
        filesInProgram: this.program.getFileCount(),
        filesRequiringAnalysis: filesLeftToAnalyze,
        checkingOnlyOpenFiles: this.program.isCheckingOnlyOpenFiles(),
        fatalErrorOccurred: false,
        configParseErrorOccurred: false,
        elapsedTime,
      });
    }
  }

  private _onAnalysisCompletion(port: MessagePort, result: AnalysisResults) {
    port.postMessage({ requestType: 'analysisResult', data: result });
  }

  private _analysisPaused(port: MessagePort, cancellationId: string) {
    port.postMessage({ requestType: 'analysisPaused', data: cancellationId });
  }

  private _analysisDone(port: MessagePort, cancellationId: string) {
    port.postMessage({ requestType: 'analysisDone', data: cancellationId });
  }
}

function convertAnalysisResults(result: AnalysisResults): AnalysisResults {
  result.diagnostics = result.diagnostics.map((f: FileDiags) => {
    return {
      filePath: f.filePath,
      diagnostics: convertDiags(f.diagnostics),
    };
  });

  return result;
}

function convertDiags(diagnostics: Diag[]) {
  return diagnostics.map<Diag>((d: any) => {
    const diag = new Diag(d.category, d.message, d.range);
    if (d._actions) {
      for (const action of d._actions) {
        diag.addAction(action);
      }
    }

    if (d._rule) {
      diag.setRule(d._rule);
    }

    if (d._relatedInfo) {
      for (const info of d._relatedInfo) {
        diag.addRelatedInfo(info.message, info.filePath, info.range);
      }
    }

    return diag;
  });
}

export interface InitializationData {
  rootDir: string;
  cancellationFolderName?: string;
  runner?: string;
}

export interface AnalysisRequest {
  requestType:
    | 'analyze'
    | 'resumeAnalysis'
    | 'setConfigOptions'
    | 'setTrackedFiles'
    | 'setAllowedThirdPartyImports'
    | 'ensurePartialStubPackages'
    | 'setFileOpened'
    | 'setFileClosed'
    | 'markAllFilesDirty'
    | 'markFilesDirty'
    | 'invalidateAndForceReanalysis'
    | 'restart'
    | 'getDiagsForRange'
    | 'writeTypeStub'
    | 'getSemanticTokens';

  data: any;
  port?: MessagePort;
}

export interface AnalysisResponse {
  requestType: 'log' | 'telemetry' | 'analysisResult' | 'analysisPaused' | 'indexResult' | 'analysisDone';
  data: any;
}

export class BackgroundAnalysis extends BackgroundAnalysisBase {
  constructor(console: Console) {
    super(console);
    const initialData: InitializationData = {
      rootDir: (global as any).__rootDir as string,
      cancellationFolderName: getCancellationFolderName(),
    };
    const worker = new Worker(__filename, { workerData: initialData });
    this.setup(worker);
  }
}

export class BackgroundAnalysisRunner extends BackgroundAnalysisRunnerBase {
  constructor() {
    super();
  }
}
