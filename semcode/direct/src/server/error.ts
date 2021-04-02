import type * as qp from '../protocol';
import { TSVersion } from './version';
export class TSServerError extends Error {
  public static create(serverId: string, version: TSVersion, response: qp.Response): TSServerError {
    const parsedResult = TSServerError.parseErrorText(response);
    return new TSServerError(serverId, version, response, parsedResult?.message, parsedResult?.stack, parsedResult?.sanitizedStack);
  }
  private constructor(
    public readonly serverId: string,
    public readonly version: TSVersion,
    private readonly response: qp.Response,
    public readonly serverMessage: string | undefined,
    public readonly serverStack: string | undefined,
    private readonly sanitizedStack: string | undefined
  ) {
    super(`<${serverId}> TypeScript Server Error (${version.displayName})\n${serverMessage}\n${serverStack}`);
  }
  public get serverErrorText() {
    return this.response.message;
  }
  public get serverCommand() {
    return this.response.command;
  }
  public get telemetry() {
    return {
      command: this.serverCommand,
      serverid: this.serverId,
      sanitizedstack: this.sanitizedStack || '',
    } as const;
  }
  private static parseErrorText(r: qp.Response) {
    const errorText = r.message;
    if (errorText) {
      const errorPrefix = 'Error processing request. ';
      if (errorText.startsWith(errorPrefix)) {
        const prefixFreeErrorText = errorText.substr(errorPrefix.length);
        const newlineIndex = prefixFreeErrorText.indexOf('\n');
        if (newlineIndex >= 0) {
          const stack = prefixFreeErrorText.substring(newlineIndex + 1);
          return {
            message: prefixFreeErrorText.substring(0, newlineIndex),
            stack,
            sanitizedStack: TSServerError.sanitizeStack(stack),
          };
        }
      }
    }
    return undefined;
  }
  private static sanitizeStack(m: string | undefined) {
    if (!m) {
      return '';
    }
    const regex = /(\btsserver)?(\.(?:ts|tsx|js|jsx)(?::\d+(?::\d+)?)?)\)?$/gim;
    let serverStack = '';
    while (true) {
      const match = regex.exec(m);
      if (!match) {
        break;
      }
      serverStack += `${match[1] || 'suppressed'}${match[2]}\n`;
    }
    return serverStack;
  }
}
