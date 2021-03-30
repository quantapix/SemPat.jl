import * as qv from 'vscode';
import * as nls from 'vscode-nls';
import { Command, CommandManager } from '../commands/commandManager';
import { ITypeScriptServiceClient } from '../../../src/service';
import API from '../utils/api';
import { isSupportedLanguageMode } from '../utils/languageModeIds';
import * as qu from '../utils/qu';

const localize = nls.loadMessageBundle();

class FileReferencesCommand implements Command {
  public static readonly context = 'tsSupportsFileReferences';
  public static readonly minVersion = API.v420;

  public readonly id = 'typescript.findAllFileReferences';

  public constructor(private readonly client: ITypeScriptServiceClient) {}

  public async execute(resource?: qv.Uri) {
    if (this.client.apiVersion.lt(FileReferencesCommand.minVersion)) {
      qv.window.showErrorMessage(localize('error.unsupportedVersion', 'Find file references failed. Requires TypeScript 4.2+.'));
      return;
    }

    if (!resource) {
      resource = qv.window.activeTextEditor?.document.uri;
    }

    if (!resource) {
      qv.window.showErrorMessage(localize('error.noResource', 'Find file references failed. No resource provided.'));
      return;
    }

    const document = await qv.workspace.openTextDocument(resource);
    if (!isSupportedLanguageMode(document)) {
      qv.window.showErrorMessage(localize('error.unsupportedLanguage', 'Find file references failed. Unsupported file type.'));
      return;
    }

    const openedFiledPath = this.client.toOpenedFilePath(document);
    if (!openedFiledPath) {
      qv.window.showErrorMessage(localize('error.unknownFile', 'Find file references failed. Unknown file type.'));
      return;
    }

    await qv.window.withProgress(
      {
        location: qv.ProgressLocation.Window,
        title: localize('progress.title', 'Finding file references'),
      },
      async (_progress, token) => {
        const response = await this.client.execute(
          'fileReferences',
          {
            file: openedFiledPath,
          },
          token
        );
        if (response.type !== 'response' || !response.body) {
          return;
        }

        const locations: qv.Location[] = response.body.refs.map((reference) => qu.Location.fromTextSpan(this.client.toResource(reference.file), reference));

        const config = qv.workspace.getConfiguration('references');
        const existingSetting = config.inspect<string>('preferredLocation');

        await config.update('preferredLocation', 'view');
        try {
          await qv.commands.executeCommand('editor.action.showReferences', resource, new qv.Position(0, 0), locations);
        } finally {
          await config.update('preferredLocation', existingSetting?.workspaceFolderValue ?? existingSetting?.workspaceValue);
        }
      }
    );
  }
}

export function register(client: ITypeScriptServiceClient, commandManager: CommandManager) {
  function updateContext() {
    qv.commands.executeCommand('setContext', FileReferencesCommand.context, client.apiVersion.gte(FileReferencesCommand.minVersion));
  }
  updateContext();

  commandManager.register(new FileReferencesCommand(client));
  return client.onTsServerStarted(() => updateContext());
}
