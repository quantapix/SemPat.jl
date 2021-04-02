import { CancellationToken, CompletionList } from 'vscode-languageserver';
import { ModuleNode } from '../parser/parseNodes';
import { ConfigOptions } from './options';
declare interface Promise<T> {
  ignoreErrors(): void;
}
Promise.prototype.ignoreErrors = function <T>(this: Promise<T>) {
  this.catch(() => {});
};
export interface LangServiceExtension {
  readonly completionListExtension: CompletionListExtension;
}
export interface CompletionListExtension {
  updateCompletionList(sourceList: CompletionList, ast: ModuleNode, content: string, position: number, options: ConfigOptions, token: CancellationToken): Promise<CompletionList>;
  readonly commandPrefix: string;
  executeCommand(command: string, args: any[] | undefined, token: CancellationToken): Promise<void>;
}
