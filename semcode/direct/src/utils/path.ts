import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { logVerbose } from '../goLogging';
import * as qv from 'vscode';
import { TSServiceConfig } from './config';
import { RelativeWorkspacePathResolver } from './relativePathResolver';
import * as glob from 'glob';
import { randomBytes } from 'crypto';
import { Dirent } from 'fs';
import Char from 'typescript-char';
import { URI } from 'vscode-uri';
import { PyrightFileSystem } from './files';
import { compareValues, Comparison, identity, some } from './base';
import * as debug from './debug';
import { FileSystem, Stats } from './files';
import { compareStringsCaseInsensitive, compareStringsCaseSensitive, equateStringsCaseInsensitive, equateStringsCaseSensitive, getStringComparer } from './base';

export type GetCanonicalFileName = (x: string) => string;
export interface FileSpec {
  wildcardRoot: string;
  regExp: RegExp;
}
export namespace FileSpec {
  export function is(x: any): x is FileSpec {
    const y: FileSpec = x as FileSpec;
    return y && !!y.wildcardRoot && !!y.regExp;
  }
}
export interface FileSystemEntries {
  files: string[];
  dirs: string[];
}
export function forEachAncestorDir(x: string, f: (x: string) => string | undefined): string | undefined {
  while (true) {
    const y = f(x);
    if (y !== undefined) return y;
    const p = getDirPath(x);
    if (p === x) return undefined;
    x = p;
  }
}
export function getDirPath(x: string): string {
  return x.substr(0, Math.max(getRootLength(x), x.lastIndexOf(path.sep)));
}
export function getRootLength(x: string): number {
  if (x.charAt(0) === path.sep) {
    if (x.charAt(1) !== path.sep) return 1;
    const i1 = x.indexOf(path.sep, 2);
    if (i1 < 0) return 2;
    const i2 = x.indexOf(path.sep, i1 + 1);
    if (i2 < 0) return i1 + 1;
    return i2 + 1;
  }
  if (x.charAt(1) === ':') {
    if (x.charAt(2) === path.sep) return 3;
  }
  return 0;
}
export function getPathComponents(x: string) {
  const p = normalizeSlashes(x);
  const l = getRootLength(p);
  const y = p.substring(0, l);
  const ys = p.substring(l).split(path.sep);
  if (ys.length > 0 && !ys[ys.length - 1]) ys.pop();
  return reducePathComponents([y, ...ys]);
}
export function reducePathComponents(xs: readonly string[]) {
  if (!some(xs)) return [];
  const ys = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    if (!x || x === '.') continue;
    if (x === '..') {
      if (ys.length > 1) {
        if (ys[ys.length - 1] !== '..') {
          ys.pop();
          continue;
        }
      } else if (ys[0]) continue;
    }
    ys.push(x);
  }
  return ys;
}
export function combinePathComponents(xs: string[]): string {
  if (xs.length === 0) return '';
  const x = xs[0] && ensureTrailingDirSeparator(xs[0]);
  return normalizeSlashes(x + xs.slice(1).join(path.sep));
}
export function getRelativePath(x: string, relativeTo: string) {
  if (!x.startsWith(ensureTrailingDirSeparator(relativeTo))) return undefined;
  const xs = getPathComponents(x);
  const ys = getPathComponents(relativeTo);
  let y = '.';
  for (let i = ys.length; i < xs.length; i++) {
    y += path.sep + xs[i];
  }
  return y;
}
export function makeDirectories(fs: FileSystem, x: string, start: string) {
  if (!x.startsWith(start)) return;
  const xs = getPathComponents(x);
  const relativeToComponents = getPathComponents(start);
  let y = start;
  for (let i = relativeToComponents.length; i < xs.length; i++) {
    y = combinePaths(y, xs[i]);
    if (!fs.existsSync(y)) fs.mkdirSync(y);
  }
}
export function getFileSize(fs: FileSystem, x: string) {
  const y = tryStat(fs, x);
  return y?.isFile() ? y.size : 0;
}
export function fileExists(fs: FileSystem, x: string): boolean {
  return fileSystemEntryExists(fs, x, FileSystemEntryKind.File);
}
export function directoryExists(fs: FileSystem, x: string): boolean {
  return fileSystemEntryExists(fs, x, FileSystemEntryKind.Dir);
}
export function normalizeSlashes(x: string): string {
  const sep = /[\\/]/g;
  return x.replace(sep, path.sep);
}
export function resolvePaths(x: string, ...xs: (string | undefined)[]): string {
  return normalizePath(some(xs) ? combinePaths(x, ...xs) : normalizeSlashes(x));
}
export function combinePaths(x: string, ...xs: (string | undefined)[]): string {
  if (x) x = normalizeSlashes(x);
  for (let p of xs) {
    if (!p) continue;
    p = normalizeSlashes(p);
    if (!x || getRootLength(p) !== 0) x = p;
    else x = ensureTrailingDirSeparator(x) + p;
  }
  return x;
}
export function comparePaths(a: string, b: string, nocase?: boolean): Comparison;
export function comparePaths(a: string, b: string, dir: string, nocase?: boolean): Comparison;
export function comparePaths(a: string, b: string, dir?: string | boolean, nocase?: boolean) {
  a = normalizePath(a);
  b = normalizePath(b);
  if (typeof dir === 'string') {
    a = combinePaths(dir, a);
    b = combinePaths(dir, b);
  } else if (typeof dir === 'boolean') nocase = dir;
  return comparePathsWorker(a, b, getStringComparer(nocase));
}
export function containsPath(p: string, c: string, nocase?: boolean): boolean;
export function containsPath(p: string, c: string, dir: string, nocase?: boolean): boolean;
export function containsPath(parent: string, child: string, dir?: string | boolean, nocase?: boolean) {
  if (typeof dir === 'string') {
    parent = combinePaths(dir, parent);
    child = combinePaths(dir, child);
  } else if (typeof dir === 'boolean') nocase = dir;
  if (parent === undefined || child === undefined) return false;
  if (parent === child) return true;
  const ps = getPathComponents(parent);
  const cs = getPathComponents(child);
  if (cs.length < ps.length) return false;
  const c2 = nocase ? equateStringsCaseInsensitive : equateStringsCaseSensitive;
  for (let i = 0; i < ps.length; i++) {
    const c = i === 0 ? equateStringsCaseInsensitive : c2;
    if (!c(ps[i], cs[i])) return false;
  }
  return true;
}
export function changeAnyExtension(x: string, e: string): string;
export function changeAnyExtension(x: string, e: string, es: string | readonly string[], nocase: boolean): string;
export function changeAnyExtension(x: string, e: string, es?: string | readonly string[], nocase?: boolean): string {
  const y = es !== undefined && nocase !== undefined ? getAnyExtensionFromPath(x, es, nocase) : getAnyExtensionFromPath(x);
  return y ? x.slice(0, x.length - y.length) + (e.startsWith('.') ? e : '.' + e) : x;
}
export function getAnyExtensionFromPath(x: string): string;
export function getAnyExtensionFromPath(x: string, es: string | readonly string[], nocase: boolean): string;
export function getAnyExtensionFromPath(x: string, es?: string | readonly string[], nocase?: boolean): string {
  if (es) return getAnyExtensionFromPathWorker(stripTrailingDirSeparator(x), es, nocase ? equateStringsCaseInsensitive : equateStringsCaseSensitive);
  const n = getBaseFileName(x);
  const i = n.lastIndexOf('.');
  if (i >= 0) return n.substring(i);
  return '';
}
export function getBaseFileName(x: string): string;
export function getBaseFileName(x: string, es: string | readonly string[], nocase: boolean): string;
export function getBaseFileName(x: string, es?: string | readonly string[], nocase?: boolean) {
  x = normalizeSlashes(x);
  const l = getRootLength(x);
  if (l === x.length) return '';
  x = stripTrailingDirSeparator(x);
  const n = x.slice(Math.max(getRootLength(x), x.lastIndexOf(path.sep) + 1));
  const e = es !== undefined && nocase !== undefined ? getAnyExtensionFromPath(n, es, nocase) : undefined;
  return e ? n.slice(0, n.length - e.length) : n;
}
export function getRelativePathFromDir(from: string, to: string, nocase: boolean): string;
export function getRelativePathFromDir(from: string, to: string, flag: GetCanonicalFileName): string;
export function getRelativePathFromDir(from: string, to: string, flag: GetCanonicalFileName | boolean) {
  const cs = getRelativePathComponentsFromDir(from, to, flag);
  return combinePathComponents(cs);
}
export function getRelativePathComponentsFromDir(from: string, to: string, flag: GetCanonicalFileName | boolean) {
  debug.assert(getRootLength(from) > 0 === getRootLength(to) > 0, 'Paths must either both be absolute or both be relative');
  const f = typeof flag === 'function' ? flag : identity;
  const nocase = typeof flag === 'boolean' ? flag : false;
  const ys = getPathComponentsRelativeTo(from, to, nocase ? equateStringsCaseInsensitive : equateStringsCaseSensitive, f);
  return ys;
}
export function comparePathsCaseSensitive(a: string, b: string) {
  return comparePathsWorker(a, b, compareStringsCaseSensitive);
}
export function comparePathsCaseInsensitive(a: string, b: string) {
  return comparePathsWorker(a, b, compareStringsCaseInsensitive);
}
export function ensureTrailingDirSeparator(x: string): string {
  return !hasTrailingDirSeparator(x) ? x + path.sep : x;
}
export function hasTrailingDirSeparator(x: string) {
  if (x.length === 0) return false;
  const y = x.charCodeAt(x.length - 1);
  return y === Char.Slash || y === Char.Backslash;
}
export function stripTrailingDirSeparator(x: string) {
  return !hasTrailingDirSeparator(x) ? x : x.substr(0, x.length - 1);
}
export function getFileExtension(x: string, multiDot = false) {
  if (!multiDot) return path.extname(x);
  x = getFileName(x);
  return x.substr(x.indexOf('.'));
}
export function getFileName(x: string) {
  return path.basename(x);
}
export function stripFileExtension(x: string, multiDot = false) {
  const e = getFileExtension(x, multiDot);
  return x.substr(0, x.length - e.length);
}
export function normalizePath(x: string): string {
  return normalizeSlashes(path.normalize(x));
}
export function isDir(fs: FileSystem, x: string): boolean {
  return tryStat(fs, x)?.isDir() ?? false;
}
export function isFile(fs: FileSystem, x: string): boolean {
  return tryStat(fs, x)?.isFile() ?? false;
}
export function tryStat(fs: FileSystem, x: string): Stats | undefined {
  try {
    return fs.statSync(x);
  } catch (e) {
    return undefined;
  }
}
export function getFileSystemEntries(fs: FileSystem, x: string): FileSystemEntries {
  try {
    return getFileSystemEntriesFromDirEntries(fs.readdirEntriesSync(x || '.'), fs, x);
  } catch (e) {
    return { files: [], dirs: [] };
  }
}
export function getFileSystemEntriesFromDirEntries(es: Dirent[], fs: FileSystem, x: string): FileSystemEntries {
  const ds = es.sort((a, b) => {
    if (a.name < b.name) return -1;
    else if (a.name > b.name) return 1;
    else return 0;
  });
  const files: string[] = [];
  const dirs: string[] = [];
  for (const d of ds) {
    if (d.name === '.' || d.name === '..') continue;
    if (d.isFile()) files.push(d.name);
    else if (d.isDirectory()) dirs.push(d.name);
    else if (d.isSymbolicLink()) {
      const p = combinePaths(x, d.name);
      const y = tryStat(fs, p);
      if (y?.isFile()) files.push(d.name);
      else if (y?.isDir()) dirs.push(d.name);
    }
  }
  return { files, dirs };
}
export function getWildcardRegexPattern(root: string, x: string): string {
  let p = normalizePath(combinePaths(root, x));
  if (!p.endsWith('.py') && !p.endsWith('.pyi')) p = ensureTrailingDirSeparator(p);
  const cs = getPathComponents(p);
  const sep = getRegexEscapedSeparator();
  const doubleAsterisk = `(${sep}[^${sep}.][^${sep}]*)*?`;
  const reservedChar = new RegExp(`[^\\w\\s${sep}]`, 'g');
  if (cs.length > 0) cs[0] = stripTrailingDirSeparator(cs[0]);
  let y = '';
  let first = true;
  for (let c of cs) {
    if (c === '**') y += doubleAsterisk;
    else {
      if (!first) c = sep + c;
      y += c.replace(reservedChar, (m) => {
        if (m === '*') return `[^${sep}]*`;
        else if (m === '?') return `[^${sep}]`;
        else return '\\' + m;
      });
      first = false;
    }
  }
  return y;
}
export function getWildcardRoot(root: string, x: string): string {
  let p = normalizePath(combinePaths(root, x));
  if (!p.endsWith('.py') && !p.endsWith('.pyi')) p = ensureTrailingDirSeparator(p);
  const cs = getPathComponents(p);
  if (cs.length > 0) cs[0] = stripTrailingDirSeparator(cs[0]);
  let y = '';
  let first = true;
  for (let c of cs) {
    if (c === '**') break;
    else {
      if (c.match(/[*?]/)) break;
      if (!first) c = path.sep + c;
      y += c;
      first = false;
    }
  }
  return y;
}
export function getFileSpec(root: string, x: string): FileSpec {
  let pat = getWildcardRegexPattern(root, x);
  const sep = getRegexEscapedSeparator();
  pat = `^(${pat})($|${sep})`;
  const regExp = new RegExp(pat);
  const wildcardRoot = getWildcardRoot(root, x);
  return { wildcardRoot, regExp };
}
export function getRegexEscapedSeparator() {
  return path.sep === '/' ? '/' : '\\\\';
}
export function isRootedDiskPath(x: string) {
  return getRootLength(x) > 0;
}
export function isDiskPathRoot(x: string) {
  const l = getRootLength(x);
  return l > 0 && l === x.length;
}
function comparePathsWorker(a: string, b: string, f: (a: string, b: string) => Comparison) {
  if (a === b) return Comparison.EqualTo;
  if (a === undefined) return Comparison.LessThan;
  if (b === undefined) return Comparison.GreaterThan;
  const a1 = a.substring(0, getRootLength(a));
  const b1 = b.substring(0, getRootLength(b));
  const y = compareStringsCaseInsensitive(a1, b1);
  if (y !== Comparison.EqualTo) return y;
  const sep = getRegexEscapedSeparator();
  const r = new RegExp(`(^|${sep}).{0,2}($|${sep})`);
  const a2 = a.substring(a1.length);
  const b2 = b.substring(b1.length);
  if (!r.test(a2) && !r.test(b2)) return f(a2, b2);
  const as = getPathComponents(a);
  const bs = getPathComponents(b);
  const l = Math.min(as.length, bs.length);
  for (let i = 1; i < l; i++) {
    const y = f(as[i], bs[i]);
    if (y !== Comparison.EqualTo) return y;
  }
  return compareValues(as.length, bs.length);
}
function getAnyExtensionFromPathWorker(x: string, es: string | readonly string[], f: (a: string, b: string) => boolean) {
  if (typeof es === 'string') return tryGetExtensionFromPath(x, es, f) || '';
  for (const e of es) {
    const y = tryGetExtensionFromPath(x, e, f);
    if (y) return y;
  }
  return '';
}
function tryGetExtensionFromPath(x: string, e: string, f: (a: string, b: string) => boolean) {
  if (!e.startsWith('.')) e = '.' + e;
  if (x.length >= e.length && x.charCodeAt(x.length - e.length) === Char.Period) {
    const y = x.slice(x.length - e.length);
    if (f(y, e)) return y;
  }
  return undefined;
}
function getPathComponentsRelativeTo(from: string, to: string, f: (a: string, b: string) => boolean, getCanonicalFileName: GetCanonicalFileName) {
  const fs = getPathComponents(from);
  const ts = getPathComponents(to);
  let start: number;
  for (start = 0; start < fs.length && start < ts.length; start++) {
    const fn = getCanonicalFileName(fs[start]);
    const tn = getCanonicalFileName(ts[start]);
    const c = start === 0 ? equateStringsCaseInsensitive : f;
    if (!c(fn, tn)) break;
  }
  if (start === 0) return ts;
  const cs = ts.slice(start);
  const rs: string[] = [];
  for (; start < fs.length; start++) {
    rs.push('..');
  }
  return ['', ...rs, ...cs];
}
const enum FileSystemEntryKind {
  File,
  Dir,
}
function fileSystemEntryExists(fs: FileSystem, x: string, k: FileSystemEntryKind): boolean {
  try {
    const y = fs.statSync(x);
    switch (k) {
      case FileSystemEntryKind.File:
        return y.isFile();
      case FileSystemEntryKind.Dir:
        return y.isDir();
      default:
        return false;
    }
  } catch (e) {
    return false;
  }
}
export function convertUriToPath(fs: FileSystem, x: string): string {
  let y = normalizePath(URI.parse(x).path);
  if (y.match(/^\\[a-zA-Z]:\\/)) y = y.substr(1);
  if (fs instanceof PyrightFileSystem) return fs.getMappedFilePath(y);
  return y;
}
export function convertPathToUri(fs: FileSystem, x: string): string {
  if (fs instanceof PyrightFileSystem) x = fs.getOriginalFilePath(x);
  return URI.file(x).toString();
}
export function normalizePathCase(fs: FileSystem, x: string) {
  if (isFileSystemCaseSensitive(fs)) return x;
  return x.toLowerCase();
}
let caseSensitivity: boolean | undefined = undefined;
export function isFileSystemCaseSensitive(fs: FileSystem) {
  if (caseSensitivity !== undefined) return caseSensitivity;
  caseSensitivity = isFileSystemCaseSensitiveInternal(fs);
  return caseSensitivity;
}
export function isFileSystemCaseSensitiveInternal(fs: FileSystem) {
  let p: string | undefined = undefined;
  try {
    let n: string;
    let mangled: string;
    do {
      n = `${randomBytes(21).toString('hex')}-a`;
      p = path.join(fs.tmpdir(), n);
      mangled = path.join(fs.tmpdir(), n.toUpperCase());
    } while (fs.existsSync(p) || fs.existsSync(mangled));
    fs.writeFileSync(p, '', 'utf8');
    return !fs.existsSync(mangled);
  } catch (e) {
    return false;
  } finally {
    if (p) fs.unlinkSync(p);
  }
}
export function getLibraryPathWithoutExtension(x: string) {
  let y = stripFileExtension(x);
  if (y.endsWith('__init__')) y = y.substr(0, y.length - 9);
  return y;
}

