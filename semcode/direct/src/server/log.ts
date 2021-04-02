import * as fs from 'fs';
import * as path from 'path';
import * as qv from 'vscode';
import { memoize } from '../utils';
export interface LogDirProvider {
  getNewLogDir(): string | undefined;
}
export const noopLogDirProvider = new (class implements LogDirProvider {
  public getNewLogDir(): undefined {
    return undefined;
  }
})();
export class NodeLogDirProvider implements LogDirProvider {
  public constructor(private readonly context: qv.ExtensionContext) {}
  public getNewLogDir(): string | undefined {
    const root = this.logDir();
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
  private logDir(): string | undefined {
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
