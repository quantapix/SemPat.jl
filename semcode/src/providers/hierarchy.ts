import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap, requireMinVer } from '../registration';
import * as path from 'path';
import * as PConst from '../protocol.const';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import type * as qp from '../protocol';

class Hierarchy implements qv.CallHierarchyProvider {
  public static readonly minVersion = API.v380;

  public constructor(private readonly client: ServiceClient) {}

  public async prepareCallHierarchy(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.CallHierarchyItem | qv.CallHierarchyItem[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('prepareCallHierarchy', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return Array.isArray(v.body) ? v.body.map(fromProtocolCallHierarchyItem) : fromProtocolCallHierarchyItem(v.body);
  }

  public async provideCallHierarchyIncomingCalls(i: qv.CallHierarchyItem, t: qv.CancellationToken): Promise<qv.CallHierarchyIncomingCall[] | undefined> {
    const f = this.client.toPath(i.uri);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, i.selectionRange.start);
    const v = await this.client.execute('provideCallHierarchyIncomingCalls', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map(fromProtocolCallHierarchyIncomingCall);
  }

  public async provideCallHierarchyOutgoingCalls(i: qv.CallHierarchyItem, t: qv.CancellationToken): Promise<qv.CallHierarchyOutgoingCall[] | undefined> {
    const f = this.client.toPath(i.uri);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, i.selectionRange.start);
    const v = await this.client.execute('provideCallHierarchyOutgoingCalls', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map(fromProtocolCallHierarchyOutgoingCall);
  }
}

function isSourceFileItem(i: qp.CallHierarchyItem) {
  return i.kind === PConst.Kind.script || (i.kind === PConst.Kind.module && i.selectionSpan.start.line === 1 && i.selectionSpan.start.offset === 1);
}

function fromProtocolCallHierarchyItem(item: qp.CallHierarchyItem): qv.CallHierarchyItem {
  const useFileName = isSourceFileItem(item);
  const name = useFileName ? path.basename(item.file) : item.name;
  const detail = useFileName ? qv.workspace.asRelativePath(path.dirname(item.file)) : item.containerName ?? '';
  const result = new qv.CallHierarchyItem(
    qu.SymbolKind.fromProtocolScriptElementKind(item.kind),
    name,
    detail,
    qv.Uri.file(item.file),
    qu.Range.fromTextSpan(item.span),
    qu.Range.fromTextSpan(item.selectionSpan)
  );
  const kindModifiers = item.kindModifiers ? qu.parseKindModifier(item.kindModifiers) : undefined;
  if (kindModifiers?.has(PConst.KindModifiers.depreacted)) result.tags = [qv.SymbolTag.Deprecated];
  return result;
}

function fromProtocolCallHierarchyIncomingCall(c: qp.CallHierarchyIncomingCall): qv.CallHierarchyIncomingCall {
  return new qv.CallHierarchyIncomingCall(fromProtocolCallHierarchyItem(c.from), c.fromSpans.map(qu.Range.fromTextSpan));
}

function fromProtocolCallHierarchyOutgoingCall(c: qp.CallHierarchyOutgoingCall): qv.CallHierarchyOutgoingCall {
  return new qv.CallHierarchyOutgoingCall(fromProtocolCallHierarchyItem(c.to), c.fromSpans.map(qu.Range.fromTextSpan));
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireMinVer(c, Hierarchy.minVersion), requireSomeCap(c, ClientCap.Semantic)], () => {
    return qv.languages.registerCallHierarchyProvider(s.semantic, new Hierarchy(c));
  });
}
