import type * as qp from '../protocol';
import { TypeScriptVersion } from './version';

export class TypeScriptServerError extends Error {
  public static create(serverId: string, version: TypeScriptVersion, response: qp.Response): TypeScriptServerError {
    const parsedResult = TypeScriptServerError.parseErrorText(response);
    return new TypeScriptServerError(serverId, version, response, parsedResult?.message, parsedResult?.stack, parsedResult?.sanitizedStack);
  }

  private constructor(
    public readonly serverId: string,
    public readonly version: TypeScriptVersion,
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

  private static parseErrorText(response: qp.Response) {
    const errorText = response.message;
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
            sanitizedStack: TypeScriptServerError.sanitizeStack(stack),
          };
        }
      }
    }
    return undefined;
  }

  private static sanitizeStack(message: string | undefined) {
    if (!message) {
      return '';
    }
    const regex = /(\btsserver)?(\.(?:ts|tsx|js|jsx)(?::\d+(?::\d+)?)?)\)?$/gim;
    let serverStack = '';
    while (true) {
      const match = regex.exec(message);
      if (!match) {
        break;
      }
      serverStack += `${match[1] || 'suppressed'}${match[2]}\n`;
    }
    return serverStack;
  }
}
