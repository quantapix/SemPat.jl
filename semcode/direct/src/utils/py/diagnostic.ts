import { Commands } from '../commands/commands';
import { DiagnosticLevel } from './options';
import { convertOffsetsToRange } from './texts';
import { Range, TextRange } from './texts';
import { TextRangeCollection } from './texts';
const defaultMaxDepth = 5;
const defaultMaxLineCount = 8;
const maxRecursionCount = 64;
export const enum DiagnosticCategory {
  Error,
  Warning,
  Information,
  UnusedCode,
}
export function convertLevelToCategory(level: DiagnosticLevel) {
  switch (level) {
    case 'error':
      return DiagnosticCategory.Error;
    case 'warning':
      return DiagnosticCategory.Warning;
    case 'information':
      return DiagnosticCategory.Information;
    default:
      throw new Error(`${level} is not expected`);
  }
}
export interface DiagnosticAction {
  action: string;
}
export interface CreateTypeStubFileAction extends DiagnosticAction {
  action: Commands.createTypeStub;
  moduleName: string;
}
export interface AddMissingOptionalToParamAction extends DiagnosticAction {
  action: Commands.addMissingOptionalToParam;
  offsetOfTypeNode: number;
}
export interface DiagnosticRelatedInfo {
  message: string;
  filePath: string;
  range: Range;
}
export class Diagnostic {
  private _actions: DiagnosticAction[] | undefined;
  private _rule: string | undefined;
  private _relatedInfo: DiagnosticRelatedInfo[] = [];
  constructor(readonly category: DiagnosticCategory, readonly message: string, readonly range: Range) {}
  addAction(action: DiagnosticAction) {
    if (this._actions === undefined) {
      this._actions = [action];
    } else {
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
export class DiagnosticAddendum {
  private _messages: string[] = [];
  private _childAddenda: DiagnosticAddendum[] = [];
  addMessage(message: string) {
    this._messages.push(message);
  }
  createAddendum() {
    const newAddendum = new DiagnosticAddendum();
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
    if (text.length > 0) {
      return '\n' + text;
    }
    return '';
  }
  isEmpty() {
    return this._getMessageCount() === 0;
  }
  addAddendum(addendum: DiagnosticAddendum) {
    this._childAddenda.push(addendum);
  }
  getChildren() {
    return this._childAddenda;
  }
  private _getMessageCount(recursionCount = 0) {
    if (recursionCount > maxRecursionCount) {
      return 0;
    }
    let messageCount = this._messages.length;
    for (const diag of this._childAddenda) {
      messageCount += diag._getMessageCount(recursionCount + 1);
    }
    return messageCount;
  }
  private _getLinesRecursive(maxDepth: number, maxLineCount: number, recursionCount = 0): string[] {
    if (maxDepth <= 0 || recursionCount > maxRecursionCount) {
      return [];
    }
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
export interface FileDiagnostics {
  filePath: string;
  diagnostics: Diagnostic[];
}
export class DiagnosticSink {
  private _diagnosticList: Diagnostic[];
  private _diagnosticMap: Map<string, Diagnostic>;
  constructor(diagnostics?: Diagnostic[]) {
    this._diagnosticList = diagnostics || [];
    this._diagnosticMap = new Map<string, Diagnostic>();
  }
  fetchAndClear() {
    const prevDiagnostics = this._diagnosticList;
    this._diagnosticList = [];
    this._diagnosticMap.clear();
    return prevDiagnostics;
  }
  addError(message: string, range: Range) {
    return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Error, message, range));
  }
  addWarning(message: string, range: Range) {
    return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Warning, message, range));
  }
  addInformation(message: string, range: Range) {
    return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Information, message, range));
  }
  addUnusedCode(message: string, range: Range, action?: DiagnosticAction) {
    const diag = new Diagnostic(DiagnosticCategory.UnusedCode, message, range);
    if (action) {
      diag.addAction(action);
    }
    return this.addDiagnostic(diag);
  }
  addDiagnostic(diag: Diagnostic) {
    const key = `${diag.range.start.line},${diag.range.start.character}-` + `${diag.range.end.line}-${diag.range.end.character}:${diag.message.substr(0, 25)}}`;
    if (!this._diagnosticMap.has(key)) {
      this._diagnosticList.push(diag);
      this._diagnosticMap.set(key, diag);
    }
    return diag;
  }
  addDiagnostics(diagsToAdd: Diagnostic[]) {
    this._diagnosticList.push(...diagsToAdd);
  }
  getErrors() {
    return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.Error);
  }
  getWarnings() {
    return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.Warning);
  }
  getInformation() {
    return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.Information);
  }
  getUnusedCode() {
    return this._diagnosticList.filter((diag) => diag.category === DiagnosticCategory.UnusedCode);
  }
}
export class TextRangeDiagnosticSink extends DiagnosticSink {
  private _lines: TextRangeCollection<TextRange>;
  constructor(lines: TextRangeCollection<TextRange>, diagnostics?: Diagnostic[]) {
    super(diagnostics);
    this._lines = lines;
  }
  addDiagnosticWithTextRange(level: DiagnosticLevel, message: string, range: TextRange) {
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
  addUnusedCodeWithTextRange(message: string, range: TextRange, action?: DiagnosticAction) {
    return this.addUnusedCode(message, convertOffsetsToRange(range.start, range.start + range.length, this._lines), action);
  }
}
