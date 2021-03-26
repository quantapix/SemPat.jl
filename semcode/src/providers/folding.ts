import * as vsc from 'vscode';
import type * as Proto from '../protocol';
import { ServiceClient } from '../service';
import API from '../../old/ts/utils/api';
import { condRegistration, requireMinVer } from '../registration';
import * as qu from '../utils';

class Folding implements vsc.FoldingRangeProvider {
  public static readonly minVer = API.v280;
  public constructor(private readonly client: ServiceClient) {}

  async provideFoldingRanges(d: vsc.TextDocument, _: vsc.FoldingContext, t: vsc.CancellationToken): Promise<vsc.FoldingRange[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return;
    const xs: Proto.FileRequestArgs = { file: f };
    const y = await this.client.execute('getOutliningSpans', xs, t);
    if (y.type !== 'response' || !y.body) return;
    return qu.coalesce(y.body.map((s) => this.convertOutliningSpan(s, d)));
  }

  private convertOutliningSpan(s: Proto.OutliningSpan, d: vsc.TextDocument): vsc.FoldingRange | undefined {
    const r = qu.Range.fromTextSpan(s.textSpan);
    if (s.kind === 'comment') {
      const x = d.lineAt(r.start.line).text;
      if (x.match(/\/\/\s*#endregion/gi)) return undefined;
    }
    const b = r.start.line;
    const e = this.adjustFoldingEnd(r, d);
    return new vsc.FoldingRange(b, e, Folding.getFoldingRangeKind(s));
  }

  private static readonly endPairChars = ['}', ']', ')', '`'];

  private adjustFoldingEnd(r: vsc.Range, d: vsc.TextDocument) {
    if (r.end.character > 0) {
      const e = d.getText(new vsc.Range(r.end.translate(0, -1), r.end));
      if (Folding.endPairChars.includes(e)) return Math.max(r.end.line - 1, r.start.line);
    }
    return r.end.line;
  }

  private static getFoldingRangeKind(s: Proto.OutliningSpan): vsc.FoldingRangeKind | undefined {
    switch (s.kind) {
      case 'comment':
        return vsc.FoldingRangeKind.Comment;
      case 'region':
        return vsc.FoldingRangeKind.Region;
      case 'imports':
        return vsc.FoldingRangeKind.Imports;
      case 'code':
      default:
        return undefined;
    }
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient): vsc.Disposable {
  return condRegistration([requireMinVer(c, Folding.minVer)], () => {
    return vsc.languages.registerFoldingRangeProvider(s.syntax, new Folding(c));
  });
}
