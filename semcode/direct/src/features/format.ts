import { condRegistration, requireConfig } from '../registration';
import { ServiceClient } from '../service';
import * as qu from '../utils';
import * as qv from 'vscode';
import FileConfigMgr from './fileConfigMgr';
import type * as qp from '../protocol';
import cp = require('child_process');
import * as path from 'path';
import { getGoConfig } from '../../../../old/go/config';
import { toolExecutionEnvironment } from '../../../../old/go/goEnv';
import { promptForMissingTool, promptForUpdatingTool } from '../../../../old/go/goInstallTools';
import { getBinPath } from '../../../../old/go/util';
import { killProcTree } from './utils/processUtils';

class TsFormatting implements qv.DocumentRangeFormattingEditProvider, qv.OnTypeFormattingEditProvider {
  public constructor(private readonly client: ServiceClient, private readonly manager: FileConfigMgr) {}
  public async provideDocumentRangeFormattingEdits(d: qv.TextDocument, r: qv.Range, opts: qv.FormattingOptions, t: qv.CancellationToken): Promise<qv.TextEdit[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    await this.manager.ensureConfigOptions(d, opts, t);
    const xs = qu.Range.toFormattingRequestArgs(f, r);
    const y = await this.client.execute('format', xs, t);
    if (y.type !== 'response' || !y.body) return undefined;
    return y.body.map(qu.TextEdit.fromCodeEdit);
  }
  public async provideOnTypeFormattingEdits(d: qv.TextDocument, p: qv.Position, k: string, opts: qv.FormattingOptions, t: qv.CancellationToken): Promise<qv.TextEdit[]> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return [];
    await this.manager.ensureConfigOptions(d, opts, t);
    const xs: qp.FormatOnKeyRequestArgs = {
      ...qu.Position.toFileLocationRequestArgs(f, p),
      key: k,
    };
    const response = await this.client.execute('formatonkey', xs, t);
    if (response.type !== 'response' || !response.body) return [];
    const ys: qv.TextEdit[] = [];
    for (const b of response.body) {
      const e = qu.TextEdit.fromCodeEdit(b);
      const r = e.range;
      if (r.start.character === 0 && r.start.line === r.end.line && e.newText === '') {
        const x = d.lineAt(r.start.line).text;
        if (x.trim().length > 0 || x.length > r.end.character) ys.push(e);
      } else ys.push(e);
    }
    return ys;
  }
}
export function register(s: qu.DocumentSelector, modeId: string, c: ServiceClient, m: FileConfigMgr) {
  return condRegistration([requireConfig(modeId, 'format.enable')], () => {
    const p = new TsFormatting(c, m);
    return qv.Disposable.from(qv.languages.registerOnTypeFormattingEditProvider(s.syntax, p, ';', '}', '\n'), qv.languages.registerDocumentRangeFormattingEditProvider(s.syntax, p));
  });
}

export class GoFormatting implements qv.DocumentFormattingEditProvider {
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
