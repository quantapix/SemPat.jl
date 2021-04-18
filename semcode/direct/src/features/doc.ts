import * as qv from 'vscode';
import { ServiceClient } from '../server/service';
import { conditionalRegistration, requireConfig } from '../../../src/registration';
import * as qu from '../utils/base';
import FileConfigMgr from './fileConfigMgr';

const defaultJsDoc = new qv.SnippetString(`/**\n * $0\n */`);
class JsDocCompletionItem extends qv.CompletionItem {
  constructor(public readonly doc: qv.TextDocument, public readonly pos: qv.Position) {
    super('/** */', qv.CompletionItemKind.Text);
    this.detail = 'typescript.jsDocCompletionItem.documentation';
    this.sortText = '\0';
    const l = doc.lineAt(pos.line).text;
    const pre = l.slice(0, pos.character).match(/\/\**\s*$/);
    const suf = l.slice(pos.character).match(/^\s*\**\//);
    const start = pos.translate(0, pre ? -pre[0].length : 0);
    const r = new qv.Range(start, pos.translate(0, suf ? suf[0].length : 0));
    this.range = { inserting: r, replacing: r };
  }
}
class JsDocCompletionProvider implements qv.CompletionItemProvider {
  constructor(private readonly client: ServiceClient, private readonly mgr: FileConfigMgr) {}
  public async provideCompletionItems(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.CompletionItem[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    if (!this.isPotentiallyValidDocCompletionPosition(d, p)) return undefined;
    const x = await this.client.interruptGetErr(async () => {
      await this.mgr.ensureConfigForDocument(d, t);
      const xs = qu.Position.toFileLocationRequestArgs(f, p);
      return this.client.execute('docCommentTemplate', xs, t);
    });
    if (x.type !== 'response' || !x.body) return undefined;
    const i = new JsDocCompletionItem(d, p);
    if (x.body.newText === '/** */') i.insertText = defaultJsDoc;
    else i.insertText = templateToSnippet(x.body.newText);
    return [i];
  }
  private isPotentiallyValidDocCompletionPosition(d: qv.TextDocument, p: qv.Position): boolean {
    const l = d.lineAt(p.line).text;
    const pre = l.slice(0, p.character);
    if (!/^\s*$|\/\*\*\s*$|^\s*\/\*\*+\s*$/.test(pre)) return false;
    const suf = l.slice(p.character);
    return /^\s*(\*+\/)?\s*$/.test(suf);
  }
}
export function templateToSnippet(template: string): qv.SnippetString {
  let snippetIndex = 1;
  template = template.replace(/\$/g, '\\$');
  template = template.replace(/^[ \t]*(?=(\/|[ ]\*))/gm, '');
  template = template.replace(/^(\/\*\*\s*\*[ ]*)$/m, (x) => x + `\$0`);
  template = template.replace(/\* @param([ ]\{\S+\})?\s+(\S+)[ \t]*$/gm, (_param, type, post) => {
    let out = '* @param ';
    if (type === ' {any}' || type === ' {*}') out += `{\$\{${snippetIndex++}:*\}} `;
    else if (type) out += type + ' ';
    out += post + ` \${${snippetIndex++}}`;
    return out;
  });
  template = template.replace(/\* @returns[ \t]*$/gm, `* @returns \${${snippetIndex++}}`);
  return new qv.SnippetString(template);
}
export function register(s: qu.DocumentSelector, mode: string, c: ServiceClient, m: FileConfigMgr): qv.Disposable {
  return conditionalRegistration([requireConfig(mode, 'suggest.completeJSDocs')], () => {
    return qv.languages.registerCompletionItemProvider(s.syntax, new JsDocCompletionProvider(c, m), '*');
  });
}
