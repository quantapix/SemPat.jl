import { assert } from '../common/debug';
import { ParseNode } from '../parser/parseNodes';
import * as ParseTreeUtils from './parseTreeUtils';
import { isTypeSame, Type } from './types';
export type TypeCache = Map<number, CachedType | undefined>;
export type CachedType = Type | IncompleteType;
export interface IncompleteType {
  isIncompleteType?: true;
  type: Type | undefined;
  incompleteSubtypes: (Type | undefined)[];
  generationCount: number;
}
export function isIncompleteType(cachedType: CachedType): cachedType is IncompleteType {
  return !!(cachedType as IncompleteType).isIncompleteType;
}
interface TypeCacheEntry {
  cache: TypeCache;
  id: number;
}
interface SpeculativeContext {
  speculativeRootNode: ParseNode;
  entriesToUndo: TypeCacheEntry[];
  allowCacheRetention: boolean;
}
interface SpeculativeTypeEntry {
  type: Type;
  expectedType: Type | undefined;
}
export class SpeculativeTypeTracker {
  private _speculativeContextStack: SpeculativeContext[] = [];
  private _speculativeTypeCache = new Map<number, SpeculativeTypeEntry[]>();
  enterSpeculativeContext(speculativeRootNode: ParseNode, allowCacheRetention: boolean) {
    this._speculativeContextStack.push({
      speculativeRootNode,
      entriesToUndo: [],
      allowCacheRetention,
    });
  }
  leaveSpeculativeContext() {
    assert(this._speculativeContextStack.length > 0);
    const context = this._speculativeContextStack.pop();
    context!.entriesToUndo.forEach((entry) => {
      entry.cache.delete(entry.id);
    });
  }
  isSpeculative(node?: ParseNode) {
    if (this._speculativeContextStack.length === 0) {
      return false;
    }
    if (!node) {
      return true;
    }
    for (let i = this._speculativeContextStack.length - 1; i >= 0; i--) {
      if (ParseTreeUtils.isNodeContainedWithin(node, this._speculativeContextStack[i].speculativeRootNode)) {
        return true;
      }
    }
    return false;
  }
  trackEntry(cache: TypeCache, id: number) {
    const stackSize = this._speculativeContextStack.length;
    if (stackSize > 0) {
      this._speculativeContextStack[stackSize - 1].entriesToUndo.push({
        cache,
        id,
      });
    }
  }
  disableSpeculativeMode() {
    const stack = this._speculativeContextStack;
    this._speculativeContextStack = [];
    return stack;
  }
  enableSpeculativeMode(stack: SpeculativeContext[]) {
    assert(this._speculativeContextStack.length === 0);
    this._speculativeContextStack = stack;
  }
  addSpeculativeType(node: ParseNode, type: Type, expectedType: Type | undefined) {
    assert(this._speculativeContextStack.length > 0);
    if (this._speculativeContextStack.some((context) => !context.allowCacheRetention)) return;
    let cacheEntries = this._speculativeTypeCache.get(node.id);
    if (!cacheEntries) {
      cacheEntries = [];
      this._speculativeTypeCache.set(node.id, cacheEntries);
    }
    cacheEntries.push({ type, expectedType });
  }
  getSpeculativeType(node: ParseNode, expectedType: Type | undefined) {
    if (this._speculativeContextStack.some((context) => ParseTreeUtils.isNodeContainedWithin(node, context.speculativeRootNode))) {
      const entries = this._speculativeTypeCache.get(node.id);
      if (entries) {
        for (const entry of entries) {
          if (!expectedType) {
            if (!entry.expectedType) {
              return entry.type;
            }
          } else if (entry.expectedType && isTypeSame(expectedType, entry.expectedType)) {
            return entry.type;
          }
        }
      }
    }
    return undefined;
  }
}
export class IncompleteTypeTracker {
  private _trackerStack: TypeCacheEntry[][] = [];
  private _isUndoTrackingEnabled = false;
  trackEntry(cache: TypeCache, id: number) {
    if (this._isUndoTrackingEnabled) {
      const topOfStack = this._trackerStack[this._trackerStack.length - 1];
      topOfStack.push({
        cache,
        id,
      });
    }
  }
  enterTrackingScope() {
    this._trackerStack.push([]);
  }
  exitTrackingScope() {
    const topOfStack = this._trackerStack.pop()!;
    topOfStack.forEach((entry) => {
      entry.cache.delete(entry.id);
    });
    if (this._trackerStack.length === 0) {
      this._isUndoTrackingEnabled = false;
    }
  }
  enableUndoTracking() {
    if (this._trackerStack.length > 0) {
      this._isUndoTrackingEnabled = true;
    }
  }
  isUndoTrackingEnabled() {
    return this._isUndoTrackingEnabled;
  }
}
