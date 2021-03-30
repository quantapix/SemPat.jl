import * as fs from 'fs';
import * as path from 'path';
import * as qv from 'vscode';
import { ILogDirectoryProvider } from './logDirectoryProvider';
import { memoize } from '../utils/memoize';

export interface ILogDirectoryProvider {
  getNewLogDirectory(): string | undefined;
}

export const noopLogDirectoryProvider = new (class implements ILogDirectoryProvider {
  public getNewLogDirectory(): undefined {
    return undefined;
  }
})();

export class NodeLogDirectoryProvider implements ILogDirectoryProvider {
  public constructor(private readonly context: qv.ExtensionContext) {}

  public getNewLogDirectory(): string | undefined {
    const root = this.logDirectory();
    if (root) {
      try {
        return fs.mkdtempSync(path.join(root, `tsserver-log-`));
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  }

  @memoize
  private logDirectory(): string | undefined {
    try {
      const path = this.context.logPath;
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path);
      }
      return this.context.logPath;
    } catch {
      return undefined;
    }
  }
}
