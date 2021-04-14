import * as qv from 'vscode';
import { ServiceClient } from '../service';
import { conditionalRegistration, requireConfig } from '../../../src/registration';
import { DocumentSelector } from '../utils/documentSelector';
import * as qu from '../utils/qu';
import FileConfigMgr from './fileConfigMgr';
const defaultJsDoc = new qv.SnippetString(`/**\n * $0\n */`);
class JsDocCompletionItem extends qv.CompletionItem {
  constructor(public readonly document: qv.TextDocument, public readonly position: qv.Position) {
    super('/** */', qv.CompletionItemKind.Text);
    this.detail = 'typescript.jsDocCompletionItem.documentation';
    this.sortText = '\0';
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character).match(/\/\**\s*$/);
    const suffix = line.slice(position.character).match(/^\s*\**\//);
    const start = position.translate(0, prefix ? -prefix[0].length : 0);
    const range = new qv.Range(start, position.translate(0, suffix ? suffix[0].length : 0));
    this.range = { inserting: range, replacing: range };
  }
}
class JsDocCompletionProvider implements qv.CompletionItemProvider {
  constructor(private readonly client: ServiceClient, private readonly fileConfigMgr: FileConfigMgr) {}
  public async provideCompletionItems(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken): Promise<qv.CompletionItem[] | undefined> {
    const file = this.client.toOpenedFilePath(document);
    if (!file) return undefined;
    if (!this.isPotentiallyValidDocCompletionPosition(document, position)) {
      return undefined;
    }
    const response = await this.client.interruptGetErr(async () => {
      await this.fileConfigMgr.ensureConfigForDocument(document, token);
      const args = qu.Position.toFileLocationRequestArgs(file, position);
      return this.client.execute('docCommentTemplate', args, token);
    });
    if (response.type !== 'response' || !response.body) return undefined;
    const item = new JsDocCompletionItem(document, position);
    if (response.body.newText === '/** */') item.insertText = defaultJsDoc;
    else {
      item.insertText = templateToSnippet(response.body.newText);
    }
    return [item];
  }
  private isPotentiallyValidDocCompletionPosition(document: qv.TextDocument, position: qv.Position): boolean {
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character);
    if (!/^\s*$|\/\*\*\s*$|^\s*\/\*\*+\s*$/.test(prefix)) {
      return false;
    }
    const suffix = line.slice(position.character);
    return /^\s*(\*+\/)?\s*$/.test(suffix);
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
    else if (type) {
      out += type + ' ';
    }
    out += post + ` \${${snippetIndex++}}`;
    return out;
  });
  template = template.replace(/\* @returns[ \t]*$/gm, `* @returns \${${snippetIndex++}}`);
  return new qv.SnippetString(template);
}
export function register(selector: DocumentSelector, modeId: string, client: ServiceClient, fileConfigMgr: FileConfigMgr): qv.Disposable {
  return conditionalRegistration([requireConfig(modeId, 'suggest.completeJSDocs')], () => {
    return qv.languages.registerCompletionItemProvider(selector.syntax, new JsDocCompletionProvider(client, fileConfigMgr), '*');
  });
}
