import { ClientCap, ServiceClient } from '../service';
import { Command, CommandMgr } from '../../old/ts/commands/commandMgr';
import { condRegistration, requireMinVer, requireSomeCap } from '../registration';
import { LearnMoreAboutRefactoringsCommand } from '../../old/ts/commands/learnMoreAboutRefactorings';
import { TelemetryReporter } from '../../old/ts/utils/telemetry';
import * as qu from '../utils';
import * as qv from 'vscode';
import API from '../../old/ts/utils/api';
import FormattingOptionsMgr from '../../old/ts/languageFeatures/fileConfigMgr';
import type * as qp from '../protocol';
interface DidApplyRefactoringCommand_Args {
  readonly codeAction: InlinedCodeAction;
}
class DidApplyRefactoringCommand implements Command {
  public static readonly ID = '_typescript.didApplyRefactoring';
  public readonly id = DidApplyRefactoringCommand.ID;
  constructor(private readonly telemetryReporter: TelemetryReporter) {}
  public async execute(args: DidApplyRefactoringCommand_Args): Promise<void> {
    /* __GDPR__
			"refactor.execute" : {
				"action" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
    this.telemetryReporter.logTelemetry('refactor.execute', {
      action: args.codeAction.action,
    });
    if (!args.codeAction.edit?.size) {
      qv.window.showErrorMessage('refactoringFailed');
      return;
    }
    const renameLocation = args.codeAction.renameLocation;
    if (renameLocation) {
      if (args.codeAction.document.uri.scheme !== qu.walkThroughSnippet) {
        await qv.commands.executeCommand('editor.action.rename', [args.codeAction.document.uri, qu.Position.fromLocation(renameLocation)]);
      }
    }
  }
}
interface SelectRefactorCommand_Args {
  readonly action: qv.CodeAction;
  readonly document: qv.TextDocument;
  readonly info: qp.ApplicableRefactorInfo;
  readonly rangeOrSelection: qv.Range | qv.Selection;
}
class SelectRefactorCommand implements Command {
  public static readonly ID = '_typescript.selectRefactoring';
  public readonly id = SelectRefactorCommand.ID;
  constructor(private readonly client: ServiceClient, private readonly didApplyCommand: DidApplyRefactoringCommand) {}
  public async execute(args: SelectRefactorCommand_Args): Promise<void> {
    const file = this.client.toOpenedFilePath(args.document);
    if (!file) return;
    const selected = await qv.window.showQuickPick(
      args.info.actions.map(
        (action): qv.QuickPickItem => ({
          label: action.name,
          description: action.description,
        })
      )
    );
    if (!selected) return;
    const tsAction = new InlinedCodeAction(this.client, args.action.title, args.action.kind, args.document, args.info.name, selected.label, args.rangeOrSelection);
    await tsAction.resolve(qu.nulToken);
    if (tsAction.edit) {
      if (!(await qv.workspace.applyEdit(tsAction.edit))) {
        qv.window.showErrorMessage('refactoringFailed');
        return;
      }
    }
    await this.didApplyCommand.execute({ codeAction: tsAction });
  }
}
interface CodeActionKind {
  readonly kind: qv.CodeActionKind;
  matches(refactor: qp.RefactorActionInfo): boolean;
}
const Extract_Function = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorExtract.append('function'),
  matches: (refactor) => refactor.name.startsWith('function_'),
});
const Extract_Constant = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorExtract.append('constant'),
  matches: (refactor) => refactor.name.startsWith('constant_'),
});
const Extract_Type = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorExtract.append('type'),
  matches: (refactor) => refactor.name.startsWith('Extract to type alias'),
});
const Extract_Interface = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorExtract.append('interface'),
  matches: (refactor) => refactor.name.startsWith('Extract to interface'),
});
const Move_NewFile = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.Refactor.append('move').append('newFile'),
  matches: (refactor) => refactor.name.startsWith('Move to a new file'),
});
const Rewrite_Import = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorRewrite.append('import'),
  matches: (refactor) => refactor.name.startsWith('Convert namespace import') || refactor.name.startsWith('Convert named imports'),
});
const Rewrite_Export = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorRewrite.append('export'),
  matches: (refactor) => refactor.name.startsWith('Convert default export') || refactor.name.startsWith('Convert named export'),
});
const Rewrite_Arrow_Braces = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorRewrite.append('arrow').append('braces'),
  matches: (refactor) => refactor.name.startsWith('Convert default export') || refactor.name.startsWith('Convert named export'),
});
const Rewrite_Parameters_ToDestructured = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorRewrite.append('parameters').append('toDestructured'),
  matches: (refactor) => refactor.name.startsWith('Convert parameters to destructured object'),
});
const Rewrite_Property_GenerateAccessors = Object.freeze<CodeActionKind>({
  kind: qv.CodeActionKind.RefactorRewrite.append('property').append('generateAccessors'),
  matches: (refactor) => refactor.name.startsWith("Generate 'get' and 'set' accessors"),
});
const allKnownCodeActionKinds = [
  Extract_Function,
  Extract_Constant,
  Extract_Type,
  Extract_Interface,
  Move_NewFile,
  Rewrite_Import,
  Rewrite_Export,
  Rewrite_Arrow_Braces,
  Rewrite_Parameters_ToDestructured,
  Rewrite_Property_GenerateAccessors,
];
class InlinedCodeAction extends qv.CodeAction {
  constructor(
    public readonly client: ServiceClient,
    title: string,
    kind: qv.CodeActionKind | undefined,
    public readonly document: qv.TextDocument,
    public readonly refactor: string,
    public readonly action: string,
    public readonly range: qv.Range
  ) {
    super(title, kind);
  }
  public renameLocation?: qp.Location;
  public async resolve(token: qv.CancellationToken): Promise<undefined> {
    const file = this.client.toOpenedFilePath(this.document);
    if (!file) return;
    const args: qp.GetEditsForRefactorRequestArgs = {
      ...qu.Range.toFileRangeRequestArgs(file, this.range),
      refactor: this.refactor,
      action: this.action,
    };
    const response = await this.client.execute('getEditsForRefactor', args, token);
    if (response.type !== 'response' || !response.body) return;
    this.edit = InlinedCodeAction.getWorkspaceEditForRefactoring(this.client, response.body);
    this.renameLocation = response.body.renameLocation;
    return;
  }
  private static getWorkspaceEditForRefactoring(client: ServiceClient, body: qp.RefactorEditInfo): qv.WorkspaceEdit {
    const workspaceEdit = new qv.WorkspaceEdit();
    for (const edit of body.edits) {
      const resource = client.toResource(edit.fileName);
      if (resource.scheme === qu.file) workspaceEdit.createFile(resource, { ignoreIfExists: true });
    }
    qu.WorkspaceEdit.withFileCodeEdits(workspaceEdit, client, body.edits);
    return workspaceEdit;
  }
}
class SelectCodeAction extends qv.CodeAction {
  constructor(info: qp.ApplicableRefactorInfo, document: qv.TextDocument, rangeOrSelection: qv.Range | qv.Selection) {
    super(info.description, qv.CodeActionKind.Refactor);
    this.command = {
      title: info.description,
      command: SelectRefactorCommand.ID,
      arguments: [<SelectRefactorCommand_Args>{ action: this, document, info, rangeOrSelection }],
    };
  }
}
type TsCodeAction = InlinedCodeAction | SelectCodeAction;
class TsRefactor implements qv.CodeActionProvider<TsCodeAction> {
  public static readonly minVersion = API.v240;
  constructor(private readonly client: ServiceClient, private readonly formattingOptionsMgr: FormattingOptionsMgr, commandMgr: CommandMgr, telemetryReporter: TelemetryReporter) {
    const didApplyRefactoringCommand = commandMgr.register(new DidApplyRefactoringCommand(telemetryReporter));
    commandMgr.register(new SelectRefactorCommand(this.client, didApplyRefactoringCommand));
  }
  public static readonly metadata: qv.CodeActionProviderMetadata = {
    providedCodeActionKinds: [qv.CodeActionKind.Refactor, ...allKnownCodeActionKinds.map((x) => x.kind)],
    documentation: [
      {
        kind: qv.CodeActionKind.Refactor,
        command: {
          command: LearnMoreAboutRefactoringsCommand.id,
          title: 'refactor.documentation.title',
        },
      },
    ],
  };
  public async provideCodeActions(
    document: qv.TextDocument,
    rangeOrSelection: qv.Range | qv.Selection,
    context: qv.CodeActionContext,
    token: qv.CancellationToken
  ): Promise<TsCodeAction[] | undefined> {
    if (!this.shouldTrigger(context)) return undefined;
    if (!this.client.toOpenedFilePath(document)) return undefined;
    const response = await this.client.interruptGetErr(() => {
      const file = this.client.toOpenedFilePath(document);
      if (!file) return undefined;
      this.formattingOptionsMgr.ensureConfigForDocument(document, token);
      const args: qp.GetApplicableRefactorsRequestArgs & { kind?: string } = {
        ...qu.Range.toFileRangeRequestArgs(file, rangeOrSelection),
        triggerReason: this.toTsTriggerReason(context),
        kind: context.only?.value,
      };
      return this.client.execute('getApplicableRefactors', args, token);
    });
    if (response?.type !== 'response' || !response.body) return undefined;
    const actions = this.convertApplicableRefactors(response.body, document, rangeOrSelection).filter((action) => {
      if (!context.only && action.kind?.value === 'refactor.rewrite.function.returnType') return false;
      return true;
    });
    if (!context.only) return actions;
    return this.pruneInvalidActions(this.appendInvalidActions(actions), context.only, /* numberOfInvalid = */ 5);
  }
  public async resolveCodeAction(codeAction: TsCodeAction, token: qv.CancellationToken): Promise<TsCodeAction> {
    if (codeAction instanceof InlinedCodeAction) await codeAction.resolve(token);
    return codeAction;
  }
  private toTsTriggerReason(context: qv.CodeActionContext): qp.RefactorTriggerReason | undefined {
    if (context.triggerKind === qv.CodeActionTriggerKind.Invoke) return 'invoked';
    return undefined;
  }
  private convertApplicableRefactors(body: qp.ApplicableRefactorInfo[], document: qv.TextDocument, rangeOrSelection: qv.Range | qv.Selection): TsCodeAction[] {
    const actions: TsCodeAction[] = [];
    for (const info of body) {
      if (info.inlineable === false) {
        const codeAction = new SelectCodeAction(info, document, rangeOrSelection);
        actions.push(codeAction);
      } else {
        for (const action of info.actions) {
          actions.push(this.refactorActionToCodeAction(action, document, info, rangeOrSelection, info.actions));
        }
      }
    }
    return actions;
  }
  private refactorActionToCodeAction(
    action: qp.RefactorActionInfo,
    document: qv.TextDocument,
    info: qp.ApplicableRefactorInfo,
    rangeOrSelection: qv.Range | qv.Selection,
    allActions: readonly qp.RefactorActionInfo[]
  ): InlinedCodeAction {
    const codeAction = new InlinedCodeAction(this.client, action.description, TsRefactor.getKind(action), document, info.name, action.name, rangeOrSelection);
    if (action.notApplicableReason) codeAction.disabled = { reason: action.notApplicableReason };
    else {
      codeAction.command = {
        title: action.description,
        command: DidApplyRefactoringCommand.ID,
        arguments: [<DidApplyRefactoringCommand_Args>{ codeAction }],
      };
    }
    codeAction.isPreferred = TsRefactor.isPreferred(action, allActions);
    return codeAction;
  }
  private shouldTrigger(context: qv.CodeActionContext) {
    if (context.only && !qv.CodeActionKind.Refactor.contains(context.only)) return false;
    return context.triggerKind === qv.CodeActionTriggerKind.Invoke;
  }
  private static getKind(refactor: qp.RefactorActionInfo) {
    if ((refactor as qp.RefactorActionInfo & { kind?: string }).kind) {
      return qv.CodeActionKind.Empty.append((refactor as qp.RefactorActionInfo & { kind?: string }).kind!);
    }
    const match = allKnownCodeActionKinds.find((kind) => kind.matches(refactor));
    return match ? match.kind : qv.CodeActionKind.Refactor;
  }
  private static isPreferred(action: qp.RefactorActionInfo, allActions: readonly qp.RefactorActionInfo[]): boolean {
    if (Extract_Constant.matches(action)) {
      const getScope = (name: string) => {
        const scope = name.match(/scope_(\d)/)?.[1];
        return scope ? +scope : undefined;
      };
      const scope = getScope(action.name);
      if (typeof scope !== 'number') return false;
      return allActions
        .filter((otherAtion) => otherAtion !== action && Extract_Constant.matches(otherAtion))
        .every((otherAction) => {
          const otherScope = getScope(otherAction.name);
          return typeof otherScope === 'number' ? scope < otherScope : true;
        });
    }
    if (Extract_Type.matches(action) || Extract_Interface.matches(action)) return true;
    return false;
  }
  private appendInvalidActions(actions: qv.CodeAction[]): qv.CodeAction[] {
    if (this.client.apiVersion.gte(API.v400)) return actions;
    if (!actions.some((action) => action.kind && Extract_Constant.kind.contains(action.kind))) {
      const disabledAction = new qv.CodeAction('extractConstant.disabled.title', Extract_Constant.kind);
      disabledAction.disabled = {
        reason: 'extractConstant.disabled.reason',
      };
      disabledAction.isPreferred = true;
      actions.push(disabledAction);
    }
    if (!actions.some((action) => action.kind && Extract_Function.kind.contains(action.kind))) {
      const disabledAction = new qv.CodeAction('extractFunction.disabled.title', Extract_Function.kind);
      disabledAction.disabled = {
        reason: 'extractFunction.disabled.reason',
      };
      actions.push(disabledAction);
    }
    return actions;
  }
  private pruneInvalidActions(actions: qv.CodeAction[], only?: qv.CodeActionKind, numberOfInvalid?: number): qv.CodeAction[] {
    const availableActions: qv.CodeAction[] = [];
    const invalidCommonActions: qv.CodeAction[] = [];
    const invalidUncommonActions: qv.CodeAction[] = [];
    for (const action of actions) {
      if (!action.disabled) {
        availableActions.push(action);
        continue;
      }
      if (action.kind && (Extract_Constant.kind.contains(action.kind) || Extract_Function.kind.contains(action.kind))) {
        invalidCommonActions.push(action);
        continue;
      }
      invalidUncommonActions.push(action);
    }
    const prioritizedActions: qv.CodeAction[] = [];
    prioritizedActions.push(...invalidCommonActions);
    prioritizedActions.push(...invalidUncommonActions);
    const topNInvalid = prioritizedActions.filter((action) => !only || (action.kind && only.contains(action.kind))).slice(0, numberOfInvalid);
    availableActions.push(...topNInvalid);
    return availableActions;
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient, formattingOptionsMgr: FormattingOptionsMgr, commandMgr: CommandMgr, telemetryReporter: TelemetryReporter) {
  return condRegistration([requireMinVer(c, TsRefactor.minVersion), requireSomeCap(c, ClientCap.Semantic)], () => {
    return qv.languages.registerCodeActionsProvider(s.semantic, new TsRefactor(c, formattingOptionsMgr, commandMgr, telemetryReporter), TsRefactor.metadata);
  });
}

export class GoRefactor implements qv.CodeActionProvider {
  public provideCodeActions(document: qv.TextDocument, range: qv.Range, context: qv.CodeActionContext, token: qv.CancellationToken): qv.ProviderResult<qv.CodeAction[]> {
    if (range.isEmpty) return [];
    const extractFunction = new qv.CodeAction('Extract to function in package scope', qv.CodeActionKind.RefactorExtract);
    const extractVar = new qv.CodeAction('Extract to variable in local scope', qv.CodeActionKind.RefactorExtract);
    extractFunction.command = {
      title: 'Extract to function in package scope',
      command: 'go.godoctor.extract',
    };
    extractVar.command = {
      title: 'Extract to variable in local scope',
      command: 'go.godoctor.var',
    };
    return [extractFunction, extractVar];
  }
}
