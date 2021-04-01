import * as qv from 'vscode';
import * as nls from 'vscode-nls';
import { memoize } from './memoize';

const localize = nls.loadMessageBundle();

type LogLevel = 'Trace' | 'Info' | 'Error';

export class Logger {
  @memoize
  private get output(): qv.OutputChannel {
    return qv.window.createOutputChannel(localize('channelName', 'TypeScript'));
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
