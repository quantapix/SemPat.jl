import { LanguageService, TokenType } from 'vscode-html-languageservice';
import { Position, Range } from 'vscode-languageclient';
import { TextDocument } from 'vscode-languageserver-textdocument';

export interface LangRange extends Range {
  id?: string;
  attrVal?: boolean;
}

export interface HTMLRegions {
  getEmbedded(id: string, ignoreAttributeValues?: boolean): TextDocument;
  getLangRanges(r: Range): LangRange[];
  getLangAtPos(p: Position): string | undefined;
  getLangs(): string[];
  getImports(): string[];
}

export const CSS_STYLE_RULE = '__';

interface EmbeddedRegion {
  id?: string;
  start: number;
  end: number;
  attrVal?: boolean;
}

export function getDocRegions(s: LanguageService, doc: TextDocument): HTMLRegions {
  const rs: EmbeddedRegion[] = [];
  const scan = s.createScanner(doc.getText());
  let tag: string = '';
  let attr: string | undefined = undefined;
  let id: string | undefined = undefined;
  const imports: string[] = [];
  let tok = scan.scan();
  while (tok !== TokenType.EOS) {
    switch (tok) {
      case TokenType.StartTag:
        tag = scan.getTokenText();
        attr = undefined;
        id = 'javascript';
        break;
      case TokenType.Styles:
        rs.push({ id: 'css', start: scan.getTokenOffset(), end: scan.getTokenEnd() });
        break;
      case TokenType.Script:
        rs.push({ id, start: scan.getTokenOffset(), end: scan.getTokenEnd() });
        break;
      case TokenType.AttributeName:
        attr = scan.getTokenText();
        break;
      case TokenType.AttributeValue:
        if (attr === 'src' && tag.toLowerCase() === 'script') {
          let x = scan.getTokenText();
          if (x[0] === "'" || x[0] === '"') x = x.substr(1, x.length - 1);
          imports.push(x);
        } else if (attr === 'type' && tag.toLowerCase() === 'script') {
          if (/["'](module|(text|application)\/(java|ecma)script|text\/babel)["']/.test(scan.getTokenText())) id = 'javascript';
          else if (/["']text\/typescript["']/.test(scan.getTokenText())) id = 'typescript';
          else id = undefined;
        } else {
          let attrId = getAttrLang(attr!);
          if (attrId) {
            let start = scan.getTokenOffset();
            let end = scan.getTokenEnd();
            const c = doc.getText()[start];
            if (c === "'" || c === '"') {
              start++;
              end--;
            }
            rs.push({ id: attrId, start, end, attrVal: true });
          }
        }
        attr = undefined;
        break;
    }
    tok = scan.scan();
  }
  return {
    getLangRanges: (r: Range) => getLangRanges(doc, rs, r),
    getEmbedded: (id: string, ignore: boolean) => getEmbedded(doc, rs, id, ignore),
    getLangAtPos: (p: Position) => getLangAtPos(doc, rs, p),
    getLangs: () => getLangs(doc, rs),
    getImports: () => imports,
  };
}

function getLangRanges(doc: TextDocument, rs: EmbeddedRegion[], range: Range): LangRange[] {
  let y: LangRange[] = [];
  let p = range ? range.start : Position.create(0, 0);
  let o = range ? doc.offsetAt(range.start) : 0;
  const eo = range ? doc.offsetAt(range.end) : doc.getText().length;
  for (const r of rs) {
    if (r.end > o && r.start < eo) {
      const start = Math.max(r.start, o);
      let sp = doc.positionAt(start);
      if (o < r.start) y.push({ start: p, end: sp, id: 'html' });
      const end = Math.min(r.end, eo);
      let ep = doc.positionAt(end);
      if (end > r.start) y.push({ start: sp, end: ep, id: r.id, attrVal: r.attrVal });
      o = end;
      p = ep;
    }
  }
  if (o < eo) {
    const ep = range ? range.end : doc.positionAt(eo);
    y.push({ start: p, end: ep, id: 'html' });
  }
  return y;
}

function getLangs(_: TextDocument, rs: EmbeddedRegion[]): string[] {
  const y = [];
  for (const r of rs) {
    if (r.id && y.indexOf(r.id) === -1) {
      y.push(r.id);
      if (y.length === 3) return y;
    }
  }
  y.push('html');
  return y;
}

function getLangAtPos(d: TextDocument, rs: EmbeddedRegion[], p: Position): string | undefined {
  let off = d.offsetAt(p);
  for (const r of rs) {
    if (r.start <= off) {
      if (off <= r.end) return r.id;
    } else break;
  }
  return 'html';
}

function getEmbedded(d: TextDocument, rs: EmbeddedRegion[], id: string, ignore: boolean): TextDocument {
  let p = 0;
  const x = d.getText();
  let y = '';
  let suff = '';
  for (const r of rs) {
    if (r.id === id && (!ignore || !r.attrVal)) {
      y = substituteWithWS(y, p, r.start, x, suff, getPrefix(r));
      y += x.substring(r.start, r.end);
      p = r.end;
      suff = getSuffix(r);
    }
  }
  y = substituteWithWS(y, p, x.length, x, suff, '');
  return TextDocument.create(d.uri, id, d.version, y);
}

function getPrefix(r: EmbeddedRegion) {
  if (r.attrVal) {
    switch (r.id) {
      case 'css':
        return CSS_STYLE_RULE + '{';
    }
  }
  return '';
}

function getSuffix(r: EmbeddedRegion) {
  if (r.attrVal) {
    switch (r.id) {
      case 'css':
        return '}';
      case 'javascript':
        return ';';
    }
  }
  return '';
}

function substituteWithWS(y: string, start: number, end: number, x: string, before: string, after: string) {
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

function getAttrLang(name: string): string | undefined {
  const m = name.match(/^(style)$|^(on\w+)$/i);
  if (!m) return undefined;
  return m[1] ? 'css' : 'javascript';
}
