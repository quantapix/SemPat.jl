import * as lc from 'vscode-languageclient';
import * as qv from 'vscode';
import * as ra from './lsp_ext';

import { Ctx, Disposable } from './ctx';
import { sendRequestWithRetry, isRustDocument, RustDocument, RustEditor, sleep } from './util';

export function activateInlayHints(ctx: Ctx) {
  const maybeUpdater = {
    updater: null as null | HintsUpdater,
    async onConfigChange() {
      const anyEnabled = ctx.config.inlayHints.typeHints || ctx.config.inlayHints.parameterHints || ctx.config.inlayHints.chainingHints;
      const enabled = ctx.config.inlayHints.enable && anyEnabled;

      if (!enabled) return this.dispose();

      await sleep(100);
      if (this.updater) {
        this.updater.syncCacheAndRenderHints();
      } else {
        this.updater = new HintsUpdater(ctx);
      }
    },
    dispose() {
      this.updater?.dispose();
      this.updater = null;
    },
  };

  ctx.pushCleanup(maybeUpdater);

  qv.workspace.onDidChangeConfiguration(maybeUpdater.onConfigChange, maybeUpdater, ctx.subscriptions);

  maybeUpdater.onConfigChange();
}

const typeHints = {
  decorationType: qv.window.createTextEditorDecorationType({
    after: {
      color: new qv.ThemeColor('rust_analyzer.inlayHint'),
      fontStyle: 'normal',
    },
  }),

  toDecoration(hint: ra.InlayHint.TypeHint, conv: lc.Protocol2CodeConverter): qv.DecorationOptions {
    return {
      range: conv.asRange(hint.range),
      renderOptions: { after: { contentText: `: ${hint.label}` } },
    };
  },
};

const paramHints = {
  decorationType: qv.window.createTextEditorDecorationType({
    before: {
      color: new qv.ThemeColor('rust_analyzer.inlayHint'),
      fontStyle: 'normal',
    },
  }),

  toDecoration(hint: ra.InlayHint.ParamHint, conv: lc.Protocol2CodeConverter): qv.DecorationOptions {
    return {
      range: conv.asRange(hint.range),
      renderOptions: { before: { contentText: `${hint.label}: ` } },
    };
  },
};

const chainingHints = {
  decorationType: qv.window.createTextEditorDecorationType({
    after: {
      color: new qv.ThemeColor('rust_analyzer.inlayHint'),
      fontStyle: 'normal',
    },
  }),

  toDecoration(hint: ra.InlayHint.ChainingHint, conv: lc.Protocol2CodeConverter): qv.DecorationOptions {
    return {
      range: conv.asRange(hint.range),
      renderOptions: { after: { contentText: ` ${hint.label}` } },
    };
  },
};

class HintsUpdater implements Disposable {
  private sourceFiles = new Map<string, RustSourceFile>(); // map Uri -> RustSourceFile
  private readonly disposables: Disposable[] = [];

  constructor(private readonly ctx: Ctx) {
    qv.window.onDidChangeVisibleTextEditors(this.onDidChangeVisibleTextEditors, this, this.disposables);

    qv.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, this.disposables);

    ctx.visibleRustEditors.forEach((editor) =>
      this.sourceFiles.set(editor.document.uri.toString(), {
        document: editor.document,
        inlaysRequest: null,
        cachedDecorations: null,
      })
    );

    this.syncCacheAndRenderHints();
  }

  dispose() {
    this.sourceFiles.forEach((file) => file.inlaysRequest?.cancel());
    this.ctx.visibleRustEditors.forEach((editor) => this.renderDecorations(editor, { param: [], type: [], chaining: [] }));
    this.disposables.forEach((d) => d.dispose());
  }

  onDidChangeTextDocument({ contentChanges, document }: qv.TextDocumentChangeEvent) {
    if (contentChanges.length === 0 || !isRustDocument(document)) return;
    this.syncCacheAndRenderHints();
  }

  syncCacheAndRenderHints() {
    this.sourceFiles.forEach((file, uri) =>
      this.fetchHints(file).then((hints) => {
        if (!hints) return;

        file.cachedDecorations = this.hintsToDecorations(hints);

        for (const editor of this.ctx.visibleRustEditors) {
          if (editor.document.uri.toString() === uri) {
            this.renderDecorations(editor, file.cachedDecorations);
          }
        }
      })
    );
  }

  onDidChangeVisibleTextEditors() {
    const newSourceFiles = new Map<string, RustSourceFile>();

    this.ctx.visibleRustEditors.forEach(async (editor) => {
      const uri = editor.document.uri.toString();
      const file = this.sourceFiles.get(uri) ?? {
        document: editor.document,
        inlaysRequest: null,
        cachedDecorations: null,
      };
      newSourceFiles.set(uri, file);

      if (!file.cachedDecorations) {
        const hints = await this.fetchHints(file);
        if (!hints) return;

        file.cachedDecorations = this.hintsToDecorations(hints);
      }

      this.renderDecorations(editor, file.cachedDecorations);
    });

    this.sourceFiles.forEach((file, uri) => {
      if (!newSourceFiles.has(uri)) file.inlaysRequest?.cancel();
    });

    this.sourceFiles = newSourceFiles;
  }

  private renderDecorations(editor: RustEditor, decorations: InlaysDecorations) {
    editor.setDecorations(typeHints.decorationType, decorations.type);
    editor.setDecorations(paramHints.decorationType, decorations.param);
    editor.setDecorations(chainingHints.decorationType, decorations.chaining);
  }

  private hintsToDecorations(hints: ra.InlayHint[]): InlaysDecorations {
    const decorations: InlaysDecorations = { type: [], param: [], chaining: [] };
    const conv = this.ctx.client.protocol2CodeConverter;

    for (const hint of hints) {
      switch (hint.kind) {
        case ra.InlayHint.Kind.TypeHint: {
          decorations.type.push(typeHints.toDecoration(hint, conv));
          continue;
        }
        case ra.InlayHint.Kind.ParamHint: {
          decorations.param.push(paramHints.toDecoration(hint, conv));
          continue;
        }
        case ra.InlayHint.Kind.ChainingHint: {
          decorations.chaining.push(chainingHints.toDecoration(hint, conv));
          continue;
        }
      }
    }
    return decorations;
  }

  private async fetchHints(file: RustSourceFile): Promise<null | ra.InlayHint[]> {
    file.inlaysRequest?.cancel();

    const tokenSource = new qv.CancellationTokenSource();
    file.inlaysRequest = tokenSource;

    const request = { textDocument: { uri: file.document.uri.toString() } };

    return sendRequestWithRetry(this.ctx.client, ra.inlayHints, request, tokenSource.token)
      .catch((_) => null)
      .finally(() => {
        if (file.inlaysRequest === tokenSource) {
          file.inlaysRequest = null;
        }
      });
  }
}

interface InlaysDecorations {
  type: qv.DecorationOptions[];
  param: qv.DecorationOptions[];
  chaining: qv.DecorationOptions[];
}

interface RustSourceFile {
  /**
   * Source of the token to cancel in-flight inlay hints request if any.
   */
  inlaysRequest: null | qv.CancellationTokenSource;
  /**
   * Last applied decorations.
   */
  cachedDecorations: null | InlaysDecorations;

  document: RustDocument;
}
