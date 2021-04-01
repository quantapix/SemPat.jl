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
