import * as os from 'os';
import * as path from 'path';
import * as vsc from 'vscode';
import * as vslc from 'vscode-languageclient';
import { uuid } from 'uuidv4';

export function startSpinner(m: string) {
  vsc.window.setStatusBarMessage(`Rust: $(settings-gear~spin) ${m}`);
}

export function stopSpinner(m?: string) {
  vsc.window.setStatusBarMessage(m ? `Rust: ${m}` : 'Rust');
}

export function constructCommandString(c: string, xs = {}) {
  return `command:${c}?${encodeURIComponent(JSON.stringify(xs))}`;
}

export function getVersionedParamsAtPosition(d: vsc.TextDocument, p: vsc.Position): VersionedTextDocumentPositionParams {
  return {
    textDocument: vslc.TextDocumentIdentifier.create(d.uri.toString()),
    version: d.version,
    position: p,
  };
}

export function setContext(k: string, v: boolean) {
  vsc.commands.executeCommand('setContext', k, v);
}

export function generatePipeName(pid: string, n: string) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\' + n + '-' + pid;
  else return path.join(os.tmpdir(), n + '-' + pid);
}

export function inferJuliaNumThreads(): string {
  const config: number | undefined = vsc.workspace.getConfiguration('julia').get('NumThreads') ?? undefined;
  const env: string | undefined = process.env['JULIA_NUM_THREADS'];
  if (config !== undefined) {
    return config.toString();
  } else if (env !== undefined) {
    return env;
  } else {
    return '';
  }
}

export function activate(c: vsc.ExtensionContext) {
  c.subscriptions.push(vsc.commands.registerCommand('language-julia.applytextedit', applyTextEdit));
  c.subscriptions.push(vsc.commands.registerCommand('language-julia.toggleLinter', toggleLinter));
}

function applyTextEdit(x: any) {
  const we = new vsc.WorkspaceEdit();
  for (const e of x.documentChanges[0].edits) {
    we.replace(x.documentChanges[0].textDocument.uri, new vsc.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText);
  }
  vsc.workspace.applyEdit(we);
}

function toggleLinter() {
  const cval = vsc.workspace.getConfiguration('julia').get('lint.run', false);
  vsc.workspace.getConfiguration('julia').update('lint.run', !cval, true);
}

const g_profilerResults = new Map<string, string>();

export class ProfilerResultsProvider implements vsc.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vsc.Uri) {
    return g_profilerResults.get(uri.toString());
  }
}

export function addProfilerResult(uri: vsc.Uri, content: string) {
  g_profilerResults.set(uri.toString(), content);
}

export async function showProfileResult(params: { content: string }) {
  const new_uuid = uuid();
  const uri = vsc.Uri.parse('juliavsodeprofilerresults:' + new_uuid.toString() + '.cpuprofile');
  addProfilerResult(uri, params.content);
  const doc = await vsc.workspace.openTextDocument(uri);
  await vsc.window.showTextDocument(doc, { preview: false });
}

export async function showProfileResultFile(params: { filename: string }) {
  const uri = vsc.Uri.file(params.filename);
  await vsc.commands.executeCommand('vsc.open', uri, {
    preserveFocuse: true,
    preview: false,
    viewColumn: vsc.ViewColumn.Beside,
  });
}

export interface VersionedTextDocumentPositionParams {
  textDocument: vslc.TextDocumentIdentifier;
  version: number;
  position: vsc.Position;
}
