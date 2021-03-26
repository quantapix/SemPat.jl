import * as qv from 'vscode';
import * as nls from 'vscode-nls';
import type * as qp from '../../protocol';
import { escapeRegExp } from '../../utils/regexp';
import * as PConst from '../protocol.const';
import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { ClientCapability, ITypeScriptServiceClient } from '../service';
import { conditionalRegistration, requireSomeCap, requireConfig } from '../registration';
import { DocumentSelector } from '../../utils/documentSelector';
import * as qu from '../utils';
import { getSymbolRange, ReferencesCodeLens, TypeScriptBaseCodeLensProvider } from './codeLens';
import { ExecutionTarget } from '../../old/ts/tsServer/server';

const localize = nls.loadMessageBundle();

export class ReferencesCodeLens extends qv.CodeLens {
  constructor(public document: qv.Uri, public file: string, range: qv.Range) {
    super(range);
  }
}

export abstract class TypeScriptBaseCodeLensProvider implements qv.CodeLensProvider<ReferencesCodeLens> {
  public static readonly cancelledCommand: qv.Command = {
    // Cancellation is not an error. Just show nothing until we can properly re-compute the code lens
    title: '',
    command: '',
  };

  public static readonly errorCommand: qv.Command = {
    title: localize('referenceErrorLabel', 'Could not determine references'),
    command: '',
  };

  private onDidChangeCodeLensesEmitter = new qv.EventEmitter<void>();

  public constructor(protected client: ITypeScriptServiceClient, private cachedResponse: CachedResponse<qp.NavTreeResponse>) {}

  public get onDidChangeCodeLenses(): qv.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  async provideCodeLenses(document: qv.TextDocument, token: qv.CancellationToken): Promise<ReferencesCodeLens[]> {
    const filepath = this.client.toOpenedFilePath(document);
    if (!filepath) {
      return [];
    }

    const response = await this.cachedResponse.execute(document, () => this.client.execute('navtree', { file: filepath }, token));
    if (response.type !== 'response') {
      return [];
    }

    const tree = response.body;
    const referenceableSpans: qv.Range[] = [];
    if (tree && tree.childItems) {
      tree.childItems.forEach((item) => this.walkNavTree(document, item, null, referenceableSpans));
    }
    return referenceableSpans.map((span) => new ReferencesCodeLens(document.uri, filepath, span));
  }

  protected abstract extractSymbol(document: qv.TextDocument, item: qp.NavigationTree, parent: qp.NavigationTree | null): qv.Range | null;

  private walkNavTree(document: qv.TextDocument, item: qp.NavigationTree, parent: qp.NavigationTree | null, results: qv.Range[]): void {
    if (!item) {
      return;
    }

    const range = this.extractSymbol(document, item, parent);
    if (range) {
      results.push(range);
    }

    (item.childItems || []).forEach((child) => this.walkNavTree(document, child, item, results));
  }
}

export function getSymbolRange(document: qv.TextDocument, item: qp.NavigationTree): qv.Range | null {
  // TS 3.0+ provides a span for just the symbol
  if (item.nameSpan) {
    return qu.Range.fromTextSpan(item.nameSpan);
  }

  // In older versions, we have to calculate this manually. See #23924
  const span = item.spans && item.spans[0];
  if (!span) {
    return null;
  }

  const range = qu.Range.fromTextSpan(span);
  const text = document.getText(range);

  const identifierMatch = new RegExp(`^(.*?(\\b|\\W))${escapeRegExp(item.text || '')}(\\b|\\W)`, 'gm');
  const match = identifierMatch.exec(text);
  const prefixLength = match ? match.index + match[1].length : 0;
  const startOffset = document.offsetAt(new qv.Position(range.start.line, range.start.character)) + prefixLength;
  return new qv.Range(document.positionAt(startOffset), document.positionAt(startOffset + item.text.length));
}

export default class TypeScriptImplementationsCodeLensProvider extends TypeScriptBaseCodeLensProvider {
  public async resolveCodeLens(codeLens: ReferencesCodeLens, token: qv.CancellationToken): Promise<qv.CodeLens> {
    const args = qu.Position.toFileLocationRequestArgs(codeLens.file, codeLens.range.start);
    const response = await this.client.execute('implementation', args, token, { lowPriority: true, cancelOnResourceChange: codeLens.document });
    if (response.type !== 'response' || !response.body) {
      codeLens.command = response.type === 'cancelled' ? TypeScriptBaseCodeLensProvider.cancelledCommand : TypeScriptBaseCodeLensProvider.errorCommand;
      return codeLens;
    }

    const locations = response.body
      .map(
        (reference) =>
          // Only take first line on implementation: https://github.com/microsoft/vscode/issues/23924
          new qv.Location(
            this.client.toResource(reference.file),
            reference.start.line === reference.end.line ? qu.Range.fromTextSpan(reference) : new qv.Range(qu.Position.fromLocation(reference.start), new qv.Position(reference.start.line, 0))
          )
      )
      // Exclude original from implementations
      .filter(
        (location) =>
          !(location.uri.toString() === codeLens.document.toString() && location.range.start.line === codeLens.range.start.line && location.range.start.character === codeLens.range.start.character)
      );

    codeLens.command = this.getCommand(locations, codeLens);
    return codeLens;
  }

