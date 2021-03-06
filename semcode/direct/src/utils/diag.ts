import { Commands } from '../commands/commands';
import { DiagLevel } from './opts';
import { convertOffsetsToRange } from './texts';
import { Range, TextRange } from './texts';
import { TextRangeCollection } from './texts';
const defaultMaxDepth = 5;
const defaultMaxLineCount = 8;
const maxRecursionCount = 64;
export const enum DiagCategory {
  Error,
  Warning,
  Information,
  UnusedCode,
}
export function convertLevelToCategory(level: DiagLevel) {
  switch (level) {
    case 'error':
      return DiagCategory.Error;
    case 'warning':
      return DiagCategory.Warning;
    case 'information':
      return DiagCategory.Information;
    default:
      throw new Error(`${level} is not expected`);
  }
}
export interface DiagAction {
  action: string;
}
export interface CreateTypeStubFileAction extends DiagAction {
  action: Commands.createTypeStub;
  moduleName: string;
}
export interface AddMissingOptionalToParamAction extends DiagAction {
  action: Commands.addMissingOptionalToParam;
  offsetOfTypeNode: number;
}
export interface DiagRelatedInfo {
  message: string;
  filePath: string;
  range: Range;
}
export class Diag {
  private _actions: DiagAction[] | undefined;
  private _rule: string | undefined;
  private _relatedInfo: DiagRelatedInfo[] = [];
  constructor(readonly category: DiagCategory, readonly message: string, readonly range: Range) {}
  addAction(action: DiagAction) {
    if (this._actions === undefined) this._actions = [action];
    else {
      this._actions.push(action);
    }
  }
  getActions() {
    return this._actions;
  }
  setRule(rule: string) {
    this._rule = rule;
  }
  getRule() {
    return this._rule;
  }
  addRelatedInfo(message: string, filePath: string, range: Range) {
    this._relatedInfo.push({ filePath, message, range });
  }
  getRelatedInfo() {
    return this._relatedInfo;
  }
}
export class DiagAddendum {
  private _messages: string[] = [];
  private _childAddenda: DiagAddendum[] = [];
  addMessage(message: string) {
    this._messages.push(message);
  }
  createAddendum() {
    const newAddendum = new DiagAddendum();
    this.addAddendum(newAddendum);
    return newAddendum;
  }
  getString(maxDepth = defaultMaxDepth, maxLineCount = defaultMaxLineCount): string {
    let lines = this._getLinesRecursive(maxDepth, maxLineCount);
    if (lines.length > maxLineCount) {
      lines = lines.slice(0, maxLineCount);
      lines.push('  ...');
    }
    const text = lines.join('\n');
    if (text.length > 0) return '\n' + text;
    return '';
  }
  isEmpty() {
    return this._getMessageCount() === 0;
  }
  addAddendum(addendum: DiagAddendum) {
    this._childAddenda.push(addendum);
  }
  getChildren() {
    return this._childAddenda;
  }
  private _getMessageCount(recursionCount = 0) {
    if (recursionCount > maxRecursionCount) return 0;
    let messageCount = this._messages.length;
    for (const diag of this._childAddenda) {
      messageCount += diag._getMessageCount(recursionCount + 1);
    }
    return messageCount;
  }
  private _getLinesRecursive(maxDepth: number, maxLineCount: number, recursionCount = 0): string[] {
    if (maxDepth <= 0 || recursionCount > maxRecursionCount) return [];
    let childLines: string[] = [];
    for (const addendum of this._childAddenda) {
      const maxDepthRemaining = this._messages.length > 0 ? maxDepth - 1 : maxDepth;
      childLines.push(...addendum._getLinesRecursive(maxDepthRemaining, maxLineCount, recursionCount + 1));

      if (childLines.length >= maxLineCount) {
        childLines = childLines.slice(0, maxLineCount);
        break;
      }
    }
    const extraSpace = this._messages.length > 0 ? '  ' : '';
    return this._messages.concat(childLines).map((line) => extraSpace + line);
  }
}
export interface FileDiags {
  filePath: string;
  diagnostics: Diag[];
}
export class DiagSink {
  private _diagnosticList: Diag[];
  private _diagnosticMap: Map<string, Diag>;
  constructor(diagnostics?: Diag[]) {
    this._diagnosticList = diagnostics || [];
    this._diagnosticMap = new Map<string, Diag>();
  }
  fetchAndClear() {
    const prevDiags = this._diagnosticList;
    this._diagnosticList = [];
    this._diagnosticMap.clear();
    return prevDiags;
  }
  addError(message: string, range: Range) {
    return this.addDiag(new Diag(DiagCategory.Error, message, range));
  }
  addWarning(message: string, range: Range) {
    return this.addDiag(new Diag(DiagCategory.Warning, message, range));
  }
  addInformation(message: string, range: Range) {
    return this.addDiag(new Diag(DiagCategory.Information, message, range));
  }
  addUnusedCode(message: string, range: Range, action?: DiagAction) {
    const diag = new Diag(DiagCategory.UnusedCode, message, range);
    if (action) diag.addAction(action);
    return this.addDiag(diag);
  }
  addDiag(diag: Diag) {
    const key = `${diag.range.start.line},${diag.range.start.character}-` + `${diag.range.end.line}-${diag.range.end.character}:${diag.message.substr(0, 25)}}`;
    if (!this._diagnosticMap.has(key)) {
      this._diagnosticList.push(diag);
      this._diagnosticMap.set(key, diag);
    }
    return diag;
  }
  addDiags(diagsToAdd: Diag[]) {
    this._diagnosticList.push(...diagsToAdd);
  }
  getErrors() {
    return this._diagnosticList.filter((diag) => diag.category === DiagCategory.Error);
  }
  getWarnings() {
    return this._diagnosticList.filter((diag) => diag.category === DiagCategory.Warning);
  }
  getInformation() {
    return this._diagnosticList.filter((diag) => diag.category === DiagCategory.Information);
  }
  getUnusedCode() {
    return this._diagnosticList.filter((diag) => diag.category === DiagCategory.UnusedCode);
  }
}
export class TextRangeDiagSink extends DiagSink {
  private _lines: TextRangeCollection<TextRange>;
  constructor(lines: TextRangeCollection<TextRange>, diagnostics?: Diag[]) {
    super(diagnostics);
    this._lines = lines;
  }
  addDiagWithTextRange(level: DiagLevel, message: string, range: TextRange) {
    const positionRange = convertOffsetsToRange(range.start, range.start + range.length, this._lines);
    switch (level) {
      case 'error':
        return this.addError(message, positionRange);
      case 'warning':
        return this.addWarning(message, positionRange);
      case 'information':
        return this.addInformation(message, positionRange);
      default:
        throw new Error(`${level} is not expected value`);
    }
  }
  addUnusedCodeWithTextRange(message: string, range: TextRange, action?: DiagAction) {
    return this.addUnusedCode(message, convertOffsetsToRange(range.start, range.start + range.length, this._lines), action);
  }
}
export enum DiagRule {
  strictListInference = 'strictListInference',
  strictDictionaryInference = 'strictDictionaryInference',
  strictParameterNoneValue = 'strictParameterNoneValue',
  enableTypeIgnoreComments = 'enableTypeIgnoreComments',
  reportGeneralTypeIssues = 'reportGeneralTypeIssues',
  reportPropertyTypeMismatch = 'reportPropertyTypeMismatch',
  reportFunctionMemberAccess = 'reportFunctionMemberAccess',
  reportMissingImports = 'reportMissingImports',
  reportMissingModuleSource = 'reportMissingModuleSource',
  reportMissingTypeStubs = 'reportMissingTypeStubs',
  reportImportCycles = 'reportImportCycles',
  reportUnusedImport = 'reportUnusedImport',
  reportUnusedClass = 'reportUnusedClass',
  reportUnusedFunction = 'reportUnusedFunction',
  reportUnusedVariable = 'reportUnusedVariable',
  reportDuplicateImport = 'reportDuplicateImport',
  reportWildcardImportFromLibrary = 'reportWildcardImportFromLibrary',
  reportOptionalSubscript = 'reportOptionalSubscript',
  reportOptionalMemberAccess = 'reportOptionalMemberAccess',
  reportOptionalCall = 'reportOptionalCall',
  reportOptionalIterable = 'reportOptionalIterable',
  reportOptionalContextMgr = 'reportOptionalContextMgr',
  reportOptionalOperand = 'reportOptionalOperand',
  reportUntypedFunctionDecorator = 'reportUntypedFunctionDecorator',
  reportUntypedClassDecorator = 'reportUntypedClassDecorator',
  reportUntypedBaseClass = 'reportUntypedBaseClass',
  reportUntypedNamedTuple = 'reportUntypedNamedTuple',
  reportPrivateUsage = 'reportPrivateUsage',
  reportConstantRedefinition = 'reportConstantRedefinition',
  reportIncompatibleMethodOverride = 'reportIncompatibleMethodOverride',
  reportIncompatibleVariableOverride = 'reportIncompatibleVariableOverride',
  reportOverlappingOverload = 'reportOverlappingOverload',
  reportInvalidStringEscapeSequence = 'reportInvalidStringEscapeSequence',
  reportUnknownParameterType = 'reportUnknownParameterType',
  reportUnknownArgumentType = 'reportUnknownArgumentType',
  reportUnknownLambdaType = 'reportUnknownLambdaType',
  reportUnknownVariableType = 'reportUnknownVariableType',
  reportUnknownMemberType = 'reportUnknownMemberType',
  reportMissingTypeArgument = 'reportMissingTypeArgument',
  reportInvalidTypeVarUse = 'reportInvalidTypeVarUse',
  reportCallInDefaultInitializer = 'reportCallInDefaultInitializer',
  reportUnnecessaryIsInstance = 'reportUnnecessaryIsInstance',
  reportUnnecessaryCast = 'reportUnnecessaryCast',
  reportAssertAlwaysTrue = 'reportAssertAlwaysTrue',
  reportSelfClsParameterName = 'reportSelfClsParameterName',
  reportImplicitStringConcatenation = 'reportImplicitStringConcatenation',
  reportUndefinedVariable = 'reportUndefinedVariable',
  reportUnboundVariable = 'reportUnboundVariable',
  reportInvalidStubStatement = 'reportInvalidStubStatement',
  reportUnsupportedDunderAll = 'reportUnsupportedDunderAll',
  reportUnusedCallResult = 'reportUnusedCallResult',
  reportUnusedCoroutine = 'reportUnusedCoroutine',
}
