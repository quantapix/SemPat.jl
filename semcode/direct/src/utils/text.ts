import { TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { convertPathToUri } from './paths';
import { FileSystem } from './files';
export interface TextRange {
  start: number;
  length: number;
}
export namespace TextRange {
  export function create(s: number, l: number): TextRange {
    if (s < 0) throw new Error('start must be non-negative');
    if (l < 0) throw new Error('length must be non-negative');
    return { start: s, length: l };
  }
  export function fromBounds(s: number, e: number): TextRange {
    if (s < 0) throw new Error('start must be non-negative');
    if (s > e) throw new Error('end must be greater than or equal to start');
    return create(s, e - s);
  }
  export function getEnd(r: TextRange): number {
    return r.start + r.length;
  }
  export function contains(r: TextRange, p: number): boolean {
    return p >= r.start && p < getEnd(r);
  }
  export function containsRange(r: TextRange, span: TextRange): boolean {
    return span.start >= r.start && getEnd(span) <= getEnd(r);
  }
  export function overlaps(r: TextRange, p: number): boolean {
    return p >= r.start && p <= getEnd(r);
  }
  export function extend(r: TextRange, es: TextRange | TextRange[] | undefined) {
    if (es) {
      if (Array.isArray(es)) {
        es.forEach((r) => {
          extend(r, r);
        });
      } else {
        if (es.start < r.start) {
          r.length += r.start - es.start;
          r.start = es.start;
        }
        if (getEnd(es) > getEnd(r)) r.length += getEnd(es) - getEnd(r);
      }
    }
  }
  export function combine(rs: TextRange[]): TextRange | undefined {
    if (rs.length === 0) return undefined;
    const y = rs[0];
    for (let i = 1; i < rs.length; i++) {
      extend(y, rs[i]);
    }
    return y;
  }
}
export interface Position {
  line: number;
  character: number;
}
namespace Position {
  export function is(x: any): x is Position {
    const y = x as Position;
    return y && y.line !== void 0 && y.character !== void 0;
  }
}
export interface Range {
  start: Position;
  end: Position;
}
namespace Range {
  export function is(x: any): x is Range {
    const y = x as Range;
    return y && y.start !== void 0 && y.end !== void 0;
  }
}
export interface DocumentRange {
  path: string;
  range: Range;
}
export function comparePositions(a: Position, b: Position) {
  if (a.line < b.line) return -1;
  else if (a.line > b.line) return 1;
  else if (a.character < b.character) return -1;
  else if (a.character > b.character) return 1;
  return 0;
}
export function getEmptyPosition(): Position {
  return { line: 0, character: 0 };
}
export function doRangesOverlap(a: Range, b: Range) {
  if (comparePositions(b.start, a.end) >= 0) return false;
  else if (comparePositions(a.start, b.end) >= 0) return false;
  return true;
}
export function doRangesIntersect(a: Range, b: Range) {
  if (comparePositions(b.start, a.end) > 0) return false;
  else if (comparePositions(a.start, b.end) > 0) return false;
  return true;
}
export function doesRangeContain(r: Range, p: Position | Range): boolean {
  if (Position.is(p)) return comparePositions(r.start, p) <= 0 && comparePositions(r.end, p) >= 0;
  return doesRangeContain(r, p.start) && doesRangeContain(r, p.end);
}
export function rangesAreEqual(a: Range, b: Range) {
  return comparePositions(a.start, b.start) === 0 && comparePositions(a.end, b.end) === 0;
}
export function getEmptyRange(): Range {
  return { start: getEmptyPosition(), end: getEmptyPosition() };
}
export function isEmptyPosition(p: Position) {
  return p.character === 0 && p.line === 0;
}
export function isEmptyRange(r: Range) {
  return isEmptyPosition(r.start) && isEmptyPosition(r.end);
}
export class TextRangeCollection<R extends TextRange> {
  private rs: R[];
  constructor(rs: R[]) {
    this.rs = rs;
  }
  get start(): number {
    return this.rs.length > 0 ? this.rs[0].start : 0;
  }
  get end(): number {
    const last = this.rs[this.rs.length - 1];
    return this.rs.length > 0 ? last.start + last.length : 0;
  }
  get length(): number {
    return this.end - this.start;
  }
  get count(): number {
    return this.rs.length;
  }
  contains(p: number) {
    return p >= this.start && p < this.end;
  }
  getItemAt(i: number): R {
    if (i < 0 || i >= this.rs.length) throw new Error('index is out of range');
    return this.rs[i];
  }
  getItemAtPosition(p: number): number {
    if (this.count === 0) return -1;
    if (p < this.start) return -1;
    if (p > this.end) return -1;
    let min = 0;
    let max = this.count - 1;
    while (min < max) {
      const mid = Math.floor(min + (max - min) / 2);
      const r = this.rs[mid];
      if (p >= r.start) if (mid >= this.count - 1 || p < this.rs[mid + 1].start) return mid;
      if (p < r.start) max = mid - 1;
      else min = mid + 1;
    }
    return min;
  }
  getItemContaining(p: number): number {
    if (this.count === 0) return -1;
    if (p < this.start) return -1;
    if (p > this.end) return -1;
    let min = 0;
    let max = this.count - 1;
    while (min <= max) {
      const mid = Math.floor(min + (max - min) / 2);
      const r = this.rs[mid];
      if (TextRange.contains(r, p)) return mid;
      if (mid < this.count - 1 && TextRange.getEnd(r) <= p && p < this.rs[mid + 1].start) return -1;
      if (p < r.start) max = mid - 1;
      else min = mid + 1;
    }
    return -1;
  }
}
export function convertOffsetToPosition(off: number, rs: TextRangeCollection<TextRange>): Position {
  if (rs.end === 0) return { line: 0, character: 0 };
  let delta = 0;
  if (off >= rs.end) {
    off = rs.end - 1;
    delta = 1;
  }
  const line = rs.getItemContaining(off);
  assert(line >= 0 && line <= rs.length);
  const r = rs.getItemAt(line);
  assert(r !== undefined);
  return { line, character: off - r.start + delta };
}
export function convertOffsetsToRange(startOff: number, endOff: number, rs: TextRangeCollection<TextRange>): Range {
  const start = convertOffsetToPosition(startOff, rs);
  const end = convertOffsetToPosition(endOff, rs);
  return { start, end };
}
export function convertPositionToOffset(p: Position, rs: TextRangeCollection<TextRange>): number | undefined {
  if (p.line >= rs.count) return undefined;
  return rs.getItemAt(p.line).start + p.character;
}
export function convertRangeToTextRange(r: Range, rs: TextRangeCollection<TextRange>): TextRange | undefined {
  const s = convertPositionToOffset(r.start, rs);
  if (s === undefined) return undefined;
  const e = convertPositionToOffset(r.end, rs);
  if (e === undefined) return undefined;
  return TextRange.fromBounds(s, e);
}
export interface TextEditAction {
  range: Range;
  replacement: string;
}
export interface FileEditAction extends TextEditAction {
  filePath: string;
}
export function convertTextEdits(uri: string, as?: TextEditAction[]): WorkspaceEdit {
  if (!as) return {};
  const es: TextEdit[] = [];
  as.forEach((a) => {
    es.push({ range: a.range, newText: a.replacement });
  });
  return { changes: { [uri]: es } };
}
export function convertWorkspaceEdits(fs: FileSystem, as: FileEditAction[]) {
  const ys: WorkspaceEdit = { changes: {} };
  as.forEach((a) => {
    const u = convertPathToUri(fs, a.filePath);
    ys.changes![u] = ys.changes![u] || [];
    ys.changes![u].push({ range: a.range, newText: a.replacement });
  });
  return ys;
}
