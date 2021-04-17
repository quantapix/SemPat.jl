import * as qv from 'vscode';
import type * as qp from '../server/proto';
import { ServiceClient } from '../server/service';
import API from '../utils/env';
import { conditionalRegistration, requireMinVersion, requireConfig, Condition } from '../../../src/registration';
import { Disposable } from '../utils/base';
import { DocumentSelector } from '../utils/base';
import * as qu from '../utils/base';

class TagClosing extends Disposable {
  public static readonly minVersion = API.v300;
  private _disposed = false;
  private _timeout: NodeJS.Timer | undefined = undefined;
  private _cancel: qv.CancellationTokenSource | undefined = undefined;
  constructor(private readonly client: ServiceClient) {
    super();
    qv.workspace.onDidChangeTextDocument((event) => this.onDidChangeTextDocument(event.document, event.contentChanges), null, this._disposables);
  }
  public dispose() {
    super.dispose();
    this._disposed = true;
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = undefined;
    }
    if (this._cancel) {
      this._cancel.cancel();
      this._cancel.dispose();
      this._cancel = undefined;
    }
  }
  private onDidChangeTextDocument(d: qv.TextDocument, changes: readonly qv.TextDocumentContentChangeEvent[]) {
    const activeDocument = qv.window.activeTextEditor && qv.window.activeTextEditor.document;
    if (d !== activeDocument || changes.length === 0) return;
    const filepath = this.client.toOpenedFilePath(d);
    if (!filepath) return;
    if (typeof this._timeout !== 'undefined') clearTimeout(this._timeout);
    if (this._cancel) {
      this._cancel.cancel();
      this._cancel.dispose();
      this._cancel = undefined;
    }
    const lastChange = changes[changes.length - 1];
    const lastCharacter = lastChange.text[lastChange.text.length - 1];
    if (lastChange.rangeLength > 0 || (lastCharacter !== '>' && lastCharacter !== '/')) return;
    const priorCharacter = lastChange.range.start.character > 0 ? d.getText(new qv.Range(lastChange.range.start.translate({ characterDelta: -1 }), lastChange.range.start)) : '';
    if (priorCharacter === '>') return;
    const version = d.version;
    this._timeout = setTimeout(async () => {
      this._timeout = undefined;
      if (this._disposed) return;
      const addedLines = lastChange.text.split(/\r\n|\n/g);
      const position =
        addedLines.length <= 1
          ? lastChange.range.start.translate({ characterDelta: lastChange.text.length })
          : new qv.Position(lastChange.range.start.line + addedLines.length - 1, addedLines[addedLines.length - 1].length);
      const args: qp.JsxClosingTagRequestArgs = qu.Position.toFileLocationRequestArgs(filepath, position);
      this._cancel = new qv.CancellationTokenSource();
      const response = await this.client.execute('jsxClosingTag', args, this._cancel.token);
      if (response.type !== 'response' || !response.body) return;
      if (this._disposed) return;
      const activeEditor = qv.window.activeTextEditor;
      if (!activeEditor) return;
      const insertion = response.body;
      const activeDocument = activeEditor.document;
      if (d === activeDocument && activeDocument.version === version) activeEditor.insertSnippet(this.getTagSnippet(insertion), this.getInsertionPositions(activeEditor, position));
    }, 100);
  }
  private getTagSnippet(i: qp.TextInsertion): qv.SnippetString {
    const y = new qv.SnippetString();
    y.appendPlaceholder('', 0);
    y.appendText(i.newText);
    return y;
  }
  private getInsertionPositions(e: qv.TextEditor, p: qv.Position) {
    const ps = e.selections.map((s) => s.active);
    return ps.some((p) => p.isEqual(p)) ? ps : p;
  }
}
function requireActiveDocument(s: qv.DocumentSelector) {
  return new Condition(
    () => {
      const e = qv.window.activeTextEditor;
      return !!(e && qv.languages.match(s, e.document));
    },
    (x) => {
      return qv.Disposable.from(qv.window.onDidChangeActiveTextEditor(x), qv.workspace.onDidOpenTextDocument(x));
    }
  );
}
export function register(s: DocumentSelector, id: string, c: ServiceClient) {
  return conditionalRegistration([requireMinVersion(c, TagClosing.minVersion), requireConfig(id, 'autoClosingTags'), requireActiveDocument(s.syntax)], () => new TagClosing(c));
}
