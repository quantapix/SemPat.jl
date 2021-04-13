import * as qv from 'vscode';
import { memoize } from '../utils';
import { Duration, timingStats } from './timing';
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
type LogLevel = 'Trace' | 'Info' | 'Error';
export class Logger {
  @memoize
  private get output(): qv.OutputChannel {
    return qv.window.createOutputChannel('channelName');
  }
  private data2String(data: any): string {
    if (data instanceof Error) {
      return data.stack || data.message;
    }
    if (data.success === false && data.message) {
      return data.message;
    }
    return data.toString();
  }
  public info(message: string, data?: any): void {
    this.logLevel('Info', message, data);
  }
  public error(message: string, data?: any): void {
    if (data && data.message === 'No content available.') {
      return;
    }
    this.logLevel('Error', message, data);
  }
  public logLevel(level: LogLevel, message: string, data?: any): void {
    this.output.appendLine(`[${level}  - ${this.now()}] ${message}`);
    if (data) {
      this.output.appendLine(this.data2String(data));
    }
  }
  private now(): string {
    const now = new Date();
    return padLeft(now.getUTCHours() + '', 2, '0') + ':' + padLeft(now.getMinutes() + '', 2, '0') + ':' + padLeft(now.getUTCSeconds() + '', 2, '0') + '.' + now.getMilliseconds();
  }
}
function padLeft(s: string, n: number, pad = ' ') {
  return pad.repeat(Math.max(0, n - s.length)) + s;
}
const durationThresholdForInfoInMs = 2000;
export class LogTracker {
  private _dummyState = new State();
  private _indentation = '';
  private _previousTitles: string[] = [];
  constructor(private _console: Console | undefined, private _prefix: string) {}
  log<T>(title: string, callback: (state: LogState) => T, minimalDuration = -1, logParsingPerf = false) {
    if (this._console === undefined) {
      return callback(this._dummyState);
    }
    const level = (this._console as any).level;
    if (level === undefined || (level !== LogLevel.Log && level !== LogLevel.Info)) {
      return callback(this._dummyState);
    }
    const current = this._indentation;
    this._previousTitles.push(`${current}${title} ...`);
    this._indentation += '  ';
    const state = new State();
    try {
      return callback(state);
    } finally {
      const msDuration = state.duration;
      this._indentation = current;
      if (this._previousTitles.length > 0 && (state.isSuppressed() || msDuration <= minimalDuration)) {
        this._previousTitles.pop();
      } else {
        this._printPreviousTitles();
        let output = `[${this._prefix}] ${this._indentation}${title}${state.get()} (${msDuration}ms)`;
        if (logParsingPerf && state.fileReadTotal + state.tokenizeTotal + state.parsingTotal + state.resolveImportsTotal + state.bindingTotal > 0) {
          output += ` [f:${state.fileReadTotal}, t:${state.tokenizeTotal}, p:${state.parsingTotal}, i:${state.resolveImportsTotal}, b:${state.bindingTotal}]`;
        }
        this._console.log(output);
        if (msDuration >= durationThresholdForInfoInMs) {
          this._console.info(`[${this._prefix}] Long operation: ${title} (${msDuration}ms)`);
        }
      }
    }
  }
  private _printPreviousTitles() {
    this._previousTitles.pop();
    if (this._previousTitles.length <= 0) {
      return;
    }
    for (const previousTitle of this._previousTitles) {
      this._console!.log(`[${this._prefix}] ${previousTitle}`);
    }
    this._previousTitles.length = 0;
  }
}
export interface LogState {
  add(addendum: string | undefined): void;
  suppress(): void;
}
class State {
  private _addendum: string | undefined;
  private _suppress: boolean | undefined;
  private _start = new Duration();
  private _startFile = timingStats.readFileTime.totalTime;
  private _startToken = timingStats.tokenizeFileTime.totalTime;
  private _startParse = timingStats.parseFileTime.totalTime;
  private _startImport = timingStats.resolveImportsTime.totalTime;
  private _startBind = timingStats.bindTime.totalTime;
  get duration() {
    return this._start.getDurationInMilliseconds();
  }
  get fileReadTotal() {
    return timingStats.readFileTime.totalTime - this._startFile;
  }
  get tokenizeTotal() {
    return timingStats.tokenizeFileTime.totalTime - this._startToken;
  }
  get parsingTotal() {
    return timingStats.parseFileTime.totalTime - this._startParse;
  }
  get resolveImportsTotal() {
    return timingStats.resolveImportsTime.totalTime - this._startImport;
  }
  get bindingTotal() {
    return timingStats.bindTime.totalTime - this._startBind;
  }
  add(addendum: string | undefined) {
    if (addendum) {
      this._addendum = addendum;
    }
  }
  get() {
    if (this._addendum) {
      return ` [${this._addendum}]`;
    }
    return '';
  }
  suppress() {
    this._suppress = true;
  }
  isSuppressed() {
    return !!this._suppress;
  }
}
