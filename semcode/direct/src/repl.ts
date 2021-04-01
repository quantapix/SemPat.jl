import * as fs from 'async-file';
import { Subject } from 'await-notify';
import { assert } from 'console';
import * as net from 'net';
import * as path from 'path';
import { uuid } from 'uuidv4';
import * as qv from 'vscode';
import * as rpc from 'vscode-jsonrpc/node';
import * as vslc from 'vscode-languageclient/node';
import { onSetLanguageClient } from './extension_rs';
import { switchEnvToPath } from './packs';
import * as packs from './packs';
import { generatePipeName, getVersionedParamsAtPosition, inferJuliaNumThreads, registerCommand, setContext } from '../utils';
import { VersionedTextDocumentPositionParams } from './misc';
import * as modules from './modules';
import * as plots from './plots';
import { showProfileResult, showProfileResultFile } from './profiler';
import * as results from './results';
import { Frame } from './results';
import * as workspace from './workspace';

let g_context: qv.ExtensionContext = null;
let g_languageClient: vslc.LanguageClient = null;

let g_terminal: qv.Terminal = null;

export let g_connection: rpc.MessageConnection = undefined;

function startREPLCommand() {
  startREPL(false);
}

function is_remote_env(): boolean {
  return typeof qv.env.remoteName !== 'undefined';
}

function get_editor(): string {
  const editor: string | null = qv.workspace.getConfiguration('julia').get('editor');

  if (editor) {
    return editor;
  }
  if (is_remote_env()) {
    if (qv.env.appName === 'Code - OSS') {
      return 'code-server';
    } else {
      return `"${process.execPath}"`;
    }
  }
  return qv.env.appName.includes('Insiders') ? 'code-insiders' : 'code';
}

