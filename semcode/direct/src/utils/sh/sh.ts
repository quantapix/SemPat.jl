import * as ChildProcess from 'child_process';
export function execShellScript(body: string, cmd = 'bash'): Promise<string> {
  const args = ['-c', body];
  const process = ChildProcess.spawn(cmd, args);
  return new Promise((resolve, reject) => {
    let output = '';
    const handleClose = (returnCode: number | Error) => {
      if (returnCode === 0) {
        resolve(output);
      } else {
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
        if (type === 'man') {
          formattedDocumentation = formatManOutput(formattedDocumentation);
        }
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
  if (indexNameBlock < 0 || indexBeforeFooter < 0) {
    return manOutput;
  }
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
