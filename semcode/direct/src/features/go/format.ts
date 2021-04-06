import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from '../../../../old/go/config';
import { toolExecutionEnvironment } from '../../../../old/go/goEnv';
import { promptForMissingTool, promptForUpdatingTool } from '../../../../old/go/goInstallTools';
import { getBinPath } from '../../../../old/go/util';
import { killProcTree } from './utils/processUtils';
export class GoDocumentFormattingEditProvider implements qv.DocumentFormattingEditProvider {
  public provideDocumentFormattingEdits(document: qv.TextDocument, options: qv.FormattingOptions, token: qv.CancellationToken): qv.ProviderResult<qv.TextEdit[]> {
    if (qv.window.visibleTextEditors.every((e) => e.document.fileName !== document.fileName)) {
      return [];
    }
    const filename = document.fileName;
    const goConfig = getGoConfig(document.uri);
    const formatFlags = goConfig['formatFlags'].slice() || [];
    if (formatFlags.indexOf('-w') > -1) {
      formatFlags.splice(formatFlags.indexOf('-w'), 1);
    }
    const formatTool = getFormatTool(goConfig);
    if (formatTool === 'goimports' || formatTool === 'goreturns' || formatTool === 'gofumports') {
      formatFlags.push('-srcdir', filename);
    }
    if (formatTool === 'goformat' && formatFlags.length === 0 && options.insertSpaces) {
      formatFlags.push('-style=indent=' + options.tabSize);
    }
    return this.runFormatter(formatTool, formatFlags, document, token).then(
      (edits) => edits,
      (err) => {
        if (typeof err === 'string' && err.startsWith('flag provided but not defined: -srcdir')) {
          promptForUpdatingTool(formatTool);
          return Promise.resolve([]);
        }
        if (err) {
          console.log(err);
          return Promise.reject('Check the console in dev tools to find errors when formatting.');
        }
      }
    );
  }
  private runFormatter(formatTool: string, formatFlags: string[], document: qv.TextDocument, token: qv.CancellationToken): Thenable<qv.TextEdit[]> {
    const formatCommandBinPath = getBinPath(formatTool);
    return new Promise<qv.TextEdit[]>((resolve, reject) => {
      if (!path.isAbsolute(formatCommandBinPath)) {
        promptForMissingTool(formatTool);
        return reject();
      }
      const env = toolExecutionEnvironment();
      const cwd = path.dirname(document.fileName);
      let stdout = '';
      let stderr = '';
      const p = cp.spawn(formatCommandBinPath, formatFlags, { env, cwd });
      token.onCancellationRequested(() => !p.killed && killProcTree(p));
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (data) => (stdout += data));
      p.stderr.on('data', (data) => (stderr += data));
      p.on('error', (err) => {
        if (err && (<any>err).code === 'ENOENT') {
          promptForMissingTool(formatTool);
          return reject();
        }
      });
      p.on('close', (code) => {
        if (code !== 0) {
          return reject(stderr);
        }
        const fileStart = new qv.Position(0, 0);
        const fileEnd = document.lineAt(document.lineCount - 1).range.end;
        const textEdits: qv.TextEdit[] = [new qv.TextEdit(new qv.Range(fileStart, fileEnd), stdout)];
        return resolve(textEdits);
      });
      if (p.pid) {
        p.stdin.end(document.getText());
      }
    });
  }
}
export function usingCustomFormatTool(goConfig: { [key: string]: any }): boolean {
  const formatTool = getFormatTool(goConfig);
  switch (formatTool) {
    case 'goreturns':
      return false;
    case 'goimports':
      return false;
    case 'gofmt':
      return false;
    case 'gofumpt':
      return false;
    case 'gofumports':
      return false;
    default:
      return true;
  }
}
export function getFormatTool(goConfig: { [key: string]: any }): string {
  if (goConfig['formatTool'] === 'default') {
    return 'goimports';
  }
  return goConfig['formatTool'];
}
