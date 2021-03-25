import * as vscode from 'vscode';
import * as Proto from './protocol';
import BufferSyncSupport from '../old/ts/tsServer/bufferSyncSupport';
import { ExecutionTarget } from '../old/ts/tsServer/server';
import { TypeScriptVersion } from '../old/ts/tsServer/versionProvider';
import API from '../old/ts/utils/api';
import { TypeScriptServiceConfiguration } from '../old/ts/utils/configuration';
import { PluginManager } from '../old/ts/utils/plugins';
import { TelemetryReporter } from '../old/ts/utils/telemetry';

export enum ServerType {
  Syntax = 'syntax',
  Semantic = 'semantic',
}

export namespace ServerResponse {
  export class Cancelled {
    public readonly type = 'cancelled';
    constructor(public readonly reason: string) {}
  }
  export const NoContent = { type: 'noContent' } as const;
  export type Response<T extends Proto.Response> = T | Cancelled | typeof NoContent;
}

interface StandardTsServerRequests {
  applyCodeActionCommand: [Proto.ApplyCodeActionCommandRequestArgs, Proto.ApplyCodeActionCommandResponse];
  completionEntryDetails: [Proto.CompletionDetailsRequestArgs, Proto.CompletionDetailsResponse];
  completionInfo: [Proto.CompletionsRequestArgs, Proto.CompletionInfoResponse];
  completions: [Proto.CompletionsRequestArgs, Proto.CompletionsResponse];
  configure: [Proto.ConfigureRequestArguments, Proto.ConfigureResponse];
  definition: [Proto.FileLocationRequestArgs, Proto.DefinitionResponse];
  definitionAndBoundSpan: [Proto.FileLocationRequestArgs, Proto.DefinitionInfoAndBoundSpanResponse];
  docCommentTemplate: [Proto.FileLocationRequestArgs, Proto.DocCommandTemplateResponse];
  documentHighlights: [Proto.DocumentHighlightsRequestArgs, Proto.DocumentHighlightsResponse];
  format: [Proto.FormatRequestArgs, Proto.FormatResponse];
  formatonkey: [Proto.FormatOnKeyRequestArgs, Proto.FormatResponse];
  getApplicableRefactors: [Proto.GetApplicableRefactorsRequestArgs, Proto.GetApplicableRefactorsResponse];
  getCodeFixes: [Proto.CodeFixRequestArgs, Proto.CodeFixResponse];
  getCombinedCodeFix: [Proto.GetCombinedCodeFixRequestArgs, Proto.GetCombinedCodeFixResponse];
  getEditsForFileRename: [Proto.GetEditsForFileRenameRequestArgs, Proto.GetEditsForFileRenameResponse];
  getEditsForRefactor: [Proto.GetEditsForRefactorRequestArgs, Proto.GetEditsForRefactorResponse];
  getOutliningSpans: [Proto.FileRequestArgs, Proto.OutliningSpansResponse];
  getSupportedCodeFixes: [null, Proto.GetSupportedCodeFixesResponse];
  implementation: [Proto.FileLocationRequestArgs, Proto.ImplementationResponse];
  jsxClosingTag: [Proto.JsxClosingTagRequestArgs, Proto.JsxClosingTagResponse];
  navto: [Proto.NavtoRequestArgs, Proto.NavtoResponse];
  navtree: [Proto.FileRequestArgs, Proto.NavTreeResponse];
  organizeImports: [Proto.OrganizeImportsRequestArgs, Proto.OrganizeImportsResponse];
  projectInfo: [Proto.ProjectInfoRequestArgs, Proto.ProjectInfoResponse];
  quickinfo: [Proto.FileLocationRequestArgs, Proto.QuickInfoResponse];
  references: [Proto.FileLocationRequestArgs, Proto.ReferencesResponse];
  rename: [Proto.RenameRequestArgs, Proto.RenameResponse];
  selectionRange: [Proto.SelectionRangeRequestArgs, Proto.SelectionRangeResponse];
  signatureHelp: [Proto.SignatureHelpRequestArgs, Proto.SignatureHelpResponse];
  typeDefinition: [Proto.FileLocationRequestArgs, Proto.TypeDefinitionResponse];
  updateOpen: [Proto.UpdateOpenRequestArgs, Proto.Response];
  prepareCallHierarchy: [Proto.FileLocationRequestArgs, Proto.PrepareCallHierarchyResponse];
  provideCallHierarchyIncomingCalls: [Proto.FileLocationRequestArgs, Proto.ProvideCallHierarchyIncomingCallsResponse];
  provideCallHierarchyOutgoingCalls: [Proto.FileLocationRequestArgs, Proto.ProvideCallHierarchyOutgoingCallsResponse];
  fileReferences: [Proto.FileRequestArgs, Proto.FileReferencesResponse];
}

