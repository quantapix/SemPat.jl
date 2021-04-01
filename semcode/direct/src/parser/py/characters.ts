import Char from 'typescript-char';

import * as unicode from './unicode';

enum CharCategory {
  NotIdentifierChar = 0,

  StartIdentifierChar = 1,

  IdentifierChar = 2,
}

const _identifierCharFastTableSize = 256;
const _identifierCharFastTable: CharCategory[] = new Array(_identifierCharFastTableSize);

const _identifierCharMap: { [code: number]: CharCategory } = {};

let _identifierCharMapInitialized = false;

export function isIdentifierStartChar(ch: number) {
  if (ch < _identifierCharFastTableSize) {
    return _identifierCharFastTable[ch] === CharCategory.StartIdentifierChar;
  }

  if (!_identifierCharMapInitialized) {
    _buildIdentifierLookupTable(false);
    _identifierCharMapInitialized = true;
  }

  return _identifierCharMap[ch] === CharCategory.StartIdentifierChar;
}

export function isIdentifierChar(ch: number) {
  if (ch < _identifierCharFastTableSize) {
    return _identifierCharFastTable[ch] === CharCategory.StartIdentifierChar || _identifierCharFastTable[ch] === CharCategory.IdentifierChar;
  }

  if (!_identifierCharMapInitialized) {
    _buildIdentifierLookupTable(false);
    _identifierCharMapInitialized = true;
  }

  return _identifierCharMap[ch] === CharCategory.StartIdentifierChar || _identifierCharMap[ch] === CharCategory.IdentifierChar;
}

export function isWhiteSpace(ch: number): boolean {
  return ch === Char.Space || ch === Char.Tab || ch === Char.FormFeed;
}

export function isLineBreak(ch: number): boolean {
  return ch === Char.CarriageReturn || ch === Char.LineFeed;
}

export function isNumber(ch: number): boolean {
  return (ch >= Char._0 && ch <= Char._9) || ch === Char.Underscore;
}

export function isDecimal(ch: number): boolean {
  return (ch >= Char._0 && ch <= Char._9) || ch === Char.Underscore;
}

export function isHex(ch: number): boolean {
  return isDecimal(ch) || (ch >= Char.a && ch <= Char.f) || (ch >= Char.A && ch <= Char.F) || ch === Char.Underscore;
}

export function isOctal(ch: number): boolean {
  return (ch >= Char._0 && ch <= Char._7) || ch === Char.Underscore;
}

export function isBinary(ch: number): boolean {
  return ch === Char._0 || ch === Char._1 || ch === Char.Underscore;
}

const _specialStartIdentifierChars: unicode.UnicodeRangeTable = [Char.Underscore, 0x1885, 0x1886, 0x2118, 0x212e, 0x309b, 0x309c];

const _startIdentifierCharRanges = [_specialStartIdentifierChars, unicode.unicodeLu, unicode.unicodeLl, unicode.unicodeLt, unicode.unicodeLo, unicode.unicodeLm, unicode.unicodeNl];

const _specialIdentifierChars: unicode.UnicodeRangeTable = [0x00b7, 0x0387, 0x1369, 0x136a, 0x136b, 0x136c, 0x136d, 0x136e, 0x136f, 0x1370, 0x1371, 0x19da];

const _identifierCharRanges = [_specialIdentifierChars, unicode.unicodeMn, unicode.unicodeMc, unicode.unicodeNd, unicode.unicodePc];

function _buildIdentifierLookupTableFromUnicodeRangeTable(table: unicode.UnicodeRangeTable, category: CharCategory, fastTableOnly: boolean) {
  for (let entryIndex = 0; entryIndex < table.length; entryIndex++) {
    const entry = table[entryIndex];
    let rangeStart: number;
    let rangeEnd: number;

    if (Array.isArray(entry)) {
      rangeStart = entry[0];
      rangeEnd = entry[1];
    } else {
      rangeStart = rangeEnd = entry;
    }

    for (let i = rangeStart; i <= rangeEnd; i++) {
      if (i < _identifierCharFastTableSize) {
        _identifierCharFastTable[i] = category;
      } else {
        _identifierCharMap[i] = category;
      }
    }

    if (fastTableOnly && rangeStart >= _identifierCharFastTableSize) {
      break;
    }
  }
}

function _buildIdentifierLookupTable(fastTableOnly: boolean) {
  _identifierCharFastTable.fill(CharCategory.NotIdentifierChar);

  _identifierCharRanges.forEach((table) => {
    _buildIdentifierLookupTableFromUnicodeRangeTable(table, CharCategory.IdentifierChar, fastTableOnly);
  });

  _startIdentifierCharRanges.forEach((table) => {
    _buildIdentifierLookupTableFromUnicodeRangeTable(table, CharCategory.StartIdentifierChar, fastTableOnly);
  });
}

_buildIdentifierLookupTable(true);
