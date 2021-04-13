import * as fs from 'fs';
import { getPyTypedInfo } from './analyzer/pyTypedUtils';
import { ExecutionEnvironment } from './common/configOptions';
import { FileSystem, FileWatcher, FileWatcherEventHandler, MkDirOptions, Stats, TmpfileOptions } from './common/fileSystem';
import { stubsSuffix } from './common/pathConsts';
import { combinePaths, ensureTrailingDirSeparator, getDirPath, getFileName, isDir, tryStat } from './common/pathUtils';
export class PyrightFileSystem implements FileSystem {
  private readonly _fileMap = new Map<string, string>();
  private readonly _reverseFileMap = new Map<string, string>();
  private readonly _folderMap = new Map<string, string[]>();
  private readonly _rootSearched = new Set<string>();
  private readonly _partialStubPackagePaths = new Set<string>();
  constructor(private _realFS: FileSystem) {}
  existsSync(path: string): boolean {
    if (this._partialStubPackagePaths.has(path) || this._reverseFileMap.has(path)) {
      return false;
    }
    return this._realFS.existsSync(this.getOriginalFilePath(path));
  }
  mkdirSync(path: string, options?: MkDirOptions | number): void {
    this._realFS.mkdirSync(path, options);
  }
  chdir(path: string): void {
    this._realFS.chdir(path);
  }
  readdirEntriesSync(path: string): fs.Dirent[] {
    const entries = this._realFS.readdirEntriesSync(path).filter((item) => {
      const dirPath = combinePaths(path, item.name);
      return !this._partialStubPackagePaths.has(dirPath);
    });
    const partialStubs = this._folderMap.get(ensureTrailingDirSeparator(path));
    if (!partialStubs) {
      return entries;
    }
    return entries.concat(partialStubs.map((f) => new FakeFile(f)));
  }
  readdirSync(path: string): string[] {
    const entries = this._realFS.readdirSync(path).filter((item) => {
      const dirPath = combinePaths(path, item);
      return !this._partialStubPackagePaths.has(dirPath);
    });
    const partialStubs = this._folderMap.get(ensureTrailingDirSeparator(path));
    if (!partialStubs) {
      return entries;
    }
    return entries.concat(partialStubs);
  }
  readFileSync(path: string, encoding?: null): Buffer;
  readFileSync(path: string, encoding: BufferEncoding): string;
  readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer {
    return this._realFS.readFileSync(this.getOriginalFilePath(path), encoding);
  }
  writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void {
    this._realFS.writeFileSync(this.getOriginalFilePath(path), data, encoding);
  }
  statSync(path: string): Stats {
    return this._realFS.statSync(this.getOriginalFilePath(path));
  }
  unlinkSync(path: string): void {
    this._realFS.unlinkSync(this.getOriginalFilePath(path));
  }
  realpathSync(path: string): string {
    return this._realFS.realpathSync(path);
  }
  getModulePath(): string {
    return this._realFS.getModulePath();
  }
  createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
    return this._realFS.createFileSystemWatcher(paths, listener);
  }
  createReadStream(path: string): fs.ReadStream {
    return this._realFS.createReadStream(this.getOriginalFilePath(path));
  }
  createWriteStream(path: string): fs.WriteStream {
    return this._realFS.createWriteStream(this.getOriginalFilePath(path));
  }
  copyFileSync(src: string, dst: string): void {
    this._realFS.copyFileSync(this.getOriginalFilePath(src), this.getOriginalFilePath(dst));
  }
  readFile(path: string): Promise<Buffer> {
    return this._realFS.readFile(this.getOriginalFilePath(path));
  }
  readFileText(path: string, encoding?: BufferEncoding): Promise<string> {
    return this._realFS.readFileText(this.getOriginalFilePath(path), encoding);
  }
  tmpdir(): string {
    return this._realFS.tmpdir();
  }
  tmpfile(options?: TmpfileOptions): string {
    return this._realFS.tmpfile(options);
  }
  isPartialStubPackagesScanned(execEnv: ExecutionEnvironment): boolean {
    return this.isPathScanned(execEnv.root);
  }
  isPathScanned(path: string): boolean {
    return this._rootSearched.has(path);
  }
  processPartialStubPackages(paths: string[], roots: string[]) {
    for (const path of paths) {
      this._rootSearched.add(path);
      if (!this._realFS.existsSync(path) || !isDir(this._realFS, path)) {
        continue;
      }
      for (const entry of this._realFS.readdirEntriesSync(path)) {
        const partialStubPackagePath = combinePaths(path, entry.name);
        const isDir = !entry.isSymbolicLink() ? entry.isDir() : !!tryStat(this._realFS, partialStubPackagePath)?.isDir();
        if (!isDir || !entry.name.endsWith(stubsSuffix)) {
          continue;
        }
        const pyTypedInfo = getPyTypedInfo(this._realFS, partialStubPackagePath);
        if (!pyTypedInfo || !pyTypedInfo.isPartiallyTyped) {
          continue;
        }
        this._partialStubPackagePaths.add(partialStubPackagePath);
        let partialStubs: string[] | undefined;
        const packageName = entry.name.substr(0, entry.name.length - stubsSuffix.length);
        for (const root of roots) {
          const packagePath = combinePaths(root, packageName);
          try {
            const stat = tryStat(this._realFS, packagePath);
            if (!stat?.isDir()) {
              continue;
            }
            const packagePyTyped = getPyTypedInfo(this._realFS, packagePath);
            if (packagePyTyped && !packagePyTyped.isPartiallyTyped) {
              continue;
            }
            partialStubs = partialStubs ?? this._getRelativePathPartialStubs(partialStubPackagePath);
            for (const partialStub of partialStubs) {
              const mappedPyiFile = combinePaths(packagePath, partialStub);
              if (this.existsSync(mappedPyiFile)) {
                continue;
              }
              const originalPyiFile = combinePaths(partialStubPackagePath, partialStub);
              this._fileMap.set(mappedPyiFile, originalPyiFile);
              this._reverseFileMap.set(originalPyiFile, mappedPyiFile);
              const directory = ensureTrailingDirSeparator(getDirPath(mappedPyiFile));
              let folderInfo = this._folderMap.get(directory);
              if (!folderInfo) {
                folderInfo = [];
                this._folderMap.set(directory, folderInfo);
              }
              const pyiFileName = getFileName(mappedPyiFile);
              if (!folderInfo.some((entry) => entry === pyiFileName)) {
                folderInfo.push(pyiFileName);
              }
            }
          } catch {}
        }
      }
    }
  }
  clearPartialStubs(): void {
    this._fileMap.clear();
    this._folderMap.clear();
    this._rootSearched.clear();
    this._partialStubPackagePaths.clear();
  }
  isMappedFilePath(filepath: string): boolean {
    return this._fileMap.has(filepath);
  }
  getOriginalFilePath(mappedFilepath: string) {
    return this._fileMap.get(mappedFilepath) ?? mappedFilepath;
  }
  getMappedFilePath(originalFilepath: string) {
    return this._reverseFileMap.get(originalFilepath) ?? originalFilepath;
  }
  private _getRelativePathPartialStubs(path: string) {
    const paths: string[] = [];
    const partialStubPathLength = ensureTrailingDirSeparator(path).length;
    const searchAllStubs = (path: string) => {
      for (const entry of this._realFS.readdirEntriesSync(path)) {
        const filePath = combinePaths(path, entry.name);
        let isDir = entry.isDir();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          const stat = tryStat(this._realFS, filePath);
          if (stat) {
            isDir = stat.isDir();
            isFile = stat.isFile();
          }
        }
        if (isDir) {
          searchAllStubs(filePath);
        }
        if (isFile && entry.name.endsWith('.pyi')) {
          const relative = filePath.substring(partialStubPathLength);
          if (relative) {
            paths.push(relative);
          }
        }
      }
    };
    searchAllStubs(path);
    return paths;
  }
}
class FakeFile extends fs.Dirent {
  constructor(public name: string) {
    super();
  }
  isFile(): boolean {
    return true;
  }
  isDir(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}
