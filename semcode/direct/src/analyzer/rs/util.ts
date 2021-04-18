import * as lc from 'vscode-languageclient';
import * as qv from 'vscode';
import { strict as nativeAssert } from 'assert';
import { spawnSync } from 'child_process';
import { inspect } from 'util';

export function assert(condition: boolean, explanation: string): asserts condition {
  try {
    nativeAssert(condition, explanation);
  } catch (err) {
    log.error(`Assertion failed:`, explanation);
    throw err;
  }
}

export const log = new (class {
  private enabled = true;
  private readonly output = qv.window.createOutputChannel('Rust Analyzer Client');

  setEnabled(yes: boolean): void {
    log.enabled = yes;
  }

  debug(...msg: [unknown, ...unknown[]]): void {
    if (!log.enabled) return;
    log.write('DEBUG', ...msg);
    log.output.toString();
  }

  info(...msg: [unknown, ...unknown[]]): void {
    log.write('INFO', ...msg);
  }

  warn(...msg: [unknown, ...unknown[]]): void {
    debugger;
    log.write('WARN', ...msg);
  }

  error(...msg: [unknown, ...unknown[]]): void {
    debugger;
    log.write('ERROR', ...msg);
    log.output.show(true);
  }

  private write(label: string, ...messageParts: unknown[]): void {
    const message = messageParts.map(log.stringify).join(' ');
    const dateTime = new Date().toLocaleString();
    log.output.appendLine(`${label} [${dateTime}]: ${message}`);
  }

  private stringify(val: unknown): string {
    if (typeof val === 'string') return val;
    return inspect(val, {
      colors: false,
      depth: 6, // heuristic
    });
  }
})();

export async function sendRequestWithRetry<TParam, TRet>(client: lc.LangClient, reqType: lc.RequestType<TParam, TRet, unknown>, param: TParam, token?: qv.CancellationToken): Promise<TRet> {
  for (const delay of [2, 4, 6, 8, 10, null]) {
    try {
      return await (token ? client.sendRequest(reqType, param, token) : client.sendRequest(reqType, param));
    } catch (error) {
      if (delay === null) {
        log.warn('LSP request timed out', { method: reqType.method, param, error });
        throw error;
      }

      if (error.code === lc.ErrorCodes.RequestCancelled) {
        throw error;
      }

      if (error.code !== lc.ErrorCodes.ContentModified) {
        log.warn('LSP request failed', { method: reqType.method, param, error });
        throw error;
      }

      await sleep(10 * (1 << delay));
    }
  }
  throw 'unreachable';
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RustDocument = qv.TextDocument & { languageId: 'rust' };
export type RustEditor = qv.TextEditor & { document: RustDocument };

export function isRustDocument(d: qv.TextDocument): d is RustDocument {
  return d.languageId === 'rust' && d.uri.scheme === 'file';
}

export function isRustEditor(editor: qv.TextEditor): editor is RustEditor {
  return isRustDocument(editor.document);
}

export function isValidExecutable(path: string): boolean {
  log.debug('Checking availability of a binary at', path);

  const res = spawnSync(path, ['--version'], { encoding: 'utf8' });

  const printOutput = res.error && (res.error as any).code !== 'ENOENT' ? log.warn : log.debug;
  printOutput(path, '--version:', res);

  return res.status === 0;
}

export function setContextValue(key: string, value: any): Thenable<void> {
  return qv.commands.executeCommand('setContext', key, value);
}

export function memoize<Ret, TThis, Param extends string>(func: (this: TThis, arg: Param) => Ret) {
  const cache = new Map<string, Ret>();

  return function (this: TThis, arg: Param) {
    const cached = cache.get(arg);
    if (cached) return cached;

    const result = func.call(this, arg);
    cache.set(arg, result);

    return result;
  };
}
