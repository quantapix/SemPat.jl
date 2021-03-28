import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { ServiceClient } from '../service';
import * as PConst from '../protocol.const';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';

class DocSymbol implements qv.DocumentSymbolProvider {
  public constructor(private readonly client: ServiceClient, private cached: CachedResponse<qp.NavTreeResponse>) {}

  public async provideDocumentSymbols(d: qv.TextDocument, t: qv.CancellationToken): Promise<qv.DocumentSymbol[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs: qp.FileRequestArgs = { file: f };
    const response = await this.cached.execute(d, () => this.client.execute('navtree', xs, t));
    if (response.type !== 'response' || !response.body?.childItems) return undefined;
    const y: qv.DocumentSymbol[] = [];
    for (const i of response.body.childItems) {
      convertNavTree(d.uri, y, i);
    }
    return y;
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient, r: CachedResponse<qp.NavTreeResponse>) {
  return qv.languages.registerDocumentSymbolProvider(s.syntax, new DocSymbol(c, r), { label: 'TypeScript' });
}

function convertNavTree(u: qv.Uri, out: qv.DocumentSymbol[], t: qp.NavigationTree): boolean {
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

function convertSymbol(t: qp.NavigationTree, r: qv.Range): qv.DocumentSymbol {
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
  const y = new qv.DocumentSymbol(x, '', getSymbolKind(t.kind), r, r.contains(selectionRange) ? selectionRange : r);
  const ms = qu.parseKindModifier(t.kindModifiers);
  if (ms.has(PConst.KindModifiers.depreacted)) y.tags = [qv.SymbolTag.Deprecated];
  return y;
}

function shouldIncludeEntry(t: qp.NavigationTree | qp.NavigationBarItem): boolean {
  if (t.kind === PConst.Kind.alias) return false;
  return !!(t.text && t.text !== '<function>' && t.text !== '<class>');
}

function getSymbolKind(k: string): qv.SymbolKind {
  switch (k) {
    case PConst.Kind.module:
      return qv.SymbolKind.Module;
    case PConst.Kind.class:
      return qv.SymbolKind.Class;
    case PConst.Kind.enum:
      return qv.SymbolKind.Enum;
    case PConst.Kind.interface:
      return qv.SymbolKind.Interface;
    case PConst.Kind.method:
      return qv.SymbolKind.Method;
    case PConst.Kind.memberVariable:
      return qv.SymbolKind.Property;
    case PConst.Kind.memberGetAccessor:
      return qv.SymbolKind.Property;
    case PConst.Kind.memberSetAccessor:
      return qv.SymbolKind.Property;
    case PConst.Kind.variable:
      return qv.SymbolKind.Variable;
    case PConst.Kind.const:
      return qv.SymbolKind.Variable;
    case PConst.Kind.localVariable:
      return qv.SymbolKind.Variable;
    case PConst.Kind.function:
      return qv.SymbolKind.Function;
    case PConst.Kind.localFunction:
      return qv.SymbolKind.Function;
    case PConst.Kind.constructSignature:
      return qv.SymbolKind.Constructor;
    case PConst.Kind.constructorImplementation:
      return qv.SymbolKind.Constructor;
  }
  return qv.SymbolKind.Variable;
}
