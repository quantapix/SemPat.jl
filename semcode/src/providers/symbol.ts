import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import * as PConst from '../protocol.const';
import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { ServiceClient } from '../service';
import * as qu from '../utils';

const getSymbolKind = (k: string): vscode.SymbolKind => {
  switch (k) {
    case PConst.Kind.module:
      return vscode.SymbolKind.Module;
    case PConst.Kind.class:
      return vscode.SymbolKind.Class;
    case PConst.Kind.enum:
      return vscode.SymbolKind.Enum;
    case PConst.Kind.interface:
      return vscode.SymbolKind.Interface;
    case PConst.Kind.method:
      return vscode.SymbolKind.Method;
    case PConst.Kind.memberVariable:
      return vscode.SymbolKind.Property;
    case PConst.Kind.memberGetAccessor:
      return vscode.SymbolKind.Property;
    case PConst.Kind.memberSetAccessor:
      return vscode.SymbolKind.Property;
    case PConst.Kind.variable:
      return vscode.SymbolKind.Variable;
    case PConst.Kind.const:
      return vscode.SymbolKind.Variable;
    case PConst.Kind.localVariable:
      return vscode.SymbolKind.Variable;
    case PConst.Kind.function:
      return vscode.SymbolKind.Function;
    case PConst.Kind.localFunction:
      return vscode.SymbolKind.Function;
    case PConst.Kind.constructSignature:
      return vscode.SymbolKind.Constructor;
    case PConst.Kind.constructorImplementation:
      return vscode.SymbolKind.Constructor;
  }
  return vscode.SymbolKind.Variable;
};

class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  public constructor(private readonly client: ServiceClient, private cached: CachedResponse<Proto.NavTreeResponse>) {}

  public async provideDocumentSymbols(d: vscode.TextDocument, t: vscode.CancellationToken): Promise<vscode.DocumentSymbol[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs: Proto.FileRequestArgs = { file: f };
    const response = await this.cached.execute(d, () => this.client.execute('navtree', xs, t));
    if (response.type !== 'response' || !response.body?.childItems) return undefined;
    const y: vscode.DocumentSymbol[] = [];
    for (const i of response.body.childItems) {
      DocumentSymbolProvider.convertNavTree(d.uri, y, i);
    }
    return y;
  }

  private static convertNavTree(u: vscode.Uri, output: vscode.DocumentSymbol[], item: Proto.NavigationTree): boolean {
    let y = DocumentSymbolProvider.shouldInclueEntry(item);
    if (!y && !item.childItems?.length) return false;
    const cs = new Set(item.childItems || []);
    for (const s of item.spans) {
      const r = qu.Range.fromTextSpan(s);
      const symbolInfo = DocumentSymbolProvider.convertSymbol(item, r);
      for (const c of cs) {
        if (c.spans.some((x) => !!r.intersection(qu.Range.fromTextSpan(x)))) {
          const includedChild = DocumentSymbolProvider.convertNavTree(u, symbolInfo.children, c);
          y = y || includedChild;
          cs.delete(c);
        }
      }
      if (y) output.push(symbolInfo);
    }
    return y;
  }

  private static convertSymbol(item: Proto.NavigationTree, r: vscode.Range): vscode.DocumentSymbol {
    const selectionRange = item.nameSpan ? qu.Range.fromTextSpan(item.nameSpan) : r;
    let t = item.text;
    switch (item.kind) {
      case PConst.Kind.memberGetAccessor:
        t = `(get) ${t}`;
        break;
      case PConst.Kind.memberSetAccessor:
        t = `(set) ${t}`;
        break;
    }
    const y = new vscode.DocumentSymbol(t, '', getSymbolKind(item.kind), r, r.contains(selectionRange) ? selectionRange : r);
    const ms = qu.parseKindModifier(item.kindModifiers);
    if (ms.has(PConst.KindModifiers.depreacted)) y.tags = [vscode.SymbolTag.Deprecated];
    return y;
  }

  private static shouldInclueEntry(item: Proto.NavigationTree | Proto.NavigationBarItem): boolean {
    if (item.kind === PConst.Kind.alias) return false;
    return !!(item.text && item.text !== '<function>' && item.text !== '<class>');
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient, r: CachedResponse<Proto.NavTreeResponse>) {
  return vscode.languages.registerDocumentSymbolProvider(s.syntax, new DocumentSymbolProvider(c, r), { label: 'TypeScript' });
}
