import * as vsc from 'vscode';
import type * as Proto from '../protocol';
import * as PConst from '../protocol.const';
import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { ServiceClient } from '../service';
import * as qu from '../utils';

class DocSymbol implements vsc.DocumentSymbolProvider {
  public constructor(private readonly client: ServiceClient, private cached: CachedResponse<Proto.NavTreeResponse>) {}

  public async provideDocumentSymbols(d: vsc.TextDocument, t: vsc.CancellationToken): Promise<vsc.DocumentSymbol[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs: Proto.FileRequestArgs = { file: f };
    const response = await this.cached.execute(d, () => this.client.execute('navtree', xs, t));
    if (response.type !== 'response' || !response.body?.childItems) return undefined;
    const y: vsc.DocumentSymbol[] = [];
    for (const i of response.body.childItems) {
      convertNavTree(d.uri, y, i);
    }
    return y;
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient, r: CachedResponse<Proto.NavTreeResponse>) {
  return vsc.languages.registerDocumentSymbolProvider(s.syntax, new DocSymbol(c, r), { label: 'TypeScript' });
}

function convertNavTree(u: vsc.Uri, out: vsc.DocumentSymbol[], t: Proto.NavigationTree): boolean {
  let y = shouldIncludeEntry(t);
  if (!y && !t.childItems?.length) return false;
  const cs = new Set(t.childItems || []);
  for (const s of t.spans) {
    const r = qu.Range.fromTextSpan(s);
    const symbolInfo = convertSymbol(t, r);
    for (const c of cs) {
      if (c.spans.some((x) => !!r.intersection(qu.Range.fromTextSpan(x)))) {
        const includedChild = convertNavTree(u, symbolInfo.children, c);
        y = y || includedChild;
        cs.delete(c);
      }
    }
    if (y) out.push(symbolInfo);
  }
  return y;
}

function convertSymbol(t: Proto.NavigationTree, r: vsc.Range): vsc.DocumentSymbol {
  const selectionRange = t.nameSpan ? qu.Range.fromTextSpan(t.nameSpan) : r;
  let x = t.text;
  switch (t.kind) {
    case PConst.Kind.memberGetAccessor:
      x = `(get) ${x}`;
      break;
    case PConst.Kind.memberSetAccessor:
      x = `(set) ${x}`;
      break;
  }
  const y = new vsc.DocumentSymbol(x, '', getSymbolKind(t.kind), r, r.contains(selectionRange) ? selectionRange : r);
  const ms = qu.parseKindModifier(t.kindModifiers);
  if (ms.has(PConst.KindModifiers.depreacted)) y.tags = [vsc.SymbolTag.Deprecated];
  return y;
}

function shouldIncludeEntry(t: Proto.NavigationTree | Proto.NavigationBarItem): boolean {
  if (t.kind === PConst.Kind.alias) return false;
  return !!(t.text && t.text !== '<function>' && t.text !== '<class>');
}

function getSymbolKind(k: string): vsc.SymbolKind {
  switch (k) {
    case PConst.Kind.module:
      return vsc.SymbolKind.Module;
    case PConst.Kind.class:
      return vsc.SymbolKind.Class;
    case PConst.Kind.enum:
      return vsc.SymbolKind.Enum;
    case PConst.Kind.interface:
      return vsc.SymbolKind.Interface;
    case PConst.Kind.method:
      return vsc.SymbolKind.Method;
    case PConst.Kind.memberVariable:
      return vsc.SymbolKind.Property;
    case PConst.Kind.memberGetAccessor:
      return vsc.SymbolKind.Property;
    case PConst.Kind.memberSetAccessor:
      return vsc.SymbolKind.Property;
    case PConst.Kind.variable:
      return vsc.SymbolKind.Variable;
    case PConst.Kind.const:
      return vsc.SymbolKind.Variable;
    case PConst.Kind.localVariable:
      return vsc.SymbolKind.Variable;
    case PConst.Kind.function:
      return vsc.SymbolKind.Function;
    case PConst.Kind.localFunction:
      return vsc.SymbolKind.Function;
    case PConst.Kind.constructSignature:
      return vsc.SymbolKind.Constructor;
    case PConst.Kind.constructorImplementation:
      return vsc.SymbolKind.Constructor;
  }
  return vsc.SymbolKind.Variable;
}
