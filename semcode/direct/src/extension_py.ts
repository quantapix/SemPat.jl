import * as path from 'path';
import { commands, ExtensionContext, extensions, OutputChannel, Position, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import {
  CancellationToken,
  ConfigParams,
  ConfigRequest,
  DidChangeConfigNotification,
  HandlerResult,
  LangClient,
  LangClientOptions,
  ResponseError,
  ServerOptions,
  TextEdit,
  TransportKind,
} from 'vscode-languageclient/node';
import { Commands } from 'pyright-internal/commands/commands';
import { isThenable } from 'pyright-internal/common/core';
import { FileBasedCancellationStrategy } from './server/py/cancellation';
let cancellationStrategy: FileBasedCancellationStrategy | undefined;
const pythonPathChangedListenerMap = new Map<string, string>();
export function activate(context: ExtensionContext) {
  const pylanceExtension = extensions.getExtension('ms-python.vscode-pylance');
  if (pylanceExtension) {
    window.showErrorMessage(
      'Pyright has detected that the Pylance extension is installed. ' +
        'Pylance includes the functionality of Pyright, and running both of ' +
        'these extensions can lead to problems. Pyright will disable itself. ' +
        'Uninstall or disable Pyright to avoid this message.'
    );
    return;
  }
  cancellationStrategy = new FileBasedCancellationStrategy();
  const bundlePath = context.asAbsolutePath(path.join('dist', 'server.js'));
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6600'] };
  const serverOptions: ServerOptions = {
    run: { module: bundlePath, transport: TransportKind.ipc, args: cancellationStrategy.getCommandLineArguments() },
    debug: {
      module: bundlePath,
      transport: TransportKind.ipc,
      args: cancellationStrategy.getCommandLineArguments(),
      options: debugOptions,
    },
  };
  const clientOptions: LangClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'python' }],
    synchronize: {
      configurationSection: ['python', 'pyright'],
    },
    connectionOptions: { cancellationStrategy: cancellationStrategy },
    middleware: {
      workspace: {
        configuration: (params: ConfigParams, token: CancellationToken, next: ConfigRequest.HandlerSignature): HandlerResult<any[], void> => {
          const result: any[] | ResponseError<void> | Thenable<any[] | ResponseError<void>> = next(params, token);
          const addPythonPath = (settings: any[] | ResponseError<void>): Promise<any[] | ResponseError<any>> => {
            if (settings instanceof ResponseError) return Promise.resolve(settings);
            const pythonPathPromises: Promise<string | undefined>[] = params.items.map((item) => {
              if (item.section === 'python') {
                const uri = item.scopeUri ? Uri.parse(item.scopeUri) : undefined;
                return getPythonPathFromPythonExtension(languageClient.outputChannel, uri, () => {
                  languageClient.sendNotification(DidChangeConfigNotification.type, {
                    settings: null,
                  });
                });
              }
              return Promise.resolve(undefined);
            });
            return Promise.all(pythonPathPromises).then((pythonPaths) => {
              pythonPaths.forEach((pythonPath, i) => {
                if (pythonPath !== undefined) settings[i].pythonPath = pythonPath;
              });
              return settings;
            });
          };
          if (isThenable(result)) {
            return result.then(addPythonPath);
          }
          return addPythonPath(result);
        },
      },
    },
  };
  const languageClient = new LangClient('python', 'Pyright', serverOptions, clientOptions);
  const disposable = languageClient.start();
  context.subscriptions.push(disposable);
  const textEditorCommands = [Commands.orderImports, Commands.addMissingOptionalToParam];
  textEditorCommands.forEach((commandName) => {
    context.subscriptions.push(
      commands.registerTextEditorCommand(
        commandName,
        (editor: TextEditor, edit: TextEditorEdit, ...args: any[]) => {
          const cmd = {
            command: commandName,
            arguments: [editor.document.uri.toString(), ...args],
          };
          languageClient.sendRequest<TextEdit[] | undefined>('workspace/executeCommand', cmd).then((edits) => {
            if (edits && edits.length > 0) {
              editor.edit((editBuilder) => {
                edits.forEach((edit) => {
                  const startPos = new Position(edit.range.start.line, edit.range.start.character);
                  const endPos = new Position(edit.range.end.line, edit.range.end.character);
                  const range = new Range(startPos, endPos);
                  editBuilder.replace(range, edit.newText);
                });
              });
            }
          });
        },
        () => {}
      )
    );
  });
  const genericCommands = [Commands.createTypeStub, Commands.restartServer];
  genericCommands.forEach((command) => {
    context.subscriptions.push(
      commands.registerCommand(command, (...args: any[]) => {
        languageClient.sendRequest('workspace/executeCommand', { command, arguments: args });
      })
    );
  });
}
export function deactivate() {
  if (cancellationStrategy) {
    cancellationStrategy.dispose();
    cancellationStrategy = undefined;
  }
  return undefined;
}
async function getPythonPathFromPythonExtension(outputChannel: OutputChannel, scopeUri: Uri | undefined, postConfigChanged: () => void): Promise<string | undefined> {
  try {
    const extension = extensions.getExtension('ms-python.python');
    if (!extension) outputChannel.appendLine('Python extension not found');
    else {
      if (extension.packageJSON?.featureFlags?.usingNewInterpreterStorage) {
        if (!extension.isActive) {
          outputChannel.appendLine('Waiting for Python extension to load');
          await extension.activate();
          outputChannel.appendLine('Python extension loaded');
        }
        const execDetails = await extension.exports.settings.getExecutionDetails(scopeUri);
        let result: string | undefined;
        if (execDetails.execCommand && execDetails.execCommand.length > 0) result = execDetails.execCommand[0];
        if (extension.exports.settings.onDidChangeExecutionDetails) installPythonPathChangedListener(extension.exports.settings.onDidChangeExecutionDetails, scopeUri, postConfigChanged);
        if (!result) outputChannel.appendLine(`No pythonPath provided by Python extension`);
        else outputChannel.appendLine(`Received pythonPath from Python extension: ${result}`);
        return result;
      }
    }
  } catch (error) {
    outputChannel.appendLine(`Exception occurred when attempting to read pythonPath from Python extension: ${JSON.stringify(error)}`);
  }
  return undefined;
}
function installPythonPathChangedListener(onDidChangeExecutionDetails: (callback: () => void) => void, scopeUri: Uri | undefined, postConfigChanged: () => void) {
  const uriString = scopeUri ? scopeUri.toString() : '';
  if (pythonPathChangedListenerMap.has(uriString)) return;
  onDidChangeExecutionDetails(() => {
    postConfigChanged();
  });
  pythonPathChangedListenerMap.set(uriString, uriString);
}
