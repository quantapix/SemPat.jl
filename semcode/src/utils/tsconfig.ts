/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as qv from 'vscode';
import * as nls from 'vscode-nls';
import type * as qp from '../protocol';
import { ITypeScriptServiceClient, ServerResponse } from '../../../src/service';
import { nulToken } from '../utils/cancellation';
import { TypeScriptServiceConfiguration } from './configuration';

const localize = nls.loadMessageBundle();

export const enum ProjectType {
  TypeScript,
  JavaScript,
}

export function isImplicitProjectConfigFile(configFileName: string) {
  return configFileName.startsWith('/dev/null/');
}

export function inferredProjectCompilerOptions(projectType: ProjectType, serviceConfig: TypeScriptServiceConfiguration): qp.ExternalProjectCompilerOptions {
  const projectConfig: qp.ExternalProjectCompilerOptions = {
    module: 'commonjs' as qp.ModuleKind,
    target: 'es2016' as qp.ScriptTarget,
    jsx: 'preserve' as qp.JsxEmit,
  };

  if (serviceConfig.implictProjectConfiguration.checkJs) {
    projectConfig.checkJs = true;
    if (projectType === ProjectType.TypeScript) {
      projectConfig.allowJs = true;
    }
  }

  if (serviceConfig.implictProjectConfiguration.experimentalDecorators) {
    projectConfig.experimentalDecorators = true;
  }

  if (serviceConfig.implictProjectConfiguration.strictNullChecks) {
    projectConfig.strictNullChecks = true;
  }

  if (serviceConfig.implictProjectConfiguration.strictFunctionTypes) {
    projectConfig.strictFunctionTypes = true;
  }

  if (projectType === ProjectType.TypeScript) {
    projectConfig.sourceMap = true;
  }

  return projectConfig;
}

function inferredProjectConfigSnippet(projectType: ProjectType, config: TypeScriptServiceConfiguration) {
  const baseConfig = inferredProjectCompilerOptions(projectType, config);
  const compilerOptions = Object.keys(baseConfig).map((key) => `"${key}": ${JSON.stringify(baseConfig[key])}`);
  return new qv.SnippetString(`{
	"compilerOptions": {
		${compilerOptions.join(',\n\t\t')}$0
	},
	"exclude": [
		"node_modules",
		"**/node_modules/*"
	]
}`);
}

export async function openOrCreateConfig(projectType: ProjectType, rootPath: string, configuration: TypeScriptServiceConfiguration): Promise<qv.TextEditor | null> {
  const configFile = qv.Uri.file(path.join(rootPath, projectType === ProjectType.TypeScript ? 'tsconfig.json' : 'jsconfig.json'));
  const col = qv.window.activeTextEditor?.viewColumn;
  try {
    const doc = await qv.workspace.openTextDocument(configFile);
    return qv.window.showTextDocument(doc, col);
  } catch {
    const doc = await qv.workspace.openTextDocument(configFile.with({ scheme: 'untitled' }));
    const editor = await qv.window.showTextDocument(doc, col);
    if (editor.document.getText().length === 0) {
      await editor.insertSnippet(inferredProjectConfigSnippet(projectType, configuration));
    }
    return editor;
  }
}

export async function openProjectConfigOrPromptToCreate(projectType: ProjectType, client: ITypeScriptServiceClient, rootPath: string, configFileName: string): Promise<void> {
  if (!isImplicitProjectConfigFile(configFileName)) {
    const doc = await qv.workspace.openTextDocument(configFileName);
    qv.window.showTextDocument(doc, qv.window.activeTextEditor?.viewColumn);
    return;
  }

  const CreateConfigItem: qv.MessageItem = {
    title:
      projectType === ProjectType.TypeScript
        ? localize('typescript.configureTsconfigQuickPick', 'Configure tsconfig.json')
        : localize('typescript.configureJsconfigQuickPick', 'Configure jsconfig.json'),
  };

  const selected = await qv.window.showInformationMessage(
    projectType === ProjectType.TypeScript
      ? localize('typescript.noTypeScriptProjectConfig', 'File is not part of a TypeScript project. Click [here]({0}) to learn more.', 'https://go.microsoft.com/fwlink/?linkid=841896')
      : localize('typescript.noJavaScriptProjectConfig', 'File is not part of a JavaScript project Click [here]({0}) to learn more.', 'https://go.microsoft.com/fwlink/?linkid=759670'),
    CreateConfigItem
  );

  switch (selected) {
    case CreateConfigItem:
      openOrCreateConfig(projectType, rootPath, client.configuration);
      return;
  }
}

export async function openProjectConfigForFile(projectType: ProjectType, client: ITypeScriptServiceClient, resource: qv.Uri): Promise<void> {
  const rootPath = client.getWorkspaceRootForResource(resource);
  if (!rootPath) {
    qv.window.showInformationMessage(localize('typescript.projectConfigNoWorkspace', 'Please open a folder in VS Code to use a TypeScript or JavaScript project'));
    return;
  }

  const file = client.toPath(resource);
  // TSServer errors when 'projectInfo' is invoked on a non js/ts file
  if (!file || !(await client.toPath(resource))) {
    qv.window.showWarningMessage(localize('typescript.projectConfigUnsupportedFile', 'Could not determine TypeScript or JavaScript project. Unsupported file type'));
    return;
  }

  let res: ServerResponse.Response<protocol.ProjectInfoResponse> | undefined;
  try {
    res = await client.execute('projectInfo', { file, needFileNameList: false }, nulToken);
  } catch {
    // noop
  }

  if (res?.type !== 'response' || !res.body) {
    qv.window.showWarningMessage(localize('typescript.projectConfigCouldNotGetInfo', 'Could not determine TypeScript or JavaScript project'));
    return;
  }
  return openProjectConfigOrPromptToCreate(projectType, client, rootPath, res.body.configFileName);
}
