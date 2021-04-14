import * as qv from 'vscode';
import { listPackages } from './import';
import { CancellationToken, CodeAction, CodeActionKind, Command } from 'vscode-languageserver';
import { Commands } from '../commands';
import { throwIfCancellationRequested } from '../utils/cancel';
import { AddMissingOptionalToParamAction, CreateTypeStubFileAction } from '../common/diagnostic';
import { Range } from '../common/textRange';
import { WorkspaceServiceInstance } from '../languageServerBase';
import { Localizer } from '../localization/localize';

export class GoCodeAction implements qv.CodeActionProvider {
  public provideCodeActions(d: qv.TextDocument, r: qv.Range, c: qv.CodeActionContext, t: qv.CancellationToken): Thenable<qv.Command[]> {
    const ps = c.diagnostics.map((d) => {
      if (d.message.indexOf('undefined: ') === 0) {
        const [, name] = /^undefined: (\S*)/.exec(d.message);
        return listPackages().then((ps) => {
          return ps
            .filter((p) => p === name || p.endsWith('/' + name))
            .map((p) => {
              return { title: 'import "' + p + '"', command: 'go.import.add', arguments: [{ importPath: p, from: 'codeAction' }] };
            });
        });
      }
      return [];
    });
    return Promise.all(ps).then((arrs) => {
      const xs: { [k: string]: any } = {};
      for (const es of arrs) {
        for (const e of es) {
          xs[e.title] = e;
        }
      }
      const ys = [];
      for (const k of Object.keys(xs).sort()) {
        ys.push(xs[k]);
      }
      return ys;
    });
  }
}

export class PyCodeAction {
  static async getCodeActionsForPosition(w: WorkspaceServiceInstance, path: string, r: Range, t: CancellationToken) {
    throwIfCancellationRequested(t);
    const ys: CodeAction[] = [];
    if (!w.disableLangServices) {
      const ds = await w.serviceInstance.getDiagsForRange(path, r, t);
      const stub = ds.find((d) => {
        const xs = d.getActions();
        return xs && xs.find((x) => x.action === Commands.createTypeStub);
      });
      if (stub) {
        const a = stub.getActions()!.find((x) => x.action === Commands.createTypeStub) as CreateTypeStubFileAction;
        if (a) {
          const y = CodeAction.create(
            Localizer.CodeAction.createTypeStubFor().format({ moduleName: a.moduleName }),
            Command.create(Localizer.CodeAction.createTypeStub(), Commands.createTypeStub, w.rootPath, a.moduleName, path),
            CodeActionKind.QuickFix
          );
          ys.push(y);
        }
      }
      const opt = ds.find((d) => {
        const xs = d.getActions();
        return xs && xs.find((x) => x.action === Commands.addMissingOptionalToParam);
      });
      if (opt) {
        const a = opt.getActions()!.find((x) => x.action === Commands.addMissingOptionalToParam) as AddMissingOptionalToParamAction;
        if (a) {
          const y = CodeAction.create(
            Localizer.CodeAction.addOptionalToAnnotation(),
            Command.create(Localizer.CodeAction.addOptionalToAnnotation(), Commands.addMissingOptionalToParam, a.offsetOfTypeNode),
            CodeActionKind.QuickFix
          );
          ys.push(y);
        }
      }
    }
    return ys;
  }
}
