import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as telemetry from './telemetry';
import * as vslc from 'vscode-languageclient';
import { VersionedTextDocumentPositionParams } from './misc';
import { handleNewCrashReportFromException } from './telemetry';

export function constructCommandString(c: string, xs = {}) {
  return `command:${c}?${encodeURIComponent(JSON.stringify(xs))}`;
}

export function getVersionedParamsAtPosition(d: vscode.TextDocument, p: vscode.Position): VersionedTextDocumentPositionParams {
  return {
    textDocument: vslc.TextDocumentIdentifier.create(d.uri.toString()),
    version: d.version,
    position: p,
  };
}

export function setContext(k: string, v: boolean) {
  vscode.commands.executeCommand('setContext', k, v);
}

export function generatePipeName(pid: string, n: string) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\' + n + '-' + pid;
  else return path.join(os.tmpdir(), n + '-' + pid);
}

export function inferJuliaNumThreads(): string {
  const config: number | undefined = vscode.workspace.getConfiguration('julia').get('NumThreads') ?? undefined;
  const env: string | undefined = process.env['JULIA_NUM_THREADS'];
  if (config !== undefined) {
    return config.toString();
  } else if (env !== undefined) {
    return env;
  } else {
    return '';
  }
}

export function registerCommand(c: string, f: any) {
  const ff = (...xs: any) => {
    try {
      return f(...xs);
    } catch (e) {
      handleNewCrashReportFromException(e, 'Extension');
      throw e;
    }
  };
  return vscode.commands.registerCommand(c, ff);
}

export function activate(c: vscode.ExtensionContext) {
  c.subscriptions.push(registerCommand('language-julia.applytextedit', applyTextEdit));
  c.subscriptions.push(registerCommand('language-julia.toggleLinter', toggleLinter));
}

function applyTextEdit(x: any) {
  telemetry.traceEvent('command-applytextedit');
  const we = new vscode.WorkspaceEdit();
  for (const e of x.documentChanges[0].edits) {
    we.replace(x.documentChanges[0].textDocument.uri, new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText);
  }
  vscode.workspace.applyEdit(we);
}

function toggleLinter() {
  telemetry.traceEvent('command-togglelinter');
  const cval = vscode.workspace.getConfiguration('julia').get('lint.run', false);
  vscode.workspace.getConfiguration('julia').update('lint.run', !cval, true);
}
