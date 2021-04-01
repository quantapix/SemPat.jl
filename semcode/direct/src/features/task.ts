import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as qv from 'vscode';
import * as nls from 'vscode-nls';
import { wait } from '../test/testUtils';
import { ITypeScriptServiceClient, ServerResponse } from '../service';
import { coalesce, flatten } from '../utils/arrays';
import { Disposable } from '../utils/dispose';
import { exists } from '../utils/fs';
import { isTsConfigFileName } from '../../old/ts/utils/languageDescription';
import { Lazy } from '../utils/lazy';
import { isImplicitProjectConfigFile } from '../../old/ts/utils/tsconfig';
import { TSConfig, TsConfigProvider } from './tsconfig';

const localize = nls.loadMessageBundle();

enum AutoDetect {
  on = 'on',
  off = 'off',
  build = 'build',
  watch = 'watch',
}

interface TypeScriptTaskDefinition extends qv.TaskDefinition {
  tsconfig: string;
  option?: string;
}

class TscTaskProvider extends Disposable implements qv.TaskProvider {
  private readonly projectInfoRequestTimeout = 2000;
  private readonly findConfigFilesTimeout = 5000;

  private autoDetect = AutoDetect.on;
  private readonly tsconfigProvider: TsConfigProvider;

  public constructor(private readonly client: Lazy<ITypeScriptServiceClient>) {
    super();
    this.tsconfigProvider = new TsConfigProvider();

    this._register(qv.workspace.onDidChangeConfiguration(this.onConfigurationChanged, this));
    this.onConfigurationChanged();
  }

  public async provideTasks(token: qv.CancellationToken): Promise<qv.Task[]> {
    const folders = qv.workspace.workspaceFolders;
    if (this.autoDetect === AutoDetect.off || !folders || !folders.length) {
      return [];
    }

    const configPaths: Set<string> = new Set();
    const tasks: qv.Task[] = [];
    for (const project of await this.getAllTsConfigs(token)) {
      if (!configPaths.has(project.fsPath)) {
        configPaths.add(project.fsPath);
        tasks.push(...(await this.getTasksForProject(project)));
      }
    }
    return tasks;
  }

  public async resolveTask(task: qv.Task): Promise<qv.Task | undefined> {
    const definition = <TypeScriptTaskDefinition>task.definition;
    if (/\\tsconfig.*\.json/.test(definition.tsconfig)) {
      qv.window.showWarningMessage(localize('badTsConfig', 'TypeScript Task in tasks.json contains "\\\\". TypeScript tasks tsconfig must use "/"'));
      return undefined;
    }

    const tsconfigPath = definition.tsconfig;
    if (!tsconfigPath) {
      return undefined;
    }

    if (task.scope === undefined || task.scope === qv.TaskScope.Global || task.scope === qv.TaskScope.Workspace) {
      return undefined;
    }
    const tsconfigUri = task.scope.uri.with({ path: task.scope.uri.path + '/' + tsconfigPath });
    const tsconfig: TSConfig = {
      uri: tsconfigUri,
      fsPath: tsconfigUri.fsPath,
      posixPath: tsconfigUri.path,
      workspaceFolder: task.scope,
    };
    return this.getTasksForProjectAndDefinition(tsconfig, definition);
  }

  private async getAllTsConfigs(token: qv.CancellationToken): Promise<TSConfig[]> {
    const configs = flatten(await Promise.all([this.getTsConfigForActiveFile(token), this.getTsConfigsInWorkspace(token)]));

    return Promise.all(configs.map(async (config) => ((await exists(config.uri)) ? config : undefined))).then(coalesce);
  }

  private async getTsConfigForActiveFile(token: qv.CancellationToken): Promise<TSConfig[]> {
    const editor = qv.window.activeTextEditor;
    if (editor) {
      if (isTsConfigFileName(editor.document.fileName)) {
        const uri = editor.document.uri;
        return [
          {
            uri,
            fsPath: uri.fsPath,
            posixPath: uri.path,
            workspaceFolder: qv.workspace.getWorkspaceFolder(uri),
          },
        ];
      }
    }

    const file = this.getActiveTypeScriptFile();
    if (!file) {
      return [];
    }

    const response = await Promise.race([
      this.client.value.execute('projectInfo', { file, needFileNameList: false }, token),
      new Promise<typeof ServerResponse.NoContent>((resolve) => setTimeout(() => resolve(ServerResponse.NoContent), this.projectInfoRequestTimeout)),
    ]);
    if (response.type !== 'response' || !response.body) {
      return [];
    }

    const { configFileName } = response.body;
    if (configFileName && !isImplicitProjectConfigFile(configFileName)) {
      const normalizedConfigPath = path.normalize(configFileName);
      const uri = qv.Uri.file(normalizedConfigPath);
      const folder = qv.workspace.getWorkspaceFolder(uri);
      return [
        {
          uri,
          fsPath: normalizedConfigPath,
          posixPath: uri.path,
          workspaceFolder: folder,
        },
      ];
    }

    return [];
  }

  private async getTsConfigsInWorkspace(token: qv.CancellationToken): Promise<TSConfig[]> {
    const getConfigsTimeout = new qv.CancellationTokenSource();
    token.onCancellationRequested(() => getConfigsTimeout.cancel());

    return Promise.race([
      this.tsconfigProvider.getConfigsForWorkspace(getConfigsTimeout.token).then((x) => Array.from(x)),
      wait(this.findConfigFilesTimeout).then(() => {
        getConfigsTimeout.cancel();
        return [];
      }),
    ]);
  }

