import * as qv from 'vscode';
export abstract class GoBaseCodeLensProvider implements qv.CodeLensProvider {
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
  public provideCodeLenses(document: qv.TextDocument, token: qv.CancellationToken): qv.ProviderResult<qv.CodeLens[]> {
    return [];
  }
}

import { isAbsolute } from 'path';
import { CancellationToken, CodeLens, Range, TextDocument } from 'vscode';
import { getGoConfig } from './config';
import { GoBaseCodeLensProvider } from './go/codelens';
import { GoDocumentSymbolProvider } from './go/symbol';
import { GoReferenceProvider } from './reference';
import { getBinPath } from './util';
import * as qv from 'vscode';
const methodRegex = /^func\s+\(\s*\w+\s+\*?\w+\s*\)\s+/;
class ReferencesCodeLens extends CodeLens {
  constructor(public document: TextDocument, range: Range) {
    super(range);
  }
}
export class GoReferencesCodeLensProvider extends GoBaseCodeLensProvider {
  public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
    if (!this.enabled) {
      return [];
    }
    const codeLensConfig = getGoConfig(document.uri).get<{ [key: string]: any }>('enableCodeLens');
    const codelensEnabled = codeLensConfig ? codeLensConfig['references'] : false;
    if (!codelensEnabled) {
      return Promise.resolve([]);
    }
    const goGuru = getBinPath('guru');
    if (!isAbsolute(goGuru)) {
      return Promise.resolve([]);
    }
    return this.provideDocumentSymbols(document, token).then((symbols) => {
      return symbols.map((symbol) => {
        let position = symbol.range.start;
        if (symbol.kind === qv.SymbolKind.Function) {
          const funcDecl = document.lineAt(position.line).text.substr(position.character);
          const match = methodRegex.exec(funcDecl);
          position = position.translate(0, match ? match[0].length : 5);
        }
        return new ReferencesCodeLens(document, new qv.Range(position, position));
      });
    });
  }
  public resolveCodeLens?(inputCodeLens: CodeLens, token: CancellationToken): CodeLens | Thenable<CodeLens> {
    const codeLens = inputCodeLens as ReferencesCodeLens;
    if (token.isCancellationRequested) {
      return Promise.resolve(codeLens);
    }
    const options = {
      includeDeclaration: false,
    };
    const referenceProvider = new GoReferenceProvider();
    return referenceProvider.provideReferences(codeLens.document, codeLens.range.start, options, token).then(
      (references) => {
        codeLens.command = {
          title: references.length === 1 ? '1 reference' : references.length + ' references',
          command: 'editor.action.showReferences',
          arguments: [codeLens.document.uri, codeLens.range.start, references],
        };
        return codeLens;
      },
      (err) => {
        console.log(err);
        codeLens.command = {
          title: 'Error finding references',
          command: '',
        };
        return codeLens;
      }
    );
  }
  private async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<qv.DocumentSymbol[]> {
    const symbolProvider = new GoDocumentSymbolProvider();
    const isTestFile = document.fileName.endsWith('_test.go');
    const symbols = await symbolProvider.provideDocumentSymbols(document, token);
    return symbols[0].children.filter((symbol) => {
      if (symbol.kind === qv.SymbolKind.Interface) {
        return true;
      }
      if (symbol.kind === qv.SymbolKind.Function) {
        if (isTestFile && (symbol.name.startsWith('Test') || symbol.name.startsWith('Example') || symbol.name.startsWith('Benchmark'))) {
          return false;
        }
        return true;
      }
      return false;
    });
  }
}

import * as qv from 'vscode';
import { CancellationToken, CodeLens, TextDocument } from 'vscode';
import { getGoConfig } from './config';
import { GoBaseCodeLensProvider } from './go/codelens';
import { GoDocumentSymbolProvider } from './go/symbol';
import { getBenchmarkFunctions, getTestFunctions } from './testUtils';
export class GoRunTestCodeLensProvider extends GoBaseCodeLensProvider {
  private readonly benchmarkRegex = /^Benchmark.+/;
  public async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
    if (!this.enabled) {
      return [];
    }
    const config = getGoConfig(document.uri);
    const codeLensConfig = config.get<{ [key: string]: any }>('enableCodeLens');
    const codelensEnabled = codeLensConfig ? codeLensConfig['runtest'] : false;
    if (!codelensEnabled || !document.fileName.endsWith('_test.go')) {
      return [];
    }
    const codelenses = await Promise.all([this.getCodeLensForPackage(document, token), this.getCodeLensForFunctions(document, token)]);
    return ([] as CodeLens[]).concat(...codelenses);
  }
  private async getCodeLensForPackage(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
    const documentSymbolProvider = new GoDocumentSymbolProvider();
    const symbols = await documentSymbolProvider.provideDocumentSymbols(document, token);
    if (!symbols || symbols.length === 0) {
      return [];
    }
    const pkg = symbols[0];
    if (!pkg) {
      return [];
    }
    const range = pkg.range;
    const packageCodeLens = [
      new CodeLens(range, {
        title: 'run package tests',
        command: 'go.test.package',
      }),
      new CodeLens(range, {
        title: 'run file tests',
        command: 'go.test.file',
      }),
    ];
    if (pkg.children.some((sym) => sym.kind === qv.SymbolKind.Function && this.benchmarkRegex.test(sym.name))) {
      packageCodeLens.push(
        new CodeLens(range, {
          title: 'run package benchmarks',
          command: 'go.benchmark.package',
        }),
        new CodeLens(range, {
          title: 'run file benchmarks',
          command: 'go.benchmark.file',
        })
      );
    }
    return packageCodeLens;
  }
  private async getCodeLensForFunctions(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
    const testPromise = async (): Promise<CodeLens[]> => {
      const testFunctions = await getTestFunctions(document, token);
      if (!testFunctions) {
        return [];
      }
      const codelens: CodeLens[] = [];
      for (const f of testFunctions) {
        codelens.push(
          new CodeLens(f.range, {
            title: 'run test',
            command: 'go.test.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
        codelens.push(
          new CodeLens(f.range, {
            title: 'debug test',
            command: 'go.debug.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
      }
      return codelens;
    };
    const benchmarkPromise = async (): Promise<CodeLens[]> => {
      const benchmarkFunctions = await getBenchmarkFunctions(document, token);
      if (!benchmarkFunctions) {
        return [];
      }
      const codelens: CodeLens[] = [];
      for (const f of benchmarkFunctions) {
        codelens.push(
          new CodeLens(f.range, {
            title: 'run benchmark',
            command: 'go.benchmark.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
        codelens.push(
          new CodeLens(f.range, {
            title: 'debug benchmark',
            command: 'go.debug.cursor',
            arguments: [{ functionName: f.name }],
          })
        );
      }
      return codelens;
    };
    const codelenses = await Promise.all([testPromise(), benchmarkPromise()]);
    return ([] as CodeLens[]).concat(...codelenses);
  }
}
