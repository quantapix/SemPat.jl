import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ServiceClient } from '../service';
import API from '../utils/api';
import { conditionalRegistration, requireMinVersion, requireConfig, Condition } from '../../../src/registration';
import { Disposable } from '../utils/dispose';
import { DocumentSelector } from '../utils/documentSelector';
import * as qu from '../utils/qu';

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

  private onDidChangeTextDocument(document: qv.TextDocument, changes: readonly qv.TextDocumentContentChangeEvent[]) {
    const activeDocument = qv.window.activeTextEditor && qv.window.activeTextEditor.document;
    if (document !== activeDocument || changes.length === 0) {
      return;
    }

    const filepath = this.client.toOpenedFilePath(document);
    if (!filepath) {
      return;
    }

    if (typeof this._timeout !== 'undefined') {
      clearTimeout(this._timeout);
    }

    if (this._cancel) {
      this._cancel.cancel();
      this._cancel.dispose();
      this._cancel = undefined;
    }

    const lastChange = changes[changes.length - 1];
    const lastCharacter = lastChange.text[lastChange.text.length - 1];
    if (lastChange.rangeLength > 0 || (lastCharacter !== '>' && lastCharacter !== '/')) {
      return;
    }

    const priorCharacter = lastChange.range.start.character > 0 ? document.getText(new qv.Range(lastChange.range.start.translate({ characterDelta: -1 }), lastChange.range.start)) : '';
    if (priorCharacter === '>') {
      return;
    }

    const version = document.version;
    this._timeout = setTimeout(async () => {
      this._timeout = undefined;

      if (this._disposed) {
        return;
      }

      const addedLines = lastChange.text.split(/\r\n|\n/g);
      const position =
        addedLines.length <= 1
          ? lastChange.range.start.translate({ characterDelta: lastChange.text.length })
          : new qv.Position(lastChange.range.start.line + addedLines.length - 1, addedLines[addedLines.length - 1].length);

      const args: qp.JsxClosingTagRequestArgs = qu.Position.toFileLocationRequestArgs(filepath, position);
      this._cancel = new qv.CancellationTokenSource();
      const response = await this.client.execute('jsxClosingTag', args, this._cancel.token);
      if (response.type !== 'response' || !response.body) {
        return;
      }

      if (this._disposed) {
        return;
      }

      const activeEditor = qv.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }

      const insertion = response.body;
      const activeDocument = activeEditor.document;
      if (document === activeDocument && activeDocument.version === version) {
        activeEditor.insertSnippet(this.getTagSnippet(insertion), this.getInsertionPositions(activeEditor, position));
      }
    }, 100);
  }

  private getTagSnippet(closingTag: qp.TextInsertion): qv.SnippetString {
    const snippet = new qv.SnippetString();
    snippet.appendPlaceholder('', 0);
    snippet.appendText(closingTag.newText);
    return snippet;
  }

  private getInsertionPositions(editor: qv.TextEditor, position: qv.Position) {
    const activeSelectionPositions = editor.selections.map((s) => s.active);
    return activeSelectionPositions.some((p) => p.isEqual(position)) ? activeSelectionPositions : position;
  }
}

function requireActiveDocument(selector: qv.DocumentSelector) {
  return new Condition(
    () => {
      const editor = qv.window.activeTextEditor;
      return !!(editor && qv.languages.match(selector, editor.document));
    },
    (handler) => {
      return qv.Disposable.from(qv.window.onDidChangeActiveTextEditor(handler), qv.workspace.onDidOpenTextDocument(handler));
    }
  );
}

export function register(selector: DocumentSelector, modeId: string, client: ServiceClient) {
  return conditionalRegistration([requireMinVersion(client, TagClosing.minVersion), requireConfig(modeId, 'autoClosingTags'), requireActiveDocument(selector.syntax)], () => new TagClosing(client));
}
