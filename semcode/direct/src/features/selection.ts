import { requireMinVer } from '../server/base';
import { ServiceClient } from '../server/service';
import * as qu from '../utils/base';
import * as qv from 'vscode';
import API from '../utils/env';
import type * as qp from '../server/proto';
class SmartSelection implements qv.SelectionRangeProvider {
  public static readonly minVersion = API.v350;
  public constructor(private readonly client: ServiceClient) {}
  public async provideSelectionRanges(d: qv.TextDocument, ps: qv.Position[], t: qv.CancellationToken): Promise<qv.SelectionRange[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs: qp.SelectionRangeRequestArgs = { file: f, locations: ps.map(qu.Position.toLocation) };
    const v = await this.client.execute('selectionRange', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map(SmartSelection.convertSelectionRange);
  }
  private static convertSelectionRange(r: qp.SelectionRange): qv.SelectionRange {
    return new qv.SelectionRange(qu.Range.fromTextSpan(r.textSpan), r.parent ? SmartSelection.convertSelectionRange(r.parent) : undefined);
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return qu.condRegistration([requireMinVer(c, SmartSelection.minVersion)], () => {
    return qv.languages.registerSelectionRangeProvider(s.syntax, new SmartSelection(c));
  });
}
