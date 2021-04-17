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
export function parseEnvFile(p: string): { [k: string]: string } {
  const y: { [k: string]: string } = {};
  if (!p) return y;
  try {
    const x = stripBOM(fs.readFileSync(p, 'utf8'));
    x.split('\n').forEach((l) => {
      const r = l.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
      if (r !== null) {
        let v = r[2] || '';
        if (v.length > 0 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') v = v.replace(/\\n/gm, '\n');
        y[r[1]] = v.replace(/(^['"]|['"]$)/g, '');
      }
    });
    return y;
  } catch (e) {
    throw new Error(`Cannot load environment variables from file ${p}`);
  }
}
export function parseEnvFiles(ps: string[] | string): { [k: string]: string } {
  const ys = [];
  if (typeof ps === 'string') ys.push(parseEnvFile(ps));
  if (Array.isArray(ps)) {
    ps.forEach((p) => {
      ys.push(parseEnvFile(p));
    });
  }
  return Object.assign({}, ...ys);
}
function makeRandomHexString(len: number): string {
  const cs = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
  let y = '';
  for (let i = 0; i < len; i++) {
    y += cs[Math.floor(cs.length * Math.random())];
  }
  return y;
}
const getRootTempDir = (() => {
  let y: string | undefined;
  return () => {
    if (!y) {
      const n = `vscode-typescript${process.platform !== 'win32' && process.getuid ? process.getuid() : ''}`;
      y = path.join(os.tmpdir(), n);
    }
    if (!fs.existsSync(y)) fs.mkdirSync(y);
    return y;
  };
})();
export const getInstanceTempDir = (() => {
  let y: string | undefined;
  return () => {
    if (!y) y = path.join(getRootTempDir(), makeRandomHexString(20));
    if (!fs.existsSync(y)) fs.mkdirSync(y);
    return y;
  };
})();
export function getTempFile(pre: string): string {
  return path.join(getInstanceTempDir(), `${pre}-${makeRandomHexString(20)}.tmp`);
}
export const onCaseInsenitiveFileSystem = (() => {
  let y: boolean | undefined;
  return (): boolean => {
    if (typeof y === 'undefined') {
      if (process.platform === 'win32') y = true;
      else if (process.platform !== 'darwin') y = false;
      else {
        const t = getTempFile('typescript-case-check');
        fs.writeFileSync(t, '');
        y = fs.existsSync(t.toUpperCase());
      }
    }
    return y;
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
export function versionToString(v: PythonVersion): string {
  const maj = (v >> 8) & 0xff;
  const min = v & 0xff;
  return `${maj}.${min}`;
}
export function versionFromString(x: string): PythonVersion | undefined {
  const y = x.split('.');
  if (y.length < 2) return undefined;
  const maj = parseInt(y[0], 10);
  const min = parseInt(y[1], 10);
  return versionFromMajorMinor(maj, min);
}
export function versionFromMajorMinor(maj: number, min: number): PythonVersion | undefined {
  if (isNaN(maj) || isNaN(min)) return undefined;
  if (maj > 255 || min > 255) return undefined;
  const y = maj * 256 + min;
  if (PythonVersion[y] === undefined) return undefined;
  if (!is3x(y)) return undefined;
  return y;
}
export function is3x(v: PythonVersion): boolean {
  return v >> 8 === 3;
}
class ApiV0 {
  public constructor(public readonly onCompletionAccepted: qv.Event<qv.CompletionItem & { metadata?: any }>, private readonly _pluginMgr: PluginMgr) {}
  configurePlugin(id: string, cfg: {}): void {
    this._pluginMgr.setConfig(id, cfg);
  }
}
export interface Api {
  getAPI(v: 0): ApiV0 | undefined;
}
export function getExtensionApi(onCompletionAccepted: qv.Event<qv.CompletionItem>, m: PluginMgr): Api {
  return {
    getAPI(v) {
      if (v === 0) return new ApiV0(onCompletionAccepted, m);
      return undefined;
    },
  };
}
