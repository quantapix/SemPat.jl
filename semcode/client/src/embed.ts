import { LanguageService, TokenType } from 'vscode-html-languageservice';

interface EmbeddedRegion {
  id?: string;
  start: number;
  end: number;
  attrVal?: boolean;
}

export function isInStyleRegion(s: LanguageService, txt: string, off: number) {
  const scan = s.createScanner(txt);
  let tok = scan.scan();
  while (tok !== TokenType.EOS) {
    switch (tok) {
      case TokenType.Styles:
        if (off >= scan.getTokenOffset() && off <= scan.getTokenEnd()) return true;
    }
    tok = scan.scan();
  }
  return false;
}

export function getCSSContent(s: LanguageService, txt: string): string {
  const rs: EmbeddedRegion[] = [];
  const scan = s.createScanner(txt);
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
            const c = txt[start];
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
  let content = txt
    .split('\n')
    .map((line) => {
      return ' '.repeat(line.length);
    })
    .join('\n');
  rs.forEach((r) => {
    if (r.id === 'css') content = content.slice(0, r.start) + txt.slice(r.start, r.end) + content.slice(r.end);
  });
  return content;
}

function getAttrLang(name: string): string | undefined {
  const m = name.match(/^(style)$|^(on\w+)$/i);
  if (!m) return undefined;
  return m[1] ? 'css' : 'javascript';
}
