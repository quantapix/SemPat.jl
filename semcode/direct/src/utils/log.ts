import * as qv from 'vscode';
import { memoize } from './base';
import * as debug from './debug';
export enum LogLevel {
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Log = 'log',
}
//type LogLevel = 'Trace' | 'Info' | 'Error';
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
    if (maxLevel === undefined) maxLevel = this._levelMap.get(LogLevel.Info)!;
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
    if (this._getNumericalLevel(l) > this._maxLevel) return;
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
export class Logger {
  @memoize
  private get output(): qv.OutputChannel {
    return qv.window.createOutputChannel('channelName');
  }
  private data2String(x: any): string {
    if (x instanceof Error) return x.stack || x.message;
    if (x.success === false && x.message) return x.message;
    return x.toString();
  }
  public info(m: string, x?: any): void {
    this.logLevel('Info', m, x);
  }
  public error(m: string, x?: any): void {
    if (x && x.message === 'No content available.') return;
    this.logLevel('Error', m, x);
  }
  public logLevel(l: LogLevel, m: string, x?: any): void {
    this.output.appendLine(`[${l}  - ${this.now()}] ${m}`);
    if (x) this.output.appendLine(this.data2String(x));
  }
  private now(): string {
    const d = new Date();
    return padLeft(d.getUTCHours() + '', 2, '0') + ':' + padLeft(d.getMinutes() + '', 2, '0') + ':' + padLeft(d.getUTCSeconds() + '', 2, '0') + '.' + d.getMilliseconds();
  }
}
function padLeft(s: string, n: number, pad = ' ') {
  return pad.repeat(Math.max(0, n - s.length)) + s;
}
const durationThresholdForInfoInMs = 2000;
export class LogTracker {
  private _dummy = new State();
  private _indent = '';
  private _prevs: string[] = [];
  constructor(private _console: Console | undefined, private _prefix: string) {}
  log<T>(title: string, f: (s: LogState) => T, minDuration = -1, perf = false) {
    if (this._console === undefined) return f(this._dummy);
    const l = (this._console as any).level;
    if (l === undefined || (l !== LogLevel.Log && l !== LogLevel.Info)) return f(this._dummy);
    const i = this._indent;
    this._prevs.push(`${i}${title} ...`);
    this._indent += '  ';
    const s = new State();
    try {
      return f(s);
    } finally {
      const d = s.duration;
      this._indent = i;
      if (this._prevs.length > 0 && (s.isSuppressed() || d <= minDuration)) this._prevs.pop();
      else {
        this._printPreviousTitles();
        let y = `[${this._prefix}] ${this._indent}${title}${s.get()} (${d}ms)`;
        if (perf && s.fileReadTotal + s.tokenizeTotal + s.parsingTotal + s.resolveImportsTotal + s.bindingTotal > 0)
          y += ` [f:${s.fileReadTotal}, t:${s.tokenizeTotal}, p:${s.parsingTotal}, i:${s.resolveImportsTotal}, b:${s.bindingTotal}]`;
        this._console.log(y);
        if (d >= durationThresholdForInfoInMs) this._console.info(`[${this._prefix}] Long operation: ${title} (${d}ms)`);
      }
    }
  }
  private _printPreviousTitles() {
    this._prevs.pop();
    if (this._prevs.length <= 0) return;
    for (const previousTitle of this._prevs) {
      this._console!.log(`[${this._prefix}] ${previousTitle}`);
    }
    this._prevs.length = 0;
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
    if (addendum) this._addendum = addendum;
  }
  get() {
    if (this._addendum) return ` [${this._addendum}]`;
    return '';
  }
  suppress() {
    this._suppress = true;
  }
  isSuppressed() {
    return !!this._suppress;
  }
}
export class Duration {
  private _start: number;
  constructor() {
    this._start = Date.now();
  }
  getDurationInMilliseconds() {
    return Date.now() - this._start;
  }
  getDurationInSeconds() {
    return this.getDurationInMilliseconds() / 1000;
  }
}
export class TimingStat {
  totalTime = 0;
  callCount = 0;
  isTiming = false;
  timeOp<T>(callback: () => T): T {
    this.callCount++;
    if (this.isTiming) return callback();
    else {
      this.isTiming = true;
      const duration = new Duration();
      const result = callback();
      this.totalTime += duration.getDurationInMilliseconds();
      this.isTiming = false;
      return result;
    }
  }
  subtractFromTime(callback: () => void) {
    if (this.isTiming) {
      this.isTiming = false;
      const duration = new Duration();
      callback();
      this.totalTime -= duration.getDurationInMilliseconds();
      this.isTiming = true;
    } else {
      callback();
    }
  }
  printTime(): string {
    const totalTimeInSec = this.totalTime / 1000;
    const roundedTime = Math.round(totalTimeInSec * 100) / 100;
    return roundedTime.toString() + 'sec';
  }
}
export class TimingStats {
  totalDuration = new Duration();
  findFilesTime = new TimingStat();
  readFileTime = new TimingStat();
  tokenizeFileTime = new TimingStat();
  parseFileTime = new TimingStat();
  resolveImportsTime = new TimingStat();
  cycleDetectionTime = new TimingStat();
  bindTime = new TimingStat();
  typeCheckerTime = new TimingStat();
  typeEvaluationTime = new TimingStat();
  printSummary(console: Console) {
    console.info(`Completed in ${this.totalDuration.getDurationInSeconds()}sec`);
  }
  printDetails(console: Console) {
    console.info('');
    console.info('Timing stats');
    console.info('Find Source Files:    ' + this.findFilesTime.printTime());
    console.info('Read Source Files:    ' + this.readFileTime.printTime());
    console.info('Tokenize:             ' + this.tokenizeFileTime.printTime());
    console.info('Parse:                ' + this.parseFileTime.printTime());
    console.info('Resolve Imports:      ' + this.resolveImportsTime.printTime());
    console.info('Bind:                 ' + this.bindTime.printTime());
    console.info('Check:                ' + this.typeCheckerTime.printTime());
    console.info('Detect Cycles:        ' + this.cycleDetectionTime.printTime());
  }
  getTotalDuration() {
    return this.totalDuration.getDurationInSeconds();
  }
}
export const timingStats = new TimingStats();
