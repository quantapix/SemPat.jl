import type * as qp from '../protocol';

export enum RequestQueueingType {
  Normal = 1,
  LowPriority = 2,
  Fence = 3,
}

export interface RequestItem {
  readonly request: qp.Request;
  readonly expectsResponse: boolean;
  readonly isAsync: boolean;
  readonly queueingType: RequestQueueingType;
}

export class RequestQueue {
  private readonly queue: RequestItem[] = [];
  private sequenceNumber: number = 0;

  public get length(): number {
    return this.queue.length;
  }

  public enqueue(item: RequestItem): void {
    if (item.queueingType === RequestQueueingType.Normal) {
      let index = this.queue.length - 1;
      while (index >= 0) {
        if (this.queue[index].queueingType !== RequestQueueingType.LowPriority) {
          break;
        }
        --index;
      }
      this.queue.splice(index + 1, 0, item);
    } else {
      this.queue.push(item);
    }
  }

  public dequeue(): RequestItem | undefined {
    return this.queue.shift();
  }

  public tryDeletePendingRequest(seq: number): boolean {
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].request.seq === seq) {
        this.queue.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  public createRequest(command: string, args: any): qp.Request {
    return {
      seq: this.sequenceNumber++,
      type: 'request',
      command: command,
      arguments: args,
    };
  }
}
