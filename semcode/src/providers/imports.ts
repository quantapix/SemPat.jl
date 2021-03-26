import { ClientCap, ServiceClient } from '../service';
import { Command, CommandManager } from '../../old/ts/commands/commandManager';
import { condRegistration, requireMinVer, requireSomeCap } from '../registration';
import { TelemetryReporter } from '../../old/ts/utils/telemetry';
import * as nls from 'vscode-nls';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import FileConfigurationManager from '../../old/ts/languageFeatures/fileConfigurationManager';
import type * as qp from '../protocol';

const localize = nls.loadMessageBundle();

class OrganizeImportsCommand implements Command {
  public static readonly Id = '_typescript.organizeImports';

  public readonly id = OrganizeImportsCommand.Id;

  constructor(private readonly client: ServiceClient, private readonly telemetryReporter: TelemetryReporter) {}

  public async execute(file: string): Promise<boolean> {
    /* __GDPR__
			"organizeImports.execute" : {
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
    this.telemetryReporter.logTelemetry('organizeImports.execute', {});

    const args: qp.OrganizeImportsRequestArgs = {
      scope: {
        type: 'file',
        args: {
          file,
        },
      },
    };
    const response = await this.client.interruptGetErr(() => this.client.execute('organizeImports', args, qu.nulToken));
    if (response.type !== 'response' || !response.body) {
      return false;
    }

    const edits = qu.WorkspaceEdit.fromFileCodeEdits(this.client, response.body);
    return qv.workspace.applyEdit(edits);
  }
}

export class OrganizeImportsCodeActionProvider implements qv.CodeActionProvider {
  public static readonly minVersion = API.v280;

  public constructor(private readonly client: ServiceClient, commandManager: CommandManager, private readonly fileConfigManager: FileConfigurationManager, telemetryReporter: TelemetryReporter) {
    commandManager.register(new OrganizeImportsCommand(client, telemetryReporter));
  }

  public readonly metadata: qv.CodeActionProviderMetadata = {
    providedCodeActionKinds: [qv.CodeActionKind.SourceOrganizeImports],
  };

  public provideCodeActions(document: qv.TextDocument, _range: qv.Range, context: qv.CodeActionContext, token: qv.CancellationToken): qv.CodeAction[] {
    const file = this.client.toOpenedFilePath(document);
    if (!file) {
      return [];
    }

    if (!context.only || !context.only.contains(qv.CodeActionKind.SourceOrganizeImports)) {
      return [];
    }

    this.fileConfigManager.ensureConfigurationForDocument(document, token);

    const action = new qv.CodeAction(localize('organizeImportsAction.title', 'Organize Imports'), qv.CodeActionKind.SourceOrganizeImports);
    action.command = { title: '', command: OrganizeImportsCommand.Id, arguments: [file] };
    return [action];
  }
}

export function register(
  selector: qu.DocumentSelector,
  client: ServiceClient,
  commandManager: CommandManager,
  fileConfigurationManager: FileConfigurationManager,
  telemetryReporter: TelemetryReporter
) {
  return condRegistration([requireMinVer(client, OrganizeImportsCodeActionProvider.minVersion), requireSomeCap(client, ClientCap.Semantic)], () => {
    const organizeImportsProvider = new OrganizeImportsCodeActionProvider(client, commandManager, fileConfigurationManager, telemetryReporter);
    return qv.languages.registerCodeActionsProvider(selector.semantic, organizeImportsProvider, organizeImportsProvider.metadata);
  });
}
