import * as fs from 'async-file';
import * as path from 'path';
import * as vscode from 'vscode';
import * as packs from './packs';
import { inferJuliaNumThreads } from './utils';

class JuliaTaskProvider {
  constructor(private context: vscode.ExtensionContext) {}

  async provideTasks() {
    const emptyTasks: vscode.Task[] = [];
    const allTasks: vscode.Task[] = [];
    const folders = vscode.workspace.workspaceFolders;

    if (!folders) {
      return emptyTasks;
    }

    for (let i = 0; i < folders.length; i++) {
      const tasks = await this.provideJuliaTasksForFolder(folders[i]);
      allTasks.push(...tasks);
    }
    return allTasks;
  }

  async provideJuliaTasksForFolder(folder: vscode.WorkspaceFolder) {
    const emptyTasks: vscode.Task[] = [];
    if (folder.uri.scheme !== 'file') {
      return emptyTasks;
    }
    const rootPath = folder.uri.fsPath;
    try {
      const result: vscode.Task[] = [];
      const jlexepath = await packs.getJuliaExePath();
      const pkgenvpath = await packs.getAbsEnvPath();
      if (await fs.exists(path.join(rootPath, 'test', 'runtests.jl'))) {
        const testTask = new vscode.Task(
          { type: 'julia', command: 'test' },
          folder,
          `Run tests`,
          'julia',
          new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.test("${folder.name}")`], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }),
          ''
        );
        testTask.group = vscode.TaskGroup.Test;
        testTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        result.push(testTask);

        const testTaskWithCoverage = new vscode.Task(
          { type: 'julia', command: 'testcoverage' },
          folder,
          `Run tests with coverage`,
          'julia',
          new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_test.jl'), folder.name], {
            env: { JULIA_NUM_THREADS: inferJuliaNumThreads() },
          }),
          ''
        );
        testTaskWithCoverage.group = vscode.TaskGroup.Test;
        testTaskWithCoverage.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        result.push(testTaskWithCoverage);

        // const livetestTask = new vscode.Task({ type: 'julia', command: 'livetest' }, folder, `Run tests live (experimental)`, 'julia', new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_liveunittesting.jl'), folder.name, vscode.workspace.getConfiguration('julia').get('liveTestFile')], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }), '')
        // livetestTask.group = vscode.TaskGroup.Test
        // livetestTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true }
        // result.push(livetestTask)
      }

      const buildJuliaSysimage = new vscode.Task(
        { type: 'julia', command: 'juliasysimagebuild' },
        folder,
        `Build custom sysimage for current environment (experimental)`,
        'julia',
        new vscode.ProcessExecution(jlexepath, [
          '--color=yes',
          `--project=${path.join(this.context.extensionPath, 'scripts', 'environments', 'sysimagecompile')}`,
          '--startup-file=no',
          '--history-file=no',
          path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_compileenv.jl'),
          pkgenvpath,
        ]),
        ''
      );
      buildJuliaSysimage.group = vscode.TaskGroup.Build;
      buildJuliaSysimage.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
      result.push(buildJuliaSysimage);

      if (await fs.exists(path.join(rootPath, 'deps', 'build.jl'))) {
        const buildTask = new vscode.Task(
          { type: 'julia', command: 'build' },
          folder,
          `Run build`,
          'julia',
          new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.build("${folder.name}")`]),
          ''
        );
        buildTask.group = vscode.TaskGroup.Build;
        buildTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        result.push(buildTask);
      }

      if (await fs.exists(path.join(rootPath, 'benchmark', 'benchmarks.jl'))) {
        const benchmarkTask = new vscode.Task(
          { type: 'julia', command: 'benchmark' },
          folder,
          `Run benchmark`,
          'julia',
          new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', 'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], resultfile="benchmark/results.json")', folder.name]),
          ''
        );
        benchmarkTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        result.push(benchmarkTask);
      }

      if (await fs.exists(path.join(rootPath, 'docs', 'make.jl'))) {
        const buildTask = new vscode.Task(
          { type: 'julia', command: 'docbuild' },
          folder,
          `Build documentation`,
          'julia',
          new vscode.ProcessExecution(
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
        buildTask.group = vscode.TaskGroup.Build;
        buildTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        result.push(buildTask);
      }

      return result;
    } catch (e) {
      // TODO Let things crash and go to crash reporting
      return emptyTasks;
    }
  }

  resolveTask(task: vscode.Task) {
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext) {
  vscode.workspace.registerTaskProvider('julia', new JuliaTaskProvider(context));
}
