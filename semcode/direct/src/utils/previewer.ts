import * as qv from 'vscode';
import type * as qp from '../protocol';
function replaceLinks(text: string): string {
  return text.replace(/\{@(link|linkplain|linkcode) (https?:\/\/[^ |}]+?)(?:[| ]([^{}\n]+?))?\}/gi, (_, tag: string, link: string, text?: string) => {
    switch (tag) {
      case 'linkcode':
        return `[\`${text ? text.trim() : link}\`](${link})`;
      default:
        return `[${text ? text.trim() : link}](${link})`;
    }
  });
}
function processInlineTags(text: string): string {
  return replaceLinks(text);
}
function getTagBodyText(tag: qp.JSDocTagInfo): string | undefined {
  if (!tag.text) return undefined;
  function makeCodeblock(text: string): string {
    if (text.match(/^\s*[~`]{3}/g)) {
      return text;
    }
    return '```\n' + text + '\n```';
  }
  switch (tag.name) {
    case 'example':
      const captionTagMatches = tag.text.match(/<caption>(.*?)<\/caption>\s*(\r\n|\n)/);
      if (captionTagMatches && captionTagMatches.index === 0) return captionTagMatches[1] + '\n\n' + makeCodeblock(tag.text.substr(captionTagMatches[0].length));
      else {
        return makeCodeblock(tag.text);
      }
    case 'author':
      const emailMatch = tag.text.match(/(.+)\s<([-.\w]+@[-.\w]+)>/);
      if (emailMatch === null) return tag.text;
      else {
        return `${emailMatch[1]} ${emailMatch[2]}`;
      }
    case 'default':
      return makeCodeblock(tag.text);
  }
  return processInlineTags(tag.text);
}
function getTagDocumentation(tag: qp.JSDocTagInfo): string | undefined {
  switch (tag.name) {
    case 'augments':
    case 'extends':
    case 'param':
    case 'template':
      const body = (tag.text || '').split(/^(\S+)\s*-?\s*/);
      if (body?.length === 3) {
        const param = body[1];
        const doc = body[2];
        const label = `*@${tag.name}* \`${param}\``;
        if (!doc) return label;
        return label + (doc.match(/\r\n|\n/g) ? '  \n' + processInlineTags(doc) : ` — ${processInlineTags(doc)}`);
      }
  }
  const label = `*@${tag.name}*`;
  const text = getTagBodyText(tag);
  if (!text) return label;
  return label + (text.match(/\r\n|\n/g) ? '  \n' + text : ` — ${text}`);
}
export function plain(parts: qp.SymbolDisplayPart[] | string): string {
  return processInlineTags(typeof parts === 'string' ? parts : parts.map((part) => part.text).join(''));
}
export function tagsMarkdownPreview(tags: qp.JSDocTagInfo[]): string {
  return tags.map(getTagDocumentation).join('  \n\n');
}
export function markdownDocumentation(documentation: qp.SymbolDisplayPart[] | string, tags: qp.JSDocTagInfo[]): qv.MarkdownString {
  const out = new qv.MarkdownString();
  addMarkdownDocumentation(out, documentation, tags);
  return out;
}
export function addMarkdownDocumentation(out: qv.MarkdownString, documentation: qp.SymbolDisplayPart[] | string | undefined, tags: qp.JSDocTagInfo[] | undefined): qv.MarkdownString {
  if (documentation) out.appendMarkdown(plain(documentation));
  if (tags) {
    const tagsPreview = tagsMarkdownPreview(tags);
    if (tagsPreview) out.appendMarkdown('\n\n' + tagsPreview);
  }
  return out;
}
