import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { toolExecutionEnvironment } from './goEnv';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';
import { getBinPath, getCurrentGoPath, isVendorSupported } from './util';
import { envPath, fixDriveCasingInWindows, getCurrentGoRoot, getCurrentGoWorkspaceFromGOPATH } from './utils/pathUtils';

type GopkgsDone = (res: Map<string, PackageInfo>) => void;
interface Cache {
  entry: Map<string, PackageInfo>;
  lastHit: number;
}

export interface PackageInfo {
  name: string;
  isStd: boolean;
}

let gopkgsNotified = false;
let cacheTimeout = 5000;

const gopkgsSubscriptions: Map<string, GopkgsDone[]> = new Map<string, GopkgsDone[]>();
const gopkgsRunning: Set<string> = new Set<string>();

const allPkgsCache: Map<string, Cache> = new Map<string, Cache>();

const pkgRootDirs = new Map<string, string>();

function gopkgs(workDir?: string): Promise<Map<string, PackageInfo>> {
  const gopkgsBinPath = getBinPath('gopkgs');
  if (!path.isAbsolute(gopkgsBinPath)) {
    promptForMissingTool('gopkgs');
    return Promise.resolve(new Map<string, PackageInfo>());
  }

  const t0 = Date.now();
  return new Promise<Map<string, PackageInfo>>((resolve, reject) => {
    const args = ['-format', '{{.Name}};{{.ImportPath}};{{.Dir}}'];
    if (workDir) {
      args.push('-workDir', workDir);
    }

    const env = toolExecutionEnvironment();
    env['GOROOT'] = getCurrentGoRoot(); // https://github.com/golang/vscode-go/issues/294
    const cmd = cp.spawn(gopkgsBinPath, args, { env, cwd: workDir });
    const chunks: any[] = [];
    const errchunks: any[] = [];
    let err: any;
    cmd.stdout.on('data', (d) => chunks.push(d));
    cmd.stderr.on('data', (d) => errchunks.push(d));
    cmd.on('error', (e) => (err = e));
    cmd.on('close', () => {
      const pkgs = new Map<string, PackageInfo>();
      if (err && err.code === 'ENOENT') {
        return promptForMissingTool('gopkgs');
      }

      const errorMsg = errchunks.join('').trim() || (err && err.message);
      if (errorMsg) {
        if (errorMsg.startsWith('flag provided but not defined: -workDir')) {
          promptForUpdatingTool('gopkgs');
          // fallback to gopkgs without -workDir
          return gopkgs().then((result) => resolve(result));
        }

        console.log(`Running gopkgs failed with "${errorMsg}"\nCheck if you can run \`gopkgs -format {{.Name}};{{.ImportPath}}\` in a terminal successfully.`);
        return resolve(pkgs);
      }
      const goroot = getCurrentGoRoot();
      const output = chunks.join('');
      if (output.indexOf(';') === -1) {
        // User might be using the old gopkgs tool, prompt to update
        promptForUpdatingTool('gopkgs');
        output.split('\n').forEach((pkgPath) => {
          if (!pkgPath || !pkgPath.trim()) {
            return;
          }
          const index = pkgPath.lastIndexOf('/');
          const pkgName = index === -1 ? pkgPath : pkgPath.substr(index + 1);
          pkgs.set(pkgPath, {
            name: pkgName,
            isStd: !pkgPath.includes('.'),
          });
        });
        return resolve(pkgs);
      }
      output.split('\n').forEach((pkgDetail) => {
        if (!pkgDetail || !pkgDetail.trim() || pkgDetail.indexOf(';') === -1) {
          return;
        }
        const [pkgName, pkgPath, pkgDir] = pkgDetail.trim().split(';');
        pkgs.set(pkgPath, {
          name: pkgName,
          isStd: goroot === null ? false : pkgDir.startsWith(goroot),
        });
      });
      const timeTaken = Date.now() - t0;
      cacheTimeout = timeTaken > 5000 ? timeTaken : 5000;
      return resolve(pkgs);
    });
  });
}

