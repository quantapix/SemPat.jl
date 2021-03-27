import { ClientCap, ServiceClient } from '../service';
import { Command, CommandManager } from '../../old/ts/commands/commandManager';
import { condRegistration, requireSomeCap } from '../registration';
import { DiagnosticsManager } from '../../old/ts/languageFeatures/diagnostics';
import { TelemetryReporter } from '../../old/ts/utils/telemetry';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import FileConfigurationManager from '../../old/ts/languageFeatures/fileConfigurationManager';
import type * as qp from '../protocol';

class ApplyCodeActionCommand implements Command {
  public static readonly ID = '_typescript.applyCodeActionCommand';
  public readonly id = ApplyCodeActionCommand.ID;
  constructor(private readonly client: ServiceClient, private readonly telemetryReporter: TelemetryReporter) {}
  public async execute(action: qp.CodeFixAction): Promise<boolean> {
    /* __GDPR__
			"quickFix.execute" : {
				"fixName" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
    this.telemetryReporter.logTelemetry('quickFix.execute', {
      fixName: action.fixName,
    });
    return qu.applyCodeActionCommands(this.client, action.commands, qu.nulToken);
  }
}

type ApplyFixAllCodeAction_args = {
  readonly action: VsCodeFixAllCodeAction;
};

class ApplyFixAllCodeAction implements Command {
  public static readonly ID = '_typescript.applyFixAllCodeAction';
  public readonly id = ApplyFixAllCodeAction.ID;
  constructor(private readonly client: ServiceClient, private readonly telemetryReporter: TelemetryReporter) {}
  public async execute(args: ApplyFixAllCodeAction_args): Promise<void> {
    /* __GDPR__
			"quickFixAll.execute" : {
				"fixName" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
    this.telemetryReporter.logTelemetry('quickFixAll.execute', {
      fixName: args.action.tsAction.fixName,
    });
    if (args.action.combinedResponse) {
      await qu.applyCodeActionCommands(this.client, args.action.combinedResponse.body.commands, qu.nulToken);
    }
  }
}

class DiagnosticsSet {
  public static from(diagnostics: qv.Diagnostic[]) {
    const values = new Map<string, qv.Diagnostic>();
    for (const diagnostic of diagnostics) {
      values.set(DiagnosticsSet.key(diagnostic), diagnostic);
    }
    return new DiagnosticsSet(values);
  }
  private static key(diagnostic: qv.Diagnostic) {
    const { start, end } = diagnostic.range;
    return `${diagnostic.code}-${start.line},${start.character}-${end.line},${end.character}`;
  }
  private constructor(private readonly _values: Map<string, qv.Diagnostic>) {}
  public get values(): Iterable<qv.Diagnostic> {
    return this._values.values();
  }
  public get size() {
    return this._values.size;
  }
}

class VsCodeCodeAction extends qv.CodeAction {
  constructor(public readonly tsAction: qp.CodeFixAction, title: string, kind: qv.CodeActionKind) {
    super(title, kind);
  }
}

class VsCodeFixAllCodeAction extends VsCodeCodeAction {
  constructor(tsAction: qp.CodeFixAction, public readonly file: string, title: string, kind: qv.CodeActionKind) {
    super(tsAction, title, kind);
  }
  public combinedResponse?: qp.GetCombinedCodeFixResponse;
}

class CodeActionSet {
  private readonly _actions = new Set<VsCodeCodeAction>();
  private readonly _fixAllActions = new Map<{}, VsCodeCodeAction>();
  public get values(): Iterable<VsCodeCodeAction> {
    return this._actions;
  }
  public addAction(action: VsCodeCodeAction) {
    for (const existing of this._actions) {
      if (action.tsAction.fixName === existing.tsAction.fixName && qu.equals(action.edit, existing.edit)) {
        this._actions.delete(existing);
      }
    }
    this._actions.add(action);
    if (action.tsAction.fixId) {
      const existingFixAll = this._fixAllActions.get(action.tsAction.fixId);
      if (existingFixAll) {
        this._actions.delete(existingFixAll);
        this._actions.add(existingFixAll);
      }
    }
  }
  public addFixAllAction(fixId: {}, action: VsCodeCodeAction) {
    const existing = this._fixAllActions.get(fixId);
    if (existing) this._actions.delete(existing);
    this.addAction(action);
    this._fixAllActions.set(fixId, action);
  }
  public hasFixAllAction(fixId: {}) {
    return this._fixAllActions.has(fixId);
  }
}

class SupportedCodeActionProvider {
  public constructor(private readonly client: ServiceClient) {}
  public async getFixableDiagnosticsForContext(context: qv.CodeActionContext): Promise<DiagnosticsSet> {
    const fixableCodes = await this.fixableDiagnosticCodes;
    return DiagnosticsSet.from(context.diagnostics.filter((diagnostic) => typeof diagnostic.code !== 'undefined' && fixableCodes.has(diagnostic.code + '')));
  }
  @qu.memoize
  private get fixableDiagnosticCodes(): Thenable<Set<string>> {
    return this.client
      .execute('getSupportedCodeFixes', null, qu.nulToken)
      .then((response) => (response.type === 'response' ? response.body || [] : []))
      .then((codes) => new Set(codes));
  }
}

class QuickFix implements qv.CodeActionProvider<VsCodeCodeAction> {
  public static readonly metadata: qv.CodeActionProviderMetadata = {
    providedCodeActionKinds: [qv.CodeActionKind.QuickFix],
  };
  private readonly supportedCodeActionProvider: SupportedCodeActionProvider;
  constructor(
    private readonly client: ServiceClient,
    private readonly formattingConfigurationManager: FileConfigurationManager,
    commandManager: CommandManager,
    private readonly diagnosticsManager: DiagnosticsManager,
    telemetryReporter: TelemetryReporter
  ) {
    commandManager.register(new ApplyCodeActionCommand(client, telemetryReporter));
    commandManager.register(new ApplyFixAllCodeAction(client, telemetryReporter));
    this.supportedCodeActionProvider = new SupportedCodeActionProvider(client);
  }

  public async provideCodeActions(document: qv.TextDocument, _range: qv.Range, context: qv.CodeActionContext, token: qv.CancellationToken): Promise<VsCodeCodeAction[]> {
    const file = this.client.toOpenedFilePath(document);
    if (!file) return [];
    const fixableDiagnostics = await this.supportedCodeActionProvider.getFixableDiagnosticsForContext(context);
    if (!fixableDiagnostics.size) return [];
    if (this.client.bufferSyncSupport.hasPendingDiagnostics(document.uri)) return [];
    await this.formattingConfigurationManager.ensureConfigurationForDocument(document, token);
    const results = new CodeActionSet();
    for (const diagnostic of fixableDiagnostics.values) {
      await this.getFixesForDiagnostic(document, file, diagnostic, results, token);
    }
    const allActions = Array.from(results.values);
    for (const action of allActions) {
      action.isPreferred = isPreferredFix(action, allActions);
    }
    return allActions;
  }

  public async resolveCodeAction(codeAction: VsCodeCodeAction, token: qv.CancellationToken): Promise<VsCodeCodeAction> {
    if (!(codeAction instanceof VsCodeFixAllCodeAction) || !codeAction.tsAction.fixId) return codeAction;
    const arg: qp.GetCombinedCodeFixRequestArgs = {
      scope: {
        type: 'file',
        args: { file: codeAction.file },
      },
      fixId: codeAction.tsAction.fixId,
    };
    const response = await this.client.execute('getCombinedCodeFix', arg, token);
    if (response.type === 'response') {
      codeAction.combinedResponse = response;
      codeAction.edit = qu.WorkspaceEdit.fromFileCodeEdits(this.client, response.body.changes);
    }
    return codeAction;
  }

  private async getFixesForDiagnostic(document: qv.TextDocument, file: string, diagnostic: qv.Diagnostic, results: CodeActionSet, token: qv.CancellationToken): Promise<CodeActionSet> {
    const args: qp.CodeFixRequestArgs = {
      ...qu.Range.toFileRangeRequestArgs(file, diagnostic.range),
      errorCodes: [+diagnostic.code!],
    };
    const response = await this.client.execute('getCodeFixes', args, token);
    if (response.type !== 'response' || !response.body) return results;
    for (const tsCodeFix of response.body) {
      this.addAllFixesForTsCodeAction(results, document, file, diagnostic, tsCodeFix as qp.CodeFixAction);
    }
    return results;
  }

  private addAllFixesForTsCodeAction(results: CodeActionSet, document: qv.TextDocument, file: string, diagnostic: qv.Diagnostic, tsAction: qp.CodeFixAction): CodeActionSet {
    results.addAction(this.getSingleFixForTsCodeAction(diagnostic, tsAction));
    this.addFixAllForTsCodeAction(results, document, file, diagnostic, tsAction as qp.CodeFixAction);
    return results;
  }

  private getSingleFixForTsCodeAction(diagnostic: qv.Diagnostic, tsAction: qp.CodeFixAction): VsCodeCodeAction {
    const codeAction = new VsCodeCodeAction(tsAction, tsAction.description, qv.CodeActionKind.QuickFix);
    codeAction.edit = qu.getEditForCodeAction(this.client, tsAction);
    codeAction.diagnostics = [diagnostic];
    codeAction.command = {
      command: ApplyCodeActionCommand.ID,
      arguments: [tsAction],
      title: '',
    };
    return codeAction;
  }

  private addFixAllForTsCodeAction(results: CodeActionSet, document: qv.TextDocument, file: string, diagnostic: qv.Diagnostic, tsAction: qp.CodeFixAction): CodeActionSet {
    if (!tsAction.fixId || this.client.apiVersion.lt(API.v270) || results.hasFixAllAction(tsAction.fixId)) return results;
    if (
      !this.diagnosticsManager.getDiagnostics(document.uri).some((x) => {
        if (x === diagnostic) return false;
        return x.code === diagnostic.code || (fixAllErrorCodes.has(x.code as number) && fixAllErrorCodes.get(x.code as number) === fixAllErrorCodes.get(diagnostic.code as number));
      })
    ) {
      return results;
    }
    const action = new VsCodeFixAllCodeAction(tsAction, file, tsAction.fixAllDescription || 'fixAllInFileLabel', qv.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.command = {
      command: ApplyFixAllCodeAction.ID,
      arguments: [<ApplyFixAllCodeAction_args>{ action }],
      title: '',
    };
    results.addFixAllAction(tsAction.fixId, action);
    return results;
  }
}

const fixAllErrorCodes = new Map<number, number>([
  // Missing async
  [2339, 2339],
  [2345, 2339],
]);

const preferredFixes = new Map<string, { readonly priority: number; readonly thereCanOnlyBeOne?: boolean }>([
  [qu.addMissingAwait, { priority: 2 }],
  [qu.annotateWithTypeFromJSDoc, { priority: 2 }],
  [qu.awaitInSyncFunction, { priority: 2 }],
  [qu.classDoesntImplementInheritedAbstractMember, { priority: 3 }],
  [qu.classIncorrectlyImplementsInterface, { priority: 3 }],
  [qu.constructorForDerivedNeedSuperCall, { priority: 2 }],
  [qu.extendsInterfaceBecomesImplements, { priority: 2 }],
  [qu.fixImport, { priority: 1, thereCanOnlyBeOne: true }],
  [qu.fixUnreachableCode, { priority: 2 }],
  [qu.forgottenThisPropertyAccess, { priority: 2 }],
  [qu.spelling, { priority: 0 }],
  [qu.unusedIdentifier, { priority: 2 }],
]);

function isPreferredFix(action: VsCodeCodeAction, allActions: readonly VsCodeCodeAction[]): boolean {
  if (action instanceof VsCodeFixAllCodeAction) return false;
  const fixPriority = preferredFixes.get(action.tsAction.fixName);
  if (!fixPriority) return false;
  return allActions.every((otherAction) => {
    if (otherAction === action) return true;
    if (otherAction instanceof VsCodeFixAllCodeAction) return true;
    const otherFixPriority = preferredFixes.get(otherAction.tsAction.fixName);
    if (!otherFixPriority || otherFixPriority.priority < fixPriority.priority) return true;
    else if (otherFixPriority.priority > fixPriority.priority) return false;
    if (fixPriority.thereCanOnlyBeOne && action.tsAction.fixName === otherAction.tsAction.fixName) return false;
    return true;
  });
}

export function register(
  s: qu.DocumentSelector,
  c: ServiceClient,
  fileConfigurationManager: FileConfigurationManager,
  commandManager: CommandManager,
  diagnosticsManager: DiagnosticsManager,
  telemetryReporter: TelemetryReporter
) {
  return condRegistration([requireSomeCap(c, ClientCap.Semantic)], () => {
    return qv.languages.registerCodeActionsProvider(s.semantic, new QuickFix(c, fileConfigurationManager, commandManager, diagnosticsManager, telemetryReporter), QuickFix.metadata);
  });
}
