import * as child_process from 'child_process';
import * as util from 'util';
import { window } from 'vscode';

import { startSpinner, stopSpinner } from './spinner';
import { runTaskCommand } from './tasks';

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
  // In addition to a regular channel name, also handle shorthands e.g.
  // `stable-msvc` or `stable-x86_64-msvc` but not `stable-x86_64-pc-msvc`.
  const abiSuffix = ['-gnu', '-msvc'].find((abi) => channel.endsWith(abi));
  const [prefix, suffix] = abiSuffix && channel.split('-').length <= 3 ? [channel.substr(0, channel.length - abiSuffix.length), abiSuffix] : [channel, undefined];
  // Skip middle target triple components such as vendor as necessary, since
  // `rustup` output lists toolchains with a full target triple inside
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
