import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as Previewer from '../../old/ts/utils/previewer';
import * as qu from '../utils';
import * as qv from 'vscode';
import type * as qp from '../protocol';
import { HoverRequest, LangClient } from 'vscode-languageclient';
import { MarkupContent, MarkupKind } from 'vscode-languageserver';
import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import { extractParameterDocumentation } from '../analyzer/docStringUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { getCallNodeAndActiveParameterIndex } from '../analyzer/parseTreeUtils';
import { CallSignature, TypeEvaluator } from '../analyzer/typeEvaluator';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertPositionToOffset } from '../common/positionUtils';
import { Position } from '../common/textRange';
import { ParseResults } from '../parser/parser';
import { Position  } from 'vscode';
import { getGoConfig } from './config';
import { definitionLocation } from './go/definition';
import { getParametersAndReturnType, isPositionInComment, isPositionInString } from './util';

export class GoSignatureHelp implements qv.SignatureHelpProvider {
  constructor(private goConfig?: qv.WorkspaceConfiguration) {}
  public async provideSignatureHelp(d: qv.TextDocument, p: Position, t: qv.CancellationToken): Promise<qv.SignatureHelp> {
    let goConfig = this.goConfig || getGoConfig(d.uri);
    const theCall = this.walkBackwardsToBeginningOfCall(d, p);
    if (theCall == null) return Promise.resolve(null);
    const callerPos = this.previousTokenPosition(d, theCall.openParen);
    if (goConfig['docsTool'] === 'guru') goConfig = Object.assign({}, goConfig, { docsTool: 'godoc' });
    try {
      const res = await definitionLocation(d, callerPos, goConfig, true, t);
      if (!res) return null;
      if (res.line === callerPos.line) return null;
      let declarationText: string = (res.declarationlines || []).join(' ').trim();
      if (!declarationText) return null;
      const result = new qv.SignatureHelp();
      let sig: string;
      let si: qv.SignatureInformation;
      if (res.toolUsed === 'godef') {
        const nameEnd = declarationText.indexOf(' ');
        const sigStart = nameEnd + 5; // ' func'
        const funcName = declarationText.substring(0, nameEnd);
        sig = declarationText.substring(sigStart);
        si = new qv.SignatureInformation(funcName + sig, res.doc);
      } else if (res.toolUsed === 'gogetdoc') {
        declarationText = declarationText.substring(5);
        const funcNameStart = declarationText.indexOf(res.name + '(');
        if (funcNameStart > 0) declarationText = declarationText.substring(funcNameStart);
        si = new qv.SignatureInformation(declarationText, res.doc);
        sig = declarationText.substring(res.name.length);
      }
      si.parameters = getParametersAndReturnType(sig).params.map((paramText) => new qv.ParameterInformation(paramText));
      result.signatures = [si];
      result.activeSignature = 0;
      result.activeParameter = Math.min(theCall.commas.length, si.parameters.length - 1);
      return result;
    } catch (e) {
      return null;
    }
  }
  private previousTokenPosition(d: qv.TextDocument, p: Position): Position {
    while (p.character > 0) {
      const word = d.getWordRangeAtPosition(p);
      if (word) return word.start;
      p = p.translate(0, -1);
    }
    return null;
  }
  private walkBackwardsToBeginningOfCall(d: qv.TextDocument, p: Position): { openParen: Position; commas: Position[] } | null {
    let parenBalance = 0;
    let maxLookupLines = 30;
    const commas = [];
    for (let lineNr = p.line; lineNr >= 0 && maxLookupLines >= 0; lineNr--, maxLookupLines--) {
      const line = d.lineAt(lineNr);
      if (isPositionInComment(d, p)) 
        return null;
      
      const [currentLine, characterPosition] = lineNr === p.line ? [line.text.substring(0, p.character), p.character] : [line.text, line.text.length - 1];
      for (let char = characterPosition; char >= 0; char--) {
        switch (currentLine[char]) {
          case '(':
            parenBalance--;
            if (parenBalance < 0) {
              return {                openParen: new Position(lineNr, char),
                commas,
              };
            }
            break;
          case ')':
            parenBalance++;
            break;
          case ',':
            {
              const commaPos = new Position(lineNr, char);
              if (parenBalance === 0 && !isPositionInString(d, commaPos)) 
                commas.push(commaPos);
              
            }
            break;
        }
      }
    }
    return null;
  }
}

