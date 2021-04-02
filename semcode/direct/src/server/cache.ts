import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ServerResponse } from '../service';
type Resolve<T extends qp.Response> = () => Promise<ServerResponse.Response<T>>;
export class CachedResponse<T extends qp.Response> {
  private response?: Promise<ServerResponse.Response<T>>;
  private version: number = -1;
  private doc: string = '';
  public execute(d: qv.TextDocument, resolve: Resolve<T>): Promise<ServerResponse.Response<T>> {
    if (this.response && this.matches(d)) {
      return (this.response = this.response.then((result) => (result.type === 'cancelled' ? resolve() : result)));
    }
    return this.reset(d, resolve);
  }
  private matches(d: qv.TextDocument): boolean {
    return this.version === d.version && this.doc === d.uri.toString();
  }
  private async reset(d: qv.TextDocument, resolve: Resolve<T>): Promise<ServerResponse.Response<T>> {
    this.version = d.version;
    this.doc = d.uri.toString();
    return (this.response = resolve());
  }
}
