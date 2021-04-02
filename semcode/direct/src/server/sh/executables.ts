import * as fs from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';
import * as ArrayUtil from './util/array';
import * as FsUtil from './util/fs';
const lstatAsync = promisify(fs.lstat);
const readdirAsync = promisify(fs.readdir);
export default class Executables {
  public static fromPath(path: string): Promise<Executables> {
    const paths = path.split(':');
    const promises = paths.map((x) => findExecutablesInPath(x));
    return Promise.all(promises)
      .then(ArrayUtil.flatten)
      .then(ArrayUtil.uniq)
      .then((executables) => new Executables(executables));
  }
  private executables: Set<string>;
  private constructor(executables: string[]) {
    this.executables = new Set(executables);
  }
  public list(): string[] {
    return Array.from(this.executables.values());
  }
  public isExecutableOnPATH(executable: string): boolean {
    return this.executables.has(executable);
  }
}
async function findExecutablesInPath(path: string): Promise<string[]> {
  path = FsUtil.untildify(path);
  try {
    const pathStats = await lstatAsync(path);
    if (pathStats.isDirectory()) {
      const childrenPaths = await readdirAsync(path);
      const files = [];
      for (const childrenPath of childrenPaths) {
        try {
          const stats = await lstatAsync(join(path, childrenPath));
          if (isExecutableFile(stats)) {
            files.push(basename(childrenPath));
          }
        } catch (error) {
          // Ignore error
        }
      }
      return files;
    } else if (isExecutableFile(pathStats)) {
      return [basename(path)];
    }
  } catch (error) {
    // Ignore error
  }
  return [];
}
function isExecutableFile(stats: fs.Stats): boolean {
  const isExecutable = !!(1 & parseInt((stats.mode & parseInt('777', 8)).toString(8)[0]));
  return stats.isFile() && isExecutable;
}
