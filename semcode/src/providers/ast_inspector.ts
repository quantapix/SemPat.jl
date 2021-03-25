import * as vsc from 'vscode';
import * as qu from '../utils';
import { Ctx, Disposable } from '../../old/rs/analyzer/ctx';
import { RustEditor, isRustEditor } from '../../old/rs/analyzer/util';

export class AstInspector implements vsc.HoverProvider, vsc.DefinitionProvider, Disposable {
  private readonly astDecorationType = vsc.window.createTextEditorDecorationType({
    borderColor: new vsc.ThemeColor('rust_analyzer.syntaxTreeBorder'),
    borderStyle: 'solid',
    borderWidth: '2px',
  });
  private rustEditor: undefined | RustEditor;

  private readonly rust2Ast = new qu.Lazy(() => {
    const astEditor = this.findAstTextEditor();
    if (!this.rustEditor || !astEditor) return undefined;
    const buf: [vsc.Range, vsc.Range][] = [];
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
    ctx.pushCleanup(vsc.languages.registerHoverProvider({ scheme: 'rust-analyzer' }, this));
    ctx.pushCleanup(vsc.languages.registerDefinitionProvider({ language: 'rust' }, this));
    vsc.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, ctx.subscriptions);
    vsc.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, ctx.subscriptions);
    vsc.window.onDidChangeVisibleTextEditors(this.onDidChangeVisibleTextEditors, this, ctx.subscriptions);
    ctx.pushCleanup(this);
  }
  dispose() {
    this.setRustEditor(undefined);
  }

  private onDidChangeTextDocument(e: vsc.TextDocumentChangeEvent) {
    if (this.rustEditor && e.document.uri.toString() === this.rustEditor.document.uri.toString()) {
      this.rust2Ast.reset();
    }
  }

  private onDidCloseTextDocument(d: vsc.TextDocument) {
    if (this.rustEditor && d.uri.toString() === this.rustEditor.document.uri.toString()) {
      this.setRustEditor(undefined);
    }
  }

  private onDidChangeVisibleTextEditors(es: vsc.TextEditor[]) {
    if (!this.findAstTextEditor()) {
      this.setRustEditor(undefined);
      return;
    }
    this.setRustEditor(es.find(isRustEditor));
  }

  private findAstTextEditor(): undefined | vsc.TextEditor {
    return vsc.window.visibleTextEditors.find((it) => it.document.uri.scheme === 'rust-analyzer');
  }

  private setRustEditor(e?: RustEditor) {
    if (this.rustEditor && this.rustEditor !== e) {
      this.rustEditor.setDecorations(this.astDecorationType, []);
      this.rust2Ast.reset();
    }
    this.rustEditor = e;
  }

  provideDefinition(doc: vsc.TextDocument, pos: vsc.Position): vsc.ProviderResult<vsc.DefinitionLink[]> {
    if (!this.rustEditor || doc.uri.toString() !== this.rustEditor.document.uri.toString()) return;
    const astEditor = this.findAstTextEditor();
    if (!astEditor) return;
    const rust2AstRanges = this.rust2Ast.get()?.find(([rustRange, _]) => rustRange.contains(pos));
    if (!rust2AstRanges) return;
    const [rustFileRange, astFileRange] = rust2AstRanges;
    astEditor.revealRange(astFileRange);
    astEditor.selection = new vsc.Selection(astFileRange.start, astFileRange.end);
    return [
      {
        targetRange: astFileRange,
        targetUri: astEditor.document.uri,
        originSelectionRange: rustFileRange,
        targetSelectionRange: astFileRange,
      },
    ];
  }

  provideHover(doc: vsc.TextDocument, hoverPosition: vsc.Position): vsc.ProviderResult<vsc.Hover> {
    if (!this.rustEditor) return;
    const astFileLine = doc.lineAt(hoverPosition.line);
    const rustFileRange = this.parseRustTextRange(this.rustEditor.document, astFileLine.text);
    if (!rustFileRange) return;
    this.rustEditor.setDecorations(this.astDecorationType, [rustFileRange]);
    this.rustEditor.revealRange(rustFileRange);
    const rustSourceCode = this.rustEditor.document.getText(rustFileRange);
    const astFileRange = this.findAstNodeRange(astFileLine);
    return new vsc.Hover(['```rust\n' + rustSourceCode + '\n```'], astFileRange);
  }

  private findAstNodeRange(l: vsc.TextLine): vsc.Range {
    const lineOffset = l.range.start;
    const begin = lineOffset.translate(undefined, l.firstNonWhitespaceCharacterIndex);
    const end = lineOffset.translate(undefined, l.text.trimEnd().length);
    return new vsc.Range(begin, end);
  }

  private parseRustTextRange(doc: vsc.TextDocument, astLine: string): undefined | vsc.Range {
    const parsedRange = /(\d+)\.\.(\d+)/.exec(astLine);
    if (!parsedRange) return;
    const [begin, end] = parsedRange.slice(1).map((off) => this.positionAt(doc, +off));
    return new vsc.Range(begin, end);
  }

  cache?: { doc: vsc.TextDocument; offset: number; line: number };

  positionAt(doc: vsc.TextDocument, targetOffset: number): vsc.Position {
    if (doc.eol === vsc.EndOfLine.LF) return doc.positionAt(targetOffset);
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
