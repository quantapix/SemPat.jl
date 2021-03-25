import * as vsc from 'vscode';
import type * as Proto from '../protocol';
import { ClientCap, ServiceClient, ServerType } from '../service';
import { conditionalRegistration, requireSomeCapability } from '../../old/ts/utils/dependentRegistration';
import { DocumentSelector } from '../../old/ts/utils/documentSelector';
import { markdownDocumentation } from '../../old/ts/utils/previewer';
import * as typeConverters from '../../old/ts/utils/typeConverters';

class HoverProvider implements vsc.HoverProvider {
  public constructor(private readonly client: ServiceClient) {}

  public async provideHover(d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.Hover | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = typeConverters.Position.toFileLocationRequestArgs(f, p);
    const y = await this.client.interruptGetErr(() => this.client.execute('quickinfo', xs, t));
    if (y.type !== 'response' || !y.body) return undefined;
    return new vsc.Hover(this.getContents(d.uri, y.body, y._serverType), typeConverters.Range.fromTextSpan(y.body));
  }

  private getContents(r: vsc.Uri, d: Proto.QuickInfoResponseBody, s?: ServerType) {
    const ys: vsc.MarkdownString[] = [];
    if (d.displayString) {
      const ss: string[] = [];
      if (s === ServerType.Syntax && this.client.hasCapabilityForResource(r, ClientCap.Semantic)) ss.push('(loading...)');
      ss.push(d.displayString);
      ys.push(new vsc.MarkdownString().appendCodeblock(ss.join(' '), 'typescript'));
    }
    ys.push(markdownDocumentation(d.documentation, d.tags));
    return ys;
  }
}

export function register(s: DocumentSelector, c: ServiceClient): vsc.Disposable {
  return conditionalRegistration([requireSomeCapability(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return vsc.languages.registerHoverProvider(s.syntax, new HoverProvider(c));
  });
}
