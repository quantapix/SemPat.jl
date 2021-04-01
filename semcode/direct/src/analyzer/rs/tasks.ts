import * as qv from 'vscode';
import * as toolchain from './toolchain';
import { Config } from './config';
import { log } from './util';

export const TASK_TYPE = 'cargo';
export const TASK_SOURCE = 'rust';

export interface CargoTaskDefinition extends qv.TaskDefinition {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: { [key: string]: string };
}

class CargoTaskProvider implements qv.TaskProvider {
  private readonly target: qv.WorkspaceFolder;
  private readonly config: Config;

  constructor(target: qv.WorkspaceFolder, config: Config) {
    this.target = target;
    this.config = config;
  }

  async provideTasks(): Promise<qv.Task[]> {
    const defs = [
      { command: 'build', group: qv.TaskGroup.Build },
      { command: 'check', group: qv.TaskGroup.Build },
      { command: 'test', group: qv.TaskGroup.Test },
      { command: 'clean', group: qv.TaskGroup.Clean },
      { command: 'run', group: undefined },
    ];

    const tasks: qv.Task[] = [];
    for (const def of defs) {
      const vscodeTask = await buildCargoTask(this.target, { type: TASK_TYPE, command: def.command }, `cargo ${def.command}`, [def.command], this.config.cargoRunner);
      vscodeTask.group = def.group;
      tasks.push(vscodeTask);
    }

    return tasks;
  }

  async resolveTask(task: qv.Task): Promise<qv.Task | undefined> {
    const definition = task.definition as CargoTaskDefinition;

    if (definition.type === TASK_TYPE && definition.command) {
      const args = [definition.command].concat(definition.args ?? []);

      return await buildCargoTask(this.target, definition, task.name, args, this.config.cargoRunner);
    }

    return undefined;
  }
}

export async function buildCargoTask(
  target: qv.WorkspaceFolder,
  definition: CargoTaskDefinition,
  name: string,
  args: string[],
  customRunner?: string,
  throwOnError: boolean = false
): Promise<qv.Task> {
  let exec: qv.ShellExecution | undefined = undefined;

  if (customRunner) {
    const runnerCommand = `${customRunner}.buildShellExecution`;
    try {
      const runnerArgs = { kind: TASK_TYPE, args, cwd: definition.cwd, env: definition.env };
      const customExec = await qv.commands.executeCommand(runnerCommand, runnerArgs);
      if (customExec) {
        if (customExec instanceof qv.ShellExecution) {
          exec = customExec;
        } else {
          log.debug('Invalid cargo ShellExecution', customExec);
          throw 'Invalid cargo ShellExecution.';
        }
      }
    } catch (e) {
      if (throwOnError) throw `Cargo runner '${customRunner}' failed! ${e}`;
    }
  }

  if (!exec) {
    exec = new qv.ShellExecution(toolchain.cargoPath(), args, definition);
  }

  return new qv.Task(definition, target, name, TASK_SOURCE, exec, ['$rustc']);
}

export function activateTaskProvider(target: qv.WorkspaceFolder, config: Config): qv.Disposable {
  const provider = new CargoTaskProvider(target, config);
  return qv.tasks.registerTaskProvider(TASK_TYPE, provider);
}