function getAllPackagesNoCache(workDir: string): Promise<Map<string, PackageInfo>> {
  return new Promise<Map<string, PackageInfo>>((resolve, reject) => {
    // Use subscription style to guard costly/long running invocation
    const callback = (pkgMap: Map<string, PackageInfo>) => {
      resolve(pkgMap);
    };

    let subs = gopkgsSubscriptions.get(workDir);
    if (!subs) {
      subs = [];
      gopkgsSubscriptions.set(workDir, subs);
    }
    subs.push(callback);

    // Ensure only single gokpgs running
    if (!gopkgsRunning.has(workDir)) {
      gopkgsRunning.add(workDir);

      gopkgs(workDir).then((pkgMap) => {
        gopkgsRunning.delete(workDir);
        gopkgsSubscriptions.delete(workDir);
        subs.forEach((cb) => cb(pkgMap));
      });
    }
  });
}

/**
 * Runs gopkgs
 * @argument workDir. The workspace directory of the project.
 * @returns Map<string, string> mapping between package import path and package name
 */
export async function getAllPackages(workDir: string): Promise<Map<string, PackageInfo>> {
  const cache = allPkgsCache.get(workDir);
  const useCache = cache && new Date().getTime() - cache.lastHit < cacheTimeout;
  if (useCache) {
    cache.lastHit = new Date().getTime();
    return Promise.resolve(cache.entry);
  }

  const pkgs = await getAllPackagesNoCache(workDir);
  if (!pkgs || pkgs.size === 0) {
    if (!gopkgsNotified) {
      qv.window.showInformationMessage('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
      gopkgsNotified = true;
    }
  }
  allPkgsCache.set(workDir, {
    entry: pkgs,
    lastHit: new Date().getTime(),
  });
  return pkgs;
}

/**
 * Returns mapping of import path and package name for packages that can be imported
 * Possible to return empty if useCache options is used.
 * @param filePath. Used to determine the right relative path for vendor pkgs
 * @param useCache. Force to use cache
 * @returns Map<string, string> mapping between package import path and package name
 */
export function getImportablePackages(filePath: string, useCache = false): Promise<Map<string, PackageInfo>> {
  filePath = fixDriveCasingInWindows(filePath);
  const fileDirPath = path.dirname(filePath);

  let foundPkgRootDir = pkgRootDirs.get(fileDirPath);
  const workDir = foundPkgRootDir || fileDirPath;
  const cache = allPkgsCache.get(workDir);

  const getAllPackagesPromise: Promise<Map<string, PackageInfo>> = useCache && cache ? Promise.race([getAllPackages(workDir), cache.entry]) : getAllPackages(workDir);

  return Promise.all([isVendorSupported(), getAllPackagesPromise]).then(([vendorSupported, pkgs]) => {
    const pkgMap = new Map<string, PackageInfo>();
    if (!pkgs) {
      return pkgMap;
    }

    const currentWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), fileDirPath);
    pkgs.forEach((info, pkgPath) => {
      if (info.name === 'main') {
        return;
      }

      if (!vendorSupported || !currentWorkspace) {
        pkgMap.set(pkgPath, info);
        return;
      }

      if (!foundPkgRootDir) {
        // try to guess package root dir
        const vendorIndex = pkgPath.indexOf('/vendor/');
        if (vendorIndex !== -1) {
          foundPkgRootDir = path.join(currentWorkspace, pkgPath.substring(0, vendorIndex).replace('/', path.sep));
          pkgRootDirs.set(fileDirPath, foundPkgRootDir);
        }
      }

      const relativePkgPath = getRelativePackagePath(fileDirPath, currentWorkspace, pkgPath);
      if (!relativePkgPath) {
        return;
      }

      const allowToImport = isAllowToImportPackage(fileDirPath, currentWorkspace, relativePkgPath);
      if (allowToImport) {
        pkgMap.set(relativePkgPath, info);
      }
    });
    return pkgMap;
  });
}

