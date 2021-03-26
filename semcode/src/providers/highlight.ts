import { ServiceClient } from '../service';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';

class Highlight implements qv.DocumentHighlightProvider {
  public constructor(private readonly client: ServiceClient) {}

  public async provideDocumentHighlights(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.DocumentHighlight[]> {
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

function convertDocumentHighlight(i: qp.DocumentHighlightsItem): ReadonlyArray<qv.DocumentHighlight> {
  return i.highlightSpans.map((s) => new qv.DocumentHighlight(qu.Range.fromTextSpan(s), s.kind === 'writtenReference' ? qv.DocumentHighlightKind.Write : qv.DocumentHighlightKind.Read));
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return qv.languages.registerDocumentHighlightProvider(s.syntax, new Highlight(c));
}
