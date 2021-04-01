import { fail } from '../common/debug';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';

export const enum ScopeType {
  ListComprehension,

  Function,

  Class,

  Module,

  Builtin,
}

export const enum NameBindingType {
  Nonlocal,

  Global,
}

export interface SymbolWithScope {
  symbol: Symbol;

  scope: Scope;

  isOutsideCallerModule: boolean;

  isBeyondExecutionScope: boolean;
}

export class Scope {
  readonly type: ScopeType;

  readonly parent?: Scope;

  readonly symbolTable: SymbolTable = new Map<string, Symbol>();

  readonly notLocalBindings = new Map<string, NameBindingType>();

  constructor(type: ScopeType, parent?: Scope) {
    this.type = type;
    this.parent = parent;
  }

  getGlobalScope(): Scope {
    let curScope: Scope | undefined = this;
    while (curScope) {
      if (curScope.type === ScopeType.Module || curScope.type === ScopeType.Builtin) {
        return curScope;
      }

      curScope = curScope.parent;
    }

    fail('failed to find scope');
    return this;
  }

  isIndependentlyExecutable(): boolean {
    return this.type === ScopeType.Module || this.type === ScopeType.Function;
  }

  lookUpSymbol(name: string): Symbol | undefined {
    return this.symbolTable.get(name);
  }

  lookUpSymbolRecursive(name: string, isOutsideCallerModule = false, isBeyondExecutionScope = false): SymbolWithScope | undefined {
    const symbol = this.symbolTable.get(name);

    if (symbol) {
      if (isOutsideCallerModule && symbol.isExternallyHidden()) {
        return undefined;
      }

      const decls = symbol.getDeclarations();
      if (decls.length === 0 || decls.some((decl) => decl.type !== DeclarationType.Variable || !decl.isDefinedByMemberAccess)) {
        return {
          symbol,
          isOutsideCallerModule,
          isBeyondExecutionScope,
          scope: this,
        };
      }
    }

    let parentScope: Scope | undefined;
    if (this.notLocalBindings.get(name) === NameBindingType.Global) {
      parentScope = this.getGlobalScope();
    } else {
      parentScope = this.parent;
    }

    if (parentScope) {
      return parentScope.lookUpSymbolRecursive(name, isOutsideCallerModule || this.type === ScopeType.Module, isBeyondExecutionScope || this.isIndependentlyExecutable());
    }

    return undefined;
  }

  addSymbol(name: string, flags: SymbolFlags): Symbol {
    const symbol = new Symbol(flags);
    this.symbolTable.set(name, symbol);
    return symbol;
  }

  getBindingType(name: string) {
    return this.notLocalBindings.get(name);
  }

  setBindingType(name: string, bindingType: NameBindingType) {
    return this.notLocalBindings.set(name, bindingType);
  }
}
