import { ClientCap, ExecConfig, ServiceClient, ServerResponse } from '../server/service';
import { requireSomeCap, requireMinVer } from '../server/base';
import * as qp from '../server/proto';
import * as qv from 'vscode';
import * as qu from '../utils/base';
import API from '../utils/env';

const minTsVersion = API.fromVersionString(`${VersionRequirement.major}.${VersionRequirement.minor}`);
const CONTENT_LENGTH_LIMIT = 100000;
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return qu.condRegistration([requireMinVer(c, minTsVersion), requireSomeCap(c, ClientCap.Semantic)], () => {
    const p = new SemanticTokens(c);
    return qv.Disposable.from(qv.languages.registerDocumentRangeSemanticTokensProvider(s.semantic, p, p.getLegend()));
  });
}
class SemanticTokens implements qv.DocumentSemanticTokensProvider, qv.DocumentRangeSemanticTokensProvider {
  constructor(private readonly client: ServiceClient) {}
  getLegend(): qv.SemanticTokensLegend {
    return new qv.SemanticTokensLegend(tokenTypes, tokenModifiers);
  }
  async provideDocumentSemanticTokens(d: qv.TextDocument, t: qv.CancellationToken): Promise<qv.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(d);
    if (!file || d.getText().length > CONTENT_LENGTH_LIMIT) return null;
    return this._provideSemanticTokens(d, { file, start: 0, length: d.getText().length }, t);
  }
  async provideDocumentRangeSemanticTokens(d: qv.TextDocument, r: qv.Range, t: qv.CancellationToken): Promise<qv.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(d);
    if (!file || d.offsetAt(r.end) - d.offsetAt(r.start) > CONTENT_LENGTH_LIMIT) return null;
    const start = d.offsetAt(r.start);
    const length = d.offsetAt(r.end) - start;
    return this._provideSemanticTokens(d, { file, start, length }, t);
  }
  async _provideSemanticTokens(d: qv.TextDocument, requestArg: qp.EncodedSemanticClassificationsRequestArgs, t: qv.CancellationToken): Promise<qv.SemanticTokens | null> {
    const file = this.client.toOpenedFilePath(d);
    if (!file) return null;
    const versionBeforeRequest = d.version;
    requestArg.format = '2020';
    const response = await (this.client as ExperimentalProtocol.IExtendedTypeScriptServiceClient).execute('encodedSemanticClassifications-full', requestArg, t, {
      cancelOnResourceChange: d.uri,
    });
    if (response.type !== 'response' || !response.body) return null;
    const versionAfterRequest = d.version;
    if (versionBeforeRequest !== versionAfterRequest) {
      await waitForDocumentChangesToEnd(d);
      throw new qv.CancellationError();
    }
    const tokenSpan = response.body.spans;
    const b = new qv.SemanticTokensBuilder();
    let i = 0;
    while (i < tokenSpan.length) {
      const offset = tokenSpan[i++];
      const length = tokenSpan[i++];
      const tsClassification = tokenSpan[i++];
      let tokenModifiers = 0;
      let tokenType = getTokenTypeFromClassification(tsClassification);
      if (tokenType !== undefined) tokenModifiers = getTokenModifierFromClassification(tsClassification);
      else {
        tokenType = tokenTypeMap[tsClassification];
        if (tokenType === undefined) continue;
      }
      const startPos = d.positionAt(offset);
      const endPos = d.positionAt(offset + length);
      for (let line = startPos.line; line <= endPos.line; line++) {
        const startCharacter = line === startPos.line ? startPos.character : 0;
        const endCharacter = line === endPos.line ? endPos.character : d.lineAt(line).text.length;
        b.push(line, startCharacter, endCharacter - startCharacter, tokenType, tokenModifiers);
      }
    }
    return b.build();
  }
}
function waitForDocumentChangesToEnd(d: qv.TextDocument) {
  let v = d.version;
  return new Promise<void>((s) => {
    const i = setInterval((_) => {
      if (d.version === v) {
        clearInterval(i);
        s();
      }
      v = d.version;
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
function getTokenTypeFromClassification(c: number): number | undefined {
  if (c > TokenEncodingConsts.modifierMask) return (c >> TokenEncodingConsts.typeOffset) - 1;
  return undefined;
}
function getTokenModifierFromClassification(c: number) {
  return c & TokenEncodingConsts.modifierMask;
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
      token: qv.CancellationToken,
      config?: ExecConfig
    ): Promise<ServerResponse.Response<ExperimentalProtocol.ExtendedTsServerRequests[K][1]>>;
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
    body?: { endOfLineState: EndOfLineState; spans: number[] };
  }
  export interface ExtendedTsServerRequests {
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
  tokenTypesLegend.forEach((t, i) => tokenTypes.set(t, i));
  const tokenModifiersLegend = ['declaration', 'documentation', 'readonly', 'static', 'abstract', 'deprecated', 'modification', 'async'];
  tokenModifiersLegend.forEach((m, i) => tokenModifiers.set(m, i));
  return new qv.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
})();
export function activate(c: qv.ExtensionContext) {
  c.subscriptions.push(qv.languages.registerDocumentSemanticTokensProvider({ language: 'semanticLang' }, new DocumentSemanticTokensProvider(), legend));
}
interface IParsedToken {
  line: number;
  startCharacter: number;
  length: number;
  tokenType: string;
  tokenModifiers: string[];
}
class DocumentSemanticTokensProvider implements qv.DocumentSemanticTokensProvider {
  async provideDocumentSemanticTokens(d: qv.TextDocument, _: qv.CancellationToken): Promise<qv.SemanticTokens> {
    const ts = this._parseText(d.getText());
    const b = new qv.SemanticTokensBuilder();
    ts.forEach((t) => {
      b.push(t.line, t.startCharacter, t.length, this._encodeTokenType(t.tokenType), this._encodeTokenModifiers(t.tokenModifiers));
    });
    return b.build();
  }
  private _encodeTokenType(x: string): number {
    if (tokenTypes.has(x)) return tokenTypes.get(x)!;
    else if (x === 'notInLegend') return tokenTypes.size + 2;
    return 0;
  }
  private _encodeTokenModifiers(xs: string[]): number {
    let y = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      if (tokenModifiers.has(x)) y = y | (1 << tokenModifiers.get(x)!);
      else if (x === 'notInLegend') y = y | (1 << (tokenModifiers.size + 2));
    }
    return y;
  }
  private _parseText(x: string): IParsedToken[] {
    const ys: IParsedToken[] = [];
    const ls = x.split(/\r\n|\r|\n/);
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      let off = 0;
      do {
        const open = l.indexOf('[', off);
        if (open === -1) break;
        const close = l.indexOf(']', open);
        if (close === -1) break;
        const y = this._parseTextToken(l.substring(open + 1, close));
        ys.push({ line: i, startCharacter: open + 1, length: close - open - 1, tokenType: y.tokenType, tokenModifiers: y.tokenModifiers });
        off = close;
      } while (true);
    }
    return ys;
  }
  private _parseTextToken(x: string): { tokenType: string; tokenModifiers: string[] } {
    const xs = x.split('.');
    return { tokenType: xs[0], tokenModifiers: xs.slice(1) };
  }
}
