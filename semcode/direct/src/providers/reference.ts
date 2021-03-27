import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as qu from '../utils';
import * as qv from 'vscode';

class Reference implements qv.ReferenceProvider {
  public constructor(private readonly client: ServiceClient) {}

  public async provideReferences(d: qv.TextDocument, p: qv.Position, c: qv.ReferenceContext, t: qv.CancellationToken): Promise<qv.Location[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('references', xs, t);
    if (v.type !== 'response' || !v.body) return [];
    const ys: qv.Location[] = [];
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
    return qv.languages.registerReferenceProvider(s.syntax, new Reference(c));
  });
}
