import * as qv from 'vscode';
import { ServiceClient } from '../service';
import { Disposable } from './dispose';
const typingsInstallTimeout = 30 * 1000;
export default class TypingsStatus extends Disposable {
  private readonly _acquiringTypings = new Map<number, NodeJS.Timer>();
  private readonly _client: ServiceClient;
  constructor(client: ServiceClient) {
    super();
    this._client = client;
    this._register(this._client.onDidBeginInstallTypings((event) => this.onBeginInstallTypings(event.eventId)));
    this._register(this._client.onDidEndInstallTypings((event) => this.onEndInstallTypings(event.eventId)));
  }
  public dispose(): void {
    super.dispose();
    for (const timeout of this._acquiringTypings.values()) {
      clearTimeout(timeout);
    }
  }
  public get isAcquiringTypings(): boolean {
    return Object.keys(this._acquiringTypings).length > 0;
  }
  private onBeginInstallTypings(eventId: number): void {
    if (this._acquiringTypings.has(eventId)) return;
    this._acquiringTypings.set(
      eventId,
      setTimeout(() => {
        this.onEndInstallTypings(eventId);
      }, typingsInstallTimeout)
    );
  }
  private onEndInstallTypings(eventId: number): void {
    const timer = this._acquiringTypings.get(eventId);
    if (timer) clearTimeout(timer);
    this._acquiringTypings.delete(eventId);
  }
}
export class AtaProgressReporter extends Disposable {
  private readonly _promises = new Map<number, Function>();
  constructor(client: ServiceClient) {
    super();
    this._register(client.onDidBeginInstallTypings((e) => this._onBegin(e.eventId)));
    this._register(client.onDidEndInstallTypings((e) => this._onEndOrTimeout(e.eventId)));
    this._register(client.onTypesInstallerInitializationFailed((_) => this.onTypesInstallerInitializationFailed()));
  }
  dispose(): void {
    super.dispose();
    this._promises.forEach((value) => value());
  }
  private _onBegin(eventId: number): void {
    const handle = setTimeout(() => this._onEndOrTimeout(eventId), typingsInstallTimeout);
    const promise = new Promise<void>((resolve) => {
      this._promises.set(eventId, () => {
        clearTimeout(handle);
        resolve();
      });
    });
    qv.window.withProgress(
      {
        location: qv.ProgressLocation.Window,
        title: 'installingPackages',
      },
      () => promise
    );
  }
  private _onEndOrTimeout(eventId: number): void {
    const resolve = this._promises.get(eventId);
    if (resolve) {
      this._promises.delete(eventId);
      resolve();
    }
  }
  private async onTypesInstallerInitializationFailed() {
    const config = qv.workspace.getConfig('typescript');
    if (config.get<boolean>('check.npmIsInstalled', true)) {
      const dontShowAgain: qv.MessageItem = {
        title: 'typesInstallerInitializationFailed.doNotCheckAgain',
      };
      const selected = await qv.window.showWarningMessage('typesInstallerInitializationFailed.title', dontShowAgain);
      if (selected === dontShowAgain) config.update('check.npmIsInstalled', false, true);
    }
  }
}
