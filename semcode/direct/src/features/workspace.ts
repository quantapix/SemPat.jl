import { doesResourceLookLikeAJavaScriptFile, doesResourceLookLikeATypeScriptFile } from '../../old/ts/utils/languageDescription';
import { ServiceClient } from '../service';
import * as PConst from '../protocol.const';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import type * as qp from '../protocol';
import cp = require('child_process');
import { getGoConfig } from '../../../../old/go/config';
import { toolExecutionEnvironment } from '../../../../old/go/goEnv';
import { promptForMissingTool, promptForUpdatingTool } from '../../../../old/go/goInstallTools';
import { getBinPath, getWorkspaceFolderPath } from '../../../../old/go/util';
import { getCurrentGoRoot } from './utils/pathUtils';
import { killProcTree } from './utils/processUtils';
import * as rpc from 'vscode-jsonrpc';
import { registerCommand } from '../utils';
import { notifyTypeReplShowInGrid, onExit, onFinishEval, onInit } from '../../repl';

class TsWorkspaceSymbol implements qv.WorkspaceSymbolProvider {
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
  return qv.languages.registerWorkspaceSymbolProvider(new TsWorkspaceSymbol(c, ids));
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

interface GoSymbolDeclaration {
  name: string;
  kind: string;
  package: string;
  path: string;
  line: number;
  character: number;
}
export class GoWorkspaceSymbol implements qv.WorkspaceSymbolProvider {
  private goKindToCodeKind: { [key: string]: qv.SymbolKind } = {
    package: qv.SymbolKind.Package,
    import: qv.SymbolKind.Namespace,
    var: qv.SymbolKind.Variable,
    type: qv.SymbolKind.Interface,
    func: qv.SymbolKind.Function,
    const: qv.SymbolKind.Constant,
  };
  public provideWorkspaceSymbols(query: string, token: qv.CancellationToken): Thenable<qv.SymbolInformation[]> {
    const convertToCodeSymbols = (decls: GoSymbolDeclaration[], symbols: qv.SymbolInformation[]): void => {
      if (!decls) {
        return;
      }
      for (const decl of decls) {
        let kind: qv.SymbolKind;
        if (decl.kind !== '') {
          kind = this.goKindToCodeKind[decl.kind];
        }
        const pos = new qv.Position(decl.line, decl.character);
        const symbolInfo = new qv.SymbolInformation(decl.name, kind, new qv.Range(pos, pos), qv.Uri.file(decl.path), '');
        symbols.push(symbolInfo);
      }
    };
    const root = getWorkspaceFolderPath(qv.window.activeTextEditor && qv.window.activeTextEditor.document.uri);
    const goConfig = getGoConfig();
    if (!root && !goConfig.gotoSymbol.includeGoroot) {
      qv.window.showInformationMessage('No workspace is open to find symbols.');
      return;
    }
    return getWorkspaceSymbols(root, query, token, goConfig).then((results) => {
      const symbols: qv.SymbolInformation[] = [];
      convertToCodeSymbols(results, symbols);
      return symbols;
    });
  }
}
export function getWorkspaceSymbols(workspacePath: string, query: string, token: qv.CancellationToken, goConfig?: qv.WorkspaceConfig, ignoreFolderFeatureOn = true): Thenable<GoSymbolDeclaration[]> {
  if (!goConfig) {
    goConfig = getGoConfig();
  }
  const gotoSymbolConfig = goConfig['gotoSymbol'];
  const calls: Promise<GoSymbolDeclaration[]>[] = [];
  const ignoreFolders: string[] = gotoSymbolConfig ? gotoSymbolConfig['ignoreFolders'] : [];
  const baseArgs = ignoreFolderFeatureOn && ignoreFolders && ignoreFolders.length > 0 ? ['-ignore', ignoreFolders.join(',')] : [];
  calls.push(callGoSymbols([...baseArgs, workspacePath, query], token));
  if (gotoSymbolConfig.includeGoroot) {
    const goRoot = getCurrentGoRoot();
    const gorootCall = callGoSymbols([...baseArgs, goRoot, query], token);
    calls.push(gorootCall);
  }
  return Promise.all(calls)
    .then(([...results]) => <GoSymbolDeclaration[]>[].concat(...results))
    .catch((err: Error) => {
      if (err && (<any>err).code === 'ENOENT') {
        promptForMissingTool('go-symbols');
      }
      if (err.message.startsWith('flag provided but not defined: -ignore')) {
        promptForUpdatingTool('go-symbols');
        return getWorkspaceSymbols(workspacePath, query, token, goConfig, false);
      }
    });
}
function callGoSymbols(args: string[], token: qv.CancellationToken): Promise<GoSymbolDeclaration[]> {
  const gosyms = getBinPath('go-symbols');
  const env = toolExecutionEnvironment();
  let p: cp.ChildProc;
  if (token) {
    token.onCancellationRequested(() => killProcTree(p));
  }
  return new Promise((resolve, reject) => {
    p = cp.execFile(gosyms, args, { maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err && stderr && stderr.startsWith('flag provided but not defined: -ignore')) {
        return reject(new Error(stderr));
      } else if (err) {
        return reject(err);
      }
      const result = stdout.toString();
      const decls = <GoSymbolDeclaration[]>JSON.parse(result);
      return resolve(decls);
    });
  });
}

