import * as qv from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import { registerCommand } from '../utils';
import { notifyTypeReplShowInGrid, onExit, onFinishEval, onInit } from '../../repl';

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
