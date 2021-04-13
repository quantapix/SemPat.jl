// You can generate this list by running `compgen -b` in a bash session
export const LIST = [
  '.',
  ':',
  '[',
  'alias',
  'bg',
  'bind',
  'break',
  'builtin',
  'caller',
  'cd',
  'command',
  'compgen',
  'compopt',
  'complete',
  'continue',
  'declare',
  'dirs',
  'disown',
  'echo',
  'enable',
  'eval',
  'exec',
  'exit',
  'export',
  'false',
  'fc',
  'fg',
  'getopts',
  'hash',
  'help',
  'history',
  'jobs',
  'kill',
  'let',
  'local',
  'logout',
  'popd',
  'printf',
  'pushd',
  'pwd',
  'read',
  'readonly',
  'return',
  'set',
  'shift',
  'shopt',
  'source',
  'suspend',
  'test',
  'times',
  'trap',
  'true',
  'type',
  'typeset',
  'ulimit',
  'umask',
  'unalias',
  'unset',
  'wait',
];

const SET = new Set(LIST);

export function isBuiltin(word: string): boolean {
  return SET.has(word);
}

export const LIST = ['!', '[[', ']]', '{', '}', 'case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'select', 'then', 'time', 'until', 'while'];

const SET = new Set(LIST);

export function isReservedWord(word: string): boolean {
  return SET.has(word);
}

export const DEFAULT_GLOB_PATTERN = '**/*@(.sh|.inc|.bash|.command)';
export function getExplainshellEndpoint(): string | null {
  const { EXPLAINSHELL_ENDPOINT } = process.env;
  return typeof EXPLAINSHELL_ENDPOINT === 'string' && EXPLAINSHELL_ENDPOINT.trim() !== '' ? EXPLAINSHELL_ENDPOINT : null;
}
export function getGlobPattern(): string {
  const { GLOB_PATTERN } = process.env;
  return typeof GLOB_PATTERN === 'string' && GLOB_PATTERN.trim() !== '' ? GLOB_PATTERN : DEFAULT_GLOB_PATTERN;
}
export function getHighlightParsingError(): boolean {
  const { HIGHLIGHT_PARSING_ERRORS } = process.env;
  return typeof HIGHLIGHT_PARSING_ERRORS !== 'undefined' ? HIGHLIGHT_PARSING_ERRORS === 'true' || HIGHLIGHT_PARSING_ERRORS === '1' : false;
}
