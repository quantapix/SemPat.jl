import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ServerResponse } from '../service';

type Resolve<T extends qp.Response> = () => Promise<ServerResponse.Response<T>>;

export class CachedResponse<T extends qp.Response> {
  private response?: Promise<ServerResponse.Response<T>>;
  private version: number = -1;
  private document: string = '';

  public execute(document: qv.TextDocument, resolve: Resolve<T>): Promise<ServerResponse.Response<T>> {
    if (this.response && this.matches(document)) {
      return (this.response = this.response.then((result) => (result.type === 'cancelled' ? resolve() : result)));
    }
    return this.reset(document, resolve);
  }

  private matches(document: qv.TextDocument): boolean {
    return this.version === document.version && this.document === document.uri.toString();
  }

  private async reset(document: qv.TextDocument, resolve: Resolve<T>): Promise<ServerResponse.Response<T>> {
    this.version = document.version;
    this.document = document.uri.toString();
    return (this.response = resolve());
  }
}
