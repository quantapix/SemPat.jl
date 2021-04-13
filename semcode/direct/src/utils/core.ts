import leven from 'leven';
export const enum Comparison {
  LessThan = -1,
  EqualTo = 0,
  GreaterThan = 1,
}
export type AnyFunction = (...xs: never[]) => void;
export function returnFalse(): false {
  return false;
}
export function returnTrue(): true {
  return true;
}
export function returnUndefined(): undefined {
  return undefined;
}
export function identity<T>(x: T) {
  return x;
}
export function toLowerCase(x: string) {
  return x.toLowerCase();
}
export function equateValues<T>(a: T, b: T) {
  return a === b;
}
export type GetCanonicalFileName = (name: string) => string;
export function compareComparableValues(a: string | undefined, b: string | undefined): Comparison;
export function compareComparableValues(a: number | undefined, b: number | undefined): Comparison;
export function compareComparableValues(a: string | number | undefined, b: string | number | undefined) {
  return a === b ? Comparison.EqualTo : a === undefined ? Comparison.LessThan : b === undefined ? Comparison.GreaterThan : a < b ? Comparison.LessThan : Comparison.GreaterThan;
}
export function compareValues(a: number | undefined, b: number | undefined): Comparison {
  return compareComparableValues(a, b);
}
export function isArray(x: any): x is readonly {}[] {
  return Array.isArray ? Array.isArray(x) : x instanceof Array;
}
export function isString(x: unknown): x is string {
  return typeof x === 'string';
}
export function isNumber(x: unknown): x is number {
  return typeof x === 'number';
}
export function isBoolean(x: unknown): x is number {
  return typeof x === 'boolean';
}
const hasOwnProperty = Object.prototype.hasOwnProperty;
export interface MapLike<T> {
  [k: string]: T;
}
export function hasProperty(m: MapLike<any>, k: string): boolean {
  return hasOwnProperty.call(m, k);
}
export function toBoolean(x: string): boolean {
  const y = x?.trim().toUpperCase();
  return y === 'TRUE';
}
export function isDebugMode() {
  const v = process.execArgv.join();
  return v.includes('inspect') || v.includes('debug');
}
interface Thenable<T> {
  then<TResult>(onfulfilled?: (x: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>;
  then<TResult>(onfulfilled?: (x: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>;
}
export function isThenable<T>(x: any): x is Thenable<T> {
  return typeof x?.then === 'function';
}
export function isDefined<T>(x: T | undefined): x is T {
  return x !== undefined;
}
export const emptyArray: never[] = [] as never[];
export type EqualityComparer<T> = (a: T, b: T) => boolean;
export function contains<T>(array: readonly T[] | undefined, value: T, equalityComparer: EqualityComparer<T> = equateValues): boolean {
  if (array) {
    for (const v of array) {
      if (equalityComparer(v, value)) return true;
    }
  }
  return false;
}
export interface Push<T> {
  push(...values: T[]): void;
}
export function append<TArray extends any[] | undefined, TValue extends NonNullable<TArray>[number] | undefined>(
  to: TArray,
  value: TValue
): [undefined, undefined] extends [TArray, TValue] ? TArray : NonNullable<TArray>[number][];
export function append<T>(to: T[], value: T | undefined): T[];
export function append<T>(to: T[] | undefined, value: T): T[];
export function append<T>(to: T[] | undefined, value: T | undefined): T[] | undefined;
export function append<T>(to: T[] | undefined, value: T | undefined): T[] | undefined {
  if (value === undefined) return to;
  if (to === undefined) return [value];
  to.push(value);
  return to;
}
export function find<T, U extends T>(array: readonly T[], predicate: (element: T, index: number) => element is U): U | undefined;
export function find<T>(array: readonly T[], predicate: (element: T, index: number) => boolean): T | undefined;
export function find<T>(array: readonly T[], predicate: (element: T, index: number) => boolean): T | undefined {
  for (let i = 0; i < array.length; i++) {
    const value = array[i];
    if (predicate(value, i)) return value;
  }
  return undefined;
}
function toOffset(array: readonly any[], offset: number) {
  return offset < 0 ? array.length + offset : offset;
}
export function addRange<T>(to: T[], from: readonly T[] | undefined, start?: number, end?: number): T[];
export function addRange<T>(to: T[] | undefined, from: readonly T[] | undefined, start?: number, end?: number): T[] | undefined;
export function addRange<T>(to: T[] | undefined, from: readonly T[] | undefined, start?: number, end?: number): T[] | undefined {
  if (from === undefined || from.length === 0) return to;
  if (to === undefined) return from.slice(start, end);
  start = start === undefined ? 0 : toOffset(from, start);
  end = end === undefined ? from.length : toOffset(from, end);
  for (let i = start; i < end && i < from.length; i++) {
    if (from[i] !== undefined) to.push(from[i]);
  }
  return to;
}
export function insertAt<T>(array: T[], index: number, value: T) {
  if (index === 0) array.unshift(value);
  else if (index === array.length) array.push(value);
  else {
    for (let i = array.length; i > index; i--) {
      array[i] = array[i - 1];
    }
    array[index] = value;
  }
  return array;
}
export type Comparer<T> = (a: T, b: T) => Comparison;
export interface SortedReadonlyArray<T> extends ReadonlyArray<T> {
  ' __sortedArrayBrand': any;
}
export interface SortedArray<T> extends Array<T> {
  ' __sortedArrayBrand': any;
}
export function cloneAndSort<T>(array: readonly T[], comparer?: Comparer<T>): SortedReadonlyArray<T> {
  return (array.length === 0 ? array : array.slice().sort(comparer)) as SortedReadonlyArray<T>;
}
function selectIndex(_: unknown, i: number) {
  return i;
}
function indicesOf(array: readonly unknown[]): number[] {
  return array.map(selectIndex);
}
export function stableSort<T>(array: readonly T[], comparer: Comparer<T>): SortedReadonlyArray<T> {
  const indices = indicesOf(array);
  stableSortIndices(array, indices, comparer);
  return (indices.map((i) => array[i]) as SortedArray<T>) as SortedReadonlyArray<T>;
}
function stableSortIndices<T>(array: readonly T[], indices: number[], comparer: Comparer<T>) {
  indices.sort((x, y) => comparer(array[x], array[y]) || compareValues(x, y));
}
export function map<T, U>(array: readonly T[], f: (x: T, i: number) => U): U[];
export function map<T, U>(array: readonly T[] | undefined, f: (x: T, i: number) => U): U[] | undefined;
export function map<T, U>(array: readonly T[] | undefined, f: (x: T, i: number) => U): U[] | undefined {
  if (array) return array.map(f);
  return undefined;
}
export function some<T>(array: readonly T[] | undefined): array is readonly T[];
export function some<T>(array: readonly T[] | undefined, predicate: (value: T) => boolean): boolean;
export function some<T>(array: readonly T[] | undefined, predicate?: (value: T) => boolean): boolean {
  if (array) {
    if (predicate) return array.some(predicate);
    else return array.length > 0;
  }
  return false;
}
export function every<T>(array: readonly T[], callback: (element: T, index: number) => boolean): boolean {
  if (array) return array.every(callback);
  return true;
}
export function binarySearch<T, U>(array: readonly T[], value: T, keySelector: (v: T) => U, keyComparer: Comparer<U>, offset?: number): number {
  return binarySearchKey(array, keySelector(value), keySelector, keyComparer, offset);
}
export function binarySearchKey<T, U>(array: readonly T[], key: U, keySelector: (v: T) => U, keyComparer: Comparer<U>, offset?: number): number {
  if (!some(array)) return -1;
  let low = offset || 0;
  let high = array.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const midKey = keySelector(array[middle]);
    switch (keyComparer(midKey, key)) {
      case Comparison.LessThan:
        low = middle + 1;
        break;
      case Comparison.EqualTo:
        return middle;
      case Comparison.GreaterThan:
        high = middle - 1;
        break;
    }
  }
  return ~low;
}
export function flatten<T>(array: T[][] | readonly (T | readonly T[] | undefined)[]): T[] {
  const result = [];
  for (const v of array) {
    if (v) {
      if (isArray(v)) addRange(result, v);
      else result.push(v);
    }
  }
  return result;
}
export function getNestedProperty(object: any, property: string) {
  const value = property.split('.').reduce((obj, prop) => {
    return obj && obj[prop];
  }, object);
  return value;
}
export function getOrAdd<K, V>(map: Map<K, V>, key: K, newValueFact: () => V): V {
  const value = map.get(key);
  if (value !== undefined) return value;
  const newValue = newValueFact();
  map.set(key, newValue);
  return newValue;
}
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
