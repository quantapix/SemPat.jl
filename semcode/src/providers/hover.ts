import { ClientCap, ServiceClient, ServerType } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import { markdownDocumentation } from '../../old/ts/utils/previewer';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';

class HoverProvider implements qv.HoverProvider {
  public constructor(private readonly client: ServiceClient) {}

  public async provideHover(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Hover | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const y = await this.client.interruptGetErr(() => this.client.execute('quickinfo', xs, t));
    if (y.type !== 'response' || !y.body) return undefined;
    return new qv.Hover(this.getContents(d.uri, y.body, y._serverType), qu.Range.fromTextSpan(y.body));
  }

  private getContents(r: qv.Uri, d: qp.QuickInfoResponseBody, s?: ServerType) {
    const ys: qv.MarkdownString[] = [];
    if (d.displayString) {
      const ss: string[] = [];
      if (s === ServerType.Syntax && this.client.hasCapabilityForResource(r, ClientCap.Semantic)) ss.push('(loading...)');
      ss.push(d.displayString);
      ys.push(new qv.MarkdownString().appendCodeblock(ss.join(' '), 'typescript'));
    }
    ys.push(markdownDocumentation(d.documentation, d.tags));
    return ys;
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient): qv.Disposable {
  return condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return qv.languages.registerHoverProvider(s.syntax, new HoverProvider(c));
  });
}
