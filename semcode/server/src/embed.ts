import { TextDocument, Position, LanguageService, TokenType, Range } from './modes';

export interface LangRange extends Range {
  languageId: string | undefined;
  attributeValue?: boolean;
}

export interface HTMLRegions {
  getEmbeddedDocument(id: string, ignoreAttributeValues?: boolean): TextDocument;
  getLanguageRanges(r: Range): LangRange[];
  getLanguageAtPosition(p: Position): string | undefined;
  getLanguagesInDocument(): string[];
  getImportedScripts(): string[];
}

export const CSS_STYLE_RULE = '__';

interface EmbeddedRegion {
  languageId: string | undefined;
  start: number;
  end: number;
  attributeValue?: boolean;
}

export function getDocRegions(languageService: LanguageService, document: TextDocument): HTMLRegions {
  let regions: EmbeddedRegion[] = [];
  let scanner = languageService.createScanner(document.getText());
  let lastTagName: string = '';
  let lastAttributeName: string | null = null;
  let languageIdFromType: string | undefined = undefined;
  let importedScripts: string[] = [];
  let token = scanner.scan();
  while (token !== TokenType.EOS) {
    switch (token) {
      case TokenType.StartTag:
        lastTagName = scanner.getTokenText();
        lastAttributeName = null;
        languageIdFromType = 'javascript';
        break;
      case TokenType.Styles:
        regions.push({ languageId: 'css', start: scanner.getTokenOffset(), end: scanner.getTokenEnd() });
        break;
      case TokenType.Script:
        regions.push({ languageId: languageIdFromType, start: scanner.getTokenOffset(), end: scanner.getTokenEnd() });
        break;
      case TokenType.AttributeName:
        lastAttributeName = scanner.getTokenText();
        break;
      case TokenType.AttributeValue:
        if (lastAttributeName === 'src' && lastTagName.toLowerCase() === 'script') {
          let value = scanner.getTokenText();
          if (value[0] === "'" || value[0] === '"') {
            value = value.substr(1, value.length - 1);
          }
          importedScripts.push(value);
        } else if (lastAttributeName === 'type' && lastTagName.toLowerCase() === 'script') {
          if (/["'](module|(text|application)\/(java|ecma)script|text\/babel)["']/.test(scanner.getTokenText())) {
            languageIdFromType = 'javascript';
          } else if (/["']text\/typescript["']/.test(scanner.getTokenText())) {
            languageIdFromType = 'typescript';
          } else {
            languageIdFromType = undefined;
          }
        } else {
          let attributeLanguageId = getAttributeLanguage(lastAttributeName!);
          if (attributeLanguageId) {
            let start = scanner.getTokenOffset();
            let end = scanner.getTokenEnd();
            let firstChar = document.getText()[start];
            if (firstChar === "'" || firstChar === '"') {
              start++;
              end--;
            }
            regions.push({ languageId: attributeLanguageId, start, end, attributeValue: true });
          }
        }
        lastAttributeName = null;
        break;
    }
    token = scanner.scan();
  }
  return {
    getLanguageRanges: (r: Range) => getLanguageRanges(document, regions, r),
    getEmbeddedDocument: (id: string, ignoreAttributeValues: boolean) => getEmbeddedDocument(document, regions, id, ignoreAttributeValues),
    getLanguageAtPosition: (p: Position) => getLanguageAtPosition(document, regions, p),
    getLanguagesInDocument: () => getLanguagesInDocument(document, regions),
    getImportedScripts: () => importedScripts,
  };
}

function getLanguageRanges(d: TextDocument, rs: EmbeddedRegion[], range: Range): LangRange[] {
  let y: LangRange[] = [];
  let pos = range ? range.start : Position.create(0, 0);
  let off = range ? d.offsetAt(range.start) : 0;
  let endOffset = range ? d.offsetAt(range.end) : d.getText().length;
  for (const r of rs) {
    if (r.end > off && r.start < endOffset) {
      let start = Math.max(r.start, off);
      let startPos = d.positionAt(start);
      if (off < r.start) {
        y.push({
          start: pos,
          end: startPos,
          languageId: 'html',
        });
      }
      let end = Math.min(r.end, endOffset);
      let endPos = d.positionAt(end);
      if (end > r.start) {
        y.push({
          start: startPos,
          end: endPos,
          languageId: r.languageId,
          attributeValue: r.attributeValue,
        });
      }
      off = end;
      pos = endPos;
    }
  }
  if (off < endOffset) {
    let endPos = range ? range.end : d.positionAt(endOffset);
    y.push({
      start: pos,
      end: endPos,
      languageId: 'html',
    });
  }
  return y;
}

function getLanguagesInDocument(_: TextDocument, rs: EmbeddedRegion[]): string[] {
  const y = [];
  for (const r of rs) {
    if (r.languageId && y.indexOf(r.languageId) === -1) {
      y.push(r.languageId);
      if (y.length === 3) return y;
    }
  }
  y.push('html');
  return y;
}

function getLanguageAtPosition(d: TextDocument, rs: EmbeddedRegion[], p: Position): string | undefined {
  let off = d.offsetAt(p);
  for (const r of rs) {
    if (r.start <= off) {
      if (off <= r.end) return r.languageId;
    } else break;
  }
  return 'html';
}

function getEmbeddedDocument(d: TextDocument, rs: EmbeddedRegion[], id: string, ignore: boolean): TextDocument {
  let pos = 0;
  const x = d.getText();
  let y = '';
  let suff = '';
  for (const r of rs) {
    if (r.languageId === id && (!ignore || !r.attributeValue)) {
      y = substituteWithWhitespace(y, pos, r.start, x, suff, getPrefix(r));
      y += x.substring(r.start, r.end);
      pos = r.end;
      suff = getSuffix(r);
    }
  }
  y = substituteWithWhitespace(y, pos, x.length, x, suff, '');
  return TextDocument.create(d.uri, id, d.version, y);
}

function getPrefix(r: EmbeddedRegion) {
  if (r.attributeValue) {
    switch (r.languageId) {
      case 'css':
        return CSS_STYLE_RULE + '{';
    }
  }
  return '';
}
function getSuffix(r: EmbeddedRegion) {
  if (r.attributeValue) {
    switch (r.languageId) {
      case 'css':
        return '}';
      case 'javascript':
        return ';';
    }
  }
  return '';
}

function substituteWithWhitespace(y: string, start: number, end: number, x: string, before: string, after: string) {
  let ws = 0;
  y += before;
  for (let i = start + before.length; i < end; i++) {
    const c = x[i];
    if (c === '\n' || c === '\r') {
      ws = 0;
      y += c;
    } else ws++;
  }
  y = append(y, ' ', ws - after.length);
  y += after;
  return y;
}

function append(y: string, x: string, n: number): string {
  while (n > 0) {
    if (n & 1) y += x;
    n >>= 1;
    x += x;
  }
  return y;
}

function getAttributeLanguage(name: string): string | undefined {
  const m = name.match(/^(style)$|^(on\w+)$/i);
  if (!m) return undefined;
  return m[1] ? 'css' : 'javascript';
}
