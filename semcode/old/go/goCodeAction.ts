import * as qv from 'vscode';
import { listPackages } from './goImport';

export class GoCodeActionProvider implements qv.CodeActionProvider {
  public provideCodeActions(
    document: qv.TextDocument,
    range: qv.Range,
    context: qv.CodeActionContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: qv.CancellationToken
  ): Thenable<qv.Command[]> {
    const promises = context.diagnostics.map((diag) => {
      // When a name is not found but could refer to a package, offer to add import
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
