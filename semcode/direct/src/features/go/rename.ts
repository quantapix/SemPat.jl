import cp = require('child_process');
import * as qv from 'vscode';
import { getGoConfig } from './config';
import { Edit, FilePatch, getEditsFromUnifiedDiffStr, isDiffToolAvailable } from './diffUtils';
import { toolExecutionEnvironment } from './goEnv';
import { promptForMissingTool } from './goInstallTools';
import { outputChannel } from './goStatus';
import { byteOffsetAt, canonicalizeGOPATHPrefix, getBinPath } from './util';
import { killProcessTree } from './utils/processUtils';

export class GoRenameProvider implements qv.RenameProvider {
  public provideRenameEdits(document: qv.TextDocument, position: qv.Position, newName: string, token: qv.CancellationToken): Thenable<qv.WorkspaceEdit> {
    return qv.workspace.saveAll(false).then(() => {
      return this.doRename(document, position, newName, token);
    });
  }

  private doRename(document: qv.TextDocument, position: qv.Position, newName: string, token: qv.CancellationToken): Thenable<qv.WorkspaceEdit> {
    return new Promise<qv.WorkspaceEdit>((resolve, reject) => {
      const filename = canonicalizeGOPATHPrefix(document.fileName);
      const range = document.getWordRangeAtPosition(position);
      const pos = range ? range.start : position;
      const offset = byteOffsetAt(document, pos);
      const env = toolExecutionEnvironment();
      const gorename = getBinPath('gorename');
      const buildTags = getGoConfig(document.uri)['buildTags'];
      const gorenameArgs = ['-offset', filename + ':#' + offset, '-to', newName];
      if (buildTags) {
        gorenameArgs.push('-tags', buildTags);
      }
      const canRenameToolUseDiff = isDiffToolAvailable();
      if (canRenameToolUseDiff) {
        gorenameArgs.push('-d');
      }

      let p: cp.ChildProcess;
      if (token) {
        token.onCancellationRequested(() => killProcessTree(p));
      }

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
