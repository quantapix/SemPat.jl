import * as qv from 'vscode';

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
export function isDefined<T>(x?: T): x is T {
  return x !== undefined;
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
export function isArray(x: unknown): x is readonly {}[] {
  return Array.isArray ? Array.isArray(x) : x instanceof Array;
}
export const empty = Object.freeze([]);
const hasOwnProperty = Object.prototype.hasOwnProperty;
export interface MapLike<T> {
  [k: string]: T;
}
export function hasProperty(m: MapLike<any>, k: string): boolean {
  return hasOwnProperty.call(m, k);
}
export function getNestedProperty(x: any, n: string) {
  return n.split('.').reduce((o, p) => {
    return o && o[p];
  }, x);
}
export function getOrAdd<K, V>(m: Map<K, V>, k: K, f: () => V): V {
  const v = m.get(k);
  if (v !== undefined) return v;
  const y = f();
  m.set(k, y);
  return y;
}
export function objequals(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return equals(a, b, equals);
  else {
    const aks: string[] = [];
    for (const k in a) {
      aks.push(k);
    }
    aks.sort();
    const bks: string[] = [];
    for (const k in b) {
      bks.push(k);
    }
    bks.sort();
    if (!equals(aks, bks)) return false;
    return aks.every((k) => equals(a[k], b[k]));
  }
}
export function flattenObjectValues<T>(x: { [k: string]: T[] }): T[] {
  return flattenArray(Object.keys(x).map((k) => x[k]));
}
interface Thenable<T> {
  then<R>(onfulfilled?: (x: T) => R | Thenable<R>, onrejected?: (x: any) => R | Thenable<R>): Thenable<R>;
  then<R>(onfulfilled?: (x: T) => R | Thenable<R>, onrejected?: (x: any) => void): Thenable<R>;
}
export function isThenable<T>(x: any): x is Thenable<T> {
  return typeof x?.then === 'function';
}
export function identity<T>(x: T) {
  return x;
}
export function toBoolean(x: string): boolean {
  return 'TRUE' === x?.trim().toUpperCase();
}
export function toLowerCase(x: string) {
  return x.toLowerCase();
}
export type EqualityComparer<T> = (a: T, b: T) => boolean;
export function equateValues<T>(a: T, b: T) {
  return a === b;
}
export function contains<T>(ts: readonly T[] | undefined, t: T, c: EqualityComparer<T> = equateValues): boolean {
  if (ts) {
    for (const x of ts) {
      if (c(x, t)) return true;
    }
  }
  return false;
}
export const enum Comparison {
  LessThan = -1,
  EqualTo = 0,
  GreaterThan = 1,
}
export function compareComparableValues(a?: string, b?: string): Comparison;
export function compareComparableValues(a?: number, b?: number): Comparison;
export function compareComparableValues(a?: string | number, b?: string | number) {
  return a === b ? Comparison.EqualTo : a === undefined ? Comparison.LessThan : b === undefined ? Comparison.GreaterThan : a < b ? Comparison.LessThan : Comparison.GreaterThan;
}
export function compareValues(a?: number, b?: number): Comparison {
  return compareComparableValues(a, b);
}
export const emptyArray: never[] = [] as never[];
function selectIndex(_: unknown, i: number) {
  return i;
}
function indicesOf(xs: readonly unknown[]): number[] {
  return xs.map(selectIndex);
}
export function equals<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>, f: (a: T, b: T) => boolean = (a, b) => a === b): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => f(x, b[i]));
}
export interface SortedReadonlyArray<T> extends ReadonlyArray<T> {
  ' __sortedArrayBrand': any;
}
export interface SortedArray<T> extends Array<T> {
  ' __sortedArrayBrand': any;
}
export type Comparer<T> = (a: T, b: T) => Comparison;
export function cloneAndSort<T>(ts: readonly T[], c?: Comparer<T>): SortedReadonlyArray<T> {
  return (ts.length === 0 ? ts : ts.slice().sort(c)) as SortedReadonlyArray<T>;
}
export function stableSort<T>(ts: readonly T[], c: Comparer<T>): SortedReadonlyArray<T> {
  const is = indicesOf(ts);
  stableSortIndices(ts, is, c);
  return (is.map((i) => ts[i]) as SortedArray<T>) as SortedReadonlyArray<T>;
}
function stableSortIndices<T>(ts: readonly T[], is: number[], c: Comparer<T>) {
  is.sort((x, y) => c(ts[x], ts[y]) || compareValues(x, y));
}
export interface Push<T> {
  push(...ts: T[]): void;
}
export function append<A extends any[] | undefined, T extends NonNullable<A>[number] | undefined>(a: A, t: T): [undefined, undefined] extends [A, T] ? A : NonNullable<A>[number][];
export function append<T>(ts: T[], t?: T): T[];
export function append<T>(ts: T[] | undefined, t: T): T[];
export function append<T>(ts?: T[], t?: T): T[] | undefined;
export function append<T>(ts?: T[], t?: T): T[] | undefined {
  if (t === undefined) return ts;
  if (ts === undefined) return [t];
  ts.push(t);
  return ts;
}
export function map<T, U>(ts: readonly T[], f: (t: T, i: number) => U): U[];
export function map<T, U>(ts: readonly T[] | undefined, f: (t: T, i: number) => U): U[] | undefined;
export function map<T, U>(ts: readonly T[] | undefined, f: (t: T, i: number) => U): U[] | undefined {
  if (ts) return ts.map(f);
  return undefined;
}
export function some<T>(ts?: readonly T[]): ts is readonly T[];
export function some<T>(ts: readonly T[] | undefined, p: (t: T) => boolean): boolean;
export function some<T>(ts: readonly T[], p?: (t: T) => boolean): boolean {
  if (ts) {
    if (p) return ts.some(p);
    else return ts.length > 0;
  }
  return false;
}
export function every<T>(ts: readonly T[], p: (t: T, i: number) => boolean): boolean {
  if (ts) return ts.every(p);
  return true;
}
export function find<T, U extends T>(ts: readonly T[], predicate: (t: T, i: number) => t is U): U | undefined;
export function find<T>(ts: readonly T[], predicate: (t: T, i: number) => boolean): T | undefined;
export function find<T>(ts: readonly T[], predicate: (t: T, i: number) => boolean): T | undefined {
  for (let i = 0; i < ts.length; i++) {
    const x = ts[i];
    if (predicate(x, i)) return x;
  }
  return undefined;
}
export function binarySearch<T, U>(ts: readonly T[], t: T, s: (v: T) => U, c: Comparer<U>, off?: number): number {
  return binarySearchKey(ts, s(t), s, c, off);
}
export function binarySearchKey<T, U>(ts: readonly T[], k: U, s: (t: T) => U, c: Comparer<U>, off?: number): number {
  if (!some(ts)) return -1;
  let lo = off || 0;
  let hi = ts.length - 1;
  while (lo <= hi) {
    const m = lo + ((hi - lo) >> 1);
    switch (c(s(ts[m]), k)) {
      case Comparison.LessThan:
        lo = m + 1;
        break;
      case Comparison.EqualTo:
        return m;
      case Comparison.GreaterThan:
        hi = m - 1;
        break;
    }
  }
  return ~lo;
}
function toOffset(xs: readonly any[], o: number) {
  return o < 0 ? xs.length + o : o;
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
export function flatten<T>(tss: T[][] | readonly (T | readonly T[] | undefined)[]): T[] {
  const ys = [];
  for (const x of tss) {
    if (x) {
      if (isArray(x)) addRange(ys, x);
      else ys.push(x);
    }
  }
  return ys;
}
export function flatten<T>(tss: ReadonlyArray<T>[]): T[] {
  return Array.prototype.concat.apply([], tss);
}
export function flatten<T>(tss: T[][]): T[] {
  return tss.reduce((y, x) => y.concat(x), []);
}
export function uniq<T>(ts: T[]): T[] {
  return Array.from(new Set(ts));
}
export function uniqueBasedOnHash<T extends Record<string, any>>(ts: T[], hash: (t: T) => string, __result: T[] = []): T[] {
  const ys: typeof ts = [];
  const s = new Set<string>();
  ts.forEach((x) => {
    const h = hash(x);
    if (s.has(h)) return;
    s.add(h);
    ys.push(x);
  });
  return ys;
}
export function flattenArray<T>(tss: T[][]): T[] {
  return tss.reduce((y, x) => [...y, ...x], []);
}
export function coalesce<T>(ts: ReadonlyArray<T | undefined>): T[] {
  return <T[]>ts.filter((x) => !!x);
}
export function insertAt<T>(ts: T[], i: number, t: T) {
  if (i === 0) ts.unshift(t);
  else if (i === ts.length) ts.push(t);
  else {
    for (let j = ts.length; j > i; j--) {
      ts[j] = ts[j - 1];
    }
    ts[i] = t;
  }
  return ts;
}
export function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
export function compareStringsCaseInsensitive(a?: string, b?: string): Comparison {
  return a === b ? Comparison.EqualTo : a === undefined ? Comparison.LessThan : b === undefined ? Comparison.GreaterThan : compareComparableValues(a.toUpperCase(), b.toUpperCase());
}
export function compareStringsCaseSensitive(a?: string, b?: string): Comparison {
  return compareComparableValues(a, b);
}
export function getStringComparer(nocase?: boolean) {
  return nocase ? compareStringsCaseInsensitive : compareStringsCaseSensitive;
}
export function equateStringsCaseInsensitive(a: string, b: string) {
  return compareStringsCaseInsensitive(a, b) === Comparison.EqualTo;
}
export function equateStringsCaseSensitive(a: string, b: string) {
  return compareStringsCaseSensitive(a, b) === Comparison.EqualTo;
}
export function getCharacterCount(s: string, c: string) {
  let y = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === c) y++;
  }
  return y;
}
export class Mutex {
  private mutex = Promise.resolve();
  public lock(): PromiseLike<() => void> {
    let x: (unlock: () => void) => void;
    this.mutex = this.mutex.then(() => {
      return new Promise(x);
    });
    return new Promise((r) => {
      x = r;
    });
  }
}
export class Observable<T> {
  private _sinks: Set<(t: T) => void> = new Set();
  constructor(private _val: T) {}
  get val() {
    return this._val;
  }
  set val(v: T) {
    this._val = v;
    this._sinks.forEach((f) => f(v));
  }
  public observe(f: (t: T) => void): qv.Disposable {
    this._sinks.add(f);
    return { dispose: () => this._sinks.delete(f) };
  }
}
export class Lazy<T> {
  private _val?: T;
  constructor(private readonly fun: () => T) {}
  get val() {
    return this._val ?? (this._val = this.fun());
  }
  reset() {
    this._val = undefined;
  }
  map<R>(f: (x: T) => R): Lazy<R> {
    return new Lazy(() => f(this.val));
  }
}
export function disposeAll(ds: qv.Disposable[]) {
  while (ds.length) {
    const d = ds.pop();
    if (d) d.dispose();
  }
}
export abstract class Disposable {
  private _done = false;
  protected _ds: qv.Disposable[] = [];
  public dispose(): any {
    if (this._done) return;
    this._done = true;
    disposeAll(this._ds);
  }
  protected _register<T extends qv.Disposable>(ts: T | T[]) {
    if (isArray(ts)) {
      for (const t of ts) {
        this._register(t);
      }
    } else {
      if (this._done) ts.dispose();
      else this._ds.push(ts);
    }
  }
  protected get isDisposed() {
    return this._done;
  }
}
export function memoize(_: any, key: string, x: any) {
  let k: string | undefined;
  let f: Function | undefined;
  if (typeof x.value === 'function') {
    k = 'value';
    f = x.value;
  } else if (typeof x.get === 'function') {
    k = 'get';
    f = x.get;
  } else throw new Error('not supported');
  const p = `$memoize$${key}`;
  x[k] = function (...xs: any[]) {
    if (!this.hasOwnProperty(p)) Object.defineProperty(this, p, { configurable: false, enumerable: false, writable: false, value: f!.apply(this, xs) });
    return this[p];
  };
}
export interface ITask<T> {
  (): T;
}
export class Delayer<T> {
  private tout?: any;
  private prom?: Promise<T | undefined>;
  private onSuccess?: (t: T | PromiseLike<T> | undefined) => void;
  private task?: ITask<T>;
  constructor(public defDelay: number) {}
  public trigger(t: ITask<T>, d: number = this.defDelay): Promise<T | undefined> {
    this.task = t;
    if (d >= 0) this.cancelTimeout();
    if (!this.prom) {
      this.prom = new Promise<T | undefined>((resolve) => {
        this.onSuccess = resolve;
      }).then(() => {
        this.prom = undefined;
        this.onSuccess = undefined;
        const y = this.task && this.task();
        this.task = undefined;
        return y;
      });
    }
    if (d >= 0 || this.tout === undefined) {
      this.tout = setTimeout(
        () => {
          this.tout = undefined;
          if (this.onSuccess) this.onSuccess(undefined);
        },
        d >= 0 ? d : this.defDelay
      );
    }
    return this.prom;
  }
  private cancelTimeout(): void {
    if (this.tout !== undefined) {
      clearTimeout(this.tout);
      this.tout = undefined;
    }
  }
}
export function escapeRegExp(s: string) {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
const SHEBANG_REGEXP = /^#!(.*)/;
export function getShebang(s: string): string | undefined {
  const m = SHEBANG_REGEXP.exec(s);
  if (!m || !m[1]) return undefined;
  return m[1].replace('-', '').trim();
}
export function isBashShebang(s: string): boolean {
  return s.endsWith('bash') || s.endsWith('sh');
}
export function hasBashShebang(s: string): boolean {
  const x = getShebang(s);
  return x ? isBashShebang(x) : false;
}
export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolved: boolean;
  readonly rejected: boolean;
  readonly completed: boolean;
  resolve(t?: T | PromiseLike<T>): void;
  reject(reason?: any): void;
}
class DeferredImpl<T> implements Deferred<T> {
  private _resolve!: (t: T | PromiseLike<T>) => void;
  private _reject!: (reason?: any) => void;
  private _res = false;
  private _rej = false;
  private _prom: Promise<T>;
  constructor(private scope: any = null) {
    this._prom = new Promise<T>((res, rej) => {
      this._resolve = res;
      this._reject = rej;
    });
  }
  public resolve(_value?: T | PromiseLike<T>) {
    this._resolve.apply(this.scope ? this.scope : this, arguments as any);
    this._res = true;
  }
  public reject(_reason?: any) {
    this._reject.apply(this.scope ? this.scope : this, arguments as any);
    this._rej = true;
  }
  get promise(): Promise<T> {
    return this._prom;
  }
  get resolved(): boolean {
    return this._res;
  }
  get rejected(): boolean {
    return this._rej;
  }
  get completed(): boolean {
    return this._rej || this._res;
  }
}
export function createDeferred<T>(scope: any = null): Deferred<T> {
  return new DeferredImpl<T>(scope);
}
export function createDeferredFrom<T>(...ps: Promise<T>[]): Deferred<T> {
  const y = createDeferred<T>();
  Promise.all<T>(ps)
    .then(y.resolve.bind(y) as any)
    .catch(y.reject.bind(y) as any);
  return y;
}
export function createDeferredFromPromise<T>(p: Promise<T>): Deferred<T> {
  const y = createDeferred<T>();
  p.then(y.resolve.bind(y)).catch(y.reject.bind(y));
  return y;
}
