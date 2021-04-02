import * as glob from 'glob';
import * as Os from 'os';
export function untildify(pathWithTilde: string): string {
  const homeDirectory = Os.homedir();
  return homeDirectory ? pathWithTilde.replace(/^~(?=$|\/|\\)/, homeDirectory) : pathWithTilde;
}
export async function getFilePaths({ globPattern, rootPath }: { globPattern: string; rootPath: string }): Promise<string[]> {
  return new Promise((resolve, reject) => {
    glob(globPattern, { cwd: rootPath, nodir: true, absolute: true, strict: false }, function (err, files) {
      if (err) {
        return reject(err);
      }

      resolve(files);
    });
  });
}
