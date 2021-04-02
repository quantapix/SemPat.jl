import { ClientCap, ServiceClient, ServerResponse } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as path from 'path';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import FileConfigMgr from '../../old/ts/languageFeatures/fileConfigMgr';
import type * as qp from '../protocol';

class TypeScriptRenameProvider implements qv.RenameProvider {
  public constructor(private readonly client: ServiceClient, private readonly fileConfigMgr: FileConfigMgr) {}

  public async prepareRename(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken): Promise<qv.Range | null> {
    if (this.client.apiVersion.lt(API.v310)) return null;
    const response = await this.execRename(document, position, token);
    if (response?.type !== 'response' || !response.body) return null;
    const renameInfo = response.body.info;
    if (!renameInfo.canRename) return Promise.reject<qv.Range>(renameInfo.localizedErrorMessage);
    return qu.Range.fromTextSpan(renameInfo.triggerSpan);
  }

  public async provideRenameEdits(document: qv.TextDocument, position: qv.Position, newName: string, token: qv.CancellationToken): Promise<qv.WorkspaceEdit | null> {
    const response = await this.execRename(document, position, token);
    if (!response || response.type !== 'response' || !response.body) return null;
    const renameInfo = response.body.info;
    if (!renameInfo.canRename) return Promise.reject<qv.WorkspaceEdit>(renameInfo.localizedErrorMessage);
    if (renameInfo.fileToRename) {
      const edits = await this.renameFile(renameInfo.fileToRename, newName, token);
      if (edits) return edits;
      else return Promise.reject<qv.WorkspaceEdit>('fileRenameFail');
    }
    return this.updateLocs(response.body.locs, newName);
  }

  public async execRename(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken): Promise<ServerResponse.Response<qp.RenameResponse> | undefined> {
    const file = this.client.toOpenedFilePath(document);
    if (!file) return undefined;
    const args: qp.RenameRequestArgs = {
      ...qu.Position.toFileLocationRequestArgs(file, position),
      findInStrings: false,
      findInComments: false,
    };
    return this.client.interruptGetErr(() => {
      this.fileConfigMgr.ensureConfigForDocument(document, token);
      return this.client.execute('rename', args, token);
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
    return qv.languages.registerRenameProvider(s.semantic, new TypeScriptRenameProvider(c, fileConfigMgr));
  });
}
