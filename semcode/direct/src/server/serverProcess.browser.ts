/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qv from 'vscode';
import * as nls from 'vscode-nls';
import type * as qp from '../protocol';
import { TypeScriptServiceConfiguration } from '../utils/configuration';
import { memoize } from '../utils/memoize';
import { TsServerProcess, TsServerProcessKind } from './server';

const localize = nls.loadMessageBundle();

declare const Worker: any;
declare type Worker = any;

export class WorkerServerProcess implements TsServerProcess {
  public static fork(tsServerPath: string, args: readonly string[], _kind: TsServerProcessKind, _configuration: TypeScriptServiceConfiguration) {
    const worker = new Worker(tsServerPath);
    return new WorkerServerProcess(worker, [
      ...args,

      // Explicitly give TS Server its path so it can
      // load local resources
      '--executingFilePath',
      tsServerPath,
    ]);
  }

  private _onDataHandlers = new Set<(data: qp.Response) => void>();
  private _onErrorHandlers = new Set<(err: Error) => void>();
  private _onExitHandlers = new Set<(code: number | null) => void>();

  public constructor(private readonly worker: Worker, args: readonly string[]) {
    worker.addEventListener('message', (msg: any) => {
      if (msg.data.type === 'log') {
        this.output.appendLine(msg.data.body);
        return;
      }

      for (const handler of this._onDataHandlers) {
        handler(msg.data);
      }
    });
    worker.postMessage(args);
  }

  @memoize
  private get output(): qv.OutputChannel {
    return qv.window.createOutputChannel(localize('channelName', 'TypeScript Server Log'));
  }

  write(serverRequest: qp.Request): void {
    this.worker.postMessage(serverRequest);
  }

  onData(handler: (response: qp.Response) => void): void {
    this._onDataHandlers.add(handler);
  }

  onError(handler: (err: Error) => void): void {
    this._onErrorHandlers.add(handler);
    // Todo: not implemented
  }

  onExit(handler: (code: number | null) => void): void {
    this._onExitHandlers.add(handler);
    // Todo: not implemented
  }

  kill(): void {
    this.worker.terminate();
  }
}
