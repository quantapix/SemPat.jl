import * as child_process from 'child_process';
import * as util from 'util';
import { window } from 'vscode';
import { startSpinner, stopSpinner } from './spinner';
import * as fs from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';
import * as ArrayUtil from './utils';
import * as FsUtil from './utils';

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
const exec = util.promisify(child_process.exec);
function isInstalledRegex(componentName: string): RegExp {
  return new RegExp(`^(${componentName}.*) \\((default|installed)\\)$`);
}
export interface RustupConfig {
  channel: string;
  path: string;
}
export async function rustupUpdate(config: RustupConfig) {
  startSpinner('Updating…');
  try {
    const { stdout } = await exec(`${config.path} update`);
    if (stdout.includes('unchanged')) {
      stopSpinner('Up to date.');
    } else {
      stopSpinner('Up to date. Restart extension for changes to take effect.');
    }
  } catch (e) {
    console.log(e);
    stopSpinner('An error occurred whilst trying to update.');
  }
}
export async function ensureToolchain(config: RustupConfig) {
  if (await hasToolchain(config)) {
    return;
  }
  const clicked = await window.showInformationMessage(`${config.channel} toolchain not installed. Install?`, 'Yes');
  if (clicked) {
    await tryToInstallToolchain(config);
  } else {
    throw new Error();
  }
}
export async function ensureComponents(config: RustupConfig, components: string[]) {
  if (await hasComponents(config, components)) {
    return;
  }
  const clicked = await Promise.resolve(window.showInformationMessage('Some Rust components not installed. Install?', 'Yes'));
  if (clicked) {
    await installComponents(config, components);
    window.showInformationMessage('Rust components successfully installed!');
  } else {
    throw new Error();
  }
}
async function hasToolchain({ channel, path }: RustupConfig): Promise<boolean> {
  const abiSuffix = ['-gnu', '-msvc'].find((abi) => channel.endsWith(abi));
  const [prefix, suffix] = abiSuffix && channel.split('-').length <= 3 ? [channel.substr(0, channel.length - abiSuffix.length), abiSuffix] : [channel, undefined];
  const matcher = new RegExp([prefix, suffix && `.*${suffix}`].join(''));
  try {
    const { stdout } = await exec(`${path} toolchain list`);
    return matcher.test(stdout);
  } catch (e) {
    console.log(e);
    window.showErrorMessage('Rustup not available. Install from https://www.rustup.rs/');
    throw e;
  }
}
async function tryToInstallToolchain(config: RustupConfig) {
  startSpinner('Installing toolchain…');
  try {
    const command = config.path;
    const args = ['toolchain', 'install', config.channel];
    await runTaskCommand({ command, args }, 'Installing toolchain…');
    if (!(await hasToolchain(config))) {
      throw new Error();
    }
  } catch (e) {
    console.log(e);
    window.showErrorMessage(`Could not install ${config.channel} toolchain`);
    stopSpinner(`Could not install toolchain`);
    throw e;
  }
}
async function listComponents(config: RustupConfig): Promise<string[]> {
  return exec(`${config.path} component list --toolchain ${config.channel}`).then(({ stdout }) => stdout.toString().replace('\r', '').split('\n'));
}
export async function hasComponents(config: RustupConfig, components: string[]): Promise<boolean> {
  try {
    const existingComponents = await listComponents(config);
    return components.map(isInstalledRegex).every((isInstalledRegex) => existingComponents.some((c) => isInstalledRegex.test(c)));
  } catch (e) {
    console.log(e);
    window.showErrorMessage(`Can't detect components: ${e.message}`);
    stopSpinner("Can't detect components");
    throw e;
  }
}
export async function installComponents(config: RustupConfig, components: string[]) {
  for (const component of components) {
    try {
      const command = config.path;
      const args = ['component', 'add', component, '--toolchain', config.channel];
      await runTaskCommand({ command, args }, `Installing \`${component}\``);
      const isInstalled = isInstalledRegex(component);
      const listedComponents = await listComponents(config);
      if (!listedComponents.some((c) => isInstalled.test(c))) {
        throw new Error();
      }
    } catch (e) {
      stopSpinner(`Could not install component \`${component}\``);
      window.showErrorMessage(`Could not install component: \`${component}\`${e.message ? `, message: ${e.message}` : ''}`);
      throw e;
    }
  }
}
export function parseActiveToolchain(rustupOutput: string): string {
  const activeToolchainsIndex = rustupOutput.search('active toolchain');
  if (activeToolchainsIndex !== -1) {
    rustupOutput = rustupOutput.substr(activeToolchainsIndex);
    const matchActiveChannel = /^(\S*) \((?:default|overridden)/gm;
    const match = matchActiveChannel.exec(rustupOutput);
    if (!match) {
      throw new Error(`couldn't find active toolchain under 'active toolchains'`);
    } else if (matchActiveChannel.exec(rustupOutput)) {
      throw new Error(`multiple active toolchains found under 'active toolchains'`);
    }
    return match[1];
  }
  const match = /^(?:.*\r?\n){2}(\S*) \((?:default|overridden)/.exec(rustupOutput);
  if (match) {
    return match[1];
  }
  throw new Error(`couldn't find active toolchains`);
}
export async function getVersion(config: RustupConfig): Promise<string> {
  const VERSION_REGEX = /rustup ([0-9]+\.[0-9]+\.[0-9]+)/;
  const output = await exec(`${config.path} --version`);
  const versionMatch = VERSION_REGEX.exec(output.stdout.toString());
  if (versionMatch && versionMatch.length >= 2) {
    return versionMatch[1];
  } else {
    throw new Error("Couldn't parse rustup version");
  }
}
export function hasRustup(config: RustupConfig): Promise<boolean> {
  return getVersion(config)
    .then(() => true)
    .catch(() => false);
}
export function getActiveChannel(wsPath: string, rustupPath: string): string {
  let activeChannel;
  try {
    activeChannel = child_process
      .execSync(`${rustupPath} show active-toolchain`, {
        cwd: wsPath,
      })
      .toString()
      .trim();
    activeChannel = activeChannel.replace(/ \(.*\)$/, '');
  } catch (e) {
    const showOutput = child_process
      .execSync(`${rustupPath} show`, {
        cwd: wsPath,
      })
      .toString();
    activeChannel = parseActiveToolchain(showOutput);
  }
  console.info(`Using active channel: ${activeChannel}`);
  return activeChannel;
}
const lstatAsync = promisify(fs.lstat);
const readdirAsync = promisify(fs.readdir);
export default class Executables {
  public static fromPath(path: string): Promise<Executables> {
    const paths = path.split(':');
    const promises = paths.map((x) => findExecutablesInPath(x));
    return Promise.all(promises)
      .then(ArrayUtil.flatten)
      .then(ArrayUtil.uniq)
      .then((executables) => new Executables(executables));
  }
  private executables: Set<string>;
  private constructor(executables: string[]) {
    this.executables = new Set(executables);
  }
  public list(): string[] {
    return Array.from(this.executables.values());
  }
  public isExecutableOnPATH(executable: string): boolean {
    return this.executables.has(executable);
  }
}
async function findExecutablesInPath(path: string): Promise<string[]> {
  path = FsUtil.untildify(path);
  try {
    const pathStats = await lstatAsync(path);
    if (pathStats.isDir()) {
      const childrenPaths = await readdirAsync(path);
      const files = [];
      for (const childrenPath of childrenPaths) {
        try {
          const stats = await lstatAsync(join(path, childrenPath));
          if (isExecutableFile(stats)) {
            files.push(basename(childrenPath));
          }
        } catch (error) {
          // Ignore error
        }
      }
      return files;
    } else if (isExecutableFile(pathStats)) {
      return [basename(path)];
    }
  } catch (error) {
    // Ignore error
  }
  return [];
}
function isExecutableFile(stats: fs.Stats): boolean {
  const isExecutable = !!(1 & parseInt((stats.mode & parseInt('777', 8)).toString(8)[0]));
  return stats.isFile() && isExecutable;
}
