import * as vsc from 'vscode';
import type * as Proto from '../protocol';
import * as PConst from '../protocol.const';
import { ServiceClient } from '../service';
import API from '../../old/ts/utils/api';
import { doesResourceLookLikeAJavaScriptFile, doesResourceLookLikeATypeScriptFile } from '../../old/ts/utils/languageDescription';
import * as qu from '../utils';

class WsSymbol implements vsc.WorkspaceSymbolProvider {
  public constructor(private readonly client: ServiceClient, private readonly modeIds: readonly string[]) {}

  public async provideWorkspaceSymbols(search: string, t: vsc.CancellationToken): Promise<vsc.SymbolInformation[]> {
    let f: string | undefined;
    if (this.searchAllOpenProjects) f = undefined;
    else {
      const d = this.getDocument();
      f = d ? await this.toOpenedFiledPath(d) : undefined;
      if (!f && this.client.apiVersion.lt(API.v390)) return [];
    }
    const xs: Proto.NavtoRequestArgs = {
      file: f,
      searchValue: search,
      maxResultCount: 256,
    };
    const y = await this.client.execute('navto', xs, t);
    if (y.type !== 'response' || !y.body) return [];
    return y.body.filter((i) => i.containerName || i.kind !== 'alias').map((i) => this.toSymbolInformation(i));
  }

  private get searchAllOpenProjects() {
    return this.client.apiVersion.gte(API.v390) && vsc.workspace.getConfiguration('typescript').get('workspaceSymbols.scope', 'allOpenProjects') === 'allOpenProjects';
  }

  private async toOpenedFiledPath(d: vsc.TextDocument) {
    if (d.uri.scheme === qu.git) {
      try {
        const p = vsc.Uri.file(JSON.parse(d.uri.query)?.path);
        if (doesResourceLookLikeATypeScriptFile(p) || doesResourceLookLikeAJavaScriptFile(p)) {
          const x = await vsc.workspace.openTextDocument(p);
          return this.client.toOpenedFilePath(x);
        }
      } catch {
        // noop
      }
    }
    return this.client.toOpenedFilePath(d);
  }

  private toSymbolInformation(i: Proto.NavtoItem) {
    const l = getLabel(i);
    const y = new vsc.SymbolInformation(l, getSymbolKind(i), i.containerName || '', qu.Location.fromTextSpan(this.client.toResource(i.file), i));
    const ms = i.kindModifiers ? qu.parseKindModifier(i.kindModifiers) : undefined;
    if (ms?.has(PConst.KindModifiers.depreacted)) y.tags = [vsc.SymbolTag.Deprecated];
    return y;
  }

  private getDocument(): vsc.TextDocument | undefined {
    const d = vsc.window.activeTextEditor?.document;
    if (d) {
      if (this.modeIds.includes(d.languageId)) return d;
    }
    const ds = vsc.workspace.textDocuments;
    for (const d of ds) {
      if (this.modeIds.includes(d.languageId)) return d;
    }
    return undefined;
  }
}

export function register(c: ServiceClient, ids: readonly string[]) {
  return vsc.languages.registerWorkspaceSymbolProvider(new WsSymbol(c, ids));
}

function getLabel(i: Proto.NavtoItem) {
  const n = i.name;
  return i.kind === 'method' || i.kind === 'function' ? n + '()' : n;
}

function getSymbolKind(i: Proto.NavtoItem): vsc.SymbolKind {
  switch (i.kind) {
    case PConst.Kind.method:
      return vsc.SymbolKind.Method;
    case PConst.Kind.enum:
      return vsc.SymbolKind.Enum;
    case PConst.Kind.enumMember:
      return vsc.SymbolKind.EnumMember;
    case PConst.Kind.function:
      return vsc.SymbolKind.Function;
    case PConst.Kind.class:
      return vsc.SymbolKind.Class;
    case PConst.Kind.interface:
      return vsc.SymbolKind.Interface;
    case PConst.Kind.type:
      return vsc.SymbolKind.Class;
    case PConst.Kind.memberVariable:
      return vsc.SymbolKind.Field;
    case PConst.Kind.memberGetAccessor:
      return vsc.SymbolKind.Field;
    case PConst.Kind.memberSetAccessor:
      return vsc.SymbolKind.Field;
    case PConst.Kind.variable:
      return vsc.SymbolKind.Variable;
    default:
      return vsc.SymbolKind.Variable;
  }
}