class TsSignatureHelp implements qv.SignatureHelpProvider {
  public static readonly triggerCharacters = ['(', ',', '<'];
  public static readonly retriggerCharacters = [')'];
  public constructor(private readonly client: ServiceClient) {}
  public async provideSignatureHelp(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken, c: qv.SignatureHelpContext): Promise<qv.SignatureHelp | undefined> {
    const filepath = this.client.toOpenedFilePath(d);
    if (!filepath) return undefined;
    const args: qp.SignatureHelpRequestArgs = {
      ...qu.Position.toFileLocationRequestArgs(filepath, p),
      triggerReason: toTsTriggerReason(c),
    };
    const response = await this.client.interruptGetErr(() => this.client.execute('signatureHelp', args, t));
    if (response.type !== 'response' || !response.body) return undefined;
    const info = response.body;
    const result = new qv.SignatureHelp();
    result.signatures = info.items.map((signature) => this.convertSignature(signature));
    result.activeSignature = this.getActiveSignature(c, info, result.signatures);
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
    return qv.languages.registerSignatureHelpProvider(s.syntax, new TsSignatureHelp(c), {
      triggerCharacters: TsSignatureHelp.triggerCharacters,
      retriggerCharacters: TsSignatureHelp.retriggerCharacters,
    });
  });
}

