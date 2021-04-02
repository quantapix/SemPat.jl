import * as lc from 'vscode-languageclient';
import * as qv from 'vscode';
import * as ra from '../src/lsp_ext';
import * as Is from 'vscode-languageclient/lib/utils/is';

import { CallHierarchyFeature } from 'vscode-languageclient/lib/callHierarchy.proposed';
import { SemanticTokensFeature, DocumentSemanticsTokensSignature } from 'vscode-languageclient/lib/semanticTokens.proposed';
import { assert } from './util';

function renderCommand(cmd: ra.CommandLink) {
  return `[${cmd.title}](command:${cmd.command}?${encodeURIComponent(JSON.stringify(cmd.arguments))} '${cmd.tooltip!}')`;
}

function renderHoverActions(actions: ra.CommandLinkGroup[]): qv.MarkdownString {
  const text = actions.map((group) => (group.title ? group.title + ' ' : '') + group.commands.map(renderCommand).join(' | ')).join('___');

  const result = new qv.MarkdownString(text);
  result.isTrusted = true;
  return result;
}

export function createClient(serverPath: string, cwd: string): lc.LangClient {
  const run: lc.Executable = {
    command: serverPath,
    options: { cwd },
  };
  const serverOptions: lc.ServerOptions = {
    run,
    debug: run,
  };
  const traceOutputChannel = qv.window.createOutputChannel('Rust Analyzer Lang Server Trace');

  const clientOptions: lc.LangClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'rust' }],
    initializationOptions: qv.workspace.getConfig('rust-analyzer'),
    traceOutputChannel,
    middleware: {
      async provideDocumentSemanticTokens(document: qv.TextDocument, token: qv.CancellationToken, next: DocumentSemanticsTokensSignature) {
        const res = await next(document, token);
        if (res === undefined) throw new Error('busy');
        return res;
      },
      async provideHover(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken, _next: lc.ProvideHoverSignature) {
        return client.sendRequest(lc.HoverRequest.type, client.code2ProtocolConverter.asTextDocumentPositionParams(document, position), token).then(
          (result) => {
            const hover = client.protocol2CodeConverter.asHover(result);
            if (hover) {
              const actions = (<any>result).actions;
              if (actions) {
                hover.contents.push(renderHoverActions(actions));
              }
            }
            return hover;
          },
          (error) => {
            client.logFailedRequest(lc.HoverRequest.type, error);
            return Promise.resolve(null);
          }
        );
      },

      async provideCodeActions(document: qv.TextDocument, range: qv.Range, context: qv.CodeActionContext, token: qv.CancellationToken, _next: lc.ProvideCodeActionsSignature) {
        const params: lc.CodeActionParams = {
          textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(document),
          range: client.code2ProtocolConverter.asRange(range),
          context: client.code2ProtocolConverter.asCodeActionContext(context),
        };
        return client.sendRequest(lc.CodeActionRequest.type, params, token).then(
          (values) => {
            if (values === null) return undefined;
            const result: (qv.CodeAction | qv.Command)[] = [];
            const groups = new Map<string, { index: number; items: qv.CodeAction[] }>();
            for (const item of values) {
              if (lc.CodeAction.is(item)) {
                assert(!item.command, "We don't expect to receive commands in CodeActions");
                const action = client.protocol2CodeConverter.asCodeAction(item);
                result.push(action);
                continue;
              }
              assert(isCodeActionWithoutEditsAndCommands(item), "We don't expect edits or commands here");
              const kind = client.protocol2CodeConverter.asCodeActionKind((item as any).kind);
              const action = new qv.CodeAction(item.title, kind);
              const group = (item as any).group;
              const id = (item as any).id;
              const resolveParams: ra.ResolveCodeActionParams = {
                id: id,
                codeActionParams: params,
              };
              action.command = {
                command: 'rust-analyzer.resolveCodeAction',
                title: item.title,
                arguments: [resolveParams],
              };
              if (group) {
                let entry = groups.get(group);
                if (!entry) {
                  entry = { index: result.length, items: [] };
                  groups.set(group, entry);
                  result.push(action);
                }
                entry.items.push(action);
              } else {
                result.push(action);
              }
            }
            for (const [group, { index, items }] of groups) {
              if (items.length === 1) {
                result[index] = items[0];
              } else {
                const action = new qv.CodeAction(group);
                action.kind = items[0].kind;
                action.command = {
                  command: 'rust-analyzer.applyActionGroup',
                  title: '',
                  arguments: [
                    items.map((item) => {
                      return { label: item.title, arguments: item.command!!.arguments!![0] };
                    }),
                  ],
                };
                result[index] = action;
              }
            }
            return result;
          },
          (_error) => undefined
        );
      },
    } as any,
  };

  const client = new lc.LangClient('rust-analyzer', 'Rust Analyzer Lang Server', serverOptions, clientOptions);

  client.registerFeature(new CallHierarchyFeature(client));
  client.registerFeature(new SemanticTokensFeature(client));
  client.registerFeature(new ExperimentalFeatures());

  return client;
}

class ExperimentalFeatures implements lc.StaticFeature {
  fillClientCaps(capabilities: lc.ClientCaps): void {
    const caps: any = capabilities.experimental ?? {};
    caps.snippetTextEdit = true;
    caps.codeActionGroup = true;
    caps.resolveCodeAction = true;
    caps.hoverActions = true;
    caps.statusNotification = true;
    capabilities.experimental = caps;
  }
  initialize(_capabilities: lc.ServerCapabilities<any>, _documentSelector: lc.DocumentSelector | undefined): void {}
}

function isCodeActionWithoutEditsAndCommands(value: any): boolean {
  const candidate: lc.CodeAction = value;
  return (
    candidate &&
    Is.string(candidate.title) &&
    (candidate.diagnostics === void 0 || Is.typedArray(candidate.diagnostics, lc.Diag.is)) &&
    (candidate.kind === void 0 || Is.string(candidate.kind)) &&
    candidate.edit === void 0 &&
    candidate.command === void 0
  );
}