export function untildify(s: string): string {
  const h = os.homedir();
  return h ? s.replace(/^~(?=$|\/|\\)/, h) : s;
}
export async function getFilePaths({ globPattern, rootPath }: { globPattern: string; rootPath: string }): Promise<string[]> {
  return new Promise((res, rej) => {
    glob(globPattern, { cwd: rootPath, nodir: true, absolute: true, strict: false }, function (err, fs) {
      if (err) return rej(err);
      res(fs);
    });
  });
}
let binPathCache: { [bin: string]: string } = {};
export const envPath = process.env['PATH'] || (process.platform === 'win32' ? process.env['Path'] : null);
export function getBinPathFromEnvVar(toolName: string, envVarValue: string, appendBinToPath: boolean): string | null {
  toolName = correctBinname(toolName);
  if (envVarValue) {
    const paths = envVarValue.split(path.delimiter);
    for (const p of paths) {
      const binpath = path.join(p, appendBinToPath ? 'bin' : '', toolName);
      if (executableFileExists(binpath)) {
        return binpath;
      }
    }
  }
  return null;
}
export function getBinPathWithPreferredGopathGoroot(toolName: string, preferredGopaths: string[], preferredGoroot?: string, alternateTool?: string, useCache = true): string {
  const r = getBinPathWithPreferredGopathGorootWithExplanation(toolName, preferredGopaths, preferredGoroot, alternateTool, useCache);
  return r.binPath;
}
export function getBinPathWithPreferredGopathGorootWithExplanation(
  toolName: string,
  preferredGopaths: string[],
  preferredGoroot?: string,
  alternateTool?: string,
  useCache = true
): { binPath: string; why?: string } {
  if (alternateTool && path.isAbsolute(alternateTool) && executableFileExists(alternateTool)) {
    binPathCache[toolName] = alternateTool;
    return { binPath: alternateTool, why: 'alternateTool' };
  }
  if (useCache && binPathCache[toolName]) return { binPath: binPathCache[toolName], why: 'cached' };
  const binname = alternateTool && !path.isAbsolute(alternateTool) ? alternateTool : toolName;
  const found = (why: string) => (binname === toolName ? why : 'alternateTool');
  const pathFromGoBin = getBinPathFromEnvVar(binname, process.env['GOBIN'], false);
  if (pathFromGoBin) {
    binPathCache[toolName] = pathFromGoBin;
    return { binPath: pathFromGoBin, why: binname === toolName ? 'gobin' : 'alternateTool' };
  }
  for (const preferred of preferredGopaths) {
    if (typeof preferred === 'string') {
      const pathFrompreferredGoPath = getBinPathFromEnvVar(binname, preferred, true);
      if (pathFrompreferredGoPath) {
        binPathCache[toolName] = pathFrompreferredGoPath;
        return { binPath: pathFrompreferredGoPath, why: found('gopath') };
      }
    }
  }
  const pathFromGoRoot = getBinPathFromEnvVar(binname, preferredGoroot || getCurrentGoRoot(), true);
  if (pathFromGoRoot) {
    binPathCache[toolName] = pathFromGoRoot;
    return { binPath: pathFromGoRoot, why: found('goroot') };
  }
  const pathFromPath = getBinPathFromEnvVar(binname, envPath, false);
  if (pathFromPath) {
    binPathCache[toolName] = pathFromPath;
    return { binPath: pathFromPath, why: found('path') };
  }
  if (toolName === 'go') {
    const defaultPathsForGo = process.platform === 'win32' ? ['C:\\Program Files\\Go\\bin\\go.exe', 'C:\\Program Files (x86)\\Go\\bin\\go.exe'] : ['/usr/local/go/bin/go', '/usr/local/bin/go'];
    for (const p of defaultPathsForGo) {
      if (executableFileExists(p)) {
        binPathCache[toolName] = p;
        return { binPath: p, why: 'default' };
      }
    }
    return { binPath: '' };
  }
  return { binPath: toolName };
}
let currentGoRoot = '';
export function getCurrentGoRoot(): string {
  return currentGoRoot || process.env['GOROOT'] || '';
}
export function setCurrentGoRoot(goroot: string) {
  logVerbose(`setCurrentGoRoot(${goroot})`);
  currentGoRoot = goroot;
}
export function correctBinname(toolName: string) {
  if (process.platform === 'win32') return toolName + '.exe';
  return toolName;
}
export function executableFileExists(filePath: string): boolean {
  let exists = true;
  try {
    exists = fs.statSync(filePath).isFile();
    if (exists) fs.accessSync(filePath, fs.constants.F_OK | fs.constants.X_OK);
  } catch (e) {
    exists = false;
  }
  return exists;
}
export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch (e) {
    return false;
  }
}
export async function pathExists(p: string): Promise<boolean> {
  try {
    const stat = promisify(fs.stat);
    return (await stat(p)).isDir();
  } catch (e) {
    return false;
  }
}
export function clearCacheForTools() {
  binPathCache = {};
}
export function resolveHomeDir(inputPath: string): string {
  if (!inputPath || !inputPath.trim()) {
    return inputPath;
  }
  return inputPath.startsWith('~') ? path.join(os.homedir(), inputPath.substr(1)) : inputPath;
}
export function getInferredGopath(folderPath: string): string {
  if (!folderPath) return;
  const dirs = folderPath.toLowerCase().split(path.sep);
  const srcIdx = dirs.lastIndexOf('src');
  if (srcIdx > 0) return folderPath.substr(0, dirs.slice(0, srcIdx).join(path.sep).length);
}
export function getCurrentGoWorkspaceFromGOPATH(gopath: string, currentFileDirPath: string): string {
  if (!gopath) return;
  const workspaces: string[] = gopath.split(path.delimiter);
  let currentWorkspace = '';
  currentFileDirPath = fixDriveCasingInWindows(currentFileDirPath);
  for (const workspace of workspaces) {
    const possibleCurrentWorkspace = path.join(workspace, 'src');
    if (currentFileDirPath.startsWith(possibleCurrentWorkspace) || (process.platform === 'win32' && currentFileDirPath.toLowerCase().startsWith(possibleCurrentWorkspace.toLowerCase()))) {
      if (possibleCurrentWorkspace.length > currentWorkspace.length) currentWorkspace = currentFileDirPath.substr(0, possibleCurrentWorkspace.length);
    }
  }
  return currentWorkspace;
}
export function fixDriveCasingInWindows(pathToFix: string): string {
  return process.platform === 'win32' && pathToFix ? pathToFix.substr(0, 1).toUpperCase() + pathToFix.substr(1) : pathToFix;
}
export function getToolFromToolPath(toolPath: string): string | undefined {
  if (!toolPath) return;
  let tool = path.basename(toolPath);
  if (process.platform === 'win32' && tool.endsWith('.exe')) {
    tool = tool.substr(0, tool.length - 4);
  }
  return tool;
}
export function expandFilePathInOutput(output: string, cwd: string): string {
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].match(/\s*(\S+\.go):(\d+):/);
    if (matches && matches[1] && !path.isAbsolute(matches[1])) {
      lines[i] = lines[i].replace(matches[1], path.join(cwd, matches[1]));
    }
  }
  return lines.join('\n');
}
export class TSPluginPathsProvider {
  public constructor(private configuration: TSServiceConfig) {}
  public updateConfig(configuration: TSServiceConfig): void {
    this.configuration = configuration;
  }
  public getPluginPaths(): string[] {
    const pluginPaths = [];
    for (const pluginPath of this.configuration.tsServerPluginPaths) {
      pluginPaths.push(...this.resolvePluginPath(pluginPath));
    }
    return pluginPaths;
  }
  private resolvePluginPath(pluginPath: string): string[] {
    if (path.isAbsolute(pluginPath)) {
      return [pluginPath];
    }
    const workspacePath = RelativeWorkspacePathResolver.asAbsoluteWorkspacePath(pluginPath);
    if (workspacePath !== undefined) return [workspacePath];
    return (qv.workspace.workspaceFolders || []).map((workspaceFolder) => path.join(workspaceFolder.uri.fsPath, pluginPath));
  }
}
