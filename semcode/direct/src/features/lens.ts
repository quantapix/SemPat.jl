import * as qv from 'vscode';
import type * as qp from '../../protocol';
import { escapeRegExp } from '../../utils/regexp';
import * as qk from '../utils/key';
import { CachedResponse } from '../../old/ts/tsServer/cachedResponse';
import { ClientCap, ServiceClient } from '../server/service';
import { conditionalRegistration, requireSomeCap, requireConfig } from '../server/base';
import * as qu from '../utils/base';
import { getSymbolRange } from './lens';
import { ExecTarget } from '../../old/ts/tsServer/server';
import { isAbsolute } from 'path';
import { getGoConfig } from './config';
import { GoSymbol } from './go/symbol';
import { GoReferenceProvider } from './reference';
import { getBinPath } from './util';
import { CodeLens } from 'vscode';
import { getBenchmarkFunctions, getTestFunctions } from './testUtils';
export class TsCodeLens implements qv.CodeLensProvider {
  private codeLenses: qv.CodeLens[] = [];
  private regex: RegExp;
  private _onDidChangeCodeLenses: qv.EventEmitter<void> = new qv.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: qv.Event<void> = this._onDidChangeCodeLenses.event;
  constructor() {
    this.regex = /(.+)/g;
    qv.workspace.onDidChangeConfig((_) => {
      this._onDidChangeCodeLenses.fire();
    });
  }
  public provideCodeLenses(d: qv.TextDocument, t: qv.CancellationToken): qv.CodeLens[] | Thenable<qv.CodeLens[]> {
    if (qv.workspace.getConfig('codelens-sample').get('enableCodeLens', true)) {
      this.codeLenses = [];
      const regex = new RegExp(this.regex);
      const text = d.getText();
      let matches;
      while ((matches = regex.exec(text)) !== null) {
        const line = d.lineAt(d.positionAt(matches.index).line);
        const indexOf = line.text.indexOf(matches[0]);
        const position = new qv.Position(line.lineNumber, indexOf);
        const range = d.getWordRangeAtPosition(position, new RegExp(this.regex));
        if (range) this.codeLenses.push(new qv.CodeLens(range));
      }
      return this.codeLenses;
    }
    return [];
  }
  public resolveCodeLens(codeLens: qv.CodeLens, token: qv.CancellationToken) {
    if (qv.workspace.getConfig('codelens-sample').get('enableCodeLens', true)) {
      codeLens.command = {
        title: 'Codelens provided by sample extension',
        tooltip: 'Tooltip provided by sample extension',
        command: 'codelens-sample.codelensAction',
        arguments: ['Argument 1', false],
      };
      return codeLens;
    }
    return null;
  }
}
export class RefsCodeLens extends qv.CodeLens {
  constructor(public document: qv.Uri, public file: string, range: qv.Range) {
    super(range);
  }
}
export abstract class TsBaseLens implements qv.CodeLensProvider<RefsCodeLens> {
  public static readonly cancelledCommand: qv.Command = { title: '', command: '' };
  public static readonly errorCommand: qv.Command = { title: 'referenceErrorLabel', command: '' };
  private onDidChangeCodeLensesEmitter = new qv.EventEmitter<void>();
  public constructor(protected client: ServiceClient, private cachedResponse: CachedResponse<qp.NavTreeResponse>) {}
  public get onDidChangeCodeLenses(): qv.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }
  async provideCodeLenses(d: qv.TextDocument, token: qv.CancellationToken): Promise<RefsCodeLens[]> {
    const filepath = this.client.toOpenedFilePath(d);
    if (!filepath) return [];
    const response = await this.cachedResponse.execute(d, () => this.client.execute('navtree', { file: filepath }, token));
    if (response.type !== 'response') return [];
    const tree = response.body;
    const referenceableSpans: qv.Range[] = [];
    if (tree && tree.childItems) tree.childItems.forEach((item) => this.walkNavTree(d, item, null, referenceableSpans));
    return referenceableSpans.map((span) => new RefsCodeLens(d.uri, filepath, span));
  }
  protected abstract extractSymbol(d: qv.TextDocument, item: qp.NavigationTree, parent: qp.NavigationTree | null): qv.Range | null;
  private walkNavTree(d: qv.TextDocument, item: qp.NavigationTree, parent: qp.NavigationTree | null, results: qv.Range[]): void {
    if (!item) return;
    const range = this.extractSymbol(d, item, parent);
    if (range) results.push(range);
    (item.childItems || []).forEach((child) => this.walkNavTree(d, child, item, results));
  }
}
export function getSymbolRange(d: qv.TextDocument, item: qp.NavigationTree): qv.Range | null {
  if (item.nameSpan) return qu.Range.fromTextSpan(item.nameSpan);
  const span = item.spans && item.spans[0];
  if (!span) return null;
  const range = qu.Range.fromTextSpan(span);
  const text = d.getText(range);
  const identifierMatch = new RegExp(`^(.*?(\\b|\\W))${escapeRegExp(item.text || '')}(\\b|\\W)`, 'gm');
  const match = identifierMatch.exec(text);
  const prefixLength = match ? match.index + match[1].length : 0;
  const startOffset = d.offsetAt(new qv.Position(range.start.line, range.start.character)) + prefixLength;
  return new qv.Range(d.positionAt(startOffset), d.positionAt(startOffset + item.text.length));
}
export default class TsImplsLens extends TsBaseLens {
  public async resolveCodeLens(codeLens: RefsCodeLens, token: qv.CancellationToken): Promise<qv.CodeLens> {
    const args = qu.Position.toFileLocationRequestArgs(codeLens.file, codeLens.range.start);
    const response = await this.client.execute('implementation', args, token, { lowPriority: true, cancelOnResourceChange: codeLens.document });
    if (response.type !== 'response' || !response.body) {
      codeLens.command = response.type === 'cancelled' ? TsBaseLens.cancelledCommand : TsBaseLens.errorCommand;
      return codeLens;
    }
    const locations = response.body
      .map(
        (reference) =>
          new qv.Location(
            this.client.toResource(reference.file),
            reference.start.line === reference.end.line ? qu.Range.fromTextSpan(reference) : new qv.Range(qu.Position.fromLocation(reference.start), new qv.Position(reference.start.line, 0))
          )
      )
      .filter(
        (location) =>
          !(location.uri.toString() === codeLens.document.toString() && location.range.start.line === codeLens.range.start.line && location.range.start.character === codeLens.range.start.character)
      );
    codeLens.command = this.getCommand(locations, codeLens);
    return codeLens;
  }
  private getCommand(locations: qv.Location[], codeLens: RefsCodeLens): qv.Command | undefined {
    return {
      title: this.getTitle(locations),
      command: locations.length ? 'editor.action.showReferences' : '',
      arguments: [codeLens.document, codeLens.range.start, locations],
    };
  }
  private getTitle(locations: qv.Location[]): string {
    return locations.length === 1 ? 'oneImplementationLabel' : 'manyImplementationLabel';
  }
  protected extractSymbol(d: qv.TextDocument, item: qp.NavigationTree, _: qp.NavigationTree | null): qv.Range | null {
    switch (item.kind) {
      case qk.Kind.interface:
        return getSymbolRange(d, item);
      case qk.Kind.class:
      case qk.Kind.method:
      case qk.Kind.memberVariable:
      case qk.Kind.memberGetAccessor:
      case qk.Kind.memberSetAccessor:
        if (item.kindModifiers.match(/\babstract\b/g)) return getSymbolRange(d, item);
        break;
    }
    return null;
  }
}
export function register(s: qu.DocumentSelector, mode: string, c: ServiceClient, r: CachedResponse<qp.NavTreeResponse>) {
  return conditionalRegistration([requireConfig(mode, 'implementationsCodeLens.enabled'), qu.requireSomeCap(c, ClientCap.Semantic)], () => {
    return qv.languages.registerCodeLensProvider(s.semantic, new TsImplsLens(c, r));
  });
}
export class TsRefsLens extends TsBaseLens {
  public constructor(protected client: ServiceClient, protected _cachedResponse: CachedResponse<qp.NavTreeResponse>, private modeId: string) {
    super(client, _cachedResponse);
  }
  public async resolveCodeLens(codeLens: RefsCodeLens, token: qv.CancellationToken): Promise<qv.CodeLens> {
    const args = qu.Position.toFileLocationRequestArgs(codeLens.file, codeLens.range.start);
    const response = await this.client.execute('references', args, token, {
      lowPriority: true,
      executionTarget: ExecTarget.Semantic,
      cancelOnResourceChange: codeLens.document,
    });
    if (response.type !== 'response' || !response.body) {
      codeLens.command = response.type === 'cancelled' ? TsBaseLens.cancelledCommand : TsBaseLens.errorCommand;
      return codeLens;
    }
    const locations = response.body.refs.filter((reference) => !reference.isDefinition).map((reference) => qu.Location.fromTextSpan(this.client.toResource(reference.file), reference));
    codeLens.command = {
      title: this.getCodeLensLabel(locations),
      command: locations.length ? 'editor.action.showReferences' : '',
      arguments: [codeLens.document, codeLens.range.start, locations],
    };
    return codeLens;
  }
  private getCodeLensLabel(locations: ReadonlyArray<qv.Location>): string {
    return locations.length === 1 ? 'oneReferenceLabel' : 'manyReferenceLabel';
  }
  protected extractSymbol(d: qv.TextDocument, item: qp.NavigationTree, parent: qp.NavigationTree | null): qv.Range | null {
    if (parent && parent.kind === qk.Kind.enum) return getSymbolRange(d, item);
    switch (item.kind) {
      case qk.Kind.function:
        const showOnAllFunctions = qv.workspace.getConfig(this.modeId).get<boolean>('referencesCodeLens.showOnAllFunctions');
        if (showOnAllFunctions) return getSymbolRange(d, item);
      case qk.Kind.const:
      case qk.Kind.let:
      case qk.Kind.variable:
        if (/\bexport\b/.test(item.kindModifiers)) {
          return getSymbolRange(d, item);
        }
        break;
      case qk.Kind.class:
        if (item.text === '<class>') break;
        return getSymbolRange(d, item);
      case qk.Kind.interface:
      case qk.Kind.type:
      case qk.Kind.enum:
        return getSymbolRange(d, item);
      case qk.Kind.method:
      case qk.Kind.memberGetAccessor:
      case qk.Kind.memberSetAccessor:
      case qk.Kind.constructorImplementation:
      case qk.Kind.memberVariable:
        if (parent && qu.Position.fromLocation(parent.spans[0].start).isEqual(qu.Position.fromLocation(item.spans[0].start))) {
          return null;
        }
        switch (parent?.kind) {
          case qk.Kind.class:
          case qk.Kind.interface:
          case qk.Kind.type:
            return getSymbolRange(d, item);
        }
        break;
    }
    return null;
  }
}
export function register(s: qu.DocumentSelector, mode: string, c: ServiceClient, r: CachedResponse<qp.NavTreeResponse>) {
  return conditionalRegistration([requireConfig(mode, 'referencesCodeLens.enabled'), qu.requireSomeCap(c, ClientCap.Semantic)], () => {
    return qv.languages.registerCodeLensProvider(s.semantic, new TsRefsLens(c, r, mode));
  });
}
export abstract class GoBaseLens implements qv.CodeLensProvider {
  protected enabled = true;
  private onDidChangeCodeLensesEmitter = new qv.EventEmitter<void>();
  public get onDidChangeCodeLenses(): qv.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }
  public setEnabled(enabled: false): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.onDidChangeCodeLensesEmitter.fire();
    }
  }
  public provideCodeLenses(d: qv.TextDocument, t: qv.CancellationToken): qv.ProviderResult<qv.CodeLens[]> {
    return [];
  }
}
const methodRegex = /^func\s+\(\s*\w+\s+\*?\w+\s*\)\s+/;
class RefsLens extends qv.CodeLens {
  constructor(public doc: qv.TextDocument, r: qv.Range) {
    super(r);
  }
}
export class GoRefsLens extends GoBaseLens {
  public provideCodeLenses(d: qv.TextDocument, t: qv.CancellationToken): qv.CodeLens[] | Thenable<CodeLens[]> {
    if (!this.enabled) return [];
    const codeLensConfig = getGoConfig(d.uri).get<{ [key: string]: any }>('enableCodeLens');
    const codelensEnabled = codeLensConfig ? codeLensConfig['references'] : false;
    if (!codelensEnabled) return Promise.resolve([]);
    const goGuru = getBinPath('guru');
    if (!isAbsolute(goGuru)) {
      return Promise.resolve([]);
    }
    return this.provideDocumentSymbols(d, t).then((symbols) => {
      return symbols.map((symbol) => {
        let position = symbol.range.start;
        if (symbol.kind === qv.SymbolKind.Function) {
          const funcDecl = d.lineAt(position.line).text.substr(position.character);
          const match = methodRegex.exec(funcDecl);
          position = position.translate(0, match ? match[0].length : 5);
        }
        return new RefsLens(d, new qv.Range(position, position));
      });
    });
  }
  public resolveCodeLens?(inputCodeLens: qv.CodeLens, token: qv.CancellationToken): qv.CodeLens | Thenable<CodeLens> {
    const codeLens = inputCodeLens as RefsLens;
    if (token.isCancellationRequested) return Promise.resolve(codeLens);
    const options = { includeDeclaration: false };
    const referenceProvider = new GoReferenceProvider();
    return referenceProvider.provideReferences(codeLens.doc, codeLens.range.start, options, token).then(
      (references) => {
        codeLens.command = {
          title: references.length === 1 ? '1 reference' : references.length + ' references',
          command: 'editor.action.showReferences',
          arguments: [codeLens.doc.uri, codeLens.range.start, references],
        };
        return codeLens;
      },
      (err) => {
        console.log(err);
        codeLens.command = { title: 'Error finding references', command: '' };
        return codeLens;
      }
    );
  }
  private async provideDocumentSymbols(d: qv.TextDocument, t: qv.CancellationToken): Promise<qv.DocumentSymbol[]> {
    const symbolProvider = new GoSymbol();
    const isTestFile = d.fileName.endsWith('_test.go');
    const symbols = await symbolProvider.provideDocumentSymbols(d, t);
    return symbols[0].children.filter((symbol) => {
      if (symbol.kind === qv.SymbolKind.Interface) return true;
      if (symbol.kind === qv.SymbolKind.Function) {
        if (isTestFile && (symbol.name.startsWith('Test') || symbol.name.startsWith('Example') || symbol.name.startsWith('Benchmark'))) return false;
        return true;
      }
      return false;
    });
  }
}
export class GoRunTestLens extends GoBaseLens {
  private readonly benchmarkRegex = /^Benchmark.+/;
  public async provideCodeLenses(d: qv.TextDocument, t: qv.CancellationToken): Promise<CodeLens[]> {
    if (!this.enabled) return [];
    const config = getGoConfig(d.uri);
    const codeLensConfig = config.get<{ [key: string]: any }>('enableCodeLens');
    const codelensEnabled = codeLensConfig ? codeLensConfig['runtest'] : false;
    if (!codelensEnabled || !d.fileName.endsWith('_test.go')) return [];
    const codelenses = await Promise.all([this.getCodeLensForPackage(d, t), this.getCodeLensForFunctions(d, t)]);
    return ([] as qv.CodeLens[]).concat(...codelenses);
  }
  private async getCodeLensForPackage(d: qv.TextDocument, t: qv.CancellationToken): Promise<CodeLens[]> {
    const documentSymbolProvider = new GoSymbol();
    const symbols = await documentSymbolProvider.provideDocumentSymbols(d, t);
    if (!symbols || symbols.length === 0) return [];
    const pkg = symbols[0];
    if (!pkg) return [];
    const range = pkg.range;
    const packageCodeLens = [new qv.CodeLens(range, { title: 'run package tests', command: 'go.test.package' }), new qv.CodeLens(range, { title: 'run file tests', command: 'go.test.file' })];
    if (pkg.children.some((sym) => sym.kind === qv.SymbolKind.Function && this.benchmarkRegex.test(sym.name))) {
      packageCodeLens.push(
        new qv.CodeLens(range, { title: 'run package benchmarks', command: 'go.benchmark.package' }),
        new qv.CodeLens(range, { title: 'run file benchmarks', command: 'go.benchmark.file' })
      );
    }
    return packageCodeLens;
  }
  private async getCodeLensForFunctions(d: qv.TextDocument, t: qv.CancellationToken): Promise<CodeLens[]> {
    const testPromise = async (): Promise<qv.CodeLens[]> => {
      const testFunctions = await getTestFunctions(d, t);
      if (!testFunctions) return [];
      const codelens: qv.CodeLens[] = [];
      for (const f of testFunctions) {
        codelens.push(
          new qv.CodeLens(f.range, {
            title: 'run test',
            command: 'go.test.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
        codelens.push(
          new qv.CodeLens(f.range, {
            title: 'debug test',
            command: 'go.debug.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
      }
      return codelens;
    };
    const benchmarkPromise = async (): Promise<qv.CodeLens[]> => {
      const benchmarkFunctions = await getBenchmarkFunctions(d, t);
      if (!benchmarkFunctions) return [];
      const codelens: qv.CodeLens[] = [];
      for (const f of benchmarkFunctions) {
        codelens.push(
          new qv.CodeLens(f.range, {
            title: 'run benchmark',
            command: 'go.benchmark.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
        codelens.push(
          new qv.CodeLens(f.range, {
            title: 'debug benchmark',
            command: 'go.debug.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
      }
      return codelens;
    };
    const codelenses = await Promise.all([testPromise(), benchmarkPromise()]);
    return ([] as qv.CodeLens[]).concat(...codelenses);
  }
}
