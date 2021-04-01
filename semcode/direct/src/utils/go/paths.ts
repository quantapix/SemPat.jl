import fs = require('fs');
import os = require('os');
import * as path from 'path';
import { promisify } from 'util';
import { logVerbose } from '../goLogging';
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
  if (useCache && binPathCache[toolName]) {
    return { binPath: binPathCache[toolName], why: 'cached' };
  }
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
  if (process.platform === 'win32') {
    return toolName + '.exe';
  }
  return toolName;
}
export function executableFileExists(filePath: string): boolean {
  let exists = true;
  try {
    exists = fs.statSync(filePath).isFile();
    if (exists) {
      fs.accessSync(filePath, fs.constants.F_OK | fs.constants.X_OK);
    }
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
    return (await stat(p)).isDirectory();
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
  if (!folderPath) {
    return;
  }
  const dirs = folderPath.toLowerCase().split(path.sep);
  const srcIdx = dirs.lastIndexOf('src');
  if (srcIdx > 0) {
    return folderPath.substr(0, dirs.slice(0, srcIdx).join(path.sep).length);
  }
}
export function getCurrentGoWorkspaceFromGOPATH(gopath: string, currentFileDirPath: string): string {
  if (!gopath) {
    return;
  }
  const workspaces: string[] = gopath.split(path.delimiter);
  let currentWorkspace = '';
  currentFileDirPath = fixDriveCasingInWindows(currentFileDirPath);
  for (const workspace of workspaces) {
    const possibleCurrentWorkspace = path.join(workspace, 'src');
    if (currentFileDirPath.startsWith(possibleCurrentWorkspace) || (process.platform === 'win32' && currentFileDirPath.toLowerCase().startsWith(possibleCurrentWorkspace.toLowerCase()))) {
      if (possibleCurrentWorkspace.length > currentWorkspace.length) {
        currentWorkspace = currentFileDirPath.substr(0, possibleCurrentWorkspace.length);
      }
    }
  }
  return currentWorkspace;
}
export function fixDriveCasingInWindows(pathToFix: string): string {
  return process.platform === 'win32' && pathToFix ? pathToFix.substr(0, 1).toUpperCase() + pathToFix.substr(1) : pathToFix;
}
export function getToolFromToolPath(toolPath: string): string | undefined {
  if (!toolPath) {
    return;
  }
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
