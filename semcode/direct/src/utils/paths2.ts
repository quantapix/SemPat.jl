import { randomBytes } from 'crypto';
import { Dirent } from 'fs';
import * as path from 'path';
import Char from 'typescript-char';
import { URI } from 'vscode-uri';
import { PyrightFileSystem } from './files';
import { some } from './collection';
import { compareValues, Comparison, GetCanonicalFileName, identity } from './core';
import * as debug from './debug';
import { FileSystem, Stats } from './files';
import { compareStringsCaseInsensitive, compareStringsCaseSensitive, equateStringsCaseInsensitive, equateStringsCaseSensitive, getStringComparer } from './strings';
let _fsCaseSensitivity: boolean | undefined = undefined;
export interface FileSpec {
  wildcardRoot: string;
  regExp: RegExp;
}
export namespace FileSpec {
  export function is(value: any): value is FileSpec {
    const candidate: FileSpec = value as FileSpec;
    return candidate && !!candidate.wildcardRoot && !!candidate.regExp;
  }
}
export interface FileSystemEntries {
  files: string[];
  directories: string[];
}
export function forEachAncestorDir(directory: string, callback: (directory: string) => string | undefined): string | undefined {
  while (true) {
    const result = callback(directory);
    if (result !== undefined) {
      return result;
    }
    const parentPath = getDirPath(directory);
    if (parentPath === directory) {
      return undefined;
    }
    directory = parentPath;
  }
}
export function getDirPath(pathString: string): string {
  return pathString.substr(0, Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep)));
}
export function getRootLength(pathString: string): number {
  if (pathString.charAt(0) === path.sep) {
    if (pathString.charAt(1) !== path.sep) {
      return 1;
    }
    const p1 = pathString.indexOf(path.sep, 2);
    if (p1 < 0) {
      return 2;
    }
    const p2 = pathString.indexOf(path.sep, p1 + 1);
    if (p2 < 0) {
      return p1 + 1;
    }
    return p2 + 1;
  }
  if (pathString.charAt(1) === ':') {
    if (pathString.charAt(2) === path.sep) {
      return 3;
    }
  }
  return 0;
}
export function getPathComponents(pathString: string) {
  const normalizedPath = normalizeSlashes(pathString);
  const rootLength = getRootLength(normalizedPath);
  const root = normalizedPath.substring(0, rootLength);
  const rest = normalizedPath.substring(rootLength).split(path.sep);
  if (rest.length > 0 && !rest[rest.length - 1]) {
    rest.pop();
  }
  return reducePathComponents([root, ...rest]);
}
export function reducePathComponents(components: readonly string[]) {
  if (!some(components)) {
    return [];
  }
  const reduced = [components[0]];
  for (let i = 1; i < components.length; i++) {
    const component = components[i];
    if (!component || component === '.') {
      continue;
    }
    if (component === '..') {
      if (reduced.length > 1) {
        if (reduced[reduced.length - 1] !== '..') {
          reduced.pop();
          continue;
        }
      } else if (reduced[0]) {
        continue;
      }
    }
    reduced.push(component);
  }
  return reduced;
}
export function combinePathComponents(components: string[]): string {
  if (components.length === 0) {
    return '';
  }
  const root = components[0] && ensureTrailingDirSeparator(components[0]);
  return normalizeSlashes(root + components.slice(1).join(path.sep));
}
export function getRelativePath(dirPath: string, relativeTo: string) {
  if (!dirPath.startsWith(ensureTrailingDirSeparator(relativeTo))) {
    return undefined;
  }
  const pathComponents = getPathComponents(dirPath);
  const relativeToComponents = getPathComponents(relativeTo);
  let relativePath = '.';
  for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
    relativePath += path.sep + pathComponents[i];
  }
  return relativePath;
}
export function makeDirectories(fs: FileSystem, dirPath: string, startingFromDirPath: string) {
  if (!dirPath.startsWith(startingFromDirPath)) {
    return;
  }
  const pathComponents = getPathComponents(dirPath);
  const relativeToComponents = getPathComponents(startingFromDirPath);
  let curPath = startingFromDirPath;
  for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
    curPath = combinePaths(curPath, pathComponents[i]);
    if (!fs.existsSync(curPath)) {
      fs.mkdirSync(curPath);
    }
  }
}
export function getFileSize(fs: FileSystem, path: string) {
  const stat = tryStat(fs, path);
  if (stat?.isFile()) {
    return stat.size;
  }
  return 0;
}
export function fileExists(fs: FileSystem, path: string): boolean {
  return fileSystemEntryExists(fs, path, FileSystemEntryKind.File);
}
export function directoryExists(fs: FileSystem, path: string): boolean {
  return fileSystemEntryExists(fs, path, FileSystemEntryKind.Dir);
}
export function normalizeSlashes(pathString: string): string {
  const separatorRegExp = /[\\/]/g;
  return pathString.replace(separatorRegExp, path.sep);
}
export function resolvePaths(path: string, ...paths: (string | undefined)[]): string {
  return normalizePath(some(paths) ? combinePaths(path, ...paths) : normalizeSlashes(path));
}
export function combinePaths(pathString: string, ...paths: (string | undefined)[]): string {
  if (pathString) {
    pathString = normalizeSlashes(pathString);
  }
  for (let relativePath of paths) {
    if (!relativePath) {
      continue;
    }
    relativePath = normalizeSlashes(relativePath);
    if (!pathString || getRootLength(relativePath) !== 0) {
      pathString = relativePath;
    } else {
      pathString = ensureTrailingDirSeparator(pathString) + relativePath;
    }
  }
  return pathString;
}
export function comparePaths(a: string, b: string, ignoreCase?: boolean): Comparison;
export function comparePaths(a: string, b: string, currentDir: string, ignoreCase?: boolean): Comparison;
export function comparePaths(a: string, b: string, currentDir?: string | boolean, ignoreCase?: boolean) {
  a = normalizePath(a);
  b = normalizePath(b);
  if (typeof currentDir === 'string') {
    a = combinePaths(currentDir, a);
    b = combinePaths(currentDir, b);
  } else if (typeof currentDir === 'boolean') {
    ignoreCase = currentDir;
  }
  return comparePathsWorker(a, b, getStringComparer(ignoreCase));
}
export function containsPath(parent: string, child: string, ignoreCase?: boolean): boolean;
export function containsPath(parent: string, child: string, currentDir: string, ignoreCase?: boolean): boolean;
export function containsPath(parent: string, child: string, currentDir?: string | boolean, ignoreCase?: boolean) {
  if (typeof currentDir === 'string') {
    parent = combinePaths(currentDir, parent);
    child = combinePaths(currentDir, child);
  } else if (typeof currentDir === 'boolean') {
    ignoreCase = currentDir;
  }
  if (parent === undefined || child === undefined) {
    return false;
  }
  if (parent === child) {
    return true;
  }
  const parentComponents = getPathComponents(parent);
  const childComponents = getPathComponents(child);
  if (childComponents.length < parentComponents.length) {
    return false;
  }
  const componentEqualityComparer = ignoreCase ? equateStringsCaseInsensitive : equateStringsCaseSensitive;
  for (let i = 0; i < parentComponents.length; i++) {
    const equalityComparer = i === 0 ? equateStringsCaseInsensitive : componentEqualityComparer;
    if (!equalityComparer(parentComponents[i], childComponents[i])) {
      return false;
    }
  }
  return true;
}
export function changeAnyExtension(path: string, ext: string): string;
export function changeAnyExtension(path: string, ext: string, extensions: string | readonly string[], ignoreCase: boolean): string;
export function changeAnyExtension(path: string, ext: string, extensions?: string | readonly string[], ignoreCase?: boolean): string {
  const pathExt = extensions !== undefined && ignoreCase !== undefined ? getAnyExtensionFromPath(path, extensions, ignoreCase) : getAnyExtensionFromPath(path);
  return pathExt ? path.slice(0, path.length - pathExt.length) + (ext.startsWith('.') ? ext : '.' + ext) : path;
}
export function getAnyExtensionFromPath(path: string): string;
export function getAnyExtensionFromPath(path: string, extensions: string | readonly string[], ignoreCase: boolean): string;
export function getAnyExtensionFromPath(path: string, extensions?: string | readonly string[], ignoreCase?: boolean): string {
  if (extensions) {
    return getAnyExtensionFromPathWorker(stripTrailingDirSeparator(path), extensions, ignoreCase ? equateStringsCaseInsensitive : equateStringsCaseSensitive);
  }
  const baseFileName = getBaseFileName(path);
  const extensionIndex = baseFileName.lastIndexOf('.');
  if (extensionIndex >= 0) {
    return baseFileName.substring(extensionIndex);
  }
  return '';
}
export function getBaseFileName(pathString: string): string;
export function getBaseFileName(pathString: string, extensions: string | readonly string[], ignoreCase: boolean): string;
export function getBaseFileName(pathString: string, extensions?: string | readonly string[], ignoreCase?: boolean) {
  pathString = normalizeSlashes(pathString);
  const rootLength = getRootLength(pathString);
  if (rootLength === pathString.length) {
    return '';
  }
  pathString = stripTrailingDirSeparator(pathString);
  const name = pathString.slice(Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep) + 1));
  const extension = extensions !== undefined && ignoreCase !== undefined ? getAnyExtensionFromPath(name, extensions, ignoreCase) : undefined;
  return extension ? name.slice(0, name.length - extension.length) : name;
}
export function getRelativePathFromDir(from: string, to: string, ignoreCase: boolean): string;
export function getRelativePathFromDir(fromDir: string, to: string, getCanonicalFileName: GetCanonicalFileName): string;
export function getRelativePathFromDir(fromDir: string, to: string, getCanonicalFileNameOrIgnoreCase: GetCanonicalFileName | boolean) {
  const pathComponents = getRelativePathComponentsFromDir(fromDir, to, getCanonicalFileNameOrIgnoreCase);
  return combinePathComponents(pathComponents);
}
export function getRelativePathComponentsFromDir(fromDir: string, to: string, getCanonicalFileNameOrIgnoreCase: GetCanonicalFileName | boolean) {
  debug.assert(getRootLength(fromDir) > 0 === getRootLength(to) > 0, 'Paths must either both be absolute or both be relative');
  const getCanonicalFileName = typeof getCanonicalFileNameOrIgnoreCase === 'function' ? getCanonicalFileNameOrIgnoreCase : identity;
  const ignoreCase = typeof getCanonicalFileNameOrIgnoreCase === 'boolean' ? getCanonicalFileNameOrIgnoreCase : false;
  const pathComponents = getPathComponentsRelativeTo(fromDir, to, ignoreCase ? equateStringsCaseInsensitive : equateStringsCaseSensitive, getCanonicalFileName);
  return pathComponents;
}
export function comparePathsCaseSensitive(a: string, b: string) {
  return comparePathsWorker(a, b, compareStringsCaseSensitive);
}
export function comparePathsCaseInsensitive(a: string, b: string) {
  return comparePathsWorker(a, b, compareStringsCaseInsensitive);
}
export function ensureTrailingDirSeparator(pathString: string): string {
  if (!hasTrailingDirSeparator(pathString)) {
    return pathString + path.sep;
  }
  return pathString;
}
export function hasTrailingDirSeparator(pathString: string) {
  if (pathString.length === 0) {
    return false;
  }
  const ch = pathString.charCodeAt(pathString.length - 1);
  return ch === Char.Slash || ch === Char.Backslash;
}
export function stripTrailingDirSeparator(pathString: string) {
  if (!hasTrailingDirSeparator(pathString)) {
    return pathString;
  }
  return pathString.substr(0, pathString.length - 1);
}
export function getFileExtension(fileName: string, multiDotExtension = false) {
  if (!multiDotExtension) {
    return path.extname(fileName);
  }
  fileName = getFileName(fileName);
  const firstDotIndex = fileName.indexOf('.');
  return fileName.substr(firstDotIndex);
}
export function getFileName(pathString: string) {
  return path.basename(pathString);
}
export function stripFileExtension(fileName: string, multiDotExtension = false) {
  const ext = getFileExtension(fileName, multiDotExtension);
  return fileName.substr(0, fileName.length - ext.length);
}
export function normalizePath(pathString: string): string {
  return normalizeSlashes(path.normalize(pathString));
}
export function isDir(fs: FileSystem, path: string): boolean {
  return tryStat(fs, path)?.isDir() ?? false;
}
export function isFile(fs: FileSystem, path: string): boolean {
  return tryStat(fs, path)?.isFile() ?? false;
}
export function tryStat(fs: FileSystem, path: string): Stats | undefined {
  try {
    return fs.statSync(path);
  } catch (e) {
    return undefined;
  }
}
export function getFileSystemEntries(fs: FileSystem, path: string): FileSystemEntries {
  try {
    return getFileSystemEntriesFromDirEntries(fs.readdirEntriesSync(path || '.'), fs, path);
  } catch (e) {
    return { files: [], directories: [] };
  }
}
export function getFileSystemEntriesFromDirEntries(dirEntries: Dirent[], fs: FileSystem, path: string): FileSystemEntries {
  const entries = dirEntries.sort((a, b) => {
    if (a.name < b.name) {
      return -1;
    } else if (a.name > b.name) {
      return 1;
    } else {
      return 0;
    }
  });
  const files: string[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') {
      continue;
    }
    if (entry.isFile()) {
      files.push(entry.name);
    } else if (entry.isDir()) {
      directories.push(entry.name);
    } else if (entry.isSymbolicLink()) {
      const entryPath = combinePaths(path, entry.name);
      const stat = tryStat(fs, entryPath);
      if (stat?.isFile()) {
        files.push(entry.name);
      } else if (stat?.isDir()) {
        directories.push(entry.name);
      }
    }
  }
  return { files, directories };
}
export function getWildcardRegexPattern(rootPath: string, fileSpec: string): string {
  let absolutePath = normalizePath(combinePaths(rootPath, fileSpec));
  if (!absolutePath.endsWith('.py') && !absolutePath.endsWith('.pyi')) {
    absolutePath = ensureTrailingDirSeparator(absolutePath);
  }
  const pathComponents = getPathComponents(absolutePath);
  const escapedSeparator = getRegexEscapedSeparator();
  const doubleAsteriskRegexFragment = `(${escapedSeparator}[^${escapedSeparator}.][^${escapedSeparator}]*)*?`;
  const reservedCharacterPattern = new RegExp(`[^\\w\\s${escapedSeparator}]`, 'g');
  if (pathComponents.length > 0) {
    pathComponents[0] = stripTrailingDirSeparator(pathComponents[0]);
  }
  let regExPattern = '';
  let firstComponent = true;
  for (let component of pathComponents) {
    if (component === '**') {
      regExPattern += doubleAsteriskRegexFragment;
    } else {
      if (!firstComponent) {
        component = escapedSeparator + component;
      }
      regExPattern += component.replace(reservedCharacterPattern, (match) => {
        if (match === '*') {
          return `[^${escapedSeparator}]*`;
        } else if (match === '?') {
          return `[^${escapedSeparator}]`;
        } else {
          return '\\' + match;
        }
      });
      firstComponent = false;
    }
  }
  return regExPattern;
}
export function getWildcardRoot(rootPath: string, fileSpec: string): string {
  let absolutePath = normalizePath(combinePaths(rootPath, fileSpec));
  if (!absolutePath.endsWith('.py') && !absolutePath.endsWith('.pyi')) {
    absolutePath = ensureTrailingDirSeparator(absolutePath);
  }
  const pathComponents = getPathComponents(absolutePath);
  if (pathComponents.length > 0) {
    pathComponents[0] = stripTrailingDirSeparator(pathComponents[0]);
  }
  let wildcardRoot = '';
  let firstComponent = true;
  for (let component of pathComponents) {
    if (component === '**') {
      break;
    } else {
      if (component.match(/[*?]/)) {
        break;
      }
      if (!firstComponent) {
        component = path.sep + component;
      }
      wildcardRoot += component;
      firstComponent = false;
    }
  }
  return wildcardRoot;
}
export function getFileSpec(rootPath: string, fileSpec: string): FileSpec {
  let regExPattern = getWildcardRegexPattern(rootPath, fileSpec);
  const escapedSeparator = getRegexEscapedSeparator();
  regExPattern = `^(${regExPattern})($|${escapedSeparator})`;
  const regExp = new RegExp(regExPattern);
  const wildcardRoot = getWildcardRoot(rootPath, fileSpec);
  return {
    wildcardRoot,
    regExp,
  };
}
export function getRegexEscapedSeparator() {
  return path.sep === '/' ? '/' : '\\\\';
}
export function isRootedDiskPath(path: string) {
  return getRootLength(path) > 0;
}
export function isDiskPathRoot(path: string) {
  const rootLength = getRootLength(path);
  return rootLength > 0 && rootLength === path.length;
}
function comparePathsWorker(a: string, b: string, componentComparer: (a: string, b: string) => Comparison) {
  if (a === b) {
    return Comparison.EqualTo;
  }
  if (a === undefined) {
    return Comparison.LessThan;
  }
  if (b === undefined) {
    return Comparison.GreaterThan;
  }
  const aRoot = a.substring(0, getRootLength(a));
  const bRoot = b.substring(0, getRootLength(b));
  const result = compareStringsCaseInsensitive(aRoot, bRoot);
  if (result !== Comparison.EqualTo) {
    return result;
  }
  const escapedSeparator = getRegexEscapedSeparator();
  const relativePathSegmentRegExp = new RegExp(`(^|${escapedSeparator}).{0,2}($|${escapedSeparator})`);
  const aRest = a.substring(aRoot.length);
  const bRest = b.substring(bRoot.length);
  if (!relativePathSegmentRegExp.test(aRest) && !relativePathSegmentRegExp.test(bRest)) {
    return componentComparer(aRest, bRest);
  }
  const aComponents = getPathComponents(a);
  const bComponents = getPathComponents(b);
  const sharedLength = Math.min(aComponents.length, bComponents.length);
  for (let i = 1; i < sharedLength; i++) {
    const result = componentComparer(aComponents[i], bComponents[i]);
    if (result !== Comparison.EqualTo) {
      return result;
    }
  }
  return compareValues(aComponents.length, bComponents.length);
}
function getAnyExtensionFromPathWorker(path: string, extensions: string | readonly string[], stringEqualityComparer: (a: string, b: string) => boolean) {
  if (typeof extensions === 'string') {
    return tryGetExtensionFromPath(path, extensions, stringEqualityComparer) || '';
  }
  for (const extension of extensions) {
    const result = tryGetExtensionFromPath(path, extension, stringEqualityComparer);
    if (result) {
      return result;
    }
  }
  return '';
}
function tryGetExtensionFromPath(path: string, extension: string, stringEqualityComparer: (a: string, b: string) => boolean) {
  if (!extension.startsWith('.')) {
    extension = '.' + extension;
  }
  if (path.length >= extension.length && path.charCodeAt(path.length - extension.length) === Char.Period) {
    const pathExtension = path.slice(path.length - extension.length);
    if (stringEqualityComparer(pathExtension, extension)) {
      return pathExtension;
    }
  }
  return undefined;
}
function getPathComponentsRelativeTo(from: string, to: string, stringEqualityComparer: (a: string, b: string) => boolean, getCanonicalFileName: GetCanonicalFileName) {
  const fromComponents = getPathComponents(from);
  const toComponents = getPathComponents(to);
  let start: number;
  for (start = 0; start < fromComponents.length && start < toComponents.length; start++) {
    const fromComponent = getCanonicalFileName(fromComponents[start]);
    const toComponent = getCanonicalFileName(toComponents[start]);
    const comparer = start === 0 ? equateStringsCaseInsensitive : stringEqualityComparer;
    if (!comparer(fromComponent, toComponent)) {
      break;
    }
  }
  if (start === 0) {
    return toComponents;
  }
  const components = toComponents.slice(start);
  const relative: string[] = [];
  for (; start < fromComponents.length; start++) {
    relative.push('..');
  }
  return ['', ...relative, ...components];
}
const enum FileSystemEntryKind {
  File,
  Dir,
}
function fileSystemEntryExists(fs: FileSystem, path: string, entryKind: FileSystemEntryKind): boolean {
  try {
    const stat = fs.statSync(path);
    switch (entryKind) {
      case FileSystemEntryKind.File:
        return stat.isFile();
      case FileSystemEntryKind.Dir:
        return stat.isDir();
      default:
        return false;
    }
  } catch (e) {
    return false;
  }
}
export function convertUriToPath(fs: FileSystem, uriString: string): string {
  const uri = URI.parse(uriString);
  let convertedPath = normalizePath(uri.path);
  if (convertedPath.match(/^\\[a-zA-Z]:\\/)) {
    convertedPath = convertedPath.substr(1);
  }
  if (fs instanceof PyrightFileSystem) {
    return fs.getMappedFilePath(convertedPath);
  }
  return convertedPath;
}
export function convertPathToUri(fs: FileSystem, path: string): string {
  if (fs instanceof PyrightFileSystem) {
    path = fs.getOriginalFilePath(path);
  }
  return URI.file(path).toString();
}
export function normalizePathCase(fs: FileSystem, path: string) {
  if (isFileSystemCaseSensitive(fs)) {
    return path;
  }
  return path.toLowerCase();
}
export function isFileSystemCaseSensitive(fs: FileSystem) {
  if (_fsCaseSensitivity !== undefined) {
    return _fsCaseSensitivity;
  }
  _fsCaseSensitivity = isFileSystemCaseSensitiveInternal(fs);
  return _fsCaseSensitivity;
}
export function isFileSystemCaseSensitiveInternal(fs: FileSystem) {
  let filePath: string | undefined = undefined;
  try {
    let name: string;
    let mangledFilePath: string;
    do {
      name = `${randomBytes(21).toString('hex')}-a`;
      filePath = path.join(fs.tmpdir(), name);
      mangledFilePath = path.join(fs.tmpdir(), name.toUpperCase());
    } while (fs.existsSync(filePath) || fs.existsSync(mangledFilePath));
    fs.writeFileSync(filePath, '', 'utf8');
    return !fs.existsSync(mangledFilePath);
  } catch (e) {
    return false;
  } finally {
    if (filePath) {
      fs.unlinkSync(filePath);
    }
  }
}
export function getLibraryPathWithoutExtension(libraryFilePath: string) {
  let filePathWithoutExtension = stripFileExtension(libraryFilePath);

  if (filePathWithoutExtension.endsWith('__init__')) {
    filePathWithoutExtension = filePathWithoutExtension.substr(0, filePathWithoutExtension.length - 9);
  }
  return filePathWithoutExtension;
}
