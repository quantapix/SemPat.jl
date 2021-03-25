import * as vsc from 'vscode';
import { ServiceClient, ClientCap } from './service';
import API from '../old/ts/utils/api';
import * as qu from './utils';

export class Condition extends qu.Disposable {
  private _val: boolean;
  constructor(private readonly getValue: () => boolean, onUpdate: (handler: () => void) => void) {
    super();
    this._val = this.getValue();
    onUpdate(() => {
      const v = this.getValue();
      if (v !== this._val) {
        this._val = v;
        this._onDidChange.fire();
      }
    });
  }
  public get value(): boolean {
    return this._val;
  }
  private readonly _onDidChange = this._register(new vsc.EventEmitter<void>());
  public readonly onDidChange = this._onDidChange.event;
}

class CondRegistration {
  private _reg?: vsc.Disposable;
  public constructor(private readonly conds: readonly Condition[], private readonly reg: () => vsc.Disposable) {
    for (const c of conds) {
      c.onDidChange(() => this.update());
    }
    this.update();
  }
  public dispose() {
    this._reg?.dispose();
    this._reg = undefined;
  }
  private update() {
    if (this.conds.every((x) => x.value)) {
      if (!this._reg) this._reg = this.reg();
    } else {
      if (this._reg) {
        this._reg.dispose();
        this._reg = undefined;
      }
    }
  }
}

export function condRegistration(cs: readonly Condition[], reg: () => vsc.Disposable): vsc.Disposable {
  return new CondRegistration(cs, reg);
}

export function requireMinVer(c: ServiceClient, minVer: API) {
  return new Condition(() => c.apiVersion.gte(minVer), c.onTsServerStarted);
}

export function requireConfig(lang: string, cfg: string) {
  return new Condition(() => {
    const c = vsc.workspace.getConfiguration(lang, null);
    return !!c.get<boolean>(cfg);
  }, vsc.workspace.onDidChangeConfiguration);
}

export function requireSomeCap(c: ServiceClient, ...cs: readonly ClientCap[]) {
  return new Condition(() => cs.some((x) => c.capabilities.has(x)), c.onDidChangeCapabilities);
}
