import * as qv from 'vscode';
import { subscribeToDocumentChanges, EMOJI_MENTION } from './diagnostics';

const COMMAND = 'code-actions-sample.command';

export function activate(ctx: qv.ExtensionContext) {
  ctx.subscriptions.push(
    qv.languages.registerCodeActionsProvider('markdown', new Emojizer(), {
      providedCodeActionKinds: Emojizer.providedCodeActionKinds,
    })
  );
  const emojiDiagnostics = qv.languages.createDiagnosticCollection('emoji');
  ctx.subscriptions.push(emojiDiagnostics);
  subscribeToDocumentChanges(ctx, emojiDiagnostics);
  ctx.subscriptions.push(
    qv.languages.registerCodeActionsProvider('markdown', new Emojinfo(), {
      providedCodeActionKinds: Emojinfo.providedCodeActionKinds,
    })
  );
  ctx.subscriptions.push(qv.commands.registerCommand(COMMAND, () => qv.env.openExternal(qv.Uri.parse('https://unicode.org/emoji/charts-12.0/full-emoji-list.html'))));
}

export class Emojizer implements qv.CodeActionProvider {
  public static readonly providedCodeActionKinds = [qv.CodeActionKind.QuickFix];

  public provideCodeActions(d: qv.TextDocument, range: qv.Range): qv.CodeAction[] | undefined {
    if (!this.isAtStartOfSmiley(d, range)) {
      return;
    }

    const replaceWithSmileyCatFix = this.createFix(d, range, '😺');

    const replaceWithSmileyFix = this.createFix(d, range, '😀');
    replaceWithSmileyFix.isPreferred = true;

    const replaceWithSmileyHankyFix = this.createFix(d, range, '💩');

    const commandAction = this.createCommand();

    return [replaceWithSmileyCatFix, replaceWithSmileyFix, replaceWithSmileyHankyFix, commandAction];
  }

  private isAtStartOfSmiley(document: qv.TextDocument, range: qv.Range) {
    const start = range.start;
    const line = document.lineAt(start.line);
    return line.text[start.character] === ':' && line.text[start.character + 1] === ')';
  }

  private createFix(document: qv.TextDocument, range: qv.Range, emoji: string): qv.CodeAction {
    const fix = new qv.CodeAction(`Convert to ${emoji}`, qv.CodeActionKind.QuickFix);
    fix.edit = new qv.WorkspaceEdit();
    fix.edit.replace(document.uri, new qv.Range(range.start, range.start.translate(0, 2)), emoji);
    return fix;
  }

  private createCommand(): qv.CodeAction {
    const action = new qv.CodeAction('Learn more...', qv.CodeActionKind.Empty);
    action.command = { command: COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
    return action;
  }
}

export class Emojinfo implements qv.CodeActionProvider {
  public static readonly providedCodeActionKinds = [qv.CodeActionKind.QuickFix];

  provideCodeActions(document: qv.TextDocument, range: qv.Range | qv.Selection, context: qv.CodeActionContext, token: qv.CancellationToken): qv.CodeAction[] {
    return context.diagnostics.filter((diagnostic) => diagnostic.code === EMOJI_MENTION).map((diagnostic) => this.createCommandCodeAction(diagnostic));
  }

  private createCommandCodeAction(diagnostic: qv.Diagnostic): qv.CodeAction {
    const action = new qv.CodeAction('Learn more...', qv.CodeActionKind.QuickFix);
    action.command = { command: COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    return action;
  }
}
