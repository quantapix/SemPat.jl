import Char from 'typescript-char';

import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { isBinary, isDecimal, isHex, isIdentifierChar, isIdentifierStartChar, isOctal } from './characters';
import { CharacterStream } from './characterStream';
import {
  Comment,
  DedentToken,
  IdentifierToken,
  IndentToken,
  KeywordToken,
  KeywordType,
  NewLineToken,
  NewLineType,
  NumberToken,
  OperatorFlags,
  OperatorToken,
  OperatorType,
  StringToken,
  StringTokenFlags,
  Token,
  TokenType,
} from './tokenizerTypes';

const _keywords: { [key: string]: KeywordType } = {
  and: KeywordType.And,
  as: KeywordType.As,
  assert: KeywordType.Assert,
  async: KeywordType.Async,
  await: KeywordType.Await,
  break: KeywordType.Break,
  case: KeywordType.Case,
  class: KeywordType.Class,
  continue: KeywordType.Continue,
  __debug__: KeywordType.Debug,
  def: KeywordType.Def,
  del: KeywordType.Del,
  elif: KeywordType.Elif,
  else: KeywordType.Else,
  except: KeywordType.Except,
  finally: KeywordType.Finally,
  for: KeywordType.For,
  from: KeywordType.From,
  global: KeywordType.Global,
  if: KeywordType.If,
  import: KeywordType.Import,
  in: KeywordType.In,
  is: KeywordType.Is,
  lambda: KeywordType.Lambda,
  match: KeywordType.Match,
  nonlocal: KeywordType.Nonlocal,
  not: KeywordType.Not,
  or: KeywordType.Or,
  pass: KeywordType.Pass,
  raise: KeywordType.Raise,
  return: KeywordType.Return,
  try: KeywordType.Try,
  while: KeywordType.While,
  with: KeywordType.With,
  yield: KeywordType.Yield,
  False: KeywordType.False,
  None: KeywordType.None,
  True: KeywordType.True,
};

const _operatorInfo: { [key: number]: OperatorFlags } = {
  [OperatorType.Add]: OperatorFlags.Unary | OperatorFlags.Binary,
  [OperatorType.AddEqual]: OperatorFlags.Assignment,
  [OperatorType.Assign]: OperatorFlags.Assignment,
  [OperatorType.BitwiseAnd]: OperatorFlags.Binary,
  [OperatorType.BitwiseAndEqual]: OperatorFlags.Assignment,
  [OperatorType.BitwiseInvert]: OperatorFlags.Unary,
  [OperatorType.BitwiseOr]: OperatorFlags.Binary,
  [OperatorType.BitwiseOrEqual]: OperatorFlags.Assignment,
  [OperatorType.BitwiseXor]: OperatorFlags.Binary,
  [OperatorType.BitwiseXorEqual]: OperatorFlags.Assignment,
  [OperatorType.Divide]: OperatorFlags.Binary,
  [OperatorType.DivideEqual]: OperatorFlags.Assignment,
  [OperatorType.Equals]: OperatorFlags.Binary | OperatorFlags.Comparison,
  [OperatorType.FloorDivide]: OperatorFlags.Binary,
  [OperatorType.FloorDivideEqual]: OperatorFlags.Assignment,
  [OperatorType.GreaterThan]: OperatorFlags.Binary | OperatorFlags.Comparison,
  [OperatorType.GreaterThanOrEqual]: OperatorFlags.Binary | OperatorFlags.Comparison,
  [OperatorType.LeftShift]: OperatorFlags.Binary,
  [OperatorType.LeftShiftEqual]: OperatorFlags.Assignment,
  [OperatorType.LessOrGreaterThan]: OperatorFlags.Binary | OperatorFlags.Comparison | OperatorFlags.Deprecated,
  [OperatorType.LessThan]: OperatorFlags.Binary | OperatorFlags.Comparison,
  [OperatorType.LessThanOrEqual]: OperatorFlags.Binary | OperatorFlags.Comparison,
  [OperatorType.MatrixMultiply]: OperatorFlags.Binary,
  [OperatorType.MatrixMultiplyEqual]: OperatorFlags.Assignment,
  [OperatorType.Mod]: OperatorFlags.Binary,
  [OperatorType.ModEqual]: OperatorFlags.Assignment,
  [OperatorType.Multiply]: OperatorFlags.Binary,
  [OperatorType.MultiplyEqual]: OperatorFlags.Assignment,
  [OperatorType.NotEquals]: OperatorFlags.Binary | OperatorFlags.Comparison,
  [OperatorType.Power]: OperatorFlags.Binary,
  [OperatorType.PowerEqual]: OperatorFlags.Assignment,
  [OperatorType.RightShift]: OperatorFlags.Binary,
  [OperatorType.RightShiftEqual]: OperatorFlags.Assignment,
  [OperatorType.Subtract]: OperatorFlags.Binary,
  [OperatorType.SubtractEqual]: OperatorFlags.Assignment,

  [OperatorType.And]: OperatorFlags.Binary,
  [OperatorType.Or]: OperatorFlags.Binary,
  [OperatorType.Not]: OperatorFlags.Unary,
  [OperatorType.Is]: OperatorFlags.Binary,
  [OperatorType.IsNot]: OperatorFlags.Binary,
  [OperatorType.In]: OperatorFlags.Binary,
  [OperatorType.NotIn]: OperatorFlags.Binary,
};

