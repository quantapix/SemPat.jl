import * as vsc from 'vscode';
import { ClientCap, ServiceClient } from '../service';
import * as qu from '../utils';
import API from '../../old/ts/utils/api';
import { condRegistration, requireSomeCap } from '../registration';

export class DefinitionProviderBase {
  constructor(protected readonly client: ServiceClient) {}
  protected async getSymbolLocations(
    definitionType: 'definition' | 'implementation' | 'typeDefinition',
    document: vsc.TextDocument,
    position: vsc.Position,
    token: vsc.CancellationToken
  ): Promise<vsc.Location[] | undefined> {
    const file = this.client.toOpenedFilePath(document);
    if (!file) return undefined;
    const args = qu.Position.toFileLocationRequestArgs(file, position);
    const response = await this.client.execute(definitionType, args, token);
    if (response.type !== 'response' || !response.body) return undefined;
    return response.body.map((location) => qu.Location.fromTextSpan(this.client.toResource(location.file), location));
  }
}

export class DefinitionProvider extends DefinitionProviderBase implements vsc.DefinitionProvider {
  constructor(client: ServiceClient) {
    super(client);
  }
  public async provideDefinition(document: vsc.TextDocument, position: vsc.Position, token: vsc.CancellationToken): Promise<vsc.DefinitionLink[] | vsc.Definition | undefined> {
    if (this.client.apiVersion.gte(API.v270)) {
      const filepath = this.client.toOpenedFilePath(document);
      if (!filepath) return undefined;
      const args = qu.Position.toFileLocationRequestArgs(filepath, position);
      const response = await this.client.execute('definitionAndBoundSpan', args, token);
      if (response.type !== 'response' || !response.body) return undefined;
      const span = response.body.textSpan ? qu.Range.fromTextSpan(response.body.textSpan) : undefined;
      return response.body.definitions.map(
        (location): vsc.DefinitionLink => {
          const target = qu.Location.fromTextSpan(this.client.toResource(location.file), location);
          if (location.contextStart && location.contextEnd) {
            return {
              originSelectionRange: span,
              targetRange: qu.Range.fromLocations(location.contextStart, location.contextEnd),
              targetUri: target.uri,
              targetSelectionRange: target.range,
            };
          }
          return {
            originSelectionRange: span,
            targetRange: target.range,
            targetUri: target.uri,
          };
        }
      );
    }
    return this.getSymbolLocations('definition', document, position, token);
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return vsc.languages.registerDefinitionProvider(s.syntax, new DefinitionProvider(c));
  });
}

export class TypeDefinitionProvider extends DefinitionProviderBase implements vsc.TypeDefinitionProvider {
  public provideTypeDefinition(d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.Definition | undefined> {
    return this.getSymbolLocations('typeDefinition', d, p, t);
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return vsc.languages.registerTypeDefinitionProvider(s.syntax, new TypeDefinitionProvider(c));
  });
}

export class ImplementationProvider extends DefinitionProviderBase implements vsc.ImplementationProvider {
  public provideImplementation(d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.Definition | undefined> {
    return this.getSymbolLocations('implementation', d, p, t);
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireSomeCap(c, ClientCap.Semantic)], () => {
    return vsc.languages.registerImplementationProvider(s.semantic, new ImplementationProvider(c));
  });
}
