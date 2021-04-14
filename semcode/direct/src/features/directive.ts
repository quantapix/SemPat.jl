import * as qv from 'vscode';
import { ServiceClient } from '../service';
import API from '../utils/api';
import { DocumentSelector } from '../utils/documentSelector';
interface Directive {
  readonly value: string;
  readonly description: string;
}
const tsDirectives: Directive[] = [
  {
    value: '@ts-check',
    description: 'ts-check',
  },
  {
    value: '@ts-nocheck',
    description: 'ts-nocheck',
  },
  {
    value: '@ts-ignore',
    description: 'ts-ignore',
  },
];
const tsDirectives390: Directive[] = [
  ...tsDirectives,
  {
    value: '@ts-expect-error',
    description: 'ts-expect-error',
  },
];
class DirectiveCommentCompletionProvider implements qv.CompletionItemProvider {
  constructor(private readonly client: ServiceClient) {}
  public provideCompletionItems(document: qv.TextDocument, position: qv.Position, _token: qv.CancellationToken): qv.CompletionItem[] {
    const file = this.client.toOpenedFilePath(document);
    if (!file) return [];
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character);
    const match = prefix.match(/^\s*\/\/+\s?(@[a-zA-Z\-]*)?$/);
    if (match) {
      const directives = this.client.apiVersion.gte(API.v390) ? tsDirectives390 : tsDirectives;
      return directives.map((directive) => {
        const item = new qv.CompletionItem(directive.value, qv.CompletionItemKind.Snippet);
        item.detail = directive.description;
        item.range = new qv.Range(position.line, Math.max(0, position.character - (match[1] ? match[1].length : 0)), position.line, position.character);
        return item;
      });
    }
    return [];
  }
}
export function register(selector: DocumentSelector, client: ServiceClient) {
  return qv.languages.registerCompletionItemProvider(selector.syntax, new DirectiveCommentCompletionProvider(client), '@');
}
