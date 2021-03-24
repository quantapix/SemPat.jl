import * as vscode from 'vscode';
import * as telemetry from './telemetry';
import { registerCommand } from './utils';

function toggleLinter() {
  telemetry.traceEvent('command-togglelinter');

  const cval = vscode.workspace.getConfiguration('julia').get('lint.run', false);
  vscode.workspace.getConfiguration('julia').update('lint.run', !cval, true);
}

function applyTextEdit(we) {
  telemetry.traceEvent('command-applytextedit');

  const wse = new vscode.WorkspaceEdit();
  for (const edit of we.documentChanges[0].edits) {
    wse.replace(we.documentChanges[0].textDocument.uri, new vscode.Range(edit.range.start.line, edit.range.start.character, edit.range.end.line, edit.range.end.character), edit.newText);
  }
  vscode.workspace.applyEdit(wse);
}

// function lintPackage() {
//     telemetry.traceEvent('command-lintpackage');

//     if (g_languageClient == null) {
//         vscode.window.showErrorMessage('Error: package linting only works with a running julia language server.');
//     }
//     else {
//         try {
//             g_languageClient.sendRequest("julia/lint-package");
//         }
//         catch (ex) {
//             if (ex.message == "Language client is not ready yet") {
//                 vscode.window.showErrorMessage('Error: package linting only works with a running julia language server.');
//             }
//             else {
//                 throw ex;
//             }
//         }
//     }
// }

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(registerCommand('language-julia.applytextedit', applyTextEdit));
  context.subscriptions.push(registerCommand('language-julia.toggleLinter', toggleLinter));
}
