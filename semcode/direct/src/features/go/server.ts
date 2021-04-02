import cp = require('child_process');
import deepEqual = require('deep-equal');
import fs = require('fs');
import moment = require('moment');
import * as path from 'path';
import semver = require('semver');
import util = require('util');
import * as qv from 'vscode';
import {
  CancellationToken,
  CloseAction,
  CompletionItemKind,
  ConfigParams,
  ConfigRequest,
  ErrorAction,
  ExecuteCommandSignature,
  HandleDiagsSignature,
  InitializeError,
  Message,
  ProvideCodeLensesSignature,
  ProvideCompletionItemsSignature,
  ProvideDocumentFormattingEditsSignature,
  ResponseError,
  RevealOutputChannelOn,
} from 'vscode-languageclient';
import { LangClient } from 'vscode-languageclient/node';
import { getGoConfig, getGoplsConfig, IsInCloudIDE } from '../../../../old/go/config';
import { extensionId } from '../../../../old/go/const';
import { GoCodeActionProvider } from './go/codeAction';
import { GoDefinitionProvider } from './go/definition';
import { toolExecutionEnvironment } from '../../../../old/go/goEnv';
import { GoHoverProvider } from './hover';
import { GoDocumentFormattingEditProvider, usingCustomFormatTool } from './format';
import { GoImplementationProvider } from './implementation';
import { installTools, latestToolVersion, promptForMissingTool, promptForUpdatingTool } from '../../../../old/go/goInstallTools';
import { parseLiveFile } from '../../../../old/go/goLiveErrors';
import { buildDiagCollection, lintDiagCollection, restartLangServer, vetDiagCollection } from '../../../../old/go/goMain';
import { GO_MODE } from '../../../../old/go/goMode';
import { GoDocumentSymbolProvider } from './go/symbol';
import { GoReferenceProvider } from './reference';
import { GoRenameProvider } from '../../../../old/go/rename';
import { GoSignatureHelpProvider } from './signature';
import { outputChannel, updateLangServerIconGoStatusBar } from '../../../../old/go/goStatus';
import { GoCompletionItemProvider } from './completion';
import { GoWorkspaceSymbolProvider } from './workspace';
import { getTool, Tool } from '../../../../old/go/goTools';
import { GoTypeDefinitionProvider } from './typeDefinition';
import { getFromGlobalState, getFromWorkspaceState, updateGlobalState, updateWorkspaceState } from '../../../../old/go/stateUtils';
import { getBinPath, getCheckForToolsUpdatesConfig, getCurrentGoPath, getGoVersion, getWorkspaceFolderPath, removeDuplicateDiags } from '../../../../old/go/util';
import { Mutex } from './utils/mutex';
import { getToolFromToolPath } from './utils/pathUtils';
import WebRequest = require('web-request');
import { FoldingContext } from 'vscode';
import { ProvideFoldingRangeSignature } from 'vscode-languageclient/lib/common/foldingRange';

export interface LangServerConfig {
  serverName: string;
  path: string;
  version: string;
  modtime: Date;
  enabled: boolean;
  flags: string[];
  env: any;
  features: {
    diagnostics: boolean;
    formatter?: GoDocumentFormattingEditProvider;
  };
  checkForUpdates: string;
}

export let languageClient: LangClient;
let languageServerDisposable: qv.Disposable;
export let latestConfig: LangServerConfig;
export let serverOutputChannel: qv.OutputChannel;
export let languageServerIsRunning = false;

const languageServerStartMutex = new Mutex();

let serverTraceChannel: qv.OutputChannel;
let crashCount = 0;

let manualRestartCount = 0;
let totalStartCount = 0;

let defaultLangProviders: qv.Disposable[] = [];

let restartCommand: qv.Disposable;

let lastUserAction: Date = new Date();

export async function startLangServerWithFallback(ctx: qv.ExtensionContext, activation: boolean) {
  for (const folder of qv.workspace.workspaceFolders || []) {
    switch (folder.uri.scheme) {
      case 'vsls':
        outputChannel.appendLine('Lang service on the guest side is disabled. ' + 'The server-side language service will provide the language features.');
        return;
      case 'ssh':
        outputChannel.appendLine('The language server is not supported for SSH. Disabling it.');
        return;
    }
  }

  const goConfig = getGoConfig();
  const cfg = buildLangServerConfig(goConfig);

  if (activation) {
    scheduleGoplsSuggestions();
  }

  if (cfg.serverName === 'gopls') {
    const tool = getTool(cfg.serverName);
    if (tool) {
      if (cfg.enabled && languageServerUsingDefault(goConfig)) {
        suggestUpdateGopls(tool, cfg);
      }
    }
  }
  const unlock = await languageServerStartMutex.lock();
  try {
    const started = await startLangServer(ctx, cfg);

    if (!started && defaultLangProviders.length === 0) {
      registerDefaultProviders(ctx);
    }
    languageServerIsRunning = started;
    updateLangServerIconGoStatusBar(started, goConfig['useLangServer'] === true);
  } finally {
    unlock();
  }
}

function scheduleGoplsSuggestions() {
  if (IsInCloudIDE) {
    return;
  }

  const usingGopls = (cfg: LangServerConfig): boolean => {
    return cfg.enabled && cfg.serverName === 'gopls';
  };
  const installGopls = async (cfg: LangServerConfig) => {
    const tool = getTool('gopls');
    const versionToUpdate = await shouldUpdateLangServer(tool, cfg);
    if (!versionToUpdate) {
      return;
    }

    const toolsManagementConfig = getGoConfig()['toolsManagement'];
    if (toolsManagementConfig && toolsManagementConfig['autoUpdate'] === true) {
      const goVersion = await getGoVersion();
      const toolVersion = { ...tool, version: versionToUpdate }; // ToolWithVersion
      await installTools([toolVersion], goVersion, true);
    } else {
      promptForUpdatingTool(tool.name, versionToUpdate);
    }
  };
  const update = async () => {
    setTimeout(update, timeDay);

    let cfg = buildLangServerConfig(getGoConfig());
    if (!usingGopls(cfg)) {
      if (cfg.serverName !== '' && cfg.serverName !== 'gopls') {
        return;
      }

      await promptAboutGoplsOptOut(false);

      cfg = buildLangServerConfig(getGoConfig());
      if (!cfg.enabled) {
        return;
      }
    }
    await installGopls(cfg);
  };
  const survey = async () => {
    setTimeout(survey, timeDay);

    const cfg = buildLangServerConfig(getGoConfig());
    if (!usingGopls(cfg)) {
      return;
    }
    maybePromptForGoplsSurvey();
  };
  setTimeout(update, 10 * timeMinute);
  setTimeout(survey, 30 * timeMinute);
}