interface NoResponseTsServerRequests {
  open: [Proto.OpenRequestArgs, null];
  close: [Proto.FileRequestArgs, null];
  change: [Proto.ChangeRequestArgs, null];
  compilerOptionsForInferredProjects: [Proto.SetCompilerOptionsForInferredProjectsArgs, null];
  reloadProjects: [null, null];
  configurePlugin: [Proto.ConfigurePluginRequest, Proto.ConfigurePluginResponse];
}

interface AsyncTsServerRequests {
  geterr: [Proto.GeterrRequestArgs, Proto.Response];
  geterrForProject: [Proto.GeterrForProjectRequestArgs, Proto.Response];
}

export type TypeScriptRequests = StandardTsServerRequests & NoResponseTsServerRequests & AsyncTsServerRequests;

export type ExecConfig = {
  readonly lowPriority?: boolean;
  readonly nonRecoverable?: boolean;
  readonly cancelOnResourceChange?: vscode.Uri;
  readonly executionTarget?: ExecutionTarget;
};

export enum ClientCap {
  Syntax,
  EnhancedSyntax,
  Semantic,
}

export class ClientCaps {
  private readonly caps: ReadonlySet<ClientCap>;
  constructor(...cs: ClientCap[]) {
    this.caps = new Set(cs);
  }
  public has(c: ClientCap): boolean {
    return this.caps.has(c);
  }
}

export interface ServiceClient {
  normalizedPath(r: vscode.Uri): string | undefined;
  toPath(r: vscode.Uri): string | undefined;
  toResource(p: string): vscode.Uri;
  toOpenedFilePath(d: vscode.TextDocument, opts?: { suppressAlertOnFailure?: boolean }): string | undefined;
  hasCapabilityForResource(r: vscode.Uri, c: ClientCap): boolean;
  getWorkspaceRootForResource(r: vscode.Uri): string | undefined;
  readonly onTsServerStarted: vscode.Event<{ version: TypeScriptVersion; usedApiVersion: API }>;
  readonly onProjectLanguageServiceStateChanged: vscode.Event<Proto.ProjectLanguageServiceStateEventBody>;
  readonly onDidBeginInstallTypings: vscode.Event<Proto.BeginInstallTypesEventBody>;
  readonly onDidEndInstallTypings: vscode.Event<Proto.EndInstallTypesEventBody>;
  readonly onTypesInstallerInitializationFailed: vscode.Event<Proto.TypesInstallerInitializationFailedEventBody>;
  readonly capabilities: ClientCaps;
  readonly onDidChangeCapabilities: vscode.Event<void>;
  onReady(f: () => void): Promise<void>;
  showVersionPicker(): void;
  readonly apiVersion: API;
  readonly pluginManager: PluginManager;
  readonly configuration: TypeScriptServiceConfiguration;
  readonly bufferSyncSupport: BufferSyncSupport;
  readonly telemetryReporter: TelemetryReporter;
  execute<K extends keyof StandardTsServerRequests>(
    k: K,
    xs: StandardTsServerRequests[K][0],
    t: vscode.CancellationToken,
    c?: ExecConfig
  ): Promise<ServerResponse.Response<StandardTsServerRequests[K][1]>>;
  executeWithoutWaitingForResponse<K extends keyof NoResponseTsServerRequests>(k: K, xs: NoResponseTsServerRequests[K][0]): void;
  executeAsync<K extends keyof AsyncTsServerRequests>(k: K, xs: AsyncTsServerRequests[K][0], t: vscode.CancellationToken): Promise<ServerResponse.Response<Proto.Response>>;
  interruptGetErr<R>(f: () => R): R;
}
