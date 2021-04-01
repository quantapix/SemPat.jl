import Char from 'typescript-char';

import { StringToken, StringTokenFlags } from './tokenizerTypes';

export interface FormatStringSegment {
  offset: number;

  length: number;

  value: string;

  isExpression: boolean;
}

export const enum UnescapeErrorType {
  InvalidEscapeSequence,
  EscapeWithinFormatExpression,
  SingleCloseBraceWithinFormatLiteral,
  UnterminatedFormatExpression,
}

export interface UnescapeError {
  offset: number;

  length: number;

  errorType: UnescapeErrorType;
}

export interface UnescapedString {
  value: string;
  unescapeErrors: UnescapeError[];
  nonAsciiInBytes: boolean;
  formatStringSegments: FormatStringSegment[];
}

export function getUnescapedString(stringToken: StringToken): UnescapedString {
  const escapedString = stringToken.escapedValue;
  const isRaw = (stringToken.flags & StringTokenFlags.Raw) !== 0;
  const isBytes = (stringToken.flags & StringTokenFlags.Bytes) !== 0;
  const isFormat = (stringToken.flags & StringTokenFlags.Format) !== 0;
  let formatExpressionNestCount = 0;
  let formatSegment: FormatStringSegment = {
    offset: 0,
    length: 0,
    value: '',
    isExpression: false,
  };
  let strOffset = 0;
  const output: UnescapedString = {
    value: '',
    unescapeErrors: [],
    nonAsciiInBytes: false,
    formatStringSegments: [],
  };

  const addInvalidEscapeOffset = () => {
    if (!isRaw) {
      output.unescapeErrors.push({
        offset: strOffset - 1,
        length: 2,
        errorType: UnescapeErrorType.InvalidEscapeSequence,
      });
    }
  };

  const getEscapedCharacter = (offset = 0) => {
    if (strOffset + offset >= escapedString.length) {
      return Char.EndOfText;
    }

    return escapedString.charCodeAt(strOffset + offset);
  };

  const scanHexEscape = (digitCount: number) => {
    let foundIllegalHexDigit = false;
    let hexValue = 0;
    let localValue = '';

    for (let i = 0; i < digitCount; i++) {
      const charCode = getEscapedCharacter(1 + i);
      if (!_isHexCharCode(charCode)) {
        foundIllegalHexDigit = true;
        break;
      }
      hexValue = 16 * hexValue + _getHexDigitValue(charCode);
    }

    if (foundIllegalHexDigit) {
      addInvalidEscapeOffset();
      localValue = '\\' + String.fromCharCode(getEscapedCharacter());
      strOffset++;
    } else {
      localValue = String.fromCharCode(hexValue);
      strOffset += 1 + digitCount;
    }

    return localValue;
  };

  const appendOutputChar = (charCode: number) => {
    const char = String.fromCharCode(charCode);
    output.value += char;
    formatSegment.value += char;
  };

  while (true) {
    let curChar = getEscapedCharacter();
    if (curChar === Char.EndOfText) {
      if (isFormat) {
        if (formatSegment.isExpression) {
          output.unescapeErrors.push({
            offset: formatSegment.offset,
            length: strOffset - formatSegment.offset,
            errorType: UnescapeErrorType.UnterminatedFormatExpression,
          });
        }

        if (strOffset !== formatSegment.offset) {
          formatSegment.length = strOffset - formatSegment.offset;
          output.formatStringSegments.push(formatSegment);
        }
      }
      return output;
    }

    if (curChar === Char.Backslash) {
      if (isFormat && formatSegment.isExpression) {
        output.unescapeErrors.push({
          offset: strOffset,
          length: 1,
          errorType: UnescapeErrorType.EscapeWithinFormatExpression,
        });
      }

      strOffset++;

      if (isRaw) {
        appendOutputChar(curChar);
        continue;
      }

      curChar = getEscapedCharacter();
      let localValue = '';

      if (curChar === Char.CarriageReturn || curChar === Char.LineFeed) {
        if (curChar === Char.CarriageReturn && getEscapedCharacter(1) === Char.LineFeed) {
          if (isRaw) {
            localValue += String.fromCharCode(curChar);
          }
          strOffset++;
          curChar = getEscapedCharacter();
        }
        if (isRaw) {
          localValue = '\\' + localValue + String.fromCharCode(curChar);
        }
        strOffset++;
      } else {
        if (isRaw) {
          localValue = '\\' + String.fromCharCode(curChar);
          strOffset++;
        } else {
          switch (curChar) {
            case Char.Backslash:
            case Char.SingleQuote:
            case Char.DoubleQuote:
              localValue = String.fromCharCode(curChar);
              strOffset++;
              break;

            case Char.a:
              localValue = '\u0007';
              strOffset++;
              break;

            case Char.b:
              localValue = '\b';
              strOffset++;
              break;

            case Char.f:
              localValue = '\f';
              strOffset++;
              break;

            case Char.n:
              localValue = '\n';
              strOffset++;
              break;

            case Char.r:
              localValue = '\r';
              strOffset++;
              break;

            case Char.t:
              localValue = '\t';
              strOffset++;
              break;

            case Char.v:
              localValue = '\v';
              strOffset++;
              break;

            case Char.x:
              localValue = scanHexEscape(2);
              break;

            case Char.N: {
              let foundIllegalChar = false;
              let charCount = 1;
              if (getEscapedCharacter(charCount) !== Char.OpenBrace) {
                foundIllegalChar = true;
              } else {
                charCount++;
                while (true) {
                  const lookaheadChar = getEscapedCharacter(charCount);
                  if (lookaheadChar === Char.CloseBrace) {
                    break;
                  } else if (!_isAlphaNumericChar(lookaheadChar) && lookaheadChar !== Char.Hyphen && !_isWhitespaceChar(lookaheadChar)) {
                    foundIllegalChar = true;
                    break;
                  } else {
                    charCount++;
                  }
                }
              }

              if (foundIllegalChar) {
                addInvalidEscapeOffset();
                localValue = '\\' + String.fromCharCode(curChar);
                strOffset++;
              } else {
                localValue = '-';
                strOffset += 1 + charCount;
              }
              break;
            }

            case Char.u:
              localValue = scanHexEscape(4);
              break;

            case Char.U:
              localValue = scanHexEscape(8);
              break;

            default:
              if (_isOctalCharCode(curChar)) {
                let octalCode = curChar - Char._0;
                strOffset++;
                curChar = getEscapedCharacter();
                if (_isOctalCharCode(curChar)) {
                  octalCode = octalCode * 8 + curChar - Char._0;
                  strOffset++;
                  curChar = getEscapedCharacter();

                  if (_isOctalCharCode(curChar)) {
                    octalCode = octalCode * 8 + curChar - Char._0;
                    strOffset++;
                  }
                }

                localValue = String.fromCharCode(octalCode);
              } else {
                localValue = '\\';
                addInvalidEscapeOffset();
              }
              break;
          }
        }
      }

      output.value += localValue;
      formatSegment.value += localValue;
    } else if (curChar === Char.LineFeed || curChar === Char.CarriageReturn) {
      if (curChar === Char.CarriageReturn && getEscapedCharacter(1) === Char.LineFeed) {
        appendOutputChar(curChar);
        strOffset++;
        curChar = getEscapedCharacter();
      }

      appendOutputChar(curChar);
      strOffset++;
    } else if (isFormat && curChar === Char.OpenBrace) {
      if (!formatSegment.isExpression && getEscapedCharacter(1) === Char.OpenBrace) {
        appendOutputChar(curChar);
        strOffset += 2;
      } else {
        if (formatExpressionNestCount === 0) {
          formatSegment.length = strOffset - formatSegment.offset;
          if (formatSegment.length > 0) {
            output.formatStringSegments.push(formatSegment);
          }
          strOffset++;

          formatSegment = {
            offset: strOffset,
            length: 0,
            value: '',
            isExpression: true,
          };
        } else {
          appendOutputChar(curChar);
          strOffset++;
        }
        formatExpressionNestCount++;
      }
    } else if (isFormat && curChar === Char.CloseBrace) {
      if (!formatSegment.isExpression && getEscapedCharacter(1) === Char.CloseBrace) {
        appendOutputChar(curChar);
        strOffset += 2;
      } else if (formatExpressionNestCount === 0) {
        output.unescapeErrors.push({
          offset: strOffset,
          length: 1,
          errorType: UnescapeErrorType.SingleCloseBraceWithinFormatLiteral,
        });
        strOffset++;
      } else {
        formatExpressionNestCount--;

        if (formatExpressionNestCount === 0) {
          formatSegment.length = strOffset - formatSegment.offset;
          output.formatStringSegments.push(formatSegment);
          strOffset++;

          formatSegment = {
            offset: strOffset,
            length: 0,
            value: '',
            isExpression: false,
          };
        } else {
          appendOutputChar(curChar);
          strOffset++;
        }
      }
    } else if (formatSegment.isExpression && (curChar === Char.SingleQuote || curChar === Char.DoubleQuote)) {
      const quoteChar = curChar;
      appendOutputChar(curChar);
      const isTriplicate = getEscapedCharacter(1) === quoteChar && getEscapedCharacter(2) === quoteChar;
      if (isTriplicate) {
        strOffset += 2;
        appendOutputChar(curChar);
        appendOutputChar(curChar);
        output.value += String.fromCharCode(curChar);
        output.value += String.fromCharCode(curChar);
      }

      while (true) {
        strOffset++;
        let strChar = getEscapedCharacter();
        if (strChar === Char.EndOfText) {
          break;
        }

        if (strChar === Char.Backslash) {
          appendOutputChar(strChar);
          strOffset++;
          strChar = getEscapedCharacter();
          appendOutputChar(strChar);
          continue;
        }

        if (strChar === Char.LineFeed || strChar === Char.CarriageReturn) {
          break;
        }

        if (strChar === quoteChar) {
          if (!isTriplicate) {
            strOffset++;
            appendOutputChar(strChar);
            break;
          }

          if (getEscapedCharacter(1) === quoteChar && getEscapedCharacter(2) === quoteChar) {
            strOffset += 3;
            appendOutputChar(strChar);
            appendOutputChar(strChar);
            appendOutputChar(strChar);
            break;
          }
        }

        appendOutputChar(strChar);
      }
    } else {
      if (isBytes && curChar >= 128) {
        output.nonAsciiInBytes = true;
      }

      appendOutputChar(curChar);
      strOffset++;
    }
  }
}

