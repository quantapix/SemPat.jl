import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { ServiceClient } from '../service';
import * as qu from '../utils';

class Highlight implements vscode.DocumentHighlightProvider {
  public constructor(private readonly client: ServiceClient) {}

  public async provideDocumentHighlights(d: vscode.TextDocument, p: vscode.Position, t: vscode.CancellationToken): Promise<vscode.DocumentHighlight[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    const xs = {
      ...qu.Position.toFileLocationRequestArgs(f, p),
      filesToSearch: [f],
    };
    const y = await this.client.execute('documentHighlights', xs, t);
    if (y.type !== 'response' || !y.body) return [];
    return qu.flatten(y.body.filter((highlight) => highlight.file === f).map(convertDocumentHighlight));
  }
}

function convertDocumentHighlight(i: Proto.DocumentHighlightsItem): ReadonlyArray<vscode.DocumentHighlight> {
  return i.highlightSpans.map((s) => new vscode.DocumentHighlight(qu.Range.fromTextSpan(s), s.kind === 'writtenReference' ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read));
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return vscode.languages.registerDocumentHighlightProvider(s.syntax, new Highlight(c));
}
