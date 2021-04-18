import cp = require('child_process');
import * as path from 'path';
import * as qv from 'vscode';
import { getGoConfig } from '../../../old/go/config';
import { toolExecutionEnvironment } from '../../../old/go/goEnv';
import { promptForMissingTool } from '../../../old/go/goInstallTools';
import { byteOffsetAt, canonicalizeGOPATHPrefix, getBinPath, getWorkspaceFolderPath } from '../../../old/go/util';
import { envPath, getCurrentGoRoot } from './utils/pathUtils';
import { killProcTree } from './utils/processUtils';
interface GoListOutput {
  Dir: string;
  ImportPath: string;
  Root: string;
}
interface GuruImplementsRef {
  name: string;
  pos: string;
  kind: string;
}
interface GuruImplementsOutput {
  type: GuruImplementsRef;
  to: GuruImplementsRef[];
  to_method: GuruImplementsRef[];
  from: GuruImplementsRef[];
  fromptr: GuruImplementsRef[];
}
export class GoImplementationProvider implements qv.ImplementationProvider {
  public provideImplementation(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Thenable<qv.Definition> {
    const root = getWorkspaceFolderPath(d.uri);
    if (!root) {
      qv.window.showInformationMessage('Cannot find implementations when there is no workspace open.');
      return;
    }
    const goRuntimePath = getBinPath('go');
    if (!goRuntimePath) {
      qv.window.showErrorMessage(`Failed to run "go list" to get the scope to find implementations as the "go" binary cannot be found in either GOROOT(${getCurrentGoRoot()}) or PATH(${envPath})`);
      return;
    }
    return new Promise<qv.Definition>((resolve, reject) => {
      if (t.isCancellationRequested) return resolve(null);
      const env = toolExecutionEnvironment();
      const listProc = cp.execFile(goRuntimePath, ['list', '-e', '-json'], { cwd: root, env }, (err, stdout) => {
        if (err) return reject(err);
        const listOutput = <GoListOutput>JSON.parse(stdout.toString());
        const filename = canonicalizeGOPATHPrefix(d.fileName);
        const cwd = path.dirname(filename);
        const offset = byteOffsetAt(d, p);
        const goGuru = getBinPath('guru');
        const buildTags = getGoConfig(d.uri)['buildTags'];
        const args = buildTags ? ['-tags', buildTags] : [];
        if (listOutput.Root && listOutput.ImportPath) args.push('-scope', `${listOutput.ImportPath}/...`);
        args.push('-json', 'implements', `${filename}:#${offset.toString()}`);
        const guruProc = cp.execFile(goGuru, args, { env }, (guruErr, guruStdOut) => {
          if (guruErr && (<any>guruErr).code === 'ENOENT') {
            promptForMissingTool('guru');
            return resolve(null);
          }
          if (guruErr) return reject(guruErr);
          const guruOutput = <GuruImplementsOutput>JSON.parse(guruStdOut.toString());
          const results: qv.Location[] = [];
          const addResults = (list: GuruImplementsRef[]) => {
            list.forEach((ref: GuruImplementsRef) => {
              const match = /^(.*):(\d+):(\d+)/.exec(ref.pos);
              if (!match) return;
              const [, file, lineStartStr, colStartStr] = match;
              const referenceResource = qv.Uri.file(path.resolve(cwd, file));
              const range = new qv.Range(+lineStartStr - 1, +colStartStr - 1, +lineStartStr - 1, +colStartStr);
              results.push(new qv.Location(referenceResource, range));
            });
          };
          if (guruOutput.to_method) {
            addResults(guruOutput.to_method);
          } else if (guruOutput.to) {
            addResults(guruOutput.to);
          } else if (guruOutput.from) {
            addResults(guruOutput.from);
          } else if (guruOutput.fromptr) {
            addResults(guruOutput.fromptr);
          }
          return resolve(results);
        });
        t.onCancellationRequested(() => killProcTree(guruProc));
      });
      t.onCancellationRequested(() => killProcTree(listProc));
    });
  }
}
