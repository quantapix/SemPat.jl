import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import { VersionedTextDocumentPositionParams } from './misc';
import { uuid } from 'uuidv4';

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
    return f(...xs);
  };
  return vscode.commands.registerCommand(c, ff);
}

export function activate(c: vscode.ExtensionContext) {
  c.subscriptions.push(registerCommand('language-julia.applytextedit', applyTextEdit));
  c.subscriptions.push(registerCommand('language-julia.toggleLinter', toggleLinter));
}

function applyTextEdit(x: any) {
  const we = new vscode.WorkspaceEdit();
  for (const e of x.documentChanges[0].edits) {
    we.replace(x.documentChanges[0].textDocument.uri, new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText);
  }
  vscode.workspace.applyEdit(we);
}

function toggleLinter() {
  const cval = vscode.workspace.getConfiguration('julia').get('lint.run', false);
  vscode.workspace.getConfiguration('julia').update('lint.run', !cval, true);
}

const g_profilerResults = new Map<string, string>();

export class ProfilerResultsProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri) {
    return g_profilerResults.get(uri.toString());
  }
}

export function addProfilerResult(uri: vscode.Uri, content: string) {
  g_profilerResults.set(uri.toString(), content);
}

export async function showProfileResult(params: { content: string }) {
  const new_uuid = uuid();
  const uri = vscode.Uri.parse('juliavsodeprofilerresults:' + new_uuid.toString() + '.cpuprofile');
  addProfilerResult(uri, params.content);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

export async function showProfileResultFile(params: { filename: string }) {
  const uri = vscode.Uri.file(params.filename);
  await vscode.commands.executeCommand('vscode.open', uri, {
    preserveFocuse: true,
    preview: false,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

export interface VersionedTextDocumentPositionParams {
  textDocument: vslc.TextDocumentIdentifier;
  version: number;
  position: vscode.Position;
}
