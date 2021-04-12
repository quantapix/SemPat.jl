import * as qv from 'vscode';
import { listPackages } from '../goImport';
import { CancellationToken, CodeAction, CodeActionKind, Command } from 'vscode-languageserver';
import { Commands } from '../commands/commands';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { AddMissingOptionalToParamAction, CreateTypeStubFileAction } from '../common/diagnostic';
import { Range } from '../common/textRange';
import { WorkspaceServiceInstance } from '../languageServerBase';
import { Localizer } from '../localization/localize';
export class GoCodeAction implements qv.CodeActionProvider {
  public provideCodeActions(document: qv.TextDocument, range: qv.Range, context: qv.CodeActionContext, token: qv.CancellationToken): Thenable<qv.Command[]> {
    const promises = context.diagnostics.map((diag) => {
      if (diag.message.indexOf('undefined: ') === 0) {
        const [, name] = /^undefined: (\S*)/.exec(diag.message);
        return listPackages().then((packages) => {
          const commands = packages
            .filter((pkg) => pkg === name || pkg.endsWith('/' + name))
            .map((pkg) => {
              return {
                title: 'import "' + pkg + '"',
                command: 'go.import.add',
                arguments: [{ importPath: pkg, from: 'codeAction' }],
              };
            });
          return commands;
        });
      }
      return [];
    });
    return Promise.all(promises).then((arrs) => {
      const results: { [key: string]: any } = {};
      for (const segment of arrs) {
        for (const item of segment) {
          results[item.title] = item;
        }
      }
      const ret = [];
      for (const title of Object.keys(results).sort()) {
        ret.push(results[title]);
      }
      return ret;
    });
  }
}
export class PyCodeAction {
  static async getCodeActionsForPosition(workspace: WorkspaceServiceInstance, filePath: string, range: Range, token: CancellationToken) {
    throwIfCancellationRequested(token);
    const codeActions: CodeAction[] = [];
    if (!workspace.disableLangServices) {
      const diags = await workspace.serviceInstance.getDiagsForRange(filePath, range, token);
      const typeStubDiag = diags.find((d) => {
        const actions = d.getActions();
        return actions && actions.find((a) => a.action === Commands.createTypeStub);
      });
      if (typeStubDiag) {
        const action = typeStubDiag.getActions()!.find((a) => a.action === Commands.createTypeStub) as CreateTypeStubFileAction;
        if (action) {
          const createTypeStubAction = CodeAction.create(
            Localizer.CodeAction.createTypeStubFor().format({ moduleName: action.moduleName }),
            Command.create(Localizer.CodeAction.createTypeStub(), Commands.createTypeStub, workspace.rootPath, action.moduleName, filePath),
            CodeActionKind.QuickFix
          );
          codeActions.push(createTypeStubAction);
        }
      }
      const addOptionalDiag = diags.find((d) => {
        const actions = d.getActions();
        return actions && actions.find((a) => a.action === Commands.addMissingOptionalToParam);
      });
      if (addOptionalDiag) {
        const action = addOptionalDiag.getActions()!.find((a) => a.action === Commands.addMissingOptionalToParam) as AddMissingOptionalToParamAction;
        if (action) {
          const addMissingOptionalAction = CodeAction.create(
            Localizer.CodeAction.addOptionalToAnnotation(),
            Command.create(Localizer.CodeAction.addOptionalToAnnotation(), Commands.addMissingOptionalToParam, action.offsetOfTypeNode),
            CodeActionKind.QuickFix
          );
          codeActions.push(addMissingOptionalAction);
        }
      }
    }
    return codeActions;
  }
}