async function startREPL(preserveFocus: boolean, showTerminal: boolean = true) {
  if (g_terminal === null) {
    const pipename = generatePipeName(uuid(), 'vsc-jl-repl');
    const startupPath = path.join(g_context.extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl');
    function getArgs() {
      const jlarg2 = [startupPath, pipename, 'pipe'];
      jlarg2.push(`USE_REVISE=${qv.workspace.getConfiguration('julia').get('useRevise')}`);
      jlarg2.push(`USE_PLOTPANE=${qv.workspace.getConfiguration('julia').get('usePlotPane')}`);
      jlarg2.push(`USE_PROGRESS=${qv.workspace.getConfiguration('julia').get('useProgressFrontend')}`);
      jlarg2.push(`DEBUG_MODE=${process.env.DEBUG_MODE}`);
      return jlarg2;
    }

    const env = {
      JULIA_EDITOR: get_editor(),
      JULIA_NUM_THREADS: inferJuliaNumThreads(),
    };

    const pkgServer: string = qv.workspace.getConfiguration('julia').get('packageServer');
    if (pkgServer.length !== 0) {
      env['JULIA_PKG_SERVER'] = pkgServer;
    }

    const juliaIsConnectedPromise = startREPLMsgServer(pipename);
    const exepath = await packs.getJuliaExePath();
    const pkgenvpath = await packs.getAbsEnvPath();
    if (pkgenvpath === null) {
      const jlarg1 = ['-i', '--banner=no'].concat(qv.workspace.getConfiguration('julia').get('additionalArgs'));
      g_terminal = qv.window.createTerminal({
        name: 'Julia REPL',
        shellPath: exepath,
        shellArgs: jlarg1.concat(getArgs()),
        env: env,
      });
    } else {
      const env_file_paths = await packs.getProjectFilePaths(pkgenvpath);

      let sysImageArgs = [];
      if (qv.workspace.getConfiguration('julia').get('useCustomSysimage') && env_file_paths.sysimage_path && env_file_paths.project_toml_path && env_file_paths.manifest_toml_path) {
        const date_sysimage = await fs.stat(env_file_paths.sysimage_path);
        const date_manifest = await fs.stat(env_file_paths.manifest_toml_path);

        if (date_sysimage.mtime > date_manifest.mtime) {
          sysImageArgs = ['-J', env_file_paths.sysimage_path];
        } else {
          qv.window.showWarningMessage('Julia sysimage for this environment is out-of-date and not used for REPL.');
        }
      }
      const jlarg1 = ['-i', '--banner=no', `--project=${pkgenvpath}`].concat(sysImageArgs).concat(qv.workspace.getConfiguration('julia').get('additionalArgs'));
      g_terminal = qv.window.createTerminal({
        name: 'Julia REPL',
        shellPath: exepath,
        shellArgs: jlarg1.concat(getArgs()),
        env: env,
      });
    }
    g_terminal.show(preserveFocus);
    await juliaIsConnectedPromise.wait();
  } else if (showTerminal) {
    g_terminal.show(preserveFocus);
  }
}

function killREPL() {
  if (g_terminal) {
    g_terminal.dispose();
  }
}

function debuggerRun(params: DebugLaunchParams) {
  qv.debug.startDebugging(undefined, {
    type: 'julia',
    request: 'attach',
    name: 'Julia REPL',
    code: params.code,
    file: params.filename,
    stopOnEntry: false,
  });
}

function debuggerEnter(params: DebugLaunchParams) {
  qv.debug.startDebugging(undefined, {
    type: 'julia',
    request: 'attach',
    name: 'Julia REPL',
    code: params.code,
    file: params.filename,
    stopOnEntry: true,
  });
}

interface ReturnResult {
  inline: string;
  all: string;
  stackframe: null | Array<Frame>;
}

const requestTypeReplRunCode = new rpc.RequestType<
  {
    filename: string;
    line: number;
    column: number;
    code: string;
    mod: string;
    showCodeInREPL: boolean;
    showResultInREPL: boolean;
    softscope: boolean;
  },
  ReturnResult,
  void
>('repl/runcode');

interface DebugLaunchParams {
  code: string;
  filename: string;
}

const notifyTypeDisplay = new rpc.NotificationType<{ kind: string; data: any }>('display');
const notifyTypeDebuggerEnter = new rpc.NotificationType<DebugLaunchParams>('debugger/enter');
const notifyTypeDebuggerRun = new rpc.NotificationType<DebugLaunchParams>('debugger/run');
const notifyTypeReplStartDebugger = new rpc.NotificationType<{ debugPipename: string }>('repl/startdebugger');
const notifyTypeReplStartEval = new rpc.NotificationType<void>('repl/starteval');
export const notifyTypeReplFinishEval = new rpc.NotificationType<void>('repl/finisheval');
export const notifyTypeReplShowInGrid = new rpc.NotificationType<{ code: string }>('repl/showingrid');
const notifyTypeShowProfilerResult = new rpc.NotificationType<{ content: string }>('repl/showprofileresult');
const notifyTypeShowProfilerResultFile = new rpc.NotificationType<{ filename: string }>('repl/showprofileresult_file');

interface Progress {
  id: { value: number };
  name: string;
  fraction: number;
  done: Boolean;
}
const notifyTypeProgress = new rpc.NotificationType<Progress>('repl/updateProgress');

const g_onInit = new qv.EventEmitter<rpc.MessageConnection>();
export const onInit = g_onInit.event;
const g_onExit = new qv.EventEmitter<Boolean>();
export const onExit = g_onExit.event;
const g_onStartEval = new qv.EventEmitter<null>();
export const onStartEval = g_onStartEval.event;
const g_onFinishEval = new qv.EventEmitter<null>();
export const onFinishEval = g_onFinishEval.event;

function startREPLMsgServer(pipename: string) {
  const connected = new Subject();

  const server = net.createServer((socket: net.Socket) => {
    socket.on('close', (hadError) => {
      g_onExit.fire(hadError);
      g_connection = undefined;
      server.close();
    });

    g_connection = rpc.createMessageConnection(new rpc.StreamMessageReader(socket), new rpc.StreamMessageWriter(socket));

    g_connection.listen();

    g_onInit.fire(g_connection);

    connected.notify();
  });

  server.listen(pipename);

  return connected;
}

const g_progress_dict = {};

async function updateProgress(progress: Progress) {
  if (g_progress_dict[progress.id.value]) {
    const p = g_progress_dict[progress.id.value];
    const increment = progress.done ? 100 : (progress.fraction - p.last_fraction) * 100;

    p.progress.report({
      increment: increment,
      message: progressMessage(progress, p.started),
    });
    p.last_fraction = progress.fraction;

    if (progress.done) {
      p.resolve();
      delete g_progress_dict[progress.id.value];
    }
  } else {
    qv.window.withProgress(
      {
        location: qv.ProgressLocation.Window,
        title: 'Julia',
        cancellable: true,
      },
      (prog, token) => {
        return new Promise((resolve) => {
          g_progress_dict[progress.id.value] = {
            progress: prog,
            last_fraction: progress.fraction,
            started: new Date(),
            resolve: resolve,
          };
          token.onCancellationRequested((ev) => {
            interrupt();
          });
          prog.report({
            message: progressMessage(progress),
          });
        });
      }
    );
  }
}

function progressMessage(prog: Progress, started = null) {
  let message = prog.name;
  const parenthezise = message.trim().length > 0;
  if (!isNaN(prog.fraction) && 0 <= prog.fraction && prog.fraction <= 1) {
    if (parenthezise) {
      message += ' (';
    }
    message += `${(prog.fraction * 100).toFixed(1)}%`;
    if (started !== null) {
      const elapsed = (new Date().valueOf() - started) / 1000;
      const remaining = (1 / prog.fraction - 1) * elapsed;
      message += ` - ${formattedTimePeriod(remaining)} remaining`;
    }
    if (parenthezise) {
      message += ')';
    }
  }
  return message;
}

function formattedTimePeriod(t) {
  const seconds = Math.floor(t % 60);
  const minutes = Math.floor((t / 60) % 60);
  const hours = Math.floor(t / 60 / 60);
  let out = '';
  if (hours > 0) {
    out += `${hours}h, `;
  }
  if (minutes > 0) {
    out += `${minutes}min, `;
  }
  out += `${seconds}s`;
  return out;
}

function clearProgress() {
  for (const id in g_progress_dict) {
    g_progress_dict[id].resolve();
    delete g_progress_dict[id];
  }
}

async function executeFile(uri?: qv.Uri | string) {
  const editor = qv.window.activeTextEditor;
  await startREPL(true, false);
  let module = 'Main';
  let path = '';
  let code = '';

  if (uri && !(uri instanceof qv.Uri)) {
    uri = qv.Uri.parse(uri);
  }

  if (uri && uri instanceof qv.Uri) {
    path = uri.fsPath;
    const readBytes = await qv.workspace.fs.readFile(uri);
    code = Buffer.from(readBytes).toString('utf8');
  } else {
    if (!editor) {
      return;
    }
    path = editor.document.fileName;
    code = editor.document.getText();

    const pos = editor.document.validatePosition(new qv.Position(0, 1)); // xref: https://github.com/julia-vscode/julia-vscode/issues/1500
    module = await modules.getModuleForEditor(editor.document, pos);
  }

  await g_connection.sendRequest(requestTypeReplRunCode, {
    filename: path,
    line: 0,
    column: 0,
    mod: module,
    code: code,
    showCodeInREPL: false,
    showResultInREPL: true,
    softscope: false,
  });
}

async function getBlockRange(params: VersionedTextDocumentPositionParams) {
  const zeroPos = new qv.Position(0, 0);
  const zeroReturn = [zeroPos, zeroPos, params.position];

  if (g_languageClient === null) {
    qv.window.showErrorMessage('No LS running or start. Check your settings.');
    return zeroReturn;
  }

  await g_languageClient.onReady();

  try {
    return await g_languageClient.sendRequest('julia/getCurrentBlockRange', params);
  } catch (err) {
    if (err.message === 'Language client is not ready yet') {
      qv.window.showErrorMessage(err);
      return zeroReturn;
    } else {
      console.error(err);
      throw err;
    }
  }
}

async function selectJuliaBlock() {
  const editor = qv.window.activeTextEditor;
  const position = editor.document.validatePosition(editor.selection.start);
  const ret_val = await getBlockRange(getVersionedParamsAtPosition(editor.document, position));

  const start_pos = new qv.Position(ret_val[0].line, ret_val[0].character);
  const end_pos = new qv.Position(ret_val[1].line, ret_val[1].character);
  validateMoveAndReveal(editor, start_pos, end_pos);
}

const g_cellDelimiters = [/^##(?!#)/, /^#(\s?)%%/];

function isCellBorder(s: string) {
  return g_cellDelimiters.some((regex) => regex.test(s));
}

function _nextCellBorder(doc, line_num: number, direction: number) {
  assert(direction === 1 || direction === -1);
  while (0 <= line_num && line_num < doc.lineCount) {
    if (isCellBorder(doc.lineAt(line_num).text)) {
      break;
    }
    line_num += direction;
  }
  return line_num;
}

const nextCellBorder = (doc, line_num) => _nextCellBorder(doc, line_num, +1);
const prevCellBorder = (doc, line_num) => _nextCellBorder(doc, line_num, -1);

function validateMoveAndReveal(editor: qv.TextEditor, startpos: qv.Position, endpos: qv.Position) {
  const doc = editor.document;
  startpos = doc.validatePosition(startpos);
  endpos = doc.validatePosition(endpos);
  editor.selection = new qv.Selection(startpos, endpos);
  editor.revealRange(new qv.Range(startpos, endpos));
}

async function moveCellDown() {
  const ed = qv.window.activeTextEditor;
  if (ed === undefined) {
    return;
  }
  const currline = ed.selection.active.line;
  const newpos = new qv.Position(nextCellBorder(ed.document, currline + 1) + 1, 0);
  validateMoveAndReveal(ed, newpos, newpos);
}

async function moveCellUp() {
  const ed = qv.window.activeTextEditor;
  if (ed === undefined) {
    return;
  }
  const currline = ed.selection.active.line;
  const newpos = new qv.Position(Math.max(0, prevCellBorder(ed.document, currline) - 1), 0);
  validateMoveAndReveal(ed, newpos, newpos);
}

function currentCellRange(editor: qv.TextEditor) {
  const doc = editor.document;
  const currline = editor.selection.active.line;
  const startline = prevCellBorder(doc, currline) + 1;
  const endline = nextCellBorder(doc, currline + 1) - 1;
  const startpos = doc.validatePosition(new qv.Position(startline, 0));
  const endpos = doc.validatePosition(new qv.Position(endline, doc.lineAt(endline).text.length));
  return new qv.Range(startpos, endpos);
}

async function executeCell(shouldMove: boolean = false) {
  const ed = qv.window.activeTextEditor;
  if (ed === undefined) {
    return;
  }

  const doc = ed.document;
  const selection = ed.selection;
  const cellrange = currentCellRange(ed);
  const code = doc.getText(cellrange);

  const module: string = await modules.getModuleForEditor(ed.document, cellrange.start);

  await startREPL(true, false);

  if (shouldMove && ed.selection === selection) {
    const nextpos = new qv.Position(cellrange.end.line + 2, 0);
    validateMoveAndReveal(ed, nextpos, nextpos);
  }

  await evaluate(ed, cellrange, code, module);
}

async function evaluateBlockOrSelection(shouldMove: boolean = false) {
  const editor = qv.window.activeTextEditor;
  if (editor === undefined) {
    return;
  }

  const selections = editor.selections.slice();

  await startREPL(true, false);

  for (const selection of selections) {
    let range: qv.Range = null;
    let nextBlock: qv.Position = null;
    const startpos: qv.Position = editor.document.validatePosition(new qv.Position(selection.start.line, selection.start.character));
    const module: string = await modules.getModuleForEditor(editor.document, startpos);

    if (selection.isEmpty) {
      const currentBlock = await getBlockRange(getVersionedParamsAtPosition(editor.document, startpos));
      range = new qv.Range(currentBlock[0].line, currentBlock[0].character, currentBlock[1].line, currentBlock[1].character);
      nextBlock = editor.document.validatePosition(new qv.Position(currentBlock[2].line, currentBlock[2].character));
    } else {
      range = new qv.Range(selection.start, selection.end);
    }

    const text = editor.document.getText(range);

    if (shouldMove && nextBlock && selection.isEmpty && editor.selections.length === 1 && editor.selection === selection) {
      validateMoveAndReveal(editor, nextBlock, nextBlock);
    }

    if (range.isEmpty) {
      return;
    }

    const tempDecoration = qv.window.createTextEditorDecorationType({
      backgroundColor: new qv.ThemeColor('editor.hoverHighlightBackground'),
      isWholeLine: true,
    });
    editor.setDecorations(tempDecoration, [range]);

    setTimeout(() => {
      editor.setDecorations(tempDecoration, []);
    }, 200);

    await evaluate(editor, range, text, module);
  }
}

async function evaluate(editor: qv.TextEditor, range: qv.Range, text: string, module: string) {
  const section = qv.workspace.getConfiguration('julia');
  const resultType: string = section.get('execution.resultType');
  const codeInREPL: boolean = section.get('execution.codeInREPL');

  let r: results.Result = null;
  if (resultType !== 'REPL') {
    r = results.addResult(editor, range, ' ⟳ ', '');
  }

  const result: ReturnResult = await g_connection.sendRequest(requestTypeReplRunCode, {
    filename: editor.document.fileName,
    line: range.start.line,
    column: range.start.character,
    code: text,
    mod: module,
    showCodeInREPL: codeInREPL,
    showResultInREPL: resultType !== 'inline',
    softscope: true,
  });

  if (resultType !== 'REPL') {
    if (result.stackframe) {
      results.clearStackTrace();
      results.setStackTrace(r, result.all, result.stackframe);
    }
    r.setContent(results.resultContent(' ' + result.inline + ' ', result.all, Boolean(result.stackframe)));
  }
}

async function executeCodeCopyPaste(text: string, individualLine: boolean) {
  if (!text.endsWith('\n')) {
    text = text + '\n';
  }

  await startREPL(true, true);

  let lines = text.split(/\r?\n/);
  lines = lines.filter((line) => line !== '');
  text = lines.join('\n');
  if (individualLine || process.platform === 'win32') {
    g_terminal.sendText(text + '\n', false);
  } else {
    g_terminal.sendText('\u001B[200~' + text + '\n' + '\u001B[201~', false);
  }
}

function executeSelectionCopyPaste() {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const selection = editor.selection;
  const text = selection.isEmpty ? editor.document.lineAt(selection.start.line).text : editor.document.getText(selection);
  if (selection.isEmpty) {
    for (let line = selection.start.line + 1; line < editor.document.lineCount; line++) {
      if (!editor.document.lineAt(line).isEmptyOrWhitespace) {
        const newPos = selection.active.with(line, editor.document.lineAt(line).range.end.character);
        const newSel = new qv.Selection(newPos, newPos);
        editor.selection = newSel;
        break;
      }
    }
  }
  executeCodeCopyPaste(text, selection.isEmpty);
}

const interrupts = [];
let last_interrupt_index = -1;
function interrupt() {
  softInterrupt();
  last_interrupt_index = (last_interrupt_index + 1) % 5;
  interrupts[last_interrupt_index] = new Date();
  const now = new Date();
  if (interrupts.filter((x) => now.getTime() - x.getTime() < 1000).length >= 3) {
    signalInterrupt();
  }
}

function softInterrupt() {
  try {
    g_connection.sendNotification('repl/interrupt');
  } catch (err) {
    console.warn(err);
  }
}

function signalInterrupt() {
  try {
    if (process.platform !== 'win32') {
      g_terminal.processId.then((pid) => process.kill(pid, 'SIGINT'));
    } else {
      console.warn('Signal interrupts are not supported on Windows.');
    }
  } catch (err) {
    console.warn(err);
  }
}

async function cdToHere(uri: qv.Uri) {
  const uriPath = await getDirUriFsPath(uri);
  await startREPL(true, false);
  if (uriPath) {
    try {
      g_connection.sendNotification('repl/cd', { uri: uriPath });
    } catch (err) {
      console.log(err);
    }
  }
}

async function activateHere(uri: qv.Uri) {
  const uriPath = await getDirUriFsPath(uri);
  activatePath(uriPath);
}

async function activatePath(path: string) {
  await startREPL(true, false);
  if (path) {
    try {
      g_connection.sendNotification('repl/activateProject', { uri: path });
      switchEnvToPath(path, true);
    } catch (err) {
      console.log(err);
    }
  }
}

async function activateFromDir(uri: qv.Uri) {
  const uriPath = await getDirUriFsPath(uri);
  if (uriPath) {
    try {
      const target = await searchUpFile('Project.toml', uriPath);
      if (!target) {
        qv.window.showWarningMessage(`No project file found for ${uriPath}`);
        return;
      }
      activatePath(path.dirname(target));
    } catch (err) {
      console.log(err);
    }
  }
}

async function searchUpFile(target: string, from: string): Promise<string> {
  const parentDir = path.dirname(from);
  if (parentDir === from) {
    return undefined; // ensure to escape infinite recursion
  } else {
    const p = path.join(from, target);
    return (await fs.exists(p)) ? p : searchUpFile(target, parentDir);
  }
}

async function getDirUriFsPath(uri: qv.Uri | undefined) {
  if (!uri) {
    const ed = qv.window.activeTextEditor;
    if (ed && ed.document && ed.document.uri) {
      uri = ed.document.uri;
    }
  }
  if (!uri || !uri.fsPath) {
    return undefined;
  }

  const uriPath = uri.fsPath;
  const stat = await fs.stat(uriPath);
  if (stat.isFile()) {
    return path.dirname(uriPath);
  } else if (stat.isDirectory()) {
    return uriPath;
  } else {
    return undefined;
  }
}

export async function replStartDebugger(pipename: string) {
  await startREPL(true);

  g_connection.sendNotification(notifyTypeReplStartDebugger, { debugPipename: pipename });
}

export function activate(context: qv.ExtensionContext) {
  g_context = context;

  context.subscriptions.push(
    onSetLanguageClient((languageClient) => {
      g_languageClient = languageClient;
    }),
    onInit((connection) => {
      connection.onNotification(notifyTypeDisplay, plots.displayPlot);
      connection.onNotification(notifyTypeDebuggerRun, debuggerRun);
      connection.onNotification(notifyTypeDebuggerEnter, debuggerEnter);
      connection.onNotification(notifyTypeReplStartEval, () => g_onStartEval.fire(null));
      connection.onNotification(notifyTypeReplFinishEval, () => g_onFinishEval.fire(null));
      connection.onNotification(notifyTypeShowProfilerResult, showProfileResult);
      connection.onNotification(notifyTypeShowProfilerResultFile, showProfileResultFile);
      connection.onNotification(notifyTypeProgress, updateProgress);
      setContext('isJuliaEvaluating', false);
      setContext('hasJuliaREPL', true);
    }),
    onExit(() => {
      results.removeAll();
      setContext('isJuliaEvaluating', false);
      setContext('hasJuliaREPL', false);
    }),
    onStartEval(() => {
      updateProgress({
        name: 'Evaluating…',
        id: { value: -1 },
        fraction: -1,
        done: false,
      });
      setContext('isJuliaEvaluating', true);
    }),
    onFinishEval(() => {
      clearProgress();
      setContext('isJuliaEvaluating', false);
    }),
    qv.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('julia.usePlotPane')) {
        try {
          g_connection.sendNotification('repl/togglePlotPane', { enable: qv.workspace.getConfiguration('julia').get('usePlotPane') });
        } catch (err) {
          console.warn(err);
        }
      } else if (event.affectsConfiguration('julia.useProgressFrontend')) {
        try {
          g_connection.sendNotification('repl/toggleProgress', { enable: qv.workspace.getConfiguration('julia').get('useProgressFrontend') });
        } catch (err) {
          console.warn(err);
        }
      }
    }),
    qv.window.onDidChangeActiveTerminal((terminal) => {
      if (terminal === g_terminal) {
        setContext('isJuliaREPL', true);
      } else {
        setContext('isJuliaREPL', false);
      }
    }),
    qv.window.onDidCloseTerminal((terminal) => {
      if (terminal === g_terminal) {
        g_terminal = null;
      }
    }),

    registerCommand('language-julia.startREPL', startREPLCommand),
    registerCommand('language-julia.stopREPL', killREPL),
    registerCommand('language-julia.selectBlock', selectJuliaBlock),
    registerCommand('language-julia.executeCodeBlockOrSelection', evaluateBlockOrSelection),
    registerCommand('language-julia.executeCodeBlockOrSelectionAndMove', () => evaluateBlockOrSelection(true)),
    registerCommand('language-julia.executeCell', executeCell),
    registerCommand('language-julia.executeCellAndMove', () => executeCell(true)),
    registerCommand('language-julia.moveCellUp', moveCellUp),
    registerCommand('language-julia.moveCellDown', moveCellDown),
    registerCommand('language-julia.executeFile', executeFile),
    registerCommand('language-julia.interrupt', interrupt),
    registerCommand('language-julia.executeJuliaCodeInREPL', executeSelectionCopyPaste), // copy-paste selection into REPL. doesn't require LS to be started
    registerCommand('language-julia.cdHere', cdToHere),
    registerCommand('language-julia.activateHere', activateHere),
    registerCommand('language-julia.activateFromDir', activateFromDir)
  );

  const terminalConfig = qv.workspace.getConfiguration('terminal.integrated');
  const shellSkipCommands: Array<String> = terminalConfig.get('commandsToSkipShell');
  if (shellSkipCommands.indexOf('language-julia.interrupt') === -1) {
    shellSkipCommands.push('language-julia.interrupt');
    terminalConfig.update('commandsToSkipShell', shellSkipCommands, true);
  }

  results.activate(context);
  plots.activate(context);
  workspace.activate(context);
  modules.activate(context);
}
