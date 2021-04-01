import * as path from 'path';
import * as qv from 'vscode';
import * as nls from 'vscode-nls';
import type * as qp from '../protocol';
import { ClientCapability, ITypeScriptServiceClient } from '../../../src/service';
import API from '../utils/api';
import { Delayer } from '../utils/async';
import { nulToken } from '../utils/cancellation';
import { conditionalRegistration, requireSomeCap, requireMinVersion } from '../../../src/registration';
import { Disposable } from '../utils/dispose';
import * as fileSchemes from '../utils/fileSchemes';
import { doesResourceLookLikeATypeScriptFile } from '../utils/languageDescription';
import * as qu from '../utils/qu';
import FileConfigurationManager from './fileConfigurationManager';

const localize = nls.loadMessageBundle();

const updateImportsOnFileMoveName = 'updateImportsOnFileMove.enabled';

async function isDirectory(resource: qv.Uri): Promise<boolean> {
  try {
    return (await qv.workspace.fs.stat(resource)).type === qv.FileType.Directory;
  } catch {
    return false;
  }
}

const enum UpdateImportsOnFileMoveSetting {
  Prompt = 'prompt',
  Always = 'always',
  Never = 'never',
}

interface RenameAction {
  readonly oldUri: qv.Uri;
  readonly newUri: qv.Uri;
  readonly newFilePath: string;
  readonly oldFilePath: string;
  readonly jsTsFileThatIsBeingMoved: qv.Uri;
}

class UpdateImportsOnFileRenameHandler extends Disposable {
  public static readonly minVersion = API.v300;

  private readonly _delayer = new Delayer(50);
  private readonly _pendingRenames = new Set<RenameAction>();

  public constructor(
    private readonly client: ITypeScriptServiceClient,
    private readonly fileConfigurationManager: FileConfigurationManager,
    private readonly _handles: (uri: qv.Uri) => Promise<boolean>
  ) {
    super();

    this._register(
      qv.workspace.onDidRenameFiles(async (e) => {
        const [{ newUri, oldUri }] = e.files;
        const newFilePath = this.client.toPath(newUri);
        if (!newFilePath) {
          return;
        }

        const oldFilePath = this.client.toPath(oldUri);
        if (!oldFilePath) {
          return;
        }

        const config = this.getConfiguration(newUri);
        const setting = config.get<UpdateImportsOnFileMoveSetting>(updateImportsOnFileMoveName);
        if (setting === UpdateImportsOnFileMoveSetting.Never) {
          return;
        }
        const jsTsFileThatIsBeingMoved = await this.getJsTsFileBeingMoved(newUri);
        if (!jsTsFileThatIsBeingMoved || !this.client.toPath(jsTsFileThatIsBeingMoved)) {
          return;
        }

        this._pendingRenames.add({ oldUri, newUri, newFilePath, oldFilePath, jsTsFileThatIsBeingMoved });

        this._delayer.trigger(() => {
          qv.window.withProgress(
            {
              location: qv.ProgressLocation.Window,
              title: localize('renameProgress.title', 'Checking for update of JS/TS imports'),
            },
            () => this.flushRenames()
          );
        });
      })
    );
  }

  private async flushRenames(): Promise<void> {
    const renames = Array.from(this._pendingRenames);
    this._pendingRenames.clear();
    for (const group of this.groupRenames(renames)) {
      const edits = new qv.WorkspaceEdit();
      const resourcesBeingRenamed: qv.Uri[] = [];

      for (const { oldUri, newUri, newFilePath, oldFilePath, jsTsFileThatIsBeingMoved } of group) {
        const document = await qv.workspace.openTextDocument(jsTsFileThatIsBeingMoved);

        this.client.bufferSyncSupport.closeResource(oldUri);
        this.client.bufferSyncSupport.openTextDocument(document);

        if (await this.withEditsForFileRename(edits, document, oldFilePath, newFilePath)) {
          resourcesBeingRenamed.push(newUri);
        }
      }

      if (edits.size) {
        if (await this.confirmActionWithUser(resourcesBeingRenamed)) {
          await qv.workspace.applyEdit(edits);
        }
      }
    }
  }

  private async confirmActionWithUser(newResources: readonly qv.Uri[]): Promise<boolean> {
    if (!newResources.length) {
      return false;
    }

    const config = this.getConfiguration(newResources[0]);
    const setting = config.get<UpdateImportsOnFileMoveSetting>(updateImportsOnFileMoveName);
    switch (setting) {
      case UpdateImportsOnFileMoveSetting.Always:
        return true;
      case UpdateImportsOnFileMoveSetting.Never:
        return false;
      case UpdateImportsOnFileMoveSetting.Prompt:
      default:
        return this.promptUser(newResources);
    }
  }

  private getConfiguration(resource: qv.Uri) {
    return qv.workspace.getConfiguration(doesResourceLookLikeATypeScriptFile(resource) ? 'typescript' : 'javascript', resource);
  }

