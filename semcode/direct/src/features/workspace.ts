import { doesResourceLookLikeAJavaScriptFile, doesResourceLookLikeATypeScriptFile } from '../../old/ts/utils/languageDescription';
import { ServiceClient } from '../service';
import * as PConst from '../protocol.const';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import type * as qp from '../protocol';

class WsSymbol implements qv.WorkspaceSymbolProvider {
  public constructor(private readonly client: ServiceClient, private readonly modeIds: readonly string[]) {}

  public async provideWorkspaceSymbols(search: string, t: qv.CancellationToken): Promise<qv.SymbolInformation[]> {
    let f: string | undefined;
    if (this.searchAllOpenProjects) f = undefined;
    else {
      const d = this.getDocument();
      f = d ? await this.toOpenedFiledPath(d) : undefined;
      if (!f && this.client.apiVersion.lt(API.v390)) return [];
    }
    const xs: qp.NavtoRequestArgs = {
      file: f,
      searchValue: search,
      maxResultCount: 256,
    };
    const y = await this.client.execute('navto', xs, t);
    if (y.type !== 'response' || !y.body) return [];
    return y.body.filter((i) => i.containerName || i.kind !== 'alias').map((i) => this.toSymbolInformation(i));
  }

  private get searchAllOpenProjects() {
    return this.client.apiVersion.gte(API.v390) && qv.workspace.getConfig('typescript').get('workspaceSymbols.scope', 'allOpenProjects') === 'allOpenProjects';
  }

  private async toOpenedFiledPath(d: qv.TextDocument) {
    if (d.uri.scheme === qu.git) {
      try {
        const p = qv.Uri.file(JSON.parse(d.uri.query)?.path);
        if (doesResourceLookLikeATypeScriptFile(p) || doesResourceLookLikeAJavaScriptFile(p)) {
          const x = await qv.workspace.openTextDocument(p);
          return this.client.toOpenedFilePath(x);
        }
      } catch {}
    }
    return this.client.toOpenedFilePath(d);
  }

  private toSymbolInformation(i: qp.NavtoItem) {
    const l = getLabel(i);
    const y = new qv.SymbolInformation(l, getSymbolKind(i), i.containerName || '', qu.Location.fromTextSpan(this.client.toResource(i.file), i));
    const ms = i.kindModifiers ? qu.parseKindModifier(i.kindModifiers) : undefined;
    if (ms?.has(PConst.KindModifiers.depreacted)) y.tags = [qv.SymbolTag.Deprecated];
    return y;
  }

  private getDocument(): qv.TextDocument | undefined {
    const d = qv.window.activeTextEditor?.document;
    if (d) {
      if (this.modeIds.includes(d.languageId)) return d;
    }
    const ds = qv.workspace.textDocuments;
    for (const d of ds) {
      if (this.modeIds.includes(d.languageId)) return d;
    }
    return undefined;
  }
}

export function register(c: ServiceClient, ids: readonly string[]) {
  return qv.languages.registerWorkspaceSymbolProvider(new WsSymbol(c, ids));
}

function getLabel(i: qp.NavtoItem) {
  const n = i.name;
  return i.kind === 'method' || i.kind === 'function' ? n + '()' : n;
}

function getSymbolKind(i: qp.NavtoItem): qv.SymbolKind {
  switch (i.kind) {
    case PConst.Kind.method:
      return qv.SymbolKind.Method;
    case PConst.Kind.enum:
      return qv.SymbolKind.Enum;
    case PConst.Kind.enumMember:
      return qv.SymbolKind.EnumMember;
    case PConst.Kind.function:
      return qv.SymbolKind.Function;
    case PConst.Kind.class:
      return qv.SymbolKind.Class;
    case PConst.Kind.interface:
      return qv.SymbolKind.Interface;
    case PConst.Kind.type:
      return qv.SymbolKind.Class;
    case PConst.Kind.memberVariable:
      return qv.SymbolKind.Field;
    case PConst.Kind.memberGetAccessor:
      return qv.SymbolKind.Field;
    case PConst.Kind.memberSetAccessor:
      return qv.SymbolKind.Field;
    case PConst.Kind.variable:
      return qv.SymbolKind.Variable;
    default:
      return qv.SymbolKind.Variable;
  }
}
