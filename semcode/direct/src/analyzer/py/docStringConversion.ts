export function convertDocStringToMarkdown(docString: string): string {
  return new DocStringConverter(docString).convert();
}

export function convertDocStringToPlainText(docString: string): string {
  const lines = _splitDocString(docString);
  const output: string[] = [];

  for (const line of lines) {
    const last = output.length > 0 ? output[output.length - 1] : undefined;
    if (_isUndefinedOrWhitespace(line) && _isUndefinedOrWhitespace(last)) {
      continue;
    }

    output.push(line);
  }

  return output.join('\n').trimEnd();
}

interface RegExpReplacement {
  exp: RegExp;
  replacement: string;
}

const LeadingSpaceCountRegExp = /\S|$/;
const CrLfRegExp = /\r?\n/;
const NonWhitespaceRegExp = /\S/;
const TildaHeaderRegExp = /^\s*~~~+$/;
const PlusHeaderRegExp = /^\s*\+\+\++$/;
const LeadingDashListRegExp = /^(\s*)-\s/;
const LeadingAsteriskListRegExp = /^(\s*)\*\s/;
const LeadingNumberListRegExp = /^(\s*)\d+\.\s/;
const LeadingAsteriskRegExp = /^(\s+\* )(.*)$/;
const SpaceDotDotRegExp = /^\s*\.\. /;
const DirectiveLikeRegExp = /^\s*\.\.\s+(\w+)::\s*(.*)$/;
const DoctestRegExp = / *>>> /;
const DirectivesExtraNewlineRegExp = /^\s*:(param|arg|type|return|rtype|raise|except|var|ivar|cvar|copyright|license)/;
const epyDocFieldTokensRegExp = /^[.\s\t]+(@\w+)/; // cv2 has leading '.' http://epydoc.sourceforge.net/manual-epytext.html
const epyDocCv2FixRegExp = /^(\.\s{3})|^(\.)/;

const PotentialHeaders: RegExpReplacement[] = [
  { exp: /^\s*=+(\s+=+)+$/, replacement: '=' },
  { exp: /^\s*-+(\s+-+)+$/, replacement: '-' },
  { exp: /^\s*~+(\s+-+)+$/, replacement: '~' },
  { exp: /^\s*\++(\s+\++)+$/, replacement: '+' },
];

const WhitespaceRegExp = /\s/g;
const DoubleTickRegExp = /``/g;
const TabRegExp = /\t/g;
const TildeRegExp = /~/g;
const PlusRegExp = /\+/g;
const UnescapedMarkdownCharsRegExp = /(?<!\\)([_*~[\]])/g;

const HtmlEscapes: RegExpReplacement[] = [
  { exp: /</g, replacement: '&lt;' },
  { exp: />/g, replacement: '&gt;' },
];

