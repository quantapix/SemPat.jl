import * as qv from 'vscode';
import * as path from 'path';

export let doc: qv.TextDocument;
export let editor: qv.TextEditor;
export let documentEol: string;
export let platformEol: string;

export async function activate(docUri: qv.Uri) {
  const ext = qv.extensions.getExtension('vscode-samples.lsp-sample')!;
  await ext.activate();
  try {
    doc = await qv.workspace.openTextDocument(docUri);
    editor = await qv.window.showTextDocument(doc);
    await sleep(2000); // Wait for server activation
  } catch (e) {
    console.error(e);
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const getDocPath = (p: string) => {
  return path.resolve(__dirname, '../../testFixture', p);
};

export const getDocUri = (p: string) => {
  return qv.Uri.file(getDocPath(p));
};

export async function setTestContent(content: string): Promise<boolean> {
  const all = new qv.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  return editor.edit((eb) => eb.replace(all, content));
}
