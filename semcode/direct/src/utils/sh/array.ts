export function flatten<A>(xs: A[][]): A[] {
  return xs.reduce((a, b) => a.concat(b), []);
}
export function uniq<A>(a: A[]): A[] {
  return Array.from(new Set(a));
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
