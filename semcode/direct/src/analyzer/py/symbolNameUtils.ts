const _constantRegEx = /^[A-Z0-9_]+$/;
const _underscoreOnlyRegEx = /^[_]+$/;
const _camelCaseRegEx = /^_{0,2}[A-Z][A-Za-z0-9_]+$/;
export function isPrivateName(name: string) {
  return name.length > 2 && name.startsWith('__') && !name.endsWith('__');
}
export function isProtectedName(name: string) {
  return name.length > 1 && name.startsWith('_') && !name.startsWith('__');
}
export function isPrivateOrProtectedName(name: string) {
  return isPrivateName(name) || isProtectedName(name);
}
export function isDunderName(name: string) {
  return name.length > 4 && name.startsWith('__') && name.endsWith('__');
}
export function isSingleDunderName(name: string) {
  return name.length > 2 && name.startsWith('_') && name.endsWith('_');
}
export function isConstantName(name: string) {
  return !!name.match(_constantRegEx) && !name.match(_underscoreOnlyRegEx);
}
export function isTypeAliasName(name: string) {
  return !!name.match(_camelCaseRegEx);
}
export function isPublicConstantOrTypeAlias(name: string) {
  return !isPrivateOrProtectedName(name) && (isConstantName(name) || isTypeAliasName(name));
}
