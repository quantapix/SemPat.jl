import * as vsc from 'vscode';
import type * as Proto from '../protocol';
import { ServiceClient } from '../service';
import API from '../../old/ts/utils/api';
import { coalesce } from '../../old/ts/utils/arrays';
import { conditionalRegistration, requireMinVersion } from '../../old/ts/utils/dependentRegistration';
import { DocumentSelector } from '../../old/ts/utils/documentSelector';
import * as typeConverters from '../../old/ts/utils/typeConverters';

class FoldingProvider implements vsc.FoldingRangeProvider {
  public static readonly minVer = API.v280;
  public constructor(private readonly client: ServiceClient) {}

  async provideFoldingRanges(d: vsc.TextDocument, _: vsc.FoldingContext, t: vsc.CancellationToken): Promise<vsc.FoldingRange[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return;
    const xs: Proto.FileRequestArgs = { file: f };
    const y = await this.client.execute('getOutliningSpans', xs, t);
    if (y.type !== 'response' || !y.body) return;
    return coalesce(y.body.map((s) => this.convertOutliningSpan(s, d)));
  }

  private convertOutliningSpan(s: Proto.OutliningSpan, d: vsc.TextDocument): vsc.FoldingRange | undefined {
    const r = typeConverters.Range.fromTextSpan(s.textSpan);
    if (s.kind === 'comment') {
      const x = d.lineAt(r.start.line).text;
      if (x.match(/\/\/\s*#endregion/gi)) return undefined;
    }
    const b = r.start.line;
    const e = this.adjustFoldingEnd(r, d);
    return new vsc.FoldingRange(b, e, FoldingProvider.getFoldingRangeKind(s));
  }

  private static readonly endPairChars = ['}', ']', ')', '`'];

  private adjustFoldingEnd(r: vsc.Range, d: vsc.TextDocument) {
    if (r.end.character > 0) {
      const e = d.getText(new vsc.Range(r.end.translate(0, -1), r.end));
      if (FoldingProvider.endPairChars.includes(e)) return Math.max(r.end.line - 1, r.start.line);
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

export function register(s: DocumentSelector, c: ServiceClient): vsc.Disposable {
  return conditionalRegistration([requireMinVersion(c, FoldingProvider.minVer)], () => {
    return vsc.languages.registerFoldingRangeProvider(s.syntax, new FoldingProvider(c));
  });
}
