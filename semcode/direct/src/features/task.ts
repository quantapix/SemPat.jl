import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as qv from 'vscode';
import { wait } from '../test/testUtils';
import { ServiceClient, ServerResponse } from '../service';
import { coalesce, flatten } from '../utils/arrays';
import { Disposable } from '../utils';
import { exists } from '../utils/fs';
import { isTsConfigFileName } from '../../old/ts/utils/languageDescription';
import { Lazy } from '../utils/lazy';
import { isImplicitProjectConfigFile } from '../../old/ts/utils/tsconfig';
import { TSConfig, TsConfigProvider } from './tsconfig';
import * as fs from 'async-file';
import * as packs from '../../packs';
import { inferJuliaNumThreads } from '../../utils';

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
class TsTask extends Disposable implements qv.TaskProvider {
  private readonly projectInfoRequestTimeout = 2000;
  private readonly findConfigFilesTimeout = 5000;
  private autoDetect = AutoDetect.on;
  private readonly tsconfigProvider: TsConfigProvider;
  public constructor(private readonly client: Lazy<ServiceClient>) {
    super();
    this.tsconfigProvider = new TsConfigProvider();
    this._register(qv.workspace.onDidChangeConfig(this.onConfigChanged, this));
    this.onConfigChanged();
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
      qv.window.showWarningMessage('badTsConfig');
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
      const localTsc = await TsTask.getLocalTscAtPath(path.dirname(project.fsPath));
      if (localTsc) {
        return localTsc;
      }
      const workspaceTsc = await TsTask.getLocalTscAtPath(project.workspaceFolder.uri.fsPath);
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
    const buildTask = new qv.Task(buildTaskidentifier, workspaceFolder || qv.TaskScope.Workspace, 'buildTscLabel', 'tsc', new qv.ShellExecution(command, args), '$tsc');
    buildTask.group = qv.TaskGroup.Build;
    buildTask.isBackground = false;
    return buildTask;
  }
  private getWatchTask(workspaceFolder: qv.WorkspaceFolder | undefined, label: string, command: string, args: string[], watchTaskidentifier: TypeScriptTaskDefinition) {
    const watchTask = new qv.Task(watchTaskidentifier, workspaceFolder || qv.TaskScope.Workspace, 'buildAndWatchTscLabel', 'tsc', new qv.ShellExecution(command, [...args, '--watch']), '$tsc-watch');
    watchTask.group = qv.TaskGroup.Build;
    watchTask.isBackground = true;
    return watchTask;
  }
  private async getTasksForProject(project: TSConfig): Promise<qv.Task[]> {
    const command = await TsTask.getCommand(project);
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
    const command = await TsTask.getCommand(project);
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
  private onConfigChanged(): void {
    const type = qv.workspace.getConfig('typescript.tsc').get<AutoDetect>('autoDetect');
    this.autoDetect = typeof type === 'undefined' ? AutoDetect.on : type;
  }
}
export function register(lazyClient: Lazy<ServiceClient>) {
  return qv.tasks.registerTaskProvider('typescript', new TsTask(lazyClient));
}

class JlTask {
  constructor(private context: qv.ExtensionContext) {}
  async provideTasks() {
    const emptyTasks: qv.Task[] = [];
    const allTasks: qv.Task[] = [];
    const folders = qv.workspace.workspaceFolders;
    if (!folders) {
      return emptyTasks;
    }
    for (let i = 0; i < folders.length; i++) {
      const tasks = await this.provideJuliaTasksForFolder(folders[i]);
      allTasks.push(...tasks);
    }
    return allTasks;
  }
  async provideJuliaTasksForFolder(folder: qv.WorkspaceFolder) {
    const emptyTasks: qv.Task[] = [];
    if (folder.uri.scheme !== 'file') {
      return emptyTasks;
    }
    const rootPath = folder.uri.fsPath;
    try {
      const result: qv.Task[] = [];
      const jlexepath = await packs.getJuliaExePath();
      const pkgenvpath = await packs.getAbsEnvPath();
      if (await fs.exists(path.join(rootPath, 'test', 'runtests.jl'))) {
        const testTask = new qv.Task(
          { type: 'julia', command: 'test' },
          folder,
          `Run tests`,
          'julia',
          new qv.ProcExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.test("${folder.name}")`], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }),
          ''
        );
        testTask.group = qv.TaskGroup.Test;
        testTask.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true };
        result.push(testTask);
        const testTaskWithCoverage = new qv.Task(
          { type: 'julia', command: 'testcoverage' },
          folder,
          `Run tests with coverage`,
          'julia',
          new qv.ProcExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_test.jl'), folder.name], {
            env: { JULIA_NUM_THREADS: inferJuliaNumThreads() },
          }),
          ''
        );
        testTaskWithCoverage.group = qv.TaskGroup.Test;
        testTaskWithCoverage.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true };
        result.push(testTaskWithCoverage);
      }
      const buildJuliaSysimage = new qv.Task(
        { type: 'julia', command: 'juliasysimagebuild' },
        folder,
        `Build custom sysimage for current environment (experimental)`,
        'julia',
        new qv.ProcExecution(jlexepath, [
          '--color=yes',
          `--project=${path.join(this.context.extensionPath, 'scripts', 'environments', 'sysimagecompile')}`,
          '--startup-file=no',
          '--history-file=no',
          path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_compileenv.jl'),
          pkgenvpath,
        ]),
        ''
      );
      buildJuliaSysimage.group = qv.TaskGroup.Build;
      buildJuliaSysimage.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true };
      result.push(buildJuliaSysimage);
      if (await fs.exists(path.join(rootPath, 'deps', 'build.jl'))) {
        const buildTask = new qv.Task(
          { type: 'julia', command: 'build' },
          folder,
          `Run build`,
          'julia',
          new qv.ProcExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.build("${folder.name}")`]),
          ''
        );
        buildTask.group = qv.TaskGroup.Build;
        buildTask.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true };
        result.push(buildTask);
      }
      if (await fs.exists(path.join(rootPath, 'benchmark', 'benchmarks.jl'))) {
        const benchmarkTask = new qv.Task(
          { type: 'julia', command: 'benchmark' },
          folder,
          `Run benchmark`,
          'julia',
          new qv.ProcExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', 'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], resultfile="benchmark/results.json")', folder.name]),
          ''
        );
        benchmarkTask.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true };
        result.push(benchmarkTask);
      }
      if (await fs.exists(path.join(rootPath, 'docs', 'make.jl'))) {
        const buildTask = new qv.Task(
          { type: 'julia', command: 'docbuild' },
          folder,
          `Build documentation`,
          'julia',
          new qv.ProcExecution(
            jlexepath,
            [
              `--project=${pkgenvpath}`,
              '--color=yes',
              path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_docbuild.jl'),
              path.join(rootPath, 'docs', 'make.jl'),
              path.join(rootPath, 'docs', 'build', 'index.html'),
            ],
            { cwd: rootPath }
          ),
          ''
        );
        buildTask.group = qv.TaskGroup.Build;
        buildTask.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true };
        result.push(buildTask);
      }
      return result;
    } catch (e) {
      return emptyTasks;
    }
  }
  resolveTask(task: qv.Task) {
    return undefined;
  }
}
export function activate(context: qv.ExtensionContext) {
  qv.workspace.registerTaskProvider('julia', new JlTask(context));
}
