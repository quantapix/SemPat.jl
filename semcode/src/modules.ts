import * as qv from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as vslc from 'vscode-languageclient/node';
import { onSetLanguageClient } from './extension';
import { registerCommand } from './utils';
import { VersionedTextDocumentPositionParams } from './misc';
import { onExit, onInit } from './repl';

let statusBarItem: qv.StatusBarItem = null;
let g_connection: rpc.MessageConnection = null;
let g_languageClient: vslc.LanguageClient = null;
let g_currentGetModuleRequestCancelTokenSource: qv.CancellationTokenSource = null;

const manuallySetDocuments = [];

const requestTypeGetModules = new rpc.RequestType<void, string[], void>('repl/loadedModules');
const requestTypeIsModuleLoaded = new rpc.RequestType<{ mod: string }, boolean, void>('repl/isModuleLoaded');

const automaticallyChooseOption = 'Choose Automatically';

export function activate(context: qv.ExtensionContext) {
  context.subscriptions.push(
    qv.window.onDidChangeActiveTextEditor((ed) => {
      cancelCurrentGetModuleRequest();
      g_currentGetModuleRequestCancelTokenSource = new qv.CancellationTokenSource();
      updateStatusBarItem(ed, g_currentGetModuleRequestCancelTokenSource.token);
    })
  );
  context.subscriptions.push(
    qv.window.onDidChangeTextEditorSelection((changeEvent) => {
      cancelCurrentGetModuleRequest();
      g_currentGetModuleRequestCancelTokenSource = new qv.CancellationTokenSource();
      updateModuleForSelectionEvent(changeEvent, g_currentGetModuleRequestCancelTokenSource.token);
    })
  );
  context.subscriptions.push(registerCommand('language-julia.chooseModule', chooseModule));

  context.subscriptions.push(
    onSetLanguageClient((languageClient) => {
      g_languageClient = languageClient;
    })
  );

  statusBarItem = qv.window.createStatusBarItem(qv.StatusBarAlignment.Right, 99);
  statusBarItem.command = 'language-julia.chooseModule';
  statusBarItem.tooltip = 'Choose Current Module';

  onInit((conn) => {
    g_connection = conn;
    updateStatusBarItem();
  });
  onExit((hadError) => {
    g_connection = null;
    updateStatusBarItem();
  });

  context.subscriptions.push(statusBarItem);
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
  if (manuallySetModule) {
    return manuallySetModule;
  }

  const languageClient = g_languageClient;

  if (!languageClient) {
    return 'Main';
  }
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
          // Is this a version mismatch situation? Only if not, rethrow
          if (err.code !== -32099) {
            throw err;
          }
        }
      } else {
        // We were canceled, so we give up
        return;
      }
    }

    // We tried three times, now give up
    return;
  } catch (err) {
    if (err.message === 'Language client is not ready yet') {
      qv.window.showErrorMessage(err);
    } else if (languageClient) {
      console.error(err);
    }
    return 'Main';
  }
}

function isJuliaEditor(editor: qv.TextEditor = qv.window.activeTextEditor) {
  return editor && editor.document.languageId === 'julia';
}

async function updateStatusBarItem(editor: qv.TextEditor = qv.window.activeTextEditor, token?: qv.CancellationToken) {
  if (isJuliaEditor(editor)) {
    statusBarItem.show();
    await updateModuleForEditor(editor, token);
  } else {
    statusBarItem.hide();
  }
}

async function updateModuleForSelectionEvent(event: qv.TextEditorSelectionChangeEvent, token?: qv.CancellationToken) {
  const editor = event.textEditor;
  await updateStatusBarItem(editor, token);
}

async function updateModuleForEditor(editor: qv.TextEditor, token?: qv.CancellationToken) {
  const mod = await getModuleForEditor(editor.document, editor.selection.start, token);
  if (mod) {
    const loaded = await isModuleLoaded(mod);
    statusBarItem.text = loaded ? mod : '(' + mod + ')';
  }
}

async function isModuleLoaded(mod: string) {
  if (!g_connection) {
    return false;
  }
  try {
    return await g_connection.sendRequest(requestTypeIsModuleLoaded, { mod: mod });
  } catch (err) {
    if (g_connection) {
      qv.window.showErrorMessage(err);
    }
    return false;
  }
}

async function chooseModule() {
  let possibleModules = [];
  try {
    possibleModules = await g_connection.sendRequest(requestTypeGetModules, null);
  } catch (err) {
    if (g_connection) {
      qv.window.showErrorMessage(err);
    } else {
      qv.window.showInformationMessage('Setting a module requires an active REPL.');
    }
    return;
  }

  possibleModules.sort();
  possibleModules.splice(0, 0, automaticallyChooseOption);

  const qpOptions: qv.QuickPickOptions = {
    placeHolder: 'Select module',
    canPickMany: false,
  };
  const mod = await qv.window.showQuickPick(possibleModules, qpOptions);

  const ed = qv.window.activeTextEditor;
  if (mod === automaticallyChooseOption) {
    delete manuallySetDocuments[ed.document.fileName];
  } else {
    manuallySetDocuments[ed.document.fileName] = mod;
  }

  cancelCurrentGetModuleRequest();
  g_currentGetModuleRequestCancelTokenSource = new qv.CancellationTokenSource();
  updateStatusBarItem(ed, g_currentGetModuleRequestCancelTokenSource.token);
}
