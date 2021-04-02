import * as qv from 'vscode';
import { log } from './util';

export class PersistentState {
  constructor(private readonly globalState: qv.Memento) {
    const { lastCheck, releaseId, serverVersion } = this;
    log.info('PersistentState:', { lastCheck, releaseId, serverVersion });
  }

  get lastCheck(): number | undefined {
    return this.globalState.get('lastCheck');
  }
  async updateLastCheck(value: number) {
    await this.globalState.update('lastCheck', value);
  }

  get releaseId(): number | undefined {
    return this.globalState.get('releaseId');
  }
  async updateReleaseId(value: number) {
    await this.globalState.update('releaseId', value);
  }

  get serverVersion(): string | undefined {
    return this.globalState.get('serverVersion');
  }
  async updateServerVersion(value: string | undefined) {
    await this.globalState.update('serverVersion', value);
  }
}
