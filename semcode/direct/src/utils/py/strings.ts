import leven from 'leven';
import { compareComparableValues, Comparison } from './core';
export function computeCompletionSimilarity(typedValue: string, symbolName: string): number {
  if (symbolName.startsWith(typedValue)) {
    return 1;
  }
  const symbolLower = symbolName.toLocaleLowerCase();
  const typedLower = typedValue.toLocaleLowerCase();
  if (symbolLower.startsWith(typedLower)) {
    return 0.75;
  }
  let symbolSubstrLength = symbolLower.length;
  let smallestEditDistance = Number.MAX_VALUE;
  while (symbolSubstrLength > 0) {
    const editDistance = leven(symbolLower.substr(0, symbolSubstrLength), typedLower);
    if (editDistance < smallestEditDistance) {
      smallestEditDistance = editDistance;
    }
    symbolSubstrLength--;
  }
  if (smallestEditDistance >= typedValue.length) {
    return 0;
  }
  const similarity = (typedValue.length - smallestEditDistance) / typedValue.length;
  return 0.5 * similarity;
}
export function isPatternInSymbol(typedValue: string, symbolName: string): boolean {
  const typedLower = typedValue.toLocaleLowerCase();
  const symbolLower = symbolName.toLocaleLowerCase();
  const typedLength = typedLower.length;
  const symbolLength = symbolLower.length;
  let typedPos = 0;
  let symbolPos = 0;
  while (typedPos < typedLength && symbolPos < symbolLength) {
    if (typedLower[typedPos] === symbolLower[symbolPos]) {
      typedPos += 1;
    }
    symbolPos += 1;
  }
  return typedPos === typedLength;
}
export function hashString(contents: string) {
  let hash = 0;
  for (let i = 0; i < contents.length; i++) {
    hash = ((hash << 5) - hash + contents.charCodeAt(i)) | 0;
  }
  return hash;
}
export function compareStringsCaseInsensitive(a: string | undefined, b: string | undefined): Comparison {
  return a === b ? Comparison.EqualTo : a === undefined ? Comparison.LessThan : b === undefined ? Comparison.GreaterThan : compareComparableValues(a.toUpperCase(), b.toUpperCase());
}
export function compareStringsCaseSensitive(a: string | undefined, b: string | undefined): Comparison {
  return compareComparableValues(a, b);
}
export function getStringComparer(ignoreCase?: boolean) {
  return ignoreCase ? compareStringsCaseInsensitive : compareStringsCaseSensitive;
}
export function equateStringsCaseInsensitive(a: string, b: string) {
  return compareStringsCaseInsensitive(a, b) === Comparison.EqualTo;
}
export function equateStringsCaseSensitive(a: string, b: string) {
  return compareStringsCaseSensitive(a, b) === Comparison.EqualTo;
}
export function getCharacterCount(value: string, ch: string) {
  let result = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === ch) {
      result++;
    }
  }
  return result;
}
