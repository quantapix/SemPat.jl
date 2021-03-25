import * as vsc from 'vscode';
import type * as Proto from '../protocol';
import { ServiceClient } from '../service';
import { conditionalRegistration, requireConfiguration } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as typeConverters from '../utils/typeConverters';
import FileConfigurationManager from './fileConfigurationManager';

class FormattingProvider implements vsc.DocumentRangeFormattingEditProvider, vsc.OnTypeFormattingEditProvider {
  public constructor(private readonly client: ServiceClient, private readonly manager: FileConfigurationManager) {}

  public async provideDocumentRangeFormattingEdits(d: vsc.TextDocument, r: vsc.Range, opts: vsc.FormattingOptions, t: vsc.CancellationToken): Promise<vsc.TextEdit[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    await this.manager.ensureConfigurationOptions(d, opts, t);
    const xs = typeConverters.Range.toFormattingRequestArgs(f, r);
    const y = await this.client.execute('format', xs, t);
    if (y.type !== 'response' || !y.body) return undefined;
    return y.body.map(typeConverters.TextEdit.fromCodeEdit);
  }

  public async provideOnTypeFormattingEdits(d: vsc.TextDocument, p: vsc.Position, k: string, opts: vsc.FormattingOptions, t: vsc.CancellationToken): Promise<vsc.TextEdit[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    await this.manager.ensureConfigurationOptions(d, opts, t);
    const xs: Proto.FormatOnKeyRequestArgs = {
      ...typeConverters.Position.toFileLocationRequestArgs(f, p),
      key: k,
    };
    const response = await this.client.execute('formatonkey', xs, t);
    if (response.type !== 'response' || !response.body) return [];
    const ys: vsc.TextEdit[] = [];
    for (const b of response.body) {
      const e = typeConverters.TextEdit.fromCodeEdit(b);
      const r = e.range;
      if (r.start.character === 0 && r.start.line === r.end.line && e.newText === '') {
        const x = d.lineAt(r.start.line).text;
        if (x.trim().length > 0 || x.length > r.end.character) ys.push(e);
      } else ys.push(e);
    }
    return ys;
  }
}

export function register(s: DocumentSelector, modeId: string, c: ServiceClient, m: FileConfigurationManager) {
  return conditionalRegistration([requireConfiguration(modeId, 'format.enable')], () => {
    const p = new FormattingProvider(c, m);
    return vsc.Disposable.from(vsc.languages.registerOnTypeFormattingEditProvider(s.syntax, p, ';', '}', '\n'), vsc.languages.registerDocumentRangeFormattingEditProvider(s.syntax, p));
  });
}