const LiteralBlockEmptyRegExp = /^\s*::$/;
const LiteralBlockReplacements: RegExpReplacement[] = [
  { exp: /\s+::$/g, replacement: '' },
  { exp: /(\S)\s*::$/g, replacement: '$1:' },

  { exp: /:[\w_\-+:.]+:`/g, replacement: '`' },
  { exp: /`:[\w_\-+:.]+:/g, replacement: '`' },
];

type State = () => void;

class DocStringConverter {
  private _builder = '';
  private _skipAppendEmptyLine = true;
  private _insideInlineCode = false;
  private _appendDirectiveBlock = false;

  private _state: State;
  private _stateStack: State[] = [];

  private _lines: string[];
  private _lineNum = 0;

  private _blockIndent = 0;

  constructor(input: string) {
    this._state = this._parseText;
    this._lines = _splitDocString(input);
  }

  convert(): string {
    const isEpyDoc = this._lines.some((v) => epyDocFieldTokensRegExp.exec(v));
    if (isEpyDoc) {
      this._lines = this._lines.map((v) => v.replace(epyDocCv2FixRegExp, ''));
    }

    while (this._currentLineOrUndefined() !== undefined) {
      const before = this._state;
      const beforeLine = this._lineNum;

      this._state();

      if (this._state === before && this._lineNum === beforeLine) {
        break;
      }
    }

    if (this._state === this._parseBacktickBlock || this._state === this._parseDocTest || this._state === this._parseLiteralBlock) {
      this._trimOutputAndAppendLine('```');
    } else if (this._insideInlineCode) {
      this._trimOutputAndAppendLine('`', true);
    }

    return this._builder.trim();
  }

  private _eatLine() {
    this._lineNum++;
  }

  private _currentLineOrUndefined(): string | undefined {
    return this._lineNum < this._lines.length ? this._lines[this._lineNum] : undefined;
  }

  private _currentLine(): string {
    return this._currentLineOrUndefined() || '';
  }

  private _currentIndent(): number {
    return _countLeadingSpaces(this._currentLine());
  }

  private _prevIndent(): number {
    return _countLeadingSpaces(this._lineAt(this._lineNum - 1) ?? '');
  }

  private _lineAt(i: number): string | undefined {
    return i < this._lines.length ? this._lines[i] : undefined;
  }

  private _nextBlockIndent(): number {
    return _countLeadingSpaces(this._lines.slice(this._lineNum + 1).find((v) => !_isUndefinedOrWhitespace(v)) || '');
  }

  private _currentLineIsOutsideBlock(): boolean {
    return this._currentIndent() < this._blockIndent;
  }

  private _currentLineWithinBlock(): string {
    return this._currentLine().substr(this._blockIndent);
  }

  private _pushAndSetState(next: State): void {
    if (this._state === this._parseText) {
      this._insideInlineCode = false;
    }

    this._stateStack.push(this._state);
    this._state = next;
  }

  private _popState(): void {
    this._state = this._stateStack.splice(0, 1)[0];

    if (this._state === this._parseText) {
      this._insideInlineCode = false;
    }
  }

  private _parseText(): void {
    if (_isUndefinedOrWhitespace(this._currentLineOrUndefined())) {
      this._state = this._parseEmpty;
      return;
    }

    if (this._beginBacktickBlock()) {
      return;
    }

    if (this._beginLiteralBlock()) {
      return;
    }

    if (this._beginDocTest()) {
      return;
    }

    if (this._beginDirective()) {
      return;
    }

    if (this._beginList()) {
      return;
    }

    if (this._beginFieldList()) {
      return;
    }

    const line = this.formatPlainTextIndent(this._currentLine());

    this._appendTextLine(line);
    this._eatLine();
  }

  private formatPlainTextIndent(line: string) {
    const prev = this._lineAt(this._lineNum - 1);
    const prevIndent = this._prevIndent();
    const currIndent = this._currentIndent();

    if (currIndent > prevIndent && !_isUndefinedOrWhitespace(prev) && !this._builder.endsWith('\\\n') && !this._builder.endsWith('\n\n') && !_isHeader(prev)) {
      this._builder = this._builder.slice(0, -1) + '\\\n';
    }

    if (prevIndent > currIndent && !_isUndefinedOrWhitespace(prev) && !this._builder.endsWith('\\\n') && !this._builder.endsWith('\n\n')) {
      this._builder = this._builder.slice(0, -1) + '\\\n';
    }

    if (prevIndent === 0 || this._builder.endsWith('\\\n') || this._builder.endsWith('\n\n')) {
      line = this._convertIndent(line);
    } else {
      line = line.trimStart();
    }
    return line;
  }

  private _convertIndent(line: string) {
    line = line.replace(/^([ \t]+)(.+)$/g, (_match, g1, g2) => '&nbsp;'.repeat(g1.length) + g2);
    return line;
  }

  private _escapeHtml(line: string): string {
    HtmlEscapes.forEach((escape) => {
      line = line.replace(escape.exp, escape.replacement);
    });

    return line;
  }

  private _appendTextLine(line: string): void {
    line = this._preprocessTextLine(line);

    const parts = line.split('`');

    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];

      if (i > 0) {
        this._insideInlineCode = !this._insideInlineCode;
        this._append('`');
      }

      if (this._insideInlineCode) {
        this._append(part);
        continue;
      }

      part = this._escapeHtml(part);

      if (i === 0) {
        if (parts.length === 1) {
          for (const expReplacement of PotentialHeaders) {
            if (expReplacement.exp.test(part)) {
              part = part.replace(WhitespaceRegExp, expReplacement.replacement);
              break;
            }
          }

          if (TildaHeaderRegExp.test(part)) {
            this._append(part.replace(TildeRegExp, '-'));
            continue;
          }

          if (PlusHeaderRegExp.test(part)) {
            this._append(part.replace(PlusRegExp, '-'));
            continue;
          }
        }

        const match = LeadingAsteriskRegExp.exec(part);
        if (match !== null && match.length === 3) {
          this._append(match[1]);
          part = match[2];
        }
      }

      part = part.replace(UnescapedMarkdownCharsRegExp, '\\$1');

      this._append(part);
    }

    this._builder += '\n';
  }

  private _preprocessTextLine(line: string): string {
    if (LiteralBlockEmptyRegExp.test(line)) {
      return '';
    }

    LiteralBlockReplacements.forEach((item) => (line = line.replace(item.exp, item.replacement)));

    line = line.replace(DoubleTickRegExp, '`');
    return line;
  }

  private _parseEmpty(): void {
    if (_isUndefinedOrWhitespace(this._currentLineOrUndefined())) {
      this._appendLine();
      this._eatLine();
      return;
    }

    this._state = this._parseText;
  }

  private _beginMinIndentCodeBlock(state: State): void {
    this._appendLine('```');
    this._pushAndSetState(state);
    this._blockIndent = this._currentIndent();
  }

  private _beginBacktickBlock(): boolean {
    if (this._currentLine().startsWith('```')) {
      this._appendLine(this._currentLine());
      this._pushAndSetState(this._parseBacktickBlock);
      this._eatLine();
      return true;
    }
    return false;
  }

  private _parseBacktickBlock(): void {
    if (this._currentLine().startsWith('```')) {
      this._appendLine('```');
      this._appendLine();
      this._popState();
    } else {
      this._appendLine(this._currentLine());
    }

    this._eatLine();
  }

  private _beginDocTest(): boolean {
    if (!DoctestRegExp.test(this._currentLine())) {
      return false;
    }

    this._beginMinIndentCodeBlock(this._parseDocTest);
    this._appendLine(this._currentLineWithinBlock());
    this._eatLine();
    return true;
  }

  private _parseDocTest(): void {
    if (this._currentLineIsOutsideBlock() || _isUndefinedOrWhitespace(this._currentLine())) {
      this._trimOutputAndAppendLine('```');
      this._appendLine();
      this._popState();
      return;
    }

    this._appendLine(this._currentLineWithinBlock());
    this._eatLine();
  }

  private _beginLiteralBlock(): boolean {
    const prev = this._lineAt(this._lineNum - 1);
    if (prev === undefined) {
      return false;
    } else if (!_isUndefinedOrWhitespace(prev)) {
      return false;
    }

    let i = this._lineNum - 2;
    for (; i >= 0; i--) {
      const line = this._lineAt(i);
      if (_isUndefinedOrWhitespace(line)) {
        continue;
      }

      if (line!.endsWith('::')) {
        break;
      }

      return false;
    }

    if (i < 0) {
      return false;
    }

    if (this._currentIndent() === 0) {
      this._appendLine('```');
      this._pushAndSetState(this._parseLiteralBlockSingleLine);
      return true;
    }

    this._beginMinIndentCodeBlock(this._parseLiteralBlock);
    return true;
  }

  private _parseLiteralBlock(): void {
    if (_isUndefinedOrWhitespace(this._currentLineOrUndefined())) {
      this._appendLine();
      this._eatLine();
      return;
    }

    if (this._currentLineIsOutsideBlock()) {
      this._trimOutputAndAppendLine('```');
      this._appendLine();
      this._popState();
      return;
    }

    this._appendLine(this._currentLineWithinBlock());
    this._eatLine();
  }

  private _parseLiteralBlockSingleLine(): void {
    this._appendLine(this._currentLine());
    this._appendLine('```');
    this._appendLine();
    this._popState();
    this._eatLine();
  }

  private _beginDirective(): boolean {
    if (!SpaceDotDotRegExp.test(this._currentLine())) {
      return false;
    }

    this._pushAndSetState(this._parseDirective);
    this._blockIndent = this._nextBlockIndent();
    this._appendDirectiveBlock = false;
    return true;
  }

  private _beginFieldList(): boolean {
    if (this._insideInlineCode) {
      return false;
    }

    let line = this._currentLine();

    if (line.startsWith('@')) {
      this._appendLine();
      this._appendTextLine(line);
      this._eatLine();
      return true;
    }

    const hasOddNumColons = !line?.endsWith(':') && !line?.endsWith('::') && (line.match(/:/g)?.length ?? 0) % 2 === 1; // odd number of colons

    const restDirective = DirectivesExtraNewlineRegExp.test(line); //line.match(/^\s*:param/);

    if (hasOddNumColons || restDirective) {
      const prev = this._lineAt(this._lineNum - 1);

      if (!this._builder.endsWith(`\\\n`) && !this._builder.endsWith(`\n\n`) && !_isHeader(prev)) {
        this._builder = this._builder.slice(0, -1) + '\\\n';
      }

      line = this._convertIndent(line);
      this._appendTextLine(line);
      this._eatLine();
      return true;
    }

    return false;
  }

  private _beginList(): boolean {
    if (this._insideInlineCode) {
      return false;
    }

    let line = this._currentLine();
    const dashMatch = LeadingDashListRegExp.exec(line);
    if (dashMatch?.length === 2) {
      if (dashMatch[1].length >= 4) {
        line = ' '.repeat(dashMatch[1].length / 2) + line.trimLeft();
      }

      this._appendTextLine(line);
      this._eatLine();

      if (this._state !== this._parseList) {
        this._pushAndSetState(this._parseList);
      }
      return true;
    }

    const asteriskMatch = LeadingAsteriskListRegExp.exec(line);
    if (asteriskMatch?.length === 2) {
      if (asteriskMatch[1].length === 0) {
        line = line = ' ' + line;
      } else if (asteriskMatch[1].length >= 4) {
        line = ' '.repeat(asteriskMatch[1].length / 2) + line.trimLeft();
      }

      this._appendTextLine(line);
      this._eatLine();
      if (this._state !== this._parseList) {
        this._pushAndSetState(this._parseList);
      }
      return true;
    }

    const leadingNumberList = LeadingNumberListRegExp.exec(line);
    if (leadingNumberList?.length === 2) {
      this._appendTextLine(line);
      this._eatLine();
      return true;
    }

    return false;
  }

  private _parseList(): void {
    if (_isUndefinedOrWhitespace(this._currentLineOrUndefined()) || this._currentLineIsOutsideBlock()) {
      this._popState();
      return;
    }

    const isMultiLineItem = !this._beginList();

    if (isMultiLineItem) {
      const line = this._currentLine().trimStart();
      this._appendTextLine(line);
      this._eatLine();
    }
  }

  private _parseDirective(): void {
    const match = DirectiveLikeRegExp.exec(this._currentLine());
    if (match !== null && match.length === 3) {
      const directiveType = match[1];
      const directive = match[2];

      if (directiveType === 'class') {
        this._appendDirectiveBlock = true;
        this._appendLine();
        this._appendLine('```');
        this._appendLine(directive);
        this._appendLine('```');
        this._appendLine();
      }
    }

    if (this._blockIndent === 0) {
      this._popState();
    } else {
      this._state = this._parseDirectiveBlock;
    }

    this._eatLine();
  }

  private _parseDirectiveBlock(): void {
    if (!_isUndefinedOrWhitespace(this._currentLineOrUndefined()) && this._currentLineIsOutsideBlock()) {
      this._popState();
      return;
    }

    if (this._appendDirectiveBlock) {
      this._appendTextLine(this._currentLine().trimLeft());
    }

    this._eatLine();
  }

  private _appendLine(line?: string): void {
    if (!_isUndefinedOrWhitespace(line)) {
      this._builder += line + '\n';
      this._skipAppendEmptyLine = false;
    } else if (!this._skipAppendEmptyLine) {
      this._builder += '\n';
      this._skipAppendEmptyLine = true;
    }
  }

  private _append(text: string): void {
    this._builder += text;
    this._skipAppendEmptyLine = false;
  }

  private _trimOutputAndAppendLine(line: string, noNewLine = false): void {
    this._builder = this._builder.trimRight();
    this._skipAppendEmptyLine = false;

    if (!noNewLine) {
      this._appendLine();
    }

    this._appendLine(line);
  }
}

