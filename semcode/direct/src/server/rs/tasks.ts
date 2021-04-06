import { Disposable, ShellExecution, Task, TaskGroup, TaskProvider, tasks, workspace, WorkspaceFolder } from 'vscode';
const TASK_SOURCE = 'Rust';
const TASK_TYPE = 'cargo';
export interface Execution {
  command?: string;
  args: string[];
  env?: { [key: string]: string };
  cwd?: string;
}
function createShellExecution(execution: Execution): ShellExecution {
  const { command, args, cwd, env } = execution;
  const cmdLine = `${command} ${args.join(' ')}`;
  return new ShellExecution(cmdLine, { cwd, env });
}
export function activateTaskProvider(target: WorkspaceFolder): Disposable {
  const provider: TaskProvider = {
    provideTasks: () => detectCargoTasks(target),
    resolveTask: () => undefined,
  };
  return tasks.registerTaskProvider(TASK_TYPE, provider);
}
function detectCargoTasks(target: WorkspaceFolder): Task[] {
  return [
    { subcommand: 'build', group: TaskGroup.Build },
    { subcommand: 'check', group: TaskGroup.Build },
    { subcommand: 'test', group: TaskGroup.Test },
    { subcommand: 'clean', group: TaskGroup.Clean },
    { subcommand: 'run', group: undefined },
  ]
    .map(({ subcommand, group }) => ({
      definition: { subcommand, type: TASK_TYPE },
      label: `cargo ${subcommand} - ${target.name}`,
      execution: createShellExecution({
        command: 'cargo',
        args: [subcommand],
        cwd: target.uri.fsPath,
      }),
      group,
      problemMatchers: ['$rustc'],
    }))
    .map((task) => {
      const vscodeTask = new Task(task.definition, target, task.label, TASK_SOURCE, task.execution, task.problemMatchers);
      vscodeTask.group = task.group;
      return vscodeTask;
    });
}
export function runRlsCommand(folder: WorkspaceFolder, execution: Execution) {
  const shellExecution = createShellExecution(execution);
  const problemMatchers = ['$rustc'];
  return tasks.executeTask(new Task({ type: 'shell' }, folder, 'External RLS command', TASK_SOURCE, shellExecution, problemMatchers));
}
export async function runTaskCommand({ command, args, env, cwd }: Execution, displayName: string, folder?: WorkspaceFolder) {
  const commandLine = `${command} ${args.join(' ')}`;
  const task = new Task(
    { type: 'shell' },
    folder || workspace.workspaceFolders![0],
    displayName,
    TASK_SOURCE,
    new ShellExecution(commandLine, {
      cwd: cwd || (folder && folder.uri.fsPath),
      env,
    })
  );
  return new Promise((resolve) => {
    const disposable = tasks.onDidEndTask(({ execution }) => {
      const taskExecution = execution.task.execution;
      if (taskExecution instanceof ShellExecution && taskExecution.commandLine === commandLine) {
        disposable.dispose();
        resolve();
      }
    });
    tasks.executeTask(task);
  });
}
