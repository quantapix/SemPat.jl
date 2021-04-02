import { Console, LogLevel } from './console';
import { Duration, timingStats } from './timing';
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
