import { TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { convertPathToUri } from './paths2';
import { FileSystem } from './files';
export interface TextRange {
  start: number;
  length: number;
}
export namespace TextRange {
  export function create(start: number, length: number): TextRange {
    if (start < 0) {
      throw new Error('start must be non-negative');
    }
    if (length < 0) {
      throw new Error('length must be non-negative');
    }
    return { start, length };
  }
  export function fromBounds(start: number, end: number): TextRange {
    if (start < 0) {
      throw new Error('start must be non-negative');
    }
    if (start > end) {
      throw new Error('end must be greater than or equal to start');
    }
    return create(start, end - start);
  }
  export function getEnd(range: TextRange): number {
    return range.start + range.length;
  }
  export function contains(range: TextRange, position: number): boolean {
    return position >= range.start && position < getEnd(range);
  }
  export function containsRange(range: TextRange, span: TextRange): boolean {
    return span.start >= range.start && getEnd(span) <= getEnd(range);
  }
  export function overlaps(range: TextRange, position: number): boolean {
    return position >= range.start && position <= getEnd(range);
  }
  export function extend(range: TextRange, extension: TextRange | TextRange[] | undefined) {
    if (extension) {
      if (Array.isArray(extension)) {
        extension.forEach((r) => {
          extend(range, r);
        });
      } else {
        if (extension.start < range.start) {
          range.length += range.start - extension.start;
          range.start = extension.start;
        }
        if (getEnd(extension) > getEnd(range)) {
          range.length += getEnd(extension) - getEnd(range);
        }
      }
    }
  }
  export function combine(ranges: TextRange[]): TextRange | undefined {
    if (ranges.length === 0) {
      return undefined;
    }
    const combinedRange = ranges[0];
    for (let i = 1; i < ranges.length; i++) {
      extend(combinedRange, ranges[i]);
    }
    return combinedRange;
  }
}
export interface Position {
  line: number;
  character: number;
}
namespace Position {
  export function is(value: any): value is Position {
    const candidate = value as Position;
    return candidate && candidate.line !== void 0 && candidate.character !== void 0;
  }
}
export interface Range {
  start: Position;
  end: Position;
}
namespace Range {
  export function is(value: any): value is Range {
    const candidate = value as Range;
    return candidate && candidate.start !== void 0 && candidate.end !== void 0;
  }
}
export interface DocumentRange {
  path: string;
  range: Range;
}
export function comparePositions(a: Position, b: Position) {
  if (a.line < b.line) {
    return -1;
  } else if (a.line > b.line) {
    return 1;
  } else if (a.character < b.character) {
    return -1;
  } else if (a.character > b.character) {
    return 1;
  }
  return 0;
}
export function getEmptyPosition(): Position {
  return {
    line: 0,
    character: 0,
  };
}
export function doRangesOverlap(a: Range, b: Range) {
  if (comparePositions(b.start, a.end) >= 0) {
    return false;
  } else if (comparePositions(a.start, b.end) >= 0) {
    return false;
  }
  return true;
}
export function doRangesIntersect(a: Range, b: Range) {
  if (comparePositions(b.start, a.end) > 0) {
    return false;
  } else if (comparePositions(a.start, b.end) > 0) {
    return false;
  }
  return true;
}
export function doesRangeContain(range: Range, positionOrRange: Position | Range): boolean {
  if (Position.is(positionOrRange)) {
    return comparePositions(range.start, positionOrRange) <= 0 && comparePositions(range.end, positionOrRange) >= 0;
  }
  return doesRangeContain(range, positionOrRange.start) && doesRangeContain(range, positionOrRange.end);
}
export function rangesAreEqual(a: Range, b: Range) {
  return comparePositions(a.start, b.start) === 0 && comparePositions(a.end, b.end) === 0;
}
export function getEmptyRange(): Range {
  return {
    start: getEmptyPosition(),
    end: getEmptyPosition(),
  };
}
export function isEmptyPosition(pos: Position) {
  return pos.character === 0 && pos.line === 0;
}
export function isEmptyRange(range: Range) {
  return isEmptyPosition(range.start) && isEmptyPosition(range.end);
}
export class TextRangeCollection<T extends TextRange> {
  private _items: T[];
  constructor(items: T[]) {
    this._items = items;
  }
  get start(): number {
    return this._items.length > 0 ? this._items[0].start : 0;
  }
  get end(): number {
    const lastItem = this._items[this._items.length - 1];
    return this._items.length > 0 ? lastItem.start + lastItem.length : 0;
  }
  get length(): number {
    return this.end - this.start;
  }
  get count(): number {
    return this._items.length;
  }
  contains(position: number) {
    return position >= this.start && position < this.end;
  }
  getItemAt(index: number): T {
    if (index < 0 || index >= this._items.length) {
      throw new Error('index is out of range');
    }
    return this._items[index];
  }
  getItemAtPosition(position: number): number {
    if (this.count === 0) {
      return -1;
    }
    if (position < this.start) {
      return -1;
    }
    if (position > this.end) {
      return -1;
    }
    let min = 0;
    let max = this.count - 1;
    while (min < max) {
      const mid = Math.floor(min + (max - min) / 2);
      const item = this._items[mid];
      if (position >= item.start) {
        if (mid >= this.count - 1 || position < this._items[mid + 1].start) {
          return mid;
        }
      }
      if (position < item.start) {
        max = mid - 1;
      } else {
        min = mid + 1;
      }
    }
    return min;
  }
  getItemContaining(position: number): number {
    if (this.count === 0) {
      return -1;
    }
    if (position < this.start) {
      return -1;
    }
    if (position > this.end) {
      return -1;
    }
    let min = 0;
    let max = this.count - 1;
    while (min <= max) {
      const mid = Math.floor(min + (max - min) / 2);
      const item = this._items[mid];
      if (TextRange.contains(item, position)) {
        return mid;
      }
      if (mid < this.count - 1 && TextRange.getEnd(item) <= position && position < this._items[mid + 1].start) {
        return -1;
      }
      if (position < item.start) {
        max = mid - 1;
      } else {
        min = mid + 1;
      }
    }
    return -1;
  }
}
export function convertOffsetToPosition(offset: number, lines: TextRangeCollection<TextRange>): Position {
  if (lines.end === 0) {
    return {
      line: 0,
      character: 0,
    };
  }
  let offsetAdjustment = 0;
  if (offset >= lines.end) {
    offset = lines.end - 1;
    offsetAdjustment = 1;
  }
  const itemIndex = lines.getItemContaining(offset);
  assert(itemIndex >= 0 && itemIndex <= lines.length);
  const lineRange = lines.getItemAt(itemIndex);
  assert(lineRange !== undefined);
  return {
    line: itemIndex,
    character: offset - lineRange.start + offsetAdjustment,
  };
}
export function convertOffsetsToRange(startOffset: number, endOffset: number, lines: TextRangeCollection<TextRange>): Range {
  const start = convertOffsetToPosition(startOffset, lines);
  const end = convertOffsetToPosition(endOffset, lines);
  return { start, end };
}
export function convertPositionToOffset(position: Position, lines: TextRangeCollection<TextRange>): number | undefined {
  if (position.line >= lines.count) {
    return undefined;
  }
  return lines.getItemAt(position.line).start + position.character;
}
export function convertRangeToTextRange(range: Range, lines: TextRangeCollection<TextRange>): TextRange | undefined {
  const start = convertPositionToOffset(range.start, lines);
  if (start === undefined) {
    return undefined;
  }
  const end = convertPositionToOffset(range.end, lines);
  if (end === undefined) {
    return undefined;
  }
  return TextRange.fromBounds(start, end);
}
export interface TextEditAction {
  range: Range;
  replacementText: string;
}
export interface FileEditAction extends TextEditAction {
  filePath: string;
}
export function convertTextEdits(uri: string, editActions: TextEditAction[] | undefined): WorkspaceEdit {
  if (!editActions) {
    return {};
  }
  const edits: TextEdit[] = [];
  editActions.forEach((editAction) => {
    edits.push({
      range: editAction.range,
      newText: editAction.replacementText,
    });
  });
  return {
    changes: {
      [uri]: edits,
    },
  };
}
export function convertWorkspaceEdits(fs: FileSystem, edits: FileEditAction[]) {
  const workspaceEdits: WorkspaceEdit = {
    changes: {},
  };
  edits.forEach((edit) => {
    const uri = convertPathToUri(fs, edit.filePath);
    workspaceEdits.changes![uri] = workspaceEdits.changes![uri] || [];
    workspaceEdits.changes![uri].push({ range: edit.range, newText: edit.replacementText });
  });
  return workspaceEdits;
}
