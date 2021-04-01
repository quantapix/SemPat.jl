import * as nls from 'vscode-nls';
import API from '../utils/api';
import { TypeScriptServiceConfiguration } from '../utils/configuration';
import * as fs from 'fs';
import * as path from 'path';
import * as qv from 'vscode';
import { RelativeWorkspacePathResolver } from '../utils/relativePathResolver';

export const localize = nls.loadMessageBundle();

export const enum TypeScriptVersionSource {
  Bundled = 'bundled',
  TsNightlyExtension = 'ts-nightly-extension',
  NodeModules = 'node-modules',
  UserSetting = 'user-setting',
  WorkspaceSetting = 'workspace-setting',
}

export class TypeScriptVersion {
  constructor(public readonly source: TypeScriptVersionSource, public readonly path: string, public readonly apiVersion: API | undefined, private readonly _pathLabel?: string) {}

  public get tsServerPath(): string {
    return this.path;
  }

  public get pathLabel(): string {
    return this._pathLabel ?? this.path;
  }

  public get isValid(): boolean {
    return this.apiVersion !== undefined;
  }

  public eq(other: TypeScriptVersion): boolean {
    if (this.path !== other.path) {
      return false;
    }

    if (this.apiVersion === other.apiVersion) {
      return true;
    }
    if (!this.apiVersion || !other.apiVersion) {
      return false;
    }
    return this.apiVersion.eq(other.apiVersion);
  }

  public get displayName(): string {
    const version = this.apiVersion;
    return version ? version.displayName : localize('couldNotLoadTsVersion', 'Could not load the TypeScript version at this path');
  }
}

export interface ITypeScriptVersionProvider {
  updateConfiguration(configuration: TypeScriptServiceConfiguration): void;

  readonly defaultVersion: TypeScriptVersion;
  readonly globalVersion: TypeScriptVersion | undefined;
  readonly localVersion: TypeScriptVersion | undefined;
  readonly localVersions: readonly TypeScriptVersion[];
  readonly bundledVersion: TypeScriptVersion;
}

export class DiskTypeScriptVersionProvider implements ITypeScriptVersionProvider {
  public constructor(private configuration?: TypeScriptServiceConfiguration) {}

  public updateConfiguration(configuration: TypeScriptServiceConfiguration): void {
    this.configuration = configuration;
  }

  public get defaultVersion(): TypeScriptVersion {
    return this.globalVersion || this.bundledVersion;
  }

  public get globalVersion(): TypeScriptVersion | undefined {
    if (this.configuration?.globalTsdk) {
      const globals = this.loadVersionsFromSetting(TypeScriptVersionSource.UserSetting, this.configuration.globalTsdk);
      if (globals && globals.length) {
        return globals[0];
      }
    }
    return this.contributedTsNextVersion;
  }

  public get localVersion(): TypeScriptVersion | undefined {
    const tsdkVersions = this.localTsdkVersions;
    if (tsdkVersions && tsdkVersions.length) {
      return tsdkVersions[0];
    }

    const nodeVersions = this.localNodeModulesVersions;
    if (nodeVersions && nodeVersions.length === 1) {
      return nodeVersions[0];
    }
    return undefined;
  }

  public get localVersions(): TypeScriptVersion[] {
    const allVersions = this.localTsdkVersions.concat(this.localNodeModulesVersions);
    const paths = new Set<string>();
    return allVersions.filter((x) => {
      if (paths.has(x.path)) {
        return false;
      }
      paths.add(x.path);
      return true;
    });
  }

  public get bundledVersion(): TypeScriptVersion {
    const version = this.getContributedVersion(TypeScriptVersionSource.Bundled, 'qv.typescript-language-features', ['..', 'node_modules']);
    if (version) {
      return version;
    }

    qv.window.showErrorMessage(localize('noBundledServerFound', "VS Code's tsserver was deleted by another application such as a misbehaving virus detection tool. Please reinstall VS Code."));
    throw new Error('Could not find bundled tsserver.js');
  }

  private get contributedTsNextVersion(): TypeScriptVersion | undefined {
    return this.getContributedVersion(TypeScriptVersionSource.TsNightlyExtension, 'ms-qv.vscode-typescript-next', ['node_modules']);
  }