  private async promptUser(newResources: readonly qv.Uri[]): Promise<boolean> {
    if (!newResources.length) {
      return false;
    }

    const enum Choice {
      None = 0,
      Accept = 1,
      Reject = 2,
      Always = 3,
      Never = 4,
    }

    interface Item extends qv.MessageItem {
      readonly choice: Choice;
    }

    const response = await qv.window.showInformationMessage<Item>(
      newResources.length === 1
        ? localize('prompt', "Update imports for '{0}'?", path.basename(newResources[0].fsPath))
        : this.getConfirmMessage(localize('promptMoreThanOne', 'Update imports for the following {0} files?', newResources.length), newResources),
      {
        modal: true,
      },
      {
        title: localize('reject.title', 'No'),
        choice: Choice.Reject,
        isCloseAffordance: true,
      },
      {
        title: localize('accept.title', 'Yes'),
        choice: Choice.Accept,
      },
      {
        title: localize('always.title', 'Always automatically update imports'),
        choice: Choice.Always,
      },
      {
        title: localize('never.title', 'Never automatically update imports'),
        choice: Choice.Never,
      }
    );

    if (!response) {
      return false;
    }

    switch (response.choice) {
      case Choice.Accept: {
        return true;
      }
      case Choice.Reject: {
        return false;
      }
      case Choice.Always: {
        const config = this.getConfiguration(newResources[0]);
        config.update(updateImportsOnFileMoveName, UpdateImportsOnFileMoveSetting.Always, qv.ConfigurationTarget.Global);
        return true;
      }
      case Choice.Never: {
        const config = this.getConfiguration(newResources[0]);
        config.update(updateImportsOnFileMoveName, UpdateImportsOnFileMoveSetting.Never, qv.ConfigurationTarget.Global);
        return false;
      }
    }

    return false;
  }

  private async getJsTsFileBeingMoved(resource: qv.Uri): Promise<qv.Uri | undefined> {
    if (resource.scheme !== fileSchemes.file) {
      return undefined;
    }

    if (await isDirectory(resource)) {
      const files = await qv.workspace.findFiles(
        {
          base: resource.fsPath,
          pattern: '**/*.{ts,tsx,js,jsx}',
        },
        '**/node_modules/**',
        1
      );
      return files[0];
    }

    return (await this._handles(resource)) ? resource : undefined;
  }

  private async withEditsForFileRename(edits: qv.WorkspaceEdit, document: qv.TextDocument, oldFilePath: string, newFilePath: string): Promise<boolean> {
    const response = await this.client.interruptGetErr(() => {
      this.fileConfigurationManager.setGlobalConfigurationFromDocument(document, nulToken);
      const args: qp.GetEditsForFileRenameRequestArgs = {
        oldFilePath,
        newFilePath,
      };
      return this.client.execute('getEditsForFileRename', args, nulToken);
    });
    if (response.type !== 'response' || !response.body.length) {
      return false;
    }

    qu.WorkspaceEdit.withFileCodeEdits(edits, this.client, response.body);
    return true;
  }

  private groupRenames(renames: Iterable<RenameAction>): Iterable<Iterable<RenameAction>> {
    const groups = new Map<string, Set<RenameAction>>();

    for (const rename of renames) {
      const key = `${this.client.getWorkspaceRootForResource(rename.jsTsFileThatIsBeingMoved)}@@@${doesResourceLookLikeATypeScriptFile(rename.jsTsFileThatIsBeingMoved)}`;
      if (!groups.has(key)) {
        groups.set(key, new Set());
      }
      groups.get(key)!.add(rename);
    }

    return groups.values();
  }

  private getConfirmMessage(start: string, resourcesToConfirm: readonly qv.Uri[]): string {
    const MAX_CONFIRM_FILES = 10;

    const paths = [start];
    paths.push('');
    paths.push(...resourcesToConfirm.slice(0, MAX_CONFIRM_FILES).map((r) => path.basename(r.fsPath)));

    if (resourcesToConfirm.length > MAX_CONFIRM_FILES) {
      if (resourcesToConfirm.length - MAX_CONFIRM_FILES === 1) {
        paths.push(localize('moreFile', '...1 additional file not shown'));
      } else {
        paths.push(localize('moreFiles', '...{0} additional files not shown', resourcesToConfirm.length - MAX_CONFIRM_FILES));
      }
    }

    paths.push('');
    return paths.join('\n');
  }
}

export function register(client: ITypeScriptServiceClient, fileConfigurationManager: FileConfigurationManager, handles: (uri: qv.Uri) => Promise<boolean>) {
  return conditionalRegistration([requireMinVersion(client, UpdateImportsOnFileRenameHandler.minVersion), requireSomeCap(client, ClientCapability.Semantic)], () => {
    return new UpdateImportsOnFileRenameHandler(client, fileConfigurationManager, handles);
  });
}
