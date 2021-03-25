import * as path from 'path';
import * as vsc from 'vscode';
import type * as Proto from '../protocol';
import * as PConst from '../protocol.const';
import { ClientCap, ServiceClient } from '../service';
import API from '../../old/ts/utils/api';
import { condRegistration, requireSomeCap, requireMinVer } from '../registration';
import * as qu from '../utils';

class CallHierarchySupport implements vsc.CallHierarchyProvider {
  public static readonly minVersion = API.v380;

  public constructor(private readonly client: ServiceClient) {}

  public async prepareCallHierarchy(d: vsc.TextDocument, p: vsc.Position, t: vsc.CancellationToken): Promise<vsc.CallHierarchyItem | vsc.CallHierarchyItem[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('prepareCallHierarchy', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return Array.isArray(v.body) ? v.body.map(fromProtocolCallHierarchyItem) : fromProtocolCallHierarchyItem(v.body);
  }

  public async provideCallHierarchyIncomingCalls(i: vsc.CallHierarchyItem, t: vsc.CancellationToken): Promise<vsc.CallHierarchyIncomingCall[] | undefined> {
    const f = this.client.toPath(i.uri);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, i.selectionRange.start);
    const v = await this.client.execute('provideCallHierarchyIncomingCalls', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map(fromProtocolCallHierarchyIncomingCall);
  }

  public async provideCallHierarchyOutgoingCalls(i: vsc.CallHierarchyItem, t: vsc.CancellationToken): Promise<vsc.CallHierarchyOutgoingCall[] | undefined> {
    const f = this.client.toPath(i.uri);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, i.selectionRange.start);
    const v = await this.client.execute('provideCallHierarchyOutgoingCalls', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map(fromProtocolCallHierarchyOutgoingCall);
  }
}

function isSourceFileItem(i: Proto.CallHierarchyItem) {
  return i.kind === PConst.Kind.script || (i.kind === PConst.Kind.module && i.selectionSpan.start.line === 1 && i.selectionSpan.start.offset === 1);
}

function fromProtocolCallHierarchyItem(item: Proto.CallHierarchyItem): vsc.CallHierarchyItem {
  const useFileName = isSourceFileItem(item);
  const name = useFileName ? path.basename(item.file) : item.name;
  const detail = useFileName ? vsc.workspace.asRelativePath(path.dirname(item.file)) : item.containerName ?? '';
  const result = new vsc.CallHierarchyItem(
    qu.SymbolKind.fromProtocolScriptElementKind(item.kind),
    name,
    detail,
    vsc.Uri.file(item.file),
    qu.Range.fromTextSpan(item.span),
    qu.Range.fromTextSpan(item.selectionSpan)
  );
  const kindModifiers = item.kindModifiers ? qu.parseKindModifier(item.kindModifiers) : undefined;
  if (kindModifiers?.has(PConst.KindModifiers.depreacted)) result.tags = [vsc.SymbolTag.Deprecated];
  return result;
}

function fromProtocolCallHierarchyIncomingCall(c: Proto.CallHierarchyIncomingCall): vsc.CallHierarchyIncomingCall {
  return new vsc.CallHierarchyIncomingCall(fromProtocolCallHierarchyItem(c.from), c.fromSpans.map(qu.Range.fromTextSpan));
}

function fromProtocolCallHierarchyOutgoingCall(c: Proto.CallHierarchyOutgoingCall): vsc.CallHierarchyOutgoingCall {
  return new vsc.CallHierarchyOutgoingCall(fromProtocolCallHierarchyItem(c.to), c.fromSpans.map(qu.Range.fromTextSpan));
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireMinVer(c, CallHierarchySupport.minVersion), requireSomeCap(c, ClientCap.Semantic)], () => {
    return vsc.languages.registerCallHierarchyProvider(s.semantic, new CallHierarchySupport(c));
  });
}
