import { isPythonBinary } from '../analyzer/pythonPathUtils';
import { CommandLineOptions } from '../common/commandLineOptions';
import { combinePaths } from '../common/pathUtils';
import { ServerSettings, WorkspaceServiceInstance } from '../languageServerBase';

export class AnalyzerServiceExecutor {
  static runWithOptions(languageServiceRootPath: string, workspace: WorkspaceServiceInstance, serverSettings: ServerSettings, typeStubTargetImportName?: string, trackFiles = true): void {
    const commandLineOptions = getEffectiveCommandLineOptions(languageServiceRootPath, workspace.rootPath, serverSettings, trackFiles, typeStubTargetImportName);
    workspace.serviceInstance.setOptions(commandLineOptions, trackFiles);
  }
}
function getEffectiveCommandLineOptions(languageServiceRootPath: string, workspaceRootPath: string, serverSettings: ServerSettings, trackFiles: boolean, typeStubTargetImportName?: string) {
  const opts = new CommandLineOptions(workspaceRootPath, true);
  opts.checkOnlyOpenFiles = serverSettings.openFilesOnly;
  opts.useLibraryCodeForTypes = serverSettings.useLibraryCodeForTypes;
  opts.typeCheckingMode = serverSettings.typeCheckingMode;
  opts.autoImportCompletions = serverSettings.autoImportCompletions;
  opts.indexing = serverSettings.indexing;
  opts.logTypeEvaluationTime = serverSettings.logTypeEvaluationTime ?? false;
  opts.typeEvaluationTimeThreshold = serverSettings.typeEvaluationTimeThreshold ?? 50;
  if (!trackFiles) {
    opts.watchForSourceChanges = false;
    opts.watchForLibraryChanges = false;
  } else {
    opts.watchForSourceChanges = serverSettings.watchForSourceChanges;
    opts.watchForLibraryChanges = serverSettings.watchForLibraryChanges;
  }
  if (serverSettings.venvPath) opts.venvPath = combinePaths(workspaceRootPath || languageServiceRootPath, serverSettings.venvPath);
  if (serverSettings.pythonPath) {
    if (!isPythonBinary(serverSettings.pythonPath)) opts.pythonPath = combinePaths(workspaceRootPath || languageServiceRootPath, serverSettings.pythonPath);
  }
  if (serverSettings.typeshedPath) opts.typeshedPath = serverSettings.typeshedPath;
  if (serverSettings.stubPath) opts.stubPath = serverSettings.stubPath;
  if (typeStubTargetImportName) opts.typeStubTargetImportName = typeStubTargetImportName;
  opts.autoSearchPaths = serverSettings.autoSearchPaths;
  opts.extraPaths = serverSettings.extraPaths;
  opts.diagnosticSeverityOverrides = serverSettings.diagnosticSeverityOverrides;
  return opts;
}
