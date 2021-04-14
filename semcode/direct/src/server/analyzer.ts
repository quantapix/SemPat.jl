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
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as vs from 'vscode';
import * as lc from 'vscode-languageclient';
import { WorkspaceProgress } from './extension';
import { download, fetchRelease } from './net';
import * as rustup from './rustup';
import { Observable } from './utils/observable';
import * as FuzzySearch from 'fuzzy-search';
import * as request from 'request-promise-native';
import * as URI from 'urijs';
import * as LSP from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { getGlobPattern } from './config';
import { flattenArray, flattenObjectValues } from './util/flatten';
import { getFilePaths } from './util/fs';
import { getShebang, isBashShebang } from './util/shebang';
import * as TreeSitterUtil from './util/tree-sitter';

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
    if (this._worker) this._worker.postMessage(request, request.port ? [request.port] : undefined);
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
      if (c !== 0) debug.fail(`worker stopped with exit code ${c}`);
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
    if (moreToAnalyze) this._analysisPaused(port, msg.data);
    else {
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
    if (d._rule) diag.setRule(d._rule);
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
// ---
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const REQUIRED_COMPONENTS = ['rust-src'];
function installDir(): string | undefined {
  if (process.platform === 'linux' || process.platform === 'darwin') {
    const { HOME, XDG_DATA_HOME, XDG_BIN_HOME } = process.env;
    if (XDG_BIN_HOME) return path.resolve(XDG_BIN_HOME);
    const baseDir = XDG_DATA_HOME ? path.join(XDG_DATA_HOME, '..') : HOME && path.join(HOME, '.local');
    return baseDir && path.resolve(path.join(baseDir, 'bin'));
  } else if (process.platform === 'win32') {
    const { LocalAppData } = process.env;
    return LocalAppData && path.resolve(path.join(LocalAppData, 'rust-analyzer'));
  }
  return undefined;
}
function metadataDir(): string | undefined {
  if (process.platform === 'linux' || process.platform === 'darwin') {
    const { HOME, XDG_CONFIG_HOME } = process.env;
    const baseDir = XDG_CONFIG_HOME || (HOME && path.join(HOME, '.config'));
    return baseDir && path.resolve(path.join(baseDir, 'rust-analyzer'));
  } else if (process.platform === 'win32') {
    const { LocalAppData } = process.env;
    return LocalAppData && path.resolve(path.join(LocalAppData, 'rust-analyzer'));
  }
  return undefined;
}
function ensureDir(path: string) {
  return !!path && stat(path).catch(() => mkdir(path, { recursive: true }));
}
interface RustAnalyzerConfig {
  askBeforeDownload?: boolean;
  package: {
    releaseTag: string;
  };
}
interface Metadata {
  releaseTag: string;
}
async function readMetadata(): Promise<Metadata | Record<string, unknown>> {
  const stateDir = metadataDir();
  if (!stateDir) return { kind: 'error', code: 'NotSupported' };
  const filePath = path.join(stateDir, 'metadata.json');
  if (!(await stat(filePath).catch(() => false))) {
    return { kind: 'error', code: 'FileMissing' };
  }
  const contents = await readFile(filePath, 'utf8');
  const obj = JSON.parse(contents) as unknown;
  return typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
}
async function writeMetadata(config: Metadata) {
  const stateDir = metadataDir();
  if (!stateDir) return false;
  if (!(await ensureDir(stateDir))) {
    return false;
  }
  const filePath = path.join(stateDir, 'metadata.json');
  return writeFile(filePath, JSON.stringify(config)).then(() => true);
}
export async function getServer({ askBeforeDownload, package: pkg }: RustAnalyzerConfig): Promise<string | undefined> {
  let binaryName: string | undefined;
  if (process.arch === 'x64' || process.arch === 'ia32') {
    if (process.platform === 'linux') binaryName = 'rust-analyzer-linux';

    if (process.platform === 'darwin') binaryName = 'rust-analyzer-mac';
    if (process.platform === 'win32') binaryName = 'rust-analyzer-windows.exe';
  }
  if (binaryName === undefined) {
    vs.window.showErrorMessage(
      "Unfortunately we don't ship binaries for your platform yet. " +
        'You need to manually clone rust-analyzer repository and ' +
        'run `cargo xtask install --server` to build the language server from sources. ' +
        'If you feel that your platform should be supported, please create an issue ' +
        'about that [here](https://github.com/rust-analyzer/rust-analyzer/issues) and we ' +
        'will consider it.'
    );
    return undefined;
  }
  const dir = installDir();
  if (!dir) return;
  await ensureDir(dir);
  const metadata: Partial<Metadata> = await readMetadata().catch(() => ({}));
  const dest = path.join(dir, binaryName);
  const exists = await stat(dest).catch(() => false);
  if (exists && metadata.releaseTag === pkg.releaseTag) return dest;
  if (askBeforeDownload) {
    const userResponse = await vs.window.showInformationMessage(
      `${metadata.releaseTag && metadata.releaseTag !== pkg.releaseTag ? `You seem to have installed release \`${metadata.releaseTag}\` but requested a different one.` : ''}
      Release \`${pkg.releaseTag}\` of rust-analyzer is not installed.\n
      Install to ${dir}?`,
      'Download'
    );
    if (userResponse !== 'Download') return dest;
  }
  const release = await fetchRelease('rust-analyzer', 'rust-analyzer', pkg.releaseTag);
  const artifact = release.assets.find((asset) => asset.name === binaryName);
  if (!artifact) throw new Error(`Bad release: ${JSON.stringify(release)}`);
  await download(artifact.browser_download_url, dest, 'Downloading rust-analyzer server', { mode: 0o755 });
  await writeMetadata({ releaseTag: pkg.releaseTag }).catch(() => {
    vs.window.showWarningMessage(`Couldn't save rust-analyzer metadata`);
  });
  return dest;
}
let INSTANCE: lc.LangClient | undefined;
const PROGRESS: Observable<WorkspaceProgress> = new Observable<WorkspaceProgress>({ state: 'standby' });
export async function createLangClient(
  folder: vs.WorkspaceFolder,
  config: {
    revealOutputChannelOn?: lc.RevealOutputChannelOn;
    logToFile?: boolean;
    rustup: { disabled: boolean; path: string; channel: string };
    rustAnalyzer: { path?: string; releaseTag: string };
  }
): Promise<lc.LangClient> {
  if (!config.rustup.disabled) {
    await rustup.ensureToolchain(config.rustup);
    await rustup.ensureComponents(config.rustup, REQUIRED_COMPONENTS);
  }
  if (!config.rustAnalyzer.path) {
    await getServer({
      askBeforeDownload: true,
      package: { releaseTag: config.rustAnalyzer.releaseTag },
    });
  }
  if (INSTANCE) return INSTANCE;
  const serverOptions: lc.ServerOptions = async () => {
    const binPath =
      config.rustAnalyzer.path ||
      (await getServer({
        package: { releaseTag: config.rustAnalyzer.releaseTag },
      }));
    if (!binPath) throw new Error("Couldn't fetch Rust Analyzer binary");
    const childProc = child_process.exec(binPath);
    if (config.logToFile) {
      const logPath = path.join(folder.uri.fsPath, `ra-${Date.now()}.log`);
      const logStream = fs.createWriteStream(logPath, { flags: 'w+' });
      childProc.stderr?.pipe(logStream);
    }
    return childProc;
  };
  const clientOptions: lc.LangClientOptions = {
    documentSelector: [
      { language: 'rust', scheme: 'file' },
      { language: 'rust', scheme: 'untitled' },
    ],
    diagnosticCollectionName: `rust`,
    revealOutputChannelOn: config.revealOutputChannelOn,
    initializationOptions: vs.workspace.getConfig('rust.rust-analyzer'),
  };
  INSTANCE = new lc.LangClient('rust-client', 'Rust Analyzer', serverOptions, clientOptions);
  INSTANCE.registerProposedFeatures();
  setupGlobalProgress(INSTANCE);
  return INSTANCE;
}
async function setupGlobalProgress(client: lc.LangClient) {
  client.onDidChangeState(async ({ newState }) => {
    if (newState === lc.State.Starting) {
      await client.onReady();
      const RUST_ANALYZER_PROGRESS = 'rustAnalyzer/roots scanned';
      client.onProgress(
        new lc.ProgressType<{
          kind: 'begin' | 'report' | 'end';
          message?: string;
        }>(),
        RUST_ANALYZER_PROGRESS,
        ({ kind, message: msg }) => {
          if (kind === 'report') PROGRESS.value = { state: 'progress', message: msg || '' };
          if (kind === 'end') PROGRESS.value = { state: 'ready' };
        }
      );
    }
  });
}
export function setupClient(_client: lc.LangClient, _folder: vs.WorkspaceFolder): vs.Disposable[] {
  return [];
}
export function setupProgress(_client: lc.LangClient, workspaceProgress: Observable<WorkspaceProgress>) {
  workspaceProgress.value = PROGRESS.value;
  PROGRESS.observe((progress) => {
    workspaceProgress.value = progress;
  });
}
// ---
const readFileAsync = promisify(fs.readFile);
type Kinds = { [type: string]: LSP.SymbolKind };
type Declarations = { [name: string]: LSP.SymbolInformation[] };
type FileDeclarations = { [uri: string]: Declarations };
type Trees = { [uri: string]: Parser.Tree };
type Texts = { [uri: string]: string };
export default class Analyzer {
  public static async fromRoot({ connection, rootPath, parser }: { connection: LSP.Connection; rootPath: LSP.InitializeParams['rootPath']; parser: Parser }): Promise<Analyzer> {
    const analyzer = new Analyzer(parser);
    if (rootPath) {
      const globPattern = getGlobPattern();
      connection.console.log(`Analyzing files matching glob "${globPattern}" inside ${rootPath}`);
      const lookupStartTime = Date.now();
      const getTimePassed = (): string => `${(Date.now() - lookupStartTime) / 1000} seconds`;
      let filePaths: string[] = [];
      try {
        filePaths = await getFilePaths({ globPattern, rootPath });
      } catch (error) {
        connection.window.showWarningMessage(`Failed to analyze bash files using the glob "${globPattern}". The experience will be degraded. Error: ${error.message}`);
      }
      connection.console.log(`Glob resolved with ${filePaths.length} files after ${getTimePassed()}`);
      for (const filePath of filePaths) {
        const uri = `file://${filePath}`;
        connection.console.log(`Analyzing ${uri}`);
        try {
          const fileContent = await readFileAsync(filePath, 'utf8');
          const shebang = getShebang(fileContent);
          if (shebang && !isBashShebang(shebang)) {
            connection.console.log(`Skipping file ${uri} with shebang "${shebang}"`);
            continue;
          }
          analyzer.analyze(uri, LSP.TextDocument.create(uri, 'shell', 1, fileContent));
        } catch (error) {
          connection.console.warn(`Failed analyzing ${uri}. Error: ${error.message}`);
        }
      }
      connection.console.log(`Analyzer finished after ${getTimePassed()}`);
    }
    return analyzer;
  }
  private parser: Parser;
  private uriToTextDocument: { [uri: string]: LSP.TextDocument } = {};
  private uriToTreeSitterTrees: Trees = {};
  private uriToFileContent: Texts = {};
  private uriToDeclarations: FileDeclarations = {};
  private treeSitterTypeToLSPKind: Kinds = {
    environment_variable_assignment: LSP.SymbolKind.Variable,
    function_definition: LSP.SymbolKind.Function,
    variable_assignment: LSP.SymbolKind.Variable,
  };
  public constructor(parser: Parser) {
    this.parser = parser;
  }
  public findDefinition(name: string): LSP.Location[] {
    const symbols: LSP.SymbolInformation[] = [];
    Object.keys(this.uriToDeclarations).forEach((uri) => {
      const declarationNames = this.uriToDeclarations[uri][name] || [];
      declarationNames.forEach((d) => symbols.push(d));
    });
    return symbols.map((s) => s.location);
  }
  public search(query: string): LSP.SymbolInformation[] {
    const searcher = new FuzzySearch(this.getAllSymbols(), ['name'], {
      caseSensitive: true,
    });
    return searcher.search(query);
  }
  public async getExplainshellDocumentation({ params, endpoint }: { params: LSP.TextDocumentPositionParams; endpoint: string }): Promise<any> {
    const leafNode = this.uriToTreeSitterTrees[params.textDocument.uri].rootNode.descendantForPosition({
      row: params.position.line,
      column: params.position.character,
    });
    const interestingNode = leafNode.type === 'word' ? leafNode.parent : leafNode;
    if (!interestingNode) return { status: 'error', message: 'no interestingNode found' };
    const cmd = this.uriToFileContent[params.textDocument.uri].slice(interestingNode.startIndex, interestingNode.endIndex);
    // FIXME: type the response and unit test it
    const explainshellResponse = await request({
      uri: URI(endpoint).path('/api/explain').addQuery('cmd', cmd).toString(),
      json: true,
    });
    const response = { ...explainshellResponse, cmd, cmdType: interestingNode.type };
    if (explainshellResponse.status === 'error') return response;
    else if (!explainshellResponse.matches) return { ...response, status: 'error' };
    else {
      const offsetOfMousePointerInCommand = this.uriToTextDocument[params.textDocument.uri].offsetAt(params.position) - interestingNode.startIndex;
      const match = explainshellResponse.matches.find((helpItem: any) => helpItem.start <= offsetOfMousePointerInCommand && offsetOfMousePointerInCommand < helpItem.end);
      const helpHTML = match && match.helpHTML;
      if (!helpHTML) return { ...response, status: 'error' };
      return { ...response, helpHTML };
    }
  }
  public findReferences(name: string): LSP.Location[] {
    const uris = Object.keys(this.uriToTreeSitterTrees);
    return flattenArray(uris.map((uri) => this.findOccurrences(uri, name)));
  }
  public findOccurrences(uri: string, query: string): LSP.Location[] {
    const tree = this.uriToTreeSitterTrees[uri];
    const contents = this.uriToFileContent[uri];
    const locations: LSP.Location[] = [];
    TreeSitterUtil.forEach(tree.rootNode, (n) => {
      let name: null | string = null;
      let range: null | LSP.Range = null;
      if (TreeSitterUtil.isReference(n)) {
        const node = n.firstNamedChild || n;
        name = contents.slice(node.startIndex, node.endIndex);
        range = TreeSitterUtil.range(node);
      } else if (TreeSitterUtil.isDefinition(n)) {
        const namedNode = n.firstNamedChild;
        if (namedNode) {
          name = contents.slice(namedNode.startIndex, namedNode.endIndex);
          range = TreeSitterUtil.range(namedNode);
        }
      }
      if (name === query && range !== null) locations.push(LSP.Location.create(uri, range));
    });
    return locations;
  }
  public findSymbolsForFile({ uri }: { uri: string }): LSP.SymbolInformation[] {
    const declarationsInFile = this.uriToDeclarations[uri] || {};
    return flattenObjectValues(declarationsInFile);
  }
  public findSymbolsMatchingWord({ exactMatch, word }: { exactMatch: boolean; word: string }): LSP.SymbolInformation[] {
    const symbols: LSP.SymbolInformation[] = [];
    Object.keys(this.uriToDeclarations).forEach((uri) => {
      const declarationsInFile = this.uriToDeclarations[uri] || {};
      Object.keys(declarationsInFile).map((name) => {
        const match = exactMatch ? name === word : name.startsWith(word);
        if (match) declarationsInFile[name].forEach((symbol) => symbols.push(symbol));
      });
    });
    return symbols;
  }
  public analyze(uri: string, document: LSP.TextDocument): LSP.Diag[] {
    const contents = document.getText();
    const tree = this.parser.parse(contents);
    this.uriToTextDocument[uri] = document;
    this.uriToTreeSitterTrees[uri] = tree;
    this.uriToDeclarations[uri] = {};
    this.uriToFileContent[uri] = contents;
    const problems: LSP.Diag[] = [];
    TreeSitterUtil.forEach(tree.rootNode, (n: Parser.SyntaxNode) => {
      if (n.type === 'ERROR') {
        problems.push(LSP.Diag.create(TreeSitterUtil.range(n), 'Failed to parse expression', LSP.DiagSeverity.Error));
        return;
      } else if (TreeSitterUtil.isDefinition(n)) {
        const named = n.firstNamedChild;
        if (named === null) return;
        const name = contents.slice(named.startIndex, named.endIndex);
        const namedDeclarations = this.uriToDeclarations[uri][name] || [];
        const parent = TreeSitterUtil.findParent(n, (p) => p.type === 'function_definition');
        const parentName = parent && parent.firstNamedChild ? contents.slice(parent.firstNamedChild.startIndex, parent.firstNamedChild.endIndex) : ''; // TODO: unsure what we should do here?
        namedDeclarations.push(LSP.SymbolInformation.create(name, this.treeSitterTypeToLSPKind[n.type], TreeSitterUtil.range(n), uri, parentName));
        this.uriToDeclarations[uri][name] = namedDeclarations;
      }
    });
    function findMissingNodes(node: Parser.SyntaxNode) {
      if (node.isMissing()) {
        problems.push(LSP.Diag.create(TreeSitterUtil.range(node), `Syntax error: expected "${node.type}" somewhere in the file`, LSP.DiagSeverity.Warning));
      } else if (node.hasError()) {
        node.children.forEach(findMissingNodes);
      }
    }
    findMissingNodes(tree.rootNode);
    return problems;
  }
  public wordAtPoint(uri: string, line: number, column: number): string | null {
    const document = this.uriToTreeSitterTrees[uri];
    if (!document.rootNode) return null;
    const node = document.rootNode.descendantForPosition({ row: line, column });
    if (!node || node.childCount > 0 || node.text.trim() === '') {
      return null;
    }
    return node.text.trim();
  }
  public commentsAbove(uri: string, line: number): string | null {
    const doc = this.uriToTextDocument[uri];
    const commentBlock = [];
    let commentBlockIndex = line - 1;
    const getComment = (l: string): null | string => {
      const commentRegExp = /^\s*#\s*(.*)/g;
      const matches = commentRegExp.exec(l);
      return matches ? matches[1].trim() : null;
    };
    let currentLine = doc.getText({
      start: { line: commentBlockIndex, character: 0 },
      end: { line: commentBlockIndex + 1, character: 0 },
    });
    let currentComment: string | null = '';
    while ((currentComment = getComment(currentLine))) {
      commentBlock.push(currentComment);
      commentBlockIndex -= 1;
      currentLine = doc.getText({
        start: { line: commentBlockIndex, character: 0 },
        end: { line: commentBlockIndex + 1, character: 0 },
      });
    }
    if (commentBlock.length) return commentBlock.reverse().join('\n');
    return null;
  }
  public getAllVariableSymbols(): LSP.SymbolInformation[] {
    return this.getAllSymbols().filter((symbol) => symbol.kind === LSP.SymbolKind.Variable);
  }
  private getAllSymbols(): LSP.SymbolInformation[] {
    const symbols: LSP.SymbolInformation[] = [];
    Object.keys(this.uriToDeclarations).forEach((uri) => {
      Object.keys(this.uriToDeclarations[uri]).forEach((name) => {
        const declarationNames = this.uriToDeclarations[uri][name] || [];
        declarationNames.forEach((d) => symbols.push(d));
      });
    });
    return symbols;
  }
}