  private getCommand(locations: qv.Location[], codeLens: ReferencesCodeLens): qv.Command | undefined {
    return {
      title: this.getTitle(locations),
      command: locations.length ? 'editor.action.showReferences' : '',
      arguments: [codeLens.document, codeLens.range.start, locations],
    };
  }

  private getTitle(locations: qv.Location[]): string {
    return locations.length === 1 ? localize('oneImplementationLabel', '1 implementation') : localize('manyImplementationLabel', '{0} implementations', locations.length);
  }

  protected extractSymbol(document: qv.TextDocument, item: qp.NavigationTree, _parent: qp.NavigationTree | null): qv.Range | null {
    switch (item.kind) {
      case PConst.Kind.interface:
        return getSymbolRange(document, item);

      case PConst.Kind.class:
      case PConst.Kind.method:
      case PConst.Kind.memberVariable:
      case PConst.Kind.memberGetAccessor:
      case PConst.Kind.memberSetAccessor:
        if (item.kindModifiers.match(/\babstract\b/g)) {
          return getSymbolRange(document, item);
        }
        break;
    }
    return null;
  }
}

export function register(selector: DocumentSelector, modeId: string, client: ITypeScriptServiceClient, cachedResponse: CachedResponse<qp.NavTreeResponse>) {
  return conditionalRegistration([requireConfig(modeId, 'implementationsCodeLens.enabled'), requireSomeCap(client, ClientCapability.Semantic)], () => {
    return qv.languages.registerCodeLensProvider(selector.semantic, new TypeScriptImplementationsCodeLensProvider(client, cachedResponse));
  });
}

export class TypeScriptReferencesCodeLensProvider extends TypeScriptBaseCodeLensProvider {
  public constructor(protected client: ITypeScriptServiceClient, protected _cachedResponse: CachedResponse<qp.NavTreeResponse>, private modeId: string) {
    super(client, _cachedResponse);
  }

  public async resolveCodeLens(codeLens: ReferencesCodeLens, token: qv.CancellationToken): Promise<qv.CodeLens> {
    const args = qu.Position.toFileLocationRequestArgs(codeLens.file, codeLens.range.start);
    const response = await this.client.execute('references', args, token, {
      lowPriority: true,
      executionTarget: ExecutionTarget.Semantic,
      cancelOnResourceChange: codeLens.document,
    });
    if (response.type !== 'response' || !response.body) {
      codeLens.command = response.type === 'cancelled' ? TypeScriptBaseCodeLensProvider.cancelledCommand : TypeScriptBaseCodeLensProvider.errorCommand;
      return codeLens;
    }

    const locations = response.body.refs.filter((reference) => !reference.isDefinition).map((reference) => qu.Location.fromTextSpan(this.client.toResource(reference.file), reference));

    codeLens.command = {
      title: this.getCodeLensLabel(locations),
      command: locations.length ? 'editor.action.showReferences' : '',
      arguments: [codeLens.document, codeLens.range.start, locations],
    };
    return codeLens;
  }

  private getCodeLensLabel(locations: ReadonlyArray<qv.Location>): string {
    return locations.length === 1 ? localize('oneReferenceLabel', '1 reference') : localize('manyReferenceLabel', '{0} references', locations.length);
  }

  protected extractSymbol(document: qv.TextDocument, item: qp.NavigationTree, parent: qp.NavigationTree | null): qv.Range | null {
    if (parent && parent.kind === PConst.Kind.enum) {
      return getSymbolRange(document, item);
    }

    switch (item.kind) {
      case PConst.Kind.function:
        const showOnAllFunctions = qv.workspace.getConfiguration(this.modeId).get<boolean>('referencesCodeLens.showOnAllFunctions');
        if (showOnAllFunctions) {
          return getSymbolRange(document, item);
        }
      // fallthrough

      case PConst.Kind.const:
      case PConst.Kind.let:
      case PConst.Kind.variable:
        // Only show references for exported variables
        if (/\bexport\b/.test(item.kindModifiers)) {
          return getSymbolRange(document, item);
        }
        break;

      case PConst.Kind.class:
        if (item.text === '<class>') {
          break;
        }
        return getSymbolRange(document, item);

      case PConst.Kind.interface:
      case PConst.Kind.type:
      case PConst.Kind.enum:
        return getSymbolRange(document, item);

      case PConst.Kind.method:
      case PConst.Kind.memberGetAccessor:
      case PConst.Kind.memberSetAccessor:
      case PConst.Kind.constructorImplementation:
      case PConst.Kind.memberVariable:
        // Don't show if child and parent have same start
        // For https://github.com/microsoft/vscode/issues/90396
        if (parent && qu.Position.fromLocation(parent.spans[0].start).isEqual(qu.Position.fromLocation(item.spans[0].start))) {
          return null;
        }

        // Only show if parent is a class type object (not a literal)
        switch (parent?.kind) {
          case PConst.Kind.class:
          case PConst.Kind.interface:
          case PConst.Kind.type:
            return getSymbolRange(document, item);
        }
        break;
    }

    return null;
  }
}

export function register(selector: DocumentSelector, modeId: string, client: ITypeScriptServiceClient, cachedResponse: CachedResponse<qp.NavTreeResponse>) {
  return conditionalRegistration([requireConfig(modeId, 'referencesCodeLens.enabled'), requireSomeCap(client, ClientCapability.Semantic)], () => {
    return qv.languages.registerCodeLensProvider(selector.semantic, new TypeScriptReferencesCodeLensProvider(client, cachedResponse, modeId));
  });
}