export async function promptAboutGoplsOptOut(surveyOnly: boolean) {
  const useLangServer = getGoConfig().inspect('useLangServer');
  const workspace = useLangServer.workspaceFolderValue === false || useLangServer.workspaceValue === false;

  let cfg = getGoplsOptOutConfig(workspace);
  const promptFn = async (): Promise<GoplsOptOutConfig> => {
    if (cfg.prompt === false) {
      return cfg;
    }

    if (cfg.lastDatePrompted && daysBetween(new Date(), cfg.lastDatePrompted) < 30) {
      return cfg;
    }
    cfg.lastDatePrompted = new Date();
    if (surveyOnly) {
      await promptForGoplsOptOutSurvey(
        cfg,
        `Looks like you've disabled the Go language server, which is the recommended default for this extension.
Would you be willing to tell us why you've disabled it?`
      );
      return cfg;
    }
    const selected = await qv.window.showInformationMessage(
      `We noticed that you have disabled the language server.
It has [stabilized](https://blog.golang.org/gopls-vscode-go) and is now enabled by default in this extension.
Would you like to enable it now?`,
      { title: 'Enable' },
      { title: 'Not now' },
      { title: 'Never' }
    );
    if (!selected) {
      return cfg;
    }
    switch (selected.title) {
      case 'Enable':
        {
          const goConfig = getGoConfig();
          await goConfig.update('useLangServer', undefined, qv.ConfigTarget.Global);
          if (goConfig.inspect('useLangServer').workspaceValue === false) {
            await goConfig.update('useLangServer', undefined, qv.ConfigTarget.Workspace);
          }
          if (goConfig.inspect('useLangServer').workspaceFolderValue === false) {
            await goConfig.update('useLangServer', undefined, qv.ConfigTarget.WorkspaceFolder);
          }
          cfg.prompt = false;
        }
        break;
      case 'Not now':
        cfg.prompt = true;
        break;
      case 'Never':
        cfg.prompt = false;
        await promptForGoplsOptOutSurvey(cfg, 'No problem. Would you be willing to tell us why you have opted out of the language server?');
        break;
    }
    return cfg;
  };
  cfg = await promptFn();
  flushGoplsOptOutConfig(cfg, workspace);
}

async function promptForGoplsOptOutSurvey(cfg: GoplsOptOutConfig, msg: string): Promise<GoplsOptOutConfig> {
  const s = await qv.window.showInformationMessage(msg, { title: 'Yes' }, { title: 'No' });
  if (!s) {
    return cfg;
  }
  let goplsVersion = await getLocalGoplsVersion(latestConfig);
  if (!goplsVersion) {
    goplsVersion = 'no gopls version found';
  }
  goplsVersion = `gopls/${goplsVersion}`;
  const goV = await getGoVersion();
  let goVersion = 'no go version found';
  if (goV) {
    goVersion = `go${goV.format(true)}`;
  }
  const version = [goplsVersion, goVersion, process.platform].join(';');
  switch (s.title) {
    case 'Yes':
      cfg.prompt = false;
      await qv.env.openExternal(qv.Uri.parse(`https://docs.google.com/forms/d/e/1FAIpQLScITGOe2VdQnaXigSIiD19VxN_2KLwjMszZOMZp9TgYvTOw5g/viewform?entry.1049591455=${version}&gxids=7826`));
      break;
    case 'No':
      break;
  }
  return cfg;
}

export interface GoplsOptOutConfig {
  prompt?: boolean;
  lastDatePrompted?: Date;
}

const goplsOptOutConfigKey = 'goplsOptOutConfig';

export const getGoplsOptOutConfig = (workspace: boolean): GoplsOptOutConfig => {
  return getStateConfig(goplsOptOutConfigKey, workspace) as GoplsOptOutConfig;
};

function flushGoplsOptOutConfig(cfg: GoplsOptOutConfig, workspace: boolean) {
  if (workspace) {
    updateWorkspaceState(goplsOptOutConfigKey, JSON.stringify(cfg));
  }
  updateGlobalState(goplsOptOutConfigKey, JSON.stringify(cfg));
}

async function startLangServer(ctx: qv.ExtensionContext, config: LangServerConfig): Promise<boolean> {
  if (languageClient) {
    if (languageClient.diagnostics) {
      languageClient.diagnostics.clear();
    }
    await languageClient.stop();
    if (languageServerDisposable) {
      languageServerDisposable.dispose();
    }
  }

  if (!deepEqual(latestConfig, config)) {
    latestConfig = config;
    languageClient = await buildLangClient(buildLangClientOption(config));
    crashCount = 0;
  }

  if (!config.enabled) {
    return false;
  }

  if (!restartCommand) {
    restartCommand = qv.commands.registerCommand('go.languageserver.restart', async () => {
      await suggestGoplsIssueReport("Looks like you're about to manually restart the language server.", errorKind.manualRestart);

      manualRestartCount++;
      restartLangServer();
    });
    ctx.subscriptions.push(restartCommand);
  }

  disposeDefaultProviders();

  languageServerDisposable = languageClient.start();
  totalStartCount++;
  ctx.subscriptions.push(languageServerDisposable);
  await languageClient.onReady();
  return true;
}

export interface BuildLangClientOption extends LangServerConfig {
  outputChannel?: qv.OutputChannel;
  traceOutputChannel?: qv.OutputChannel;
}