  private getContributedVersion(source: TypeScriptVersionSource, extensionId: string, pathToTs: readonly string[]): TypeScriptVersion | undefined {
    try {
      const extension = qv.extensions.getExtension(extensionId);
      if (extension) {
        const serverPath = path.join(extension.extensionPath, ...pathToTs, 'typescript', 'lib', 'tsserver.js');
        const bundledVersion = new TypeScriptVersion(source, serverPath, DiskTypeScriptVersionProvider.getApiVersion(serverPath), '');
        if (bundledVersion.isValid) {
          return bundledVersion;
        }
      }
    } catch {}
    return undefined;
  }

  private get localTsdkVersions(): TypeScriptVersion[] {
    const localTsdk = this.configuration?.localTsdk;
    return localTsdk ? this.loadVersionsFromSetting(TypeScriptVersionSource.WorkspaceSetting, localTsdk) : [];
  }

  private loadVersionsFromSetting(source: TypeScriptVersionSource, tsdkPathSetting: string): TypeScriptVersion[] {
    if (path.isAbsolute(tsdkPathSetting)) {
      const serverPath = path.join(tsdkPathSetting, 'tsserver.js');
      return [new TypeScriptVersion(source, serverPath, DiskTypeScriptVersionProvider.getApiVersion(serverPath), tsdkPathSetting)];
    }

    const workspacePath = RelativeWorkspacePathResolver.asAbsoluteWorkspacePath(tsdkPathSetting);
    if (workspacePath !== undefined) {
      const serverPath = path.join(workspacePath, 'tsserver.js');
      return [new TypeScriptVersion(source, serverPath, DiskTypeScriptVersionProvider.getApiVersion(serverPath), tsdkPathSetting)];
    }

    return this.loadTypeScriptVersionsFromPath(source, tsdkPathSetting);
  }

  private get localNodeModulesVersions(): TypeScriptVersion[] {
    return this.loadTypeScriptVersionsFromPath(TypeScriptVersionSource.NodeModules, path.join('node_modules', 'typescript', 'lib')).filter((x) => x.isValid);
  }

  private loadTypeScriptVersionsFromPath(source: TypeScriptVersionSource, relativePath: string): TypeScriptVersion[] {
    if (!qv.workspace.workspaceFolders) {
      return [];
    }

    const versions: TypeScriptVersion[] = [];
    for (const root of qv.workspace.workspaceFolders) {
      let label: string = relativePath;
      if (qv.workspace.workspaceFolders.length > 1) {
        label = path.join(root.name, relativePath);
      }

      const serverPath = path.join(root.uri.fsPath, relativePath, 'tsserver.js');
      versions.push(new TypeScriptVersion(source, serverPath, DiskTypeScriptVersionProvider.getApiVersion(serverPath), label));
    }
    return versions;
  }

  private static getApiVersion(serverPath: string): API | undefined {
    const version = DiskTypeScriptVersionProvider.getTypeScriptVersion(serverPath);
    if (version) {
      return version;
    }

    const tsdkVersion = qv.workspace.getConfiguration().get<string | undefined>('typescript.tsdk_version', undefined);
    if (tsdkVersion) {
      return API.fromVersionString(tsdkVersion);
    }

    return undefined;
  }

  private static getTypeScriptVersion(serverPath: string): API | undefined {
    if (!fs.existsSync(serverPath)) {
      return undefined;
    }

    const p = serverPath.split(path.sep);
    if (p.length <= 2) {
      return undefined;
    }
    const p2 = p.slice(0, -2);
    const modulePath = p2.join(path.sep);
    let fileName = path.join(modulePath, 'package.json');
    if (!fs.existsSync(fileName)) {
      if (path.basename(modulePath) === 'built') {
        fileName = path.join(modulePath, '..', 'package.json');
      }
    }
    if (!fs.existsSync(fileName)) {
      return undefined;
    }

    const contents = fs.readFileSync(fileName).toString();
    let desc: any = null;
    try {
      desc = JSON.parse(contents);
    } catch (err) {
      return undefined;
    }
    if (!desc || !desc.version) {
      return undefined;
    }
    return desc.version ? API.fromVersionString(desc.version) : undefined;
  }
}
