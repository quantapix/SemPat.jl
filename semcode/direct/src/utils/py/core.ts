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
