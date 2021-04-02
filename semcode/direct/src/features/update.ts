import * as path from 'path';
import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ClientCap, ServiceClient } from '../service';
import API from '../utils/api';
import { Delayer } from '../utils/async';
import { nulToken } from '../utils/cancellation';
import { conditionalRegistration, requireSomeCap, requireMinVersion } from '../../../src/registration';
import { Disposable } from '../utils';
import * as fileSchemes from '../utils/fileSchemes';
import { doesResourceLookLikeATypeScriptFile } from '../utils/languageDescription';
import * as qu from '../utils/qu';
import FileConfigMgr from './fileConfigMgr';

const updateImportsOnFileMoveName = 'updateImportsOnFileMove.enabled';

async function isDir(resource: qv.Uri): Promise<boolean> {
  try {
    return (await qv.workspace.fs.stat(resource)).type === qv.FileType.Dir;
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

  public constructor(private readonly client: ServiceClient, private readonly fileConfigMgr: FileConfigMgr, private readonly _handles: (uri: qv.Uri) => Promise<boolean>) {
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

        const config = this.getConfig(newUri);
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
              title: 'renameProgress.title',
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

    const config = this.getConfig(newResources[0]);
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

  private getConfig(resource: qv.Uri) {
    return qv.workspace.getConfig(doesResourceLookLikeATypeScriptFile(resource) ? 'typescript' : 'javascript', resource);
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
      newResources.length === 1 ? 'prompt' : this.getConfirmMessage('promptMoreThanOne', newResources),
      {
        modal: true,
      },
      {
        title: 'reject.title',
        choice: Choice.Reject,
        isCloseAffordance: true,
      },
      {
        title: 'accept.title',
        choice: Choice.Accept,
      },
      {
        title: 'always.title',
        choice: Choice.Always,
      },
      {
        title: 'never.title',
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
        const config = this.getConfig(newResources[0]);
        config.update(updateImportsOnFileMoveName, UpdateImportsOnFileMoveSetting.Always, qv.ConfigTarget.Global);
        return true;
      }
      case Choice.Never: {
        const config = this.getConfig(newResources[0]);
        config.update(updateImportsOnFileMoveName, UpdateImportsOnFileMoveSetting.Never, qv.ConfigTarget.Global);
        return false;
      }
    }

    return false;
  }

  private async getJsTsFileBeingMoved(resource: qv.Uri): Promise<qv.Uri | undefined> {
    if (resource.scheme !== fileSchemes.file) {
      return undefined;
    }

    if (await isDir(resource)) {
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
      this.fileConfigMgr.setGlobalConfigFromDocument(document, nulToken);
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
        paths.push('moreFile');
      } else {
        paths.push('moreFiles');
      }
    }

    paths.push('');
    return paths.join('\n');
  }
}

export function register(client: ServiceClient, fileConfigMgr: FileConfigMgr, handles: (uri: qv.Uri) => Promise<boolean>) {
  return conditionalRegistration([requireMinVersion(client, UpdateImportsOnFileRenameHandler.minVersion), requireSomeCap(client, ClientCap.Semantic)], () => {
    return new UpdateImportsOnFileRenameHandler(client, fileConfigMgr, handles);
  });
}