let g_connection: rpc.MessageConnection = null;
interface WorkspaceVariable {
  head: string;
  type: string;
  value: string;
  id: number;
  lazy: boolean;
  haschildren: boolean;
  canshow: boolean;
  icon: string;
}
const requestTypeGetVariables = new rpc.RequestType<void, WorkspaceVariable[], void>('repl/getvariables');
const requestTypeGetLazy = new rpc.RequestType<{ id: number }, WorkspaceVariable[], void>('repl/getlazy');
let g_replVariables: WorkspaceVariable[] = [];
export class REPLTreeDataProvider implements qv.TreeDataProvider<WorkspaceVariable> {
  private _onDidChangeTreeData: qv.EventEmitter<WorkspaceVariable | undefined> = new qv.EventEmitter<WorkspaceVariable | undefined>();
  readonly onDidChangeTreeData: qv.Event<WorkspaceVariable | undefined> = this._onDidChangeTreeData.event;
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
  async getChildren(node?: WorkspaceVariable) {
    if (node) {
      const children = await g_connection.sendRequest(requestTypeGetLazy, { id: node.id });
      const out: WorkspaceVariable[] = [];
      for (const c of children) {
        out.push(c);
      }
      return out;
    } else {
      return g_replVariables;
    }
  }
  getTreeItem(node: WorkspaceVariable): qv.TreeItem {
    const treeItem = new qv.TreeItem(node.head);
    treeItem.description = node.value;
    treeItem.tooltip = node.type;
    treeItem.contextValue = node.canshow ? 'globalvariable' : '';
    treeItem.collapsibleState = node.haschildren ? qv.TreeItemCollapsibleState.Collapsed : qv.TreeItemCollapsibleState.None;
    treeItem.iconPath = new qv.ThemeIcon(node.icon);
    return treeItem;
  }
}
let g_REPLTreeDataProvider: REPLTreeDataProvider = null;
async function updateReplVariables() {
  g_replVariables = await g_connection.sendRequest(requestTypeGetVariables, undefined);
  g_REPLTreeDataProvider.refresh();
}
async function showInVSCode(node: WorkspaceVariable) {
  g_connection.sendNotification(notifyTypeReplShowInGrid, { code: node.head });
}
export function activate(context: qv.ExtensionContext) {
  g_REPLTreeDataProvider = new REPLTreeDataProvider();
  context.subscriptions.push(
    qv.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider),
    onInit((x) => {
      g_connection = x;
      updateReplVariables();
    }),
    onFinishEval((_) => updateReplVariables()),
    onExit((e) => clearVariables()),
    registerCommand('language-julia.showInVSCode', showInVSCode)
  );
}
export function clearVariables() {
  g_replVariables = [];
  g_REPLTreeDataProvider.refresh();
}
