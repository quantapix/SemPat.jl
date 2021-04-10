import { CancellationToken } from 'vscode-languageserver';
import { OpCanceledException, throwIfCancellationRequested } from '../common/cancellationUtils';
import { ConfigOptions } from '../common/configOptions';
import { Console } from '../common/console';
import * as debug from '../common/debug';
import { FileDiags } from '../common/diagnosticSink';
import { Duration } from '../common/timing';
import { MaxAnalysisTime, Program } from './program';
export const nullCallback: AnalysisCompleteCallback = (_) => {
  /* empty */
};
export interface AnalysisResults {
  diagnostics: FileDiags[];
  filesInProgram: number;
  checkingOnlyOpenFiles: boolean;
  filesRequiringAnalysis: number;
  fatalErrorOccurred: boolean;
  configParseErrorOccurred: boolean;
  elapsedTime: number;
  error?: Error;
}
export type AnalysisCompleteCallback = (results: AnalysisResults) => void;
export function analyzeProgram(
  program: Program,
  maxTime: MaxAnalysisTime | undefined,
  configOptions: ConfigOptions,
  callback: AnalysisCompleteCallback | undefined,
  console: Console,
  token: CancellationToken
): boolean {
  let moreToAnalyze = false;
  callback = callback ?? nullCallback;
  try {
    throwIfCancellationRequested(token);
    const duration = new Duration();
    moreToAnalyze = program.analyze(maxTime, token);
    const filesLeftToAnalyze = program.getFilesToAnalyzeCount();
    debug.assert(filesLeftToAnalyze === 0 || moreToAnalyze);
    const diagnostics = program.getDiags(configOptions);
    const diagnosticFileCount = diagnostics.length;
    const elapsedTime = duration.getDurationInSeconds();
    if (diagnosticFileCount > 0 || !moreToAnalyze) {
      callback({
        diagnostics,
        filesInProgram: program.getFileCount(),
        filesRequiringAnalysis: filesLeftToAnalyze,
        checkingOnlyOpenFiles: program.isCheckingOnlyOpenFiles(),
        fatalErrorOccurred: false,
        configParseErrorOccurred: false,
        elapsedTime,
      });
    }
  } catch (e) {
    if (OpCanceledException.is(e)) {
      return false;
    }
    const message = debug.getErrorString(e);
    console.error('Error performing analysis: ' + message);
    callback({
      diagnostics: [],
      filesInProgram: 0,
      filesRequiringAnalysis: 0,
      checkingOnlyOpenFiles: true,
      fatalErrorOccurred: true,
      configParseErrorOccurred: false,
      elapsedTime: 0,
      error: debug.getSerializableError(e),
    });
  }
  return moreToAnalyze;
}
