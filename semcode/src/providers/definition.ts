import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as qu from '../utils';
import * as qv from 'vscode';

class Base {
  constructor(protected readonly client: ServiceClient) {}
  protected async getSymbolLocations(k: 'definition' | 'implementation' | 'typeDefinition', d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Location[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute(k, xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map((l) => qu.Location.fromTextSpan(this.client.toResource(l.file), l));
  }
}

class Definition extends Base implements qv.DefinitionProvider {
  constructor(c: ServiceClient) {
    super(c);
  }
  public async provideDefinition(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.DefinitionLink[] | qv.Definition | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('definitionAndBoundSpan', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    const s = v.body.textSpan ? qu.Range.fromTextSpan(v.body.textSpan) : undefined;
    return v.body.definitions.map(
      (l): qv.DefinitionLink => {
        const target = qu.Location.fromTextSpan(this.client.toResource(l.file), l);
        if (l.contextStart && l.contextEnd) {
          return {
            originSelectionRange: s,
            targetRange: qu.Range.fromLocations(l.contextStart, l.contextEnd),
            targetUri: target.uri,
            targetSelectionRange: target.range,
          };
        }
        return {
          originSelectionRange: s,
          targetRange: target.range,
          targetUri: target.uri,
        };
      }
    );
  }
}

class TypeDefinition extends Base implements qv.TypeDefinitionProvider {
  public provideTypeDefinition(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Definition | undefined> {
    return this.getSymbolLocations('typeDefinition', d, p, t);
  }
}

class Implementation extends Base implements qv.ImplementationProvider {
  public provideImplementation(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Definition | undefined> {
    return this.getSymbolLocations('implementation', d, p, t);
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return [
    condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
      return qv.languages.registerDefinitionProvider(s.syntax, new Definition(c));
    }),
    condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
      return qv.languages.registerTypeDefinitionProvider(s.syntax, new TypeDefinition(c));
    }),
    condRegistration([requireSomeCap(c, ClientCap.Semantic)], () => {
      return qv.languages.registerImplementationProvider(s.semantic, new Implementation(c));
    }),
  ];
}
