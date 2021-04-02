import * as debug from './debug';
export enum LogLevel {
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Log = 'log',
}
export interface Console {
  error: (m: string) => void;
  warn: (m: string) => void;
  info: (m: string) => void;
  log: (m: string) => void;
}
export class NullConsole implements Console {
  logCount = 0;
  infoCount = 0;
  warnCount = 0;
  errorCount = 0;
  log(m: string) {
    this.logCount++;
  }
  info(m: string) {
    this.infoCount++;
  }
  warn(m: string) {
    this.warnCount++;
  }
  error(m: string) {
    this.errorCount++;
  }
}
export class StdConsole implements Console {
  log(m: string) {
    console.info(m);
  }
  info(m: string) {
    console.info(m);
  }
  warn(m: string) {
    console.warn(m);
  }
  error(m: string) {
    console.error(m);
  }
}
export class ConsoleWithLog implements Console {
  private _levelMap: Map<string, number> = new Map([
    [LogLevel.Error, 0],
    [LogLevel.Warn, 1],
    [LogLevel.Info, 2],
    [LogLevel.Log, 3],
  ]);
  private _maxLevel = 2;
  constructor(private _console: Console) {}
  get level(): LogLevel {
    switch (this._maxLevel) {
      case 0:
        return LogLevel.Error;
      case 1:
        return LogLevel.Warn;
      case 2:
        return LogLevel.Info;
    }
    return LogLevel.Log;
  }
  set level(l: LogLevel) {
    let maxLevel = this._levelMap.get(l);
    if (maxLevel === undefined) {
      maxLevel = this._levelMap.get(LogLevel.Info)!;
    }
    this._maxLevel = maxLevel;
  }
  error(m: string) {
    this._log(LogLevel.Error, m);
  }
  warn(m: string) {
    this._log(LogLevel.Warn, m);
  }
  info(m: string) {
    this._log(LogLevel.Info, m);
  }
  log(m: string) {
    this._log(LogLevel.Log, m);
  }
  private _log(l: LogLevel, m: string): void {
    if (this._getNumericalLevel(l) > this._maxLevel) {
      return;
    }
    log(this._console, l, m);
  }
  private _getNumericalLevel(l: LogLevel): number {
    const numericLevel = this._levelMap.get(l);
    debug.assert(numericLevel !== undefined, 'Logger: unknown log level.');
    return numericLevel !== undefined ? numericLevel : 2;
  }
}
export function log(c: Console, l: LogLevel, m: string) {
  switch (l) {
    case LogLevel.Log:
      c.log(m);
      break;
    case LogLevel.Info:
      c.info(m);
      break;
    case LogLevel.Warn:
      c.warn(m);
      break;
    case LogLevel.Error:
      c.error(m);
      break;
    default:
      debug.fail(`${l} is not expected`);
  }
}
