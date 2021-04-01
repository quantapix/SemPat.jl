import { AttachItem, ProcessListCommand } from '../pickProcess';

const secondColumnCharacters = 50;
const commColumnTitle = ''.padStart(secondColumnCharacters, 'a');

export const psLinuxCommand: ProcessListCommand = {
  command: 'ps',
  args: ['axww', '-o', `pid=,comm=${commColumnTitle},args=`],
};
export const psDarwinCommand: ProcessListCommand = {
  command: 'ps',
  args: ['axww', '-o', `pid=,comm=${commColumnTitle},args=`, '-c'],
};

export function parsePsProcesses(processes: string): AttachItem[] {
  const lines: string[] = processes.split('\n');
  return parseProcessesFromPsArray(lines);
}

function parseProcessesFromPsArray(processArray: string[]): AttachItem[] {
  const processEntries: AttachItem[] = [];

  // lines[0] is the header of the table
  for (let i = 1; i < processArray.length; i += 1) {
    const line = processArray[i];
    if (!line) {
      continue;
    }

    const processEntry = parseLineFromPs(line);
    if (processEntry) {
      processEntries.push(processEntry);
    }
  }

  return processEntries;
}

function parseLineFromPs(line: string): AttachItem | undefined {
  // Explanation of the regex:
  //   - any leading whitespace
  //   - PID
  //   - whitespace
  //   - executable name --> this is PsAttachItemsProvider.secondColumnCharacters - 1 because ps reserves one character
  //     for the whitespace separator
  //   - whitespace
  //   - args (might be empty)
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
    if (process.platform === 'linux') {
      attachItem.executable = `/proc/${pid}/exe`;
    }
    return attachItem;
  }
}
