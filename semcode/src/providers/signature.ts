import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as Previewer from '../../old/ts/utils/previewer';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';

class SignatureHelp implements qv.SignatureHelpProvider {
  public static readonly triggerCharacters = ['(', ',', '<'];
  public static readonly retriggerCharacters = [')'];

  public constructor(private readonly client: ServiceClient) {}

  public async provideSignatureHelp(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken, context: qv.SignatureHelpContext): Promise<qv.SignatureHelp | undefined> {
    const filepath = this.client.toOpenedFilePath(document);
    if (!filepath) return undefined;
    const args: qp.SignatureHelpRequestArgs = {
      ...qu.Position.toFileLocationRequestArgs(filepath, position),
      triggerReason: toTsTriggerReason(context),
    };
    const response = await this.client.interruptGetErr(() => this.client.execute('signatureHelp', args, token));
    if (response.type !== 'response' || !response.body) return undefined;
    const info = response.body;
    const result = new qv.SignatureHelp();
    result.signatures = info.items.map((signature) => this.convertSignature(signature));
    result.activeSignature = this.getActiveSignature(context, info, result.signatures);
    result.activeParameter = this.getActiveParameter(info);
    return result;
  }

  private getActiveSignature(context: qv.SignatureHelpContext, info: qp.SignatureHelpItems, signatures: readonly qv.SignatureInformation[]): number {
    const previouslyActiveSignature = context.activeSignatureHelp?.signatures[context.activeSignatureHelp.activeSignature];
    if (previouslyActiveSignature && context.isRetrigger) {
      const existingIndex = signatures.findIndex((other) => other.label === previouslyActiveSignature?.label);
      if (existingIndex >= 0) return existingIndex;
    }
    return info.selectedItemIndex;
  }

  private getActiveParameter(i: qp.SignatureHelpItems): number {
    const s = i.items[i.selectedItemIndex];
    if (s && s.isVariadic) return Math.min(i.argumentIndex, s.parameters.length - 1);
    return i.argumentIndex;
  }

  private convertSignature(item: qp.SignatureHelpItem) {
    const signature = new qv.SignatureInformation(
      Previewer.plain(item.prefixDisplayParts),
      Previewer.markdownDocumentation(
        item.documentation,
        item.tags.filter((x) => x.name !== 'param')
      )
    );
    let textIndex = signature.label.length;
    const separatorLabel = Previewer.plain(item.separatorDisplayParts);
    for (let i = 0; i < item.parameters.length; ++i) {
      const parameter = item.parameters[i];
      const label = Previewer.plain(parameter.displayParts);
      signature.parameters.push(new qv.ParameterInformation([textIndex, textIndex + label.length], Previewer.markdownDocumentation(parameter.documentation, [])));
      textIndex += label.length;
      signature.label += label;
      if (i !== item.parameters.length - 1) {
        signature.label += separatorLabel;
        textIndex += separatorLabel.length;
      }
    }
    signature.label += Previewer.plain(item.suffixDisplayParts);
    return signature;
  }
}

function toTsTriggerReason(context: qv.SignatureHelpContext): qp.SignatureHelpTriggerReason {
  switch (context.triggerKind) {
    case qv.SignatureHelpTriggerKind.TriggerCharacter:
      if (context.triggerCharacter) {
        if (context.isRetrigger) return { kind: 'retrigger', triggerCharacter: context.triggerCharacter as any };
        else return { kind: 'characterTyped', triggerCharacter: context.triggerCharacter as any };
      } else return { kind: 'invoked' };
    case qv.SignatureHelpTriggerKind.ContentChange:
      return context.isRetrigger ? { kind: 'retrigger' } : { kind: 'invoked' };
    case qv.SignatureHelpTriggerKind.Invoke:
    default:
      return { kind: 'invoked' };
  }
}

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
    return qv.languages.registerSignatureHelpProvider(s.syntax, new SignatureHelp(c), {
      triggerCharacters: SignatureHelp.triggerCharacters,
      retriggerCharacters: SignatureHelp.retriggerCharacters,
    });
  });
}
