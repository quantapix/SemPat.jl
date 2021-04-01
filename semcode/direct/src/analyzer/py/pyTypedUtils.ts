import { FileSystem } from '../common/fileSystem';
import { combinePaths, isDirectory, isFile } from '../common/pathUtils';

export interface PyTypedInfo {
  pyTypedPath: string;
  isPartiallyTyped: boolean;
}

const _pyTypedFileName = 'py.typed';

export function getPyTypedInfo(fileSystem: FileSystem, dirPath: string): PyTypedInfo | undefined {
  if (!fileSystem.existsSync(dirPath) || !isDirectory(fileSystem, dirPath)) {
    return undefined;
  }

  let isPartiallyTyped = false;
  const pyTypedPath = combinePaths(dirPath, _pyTypedFileName);

  if (!fileSystem.existsSync(dirPath) || !isFile(fileSystem, pyTypedPath)) {
    return undefined;
  }

  const fileStats = fileSystem.statSync(pyTypedPath);

  if (fileStats.size > 0 && fileStats.size < 64 * 1024) {
    const pyTypedContents = fileSystem.readFileSync(pyTypedPath, 'utf8');

    if (pyTypedContents.match(/partial\n/) || pyTypedContents.match(/partial\r\n/)) {
      isPartiallyTyped = true;
    }
  }

  return {
    pyTypedPath,
    isPartiallyTyped,
  };
}
