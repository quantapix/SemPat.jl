import { ClientCap, ExecConfig, ServiceClient, ServerResponse } from '../service';
import { condRegistration, requireSomeCap, requireMinVer } from '../registration';
import * as qp from '../protocol';
import * as qv from 'vscode';
import * as qu from '../utils';
import API from '../../old/ts/utils/api';
const minTSVersion = API.fromVersionString(`${VersionRequirement.major}.${VersionRequirement.minor}`);
const CONTENT_LENGTH_LIMIT = 100000;
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireMinVer(c, minTSVersion), requireSomeCap(c, ClientCap.Semantic)], () => {
    const p = new SemanticTokens(c);
    return qv.Disposable.from(qv.languages.registerDocumentRangeSemanticTokensProvider(s.semantic, p, p.getLegend()));
  });
}
class SemanticTokens implements qv.DocumentSemanticTokensProvider, qv.DocumentRangeSemanticTokensProvider {
  constructor(private readonly client: ServiceClient) {}
  getLegend(): qv.SemanticTokensLegend {
    return new qv.SemanticTokensLegend(tokenTypes, tokenModifiers);
  }
  async provideDocumentSemanticTokens(document: qv.TextDocument, token: qv.CancellationToken): Promise<qv.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(document);
    if (!file || document.getText().length > CONTENT_LENGTH_LIMIT) return null;
    return this._provideSemanticTokens(document, { file, start: 0, length: document.getText().length }, token);
  }
  async provideDocumentRangeSemanticTokens(document: qv.TextDocument, range: qv.Range, token: qv.CancellationToken): Promise<qv.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(document);
    if (!file || document.offsetAt(range.end) - document.offsetAt(range.start) > CONTENT_LENGTH_LIMIT) return null;
    const start = document.offsetAt(range.start);
    const length = document.offsetAt(range.end) - start;
    return this._provideSemanticTokens(document, { file, start, length }, token);
  }
  async _provideSemanticTokens(document: qv.TextDocument, requestArg: qp.EncodedSemanticClassificationsRequestArgs, token: qv.CancellationToken): Promise<qv.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(document);
    if (!file) return null;
    const versionBeforeRequest = document.version;
    requestArg.format = '2020';
    const response = await (this.client as ExperimentalProtocol.IExtendedTypeScriptServiceClient).execute('encodedSemanticClassifications-full', requestArg, token, {
      cancelOnResourceChange: document.uri,
    });
    if (response.type !== 'response' || !response.body) return null;
    const versionAfterRequest = document.version;
    if (versionBeforeRequest !== versionAfterRequest) {
      await waitForDocumentChangesToEnd(document);
      throw new qv.CancellationError();
    }
    const tokenSpan = response.body.spans;
    const builder = new qv.SemanticTokensBuilder();
    let i = 0;
    while (i < tokenSpan.length) {
      const offset = tokenSpan[i++];
      const length = tokenSpan[i++];
      const tsClassification = tokenSpan[i++];
      let tokenModifiers = 0;
      let tokenType = getTokenTypeFromClassification(tsClassification);
      if (tokenType !== undefined) {
        tokenModifiers = getTokenModifierFromClassification(tsClassification);
      } else {
        tokenType = tokenTypeMap[tsClassification];
        if (tokenType === undefined) {
          continue;
        }
      }
      const startPos = document.positionAt(offset);
      const endPos = document.positionAt(offset + length);
      for (let line = startPos.line; line <= endPos.line; line++) {
        const startCharacter = line === startPos.line ? startPos.character : 0;
        const endCharacter = line === endPos.line ? endPos.character : document.lineAt(line).text.length;
        builder.push(line, startCharacter, endCharacter - startCharacter, tokenType, tokenModifiers);
      }
    }
    return builder.build();
  }
}
function waitForDocumentChangesToEnd(document: qv.TextDocument) {
  let version = document.version;
  return new Promise<void>((s) => {
    const iv = setInterval((_) => {
      if (document.version === version) {
        clearInterval(iv);
        s();
      }
      version = document.version;
    }, 400);
  });
}
declare const enum TokenType {
  class = 0,
  enum = 1,
  interface = 2,
  namespace = 3,
  typeParameter = 4,
  type = 5,
  parameter = 6,
  variable = 7,
  enumMember = 8,
  property = 9,
  function = 10,
  method = 11,
  _ = 12,
}
declare const enum TokenModifier {
  declaration = 0,
  static = 1,
  async = 2,
  readonly = 3,
  defaultLibrary = 4,
  local = 5,
  _ = 6,
}
declare const enum TokenEncodingConsts {
  typeOffset = 8,
  modifierMask = 255,
}
declare const enum VersionRequirement {
  major = 3,
  minor = 7,
}
function getTokenTypeFromClassification(tsClassification: number): number | undefined {
  if (tsClassification > TokenEncodingConsts.modifierMask) {
    return (tsClassification >> TokenEncodingConsts.typeOffset) - 1;
  }
  return undefined;
}
function getTokenModifierFromClassification(tsClassification: number) {
  return tsClassification & TokenEncodingConsts.modifierMask;
}
const tokenTypes: string[] = [];
tokenTypes[TokenType.class] = 'class';
tokenTypes[TokenType.enum] = 'enum';
tokenTypes[TokenType.interface] = 'interface';
tokenTypes[TokenType.namespace] = 'namespace';
tokenTypes[TokenType.typeParameter] = 'typeParameter';
tokenTypes[TokenType.type] = 'type';
tokenTypes[TokenType.parameter] = 'parameter';
tokenTypes[TokenType.variable] = 'variable';
tokenTypes[TokenType.enumMember] = 'enumMember';
tokenTypes[TokenType.property] = 'property';
tokenTypes[TokenType.function] = 'function';
tokenTypes[TokenType.method] = 'method';
const tokenModifiers: string[] = [];
tokenModifiers[TokenModifier.async] = 'async';
tokenModifiers[TokenModifier.declaration] = 'declaration';
tokenModifiers[TokenModifier.readonly] = 'readonly';
tokenModifiers[TokenModifier.static] = 'static';
tokenModifiers[TokenModifier.local] = 'local';
tokenModifiers[TokenModifier.defaultLibrary] = 'defaultLibrary';
const tokenTypeMap: number[] = [];
tokenTypeMap[ExperimentalProtocol.ClassificationType.className] = TokenType.class;
tokenTypeMap[ExperimentalProtocol.ClassificationType.enumName] = TokenType.enum;
tokenTypeMap[ExperimentalProtocol.ClassificationType.interfaceName] = TokenType.interface;
tokenTypeMap[ExperimentalProtocol.ClassificationType.moduleName] = TokenType.namespace;
tokenTypeMap[ExperimentalProtocol.ClassificationType.typeParameterName] = TokenType.typeParameter;
tokenTypeMap[ExperimentalProtocol.ClassificationType.typeAliasName] = TokenType.type;
tokenTypeMap[ExperimentalProtocol.ClassificationType.parameterName] = TokenType.parameter;
namespace ExperimentalProtocol {
  export interface IExtendedTypeScriptServiceClient {
    execute<K extends keyof ExperimentalProtocol.ExtendedTSServerRequests>(
      command: K,
      args: ExperimentalProtocol.ExtendedTSServerRequests[K][0],
      token: qv.CancellationToken,
      config?: ExecConfig
    ): Promise<ServerResponse.Response<ExperimentalProtocol.ExtendedTSServerRequests[K][1]>>;
  }
  export interface EncodedSemanticClassificationsRequest extends qp.FileRequest {
    arguments: EncodedSemanticClassificationsRequestArgs;
  }
  export interface EncodedSemanticClassificationsRequestArgs extends qp.FileRequestArgs {
    start: number;
    length: number;
  }
  export const enum EndOfLineState {
    None,
    InMultiLineCommentTrivia,
    InSingleQuoteStringLiteral,
    InDoubleQuoteStringLiteral,
    InTemplateHeadOrNoSubstitutionTemplate,
    InTemplateMiddleOrTail,
    InTemplateSubstitutionPosition,
  }
  export const enum ClassificationType {
    comment = 1,
    identifier = 2,
    keyword = 3,
    numericLiteral = 4,
    operator = 5,
    stringLiteral = 6,
    regularExpressionLiteral = 7,
    whiteSpace = 8,
    text = 9,
    punctuation = 10,
    className = 11,
    enumName = 12,
    interfaceName = 13,
    moduleName = 14,
    typeParameterName = 15,
    typeAliasName = 16,
    parameterName = 17,
    docCommentTagName = 18,
    jsxOpenTagName = 19,
    jsxCloseTagName = 20,
    jsxSelfClosingTagName = 21,
    jsxAttribute = 22,
    jsxText = 23,
    jsxAttributeStringLiteralValue = 24,
    bigintLiteral = 25,
  }
  export interface EncodedSemanticClassificationsResponse extends qp.Response {
    body?: {
      endOfLineState: EndOfLineState;
      spans: number[];
    };
  }
  export interface ExtendedTSServerRequests {
    'encodedSemanticClassifications-full': [ExperimentalProtocol.EncodedSemanticClassificationsRequestArgs, ExperimentalProtocol.EncodedSemanticClassificationsResponse];
  }
}
const tokenTypes = new Map<string, number>();
const tokenModifiers = new Map<string, number>();
const legend = (function () {
  const tokenTypesLegend = [
    'comment',
    'string',
    'keyword',
    'number',
    'regexp',
    'operator',
    'namespace',
    'type',
    'struct',
    'class',
    'interface',
    'enum',
    'typeParameter',
    'function',
    'method',
    'macro',
    'variable',
    'parameter',
    'property',
    'label',
  ];
  tokenTypesLegend.forEach((tokenType, index) => tokenTypes.set(tokenType, index));
  const tokenModifiersLegend = ['declaration', 'documentation', 'readonly', 'static', 'abstract', 'deprecated', 'modification', 'async'];
  tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index));
  return new qv.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
})();
export function activate(context: qv.ExtensionContext) {
  context.subscriptions.push(qv.languages.registerDocumentSemanticTokensProvider({ language: 'semanticLang' }, new DocumentSemanticTokensProvider(), legend));
}
interface IParsedToken {
  line: number;
  startCharacter: number;
  length: number;
  tokenType: string;
  tokenModifiers: string[];
}
class DocumentSemanticTokensProvider implements qv.DocumentSemanticTokensProvider {
  async provideDocumentSemanticTokens(document: qv.TextDocument, token: qv.CancellationToken): Promise<qv.SemanticTokens> {
    const allTokens = this._parseText(document.getText());
    const builder = new qv.SemanticTokensBuilder();
    allTokens.forEach((token) => {
      builder.push(token.line, token.startCharacter, token.length, this._encodeTokenType(token.tokenType), this._encodeTokenModifiers(token.tokenModifiers));
    });
    return builder.build();
  }
  private _encodeTokenType(tokenType: string): number {
    if (tokenTypes.has(tokenType)) {
      return tokenTypes.get(tokenType)!;
    } else if (tokenType === 'notInLegend') {
      return tokenTypes.size + 2;
    }
    return 0;
  }
  private _encodeTokenModifiers(strTokenModifiers: string[]): number {
    let result = 0;
    for (let i = 0; i < strTokenModifiers.length; i++) {
      const tokenModifier = strTokenModifiers[i];
      if (tokenModifiers.has(tokenModifier)) {
        result = result | (1 << tokenModifiers.get(tokenModifier)!);
      } else if (tokenModifier === 'notInLegend') {
        result = result | (1 << (tokenModifiers.size + 2));
      }
    }
    return result;
  }
  private _parseText(text: string): IParsedToken[] {
    const r: IParsedToken[] = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let currentOffset = 0;
      do {
        const openOffset = line.indexOf('[', currentOffset);
        if (openOffset === -1) break;
        const closeOffset = line.indexOf(']', openOffset);
        if (closeOffset === -1) break;
        const tokenData = this._parseTextToken(line.substring(openOffset + 1, closeOffset));
        r.push({
          line: i,
          startCharacter: openOffset + 1,
          length: closeOffset - openOffset - 1,
          tokenType: tokenData.tokenType,
          tokenModifiers: tokenData.tokenModifiers,
        });
        currentOffset = closeOffset;
      } while (true);
    }
    return r;
  }
  private _parseTextToken(text: string): { tokenType: string; tokenModifiers: string[] } {
    const parts = text.split('.');
    return {
      tokenType: parts[0],
      tokenModifiers: parts.slice(1),
    };
  }
}