function _isWhitespaceChar(charCode: number): boolean {
  return charCode === Char.Space || charCode === Char.Tab;
}

function _isAlphaNumericChar(charCode: number): boolean {
  if (charCode >= Char._0 && charCode <= Char._9) {
    return true;
  }

  if (charCode >= Char.a && charCode <= Char.z) {
    return true;
  }

  if (charCode >= Char.A && charCode <= Char.Z) {
    return true;
  }

  return false;
}

function _isOctalCharCode(charCode: number): boolean {
  return charCode >= Char._0 && charCode <= Char._7;
}

function _isHexCharCode(charCode: number): boolean {
  if (charCode >= Char._0 && charCode <= Char._9) {
    return true;
  }

  if (charCode >= Char.a && charCode <= Char.f) {
    return true;
  }

  if (charCode >= Char.A && charCode <= Char.F) {
    return true;
  }

  return false;
}

function _getHexDigitValue(charCode: number): number {
  if (charCode >= Char._0 && charCode <= Char._9) {
    return charCode - Char._0;
  }

  if (charCode >= Char.a && charCode <= Char.f) {
    return charCode - Char.a + 10;
  }

  if (charCode >= Char.A && charCode <= Char.F) {
    return charCode - Char.A + 10;
  }

  return 0;
}