function buildLangClientOption(cfg: LangServerConfig): BuildLangClientOption {
  if (cfg.enabled) {
    if (!serverOutputChannel) {
      serverOutputChannel = qv.window.createOutputChannel(cfg.serverName + ' (server)');
    }
    if (!serverTraceChannel) {
      serverTraceChannel = qv.window.createOutputChannel(cfg.serverName);
    }
  }
  return Object.assign(
    {
      outputChannel: serverOutputChannel,
      traceOutputChannel: serverTraceChannel,
    },
    cfg
  );
}

export async function buildLangClient(cfg: BuildLangClientOption): Promise<LangClient> {
  const goplsWorkspaceConfig = await adjustGoplsWorkspaceConfig(cfg, getGoplsConfig(), 'gopls', undefined);

  const documentSelector = [
    { language: 'go', scheme: 'file' },
    { language: 'go.mod', scheme: 'file' },
    { language: 'go.sum', scheme: 'file' },

    { language: 'go', scheme: 'untitled' },
    { language: 'go.mod', scheme: 'untitled' },
    { language: 'go.sum', scheme: 'untitled' },
  ];

  if (isInPreviewMode()) {
    documentSelector.push({ language: 'tmpl', scheme: 'file' }, { language: 'tmpl', scheme: 'untitled' });
  }
  const c = new LangClient(
    'go', // id
    cfg.serverName, // name e.g. gopls
    {
      command: cfg.path,
      args: ['-mode=stdio', ...cfg.flags],
      options: { env: cfg.env },
    },
    {
      initializationOptions: goplsWorkspaceConfig,
      documentSelector,
      uriConverters: {
        code2Protocol: (uri: qv.Uri): string => (uri.scheme ? uri : uri.with({ scheme: 'file' })).toString(),
        protocol2Code: (uri: string) => qv.Uri.parse(uri),
      },
      outputChannel: cfg.outputChannel,
      traceOutputChannel: cfg.traceOutputChannel,
      revealOutputChannelOn: RevealOutputChannelOn.Never,
      initializationFailedHandler: (error: WebRequest.ResponseError<InitializeError>): boolean => {
        qv.window.showErrorMessage(`The language server is not able to serve any features. Initialization failed: ${error}. `);
        suggestGoplsIssueReport('The gopls server failed to initialize', errorKind.initializationFailure, error);
        return false;
      },
      errorHandler: {
        error: (error: Error, message: Message, count: number): ErrorAction => {
          if (count < 5) {
            return ErrorAction.Continue;
          }
          qv.window.showErrorMessage(`Error communicating with the language server: ${error}: ${message}.`);
          return ErrorAction.Shutdown;
        },
        closed: (): CloseAction => {
          crashCount++;
          if (crashCount < 5) {
            return CloseAction.Restart;
          }
          suggestGoplsIssueReport('The connection to gopls has been closed. The gopls server may have crashed.', errorKind.crash);
          return CloseAction.DoNotRestart;
        },
      },
      middleware: {
        executeCommand: async (command: string, args: any[], next: ExecuteCommandSignature) => {
          try {
            return await next(command, args);
          } catch (e) {
            const answer = await qv.window.showErrorMessage(`Command '${command}' failed: ${e}.`, 'Show Trace');
            if (answer === 'Show Trace') {
              serverOutputChannel.show();
            }
            return null;
          }
        },
        provideFoldingRanges: async (doc: qv.TextDocument, context: FoldingContext, token: CancellationToken, next: ProvideFoldingRangeSignature) => {
          const ranges = await next(doc, context, token);
          if ((!ranges || ranges.length === 0) && doc.lineCount > 0) {
            return undefined;
          }
          return ranges;
        },
        provideCodeLenses: async (doc: qv.TextDocument, token: qv.CancellationToken, next: ProvideCodeLensesSignature): Promise<qv.CodeLens[]> => {
          const codeLens = await next(doc, token);
          if (!codeLens || codeLens.length === 0) {
            return codeLens;
          }
          const goplsEnabledLens = (getGoConfig().get('overwriteGoplsMiddleware') as any)?.codelens ?? {};
          return codeLens.reduce((lenses: qv.CodeLens[], lens: qv.CodeLens) => {
            switch (lens.command.title) {
              case 'run test': {
                if (goplsEnabledLens.test) {
                  return [...lenses, lens];
                }
                return [...lenses, ...createTestCodeLens(lens)];
              }
              case 'run benchmark': {
                if (goplsEnabledLens.bench) {
                  return [...lenses, lens];
                }
                return [...lenses, ...createBenchmarkCodeLens(lens)];
              }
              default: {
                return [...lenses, lens];
              }
            }
          }, []);
        },
        provideDocumentFormattingEdits: async (document: qv.TextDocument, options: qv.FormattingOptions, token: qv.CancellationToken, next: ProvideDocumentFormattingEditsSignature) => {
          if (cfg.features.formatter) {
            return cfg.features.formatter.provideDocumentFormattingEdits(document, options, token);
          }
          return next(document, options, token);
        },
        handleDiags: (uri: qv.Uri, diagnostics: qv.Diag[], next: HandleDiagsSignature) => {
          if (!cfg.features.diagnostics) {
            return null;
          }

          removeDuplicateDiags(vetDiagCollection, uri, diagnostics);
          removeDuplicateDiags(buildDiagCollection, uri, diagnostics);
          removeDuplicateDiags(lintDiagCollection, uri, diagnostics);

          return next(uri, diagnostics);
        },
        provideCompletionItem: async (document: qv.TextDocument, position: qv.Position, context: qv.CompletionContext, token: qv.CancellationToken, next: ProvideCompletionItemsSignature) => {
          const list = await next(document, position, context, token);
          if (!list) {
            return list;
          }
          const items = Array.isArray(list) ? list : list.items;

          if (!Array.isArray(list) && list.isIncomplete && list.items.length > 1) {
            let hardcodedFilterText = items[0].filterText;
            if (!hardcodedFilterText) {
              hardcodedFilterText = items[0].label;
            }
            for (const item of items) {
              item.filterText = hardcodedFilterText;
            }
          }

          const editorParamHintsEnabled = qv.workspace.getConfig('editor.parameterHints', document.uri)['enabled'];
          const goParamHintsEnabled = qv.workspace.getConfig('[go]', document.uri)['editor.parameterHints.enabled'];
          let paramHintsEnabled = false;
          if (typeof goParamHintsEnabled === 'undefined') {
            paramHintsEnabled = editorParamHintsEnabled;
          } else {
            paramHintsEnabled = goParamHintsEnabled;
          }

          if (paramHintsEnabled) {
            for (const item of items) {
              if (item.kind === CompletionItemKind.Method || item.kind === CompletionItemKind.Function) {
                item.command = {
                  title: 'triggerParameterHints',
                  command: 'editor.action.triggerParameterHints',
                };
              }
            }
          }
          return list;
        },

        didOpen: (e, next) => {
          lastUserAction = new Date();
          next(e);
        },
        didChange: (e, next) => {
          lastUserAction = new Date();
          next(e);
        },
        didClose: (e, next) => {
          lastUserAction = new Date();
          next(e);
        },
        didSave: (e, next) => {
          lastUserAction = new Date();
          next(e);
        },
        workspace: {
          configuration: async (params: ConfigParams, token: CancellationToken, next: ConfigRequest.HandlerSignature): Promise<any[] | ResponseError<void>> => {
            const configs = await next(params, token);
            if (!configs || !Array.isArray(configs)) {
              return configs;
            }
            const ret = [] as any[];
            for (let i = 0; i < configs.length; i++) {
              let workspaceConfig = configs[i];
              if (!!workspaceConfig && typeof workspaceConfig === 'object') {
                const scopeUri = params.items[i].scopeUri;
                const resource = scopeUri ? qv.Uri.parse(scopeUri) : undefined;
                const section = params.items[i].section;
                workspaceConfig = await adjustGoplsWorkspaceConfig(cfg, workspaceConfig, section, resource);
              }
              ret.push(workspaceConfig);
            }
            return ret;
          },
        },
      },
    }
  );
  return c;
}

