import { ClientCap, ServiceClient, ServerResponse } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as path from 'path';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import FileConfigMgr from '../../old/ts/languageFeatures/fileConfigMgr';
import type * as qp from '../protocol';
import cp = require('child_process');
import { getGoConfig } from './config';
import { Edit, FilePatch, getEditsFromUnifiedDiffStr, isDiffToolAvailable } from './diffUtils';
import { toolExecutionEnvironment } from './goEnv';
import { promptForMissingTool } from './goInstallTools';
import { outputChannel } from './goStatus';
import { byteOffsetAt, canonicalizeGOPATHPrefix, getBinPath } from './util';
import { killProcTree } from './utils/processUtils';
export class GoRename implements qv.RenameProvider {
  public provideRenameEdits(d: qv.TextDocument, p: qv.Position, newName: string, t: qv.CancellationToken): Thenable<qv.WorkspaceEdit> {
    return qv.workspace.saveAll(false).then(() => {
      return this.doRename(d, p, newName, t);
    });
  }
  private doRename(d: qv.TextDocument, p: qv.Position, newName: string, t: qv.CancellationToken): Thenable<qv.WorkspaceEdit> {
    return new Promise<qv.WorkspaceEdit>((resolve, reject) => {
      const filename = canonicalizeGOPATHPrefix(d.fileName);
      const range = d.getWordRangeAtPosition(p);
      const pos = range ? range.start : p;
      const offset = byteOffsetAt(d, pos);
      const env = toolExecutionEnvironment();
      const gorename = getBinPath('gorename');
      const buildTags = getGoConfig(d.uri)['buildTags'];
      const gorenameArgs = ['-offset', filename + ':#' + offset, '-to', newName];
      if (buildTags) gorenameArgs.push('-tags', buildTags);
      const canRenameToolUseDiff = isDiffToolAvailable();
      if (canRenameToolUseDiff) gorenameArgs.push('-d');
      let p: cp.ChildProc;
      if (t) t.onCancellationRequested(() => killProcTree(p));
      p = cp.execFile(gorename, gorenameArgs, { env }, (err, stdout, stderr) => {
        try {
          if (err && (<any>err).code === 'ENOENT') {
            promptForMissingTool('gorename');
            return reject('Could not find gorename tool.');
          }
          if (err) {
            const errMsg = stderr ? 'Rename failed: ' + stderr.replace(/\n/g, ' ') : 'Rename failed';
            console.log(errMsg);
            outputChannel.appendLine(errMsg);
            outputChannel.show();
            return reject();
          }
          const result = new qv.WorkspaceEdit();
          if (canRenameToolUseDiff) {
            const filePatches = getEditsFromUnifiedDiffStr(stdout);
            filePatches.forEach((filePatch: FilePatch) => {
              const fileUri = qv.Uri.file(filePatch.fileName);
              filePatch.edits.forEach((edit: Edit) => {
                edit.applyUsingWorkspaceEdit(result, fileUri);
              });
            });
          }
          return resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}
class TsRename implements qv.RenameProvider {
  public constructor(private readonly client: ServiceClient, private readonly fileConfigMgr: FileConfigMgr) {}
  public async prepareRename(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Range | null> {
    if (this.client.apiVersion.lt(API.v310)) return null;
    const response = await this.execRename(d, p, t);
    if (response?.type !== 'response' || !response.body) return null;
    const renameInfo = response.body.info;
    if (!renameInfo.canRename) return Promise.reject<qv.Range>(renameInfo.localizedErrorMessage);
    return qu.Range.fromTextSpan(renameInfo.triggerSpan);
  }
  public async provideRenameEdits(d: qv.TextDocument, p: qv.Position, newName: string, t: qv.CancellationToken): Promise<qv.WorkspaceEdit | null> {
    const response = await this.execRename(d, p, t);
    if (!response || response.type !== 'response' || !response.body) return null;
    const renameInfo = response.body.info;
    if (!renameInfo.canRename) return Promise.reject<qv.WorkspaceEdit>(renameInfo.localizedErrorMessage);
    if (renameInfo.fileToRename) {
      const edits = await this.renameFile(renameInfo.fileToRename, newName, t);
      if (edits) return edits;
      else return Promise.reject<qv.WorkspaceEdit>('fileRenameFail');
    }
    return this.updateLocs(response.body.locs, newName);
  }
  public async execRename(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<ServerResponse.Response<qp.RenameResponse> | undefined> {
    const file = this.client.toOpenedFilePath(d);
    if (!file) return undefined;
    const args: qp.RenameRequestArgs = {
      ...qu.Position.toFileLocationRequestArgs(file, p),
      findInStrings: false,
      findInComments: false,
    };
    return this.client.interruptGetErr(() => {
      this.fileConfigMgr.ensureConfigForDocument(d, t);
      return this.client.execute('rename', args, t);
    });
  }
  private updateLocs(locations: ReadonlyArray<qp.SpanGroup>, newName: string) {
    const edit = new qv.WorkspaceEdit();
    for (const spanGroup of locations) {
      const resource = this.client.toResource(spanGroup.file);
      for (const textSpan of spanGroup.locs) {
        edit.replace(resource, qu.Range.fromTextSpan(textSpan), (textSpan.prefixText || '') + newName + (textSpan.suffixText || ''));
      }
    }
    return edit;
  }
  private async renameFile(fileToRename: string, newName: string, token: qv.CancellationToken): Promise<qv.WorkspaceEdit | undefined> {
    if (!path.extname(newName)) newName += path.extname(fileToRename);
    const dirname = path.dirname(fileToRename);
    const newFilePath = path.join(dirname, newName);
    const args: qp.GetEditsForFileRenameRequestArgs & { file: string } = {
      file: fileToRename,
      oldFilePath: fileToRename,
      newFilePath: newFilePath,
    };
    const response = await this.client.execute('getEditsForFileRename', args, token);
    if (response.type !== 'response' || !response.body) return undefined;
    const edits = qu.WorkspaceEdit.fromFileCodeEdits(this.client, response.body);
    edits.renameFile(qv.Uri.file(fileToRename), qv.Uri.file(newFilePath));
    return edits;
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient, fileConfigMgr: FileConfigMgr) {
  return condRegistration([requireSomeCap(c, ClientCap.Semantic)], () => {
    return qv.languages.registerRenameProvider(s.semantic, new TsRename(c, fileConfigMgr));
  });
}