  private static async getCommand(project: TSConfig): Promise<string> {
    if (project.workspaceFolder) {
      const localTsc = await TscTaskProvider.getLocalTscAtPath(path.dirname(project.fsPath));
      if (localTsc) {
        return localTsc;
      }

      const workspaceTsc = await TscTaskProvider.getLocalTscAtPath(project.workspaceFolder.uri.fsPath);
      if (workspaceTsc) {
        return workspaceTsc;
      }
    }

    return 'tsc';
  }

  private static async getLocalTscAtPath(folderPath: string): Promise<string | undefined> {
    const platform = process.platform;
    const bin = path.join(folderPath, 'node_modules', '.bin');
    if (platform === 'win32' && (await exists(qv.Uri.file(path.join(bin, 'tsc.cmd'))))) {
      return path.join(bin, 'tsc.cmd');
    } else if ((platform === 'linux' || platform === 'darwin') && (await exists(qv.Uri.file(path.join(bin, 'tsc'))))) {
      return path.join(bin, 'tsc');
    }
    return undefined;
  }

  private getActiveTypeScriptFile(): string | undefined {
    const editor = qv.window.activeTextEditor;
    if (editor) {
      const document = editor.document;
      if (document && (document.languageId === 'typescript' || document.languageId === 'typescriptreact')) {
        return this.client.value.toPath(document.uri);
      }
    }
    return undefined;
  }

  private getBuildTask(workspaceFolder: qv.WorkspaceFolder | undefined, label: string, command: string, args: string[], buildTaskidentifier: TypeScriptTaskDefinition): qv.Task {
    const buildTask = new qv.Task(buildTaskidentifier, workspaceFolder || qv.TaskScope.Workspace, localize('buildTscLabel', 'build - {0}', label), 'tsc', new qv.ShellExecution(command, args), '$tsc');
    buildTask.group = qv.TaskGroup.Build;
    buildTask.isBackground = false;
    return buildTask;
  }

  private getWatchTask(workspaceFolder: qv.WorkspaceFolder | undefined, label: string, command: string, args: string[], watchTaskidentifier: TypeScriptTaskDefinition) {
    const watchTask = new qv.Task(
      watchTaskidentifier,
      workspaceFolder || qv.TaskScope.Workspace,
      localize('buildAndWatchTscLabel', 'watch - {0}', label),
      'tsc',
      new qv.ShellExecution(command, [...args, '--watch']),
      '$tsc-watch'
    );
    watchTask.group = qv.TaskGroup.Build;
    watchTask.isBackground = true;
    return watchTask;
  }

  private async getTasksForProject(project: TSConfig): Promise<qv.Task[]> {
    const command = await TscTaskProvider.getCommand(project);
    const args = await this.getBuildShellArgs(project);
    const label = this.getLabelForTasks(project);

    const tasks: qv.Task[] = [];

    if (this.autoDetect === AutoDetect.build || this.autoDetect === AutoDetect.on) {
      tasks.push(this.getBuildTask(project.workspaceFolder, label, command, args, { type: 'typescript', tsconfig: label }));
    }

    if (this.autoDetect === AutoDetect.watch || this.autoDetect === AutoDetect.on) {
      tasks.push(this.getWatchTask(project.workspaceFolder, label, command, args, { type: 'typescript', tsconfig: label, option: 'watch' }));
    }

    return tasks;
  }

  private async getTasksForProjectAndDefinition(project: TSConfig, definition: TypeScriptTaskDefinition): Promise<qv.Task | undefined> {
    const command = await TscTaskProvider.getCommand(project);
    const args = await this.getBuildShellArgs(project);
    const label = this.getLabelForTasks(project);

    let task: qv.Task | undefined;

    if (definition.option === undefined) {
      task = this.getBuildTask(project.workspaceFolder, label, command, args, definition);
    } else if (definition.option === 'watch') {
      task = this.getWatchTask(project.workspaceFolder, label, command, args, definition);
    }

    return task;
  }

  private async getBuildShellArgs(project: TSConfig): Promise<Array<string>> {
    const defaultArgs = ['-p', project.fsPath];
    try {
      const bytes = await qv.workspace.fs.readFile(project.uri);
      const text = Buffer.from(bytes).toString('utf-8');
      const tsconfig = jsonc.parse(text);
      if (tsconfig?.references) {
        return ['-b', project.fsPath];
      }
    } catch {}
    return defaultArgs;
  }

  private getLabelForTasks(project: TSConfig): string {
    if (project.workspaceFolder) {
      const workspaceNormalizedUri = qv.Uri.file(path.normalize(project.workspaceFolder.uri.fsPath)); // Make sure the drive letter is lowercase
      return path.posix.relative(workspaceNormalizedUri.path, project.posixPath);
    }

    return project.posixPath;
  }

  private onConfigurationChanged(): void {
    const type = qv.workspace.getConfiguration('typescript.tsc').get<AutoDetect>('autoDetect');
    this.autoDetect = typeof type === 'undefined' ? AutoDetect.on : type;
  }
}

export function register(lazyClient: Lazy<ITypeScriptServiceClient>) {
  return qv.tasks.registerTaskProvider('typescript', new TscTaskProvider(lazyClient));
}