export class RsSignatureHelp implements qv.SignatureHelpProvider {
  private languageClient: LangClient;
  private previousFunctionPosition?: qv.Position;
  constructor(lc: LangClient) {
    this.languageClient = lc;
  }
  public provideSignatureHelp(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken, context: qv.SignatureHelpContext): qv.ProviderResult<qv.SignatureHelp> {
    if (context.triggerCharacter === '(') {
      this.previousFunctionPosition = p;
      return this.provideHover(this.languageClient, d, p, t).then((hover) => this.hoverToSignatureHelp(hover, p, d));
    } else if (context.triggerCharacter === ',') {
      if (this.previousFunctionPosition && p.line === this.previousFunctionPosition.line) {
        return this.provideHover(this.languageClient, d, this.previousFunctionPosition, t).then((hover) => this.hoverToSignatureHelp(hover, p, d));
      } else {
        return null;
      }
    } else {
      if (context.isRetrigger === false) this.previousFunctionPosition = undefined;
      return null;
    }
  }
  private provideHover(lc: LangClient, d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Hover> {
    return new Promise((resolve, reject) => {
      lc.sendRequest(HoverRequest.type, lc.code2ProtocolConverter.asTextDocumentPositionParams(d, p.translate(0, -1)), t).then(
        (data) => resolve(lc.protocol2CodeConverter.asHover(data)),
        (error) => reject(error)
      );
    });
  }
  private hoverToSignatureHelp(hover: qv.Hover, p: qv.Position, d: qv.TextDocument): qv.SignatureHelp | undefined {
    /*
    The contents of a hover result has the following structure:
    contents:Array[2]
        0:Object
            value:"
            ```rust
            pub fn write(output: &mut dyn Write, args: Arguments) -> Result
            ```
            "
        1:Object
            value:"The `write` function takes an output stream, and an `Arguments` struct
            that can be precompiled with the `format_args!` macro.
            The arguments will be formatted according to the specified format string
            into the output stream provided.
            # Examples
    RLS uses the function below to create the tooltip contents shown above:
    fn create_tooltip(
        the_type: String,
        doc_url: Option<String>,
        context: Option<String>,
        docs: Option<String>,
    ) -> Vec<MarkedString> {}
    This means the first object is the type - function signature,
    but for the following, there is no way of certainly knowing which is the
    function documentation that we want to display in the tooltip.
    Assuming the context is never populated for a function definition (this might be wrong
    and needs further validation, but initial tests show it to hold true in most cases), and
    we also assume that most functions contain rather documentation, than just a URL without
    any inline documentation, we check the length of contents, and we assume that if there are:
        - two objects, they are the signature and docs, and docs is contents[1]
        - three objects, they are the signature, URL and docs, and docs is contents[2]
        - four objects -- all of them,  docs is contents[3]
    See https://github.com/rust-lang/rls/blob/master/rls/src/actions/hover.rs#L487-L508.
    */
    const label = (hover.contents[0] as qv.MarkdownString).value.replace('```rust', '').replace('```', '');
    if (!label.includes('fn') || d.lineAt(p.line).text.includes('fn ')) {
      return undefined;
    }
    const doc = hover.contents.length > 1 ? (hover.contents.slice(-1)[0] as qv.MarkdownString) : undefined;
    const si = new qv.SignatureInformation(label, doc);
    si.parameters = [];
    const sh = new qv.SignatureHelp();
    sh.signatures[0] = si;
    sh.activeSignature = 0;
    return sh;
  }
}

export interface ParamInfo {
  startOffset: number;
  endOffset: number;
  text: string;
  documentation?: string;
}
export interface SignatureInfo {
  label: string;
  documentation?: MarkupContent;
  parameters?: ParamInfo[];
  activeParameter?: number;
}
export interface qv.SignatureHelpResults {
  signatures: SignatureInfo[];
  callHasParameters: boolean;
}
export class PySignatureHelp {
  static getSignatureHelpForPosition(parseResults: ParseResults, position: Position, evaluator: TypeEvaluator, format: MarkupKind, token: qv.CancellationToken): qv.SignatureHelpResults | undefined {
    throwIfCancellationRequested(token);
    const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
    if (offset === undefined) return undefined;
    let node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
    const initialNode = node;
    const initialDepth = node ? ParseTreeUtils.getNodeDepth(node) : 0;
    let curOffset = offset;
    while (curOffset >= 0) {
      curOffset--;
      const curNode = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, curOffset);
      if (curNode && curNode !== initialNode) {
        if (ParseTreeUtils.getNodeDepth(curNode) > initialDepth) 
          node = curNode;
        
        break;
      }
    }
    if (node === undefined) return undefined;
    const callInfo = getCallNodeAndActiveParameterIndex(node, offset, parseResults.tokenizerOutput.tokens);
    if (!callInfo) return;
    const callSignatureInfo = evaluator.getCallSignatureInfo(callInfo.callNode, callInfo.activeIndex, callInfo.activeOrFake);
    if (!callSignatureInfo) return undefined;
    const signatures = callSignatureInfo.signatures.map((sig) => this._makeSignature(sig, evaluator, format));
    const callHasParameters = !!callSignatureInfo.callNode.arguments?.length;
    return {
      signatures,
      callHasParameters,
    };
  }
  private static _makeSignature(signature: CallSignature, evaluator: TypeEvaluator, format: MarkupKind): SignatureInfo {
    const functionType = signature.type;
    const stringParts = evaluator.printFunctionParts(functionType);
    const parameters: ParamInfo[] = [];
    const functionDocString = functionType.details.docString;
    let label = '(';
    const params = functionType.details.parameters;
    stringParts[0].forEach((paramString: string, paramIndex) => {
      let paramName = '';
      if (paramIndex < params.length) paramName = params[paramIndex].name || ''; else if (params.length > 0) {
        paramName = params[params.length - 1].name || '';
      }
      parameters.push({
        startOffset: label.length,
        endOffset: label.length + paramString.length,
        text: paramString,
        documentation: extractParameterDocumentation(functionDocString || '', paramName),
      });
      label += paramString;
      if (paramIndex < stringParts[0].length - 1) label += ', ';
    });
    label += ') -> ' + stringParts[1];
    let activeParameter: number | undefined;
    if (signature.activeParam) {
      activeParameter = params.indexOf(signature.activeParam);
      if (activeParameter === -1) activeParameter = undefined;
    }
    const sigInfo: SignatureInfo = {
      label,
      parameters,
      activeParameter,
    };
    if (functionDocString) {
      if (format === MarkupKind.Markdown) {
        sigInfo.documentation = {
          kind: MarkupKind.Markdown,
          value: convertDocStringToMarkdown(functionDocString),
        };
      } else {
        sigInfo.documentation = {
          kind: MarkupKind.PlainText,
          value: convertDocStringToPlainText(functionDocString),
        };
      }
    }
    return sigInfo;
  }
}