/**
 * If given pkgPath is not vendor pkg, then the same pkgPath is returned
 * Else, the import path for the vendor pkg relative to given filePath is returned.
 */
function getRelativePackagePath(currentFileDirPath: string, currentWorkspace: string, pkgPath: string): string {
  let magicVendorString = '/vendor/';
  let vendorIndex = pkgPath.indexOf(magicVendorString);
  if (vendorIndex === -1) {
    magicVendorString = 'vendor/';
    if (pkgPath.startsWith(magicVendorString)) {
      vendorIndex = 0;
    }
  }
  // Check if current file and the vendor pkg belong to the same root project and not sub vendor
  // If yes, then vendor pkg can be replaced with its relative path to the "vendor" folder
  // If not, then the vendor pkg should not be allowed to be imported.
  if (vendorIndex > -1) {
    const rootProjectForVendorPkg = path.join(currentWorkspace, pkgPath.substr(0, vendorIndex));
    const relativePathForVendorPkg = pkgPath.substring(vendorIndex + magicVendorString.length);
    const subVendor = relativePathForVendorPkg.indexOf('/vendor/') !== -1;

    if (relativePathForVendorPkg && currentFileDirPath.startsWith(rootProjectForVendorPkg) && !subVendor) {
      return relativePathForVendorPkg;
    }
    return '';
  }

  return pkgPath;
}

const pkgToFolderMappingRegex = /ImportPath: (.*) FolderPath: (.*)/;
/**
 * Returns mapping between import paths and folder paths for all packages under given folder (vendor will be excluded)
 */
export function getNonVendorPackages(currentFolderPath: string, recursive = true): Promise<Map<string, string>> {
  const target = recursive ? './...' : '.'; // go list ./... excludes vendor dirs since 1.9
  return getImportPathToFolder([target], currentFolderPath);
}

export function getImportPathToFolder(targets: string[], cwd?: string): Promise<Map<string, string>> {
  const goRuntimePath = getBinPath('go');
  if (!goRuntimePath) {
    console.warn(`Failed to run "go list" to find packages as the "go" binary cannot be found in either GOROOT(${getCurrentGoRoot()}) PATH(${envPath})`);
    return;
  }

  return new Promise<Map<string, string>>((resolve, reject) => {
    const childProcess = cp.spawn(goRuntimePath, ['list', '-f', 'ImportPath: {{.ImportPath}} FolderPath: {{.Dir}}', ...targets], { cwd, env: toolExecutionEnvironment() });
    const chunks: any[] = [];
    childProcess.stdout.on('data', (stdout) => {
      chunks.push(stdout);
    });

    childProcess.on('close', async (status) => {
      const lines = chunks.join('').toString().split('\n');
      const result = new Map<string, string>();

      lines.forEach((line) => {
        const matches = line.match(pkgToFolderMappingRegex);
        if (!matches || matches.length !== 3) {
          return;
        }
        const [_, pkgPath, folderPath] = matches;
        if (!pkgPath) {
          return;
        }
        result.set(pkgPath, folderPath);
      });
      resolve(result);
    });
  });
}

// This will check whether it's regular package or internal package
// Regular package will always allowed
// Internal package only allowed if the package doing the import is within the
// tree rooted at the parent of "internal" directory
// see: https://golang.org/doc/go1.4#internalpackages
// see: https://golang.org/s/go14internal
function isAllowToImportPackage(toDirPath: string, currentWorkspace: string, pkgPath: string) {
  if (pkgPath.startsWith('internal/')) {
    return false;
  }

  const internalPkgFound = pkgPath.match(/\/internal\/|\/internal$/);
  if (internalPkgFound) {
    const rootProjectForInternalPkg = path.join(currentWorkspace, pkgPath.substr(0, internalPkgFound.index));
    return toDirPath.startsWith(rootProjectForInternalPkg + path.sep) || toDirPath === rootProjectForInternalPkg;
  }
  return true;
}