export function filterGoplsDefaultConfigValues(workspaceConfig: any, resource: qv.Uri): any {
  if (!workspaceConfig) {
    workspaceConfig = {};
  }
  const cfg = getGoplsConfig(resource);
  const filtered = {} as { [key: string]: any };
  for (const [key, value] of Object.entries(workspaceConfig)) {
    if (typeof value === 'function') {
      continue;
    }
    const c = cfg.inspect(key);

    if (
      !c ||
      !deepEqual(c.defaultValue, value) ||
      c.globalLangValue !== undefined ||
      c.globalValue !== undefined ||
      c.workspaceFolderLangValue !== undefined ||
      c.workspaceFolderValue !== undefined ||
      c.workspaceLangValue !== undefined ||
      c.workspaceValue !== undefined
    ) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function passGoConfigToGoplsConfigValues(goplsWorkspaceConfig: any, goWorkspaceConfig: any): any {
  if (!goplsWorkspaceConfig) {
    goplsWorkspaceConfig = {};
  }

  const buildFlags = [] as string[];
  if (goWorkspaceConfig?.buildFlags) {
    buildFlags.push(...goWorkspaceConfig?.buildFlags);
  }
  if (goWorkspaceConfig?.buildTags && buildFlags.indexOf('-tags') === -1) {
    buildFlags.push('-tags', goWorkspaceConfig?.buildTags);
  }

  if (buildFlags.length > 0 && goplsWorkspaceConfig['build.buildFlags'] === undefined) {
    goplsWorkspaceConfig['build.buildFlags'] = buildFlags;
  }
  return goplsWorkspaceConfig;
}

async function adjustGoplsWorkspaceConfig(cfg: LangServerConfig, workspaceConfig: any, section: string, resource: qv.Uri): Promise<any> {
  if (section !== 'gopls') {
    return workspaceConfig;
  }

  workspaceConfig = filterGoplsDefaultConfigValues(workspaceConfig, resource);

  workspaceConfig = passGoConfigToGoplsConfigValues(workspaceConfig, getGoConfig(resource));

  if (!isInPreviewMode()) {
    return workspaceConfig;
  }

  const version = await getLocalGoplsVersion(cfg);
  if (!version) {
    return workspaceConfig;
  }
  const sv = semver.parse(version, true);
  if (!sv || semver.lt(sv, 'v0.5.2')) {
    return workspaceConfig;
  }
  if (!workspaceConfig['allExperiments']) {
    workspaceConfig['allExperiments'] = true;
  }
  return workspaceConfig;
}

function createTestCodeLens(lens: qv.CodeLens): qv.CodeLens[] {
  if (lens.command.arguments.length < 2 || lens.command.arguments[1].length < 1) {
    return [lens];
  }
  return [
    new qv.CodeLens(lens.range, {
      ...lens.command,
      command: 'go.test.cursor',
      arguments: [{ functionName: lens.command.arguments[1][0] }],
    }),
    new qv.CodeLens(lens.range, {
      title: 'debug test',
      command: 'go.debug.cursor',
      arguments: [{ functionName: lens.command.arguments[1][0] }],
    }),
  ];
}

function createBenchmarkCodeLens(lens: qv.CodeLens): qv.CodeLens[] {
  if (lens.command.arguments.length < 3 || lens.command.arguments[2].length < 1) {
    return [lens];
  }
  return [
    new qv.CodeLens(lens.range, {
      ...lens.command,
      command: 'go.benchmark.cursor',
      arguments: [{ functionName: lens.command.arguments[2][0] }],
    }),
    new qv.CodeLens(lens.range, {
      title: 'debug benchmark',
      command: 'go.debug.cursor',
      arguments: [{ functionName: lens.command.arguments[2][0] }],
    }),
  ];
}

function registerDefaultProviders(ctx: qv.ExtensionContext) {
  const completionProvider = new GoCompletionItemProvider(ctx.globalState);
  defaultLangProviders.push(completionProvider);
  defaultLangProviders.push(qv.languages.registerCompletionItemProvider(GO_MODE, completionProvider, '.', '"'));
  defaultLangProviders.push(qv.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
  defaultLangProviders.push(qv.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
  defaultLangProviders.push(qv.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
  defaultLangProviders.push(qv.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider()));
  defaultLangProviders.push(qv.languages.registerWorkspaceSymbolProvider(new GoWorkspaceSymbolProvider()));
  defaultLangProviders.push(qv.languages.registerSignatureHelpProvider(GO_MODE, new GoSignatureHelpProvider(), '(', ','));
  defaultLangProviders.push(qv.languages.registerImplementationProvider(GO_MODE, new GoImplementationProvider()));
  defaultLangProviders.push(qv.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
  defaultLangProviders.push(qv.languages.registerTypeDefinitionProvider(GO_MODE, new GoTypeDefinitionProvider()));
  defaultLangProviders.push(qv.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
  defaultLangProviders.push(qv.workspace.onDidChangeTextDocument(parseLiveFile, null, ctx.subscriptions));
  defaultLangProviders.push(qv.languages.registerCodeActionsProvider(GO_MODE, new GoCodeActionProvider()));

  for (const provider of defaultLangProviders) {
    ctx.subscriptions.push(provider);
  }
}

function disposeDefaultProviders() {
  for (const disposable of defaultLangProviders) {
    disposable.dispose();
  }
  defaultLangProviders = [];
}

export async function watchLangServerConfig(e: qv.ConfigChangeEvent) {
  if (!e.affectsConfig('go')) {
    return;
  }

  if (
    e.affectsConfig('go.useLangServer') ||
    e.affectsConfig('go.languageServerFlags') ||
    e.affectsConfig('go.languageServerExperimentalFeatures') ||
    e.affectsConfig('go.alternateTools') ||
    e.affectsConfig('go.toolsEnvVars') ||
    e.affectsConfig('go.formatTool')
  ) {
    restartLangServer();
  }

  if (e.affectsConfig('go.useLangServer') && getGoConfig()['useLangServer'] === false) {
    promptAboutGoplsOptOut(true);
  }
}

export function buildLangServerConfig(goConfig: qv.WorkspaceConfig): LangServerConfig {
  let formatter: GoDocumentFormattingEditProvider;
  if (usingCustomFormatTool(goConfig)) {
    formatter = new GoDocumentFormattingEditProvider();
  }
  const cfg: LangServerConfig = {
    serverName: '',
    path: '',
    version: '', // compute version lazily
    modtime: null,
    enabled: goConfig['useLangServer'] === true,
    flags: goConfig['languageServerFlags'] || [],
    features: {
      diagnostics: goConfig['languageServerExperimentalFeatures']['diagnostics'],
      formatter: formatter,
    },
    env: toolExecutionEnvironment(),
    checkForUpdates: getCheckForToolsUpdatesConfig(goConfig),
  };
  const languageServerPath = getLangServerToolPath();
  if (!languageServerPath) {
    cfg.enabled = false;
    return cfg;
  }
  cfg.path = languageServerPath;
  cfg.serverName = getToolFromToolPath(cfg.path);

  if (!cfg.enabled) {
    return cfg;
  }

  const stats = fs.statSync(languageServerPath);
  if (!stats) {
    qv.window.showErrorMessage(`Unable to stat path to language server binary: ${languageServerPath}.
Please try reinstalling it.`);

    cfg.enabled = false;
    return cfg;
  }
  cfg.modtime = stats.mtime;

  return cfg;
}

export function getLangServerToolPath(): string {
  const goConfig = getGoConfig();

  if (!allFoldersHaveSameGopath()) {
    qv.window.showInformationMessage('The Go language server is currently not supported in a multi-root set-up with different GOPATHs.');
    return;
  }

  const goplsBinaryPath = getBinPath('gopls');
  if (path.isAbsolute(goplsBinaryPath)) {
    return goplsBinaryPath;
  }
  const alternateTools = goConfig['alternateTools'];
  if (alternateTools) {
    const goplsAlternate = alternateTools['gopls'];
    if (goplsAlternate) {
      qv.window.showErrorMessage(
        `Cannot find the alternate tool ${goplsAlternate} configured for gopls.
Please install it and reload this VS Code window.`
      );
      return;
    }
  }

  promptForMissingTool('gopls');
}

function allFoldersHaveSameGopath(): boolean {
  if (!qv.workspace.workspaceFolders || qv.workspace.workspaceFolders.length <= 1) {
    return true;
  }
  const tempGopath = getCurrentGoPath(qv.workspace.workspaceFolders[0].uri);
  return qv.workspace.workspaceFolders.find((x) => tempGopath !== getCurrentGoPath(x.uri)) ? false : true;
}

export async function shouldUpdateLangServer(tool: Tool, cfg: LangServerConfig, mustCheck?: boolean): Promise<semver.SemVer> {
  if (tool.name !== 'gopls' || (!mustCheck && (cfg.checkForUpdates === 'off' || IsInCloudIDE))) {
    return null;
  }
  if (!cfg.enabled) {
    return null;
  }

  const usersVersion = await getLocalGoplsVersion(cfg);

  if (usersVersion === '(devel)') {
    return null;
  }

  let latestVersion = cfg.checkForUpdates === 'local' ? tool.latestVersion : await latestToolVersion(tool, isInPreviewMode());

  if (!latestVersion) {
    latestVersion = tool.latestVersion;
  }

  if (!usersVersion || !semver.valid(usersVersion)) {
    return latestVersion;
  }

  const usersTime = parseTimestampFromPseudoversion(usersVersion);

  if (usersTime) {
    let latestTime = cfg.checkForUpdates ? await getTimestampForVersion(tool, latestVersion) : tool.latestVersionTimestamp;
    if (!latestTime) {
      latestTime = tool.latestVersionTimestamp;
    }
    return usersTime.isBefore(latestTime) ? latestVersion : null;
  }

  const usersVersionSemver = semver.parse(usersVersion, {
    includePrerelease: true,
    loose: true,
  });
  return semver.lt(usersVersionSemver, latestVersion) ? latestVersion : null;
}

async function suggestUpdateGopls(tool: Tool, cfg: LangServerConfig): Promise<boolean> {
  const forceUpdatedGoplsKey = 'forceUpdateForGoplsOnDefault';

  const forceUpdated = getFromGlobalState(forceUpdatedGoplsKey, false);

  if (forceUpdated) {
    return false;
  }

  await updateGlobalState(forceUpdatedGoplsKey, tool.latestVersion);

  const latestVersion = await shouldUpdateLangServer(tool, cfg);

  if (!latestVersion) {
    return;
  }

  const updateMsg =
    "'gopls' is now enabled by default and you are using an old version. Please [update 'gopls'](https://github.com/golang/tools/blob/master/gopls/README.md#installation) for the best experience.";
  promptForUpdatingTool(tool.name, latestVersion, false, updateMsg);
}

const pseudoVersionRE = /^v[0-9]+\.(0\.0-|\d+\.\d+-([^+]*\.)?0\.)\d{14}-[A-Za-z0-9]+(\+incompatible)?$/;

function parseTimestampFromPseudoversion(version: string): moment.Moment {
  const split = version.split('-');
  if (split.length < 2) {
    return null;
  }
  if (!semver.valid(version)) {
    return null;
  }
  if (!pseudoVersionRE.test(version)) {
    return null;
  }
  const sv = semver.coerce(version);
  if (!sv) {
    return null;
  }

  const build = sv.build.join('.');
  const buildIndex = version.lastIndexOf(build);
  if (buildIndex >= 0) {
    version = version.substring(0, buildIndex);
  }
  const lastDashIndex = version.lastIndexOf('-');
  version = version.substring(0, lastDashIndex);
  const firstDashIndex = version.lastIndexOf('-');
  const dotIndex = version.lastIndexOf('.');
  let timestamp: string;
  if (dotIndex > firstDashIndex) {
    timestamp = version.substring(dotIndex + 1);
  } else {
    timestamp = version.substring(firstDashIndex + 1);
  }
  return moment.utc(timestamp, 'YYYYMMDDHHmmss');
}

export const getTimestampForVersion = async (tool: Tool, version: semver.SemVer) => {
  const data = await goProxyRequest(tool, `v${version.format()}.info`);
  if (!data) {
    return null;
  }
  const time = moment(data['Time']);
  return time;
};

export const getLocalGoplsVersion = async (cfg: LangServerConfig) => {
  if (!cfg) {
    return null;
  }
  if (cfg.version !== '') {
    return cfg.version;
  }
  if (cfg.path === '') {
    return null;
  }
  const execFile = util.promisify(cp.execFile);
  let output: any;
  try {
    const env = toolExecutionEnvironment();
    const cwd = getWorkspaceFolderPath();
    const { stdout } = await execFile(cfg.path, ['version'], { env, cwd });
    output = stdout;
  } catch (e) {
    return null;
  }

  const lines = <string>output.trim().split('\n');
  switch (lines.length) {
    case 0:
      return null;
    case 1:
      return null;
    case 2:
      break;
    default:
      return null;
  }

  const moduleVersion = lines[1].trim().split(' ')[0];

  const split = moduleVersion.trim().split('@');
  if (split.length < 2) {
    return null;
  }

  cfg.version = split[1];
  return cfg.version;
};

async function goProxyRequest(tool: Tool, endpoint: string): Promise<any> {
  const output: string = process.env['GOPROXY'];
  if (!output || !output.trim()) {
    return null;
  }

  const proxies = output.trim().split(/,|\|/);
  for (const proxy of proxies) {
    if (proxy === 'direct') {
      continue;
    }
    const url = `${proxy}/${tool.importPath}/@v/${endpoint}`;
    let data: string;
    try {
      data = await WebRequest.json<string>(url, {
        throwResponseError: true,
      });
    } catch (e) {
      console.log(`Error sending request to ${proxy}: ${e}`);
      return null;
    }
    return data;
  }
  return null;
}

export interface SurveyConfig {
  prompt?: boolean;

  promptThisMonth?: boolean;

  dateToPromptThisMonth?: Date;

  dateComputedPromptThisMonth?: Date;

  lastDatePrompted?: Date;

  lastDateAccepted?: Date;
}

function maybePromptForGoplsSurvey() {
  const now = new Date();
  let cfg = shouldPromptForGoplsSurvey(now, getSurveyConfig());
  if (!cfg) {
    return;
  }
  flushSurveyConfig(cfg);
  if (!cfg.dateToPromptThisMonth) {
    return;
  }
  const callback = async () => {
    const currentTime = new Date();

    if (minutesBetween(lastUserAction, currentTime) < 1) {
      setTimeout(callback, 5 * timeMinute);
      return;
    }
    cfg = await promptForSurvey(cfg, now);
    if (cfg) {
      flushSurveyConfig(cfg);
    }
  };
  const ms = msBetween(now, cfg.dateToPromptThisMonth);
  setTimeout(callback, ms);
}

export function shouldPromptForGoplsSurvey(now: Date, cfg: SurveyConfig): SurveyConfig {
  if (cfg.prompt === undefined) {
    cfg.prompt = true;
  }
  if (!cfg.prompt) {
    return;
  }

  if (cfg.lastDateAccepted) {
    if (daysBetween(now, cfg.lastDateAccepted) < 365) {
      return;
    }
  }

  if (cfg.lastDatePrompted) {
    if (daysBetween(now, cfg.lastDatePrompted) < 90) {
      return;
    }
  }

  if (cfg.dateComputedPromptThisMonth) {
    if (daysBetween(now, cfg.dateComputedPromptThisMonth) < 30) {
      return cfg;
    }
  }

  let probability = 0.01; // lower probability for the regular extension
  if (isInPreviewMode()) {
    probability = 0.0275;
  }
  cfg.promptThisMonth = Math.random() < probability;
  if (cfg.promptThisMonth) {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const day = randomIntInRange(now.getUTCDate(), end.getUTCDate());
    cfg.dateToPromptThisMonth = new Date(now.getFullYear(), now.getMonth(), day);
  } else {
    cfg.dateToPromptThisMonth = undefined;
  }
  cfg.dateComputedPromptThisMonth = now;
  return cfg;
}

async function promptForSurvey(cfg: SurveyConfig, now: Date): Promise<SurveyConfig> {
  const selected = await qv.window.showInformationMessage(
    `Looks like you're using gopls, the Go language server.
Would you be willing to fill out a quick survey about your experience with gopls?`,
    'Yes',
    'Not now',
    'Never'
  );

  cfg.lastDatePrompted = now;

  switch (selected) {
    case 'Yes':
      {
        cfg.lastDateAccepted = now;
        cfg.prompt = true;
        const usersGoplsVersion = await getLocalGoplsVersion(latestConfig);
        await qv.env.openExternal(qv.Uri.parse(`https://google.qualtrics.com/jfe/form/SV_ekAdHVcVcvKUojX?gopls=${usersGoplsVersion}&extid=${extensionId}`));
      }
      break;
    case 'Not now':
      cfg.prompt = true;

      qv.window.showInformationMessage("No problem! We'll ask you again another time.");
      break;
    case 'Never':
      cfg.prompt = false;

      qv.window.showInformationMessage("No problem! We won't ask again.");
      break;
    default:
      cfg.prompt = true;

      break;
  }
  return cfg;
}

export const goplsSurveyConfig = 'goplsSurveyConfig';

function getSurveyConfig(): SurveyConfig {
  return getStateConfig(goplsSurveyConfig) as SurveyConfig;
}

export function resetSurveyConfig() {
  flushSurveyConfig(null);
}

function flushSurveyConfig(cfg: SurveyConfig) {
  if (cfg) {
    updateGlobalState(goplsSurveyConfig, JSON.stringify(cfg));
  } else {
    updateGlobalState(goplsSurveyConfig, null); // reset
  }
}

function getStateConfig(globalStateKey: string, workspace?: boolean): any {
  let saved: any;
  if (workspace === true) {
    saved = getFromWorkspaceState(globalStateKey);
  } else {
    saved = getFromGlobalState(globalStateKey);
  }
  if (saved === undefined) {
    return {};
  }
  try {
    const cfg = JSON.parse(saved, (key: string, value: any) => {
      if (key.toLowerCase().includes('date') || key.toLowerCase().includes('timestamp')) {
        return new Date(value);
      }
      return value;
    });
    return cfg || {};
  } catch (err) {
    console.log(`Error parsing JSON from ${saved}: ${err}`);
    return {};
  }
}

export async function showSurveyConfig() {
  outputChannel.appendLine('Gopls Survey Config');
  outputChannel.appendLine(JSON.stringify(getSurveyConfig(), null, 2));
  outputChannel.show();

  const selected = await qv.window.showInformationMessage('Prompt for survey?', 'Yes', 'Maybe', 'No');
  switch (selected) {
    case 'Yes':
      promptForSurvey(getSurveyConfig(), new Date());
      break;
    case 'Maybe':
      maybePromptForGoplsSurvey();
      break;
    default:
      break;
  }
}

enum errorKind {
  initializationFailure,
  crash,
  manualRestart,
}

async function suggestGoplsIssueReport(msg: string, reason: errorKind, initializationError?: WebRequest.ResponseError<InitializeError>) {
  if (reason === errorKind.manualRestart) {
    return;
  }

  const tool = getTool('gopls');
  if (tool) {
    const versionToUpdate = await shouldUpdateLangServer(tool, latestConfig, true);
    if (versionToUpdate) {
      promptForUpdatingTool(tool.name, versionToUpdate, true);
      return;
    }
  }

  serverOutputChannel.show();

  if (latestConfig.serverName !== 'gopls') {
    return;
  }
  const promptForIssueOnGoplsRestartKey = 'promptForIssueOnGoplsRestart';
  let saved: any;
  try {
    saved = JSON.parse(getFromGlobalState(promptForIssueOnGoplsRestartKey, false));
  } catch (err) {
    console.log(`Failed to parse as JSON ${getFromGlobalState(promptForIssueOnGoplsRestartKey, true)}: ${err}`);
    return;
  }

  if (saved) {
    const dateSaved = new Date(saved['date']);
    const prompt = <boolean>saved['prompt'];
    if (!prompt && daysBetween(new Date(), dateSaved) <= 365) {
      return;
    }
  }

  const { sanitizedLog, failureReason } = await collectGoplsLog();

  let selected: string;
  if (failureReason === GoplsFailureModes.INCORRECT_COMMAND_USAGE) {
    const languageServerFlags = getGoConfig()['languageServerFlags'] as string[];
    if (languageServerFlags && languageServerFlags.length > 0) {
      selected = await qv.window.showInformationMessage(
        `The extension was unable to start the language server.
You may have an invalid value in your "go.languageServerFlags" setting.
It is currently set to [${languageServerFlags}]. Please correct the setting by navigating to Preferences -> Settings.`,
        'Open settings',
        'I need more help.'
      );
      switch (selected) {
        case 'Open settings':
          await qv.commands.executeCommand('workbench.action.openSettings', 'go.languageServerFlags');
          return;
        case 'I need more help':
          break;
      }
    }
  }
  selected = await qv.window.showInformationMessage(
    `${msg} Would you like to report a gopls issue on GitHub?
You will be asked to provide additional information and logs, so PLEASE READ THE CONTENT IN YOUR BROWSER.`,
    'Yes',
    'Next time',
    'Never'
  );
  switch (selected) {
    case 'Yes':
      {
        let errKind: string;
        switch (reason) {
          case errorKind.crash:
            errKind = 'crash';
            break;
          case errorKind.initializationFailure:
            errKind = 'initialization';
            break;
        }

        const usersGoplsVersion = await getLocalGoplsVersion(latestConfig);
        const extInfo = getExtensionInfo();
        const goVersion = await getGoVersion();
        const settings = latestConfig.flags.join(' ');
        const title = `gopls: automated issue report (${errKind})`;
        const goplsLog = sanitizedLog
          ? `<pre>${sanitizedLog}</pre>`
          : `Please attach the stack trace from the crash.
A window with the error message should have popped up in the lower half of your screen.
Please copy the stack trace and error messages from that window and paste it in this issue.

<PASTE STACK TRACE HERE>

Failed to auto-collect gopls trace: ${failureReason}.
`;

        const body = `
gopls version: ${usersGoplsVersion}
gopls flags: ${settings}
update flags: ${latestConfig.checkForUpdates}
extension version: ${extInfo.version}
go version: ${goVersion?.format(true)}
environment: ${extInfo.appName} ${process.platform}
initialization error: ${initializationError}
manual restart count: ${manualRestartCount}
total start count: ${totalStartCount}

ATTENTION: PLEASE PROVIDE THE DETAILS REQUESTED BELOW.

Describe what you observed.

<ANSWER HERE>

${goplsLog}

OPTIONAL: If you would like to share more information, you can attach your complete gopls logs.

NOTE: THESE MAY CONTAIN SENSITIVE INFORMATION ABOUT YOUR CODEBASE.
DO NOT SHARE LOGS IF YOU ARE WORKING IN A PRIVATE REPOSITORY.

<OPTIONAL: ATTACH LOGS HERE>
`;
        const url = `https://github.com/golang/vscode-go/issues/new?title=${title}&labels=upstream-tools&body=${body}`;
        await qv.env.openExternal(qv.Uri.parse(url));
      }
      break;
    case 'Next time':
      break;
    case 'Never':
      updateGlobalState(
        promptForIssueOnGoplsRestartKey,
        JSON.stringify({
          prompt: false,
          date: new Date(),
        })
      );
      break;
  }
}

function randomIntInRange(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export const timeMinute = 1000 * 60;
const timeHour = timeMinute * 60;
const timeDay = timeHour * 24;

function daysBetween(a: Date, b: Date): number {
  return msBetween(a, b) / timeDay;
}

function minutesBetween(a: Date, b: Date): number {
  return msBetween(a, b) / timeMinute;
}

function msBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime());
}

export function showServerOutputChannel() {
  if (!languageServerIsRunning) {
    qv.window.showInformationMessage('gopls is not running');
    return;
  }

  serverOutputChannel.show();
  let found: qv.TextDocument;
  for (const doc of qv.workspace.textDocuments) {
    if (doc.fileName.indexOf('extension-output-') !== -1) {
      const contents = doc.getText();
      if (contents.indexOf('[Info  - ') === -1) {
        continue;
      }
      if (found !== undefined) {
        qv.window.showInformationMessage('multiple docs named extension-output-...');
      }
      found = doc;

      qv.workspace.openTextDocument({ language: 'log', content: contents });
    }
  }
  if (found === undefined) {
    qv.window.showErrorMessage('make sure "gopls (server)" output is showing');
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectGoplsLog(): Promise<{ sanitizedLog?: string; failureReason?: string }> {
  serverOutputChannel.show();

  let logs: string;
  for (let i = 0; i < 10; i++) {
    for (const doc of qv.workspace.textDocuments) {
      if (doc.languageId !== 'Log') {
        continue;
      }
      if (doc.isDirty || doc.isClosed) {
        continue;
      }

      if (doc.fileName.indexOf('extension-output-') === -1) {
        continue;
      }
      logs = doc.getText();
      break;
    }
    if (logs) {
      break;
    }

    await sleep((i + 1) * 100);
  }

  return sanitizeGoplsTrace(logs);
}

enum GoplsFailureModes {
  NO_GOPLS_LOG = 'no gopls log',
  EMPTY_PANIC_TRACE = 'empty panic trace',
  INCOMPLETE_PANIC_TRACE = 'incomplete panic trace',
  INCORRECT_COMMAND_USAGE = 'incorrect gopls command usage',
  UNRECOGNIZED_CRASH_PATTERN = 'unrecognized crash pattern',
}

export function sanitizeGoplsTrace(logs?: string): { sanitizedLog?: string; failureReason?: string } {
  if (!logs) {
    return { failureReason: GoplsFailureModes.NO_GOPLS_LOG };
  }
  const panicMsgBegin = logs.lastIndexOf('panic: ');
  if (panicMsgBegin > -1) {
    const panicMsgEnd = logs.indexOf('Connection to server got closed.', panicMsgBegin);
    if (panicMsgEnd > -1) {
      const panicTrace = logs.substr(panicMsgBegin, panicMsgEnd - panicMsgBegin);
      const filePattern = /(\S+\.go):\d+/;
      const sanitized = panicTrace
        .split('\n')
        .map((line: string) => {
          const m = line.match(filePattern);
          if (!m) {
            return line;
          }
          const filePath = m[1];
          const fileBase = path.basename(filePath);
          return line.replace(filePath, '  ' + fileBase);
        })
        .join('\n');

      if (sanitized) {
        return { sanitizedLog: sanitized };
      }
      return { failureReason: GoplsFailureModes.EMPTY_PANIC_TRACE };
    }
    return { failureReason: GoplsFailureModes.INCOMPLETE_PANIC_TRACE };
  }
  const initFailMsgBegin = logs.lastIndexOf('Starting client failed');
  if (initFailMsgBegin > -1) {
    const initFailMsgEnd = logs.indexOf('Code: ', initFailMsgBegin);
    if (initFailMsgEnd > -1) {
      const lineEnd = logs.indexOf('\n', initFailMsgEnd);
      return {
        sanitizedLog: lineEnd > -1 ? logs.substr(initFailMsgBegin, lineEnd - initFailMsgBegin) : logs.substr(initFailMsgBegin),
      };
    }
  }
  if (logs.lastIndexOf('Usage: gopls') > -1) {
    return { failureReason: GoplsFailureModes.INCORRECT_COMMAND_USAGE };
  }
  return { failureReason: GoplsFailureModes.UNRECOGNIZED_CRASH_PATTERN };
}

function languageServerUsingDefault(cfg: qv.WorkspaceConfig): boolean {
  const useLangServer = cfg.inspect<boolean>('useLangServer');
  return useLangServer.globalValue === undefined && useLangServer.workspaceValue === undefined;
}

interface ExtensionInfo {
  version?: string; // Extension version
  appName: string; // The application name of the editor, like 'VS Code'
  isPreview?: boolean; // if the extension runs in preview mode (e.g. Nightly)
}

function getExtensionInfo(): ExtensionInfo {
  const packageJSON = qv.extensions.getExtension(extensionId)?.packageJSON;
  const version = packageJSON?.version;
  const appName = qv.env.appName;
  const isPreview = !!packageJSON?.preview;
  return { version, appName, isPreview };
}

export function isInPreviewMode(): boolean {
  return getExtensionInfo().isPreview;
}
