import * as vsc from 'vscode';
import * as Proto from '../protocol';
import { ClientCap, ExecConfig, ServiceClient, ServerResponse } from '../service';
import API from '../../old/ts/utils/api';
import { condRegistration, requireSomeCap, requireMinVer } from '../registration';

const minTypeScriptVersion = API.fromVersionString(`${VersionRequirement.major}.${VersionRequirement.minor}`);

const CONTENT_LENGTH_LIMIT = 100000;

export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return condRegistration([requireMinVer(c, minTypeScriptVersion), requireSomeCap(c, ClientCap.Semantic)], () => {
    const p = new DocumentSemanticTokensProvider(c);
    return vsc.Disposable.from(vsc.languages.registerDocumentRangeSemanticTokensProvider(s.semantic, p, p.getLegend()));
  });
}

class DocumentSemanticTokensProvider implements vsc.DocumentSemanticTokensProvider, vsc.DocumentRangeSemanticTokensProvider {
  constructor(private readonly client: ServiceClient) {}

  getLegend(): vsc.SemanticTokensLegend {
    return new vsc.SemanticTokensLegend(tokenTypes, tokenModifiers);
  }

  async provideDocumentSemanticTokens(document: vsc.TextDocument, token: vsc.CancellationToken): Promise<vsc.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(document);
    if (!file || document.getText().length > CONTENT_LENGTH_LIMIT) return null;

    return this._provideSemanticTokens(document, { file, start: 0, length: document.getText().length }, token);
  }

  async provideDocumentRangeSemanticTokens(document: vsc.TextDocument, range: vsc.Range, token: vsc.CancellationToken): Promise<vsc.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(document);
    if (!file || document.offsetAt(range.end) - document.offsetAt(range.start) > CONTENT_LENGTH_LIMIT) return null;

    const start = document.offsetAt(range.start);
    const length = document.offsetAt(range.end) - start;
    return this._provideSemanticTokens(document, { file, start, length }, token);
  }

  async _provideSemanticTokens(document: vsc.TextDocument, requestArg: Proto.EncodedSemanticClassificationsRequestArgs, token: vsc.CancellationToken): Promise<vsc.SemanticTokens | null> {
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
      throw new vsc.CancellationError();
    }
    const tokenSpan = response.body.spans;
    const builder = new vsc.SemanticTokensBuilder();
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

function waitForDocumentChangesToEnd(document: vsc.TextDocument) {
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
    execute<K extends keyof ExperimentalProtocol.ExtendedTsServerRequests>(
      command: K,
      args: ExperimentalProtocol.ExtendedTsServerRequests[K][0],
      token: vsc.CancellationToken,
      config?: ExecConfig
    ): Promise<ServerResponse.Response<ExperimentalProtocol.ExtendedTsServerRequests[K][1]>>;
  }
  export interface EncodedSemanticClassificationsRequest extends Proto.FileRequest {
    arguments: EncodedSemanticClassificationsRequestArgs;
  }
  export interface EncodedSemanticClassificationsRequestArgs extends Proto.FileRequestArgs {
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

  export interface EncodedSemanticClassificationsResponse extends Proto.Response {
    body?: {
      endOfLineState: EndOfLineState;
      spans: number[];
    };
  }

  export interface ExtendedTsServerRequests {
    'encodedSemanticClassifications-full': [ExperimentalProtocol.EncodedSemanticClassificationsRequestArgs, ExperimentalProtocol.EncodedSemanticClassificationsResponse];
  }
}
