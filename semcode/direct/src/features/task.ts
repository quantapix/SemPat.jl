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
interface TsTaskDefinition extends qv.TaskDefinition {
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
  public async provideTasks(t: qv.CancellationToken): Promise<qv.Task[]> {
    const fs = qv.workspace.workspaceFolders;
    if (this.autoDetect === AutoDetect.off || !fs || !fs.length) return [];
    const ps: Set<string> = new Set();
    const ys: qv.Task[] = [];
    for (const p of await this.getAllTsConfigs(t)) {
      if (!ps.has(p.fsPath)) {
        ps.add(p.fsPath);
        ys.push(...(await this.getTasksForProject(p)));
      }
    }
    return ys;
  }
  public async resolveTask(t: qv.Task): Promise<qv.Task | undefined> {
    const d = <TsTaskDefinition>t.definition;
    if (/\\tsconfig.*\.json/.test(d.tsconfig)) {
      qv.window.showWarningMessage('badTsConfig');
      return undefined;
    }
    const p = d.tsconfig;
    if (!p) return undefined;
    if (t.scope === undefined || t.scope === qv.TaskScope.Global || t.scope === qv.TaskScope.Workspace) return undefined;
    const r = t.scope.uri.with({ path: t.scope.uri.path + '/' + p });
    const c: TSConfig = { uri: r, fsPath: r.fsPath, posixPath: r.path, workspaceFolder: t.scope };
    return this.getTasksForProjectAndDefinition(c, d);
  }
  private async getAllTsConfigs(t: qv.CancellationToken): Promise<TSConfig[]> {
    const cs = flatten(await Promise.all([this.getTsConfigForActiveFile(t), this.getTsConfigsInWorkspace(t)]));
    return Promise.all(cs.map(async (c) => ((await exists(c.uri)) ? c : undefined))).then(coalesce);
  }
  private async getTsConfigForActiveFile(t: qv.CancellationToken): Promise<TSConfig[]> {
    const e = qv.window.activeTextEditor;
    if (e) {
      if (isTsConfigFileName(e.document.fileName)) {
        const r = e.document.uri;
        return [{ uri: r, fsPath: r.fsPath, posixPath: r.path, workspaceFolder: qv.workspace.getWorkspaceFolder(r) }];
      }
    }
    const file = this.getActiveTypeScriptFile();
    if (!file) return [];
    const x = await Promise.race([
      this.client.value.execute('projectInfo', { file, needFileNameList: false }, t),
      new Promise<typeof ServerResponse.NoContent>((res) => setTimeout(() => res(ServerResponse.NoContent), this.projectInfoRequestTimeout)),
    ]);
    if (x.type !== 'response' || !x.body) return [];
    const { configFileName } = x.body;
    if (configFileName && !isImplicitProjectConfigFile(configFileName)) {
      const p = path.normalize(configFileName);
      const r = qv.Uri.file(p);
      const f = qv.workspace.getWorkspaceFolder(r);
      return [{ uri: r, fsPath: p, posixPath: r.path, workspaceFolder: f }];
    }
    return [];
  }
  private async getTsConfigsInWorkspace(t: qv.CancellationToken): Promise<TSConfig[]> {
    const time = new qv.CancellationTokenSource();
    t.onCancellationRequested(() => time.cancel());
    return Promise.race([
      this.tsconfigProvider.getConfigsForWorkspace(time.token).then((x) => Array.from(x)),
      wait(this.findConfigFilesTimeout).then(() => {
        time.cancel();
        return [];
      }),
    ]);
  }
  private static async getCommand(c: TSConfig): Promise<string> {
    if (c.workspaceFolder) {
      const l = await TsTask.getLocalTscAtPath(path.dirname(c.fsPath));
      if (l) return l;
      const w = await TsTask.getLocalTscAtPath(c.workspaceFolder.uri.fsPath);
      if (w) return w;
    }
    return 'tsc';
  }
  private static async getLocalTscAtPath(x: string): Promise<string | undefined> {
    const p = process.platform;
    const bin = path.join(x, 'node_modules', '.bin');
    if (p === 'win32' && (await exists(qv.Uri.file(path.join(bin, 'tsc.cmd'))))) return path.join(bin, 'tsc.cmd');
    else if ((p === 'linux' || p === 'darwin') && (await exists(qv.Uri.file(path.join(bin, 'tsc'))))) return path.join(bin, 'tsc');
    return undefined;
  }
  private getActiveTypeScriptFile(): string | undefined {
    const e = qv.window.activeTextEditor;
    if (e) {
      const d = e.document;
      if (d && (d.languageId === 'typescript' || d.languageId === 'typescriptreact')) return this.client.value.toPath(d.uri);
    }
    return undefined;
  }
  private getBuildTask(workspaceFolder: qv.WorkspaceFolder | undefined, label: string, command: string, args: string[], buildTaskidentifier: TsTaskDefinition): qv.Task {
    const buildTask = new qv.Task(buildTaskidentifier, workspaceFolder || qv.TaskScope.Workspace, 'buildTscLabel', 'tsc', new qv.ShellExecution(command, args), '$tsc');
    buildTask.group = qv.TaskGroup.Build;
    buildTask.isBackground = false;
    return buildTask;
  }
  private getWatchTask(workspaceFolder: qv.WorkspaceFolder | undefined, label: string, command: string, args: string[], watchTaskidentifier: TsTaskDefinition) {
    const watchTask = new qv.Task(watchTaskidentifier, workspaceFolder || qv.TaskScope.Workspace, 'buildAndWatchTscLabel', 'tsc', new qv.ShellExecution(command, [...args, '--watch']), '$tsc-watch');
    watchTask.group = qv.TaskGroup.Build;
    watchTask.isBackground = true;
    return watchTask;
  }
  private async getTasksForProject(c: TSConfig): Promise<qv.Task[]> {
    const command = await TsTask.getCommand(c);
    const args = await this.getBuildShellArgs(c);
    const label = this.getLabelForTasks(c);
    const tasks: qv.Task[] = [];
    if (this.autoDetect === AutoDetect.build || this.autoDetect === AutoDetect.on) tasks.push(this.getBuildTask(c.workspaceFolder, label, command, args, { type: 'typescript', tsconfig: label }));
    if (this.autoDetect === AutoDetect.watch || this.autoDetect === AutoDetect.on)
      tasks.push(this.getWatchTask(c.workspaceFolder, label, command, args, { type: 'typescript', tsconfig: label, option: 'watch' }));
    return tasks;
  }
  private async getTasksForProjectAndDefinition(c: TSConfig, d: TsTaskDefinition): Promise<qv.Task | undefined> {
    const cmd = await TsTask.getCommand(c);
    const args = await this.getBuildShellArgs(c);
    const label = this.getLabelForTasks(c);
    let task: qv.Task | undefined;
    if (d.option === undefined) task = this.getBuildTask(c.workspaceFolder, label, cmd, args, d);
    else if (d.option === 'watch') task = this.getWatchTask(c.workspaceFolder, label, cmd, args, d);
    return task;
  }
  private async getBuildShellArgs(c: TSConfig): Promise<Array<string>> {
    const defaultArgs = ['-p', c.fsPath];
    try {
      const bytes = await qv.workspace.fs.readFile(c.uri);
      const text = Buffer.from(bytes).toString('utf-8');
      const tsconfig = jsonc.parse(text);
      if (tsconfig?.references) return ['-b', c.fsPath];
    } catch {}
    return defaultArgs;
  }
  private getLabelForTasks(c: TSConfig): string {
    if (c.workspaceFolder) {
      const w = qv.Uri.file(path.normalize(c.workspaceFolder.uri.fsPath)); // Make sure the drive letter is lowercase
      return path.posix.relative(w.path, c.posixPath);
    }
    return c.posixPath;
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
    if (!folders) return emptyTasks;
    for (let i = 0; i < folders.length; i++) {
      const tasks = await this.provideJuliaTasksForFolder(folders[i]);
      allTasks.push(...tasks);
    }
    return allTasks;
  }
  async provideJuliaTasksForFolder(folder: qv.WorkspaceFolder) {
    const emptyTasks: qv.Task[] = [];
    if (folder.uri.scheme !== 'file') return emptyTasks;
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
