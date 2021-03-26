import { condRegistration, requireConfig } from '../registration';
import { ServiceClient } from '../service';
import * as qu from '../utils';
import * as qv from 'vscode';
import FileConfigurationManager from './fileConfigurationManager';
import type * as qp from '../protocol';

class Formatting implements qv.DocumentRangeFormattingEditProvider, qv.OnTypeFormattingEditProvider {
  public constructor(private readonly client: ServiceClient, private readonly manager: FileConfigurationManager) {}

  public async provideDocumentRangeFormattingEdits(d: qv.TextDocument, r: qv.Range, opts: qv.FormattingOptions, t: qv.CancellationToken): Promise<qv.TextEdit[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    await this.manager.ensureConfigurationOptions(d, opts, t);
    const xs = qu.Range.toFormattingRequestArgs(f, r);
    const y = await this.client.execute('format', xs, t);
    if (y.type !== 'response' || !y.body) return undefined;
    return y.body.map(qu.TextEdit.fromCodeEdit);
  }

  public async provideOnTypeFormattingEdits(d: qv.TextDocument, p: qv.Position, k: string, opts: qv.FormattingOptions, t: qv.CancellationToken): Promise<qv.TextEdit[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    await this.manager.ensureConfigurationOptions(d, opts, t);
    const xs: qp.FormatOnKeyRequestArgs = {
      ...qu.Position.toFileLocationRequestArgs(f, p),
      key: k,
    };
    const response = await this.client.execute('formatonkey', xs, t);
    if (response.type !== 'response' || !response.body) return [];
    const ys: qv.TextEdit[] = [];
    for (const b of response.body) {
      const e = qu.TextEdit.fromCodeEdit(b);
      const r = e.range;
      if (r.start.character === 0 && r.start.line === r.end.line && e.newText === '') {
        const x = d.lineAt(r.start.line).text;
        if (x.trim().length > 0 || x.length > r.end.character) ys.push(e);
      } else ys.push(e);
    }
    return ys;
  }
}

export function register(s: qu.DocumentSelector, modeId: string, c: ServiceClient, m: FileConfigurationManager) {
  return condRegistration([requireConfig(modeId, 'format.enable')], () => {
    const p = new Formatting(c, m);
    return qv.Disposable.from(qv.languages.registerOnTypeFormattingEditProvider(s.syntax, p, ';', '}', '\n'), qv.languages.registerDocumentRangeFormattingEditProvider(s.syntax, p));
  });
}
