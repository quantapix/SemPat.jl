import * as vsc from 'vscode';
import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as qu from '../utils';

class ReferenceSupport implements vsc.ReferenceProvider {
  public constructor(private readonly client: ServiceClient) {}

  public async provideReferences(d: vsc.TextDocument, p: vsc.Position, c: vsc.ReferenceContext, t: vsc.CancellationToken): Promise<vsc.Location[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('references', xs, t);
    if (v.type !== 'response' || !v.body) return [];
    const ys: vsc.Location[] = [];
    for (const r of v.body.refs) {
      if (!c.includeDeclaration && r.isDefinition) continue;
      const u = this.client.toResource(r.file);
      ys.push(qu.Location.fromTextSpan(u, r));
    }
    return ys;
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return vsc.languages.registerReferenceProvider(s.syntax, new ReferenceSupport(c));
  });
}
