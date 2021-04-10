import * as child_process from 'child_process';
import { ConfigOptions } from '../common/configOptions';
import { compareComparableValues } from '../common/core';
import { FileSystem } from '../common/fileSystem';
import * as pathConsts from '../common/pathConsts';
import { combinePaths, containsPath, ensureTrailingDirSeparator, getDirPath, getFileSystemEntries, isDir, normalizePath, tryStat } from '../common/pathUtils';
interface PythonPathResult {
  paths: string[];
  prefix: string;
}
const extractSys = [
  'import os, os.path, sys',
  'normalize = lambda p: os.path.normcase(os.path.normpath(p))',
  'cwd = normalize(os.getcwd())',
  'sys.path[:] = (p for p in sys.path if p != "" and normalize(p) != cwd)',
  'import json',
  'json.dump(dict(path=sys.path, prefix=sys.prefix), sys.stdout)',
].join('; ');
export const stdLibFolderName = 'stdlib';
export const thirdPartyFolderName = 'stubs';
export function getTypeShedFallbackPath(fs: FileSystem) {
  let moduleDir = fs.getModulePath();
  if (!moduleDir) {
    return undefined;
  }
  moduleDir = getDirPath(ensureTrailingDirSeparator(normalizePath(moduleDir)));
  const typeshedPath = combinePaths(moduleDir, pathConsts.typeshedFallback);
  if (fs.existsSync(typeshedPath)) {
    return typeshedPath;
  }
  const debugTypeshedPath = combinePaths(getDirPath(moduleDir), pathConsts.typeshedFallback);
  if (fs.existsSync(debugTypeshedPath)) {
    return debugTypeshedPath;
  }
  return undefined;
}
export function getTypeshedSubdirectory(typeshedPath: string, isStdLib: boolean) {
  return combinePaths(typeshedPath, isStdLib ? stdLibFolderName : thirdPartyFolderName);
}
export function findPythonSearchPaths(
  fs: FileSystem,
  configOptions: ConfigOptions,
  importFailureInfo: string[],
  includeWatchPathsOnly?: boolean | undefined,
  workspaceRoot?: string | undefined
): string[] | undefined {
  importFailureInfo.push('Finding python search paths');
  if (configOptions.venvPath !== undefined && configOptions.venv) {
    const venvDir = configOptions.venv;
    const venvPath = combinePaths(configOptions.venvPath, venvDir);
    const foundPaths: string[] = [];
    const sitePackagesPaths: string[] = [];
    [pathConsts.lib, pathConsts.lib64, pathConsts.libAlternate].forEach((libPath) => {
      const sitePackagesPath = findSitePackagesPath(fs, combinePaths(venvPath, libPath), importFailureInfo);
      if (sitePackagesPath) {
        addPathIfUnique(foundPaths, sitePackagesPath);
        sitePackagesPaths.push(sitePackagesPath);
      }
    });
    sitePackagesPaths.forEach((sitePackagesPath) => {
      const pthPaths = getPathsFromPthFiles(fs, sitePackagesPath);
      pthPaths.forEach((path) => {
        addPathIfUnique(foundPaths, path);
      });
    });
    if (foundPaths.length > 0) {
      importFailureInfo.push(`Found the following '${pathConsts.sitePackages}' dirs`);
      foundPaths.forEach((path) => {
        importFailureInfo.push(`  ${path}`);
      });
      return foundPaths;
    }
    importFailureInfo.push(`Did not find any '${pathConsts.sitePackages}' dirs. Falling back on python interpreter.`);
  }
  const pathResult = getPythonPathFromPythonInterpreter(fs, configOptions.pythonPath, importFailureInfo);
  if (includeWatchPathsOnly && workspaceRoot) {
    const paths = pathResult.paths.filter((p) => !containsPath(workspaceRoot, p, true) || containsPath(pathResult.prefix, p, true));
    return paths;
  }
  return pathResult.paths;
}
export function getPythonPathFromPythonInterpreter(fs: FileSystem, interpreterPath: string | undefined, importFailureInfo: string[]): PythonPathResult {
  let result: PythonPathResult | undefined;
  if (interpreterPath) {
    result = getPathResultFromInterpreter(fs, interpreterPath, importFailureInfo);
  } else {
    if (process.platform !== 'win32') {
      result = getPathResultFromInterpreter(fs, 'python3', importFailureInfo);
    }
    if (!result) {
      result = getPathResultFromInterpreter(fs, 'python', importFailureInfo);
    }
  }
  if (!result) {
    result = {
      paths: [],
      prefix: '',
    };
  }
  importFailureInfo.push(`Received ${result.paths.length} paths from interpreter`);
  result.paths.forEach((path) => {
    importFailureInfo.push(`  ${path}`);
  });
  return result;
}
export function isPythonBinary(p: string): boolean {
  p = p.trim();
  return p === 'python' || p === 'python3';
}
function findSitePackagesPath(fs: FileSystem, libPath: string, importFailureInfo: string[]): string | undefined {
  if (fs.existsSync(libPath)) {
    importFailureInfo.push(`Found path '${libPath}'; looking for ${pathConsts.sitePackages}`);
  } else {
    importFailureInfo.push(`Did not find '${libPath}'`);
    return undefined;
  }
  const sitePackagesPath = combinePaths(libPath, pathConsts.sitePackages);
  if (fs.existsSync(sitePackagesPath)) {
    importFailureInfo.push(`Found path '${sitePackagesPath}'`);
    return sitePackagesPath;
  } else {
    importFailureInfo.push(`Did not find '${sitePackagesPath}', so looking for python subdirectory`);
  }
  const entries = getFileSystemEntries(fs, libPath);
  for (let i = 0; i < entries.directories.length; i++) {
    const dirName = entries.directories[i];
    if (dirName.startsWith('python')) {
      const dirPath = combinePaths(libPath, dirName, pathConsts.sitePackages);
      if (fs.existsSync(dirPath)) {
        importFailureInfo.push(`Found path '${dirPath}'`);
        return dirPath;
      } else {
        importFailureInfo.push(`Path '${dirPath}' is not a valid directory`);
      }
    }
  }
}
function getPathResultFromInterpreter(fs: FileSystem, interpreter: string, importFailureInfo: string[]): PythonPathResult | undefined {
  const result: PythonPathResult = {
    paths: [],
    prefix: '',
  };
  try {
    const commandLineArgs: string[] = ['-c', extractSys];
    importFailureInfo.push(`Executing interpreter: '${interpreter}'`);
    const execOutput = child_process.execFileSync(interpreter, commandLineArgs, { encoding: 'utf8' });
    try {
      const execSplit = JSON.parse(execOutput);
      for (let execSplitEntry of execSplit.path) {
        execSplitEntry = execSplitEntry.trim();
        if (execSplitEntry) {
          const normalizedPath = normalizePath(execSplitEntry);
          if (fs.existsSync(normalizedPath) && isDir(fs, normalizedPath)) {
            result.paths.push(normalizedPath);
          } else {
            importFailureInfo.push(`Skipping '${normalizedPath}' because it is not a valid directory`);
          }
        }
      }
      result.prefix = execSplit.prefix;
      if (result.paths.length === 0) {
        importFailureInfo.push(`Found no valid directories`);
      }
    } catch (err) {
      importFailureInfo.push(`Could not parse output: '${execOutput}'`);
      throw err;
    }
  } catch {
    return undefined;
  }
  return result;
}
function getPathsFromPthFiles(fs: FileSystem, parentDir: string): string[] {
  const searchPaths: string[] = [];
  const pthFiles = fs
    .readdirEntriesSync(parentDir)
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.pth'))
    .sort((a, b) => compareComparableValues(a.name, b.name));
  pthFiles.forEach((pthFile) => {
    const filePath = combinePaths(parentDir, pthFile.name);
    const fileStats = tryStat(fs, filePath);
    if (fileStats?.isFile() && fileStats.size > 0 && fileStats.size < 64 * 1024) {
      const data = fs.readFileSync(filePath, 'utf8');
      const lines = data.split(/\r?\n/);
      lines.forEach((line) => {
        const trimmedLine = line.trim();
        if (trimmedLine.length > 0 && !trimmedLine.startsWith('#') && !trimmedLine.match(/^import\s/)) {
          const pthPath = combinePaths(parentDir, trimmedLine);
          if (fs.existsSync(pthPath) && isDir(fs, pthPath)) {
            searchPaths.push(pthPath);
          }
        }
      });
    }
  });
  return searchPaths;
}
function addPathIfUnique(pathList: string[], pathToAdd: string) {
  if (!pathList.some((path) => path === pathToAdd)) {
    pathList.push(pathToAdd);
    return true;
  }
  return false;
}
