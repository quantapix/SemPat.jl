import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from '../../../../old/go/config';
import { toolExecutionEnvironment } from '../../../../old/go/goEnv';
import { promptForMissingTool } from '../../../../old/go/goInstallTools';
import { byteOffsetAt, canonicalizeGOPATHPrefix, getBinPath, getFileArchive } from '../../../../old/go/util';
import { killProcessTree } from './utils/processUtils';

export class GoReferenceProvider implements qv.ReferenceProvider {
  public provideReferences(document: qv.TextDocument, position: qv.Position, options: { includeDeclaration: boolean }, token: qv.CancellationToken): Thenable<qv.Location[]> {
    return this.doFindReferences(document, position, options, token);
  }

  private doFindReferences(document: qv.TextDocument, position: qv.Position, options: { includeDeclaration: boolean }, token: qv.CancellationToken): Thenable<qv.Location[]> {
    return new Promise<qv.Location[]>((resolve, reject) => {
      // get current word
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        return resolve([]);
      }

      const goGuru = getBinPath('guru');
      if (!path.isAbsolute(goGuru)) {
        promptForMissingTool('guru');
        return reject('Cannot find tool "guru" to find references.');
      }

      const filename = canonicalizeGOPATHPrefix(document.fileName);
      const cwd = path.dirname(filename);
      const offset = byteOffsetAt(document, wordRange.start);
      const env = toolExecutionEnvironment();
      const buildTags = getGoConfig(document.uri)['buildTags'];
      const args = buildTags ? ['-tags', buildTags] : [];
      args.push('-modified', 'referrers', `${filename}:#${offset.toString()}`);

      const process = cp.execFile(goGuru, args, { env }, (err, stdout, stderr) => {
        try {
          if (err && (<any>err).code === 'ENOENT') {
            promptForMissingTool('guru');
            return reject('Cannot find tool "guru" to find references.');
          }

          if (err && (<any>err).killed !== true) {
            return reject(`Error running guru: ${err.message || stderr}`);
          }

          const lines = stdout.toString().split('\n');
          const results: qv.Location[] = [];
          for (const line of lines) {
            const match = /^(.*):(\d+)\.(\d+)-(\d+)\.(\d+):/.exec(line);
            if (!match) {
              continue;
            }
            const [, file, lineStartStr, colStartStr, lineEndStr, colEndStr] = match;
            const referenceResource = qv.Uri.file(path.resolve(cwd, file));

            if (!options.includeDeclaration) {
              if (document.uri.fsPath === referenceResource.fsPath && position.line === Number(lineStartStr) - 1) {
                continue;
              }
            }

            const range = new qv.Range(+lineStartStr - 1, +colStartStr - 1, +lineEndStr - 1, +colEndStr);
            results.push(new qv.Location(referenceResource, range));
          }
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
      if (process.pid) {
        process.stdin.end(getFileArchive(document));
      }
      token.onCancellationRequested(() => killProcessTree(process));
    });
  }
}
