export function flatten<T>(xs: T[][]): T[] {
  return xs.reduce((y, x) => y.concat(x), []);
}
export function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
export function uniqueBasedOnHash<A extends Record<string, any>>(list: A[], elementToHash: (a: A) => string, __result: A[] = []): A[] {
  const result: typeof list = [];
  const hashSet = new Set<string>();
  list.forEach((element) => {
    const hash = elementToHash(element);
    if (hashSet.has(hash)) {
      return;
    }
    hashSet.add(hash);
    result.push(element);
  });
  return result;
}
export function flattenArray<T>(xs: T[][]): T[] {
  return xs.reduce((y, x) => [...y, ...x], []);
}
export function flattenObjectValues<T>(x: { [k: string]: T[] }): T[] {
  return flattenArray(Object.keys(x).map((k) => x[k]));
}
