import { ChildProcess } from 'child_process';
import { kill } from 'tree-kill';
import { AttachItem, ProcListCommand } from '../pickProc';

const secondColumnCharacters = 50;
const commColumnTitle = ''.padStart(secondColumnCharacters, 'a');
export const psLinuxCommand: ProcListCommand = {
  command: 'ps',
  args: ['axww', '-o', `pid=,comm=${commColumnTitle},args=`],
};
export const psDarwinCommand: ProcListCommand = {
  command: 'ps',
  args: ['axww', '-o', `pid=,comm=${commColumnTitle},args=`, '-c'],
};
export function parsePsProces(x: string): AttachItem[] {
  return parseProcesFromPsArray(x.split('\n'));
}
function parseProcesFromPsArray(xs: string[]): AttachItem[] {
  const ys: AttachItem[] = [];
  for (let i = 1; i < xs.length; i += 1) {
    const x = xs[i];
    if (!x) continue;
    const y = parseLineFromPs(x);
    if (y) ys.push(y);
  }
  return ys;
}
function parseLineFromPs(x: string): AttachItem | undefined {
  const psEntry = new RegExp(`^\\s*([0-9]+)\\s+(.{${secondColumnCharacters - 1}})\\s+(.*)$`);
  const ms = psEntry.exec(x);
  if (ms?.length === 4) {
    const id = ms[1].trim();
    const exe = ms[2].trim();
    const cmd = ms[3].trim();
    const y: AttachItem = { label: exe, description: id, detail: cmd, id: id, processName: exe, commandLine: cmd };
    if (process.platform === 'linux') y.executable = `/proc/${id}/exe`;
    return y;
  }
}
export function killProcTree(p: ChildProcess, log?: (...xs: any[]) => void): Promise<void> {
  if (!log) log = console.log;
  if (!p || !p.pid || p.exitCode !== null) return Promise.resolve();
  return new Promise((res) => {
    kill(p.pid, (err) => {
      if (err) log(`Error killing process ${p.pid}: ${err}`);
      res();
    });
  });
}
export function killProc(p: ChildProcess) {
  if (p && p.pid && p.exitCode === null) {
    try {
      p.kill();
    } catch (e) {
      console.log(`Error killing process ${p.pid}: ${e}`);
    }
  }
}
const wmicNameTitle = 'Name';
const wmicCommandLineTitle = 'CommandLine';
const wmicPidTitle = 'ProcId';
const wmicExecutableTitle = 'ExecutablePath';
const empty: AttachItem = { label: '', description: '', detail: '', id: '', processName: '', commandLine: '' };
export const wmicCommand: ProcListCommand = { command: 'wmic', args: ['process', 'get', 'Name,ProcId,CommandLine,ExecutablePath', '/FORMAT:list'] };
export function parseWmicProces(x: string): AttachItem[] {
  const ls: string[] = x.split('\r\n');
  const ys: AttachItem[] = [];
  let y = { ...empty };
  for (const l of ls) {
    if (!l.length) continue;
    parseLineFromWmic(l, y);
    if (l.lastIndexOf(wmicPidTitle, 0) === 0) {
      ys.push(y);
      y = { ...empty };
    }
  }
  return ys;
}
function parseLineFromWmic(line: string, item: AttachItem): AttachItem {
  const splitter = line.indexOf('=');
  const currentItem = item;
  if (splitter > 0) {
    const key = line.slice(0, splitter).trim();
    let value = line.slice(splitter + 1).trim();
    if (key === wmicNameTitle) {
      currentItem.label = value;
      currentItem.processName = value;
    } else if (key === wmicPidTitle) {
      currentItem.description = value;
      currentItem.id = value;
    } else if (key === wmicCommandLineTitle) {
      const dosDevicePrefix = '\\??\\';
      if (value.lastIndexOf(dosDevicePrefix, 0) === 0) {
        value = value.slice(dosDevicePrefix.length);
      }
      currentItem.detail = value;
      currentItem.commandLine = value;
    } else if (key === wmicExecutableTitle) {
      currentItem.executable = value;
    }
  }
  return currentItem;
}
export const lsofDarwinCommand: ProcListCommand = { command: 'lsof', args: ['-Pnl', '-F', 'pn', '-d', 'txt'] };
export function parseLsofProces(x: string): AttachItem[] {
  return parseProcesFromLsofArray(x.split('\n'));
}
function parseProcesFromLsofArray(xs: string[], _env?: boolean): AttachItem[] {
  const ys: AttachItem[] = [];
  let i = 0;
  while (i < xs.length) {
    const x = xs[i];
    i++;
    if (!x) continue;
    if (x[0] !== 'p') continue;
    const y: AttachItem = { id: x.substr(1), label: '' };
    while (i < xs.length && xs[i].length > 0 && xs[i][0] !== 'p') {
      if (!y.executable) {
        const file: { fd?: string; name?: string } = parseFile(i, xs);
        y.executable = file.name;
      }
      i += 2;
    }
    if (y) ys.push(y);
  }
  return ys;
}
function parseFile(start: number, xs: string[]): { fd?: string; name?: string } {
  const y: { fd?: string; name?: string } = {};
  for (let i = start; i < start + 2; i++) {
    const x = xs[i];
    if (!x) continue;
    const c = x[0];
    const n = x.substr(1);
    switch (c) {
      case 'f':
        y.fd = n;
        break;
      case 'n':
        y.name = n;
        break;
    }
  }
  return y;
}
export function execShellScript(x: string, cmd = 'bash'): Promise<string> {
  const args = ['-c', x];
  const process = ChildProcess.spawn(cmd, args);
  return new Promise((resolve, reject) => {
    let y = '';
    const handleClose = (e: number | Error) => {
      if (e === 0) resolve(y);
      else reject(`Failed to execute ${x}`);
    };
    process.stdout.on('data', (x) => {
      y += x;
    });
    process.on('close', handleClose);
    process.on('error', handleClose);
  });
}
const WORDS_WITHOUT_DOCUMENTATION = new Set(['else', 'fi', 'then', 'esac', 'elif', 'done']);
export async function getShellDocumentationWithoutCache({ word }: { word: string }): Promise<string | null> {
  if (word.split(' ').length > 1) throw new Error(`lookupDocumentation should be given a word, received "${word}"`);
  if (WORDS_WITHOUT_DOCUMENTATION.has(word)) return null;
  const DOCUMENTATION_COMMANDS = [
    { type: 'help', command: `help ${word} | col -bx` },
    { type: 'man', command: `man ${word} | col -bx` },
  ];
  for (const { type, command } of DOCUMENTATION_COMMANDS) {
    try {
      const d = await execShellScript(command);
      if (d) {
        let y = d.trim();
        if (type === 'man') y = formatManOutput(y);
        return y;
      }
    } catch (error) {
      console.error(`getShellDocumentation failed for "${word}"`, { error });
    }
  }
  return null;
}
export function formatManOutput(x: string): string {
  const i = x.indexOf('NAME');
  const j = x.lastIndexOf('\n');
  if (i < 0 || j < 0) return x;
  const y = x.slice(i, j);
  if (!y) {
    console.error(`formatManOutput failed`, { manOutput: x });
    return x;
  }
  return y;
}
export function memorize<F extends Function>(f: F): F {
  const m = new Map();
  const y = async function (x: any) {
    const k = JSON.stringify(x);
    if (m.has(k)) return m.get(k);
    const y = await f(x);
    m.set(k, y);
    return y;
  };
  return y as any;
}
export const getShellDocumentation = memorize(getShellDocumentationWithoutCache);
