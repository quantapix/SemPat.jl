import Tracer from '../utils/tracer';
import * as fs from 'fs';
import { getTempFile } from '../utils/temp.electron';
export interface OngoingRequestCancel {
  readonly cancellationPipeName: string | undefined;
  tryCancelOngoingRequest(seq: number): boolean;
}
export interface OngoingRequestCancelFact {
  create(serverId: string, tracer: Tracer): OngoingRequestCancel;
}
const noopRequestCancel = new (class implements OngoingRequestCancel {
  public readonly cancellationPipeName = undefined;
  public tryCancelOngoingRequest(_seq: number): boolean {
    return false;
  }
})();
export const noopRequestCancelFact = new (class implements OngoingRequestCancelFact {
  create(_serverId: string, _tracer: Tracer): OngoingRequestCancel {
    return noopRequestCancel;
  }
})();
export class NodeRequestCancel implements OngoingRequestCancel {
  public readonly cancellationPipeName: string;
  public constructor(private readonly _serverId: string, private readonly _tracer: Tracer) {
    this.cancellationPipeName = getTempFile('tscancellation');
  }
  public tryCancelOngoingRequest(seq: number): boolean {
    if (!this.cancellationPipeName) {
      return false;
    }
    this._tracer.logTrace(this._serverId, `TypeScript Server: trying to cancel ongoing request with sequence number ${seq}`);
    try {
      fs.writeFileSync(this.cancellationPipeName + seq, '');
    } catch {}
    return true;
  }
}
export const nodeRequestCancelFact = new (class implements OngoingRequestCancelFact {
  create(serverId: string, tracer: Tracer): OngoingRequestCancel {
    return new NodeRequestCancel(serverId, tracer);
  }
})();
