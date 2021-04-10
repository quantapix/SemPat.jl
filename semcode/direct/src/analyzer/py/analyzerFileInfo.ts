import { DiagRuleSet, ExecutionEnvironment } from '../common/configOptions';
import { TextRangeDiagSink } from '../common/diagnosticSink';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Scope } from './scope';
import { SymbolTable } from './symbol';
export type ImportLookup = (filePath: string) => ImportLookupResult | undefined;
export interface ImportLookupResult {
  symbolTable: SymbolTable;
  dunderAllNames: string[] | undefined;
  docString?: string;
}
export interface AnalyzerFileInfo {
  importLookup: ImportLookup;
  futureImports: Map<string, boolean>;
  builtinsScope?: Scope;
  typingModulePath?: string;
  typeshedModulePath?: string;
  collectionsModulePath?: string;
  diagnosticSink: TextRangeDiagSink;
  executionEnvironment: ExecutionEnvironment;
  diagnosticRuleSet: DiagRuleSet;
  fileContents: string;
  lines: TextRangeCollection<TextRange>;
  filePath: string;
  moduleName: string;
  isStubFile: boolean;
  isTypingStubFile: boolean;
  isTypingExtensionsStubFile: boolean;
  isBuiltInStubFile: boolean;
  isInPyTypedPackage: boolean;
  accessedSymbolMap: Map<number, true>;
}
