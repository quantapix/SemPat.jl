import type * as qp from '../protocol';
import { ServerResponse } from '../service';
export interface CallbackItem<R> {
  readonly onSuccess: (value: R) => void;
  readonly onError: (err: Error) => void;
  readonly queuingStartTime: number;
  readonly isAsync: boolean;
}
export class CallbackMap<R extends qp.Response> {
  private readonly _callbacks = new Map<number, CallbackItem<ServerResponse.Response<R> | undefined>>();
  private readonly _asyncCallbacks = new Map<number, CallbackItem<ServerResponse.Response<R> | undefined>>();
  public destroy(cause: string): void {
    const cancellation = new ServerResponse.Cancelled(cause);
    for (const callback of this._callbacks.values()) {
      callback.onSuccess(cancellation);
    }
    this._callbacks.clear();
    for (const callback of this._asyncCallbacks.values()) {
      callback.onSuccess(cancellation);
    }
    this._asyncCallbacks.clear();
  }
  public add(seq: number, cb: CallbackItem<ServerResponse.Response<R> | undefined>, isAsync: boolean) {
    if (isAsync) {
      this._asyncCallbacks.set(seq, cb);
    } else {
      this._callbacks.set(seq, cb);
    }
  }
  public fetch(seq: number): CallbackItem<ServerResponse.Response<R> | undefined> | undefined {
    const callback = this._callbacks.get(seq) || this._asyncCallbacks.get(seq);
    this.delete(seq);
    return callback;
  }
  private delete(seq: number) {
    if (!this._callbacks.delete(seq)) {
      this._asyncCallbacks.delete(seq);
    }
  }
}