const _byteOrderMarker = 0xfeff;

export interface TokenizerOutput {
  tokens: TextRangeCollection<Token>;

  lines: TextRangeCollection<TextRange>;

  typeIgnoreLines: { [line: number]: boolean };

  typeIgnoreAll: boolean;

  predominantEndOfLineSequence: string;

  predominantTabSequence: string;

  predominantSingleQuoteCharacter: string;
}

interface StringScannerOutput {
  escapedValue: string;
  flags: StringTokenFlags;
}

interface IndentInfo {
  tab1Spaces: number;
  tab8Spaces: number;
  isSpacePresent: boolean;
  isTabPresent: boolean;
}

export class Tokenizer {
  private _cs = new CharacterStream('');
  private _tokens: Token[] = [];
  private _prevLineStart = 0;
  private _parenDepth = 0;
  private _lineRanges: TextRange[] = [];
  private _indentAmounts: IndentInfo[] = [];
  private _typeIgnoreAll = false;
  private _typeIgnoreLines: { [line: number]: boolean } = {};
  private _comments: Comment[] | undefined;

  private _crCount = 0;
  private _crLfCount = 0;
  private _lfCount = 0;

  private _indentCount = 0;

  private _indentTabCount = 0;

  private _indentSpacesTotal = 0;

  private _singleQuoteCount = 0;
  private _doubleQuoteCount = 0;

  tokenize(text: string, start?: number, length?: number, initialParenDepth = 0): TokenizerOutput {
    if (start === undefined) {
      start = 0;
    } else if (start < 0 || start > text.length) {
      throw new Error('Invalid range start');
    }

    if (length === undefined) {
      length = text.length;
    } else if (length < 0 || start + length > text.length) {
      throw new Error('Invalid range length');
    } else if (start + length < text.length) {
      text = text.substr(0, start + length);
    }

    this._cs = new CharacterStream(text);
    this._cs.position = start;
    this._tokens = [];
    this._prevLineStart = 0;
    this._parenDepth = initialParenDepth;
    this._lineRanges = [];
    this._indentAmounts = [];

    const end = start + length;
    while (!this._cs.isEndOfStream()) {
      this._addNextToken();

      if (this._cs.position >= end) {
        break;
      }
    }

    if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== TokenType.NewLine) {
      this._tokens.push(NewLineToken.create(this._cs.position, 0, NewLineType.Implied, this._getComments()));
    }

    this._setIndent(0, 0, true, false);

    this._tokens.push(Token.create(TokenType.EndOfStream, this._cs.position, 0, this._getComments()));

    this._addLineRange();

    let predominantEndOfLineSequence = '\n';
    if (this._crCount > this._crLfCount && this._crCount > this._lfCount) {
      predominantEndOfLineSequence = '\r';
    } else if (this._crLfCount > this._crCount && this._crLfCount > this._lfCount) {
      predominantEndOfLineSequence = '\r\n';
    }

    let predominantTabSequence = '    ';

