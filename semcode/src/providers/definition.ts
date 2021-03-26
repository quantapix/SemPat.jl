import * as vsc from 'vscode';
import { ClientCap, ServiceClient } from '../service';
import * as qu from '../utils';
import { condRegistration, requireSomeCap } from '../registration';

class Base {
  constructor(protected readonly client: ServiceClient) {}
  protected async getSymbolLocations(k: 'definition' | 'implementation' | 'typeDefinition', d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.Location[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute(k, xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map((l) => qu.Location.fromTextSpan(this.client.toResource(l.file), l));
  }
}

class Definition extends Base implements vsc.DefinitionProvider {
  constructor(c: ServiceClient) {
    super(c);
  }
  public async provideDefinition(d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.DefinitionLink[] | vsc.Definition | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('definitionAndBoundSpan', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    const s = v.body.textSpan ? qu.Range.fromTextSpan(v.body.textSpan) : undefined;
    return v.body.definitions.map(
      (l): vsc.DefinitionLink => {
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

class TypeDefinition extends Base implements vsc.TypeDefinitionProvider {
  public provideTypeDefinition(d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.Definition | undefined> {
    return this.getSymbolLocations('typeDefinition', d, p, t);
  }
}

class Implementation extends Base implements vsc.ImplementationProvider {
  public provideImplementation(d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.Definition | undefined> {
    return this.getSymbolLocations('implementation', d, p, t);
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return [
    condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
      return vsc.languages.registerDefinitionProvider(s.syntax, new Definition(c));
    }),
    condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
      return vsc.languages.registerTypeDefinitionProvider(s.syntax, new TypeDefinition(c));
    }),
    condRegistration([requireSomeCap(c, ClientCap.Semantic)], () => {
      return vsc.languages.registerImplementationProvider(s.semantic, new Implementation(c));
    }),
  ];
}
