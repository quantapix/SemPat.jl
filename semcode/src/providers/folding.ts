import { condRegistration, requireMinVer } from '../registration';
import { ServiceClient } from '../service';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import type * as qp from '../protocol';

class Folding implements qv.FoldingRangeProvider {
  public static readonly minVer = API.v280;
  public constructor(private readonly client: ServiceClient) {}

  async provideFoldingRanges(d: qv.TextDocument, _: qv.FoldingContext, t: qv.CancellationToken): Promise<qv.FoldingRange[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return;
    const xs: qp.FileRequestArgs = { file: f };
    const y = await this.client.execute('getOutliningSpans', xs, t);
    if (y.type !== 'response' || !y.body) return;
    return qu.coalesce(y.body.map((s) => this.convertOutliningSpan(s, d)));
  }

  private convertOutliningSpan(s: qp.OutliningSpan, d: qv.TextDocument): qv.FoldingRange | undefined {
    const r = qu.Range.fromTextSpan(s.textSpan);
    if (s.kind === 'comment') {
      const x = d.lineAt(r.start.line).text;
      if (x.match(/\/\/\s*#endregion/gi)) return undefined;
    }
    const b = r.start.line;
    const e = this.adjustFoldingEnd(r, d);
    return new qv.FoldingRange(b, e, Folding.getFoldingRangeKind(s));
  }

  private static readonly endPairChars = ['}', ']', ')', '`'];

  private adjustFoldingEnd(r: qv.Range, d: qv.TextDocument) {
    if (r.end.character > 0) {
      const e = d.getText(new qv.Range(r.end.translate(0, -1), r.end));
      if (Folding.endPairChars.includes(e)) return Math.max(r.end.line - 1, r.start.line);
    }
    return r.end.line;
  }

  private static getFoldingRangeKind(s: qp.OutliningSpan): qv.FoldingRangeKind | undefined {
    switch (s.kind) {
      case 'comment':
        return qv.FoldingRangeKind.Comment;
      case 'region':
        return qv.FoldingRangeKind.Region;
      case 'imports':
        return qv.FoldingRangeKind.Imports;
      case 'code':
      default:
        return undefined;
    }
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient): qv.Disposable {
  return condRegistration([requireMinVer(c, Folding.minVer)], () => {
    return qv.languages.registerFoldingRangeProvider(s.syntax, new Folding(c));
  });
}