    if (this._indentTabCount > this._indentCount / 2) {
      predominantTabSequence = '\t';
    } else if (this._indentCount > 0) {
      let averageSpacePerIndent = Math.round(this._indentSpacesTotal / this._indentCount);
      if (averageSpacePerIndent < 1) {
        averageSpacePerIndent = 1;
      } else if (averageSpacePerIndent > 8) {
        averageSpacePerIndent = 8;
      }
      predominantTabSequence = '';
      for (let i = 0; i < averageSpacePerIndent; i++) {
        predominantTabSequence += ' ';
      }
    }

    return {
      tokens: new TextRangeCollection(this._tokens),
      lines: new TextRangeCollection(this._lineRanges),
      typeIgnoreLines: this._typeIgnoreLines,
      typeIgnoreAll: this._typeIgnoreAll,
      predominantEndOfLineSequence,
      predominantTabSequence,
      predominantSingleQuoteCharacter: this._singleQuoteCount >= this._doubleQuoteCount ? "'" : '"',
    };
  }

  static getOperatorInfo(operatorType: OperatorType): OperatorFlags {
    return _operatorInfo[operatorType];
  }

  static isOperatorAssignment(operatorType?: OperatorType): boolean {
    if (operatorType === undefined || _operatorInfo[operatorType] === undefined) {
      return false;
    }
    return (_operatorInfo[operatorType] & OperatorFlags.Assignment) !== 0;
  }

  static isOperatorComparison(operatorType?: OperatorType): boolean {
    if (operatorType === undefined || _operatorInfo[operatorType] === undefined) {
      return false;
    }
    return (_operatorInfo[operatorType] & OperatorFlags.Comparison) !== 0;
  }

  private _addNextToken(): void {
    this._cs.skipWhitespace();

    if (this._cs.isEndOfStream()) {
      return;
    }

    if (!this._handleCharacter()) {
      this._cs.moveNext();
    }
  }

  private _handleCharacter(): boolean {
    const stringPrefixLength = this._getStringPrefixLength();

    if (stringPrefixLength >= 0) {
      let stringPrefix = '';
      if (stringPrefixLength > 0) {
        stringPrefix = this._cs.getText().substr(this._cs.position, stringPrefixLength);

        this._cs.advance(stringPrefixLength);
      }

      const quoteTypeFlags = this._getQuoteTypeFlags(stringPrefix);
      if (quoteTypeFlags !== StringTokenFlags.None) {
        this._handleString(quoteTypeFlags, stringPrefixLength);
        return true;
      }
    }

    if (this._cs.currentChar === Char.Hash) {
      this._handleComment();
      return true;
    }

    switch (this._cs.currentChar) {
      case _byteOrderMarker: {
        if (this._cs.position === 0) {
          return false;
        }
        return this._handleInvalid();
      }

      case Char.CarriageReturn: {
        const length = this._cs.nextChar === Char.LineFeed ? 2 : 1;
        const newLineType = length === 2 ? NewLineType.CarriageReturnLineFeed : NewLineType.CarriageReturn;
        this._handleNewLine(length, newLineType);
        return true;
      }

      case Char.LineFeed: {
        this._handleNewLine(1, NewLineType.LineFeed);
        return true;
      }

      case Char.Backslash: {
        if (this._cs.nextChar === Char.CarriageReturn) {
          if (this._cs.lookAhead(2) === Char.LineFeed) {
            this._cs.advance(3);
          } else {
            this._cs.advance(2);
          }
          this._addLineRange();
          return true;
        } else if (this._cs.nextChar === Char.LineFeed) {
          this._cs.advance(2);
          this._addLineRange();
          return true;
        }
        return this._handleInvalid();
      }

      case Char.OpenParenthesis: {
        this._parenDepth++;
        this._tokens.push(Token.create(TokenType.OpenParenthesis, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.CloseParenthesis: {
        if (this._parenDepth > 0) {
          this._parenDepth--;
        }
        this._tokens.push(Token.create(TokenType.CloseParenthesis, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.OpenBracket: {
        this._parenDepth++;
        this._tokens.push(Token.create(TokenType.OpenBracket, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.CloseBracket: {
        if (this._parenDepth > 0) {
          this._parenDepth--;
        }
        this._tokens.push(Token.create(TokenType.CloseBracket, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.OpenBrace: {
        this._parenDepth++;
        this._tokens.push(Token.create(TokenType.OpenCurlyBrace, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.CloseBrace: {
        if (this._parenDepth > 0) {
          this._parenDepth--;
        }
        this._tokens.push(Token.create(TokenType.CloseCurlyBrace, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.Comma: {
        this._tokens.push(Token.create(TokenType.Comma, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.Backtick: {
        this._tokens.push(Token.create(TokenType.Backtick, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.Semicolon: {
        this._tokens.push(Token.create(TokenType.Semicolon, this._cs.position, 1, this._getComments()));
        break;
      }

      case Char.Colon: {
        if (this._cs.nextChar === Char.Equal) {
          this._tokens.push(OperatorToken.create(this._cs.position, 2, OperatorType.Walrus, this._getComments()));
          this._cs.advance(1);
          break;
        }
        this._tokens.push(Token.create(TokenType.Colon, this._cs.position, 1, this._getComments()));
        break;
      }

      default: {
        if (this._isPossibleNumber()) {
          if (this._tryNumber()) {
            return true;
          }
        }

        if (this._cs.currentChar === Char.Period) {
          if (this._cs.nextChar === Char.Period && this._cs.lookAhead(2) === Char.Period) {
            this._tokens.push(Token.create(TokenType.Ellipsis, this._cs.position, 3, this._getComments()));
            this._cs.advance(3);
            return true;
          }
          this._tokens.push(Token.create(TokenType.Dot, this._cs.position, 1, this._getComments()));
          break;
        }

        if (!this._tryIdentifier()) {
          if (!this._tryOperator()) {
            return this._handleInvalid();
          }
        }
        return true;
      }
    }
    return false;
  }

  private _addLineRange() {
    const lineLength = this._cs.position - this._prevLineStart;
    if (lineLength > 0) {
      this._lineRanges.push({ start: this._prevLineStart, length: lineLength });
    }

    this._prevLineStart = this._cs.position;
  }

  private _handleNewLine(length: number, newLineType: NewLineType) {
    if (this._parenDepth === 0 && newLineType !== NewLineType.Implied) {
      if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== TokenType.NewLine) {
        this._tokens.push(NewLineToken.create(this._cs.position, length, newLineType, this._getComments()));
      }
    }
    if (newLineType === NewLineType.CarriageReturn) {
      this._crCount++;
    } else if (newLineType === NewLineType.CarriageReturnLineFeed) {
      this._crLfCount++;
    } else {
      this._lfCount++;
    }
    this._cs.advance(length);
    this._addLineRange();
    this._readIndentationAfterNewLine();
  }

  private _readIndentationAfterNewLine() {
    let tab1Spaces = 0;
    let tab8Spaces = 0;
    let isTabPresent = false;
    let isSpacePresent = false;

    while (!this._cs.isEndOfStream()) {
      switch (this._cs.currentChar) {
        case Char.Space:
          tab1Spaces++;
          tab8Spaces++;
          isSpacePresent = true;
          this._cs.moveNext();
          break;

        case Char.Tab:
          tab1Spaces++;
          tab8Spaces += 8 - (tab8Spaces % 8);
          isTabPresent = true;
          this._cs.moveNext();
          break;

        case Char.FormFeed:
          tab1Spaces = 0;
          tab8Spaces = 0;
          isTabPresent = false;
          isSpacePresent = false;
          this._cs.moveNext();
          break;

        default:
          this._setIndent(tab1Spaces, tab8Spaces, isSpacePresent, isTabPresent);
          return;

        case Char.Hash:
        case Char.LineFeed:
        case Char.CarriageReturn:
          return;
      }
    }
  }

  private _setIndent(tab1Spaces: number, tab8Spaces: number, isSpacePresent: boolean, isTabPresent: boolean) {
    if (this._parenDepth > 0) {
      return;
    }

    if (this._indentAmounts.length === 0) {
      if (tab8Spaces > 0) {
        this._indentCount++;
        if (isTabPresent) {
          this._indentTabCount++;
        }
        this._indentSpacesTotal += tab8Spaces;

        this._indentAmounts.push({
          tab1Spaces,
          tab8Spaces,
          isSpacePresent,
          isTabPresent,
        });
        this._tokens.push(IndentToken.create(this._cs.position, 0, tab8Spaces, false, this._getComments()));
      }
    } else {
      const prevTabInfo = this._indentAmounts[this._indentAmounts.length - 1];
      if (prevTabInfo.tab8Spaces < tab8Spaces) {
        const isIndentAmbiguous = ((prevTabInfo.isSpacePresent && isTabPresent) || (prevTabInfo.isTabPresent && isSpacePresent)) && prevTabInfo.tab1Spaces >= tab1Spaces;

        this._indentCount++;
        if (isTabPresent) {
          this._indentTabCount++;
        }
        this._indentSpacesTotal += tab8Spaces - this._indentAmounts[this._indentAmounts.length - 1].tab8Spaces;

        this._indentAmounts.push({
          tab1Spaces,
          tab8Spaces,
          isSpacePresent,
          isTabPresent,
        });

        this._tokens.push(IndentToken.create(this._cs.position, 0, tab8Spaces, isIndentAmbiguous, this._getComments()));
      } else {
        const dedentPoints: number[] = [];
        while (this._indentAmounts.length > 0 && this._indentAmounts[this._indentAmounts.length - 1].tab8Spaces > tab8Spaces) {
          dedentPoints.push(this._indentAmounts.length > 1 ? this._indentAmounts[this._indentAmounts.length - 2].tab8Spaces : 0);
          this._indentAmounts.pop();
        }

        dedentPoints.forEach((dedentAmount, index) => {
          const matchesIndent = index < dedentPoints.length - 1 || dedentAmount === tab8Spaces;
          const actualDedentAmount = index < dedentPoints.length - 1 ? dedentAmount : tab8Spaces;
          this._tokens.push(DedentToken.create(this._cs.position, 0, actualDedentAmount, matchesIndent, this._getComments()));
        });
      }
    }
  }

  private _tryIdentifier(): boolean {
    const start = this._cs.position;
    if (isIdentifierStartChar(this._cs.currentChar)) {
      this._cs.moveNext();
      while (isIdentifierChar(this._cs.currentChar)) {
        this._cs.moveNext();
      }
    }
    if (this._cs.position > start) {
      const value = this._cs.getText().substr(start, this._cs.position - start);
      if (_keywords[value] !== undefined) {
        this._tokens.push(KeywordToken.create(start, this._cs.position - start, _keywords[value], this._getComments()));
      } else {
        this._tokens.push(IdentifierToken.create(start, this._cs.position - start, value, this._getComments()));
      }
      return true;
    }
    return false;
  }

  private _isPossibleNumber(): boolean {
    if (isDecimal(this._cs.currentChar)) {
      return true;
    }

    if (this._cs.currentChar === Char.Period && isDecimal(this._cs.nextChar)) {
      return true;
    }

    return false;
  }

  private _tryNumber(): boolean {
    const start = this._cs.position;

    if (this._cs.currentChar === Char._0) {
      let radix = 0;
      let leadingChars = 0;

      if ((this._cs.nextChar === Char.x || this._cs.nextChar === Char.X) && isHex(this._cs.lookAhead(2))) {
        this._cs.advance(2);
        leadingChars = 2;
        while (isHex(this._cs.currentChar)) {
          this._cs.moveNext();
        }
        radix = 16;
      }

      if ((this._cs.nextChar === Char.b || this._cs.nextChar === Char.B) && isBinary(this._cs.lookAhead(2))) {
        this._cs.advance(2);
        leadingChars = 2;
        while (isBinary(this._cs.currentChar)) {
          this._cs.moveNext();
        }
        radix = 2;
      }

      if ((this._cs.nextChar === Char.o || this._cs.nextChar === Char.O) && isOctal(this._cs.lookAhead(2))) {
        this._cs.advance(2);
        leadingChars = 2;
        while (isOctal(this._cs.currentChar)) {
          this._cs.moveNext();
        }
        radix = 8;
      }

      if (radix > 0) {
        const text = this._cs.getText().substr(start, this._cs.position - start);
        const value = parseInt(text.substr(leadingChars).replace(/_/g, ''), radix);
        if (!isNaN(value)) {
          this._tokens.push(NumberToken.create(start, text.length, value, true, false, this._getComments()));
          return true;
        }
      }
    }

    let isDecimalInteger = false;
    let mightBeFloatingPoint = false;

    if (this._cs.currentChar >= Char._1 && this._cs.currentChar <= Char._9) {
      while (isDecimal(this._cs.currentChar)) {
        mightBeFloatingPoint = true;
        this._cs.moveNext();
      }
      isDecimalInteger = this._cs.currentChar !== Char.Period && this._cs.currentChar !== Char.e && this._cs.currentChar !== Char.E;
    }

    if (this._cs.currentChar === Char._0) {
      mightBeFloatingPoint = true;
      while (this._cs.currentChar === Char._0 || this._cs.currentChar === Char.Underscore) {
        this._cs.moveNext();
      }
      isDecimalInteger = this._cs.currentChar !== Char.Period && this._cs.currentChar !== Char.e && this._cs.currentChar !== Char.E;
    }

    if (isDecimalInteger) {
      let text = this._cs.getText().substr(start, this._cs.position - start);
      const value = parseInt(text.replace(/_/g, ''), 10);
      if (!isNaN(value)) {
        let isImaginary = false;
        if (this._cs.currentChar === Char.j || this._cs.currentChar === Char.J) {
          isImaginary = true;
          text += String.fromCharCode(this._cs.currentChar);
          this._cs.moveNext();
        }
        this._tokens.push(NumberToken.create(start, text.length, value, true, isImaginary, this._getComments()));
        return true;
      }
    }

    this._cs.position = start;
    if (mightBeFloatingPoint || (this._cs.currentChar === Char.Period && this._cs.nextChar >= Char._0 && this._cs.nextChar <= Char._9)) {
      if (this._skipFloatingPointCandidate()) {
        let text = this._cs.getText().substr(start, this._cs.position - start);
        const value = parseFloat(text);
        if (!isNaN(value)) {
          let isImaginary = false;
          if (this._cs.currentChar === Char.j || this._cs.currentChar === Char.J) {
            isImaginary = true;
            text += String.fromCharCode(this._cs.currentChar);
            this._cs.moveNext();
          }
          this._tokens.push(NumberToken.create(start, this._cs.position - start, value, false, isImaginary, this._getComments()));
          return true;
        }
      }
    }

    this._cs.position = start;
    return false;
  }

  private _tryOperator(): boolean {
    let length = 0;
    const nextChar = this._cs.nextChar;
    let operatorType: OperatorType;

    switch (this._cs.currentChar) {
      case Char.Plus:
        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.AddEqual : OperatorType.Add;
        break;

      case Char.Ampersand:
        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.BitwiseAndEqual : OperatorType.BitwiseAnd;
        break;

      case Char.Bar:
        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.BitwiseOrEqual : OperatorType.BitwiseOr;
        break;

      case Char.Caret:
        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.BitwiseXorEqual : OperatorType.BitwiseXor;
        break;

      case Char.Equal:
        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.Equals : OperatorType.Assign;
        break;

      case Char.ExclamationMark:
        if (nextChar !== Char.Equal) {
          return false;
        }
        length = 2;
        operatorType = OperatorType.NotEquals;
        break;

      case Char.Percent:
        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.ModEqual : OperatorType.Mod;
        break;

      case Char.Tilde:
        length = 1;
        operatorType = OperatorType.BitwiseInvert;
        break;

      case Char.Hyphen:
        if (nextChar === Char.Greater) {
          this._tokens.push(Token.create(TokenType.Arrow, this._cs.position, 2, this._getComments()));
          this._cs.advance(2);
          return true;
        }

        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.SubtractEqual : OperatorType.Subtract;
        break;

      case Char.Asterisk:
        if (nextChar === Char.Asterisk) {
          length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
          operatorType = length === 3 ? OperatorType.PowerEqual : OperatorType.Power;
        } else {
          length = nextChar === Char.Equal ? 2 : 1;
          operatorType = length === 2 ? OperatorType.MultiplyEqual : OperatorType.Multiply;
        }
        break;

      case Char.Slash:
        if (nextChar === Char.Slash) {
          length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
          operatorType = length === 3 ? OperatorType.FloorDivideEqual : OperatorType.FloorDivide;
        } else {
          length = nextChar === Char.Equal ? 2 : 1;
          operatorType = length === 2 ? OperatorType.DivideEqual : OperatorType.Divide;
        }
        break;

      case Char.Less:
        if (nextChar === Char.Less) {
          length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
          operatorType = length === 3 ? OperatorType.LeftShiftEqual : OperatorType.LeftShift;
        } else if (nextChar === Char.Greater) {
          length = 2;
          operatorType = OperatorType.LessOrGreaterThan;
        } else {
          length = nextChar === Char.Equal ? 2 : 1;
          operatorType = length === 2 ? OperatorType.LessThanOrEqual : OperatorType.LessThan;
        }
        break;

      case Char.Greater:
        if (nextChar === Char.Greater) {
          length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
          operatorType = length === 3 ? OperatorType.RightShiftEqual : OperatorType.RightShift;
        } else {
          length = nextChar === Char.Equal ? 2 : 1;
          operatorType = length === 2 ? OperatorType.GreaterThanOrEqual : OperatorType.GreaterThan;
        }
        break;

      case Char.At:
        length = nextChar === Char.Equal ? 2 : 1;
        operatorType = length === 2 ? OperatorType.MatrixMultiplyEqual : OperatorType.MatrixMultiply;
        break;

      default:
        return false;
    }
    this._tokens.push(OperatorToken.create(this._cs.position, length, operatorType, this._getComments()));
    this._cs.advance(length);
    return length > 0;
  }

  private _handleInvalid(): boolean {
    const start = this._cs.position;
    while (true) {
      if (this._cs.currentChar === Char.LineFeed || this._cs.currentChar === Char.CarriageReturn || this._cs.isAtWhiteSpace() || this._cs.isEndOfStream()) {
        break;
      }
      this._cs.moveNext();
    }
    const length = this._cs.position - start;
    if (length > 0) {
      this._tokens.push(Token.create(TokenType.Invalid, start, length, this._getComments()));
      return true;
    }
    return false;
  }

  private _getComments(): Comment[] | undefined {
    const prevComments = this._comments;
    this._comments = undefined;
    return prevComments;
  }

  private _handleComment(): void {
    const start = this._cs.position + 1;
    this._cs.skipToEol();

    const length = this._cs.position - start;
    const value = this._cs.getText().substr(start, length);
    const comment = Comment.create(start, length, value);

    if (value.match(/^\s*type:\s*ignore(\s|\[|$)/)) {
      if (this._tokens.findIndex((t) => t.type !== TokenType.NewLine && t && t.type !== TokenType.Indent) < 0) {
        this._typeIgnoreAll = true;
      } else {
        this._typeIgnoreLines[this._lineRanges.length] = true;
      }
    }

    if (this._comments) {
      this._comments.push(comment);
    } else {
      this._comments = [comment];
    }
  }

  private _getStringPrefixLength(): number {
    if (this._cs.currentChar === Char.SingleQuote || this._cs.currentChar === Char.DoubleQuote) {
      return 0;
    }

    if (this._cs.nextChar === Char.SingleQuote || this._cs.nextChar === Char.DoubleQuote) {
      switch (this._cs.currentChar) {
        case Char.f:
        case Char.F:
        case Char.r:
        case Char.R:
        case Char.b:
        case Char.B:
        case Char.u:
        case Char.U:
          return 1;
        default:
          break;
      }
    }

    if (this._cs.lookAhead(2) === Char.SingleQuote || this._cs.lookAhead(2) === Char.DoubleQuote) {
      const prefix = this._cs.getText().substr(this._cs.position, 2).toLowerCase();
      switch (prefix) {
        case 'rf':
        case 'fr':
        case 'ur':
        case 'ru':
        case 'br':
        case 'rb':
          return 2;
        default:
          break;
      }
    }
    return -1;
  }

  private _getQuoteTypeFlags(prefix: string): StringTokenFlags {
    let flags = StringTokenFlags.None;

    prefix = prefix.toLowerCase();
    for (let i = 0; i < prefix.length; i++) {
      switch (prefix[i]) {
        case 'u':
          flags |= StringTokenFlags.Unicode;
          break;

        case 'b':
          flags |= StringTokenFlags.Bytes;
          break;

        case 'r':
          flags |= StringTokenFlags.Raw;
          break;

        case 'f':
          flags |= StringTokenFlags.Format;
          break;
      }
    }

    if (this._cs.currentChar === Char.SingleQuote) {
      flags |= StringTokenFlags.SingleQuote;
      if (this._cs.nextChar === Char.SingleQuote && this._cs.lookAhead(2) === Char.SingleQuote) {
        flags |= StringTokenFlags.Triplicate;
      }
    } else if (this._cs.currentChar === Char.DoubleQuote) {
      flags |= StringTokenFlags.DoubleQuote;
      if (this._cs.nextChar === Char.DoubleQuote && this._cs.lookAhead(2) === Char.DoubleQuote) {
        flags |= StringTokenFlags.Triplicate;
      }
    }

    return flags;
  }

  private _handleString(flags: StringTokenFlags, stringPrefixLength: number): void {
    const start = this._cs.position - stringPrefixLength;

    if (flags & StringTokenFlags.Triplicate) {
      this._cs.advance(3);
    } else {
      this._cs.moveNext();

      if (flags & StringTokenFlags.SingleQuote) {
        this._singleQuoteCount++;
      } else {
        this._doubleQuoteCount++;
      }
    }

    const stringLiteralInfo = this._skipToEndOfStringLiteral(flags);

    const end = this._cs.position;

    this._tokens.push(StringToken.create(start, end - start, stringLiteralInfo.flags, stringLiteralInfo.escapedValue, stringPrefixLength, this._getComments()));
  }

  private _skipToEndOfStringLiteral(flags: StringTokenFlags): StringScannerOutput {
    const quoteChar = flags & StringTokenFlags.SingleQuote ? Char.SingleQuote : Char.DoubleQuote;
    const isTriplicate = (flags & StringTokenFlags.Triplicate) !== 0;
    let escapedValue = '';

    while (true) {
      if (this._cs.isEndOfStream()) {
        flags |= StringTokenFlags.Unterminated;
        return { escapedValue, flags };
      }

      if (this._cs.currentChar === Char.Backslash) {
        escapedValue += String.fromCharCode(this._cs.currentChar);

        this._cs.moveNext();

        if (this._cs.getCurrentChar() === Char.CarriageReturn || this._cs.getCurrentChar() === Char.LineFeed) {
          if (this._cs.getCurrentChar() === Char.CarriageReturn && this._cs.nextChar === Char.LineFeed) {
            escapedValue += String.fromCharCode(this._cs.getCurrentChar());
            this._cs.moveNext();
          }
          escapedValue += String.fromCharCode(this._cs.getCurrentChar());
          this._cs.moveNext();
          this._addLineRange();
        } else {
          escapedValue += String.fromCharCode(this._cs.getCurrentChar());
          this._cs.moveNext();
        }
      } else if (this._cs.currentChar === Char.LineFeed || this._cs.currentChar === Char.CarriageReturn) {
        if (!isTriplicate) {
          flags |= StringTokenFlags.Unterminated;
          return { escapedValue, flags };
        }

        if (this._cs.currentChar === Char.CarriageReturn && this._cs.nextChar === Char.LineFeed) {
          escapedValue += String.fromCharCode(this._cs.currentChar);
          this._cs.moveNext();
        }

        escapedValue += String.fromCharCode(this._cs.currentChar);
        this._cs.moveNext();
        this._addLineRange();
      } else if (!isTriplicate && this._cs.currentChar === quoteChar) {
        this._cs.moveNext();
        break;
      } else if (isTriplicate && this._cs.currentChar === quoteChar && this._cs.nextChar === quoteChar && this._cs.lookAhead(2) === quoteChar) {
        this._cs.advance(3);
        break;
      } else {
        escapedValue += String.fromCharCode(this._cs.currentChar);
        this._cs.moveNext();
      }
    }

    return { escapedValue, flags };
  }

  private _skipFloatingPointCandidate(): boolean {
    const start = this._cs.position;
    this._skipFractionalNumber();
    if (this._cs.position > start) {
      if (this._cs.currentChar === Char.e || this._cs.currentChar === Char.E) {
        this._cs.moveNext();

        this._skipDecimalNumber(true);
      }
    }
    return this._cs.position > start;
  }

  private _skipFractionalNumber(): void {
    this._skipDecimalNumber(false);
    if (this._cs.currentChar === Char.Period) {
      this._cs.moveNext();
    }
    this._skipDecimalNumber(false);
  }

  private _skipDecimalNumber(allowSign: boolean): void {
    if (allowSign && (this._cs.currentChar === Char.Hyphen || this._cs.currentChar === Char.Plus)) {
      this._cs.moveNext();
    }
    while (isDecimal(this._cs.currentChar)) {
      this._cs.moveNext();
    }
  }
}
