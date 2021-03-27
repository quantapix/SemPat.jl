import * as fs from 'async-file';
import * as path from 'path';
import * as qv from 'vscode';
import * as packs from './packs';
import { inferJuliaNumThreads } from './utils';

class JuliaTaskProvider {
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
          new qv.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.test("${folder.name}")`], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }),
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
          new qv.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_test.jl'), folder.name], {
            env: { JULIA_NUM_THREADS: inferJuliaNumThreads() },
          }),
          ''
        );
        testTaskWithCoverage.group = qv.TaskGroup.Test;
        testTaskWithCoverage.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true };
        result.push(testTaskWithCoverage);

        // const livetestTask = new qv.Task({ type: 'julia', command: 'livetest' }, folder, `Run tests live (experimental)`, 'julia', new qv.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_liveunittesting.jl'), folder.name, qv.workspace.getConfiguration('julia').get('liveTestFile')], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }), '')
        // livetestTask.group = qv.TaskGroup.Test
        // livetestTask.presentationOptions = { echo: false, focus: false, panel: qv.TaskPanelKind.Dedicated, clear: true }
        // result.push(livetestTask)
      }

      const buildJuliaSysimage = new qv.Task(
        { type: 'julia', command: 'juliasysimagebuild' },
        folder,
        `Build custom sysimage for current environment (experimental)`,
        'julia',
        new qv.ProcessExecution(jlexepath, [
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
          new qv.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.build("${folder.name}")`]),
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
          new qv.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', 'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], resultfile="benchmark/results.json")', folder.name]),
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
          new qv.ProcessExecution(
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
      // TODO Let things crash and go to crash reporting
      return emptyTasks;
    }
  }

  resolveTask(task: qv.Task) {
    return undefined;
  }
}

export function activate(context: qv.ExtensionContext) {
  qv.workspace.registerTaskProvider('julia', new JuliaTaskProvider(context));
}
