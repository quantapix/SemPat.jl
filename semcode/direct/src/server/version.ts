import API from '../utils/api';
import { TSServiceConfig } from '../utils/configuration';
import * as fs from 'fs';
import * as path from 'path';
import * as qv from 'vscode';
import { RelativeWorkspacePathResolver } from '../utils';
export const enum VersionSource {
  Bundled = 'bundled',
  TsNightlyExtension = 'ts-nightly-extension',
  NodeModules = 'node-modules',
  UserSetting = 'user-setting',
  WorkspaceSetting = 'workspace-setting',
}
export class TSVersion {
  constructor(public readonly source: VersionSource, public readonly path: string, public readonly apiVersion: API | undefined, private readonly _pathLabel?: string) {}
  public get tsServerPath(): string {
    return this.path;
  }
  public get pathLabel(): string {
    return this._pathLabel ?? this.path;
  }
  public get isValid(): boolean {
    return this.apiVersion !== undefined;
  }
  public eq(other: TSVersion): boolean {
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
    return version ? version.displayName : 'couldNotLoadTsVersion';
  }
}
export interface TSVersionProvider {
  updateConfig(configuration: TSServiceConfig): void;
  readonly defaultVersion: TSVersion;
  readonly globalVersion: TSVersion | undefined;
  readonly localVersion: TSVersion | undefined;
  readonly localVersions: readonly TSVersion[];
  readonly bundledVersion: TSVersion;
}
export class DiskTSVersionProvider implements TSVersionProvider {
  public constructor(private configuration?: TSServiceConfig) {}
  public updateConfig(configuration: TSServiceConfig): void {
    this.configuration = configuration;
  }
  public get defaultVersion(): TSVersion {
    return this.globalVersion || this.bundledVersion;
  }
  public get globalVersion(): TSVersion | undefined {
    if (this.configuration?.globalTsdk) {
      const globals = this.loadVersionsFromSetting(VersionSource.UserSetting, this.configuration.globalTsdk);
      if (globals && globals.length) {
        return globals[0];
      }
    }
    return this.contributedTsNextVersion;
  }
  public get localVersion(): TSVersion | undefined {
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
  public get localVersions(): TSVersion[] {
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
  public get bundledVersion(): TSVersion {
    const version = this.getContributedVersion(VersionSource.Bundled, 'qv.typescript-language-features', ['..', 'node_modules']);
    if (version) {
      return version;
    }
    qv.window.showErrorMessage('noBundledServerFound');
    throw new Error('Could not find bundled tsserver.js');
  }
  private get contributedTsNextVersion(): TSVersion | undefined {
    return this.getContributedVersion(VersionSource.TsNightlyExtension, 'ms-qv.vscode-typescript-next', ['node_modules']);
  }
  private getContributedVersion(source: VersionSource, extensionId: string, pathToTs: readonly string[]): TSVersion | undefined {
    try {
      const extension = qv.extensions.getExtension(extensionId);
      if (extension) {
        const serverPath = path.join(extension.extensionPath, ...pathToTs, 'typescript', 'lib', 'tsserver.js');
        const bundledVersion = new TSVersion(source, serverPath, DiskTSVersionProvider.getApiVersion(serverPath), '');
        if (bundledVersion.isValid) {
          return bundledVersion;
        }
      }
    } catch {}
    return undefined;
  }
  private get localTsdkVersions(): TSVersion[] {
    const localTsdk = this.configuration?.localTsdk;
    return localTsdk ? this.loadVersionsFromSetting(VersionSource.WorkspaceSetting, localTsdk) : [];
  }
  private loadVersionsFromSetting(source: VersionSource, tsdkPathSetting: string): TSVersion[] {
    if (path.isAbsolute(tsdkPathSetting)) {
      const serverPath = path.join(tsdkPathSetting, 'tsserver.js');
      return [new TSVersion(source, serverPath, DiskTSVersionProvider.getApiVersion(serverPath), tsdkPathSetting)];
    }
    const workspacePath = RelativeWorkspacePathResolver.asAbsoluteWorkspacePath(tsdkPathSetting);
    if (workspacePath !== undefined) {
      const serverPath = path.join(workspacePath, 'tsserver.js');
      return [new TSVersion(source, serverPath, DiskTSVersionProvider.getApiVersion(serverPath), tsdkPathSetting)];
    }
    return this.loadTSVersionsFromPath(source, tsdkPathSetting);
  }
  private get localNodeModulesVersions(): TSVersion[] {
    return this.loadTSVersionsFromPath(VersionSource.NodeModules, path.join('node_modules', 'typescript', 'lib')).filter((x) => x.isValid);
  }
  private loadTSVersionsFromPath(source: VersionSource, relativePath: string): TSVersion[] {
    if (!qv.workspace.workspaceFolders) {
      return [];
    }
    const versions: TSVersion[] = [];
    for (const root of qv.workspace.workspaceFolders) {
      let label: string = relativePath;
      if (qv.workspace.workspaceFolders.length > 1) {
        label = path.join(root.name, relativePath);
      }
      const serverPath = path.join(root.uri.fsPath, relativePath, 'tsserver.js');
      versions.push(new TSVersion(source, serverPath, DiskTSVersionProvider.getApiVersion(serverPath), label));
    }
    return versions;
  }
  private static getApiVersion(serverPath: string): API | undefined {
    const version = DiskTSVersionProvider.getTSVersion(serverPath);
    if (version) {
      return version;
    }
    const tsdkVersion = qv.workspace.getConfig().get<string | undefined>('typescript.tsdk_version', undefined);
    if (tsdkVersion) {
      return API.fromVersionString(tsdkVersion);
    }
    return undefined;
  }
  private static getTSVersion(serverPath: string): API | undefined {
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
