import * as qv from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as vslc from 'vscode-languageclient/node';
import { onSetLangClient } from './extension_rs';
import { registerCommand } from './utils';
import { VersionedTextDocumentPositionParams } from './misc';
import { onExit, onInit } from './repl';

let statusBarItem: qv.StatusBarItem = null;
let g_connection: rpc.MessageConnection = null;
let g_languageClient: vslc.LangClient = null;
let g_currentGetModuleRequestCancelTokenSource: qv.CancellationTokenSource = null;
const manuallySetDocuments = [];
const requestTypeGetModules = new rpc.RequestType<void, string[], void>('repl/loadedModules');
const requestTypeIsModuleLoaded = new rpc.RequestType<{ mod: string }, boolean, void>('repl/isModuleLoaded');
const automaticallyChooseOption = 'Choose Automatically';
export function activate(c: qv.ExtensionContext) {
  c.subscriptions.push(
    qv.window.onDidChangeActiveTextEditor((x) => {
      cancelCurrentGetModuleRequest();
      g_currentGetModuleRequestCancelTokenSource = new qv.CancellationTokenSource();
      updateStatusBarItem(x, g_currentGetModuleRequestCancelTokenSource.token);
    })
  );
  c.subscriptions.push(
    qv.window.onDidChangeTextEditorSelection((x) => {
      cancelCurrentGetModuleRequest();
      g_currentGetModuleRequestCancelTokenSource = new qv.CancellationTokenSource();
      updateModuleForSelectionEvent(x, g_currentGetModuleRequestCancelTokenSource.token);
    })
  );
  c.subscriptions.push(registerCommand('language-julia.chooseModule', chooseModule));
  c.subscriptions.push(
    onSetLangClient((x) => {
      g_languageClient = x;
    })
  );
  statusBarItem = qv.window.createStatusBarItem(qv.StatusBarAlignment.Right, 99);
  statusBarItem.command = 'language-julia.chooseModule';
  statusBarItem.tooltip = 'Choose Current Module';
  onInit((x) => {
    g_connection = x;
    updateStatusBarItem();
  });
  onExit((x) => {
    g_connection = null;
    updateStatusBarItem();
  });
  c.subscriptions.push(statusBarItem);
  updateStatusBarItem();
}
function cancelCurrentGetModuleRequest() {
  if (g_currentGetModuleRequestCancelTokenSource) {
    g_currentGetModuleRequestCancelTokenSource.cancel();
    g_currentGetModuleRequestCancelTokenSource = undefined;
  }
}
export async function getModuleForEditor(document: qv.TextDocument, position: qv.Position, token?: qv.CancellationToken) {
  const manuallySetModule = manuallySetDocuments[document.fileName];
  if (manuallySetModule) return manuallySetModule;
  const languageClient = g_languageClient;
  if (!languageClient) return 'Main';
  await languageClient.onReady();
  try {
    const params: VersionedTextDocumentPositionParams = {
      textDocument: vslc.TextDocumentIdentifier.create(document.uri.toString()),
      version: document.version,
      position: position,
    };
    for (let i = 0; i < 3; i++) {
      if (token === undefined || !token.isCancellationRequested) {
        try {
          return await languageClient.sendRequest<string>('julia/getModuleAt', params);
        } catch (err) {
          if (err.code !== -32099) throw err;
        }
      } else return;
    }
    return;
  } catch (err) {
    if (err.message === 'Lang client is not ready yet') qv.window.showErrorMessage(err);
    else if (languageClient) console.error(err);
    return 'Main';
  }
}
function isJuliaEditor(e: qv.TextEditor = qv.window.activeTextEditor) {
  return e && e.document.languageId === 'julia';
}
async function updateStatusBarItem(e: qv.TextEditor = qv.window.activeTextEditor, t?: qv.CancellationToken) {
  if (isJuliaEditor(e)) {
    statusBarItem.show();
    await updateModuleForEditor(e, t);
  } else statusBarItem.hide();
}
async function updateModuleForSelectionEvent(e: qv.TextEditorSelectionChangeEvent, t?: qv.CancellationToken) {
  await updateStatusBarItem(e.textEditor, t);
}
async function updateModuleForEditor(e: qv.TextEditor, t?: qv.CancellationToken) {
  const m = await getModuleForEditor(e.document, e.selection.start, t);
  if (m) {
    const x = await isModuleLoaded(m);
    statusBarItem.text = x ? m : '(' + m + ')';
  }
}
async function isModuleLoaded(mod: string) {
  if (!g_connection) return false;
  try {
    return await g_connection.sendRequest(requestTypeIsModuleLoaded, { mod });
  } catch (e) {
    if (g_connection) qv.window.showErrorMessage(e);
    return false;
  }
}
async function chooseModule() {
  let ms = [];
  try {
    ms = await g_connection.sendRequest(requestTypeGetModules, null);
  } catch (e) {
    if (g_connection) qv.window.showErrorMessage(e);
    else qv.window.showInformationMessage('Setting a module requires an active REPL.');
    return;
  }
  ms.sort();
  ms.splice(0, 0, automaticallyChooseOption);
  const os: qv.QuickPickOptions = { placeHolder: 'Select module', canPickMany: false };
  const m = await qv.window.showQuickPick(ms, os);
  const e = qv.window.activeTextEditor;
  if (m === automaticallyChooseOption) delete manuallySetDocuments[e.document.fileName];
  else manuallySetDocuments[e.document.fileName] = m;
  cancelCurrentGetModuleRequest();
  g_currentGetModuleRequestCancelTokenSource = new qv.CancellationTokenSource();
  updateStatusBarItem(e, g_currentGetModuleRequestCancelTokenSource.token);
}
