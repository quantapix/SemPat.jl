import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as qv from 'vscode';
import { PluginMgr } from './plugins';
export default class API {
  public static fromSimpleString(value: string): API {
    return new API(value, value, value);
  }
  public static readonly defaultVersion = API.fromSimpleString('1.0.0');
  public static readonly v420 = API.fromSimpleString('4.2.0');
  public static fromVersionString(versionString: string): API {
    let version = semver.valid(versionString);
    if (!version) return new API('invalidVersion', '1.0.0', '1.0.0');
    const index = versionString.indexOf('-');
    if (index >= 0) version = version.substr(0, index);
    return new API(versionString, version, versionString);
  }
  private constructor(public readonly displayName: string, public readonly version: string, public readonly fullVersionString: string) {}
  public eq(other: API): boolean {
    return semver.eq(this.version, other.version);
  }
  public gte(other: API): boolean {
    return semver.gte(this.version, other.version);
  }
  public lt(other: API): boolean {
    return !this.gte(other);
  }
}
export function isWindows() {
  return process.platform === 'win32';
}
function stripBOM(s: string): string {
  if (s && s[0] === '\uFEFF') s = s.substr(1);
  return s;
}
export function parseEnvFile(envFilePath: string): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  if (!envFilePath) return env;
  try {
    const buffer = stripBOM(fs.readFileSync(envFilePath, 'utf8'));
    buffer.split('\n').forEach((line) => {
      const r = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
      if (r !== null) {
        let value = r[2] || '';
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/\\n/gm, '\n');
        }
        env[r[1]] = value.replace(/(^['"]|['"]$)/g, '');
      }
    });
    return env;
  } catch (e) {
    throw new Error(`Cannot load environment variables from file ${envFilePath}`);
  }
}
export function parseEnvFiles(envFiles: string[] | string): { [key: string]: string } {
  const fileEnvs = [];
  if (typeof envFiles === 'string') fileEnvs.push(parseEnvFile(envFiles));
  if (Array.isArray(envFiles)) {
    envFiles.forEach((envFile) => {
      fileEnvs.push(parseEnvFile(envFile));
    });
  }
  return Object.assign({}, ...fileEnvs);
}
function makeRandomHexString(length: number): string {
  const chars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
  let result = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(chars.length * Math.random());
    result += chars[idx];
  }
  return result;
}
const getRootTempDir = (() => {
  let dir: string | undefined;
  return () => {
    if (!dir) {
      const filename = `vscode-typescript${process.platform !== 'win32' && process.getuid ? process.getuid() : ''}`;
      dir = path.join(os.tmpdir(), filename);
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    return dir;
  };
})();
export const getInstanceTempDir = (() => {
  let dir: string | undefined;
  return () => {
    if (!dir) dir = path.join(getRootTempDir(), makeRandomHexString(20));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    return dir;
  };
})();
export function getTempFile(prefix: string): string {
  return path.join(getInstanceTempDir(), `${prefix}-${makeRandomHexString(20)}.tmp`);
}
export const onCaseInsenitiveFileSystem = (() => {
  let value: boolean | undefined;
  return (): boolean => {
    if (typeof value === 'undefined') {
      if (process.platform === 'win32') value = true;
      else if (process.platform !== 'darwin') value = false;
      else {
        const temp = getTempFile('typescript-case-check');
        fs.writeFileSync(temp, '');
        value = fs.existsSync(temp.toUpperCase());
      }
    }
    return value;
  };
})();
export enum PythonVersion {
  V3_0 = 0x0300,
  V3_1 = 0x0301,
  V3_2 = 0x0302,
  V3_3 = 0x0303,
  V3_4 = 0x0304,
  V3_5 = 0x0305,
  V3_6 = 0x0306,
  V3_7 = 0x0307,
  V3_8 = 0x0308,
  V3_9 = 0x0309,
  V3_10 = 0x030a,
}
export const latestStablePythonVersion = PythonVersion.V3_9;
export const latestPythonVersion = PythonVersion.V3_9;
export function versionToString(version: PythonVersion): string {
  const majorVersion = (version >> 8) & 0xff;
  const minorVersion = version & 0xff;
  return `${majorVersion}.${minorVersion}`;
}
export function versionFromString(verString: string): PythonVersion | undefined {
  const split = verString.split('.');
  if (split.length < 2) return undefined;
  const majorVersion = parseInt(split[0], 10);
  const minorVersion = parseInt(split[1], 10);
  return versionFromMajorMinor(majorVersion, minorVersion);
}
export function versionFromMajorMinor(major: number, minor: number): PythonVersion | undefined {
  if (isNaN(major) || isNaN(minor)) {
    return undefined;
  }
  if (major > 255 || minor > 255) return undefined;
  const value = major * 256 + minor;
  if (PythonVersion[value] === undefined) return undefined;
  if (!is3x(value)) {
    return undefined;
  }
  return value;
}
export function is3x(version: PythonVersion): boolean {
  return version >> 8 === 3;
}
class ApiV0 {
  public constructor(public readonly onCompletionAccepted: qv.Event<qv.CompletionItem & { metadata?: any }>, private readonly _pluginMgr: PluginMgr) {}
  configurePlugin(pluginId: string, configuration: {}): void {
    this._pluginMgr.setConfig(pluginId, configuration);
  }
}
export interface Api {
  getAPI(version: 0): ApiV0 | undefined;
}
export function getExtensionApi(onCompletionAccepted: qv.Event<qv.CompletionItem>, pluginMgr: PluginMgr): Api {
  return {
    getAPI(version) {
      if (version === 0) return new ApiV0(onCompletionAccepted, pluginMgr);
      return undefined;
    },
  };
}
