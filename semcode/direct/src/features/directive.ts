import * as qv from 'vscode';
import { ServiceClient } from '../server/service';
import API from '../utils/env';
import * as qu from '../utils/base';
interface Directive {
  readonly value: string;
  readonly description: string;
}
const tsDirectives: Directive[] = [
  { value: '@ts-check', description: 'ts-check' },
  { value: '@ts-nocheck', description: 'ts-nocheck' },
  { value: '@ts-ignore', description: 'ts-ignore' },
];
const tsDirectives390: Directive[] = [...tsDirectives, { value: '@ts-expect-error', description: 'ts-expect-error' }];
class DirectiveComment implements qv.CompletionItemProvider {
  constructor(private readonly client: ServiceClient) {}
  public provideCompletionItems(d: qv.TextDocument, p: qv.Position, _: qv.CancellationToken): qv.CompletionItem[] {
    const file = this.client.toOpenedFilePath(d);
    if (!file) return [];
    const line = d.lineAt(p.line).text;
    const prefix = line.slice(0, p.character);
    const m = prefix.match(/^\s*\/\/+\s?(@[a-zA-Z\-]*)?$/);
    if (m) {
      const ds = this.client.apiVersion.gte(API.v390) ? tsDirectives390 : tsDirectives;
      return ds.map((d) => {
        const i = new qv.CompletionItem(d.value, qv.CompletionItemKind.Snippet);
        i.detail = d.description;
        i.range = new qv.Range(p.line, Math.max(0, p.character - (m[1] ? m[1].length : 0)), p.line, p.character);
        return i;
      });
    }
    return [];
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return qv.languages.registerCompletionItemProvider(s.syntax, new DirectiveComment(c), '@');
}
