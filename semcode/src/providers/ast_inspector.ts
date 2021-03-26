import * as qv from 'vscode';
import * as qu from '../utils';
import { Ctx, Disposable } from '../../old/rs/analyzer/ctx';
import { RustEditor, isRustEditor } from '../../old/rs/analyzer/util';

export class AstInspector implements qv.HoverProvider, qv.DefinitionProvider, Disposable {
  private readonly astDecorationType = qv.window.createTextEditorDecorationType({
    borderColor: new qv.ThemeColor('rust_analyzer.syntaxTreeBorder'),
    borderStyle: 'solid',
    borderWidth: '2px',
  });
  private rustEditor: undefined | RustEditor;

  private readonly rust2Ast = new qu.Lazy(() => {
    const astEditor = this.findAstTextEditor();
    if (!this.rustEditor || !astEditor) return undefined;
    const buf: [qv.Range, qv.Range][] = [];
    for (let i = 0; i < astEditor.document.lineCount; ++i) {
      const astLine = astEditor.document.lineAt(i);
      const isTokenNode = astLine.text.lastIndexOf('"') >= 0;
      if (!isTokenNode) continue;
      const rustRange = this.parseRustTextRange(this.rustEditor.document, astLine.text);
      if (!rustRange) continue;
      buf.push([rustRange, this.findAstNodeRange(astLine)]);
    }
    return buf;
  });

  constructor(ctx: Ctx) {
    ctx.pushCleanup(qv.languages.registerHoverProvider({ scheme: 'rust-analyzer' }, this));
    ctx.pushCleanup(qv.languages.registerDefinitionProvider({ language: 'rust' }, this));
    qv.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, ctx.subscriptions);
    qv.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, ctx.subscriptions);
    qv.window.onDidChangeVisibleTextEditors(this.onDidChangeVisibleTextEditors, this, ctx.subscriptions);
    ctx.pushCleanup(this);
  }
  dispose() {
    this.setRustEditor(undefined);
  }

  private onDidChangeTextDocument(e: qv.TextDocumentChangeEvent) {
    if (this.rustEditor && e.document.uri.toString() === this.rustEditor.document.uri.toString()) {
      this.rust2Ast.reset();
    }
  }

  private onDidCloseTextDocument(d: qv.TextDocument) {
    if (this.rustEditor && d.uri.toString() === this.rustEditor.document.uri.toString()) {
      this.setRustEditor(undefined);
    }
  }

  private onDidChangeVisibleTextEditors(es: qv.TextEditor[]) {
    if (!this.findAstTextEditor()) {
      this.setRustEditor(undefined);
      return;
    }
    this.setRustEditor(es.find(isRustEditor));
  }

  private findAstTextEditor(): undefined | qv.TextEditor {
    return qv.window.visibleTextEditors.find((it) => it.document.uri.scheme === 'rust-analyzer');
  }

  private setRustEditor(e?: RustEditor) {
    if (this.rustEditor && this.rustEditor !== e) {
      this.rustEditor.setDecorations(this.astDecorationType, []);
      this.rust2Ast.reset();
    }
    this.rustEditor = e;
  }

  provideDefinition(doc: qv.TextDocument, pos: qv.Position): qv.ProviderResult<qv.DefinitionLink[]> {
    if (!this.rustEditor || doc.uri.toString() !== this.rustEditor.document.uri.toString()) return;
    const astEditor = this.findAstTextEditor();
    if (!astEditor) return;
    const rust2AstRanges = this.rust2Ast.get()?.find(([rustRange, _]) => rustRange.contains(pos));
    if (!rust2AstRanges) return;
    const [rustFileRange, astFileRange] = rust2AstRanges;
    astEditor.revealRange(astFileRange);
    astEditor.selection = new qv.Selection(astFileRange.start, astFileRange.end);
    return [
      {
        targetRange: astFileRange,
        targetUri: astEditor.document.uri,
        originSelectionRange: rustFileRange,
        targetSelectionRange: astFileRange,
      },
    ];
  }

  provideHover(doc: qv.TextDocument, hoverPosition: qv.Position): qv.ProviderResult<qv.Hover> {
    if (!this.rustEditor) return;
    const astFileLine = doc.lineAt(hoverPosition.line);
    const rustFileRange = this.parseRustTextRange(this.rustEditor.document, astFileLine.text);
    if (!rustFileRange) return;
    this.rustEditor.setDecorations(this.astDecorationType, [rustFileRange]);
    this.rustEditor.revealRange(rustFileRange);
    const rustSourceCode = this.rustEditor.document.getText(rustFileRange);
    const astFileRange = this.findAstNodeRange(astFileLine);
    return new qv.Hover(['```rust\n' + rustSourceCode + '\n```'], astFileRange);
  }

  private findAstNodeRange(l: qv.TextLine): qv.Range {
    const lineOffset = l.range.start;
    const begin = lineOffset.translate(undefined, l.firstNonWhitespaceCharacterIndex);
    const end = lineOffset.translate(undefined, l.text.trimEnd().length);
    return new qv.Range(begin, end);
  }

  private parseRustTextRange(doc: qv.TextDocument, astLine: string): undefined | qv.Range {
    const parsedRange = /(\d+)\.\.(\d+)/.exec(astLine);
    if (!parsedRange) return;
    const [begin, end] = parsedRange.slice(1).map((off) => this.positionAt(doc, +off));
    return new qv.Range(begin, end);
  }

  cache?: { doc: qv.TextDocument; offset: number; line: number };

  positionAt(doc: qv.TextDocument, targetOffset: number): qv.Position {
    if (doc.eol === qv.EndOfLine.LF) return doc.positionAt(targetOffset);
    let line = 0;
    let offset = 0;
    const cache = this.cache;
    if (cache?.doc === doc && cache.offset <= targetOffset) ({ line, offset } = cache);
    while (true) {
      const lineLenWithLf = doc.lineAt(line).text.length + 1;
      if (offset + lineLenWithLf > targetOffset) {
        this.cache = { doc, offset, line };
        return doc.positionAt(targetOffset + line);
      }
      offset += lineLenWithLf;
      line += 1;
    }
  }
}
