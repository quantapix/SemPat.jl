import * as qv from 'vscode';
import { Command, CommandMgr } from '../commands/commandMgr';
import type * as qp from '../server/proto';
import * as qk from '../utils/key';
import { ClientCap, ServiceClient, ServerResponse } from '../service';
import API from '../utils/api';
import { nulToken } from '../utils/cancellation';
import { applyCodeAction } from '../utils/codeAction';
import { conditionalRegistration, requireConfig, requireSomeCap } from '../../../src/registration';
import { DocumentSelector } from '../utils/documentSelector';
import { parseKindModifier } from '../utils/modifiers';
import * as Previewer from '../utils/previewer';
import { snippetForFunctionCall } from '../utils/snippetForFunctionCall';
import { TelemetryReporter } from '../utils/telemetry';
import * as qu from '../utils/qu';
import TypingsStatus from '../utils/typingsStatus';
import FileConfigMgr from './fileConfig';
interface DotAccessorContext {
  readonly range: qv.Range;
  readonly text: string;
}
interface CompletionContext {
  readonly isNewIdentifierLocation: boolean;
  readonly isMemberCompletion: boolean;
  readonly isInValidCommitCharacterContext: boolean;
  readonly dotAccessorContext?: DotAccessorContext;
  readonly enableCallCompletions: boolean;
  readonly useCodeSnippetsOnMethodSuggest: boolean;
  readonly wordRange: qv.Range | undefined;
  readonly line: string;
  readonly useFuzzyWordRangeLogic: boolean;
}
type ResolvedCompletionItem = {
  readonly edits?: readonly qv.TextEdit[];
  readonly commands: readonly qv.Command[];
};
class MyCompletionItem extends qv.CompletionItem {
  public readonly useCodeSnippet: boolean;
  constructor(
    public readonly position: qv.Position,
    public readonly document: qv.TextDocument,
    public readonly tsEntry: qp.CompletionEntry,
    private readonly completionContext: CompletionContext,
    public readonly metadata: any | undefined
  ) {
    super(tsEntry.name, MyCompletionItem.convertKind(tsEntry.kind));
    if (tsEntry.source) {
      this.sortText = '\uffff' + tsEntry.sortText;
      const qualifierCandidate = qv.workspace.asRelativePath(tsEntry.source);
      if (qualifierCandidate !== tsEntry.source) this.label2 = { name: tsEntry.name, qualifier: qualifierCandidate };
    } else {
      this.sortText = tsEntry.sortText;
    }
    this.preselect = tsEntry.isRecommended;
    this.position = position;
    this.useCodeSnippet = completionContext.useCodeSnippetsOnMethodSuggest && (this.kind === qv.CompletionItemKind.Function || this.kind === qv.CompletionItemKind.Method);
    this.range = this.getRangeFromReplacementSpan(tsEntry, completionContext);
    this.commitCharacters = MyCompletionItem.getCommitCharacters(completionContext, tsEntry);
    this.insertText = tsEntry.insertText;
    this.filterText = this.getFilterText(completionContext.line, tsEntry.insertText);
    if (completionContext.isMemberCompletion && completionContext.dotAccessorContext) {
      this.filterText = completionContext.dotAccessorContext.text + (this.insertText || this.label);
      if (!this.range) {
        const replacementRange = this.getFuzzyWordRange();
        if (replacementRange) this.range = { inserting: completionContext.dotAccessorContext.range, replacing: completionContext.dotAccessorContext.range.union(replacementRange) };
        else this.range = completionContext.dotAccessorContext.range;

        this.insertText = this.filterText;
      }
    }
    if (tsEntry.kindModifiers) {
      const kindModifiers = parseKindModifier(tsEntry.kindModifiers);
      if (kindModifiers.has(qk.KindModifiers.optional)) {
        if (!this.insertText) this.insertText = this.label;
        if (!this.filterText) this.filterText = this.label;
        this.label += '?';
      }
      if (kindModifiers.has(qk.KindModifiers.depreacted)) {
        this.tags = [qv.CompletionItemTag.Deprecated];
      }
      if (kindModifiers.has(qk.KindModifiers.color)) {
        this.kind = qv.CompletionItemKind.Color;
      }
      if (tsEntry.kind === qk.Kind.script) {
        for (const extModifier of qk.KindModifiers.fileExtensionKindModifiers) {
          if (kindModifiers.has(extModifier)) {
            if (tsEntry.name.toLowerCase().endsWith(extModifier)) this.detail = tsEntry.name;
            else this.detail = tsEntry.name + extModifier;

            break;
          }
        }
      }
    }
    this.resolveRange();
  }
  private _resolvedPromise?: {
    readonly requestToken: qv.CancellationTokenSource;
    readonly promise: Promise<ResolvedCompletionItem | undefined>;
    waiting: number;
  };
  public async resolveCompletionItem(client: ServiceClient, token: qv.CancellationToken): Promise<ResolvedCompletionItem | undefined> {
    token.onCancellationRequested(() => {
      if (this._resolvedPromise && --this._resolvedPromise.waiting <= 0) {
        setTimeout(() => {
          if (this._resolvedPromise && this._resolvedPromise.waiting <= 0) this._resolvedPromise.requestToken.cancel();
        }, 300);
      }
    });
    if (this._resolvedPromise) {
      ++this._resolvedPromise.waiting;
      return this._resolvedPromise.promise;
    }
    const requestToken = new qv.CancellationTokenSource();
    const promise = (async (): Promise<ResolvedCompletionItem | undefined> => {
      const filepath = client.toOpenedFilePath(this.document);
      if (!filepath) return undefined;
      const args: qp.CompletionDetailsRequestArgs = {
        ...qu.Position.toFileLocationRequestArgs(filepath, this.position),
        entryNames: [
          this.tsEntry.source || this.tsEntry.data
            ? {
                name: this.tsEntry.name,
                source: this.tsEntry.source,
                data: this.tsEntry.data,
              }
            : this.tsEntry.name,
        ],
      };
      const response = await client.interruptGetErr(() => client.execute('completionEntryDetails', args, requestToken.token));
      if (response.type !== 'response' || !response.body || !response.body.length) return undefined;
      const detail = response.body[0];
      if (!this.detail && detail.displayParts.length) this.detail = Previewer.plain(detail.displayParts);
      this.documentation = this.getDocumentation(detail, this);
      const codeAction = this.getCodeActions(detail, filepath);
      const commands: qv.Command[] = [
        {
          command: CompletionAcceptedCommand.ID,
          title: '',
          arguments: [this],
        },
      ];
      if (codeAction.command) commands.push(codeAction.command);
      const additionalTextEdits = codeAction.additionalTextEdits;
      if (this.useCodeSnippet) {
        const shouldCompleteFunction = await this.isValidFunctionCompletionContext(client, filepath, this.position, this.document, token);
        if (shouldCompleteFunction) {
          const { snippet, parameterCount } = snippetForFunctionCall(this, detail.displayParts);
          this.insertText = snippet;
          if (parameterCount > 0) {
            if (qv.workspace.getConfig('editor.parameterHints').get('enabled')) commands.push({ title: 'triggerParameterHints', command: 'editor.action.triggerParameterHints' });
          }
        }
      }
      return { commands, edits: additionalTextEdits };
    })();
    this._resolvedPromise = {
      promise,
      requestToken,
      waiting: 1,
    };
    return this._resolvedPromise.promise;
  }
  private getDocumentation(detail: qp.CompletionEntryDetails, item: MyCompletionItem): qv.MarkdownString | undefined {
    const documentation = new qv.MarkdownString();
    if (detail.source) {
      const importPath = `'${Previewer.plain(detail.source)}'`;
      const autoImportLabel = 'autoImportLabel';
      item.detail = `${autoImportLabel}\n${item.detail}`;
    }
    Previewer.addMarkdownDocumentation(documentation, detail.documentation, detail.tags);
    return documentation.value.length ? documentation : undefined;
  }
  private async isValidFunctionCompletionContext(client: ServiceClient, filepath: string, position: qv.Position, document: qv.TextDocument, token: qv.CancellationToken): Promise<boolean> {
    try {
      const args: qp.FileLocationRequestArgs = qu.Position.toFileLocationRequestArgs(filepath, position);
      const response = await client.execute('quickinfo', args, token);
      if (response.type === 'response' && response.body) {
        switch (response.body.kind) {
          case 'var':
          case 'let':
          case 'const':
          case 'alias':
            return false;
        }
      }
    } catch {}
    const after = document.lineAt(position.line).text.slice(position.character);
    return after.match(/^[a-z_$0-9]*\s*\(/gi) === null;
  }
  private getCodeActions(detail: qp.CompletionEntryDetails, filepath: string): { command?: qv.Command; additionalTextEdits?: qv.TextEdit[] } {
    if (!detail.codeActions || !detail.codeActions.length) return {};
    const additionalTextEdits: qv.TextEdit[] = [];
    let hasRemainingCommandsOrEdits = false;
    for (const tsAction of detail.codeActions) {
      if (tsAction.commands) hasRemainingCommandsOrEdits = true;
      if (tsAction.changes) {
        for (const change of tsAction.changes) {
          if (change.fileName === filepath) additionalTextEdits.push(...change.textChanges.map(qu.TextEdit.fromCodeEdit));
          else hasRemainingCommandsOrEdits = true;
        }
      }
    }
    let command: qv.Command | undefined = undefined;
    if (hasRemainingCommandsOrEdits) {
      command = {
        title: '',
        command: ApplyCompletionCodeActionCommand.ID,
        arguments: [
          filepath,
          detail.codeActions.map(
            (x): qp.CodeAction => ({
              commands: x.commands,
              description: x.description,
              changes: x.changes.filter((x) => x.fileName !== filepath),
            })
          ),
        ],
      };
    }
    return {
      command,
      additionalTextEdits: additionalTextEdits.length ? additionalTextEdits : undefined,
    };
  }
  private getRangeFromReplacementSpan(tsEntry: qp.CompletionEntry, completionContext: CompletionContext) {
    if (!tsEntry.replacementSpan) return;
    let replaceRange = qu.Range.fromTextSpan(tsEntry.replacementSpan);
    if (!replaceRange.isSingleLine) replaceRange = new qv.Range(replaceRange.start.line, replaceRange.start.character, replaceRange.start.line, completionContext.line.length);
    return {
      inserting: replaceRange,
      replacing: replaceRange,
    };
  }
  private getFilterText(line: string, insertText: string | undefined): string | undefined {
    if (this.tsEntry.name.startsWith('#')) {
      const wordRange = this.completionContext.wordRange;
      const wordStart = wordRange ? line.charAt(wordRange.start.character) : undefined;
      if (insertText) {
        if (insertText.startsWith('this.#')) return wordStart === '#' ? insertText : insertText.replace(/^this\.#/, '');
        else return insertText;
      } else {
        return wordStart === '#' ? undefined : this.tsEntry.name.replace(/^#/, '');
      }
    }
    if (insertText?.startsWith('this.')) {
      return undefined;
    } else if (insertText?.startsWith('[')) {
      return insertText.replace(/^\[['"](.+)[['"]\]$/, '.$1');
    }
    return insertText;
  }
  private resolveRange(): void {
    if (this.range) return;
    const replaceRange = this.getFuzzyWordRange();
    if (replaceRange)
      this.range = {
        inserting: new qv.Range(replaceRange.start, this.position),
        replacing: replaceRange,
      };
  }
  private getFuzzyWordRange() {
    if (this.completionContext.useFuzzyWordRangeLogic) {
      const text = this.completionContext.line.slice(Math.max(0, this.position.character - this.label.length), this.position.character).toLowerCase();
      const entryName = this.label.toLowerCase();
      for (let i = entryName.length; i >= 0; --i) {
        if (text.endsWith(entryName.substr(0, i)) && (!this.completionContext.wordRange || this.completionContext.wordRange.start.character > this.position.character - i)) {
          return new qv.Range(new qv.Position(this.position.line, Math.max(0, this.position.character - i)), this.position);
        }
      }
    }
    return this.completionContext.wordRange;
  }
  private static convertKind(kind: string): qv.CompletionItemKind {
    switch (kind) {
      case qk.Kind.primitiveType:
      case qk.Kind.keyword:
        return qv.CompletionItemKind.Keyword;
      case qk.Kind.const:
      case qk.Kind.let:
      case qk.Kind.variable:
      case qk.Kind.localVariable:
      case qk.Kind.alias:
      case qk.Kind.parameter:
        return qv.CompletionItemKind.Variable;
      case qk.Kind.memberVariable:
      case qk.Kind.memberGetAccessor:
      case qk.Kind.memberSetAccessor:
        return qv.CompletionItemKind.Field;
      case qk.Kind.function:
      case qk.Kind.localFunction:
        return qv.CompletionItemKind.Function;
      case qk.Kind.method:
      case qk.Kind.constructSignature:
      case qk.Kind.callSignature:
      case qk.Kind.indexSignature:
        return qv.CompletionItemKind.Method;
      case qk.Kind.enum:
        return qv.CompletionItemKind.Enum;
      case qk.Kind.enumMember:
        return qv.CompletionItemKind.EnumMember;
      case qk.Kind.module:
      case qk.Kind.externalModuleName:
        return qv.CompletionItemKind.Module;
      case qk.Kind.class:
      case qk.Kind.type:
        return qv.CompletionItemKind.Class;
      case qk.Kind.interface:
        return qv.CompletionItemKind.Interface;
      case qk.Kind.warning:
        return qv.CompletionItemKind.Text;
      case qk.Kind.script:
        return qv.CompletionItemKind.File;
      case qk.Kind.directory:
        return qv.CompletionItemKind.Folder;
      case qk.Kind.string:
        return qv.CompletionItemKind.Constant;
      default:
        return qv.CompletionItemKind.Property;
    }
  }
  private static getCommitCharacters(context: CompletionContext, entry: qp.CompletionEntry): string[] | undefined {
    if (context.isNewIdentifierLocation || !context.isInValidCommitCharacterContext) return undefined;
    const commitCharacters: string[] = [];
    switch (entry.kind) {
      case qk.Kind.memberGetAccessor:
      case qk.Kind.memberSetAccessor:
      case qk.Kind.constructSignature:
      case qk.Kind.callSignature:
      case qk.Kind.indexSignature:
      case qk.Kind.enum:
      case qk.Kind.interface:
        commitCharacters.push('.', ';');
        break;
      case qk.Kind.module:
      case qk.Kind.alias:
      case qk.Kind.const:
      case qk.Kind.let:
      case qk.Kind.variable:
      case qk.Kind.localVariable:
      case qk.Kind.memberVariable:
      case qk.Kind.class:
      case qk.Kind.function:
      case qk.Kind.method:
      case qk.Kind.keyword:
      case qk.Kind.parameter:
        commitCharacters.push('.', ',', ';');
        if (context.enableCallCompletions) commitCharacters.push('(');
        break;
    }
    return commitCharacters.length === 0 ? undefined : commitCharacters;
  }
}
class CompositeCommand implements Command {
  public static readonly ID = '_typescript.composite';
  public readonly id = CompositeCommand.ID;
  public execute(...commands: qv.Command[]) {
    for (const command of commands) {
      qv.commands.executeCommand(command.command, ...(command.arguments || []));
    }
  }
}
class CompletionAcceptedCommand implements Command {
  public static readonly ID = '_typescript.onCompletionAccepted';
  public readonly id = CompletionAcceptedCommand.ID;
  public constructor(private readonly onCompletionAccepted: (item: qv.CompletionItem) => void, private readonly telemetryReporter: TelemetryReporter) {}
  public execute(item: qv.CompletionItem) {
    this.onCompletionAccepted(item);
    if (item instanceof MyCompletionItem) {
      /* __GDPR__
				"completions.accept" : {
					"isPackageJsonImport" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"${include}": [
						"${TypeScriptCommonProperties}"
					]
				}
			*/
      this.telemetryReporter.logTelemetry('completions.accept', {
        isPackageJsonImport: item.tsEntry.isPackageJsonImport ? 'true' : undefined,
      });
    }
  }
}
class ApplyCompletionCommand implements Command {
  public static readonly ID = '_typescript.applyCompletionCommand';
  public readonly id = ApplyCompletionCommand.ID;
  public constructor(private readonly client: ServiceClient) {}
  public async execute(item: MyCompletionItem) {
    const resolved = await item.resolveCompletionItem(this.client, nulToken);
    if (!resolved) return;
    const { edits, commands } = resolved;
    if (edits) {
      const workspaceEdit = new qv.WorkspaceEdit();
      for (const edit of edits) {
        workspaceEdit.replace(item.document.uri, edit.range, edit.newText);
      }
      await qv.workspace.applyEdit(workspaceEdit);
    }
    for (const command of commands) {
      await qv.commands.executeCommand(command.command, ...(command.arguments ?? []));
    }
  }
}
class ApplyCompletionCodeActionCommand implements Command {
  public static readonly ID = '_typescript.applyCompletionCodeAction';
  public readonly id = ApplyCompletionCodeActionCommand.ID;
  public constructor(private readonly client: ServiceClient) {}
  public async execute(_file: string, codeActions: qp.CodeAction[]): Promise<boolean> {
    if (codeActions.length === 0) return true;
    if (codeActions.length === 1) return applyCodeAction(this.client, codeActions[0], nulToken);
    const selection = await qv.window.showQuickPick(
      codeActions.map((action) => ({
        label: action.description,
        description: '',
        action,
      })),
      {
        placeHolder: 'selectCodeAction',
      }
    );
    if (selection) return applyCodeAction(this.client, selection.action, nulToken);
    return false;
  }
}
interface CompletionConfig {
  readonly useCodeSnippetsOnMethodSuggest: boolean;
  readonly nameSuggestions: boolean;
  readonly pathSuggestions: boolean;
  readonly autoImportSuggestions: boolean;
}
namespace CompletionConfig {
  export const useCodeSnippetsOnMethodSuggest = 'suggest.completeFunctionCalls';
  export const nameSuggestions = 'suggest.names';
  export const pathSuggestions = 'suggest.paths';
  export const autoImportSuggestions = 'suggest.autoImports';
  export function getConfigForResource(modeId: string, resource: qv.Uri): CompletionConfig {
    const config = qv.workspace.getConfig(modeId, resource);
    return {
      useCodeSnippetsOnMethodSuggest: config.get<boolean>(CompletionConfig.useCodeSnippetsOnMethodSuggest, false),
      pathSuggestions: config.get<boolean>(CompletionConfig.pathSuggestions, true),
      autoImportSuggestions: config.get<boolean>(CompletionConfig.autoImportSuggestions, true),
      nameSuggestions: config.get<boolean>(CompletionConfig.nameSuggestions, true),
    };
  }
}
class TypeScriptCompletionItemProvider implements qv.CompletionItemProvider<MyCompletionItem> {
  public static readonly triggerCharacters = ['.', '"', "'", '`', '/', '@', '<', '#'];
  constructor(
    private readonly client: ServiceClient,
    private readonly modeId: string,
    private readonly typingsStatus: TypingsStatus,
    private readonly fileConfigMgr: FileConfigMgr,
    commandMgr: CommandMgr,
    private readonly telemetryReporter: TelemetryReporter,
    onCompletionAccepted: (item: qv.CompletionItem) => void
  ) {
    commandMgr.register(new ApplyCompletionCodeActionCommand(this.client));
    commandMgr.register(new CompositeCommand());
    commandMgr.register(new CompletionAcceptedCommand(onCompletionAccepted, this.telemetryReporter));
    commandMgr.register(new ApplyCompletionCommand(this.client));
  }
  public async provideCompletionItems(
    document: qv.TextDocument,
    position: qv.Position,
    token: qv.CancellationToken,
    context: qv.CompletionContext
  ): Promise<qv.CompletionList<MyCompletionItem> | undefined> {
    if (this.typingsStatus.isAcquiringTypings) {
      return Promise.reject<qv.CompletionList<MyCompletionItem>>({
        label: 'acquiringTypingsLabel',
        detail: 'acquiringTypingsDetail',
      });
    }
    const file = this.client.toOpenedFilePath(document);
    if (!file) return undefined;
    const line = document.lineAt(position.line);
    const completionConfig = CompletionConfig.getConfigForResource(this.modeId, document.uri);
    if (!this.shouldTrigger(context, line, position)) {
      return undefined;
    }
    const wordRange = document.getWordRangeAtPosition(position);
    await this.client.interruptGetErr(() => this.fileConfigMgr.ensureConfigForDocument(document, token));
    const args: qp.CompletionsRequestArgs = {
      ...qu.Position.toFileLocationRequestArgs(file, position),
      includeExternalModuleExports: completionConfig.autoImportSuggestions,
      includeInsertTextCompletions: true,
      triggerCharacter: this.getTsTriggerCharacter(context),
    };
    let isNewIdentifierLocation = true;
    let isIncomplete = false;
    let isMemberCompletion = false;
    let dotAccessorContext: DotAccessorContext | undefined;
    let entries: ReadonlyArray<qp.CompletionEntry>;
    let metadata: any | undefined;
    let response: ServerResponse.Response<qp.CompletionInfoResponse> | undefined;
    let duration: number | undefined;
    if (this.client.apiVersion.gte(API.v300)) {
      const startTime = Date.now();
      try {
        response = await this.client.interruptGetErr(() => this.client.execute('completionInfo', args, token));
      } finally {
        duration = Date.now() - startTime;
      }
      if (response.type !== 'response' || !response.body) {
        this.logCompletionsTelemetry(duration, response);
        return undefined;
      }
      isNewIdentifierLocation = response.body.isNewIdentifierLocation;
      isMemberCompletion = response.body.isMemberCompletion;
      if (isMemberCompletion) {
        const dotMatch = line.text.slice(0, position.character).match(/\??\.\s*$/) || undefined;
        if (dotMatch) {
          const range = new qv.Range(position.translate({ characterDelta: -dotMatch[0].length }), position);
          const text = document.getText(range);
          dotAccessorContext = { range, text };
        }
      }
      isIncomplete = (response as any).metadata && (response as any).metadata.isIncomplete;
      entries = response.body.entries;
      metadata = response.metadata;
    } else {
      const response = await this.client.interruptGetErr(() => this.client.execute('completions', args, token));
      if (response.type !== 'response' || !response.body) return undefined;
      entries = response.body;
      metadata = response.metadata;
    }
    const completionContext = {
      isNewIdentifierLocation,
      isMemberCompletion,
      dotAccessorContext,
      isInValidCommitCharacterContext: this.isInValidCommitCharacterContext(document, position),
      enableCallCompletions: !completionConfig.useCodeSnippetsOnMethodSuggest,
      wordRange,
      line: line.text,
      useCodeSnippetsOnMethodSuggest: completionConfig.useCodeSnippetsOnMethodSuggest,
      useFuzzyWordRangeLogic: this.client.apiVersion.lt(API.v390),
    };
    let includesPackageJsonImport = false;
    const items: MyCompletionItem[] = [];
    for (const entry of entries) {
      if (!shouldExcludeCompletionEntry(entry, completionConfig)) {
        const item = new MyCompletionItem(position, document, entry, completionContext, metadata);
        item.command = {
          command: ApplyCompletionCommand.ID,
          title: '',
          arguments: [item],
        };
        items.push(item);
        includesPackageJsonImport = !!entry.isPackageJsonImport;
      }
    }
    if (duration !== undefined) this.logCompletionsTelemetry(duration, response, includesPackageJsonImport);
    return new qv.CompletionList(items, isIncomplete);
  }
  private logCompletionsTelemetry(duration: number, response: ServerResponse.Response<qp.CompletionInfoResponse> | undefined, includesPackageJsonImport?: boolean) {
    /* __GDPR__
			"completions.execute" : {
				"duration" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"type" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"updateGraphDurationMs" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"createAutoImportProviderProgramDurationMs" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"includesPackageJsonImport" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
    this.telemetryReporter.logTelemetry('completions.execute', {
      duration: duration,
      type: response?.type ?? 'unknown',
      count: response?.type === 'response' && response.body ? response.body.entries.length : 0,
      updateGraphDurationMs: response?.type === 'response' ? response.performanceData?.updateGraphDurationMs : undefined,
      createAutoImportProviderProgramDurationMs: response?.type === 'response' ? response.performanceData?.createAutoImportProviderProgramDurationMs : undefined,
      includesPackageJsonImport: includesPackageJsonImport ? 'true' : undefined,
    });
  }
  private getTsTriggerCharacter(context: qv.CompletionContext): qp.CompletionsTriggerCharacter | undefined {
    switch (context.triggerCharacter) {
      case '@': // Workaround for https://github.com/microsoft/TypeScript/issues/27321
        return this.client.apiVersion.gte(API.v310) && this.client.apiVersion.lt(API.v320) ? undefined : '@';
      case '#': // Workaround for https://github.com/microsoft/TypeScript/issues/36367
        return this.client.apiVersion.lt(API.v381) ? undefined : '#';
      case '.':
      case '"':
      case "'":
      case '`':
      case '/':
      case '<':
        return context.triggerCharacter;
    }
    return undefined;
  }
  public async resolveCompletionItem(item: MyCompletionItem, token: qv.CancellationToken): Promise<MyCompletionItem | undefined> {
    await item.resolveCompletionItem(this.client, token);
    return item;
  }
  private isInValidCommitCharacterContext(document: qv.TextDocument, position: qv.Position): boolean {
    if (this.client.apiVersion.lt(API.v320)) {
      if (position.character > 1) {
        const preText = document.getText(new qv.Range(position.line, 0, position.line, position.character));
        return preText.match(/(\s|^)\.$/gi) === null;
      }
    }
    return true;
  }
  private shouldTrigger(context: qv.CompletionContext, line: qv.TextLine, position: qv.Position): boolean {
    if (context.triggerCharacter && this.client.apiVersion.lt(API.v290)) {
      if (context.triggerCharacter === '"' || context.triggerCharacter === "'") {
        const pre = line.text.slice(0, position.character);
        if (!/\b(from|import)\s*["']$/.test(pre) && !/\b(import|require)\(['"]$/.test(pre)) {
          return false;
        }
      }
      if (context.triggerCharacter === '/') {
        const pre = line.text.slice(0, position.character);
        if (!/\b(from|import)\s*["'][^'"]*$/.test(pre) && !/\b(import|require)\(['"][^'"]*$/.test(pre)) {
          return false;
        }
      }
      if (context.triggerCharacter === '@') {
        const pre = line.text.slice(0, position.character);
        if (!/^\s*\*[ ]?@/.test(pre) && !/\/\*\*+[ ]?@/.test(pre)) {
          return false;
        }
      }
      if (context.triggerCharacter === '<') return false;
    }
    return true;
  }
}
function shouldExcludeCompletionEntry(element: qp.CompletionEntry, completionConfig: CompletionConfig) {
  return (
    (!completionConfig.nameSuggestions && element.kind === qk.Kind.warning) ||
    (!completionConfig.pathSuggestions && (element.kind === qk.Kind.directory || element.kind === qk.Kind.script || element.kind === qk.Kind.externalModuleName)) ||
    (!completionConfig.autoImportSuggestions && element.hasAction)
  );
}
export function register(
  selector: DocumentSelector,
  modeId: string,
  client: ServiceClient,
  typingsStatus: TypingsStatus,
  fileConfigMgr: FileConfigMgr,
  commandMgr: CommandMgr,
  telemetryReporter: TelemetryReporter,
  onCompletionAccepted: (item: qv.CompletionItem) => void
) {
  return conditionalRegistration([requireConfig(modeId, 'suggest.enabled'), requireSomeCap(client, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return qv.languages.registerCompletionItemProvider(
      selector.syntax,
      new TypeScriptCompletionItemProvider(client, modeId, typingsStatus, fileConfigMgr, commandMgr, telemetryReporter, onCompletionAccepted),
      ...TypeScriptCompletionItemProvider.triggerCharacters
    );
  });
}