function _splitDocString(docstring: string): string[] {
  docstring = docstring.replace(TabRegExp, ' '.repeat(8));

  let lines = docstring.split(CrLfRegExp).map((v) => v.trimRight());
  if (lines.length > 0) {
    let first: string | undefined = lines[0].trimLeft();
    if (first === '') {
      first = undefined;
    } else {
      lines.splice(0, 1);
    }

    lines = _stripLeadingWhitespace(lines);

    if (first !== undefined) {
      lines.splice(0, 0, first);
    }
  }

  return lines;
}

function _stripLeadingWhitespace(lines: string[], trim?: number): string[] {
  const amount = trim === undefined ? _largestTrim(lines) : trim;
  return lines.map((line) => (amount > line.length ? '' : line.substr(amount)));
}

function _largestTrim(lines: string[]): number {
  const nonEmptyLines = lines.filter((s) => !_isUndefinedOrWhitespace(s));
  const counts = nonEmptyLines.map(_countLeadingSpaces);
  const largest = counts.length > 0 ? Math.min(...counts) : 0;
  return largest;
}

function _countLeadingSpaces(s: string): number {
  return s.search(LeadingSpaceCountRegExp);
}

function _isUndefinedOrWhitespace(s: string | undefined): boolean {
  return s === undefined || !NonWhitespaceRegExp.test(s);
}

function _isHeader(line: string | undefined): boolean {
  return line !== undefined && (line.match(/^\s*[#`~=-]{3,}/)?.length ?? 0) > 0;
}
