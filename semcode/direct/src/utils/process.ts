import * as ChildProc from 'child_process';
import kill = require('tree-kill');
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
export function parsePsProces(processes: string): AttachItem[] {
  const lines: string[] = processes.split('\n');
  return parseProcesFromPsArray(lines);
}
function parseProcesFromPsArray(processArray: string[]): AttachItem[] {
  const processEntries: AttachItem[] = [];
  for (let i = 1; i < processArray.length; i += 1) {
    const line = processArray[i];
    if (!line) continue;
    const processEntry = parseLineFromPs(line);
    if (processEntry) processEntries.push(processEntry);
  }
  return processEntries;
}
function parseLineFromPs(line: string): AttachItem | undefined {
  const psEntry = new RegExp(`^\\s*([0-9]+)\\s+(.{${secondColumnCharacters - 1}})\\s+(.*)$`);
  const matches = psEntry.exec(line);
  if (matches?.length === 4) {
    const pid = matches[1].trim();
    const executable = matches[2].trim();
    const cmdline = matches[3].trim();
    const attachItem: AttachItem = {
      label: executable,
      description: pid,
      detail: cmdline,
      id: pid,
      processName: executable,
      commandLine: cmdline,
    };
    if (process.platform === 'linux') attachItem.executable = `/proc/${pid}/exe`;
    return attachItem;
  }
}
export function killProcTree(p: ChildProc, logger?: (...args: any[]) => void): Promise<void> {
  if (!logger) logger = console.log;
  if (!p || !p.pid || p.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    kill(p.pid, (err) => {
      if (err) logger(`Error killing process ${p.pid}: ${err}`);
      resolve();
    });
  });
}
export function killProc(p: ChildProc) {
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
const defaultEmptyEntry: AttachItem = {
  label: '',
  description: '',
  detail: '',
  id: '',
  processName: '',
  commandLine: '',
};
export const wmicCommand: ProcListCommand = {
  command: 'wmic',
  args: ['process', 'get', 'Name,ProcId,CommandLine,ExecutablePath', '/FORMAT:list'],
};
export function parseWmicProces(processes: string): AttachItem[] {
  const lines: string[] = processes.split('\r\n');
  const processEntries: AttachItem[] = [];
  let entry = { ...defaultEmptyEntry };
  for (const line of lines) {
    if (!line.length) continue;
    parseLineFromWmic(line, entry);
    if (line.lastIndexOf(wmicPidTitle, 0) === 0) {
      processEntries.push(entry);
      entry = { ...defaultEmptyEntry };
    }
  }
  return processEntries;
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
export const lsofDarwinCommand: ProcListCommand = {
  command: 'lsof',
  args: ['-Pnl', '-F', 'pn', '-d', 'txt'],
};
export function parseLsofProces(processes: string): AttachItem[] {
  const lines: string[] = processes.split('\n');
  return parseProcesFromLsofArray(lines);
}
function parseProcesFromLsofArray(processArray: string[], includesEnv?: boolean): AttachItem[] {
  const processEntries: AttachItem[] = [];
  let i = 0;
  while (i < processArray.length) {
    const line = processArray[i];
    i++;
    if (!line) continue;
    const out = line[0];
    const val = line.substr(1);
    if (out !== 'p') continue;
    const processEntry: AttachItem = { id: val, label: '' };
    while (i < processArray.length && processArray[i].length > 0 && processArray[i][0] !== 'p') {
      if (!processEntry.executable) {
        const file: {
          fd?: string;
          name?: string;
        } = parseFile(i, processArray);
        processEntry.executable = file.name;
      }
      i += 2;
    }
    if (processEntry) processEntries.push(processEntry);
  }
  return processEntries;
}
function parseFile(start: number, lines: string[]): { fd?: string; name?: string } {
  const file: {
    fd?: string;
    name?: string;
  } = {};
  for (let j = start; j < start + 2; j++) {
    const line = lines[j];
    if (!line) continue;
    const out = line[0];
    const val = line.substr(1);
    switch (out) {
      case 'f':
        file.fd = val;
        break;
      case 'n':
        file.name = val;
        break;
    }
  }
  return file;
}
export function execShellScript(body: string, cmd = 'bash'): Promise<string> {
  const args = ['-c', body];
  const process = ChildProc.spawn(cmd, args);
  return new Promise((resolve, reject) => {
    let output = '';
    const handleClose = (returnCode: number | Error) => {
      if (returnCode === 0) resolve(output);
      else {
        reject(`Failed to execute ${body}`);
      }
    };
    process.stdout.on('data', (buffer) => {
      output += buffer;
    });
    process.on('close', handleClose);
    process.on('error', handleClose);
  });
}
const WORDS_WITHOUT_DOCUMENTATION = new Set(['else', 'fi', 'then', 'esac', 'elif', 'done']);
export async function getShellDocumentationWithoutCache({ word }: { word: string }): Promise<string | null> {
  if (word.split(' ').length > 1) {
    throw new Error(`lookupDocumentation should be given a word, received "${word}"`);
  }
  if (WORDS_WITHOUT_DOCUMENTATION.has(word)) {
    return null;
  }
  const DOCUMENTATION_COMMANDS = [
    { type: 'help', command: `help ${word} | col -bx` },
    { type: 'man', command: `man ${word} | col -bx` },
  ];
  for (const { type, command } of DOCUMENTATION_COMMANDS) {
    try {
      const documentation = await execShellScript(command);
      if (documentation) {
        let formattedDocumentation = documentation.trim();
        if (type === 'man') formattedDocumentation = formatManOutput(formattedDocumentation);
        return formattedDocumentation;
      }
    } catch (error) {
      console.error(`getShellDocumentation failed for "${word}"`, { error });
    }
  }
  return null;
}
export function formatManOutput(manOutput: string): string {
  const indexNameBlock = manOutput.indexOf('NAME');
  const indexBeforeFooter = manOutput.lastIndexOf('\n');
  if (indexNameBlock < 0 || indexBeforeFooter < 0) return manOutput;
  const formattedManOutput = manOutput.slice(indexNameBlock, indexBeforeFooter);
  if (!formattedManOutput) {
    console.error(`formatManOutput failed`, {
      manOutput,
    });
    return manOutput;
  }
  return formattedManOutput;
}
export function memorize<T extends Function>(func: T): T {
  const cache = new Map();
  const returnFunc = async function (arg: any) {
    const cacheKey = JSON.stringify(arg);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const result = await func(arg);
    cache.set(cacheKey, result);
    return result;
  };
  return returnFunc as any;
}
export const getShellDocumentation = memorize(getShellDocumentationWithoutCache);
