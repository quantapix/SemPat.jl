import * as qv from 'vscode';
import * as qp from './protocol';
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
  export type Response<T extends qp.Response> = T | Cancelled | typeof NoContent;
}

interface StandardTsServerRequests {
  applyCodeActionCommand: [qp.ApplyCodeActionCommandRequestArgs, qp.ApplyCodeActionCommandResponse];
  completionEntryDetails: [qp.CompletionDetailsRequestArgs, qp.CompletionDetailsResponse];
  completionInfo: [qp.CompletionsRequestArgs, qp.CompletionInfoResponse];
  completions: [qp.CompletionsRequestArgs, qp.CompletionsResponse];
  configure: [qp.ConfigureRequestArguments, qp.ConfigureResponse];
  definition: [qp.FileLocationRequestArgs, qp.DefinitionResponse];
  definitionAndBoundSpan: [qp.FileLocationRequestArgs, qp.DefinitionInfoAndBoundSpanResponse];
  docCommentTemplate: [qp.FileLocationRequestArgs, qp.DocCommandTemplateResponse];
  documentHighlights: [qp.DocumentHighlightsRequestArgs, qp.DocumentHighlightsResponse];
  format: [qp.FormatRequestArgs, qp.FormatResponse];
  formatonkey: [qp.FormatOnKeyRequestArgs, qp.FormatResponse];
  getApplicableRefactors: [qp.GetApplicableRefactorsRequestArgs, qp.GetApplicableRefactorsResponse];
  getCodeFixes: [qp.CodeFixRequestArgs, qp.CodeFixResponse];
  getCombinedCodeFix: [qp.GetCombinedCodeFixRequestArgs, qp.GetCombinedCodeFixResponse];
  getEditsForFileRename: [qp.GetEditsForFileRenameRequestArgs, qp.GetEditsForFileRenameResponse];
  getEditsForRefactor: [qp.GetEditsForRefactorRequestArgs, qp.GetEditsForRefactorResponse];
  getOutliningSpans: [qp.FileRequestArgs, qp.OutliningSpansResponse];
  getSupportedCodeFixes: [null, qp.GetSupportedCodeFixesResponse];
  implementation: [qp.FileLocationRequestArgs, qp.ImplementationResponse];
  jsxClosingTag: [qp.JsxClosingTagRequestArgs, qp.JsxClosingTagResponse];
  navto: [qp.NavtoRequestArgs, qp.NavtoResponse];
  navtree: [qp.FileRequestArgs, qp.NavTreeResponse];
  organizeImports: [qp.OrganizeImportsRequestArgs, qp.OrganizeImportsResponse];
  projectInfo: [qp.ProjectInfoRequestArgs, qp.ProjectInfoResponse];
  quickinfo: [qp.FileLocationRequestArgs, qp.QuickInfoResponse];
  references: [qp.FileLocationRequestArgs, qp.ReferencesResponse];
  rename: [qp.RenameRequestArgs, qp.RenameResponse];
  selectionRange: [qp.SelectionRangeRequestArgs, qp.SelectionRangeResponse];
  signatureHelp: [qp.SignatureHelpRequestArgs, qp.SignatureHelpResponse];
  typeDefinition: [qp.FileLocationRequestArgs, qp.TypeDefinitionResponse];
  updateOpen: [qp.UpdateOpenRequestArgs, qp.Response];
  prepareCallHierarchy: [qp.FileLocationRequestArgs, qp.PrepareCallHierarchyResponse];
  provideCallHierarchyIncomingCalls: [qp.FileLocationRequestArgs, qp.ProvideCallHierarchyIncomingCallsResponse];
  provideCallHierarchyOutgoingCalls: [qp.FileLocationRequestArgs, qp.ProvideCallHierarchyOutgoingCallsResponse];
  fileReferences: [qp.FileRequestArgs, qp.FileReferencesResponse];
}

interface NoResponseTsServerRequests {
  open: [qp.OpenRequestArgs, null];
  close: [qp.FileRequestArgs, null];
  change: [qp.ChangeRequestArgs, null];
  compilerOptionsForInferredProjects: [qp.SetCompilerOptionsForInferredProjectsArgs, null];
  reloadProjects: [null, null];
  configurePlugin: [qp.ConfigurePluginRequest, qp.ConfigurePluginResponse];
}

interface AsyncTsServerRequests {
  geterr: [qp.GeterrRequestArgs, qp.Response];
  geterrForProject: [qp.GeterrForProjectRequestArgs, qp.Response];
}

export type TypeScriptRequests = StandardTsServerRequests & NoResponseTsServerRequests & AsyncTsServerRequests;

export type ExecConfig = {
  readonly lowPriority?: boolean;
  readonly nonRecoverable?: boolean;
  readonly cancelOnResourceChange?: qv.Uri;
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
  normalizedPath(r: qv.Uri): string | undefined;
  toPath(r: qv.Uri): string | undefined;
  toResource(p: string): qv.Uri;
  toOpenedFilePath(d: qv.TextDocument, opts?: { suppressAlertOnFailure?: boolean }): string | undefined;
  hasCapabilityForResource(r: qv.Uri, c: ClientCap): boolean;
  getWorkspaceRootForResource(r: qv.Uri): string | undefined;
  readonly onTsServerStarted: qv.Event<{ version: TypeScriptVersion; usedApiVersion: API }>;
  readonly onProjectLanguageServiceStateChanged: qv.Event<qp.ProjectLanguageServiceStateEventBody>;
  readonly onDidBeginInstallTypings: qv.Event<qp.BeginInstallTypesEventBody>;
  readonly onDidEndInstallTypings: qv.Event<qp.EndInstallTypesEventBody>;
  readonly onTypesInstallerInitializationFailed: qv.Event<qp.TypesInstallerInitializationFailedEventBody>;
  readonly capabilities: ClientCaps;
  readonly onDidChangeCapabilities: qv.Event<void>;
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
    t: qv.CancellationToken,
    c?: ExecConfig
  ): Promise<ServerResponse.Response<StandardTsServerRequests[K][1]>>;
  executeWithoutWaitingForResponse<K extends keyof NoResponseTsServerRequests>(k: K, xs: NoResponseTsServerRequests[K][0]): void;
  executeAsync<K extends keyof AsyncTsServerRequests>(k: K, xs: AsyncTsServerRequests[K][0], t: qv.CancellationToken): Promise<ServerResponse.Response<qp.Response>>;
  interruptGetErr<R>(f: () => R): R;
}
