import * as path from 'path';
import { getGoConfig, getGoplsConfig, initConfig, IsInCloudIDE } from './config';
import { browsePackages } from './goBrowsePackage';
import { buildCode } from './goBuild';
import { check, notifyIfGeneratedFile, removeTestStatus } from './goCheck';
import {
  applyCodeCoverage,
  applyCodeCoverageToAllEditors,
  initCoverageDecorators,
  removeCodeCoverageOnFileSave,
  toggleCoverageCurrentPackage,
  trackCodeCoverageRemovalOnFileChange,
  updateCodeCoverageDecorators,
} from './goCover';
import { GoDebugConfigurationProvider } from '../../direct/src/features/debug';
import { GoDebugAdapterDescriptorFactory } from './goDebugFactory';
import { extractFunction, extractVariable } from './goDoctor';
import { toolExecutionEnvironment } from './goEnv';
import { chooseGoEnvironment, offerToInstallLatestGoVersion, setEnvironmentVariableCollection } from './goEnvironmentStatus';
import { runFillStruct } from './goFillStruct';
import * as goGenerateTests from './goGenerateTests';
import { goGetPackage } from './goGetPackage';
import { implCursor } from './goImpl';
import { addImport, addImportToWorkspace } from './goImport';
import { installCurrentPackage } from './goInstall';
import { installAllTools, installTools, offerToInstallTools, promptForMissingTool, updateGoVarsFromConfig } from './goInstallTools';
import {
  isInPreviewMode,
  languageServerIsRunning,
  resetSurveyConfig,
  showServerOutputChannel,
  showSurveyConfig,
  startLanguageServerWithFallback,
  timeMinute,
  watchLanguageServerConfiguration,
} from '../../direct/src/features/server';
import { lintCode } from './goLint';
import { logVerbose, setLogConfig } from './goLogging';
import { GO_MODE } from './goMode';
import { addTags, removeTags } from './goModifytags';
import { GO111MODULE, isModSupported } from './goModules';
import { playgroundCommand } from './goPlayground';
import { GoReferencesCodeLensProvider } from './referencesCodelens';
import { GoRunTestCodeLensProvider } from './runTestCodelens';
import { disposeGoStatusBar, expandGoStatusBar, outputChannel, updateGoStatusBar } from './goStatus';
import { subTestAtCursor, testAtCursor, testCurrentFile, testCurrentPackage, testPrevious, testWorkspace } from './goTest';
import { getConfiguredTools } from './goTools';
import { vetCode } from './goVet';
import { pickGoProcess, pickProcess } from './pickProcess';
import { getFromGlobalState, getFromWorkspaceState, resetGlobalState, resetWorkspaceState, setGlobalState, setWorkspaceState, updateGlobalState, updateWorkspaceState } from './stateUtils';
import { cancelRunningTests, showTestOutput } from './testUtils';
import {
  cleanupTempDir,
  getBinPath,
  getCurrentGoPath,
  getExtensionCommands,
  getGoEnv,
  getGoVersion,
  getToolsGopath,
  getWorkspaceFolderPath,
  handleDiagnosticErrors,
  isGoPathSet,
  resolvePath,
} from './util';
import { clearCacheForTools, fileExists, getCurrentGoRoot, setCurrentGoRoot } from './utils/pathUtils';
import { WelcomePanel } from './welcome';
import semver = require('semver');
import * as qv from 'vscode';
import { getFormatTool } from '../../direct/src/features/go/format';

export let buildDiagnosticCollection: qv.DiagnosticCollection;
export let lintDiagnosticCollection: qv.DiagnosticCollection;
export let vetDiagnosticCollection: qv.DiagnosticCollection;

// restartLanguageServer wraps all of the logic needed to restart the
// language server. It can be used to enable, disable, or otherwise change
// the configuration of the server.
export let restartLanguageServer = () => {
  return;
};

export async function activate(ctx: qv.ExtensionContext) {
  if (process.env['VSCODE_GO_IN_TEST'] === '1') return;
  setGlobalState(ctx.globalState);
  setWorkspaceState(ctx.workspaceState);
  setEnvironmentVariableCollection(ctx.environmentVariableCollection);
  await initConfig(ctx);
  const cfg = getGoConfig();
  setLogConfig(cfg['logging']);
  if (qv.window.registerWebviewPanelSerializer) {
    qv.window.registerWebviewPanelSerializer(WelcomePanel.viewType, {
      async deserializeWebviewPanel(webviewPanel: qv.WebviewPanel, state: any) {
        WelcomePanel.revive(webviewPanel, ctx.extensionUri);
      },
    });
  }
  if (isInPreviewMode()) setTimeout(showGoNightlyWelcomeMessage, 10 * timeMinute);
  if (!IsInCloudIDE) showGoWelcomePage(ctx);
  const configGOROOT = getGoConfig()['goroot'];
  if (configGOROOT) {
    logVerbose(`go.goroot = '${configGOROOT}'`);
    setCurrentGoRoot(resolvePath(configGOROOT));
  }
  const experimentalFeatures = getGoConfig()['languageServerExperimentalFeatures'];
  if (experimentalFeatures) {
    if (experimentalFeatures['documentLink'] === false) {
      qv.window.showErrorMessage(`The 'go.languageServerExperimentalFeature.documentLink' setting is now deprecated.
Please use '"gopls": {"ui.navigation.importShortcut": "Definition" }' instead.
See [the settings doc](https://github.com/golang/vscode-go/blob/master/docs/settings.md#uinavigationimportshortcut) for more details.`);
    }
    const promptKey = 'promptedLanguageServerExperimentalFeatureDeprecation';
    const prompted = getFromGlobalState(promptKey, false);
    if (!prompted && experimentalFeatures['diagnostics'] === false) {
      const msg = `The 'go.languageServerExperimentalFeature.diagnostics' setting will be deprecated soon.
If you would like additional configuration for diagnostics from gopls, please see and response to [Issue 50](https://github.com/golang/vscode-go/issues/50).`;
      const selected = await qv.window.showInformationMessage(msg, "Don't show again");
      switch (selected) {
        case "Don't show again":
          updateGlobalState(promptKey, true);
      }
    }
  }
  updateGoVarsFromConfig().then(async () => {
    suggestUpdates(ctx);
    offerToInstallLatestGoVersion();
    offerToInstallTools();
    await configureLanguageServer(ctx);
    if (!languageServerIsRunning && qv.window.activeTextEditor && qv.window.activeTextEditor.document.languageId === 'go' && isGoPathSet()) {
      isModSupported(qv.window.activeTextEditor.document.uri).then(() => {
        runBuilds(qv.window.activeTextEditor.document, getGoConfig());
      });
    }
  });
  initCoverageDecorators(ctx);
  ctx.subscriptions.push(qv.commands.registerCommand('go.environment.status', async () => expandGoStatusBar()));
  const testCodeLensProvider = new GoRunTestCodeLensProvider();
  const referencesCodeLensProvider = new GoReferencesCodeLensProvider();
  ctx.subscriptions.push(qv.languages.registerCodeLensProvider(GO_MODE, testCodeLensProvider));
  ctx.subscriptions.push(qv.languages.registerCodeLensProvider(GO_MODE, referencesCodeLensProvider));
  ctx.subscriptions.push(qv.debug.registerDebugConfigurationProvider('go', new GoDebugConfigurationProvider('go')));
  ctx.subscriptions.push(
    qv.commands.registerCommand(
      'go.debug.pickProcess',
      async (): Promise<string> => {
        return await pickProcess();
      }
    )
  );
  ctx.subscriptions.push(
    qv.commands.registerCommand(
      'go.debug.pickGoProcess',
      async (): Promise<string> => {
        return await pickGoProcess();
      }
    )
  );
  const factory = new GoDebugAdapterDescriptorFactory();
  ctx.subscriptions.push(qv.debug.registerDebugAdapterDescriptorFactory('go', factory));
  if ('dispose' in factory) ctx.subscriptions.push(factory);
  buildDiagnosticCollection = qv.languages.createDiagnosticCollection('go');
  ctx.subscriptions.push(buildDiagnosticCollection);
  lintDiagnosticCollection = qv.languages.createDiagnosticCollection(lintDiagnosticCollectionName(getGoConfig()['lintTool']));
  ctx.subscriptions.push(lintDiagnosticCollection);
  vetDiagnosticCollection = qv.languages.createDiagnosticCollection('go-vet');
  ctx.subscriptions.push(vetDiagnosticCollection);

  addOnChangeTextDocumentListeners(ctx);
  addOnChangeActiveTextEditorListeners(ctx);
  addOnSaveTextDocumentListeners(ctx);

  ctx.subscriptions.push(qv.commands.registerCommand('go.gopath', () => getCurrentGoPathCommand()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.locate.tools', async () => getConfiguredGoToolsCommand()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.add.tags', (xs) => addTags(xs)));
  ctx.subscriptions.push(qv.commands.registerCommand('go.remove.tags', (xs) => removeTags(xs)));
  ctx.subscriptions.push(qv.commands.registerCommand('go.fill.struct', () => runFillStruct(qv.window.activeTextEditor)));
  ctx.subscriptions.push(qv.commands.registerCommand('go.impl.cursor', () => implCursor()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.godoctor.extract', () => extractFunction()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.godoctor.var', () => extractVariable()));
  ctx.subscriptions.push(
    qv.commands.registerCommand('go.test.cursor', (xs) => {
      testAtCursor(getGoConfig(), 'test', xs);
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.subtest.cursor', (xs) => {
      subTestAtCursor(getGoConfig(), xs);
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.debug.cursor', (xs) => {
      if (qv.debug.activeDebugSession) {
        qv.window.showErrorMessage('Debug session has already been started');
        return;
      }
      testAtCursor(getGoConfig(), 'debug', xs);
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.benchmark.cursor', (xs) => {
      testAtCursor(getGoConfig(), 'benchmark', xs);
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.test.package', (xs) => {
      testCurrentPackage(getGoConfig(), false, xs);
    })
  );

  ctx.subscriptions.push(qv.commands.registerCommand('go.benchmark.package', (xs) => testCurrentPackage(getGoConfig(), true, xs)));
  ctx.subscriptions.push(qv.commands.registerCommand('go.test.file', (xs) => testCurrentFile(getGoConfig(), false, xs)));
  ctx.subscriptions.push(qv.commands.registerCommand('go.benchmark.file', (xs) => testCurrentFile(getGoConfig(), true, xs)));
  ctx.subscriptions.push(qv.commands.registerCommand('go.test.workspace', (xs) => testWorkspace(getGoConfig(), xs)));
  ctx.subscriptions.push(qv.commands.registerCommand('go.test.previous', () => testPrevious()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.test.coverage', () => toggleCoverageCurrentPackage()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.test.showOutput', () => showTestOutput()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.test.cancel', () => cancelRunningTests()));
  ctx.subscriptions.push(
    qv.commands.registerCommand('go.import.add', (x) => {
      return addImport(x);
    })
  );
  ctx.subscriptions.push(qv.commands.registerCommand('go.add.package.workspace', () => addImportToWorkspace()));

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.tools.install', async (args) => {
      if (Array.isArray(args) && args.length) {
        const goVersion = await getGoVersion();
        await installTools(args, goVersion);
        return;
      }
      installAllTools();
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.browse.packages', () => {
      browsePackages();
    })
  );

  ctx.subscriptions.push(
    qv.workspace.onDidChangeConfiguration((e: qv.ConfigurationChangeEvent) => {
      if (!e.affectsConfiguration('go')) {
        return;
      }
      const updatedGoConfig = getGoConfig();

      if (
        e.affectsConfiguration('go.goroot') ||
        e.affectsConfiguration('go.alternateTools') ||
        e.affectsConfiguration('go.gopath') ||
        e.affectsConfiguration('go.toolsEnvVars') ||
        e.affectsConfiguration('go.testEnvFile')
      ) {
        updateGoVarsFromConfig();
      }
      if (e.affectsConfiguration('go.logging')) {
        setLogConfig(updatedGoConfig['logging']);
      }
      // If there was a change in "toolsGopath" setting, then clear cache for go tools
      if (getToolsGopath() !== getToolsGopath(false)) {
        clearCacheForTools();
      }

      if (updatedGoConfig['enableCodeLens']) {
        testCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['runtest']);
        referencesCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['references']);
      }

      if (e.affectsConfiguration('go.formatTool')) {
        checkToolExists(getFormatTool(updatedGoConfig));
      }
      if (e.affectsConfiguration('go.lintTool')) {
        checkToolExists(updatedGoConfig['lintTool']);
      }
      if (e.affectsConfiguration('go.docsTool')) {
        checkToolExists(updatedGoConfig['docsTool']);
      }
      if (e.affectsConfiguration('go.coverageDecorator')) {
        updateCodeCoverageDecorators(updatedGoConfig['coverageDecorator']);
      }
      if (e.affectsConfiguration('go.toolsEnvVars')) {
        const env = toolExecutionEnvironment();
        if (GO111MODULE !== env['GO111MODULE']) {
          const reloadMsg = 'Reload VS Code window so that the Go tools can respect the change to GO111MODULE';
          qv.window.showInformationMessage(reloadMsg, 'Reload').then((selected) => {
            if (selected === 'Reload') {
              qv.commands.executeCommand('workbench.action.reloadWindow');
            }
          });
        }
      }
      if (e.affectsConfiguration('go.lintTool')) {
        const lintTool = lintDiagnosticCollectionName(updatedGoConfig['lintTool']);
        if (lintDiagnosticCollection && lintDiagnosticCollection.name !== lintTool) {
          lintDiagnosticCollection.dispose();
          lintDiagnosticCollection = qv.languages.createDiagnosticCollection(lintTool);
          ctx.subscriptions.push(lintDiagnosticCollection);
          // TODO: actively maintain our own disposables instead of keeping pushing to ctx.subscription.
        }
      }
    })
  );

  ctx.subscriptions.push(qv.commands.registerCommand('go.test.generate.package', () => goGenerateTests.generateTestCurrentPackage()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.test.generate.file', () => goGenerateTests.generateTestCurrentFile()));
  ctx.subscriptions.push(
    qv.commands.registerCommand('go.test.generate.function', () => {
      goGenerateTests.generateTestCurrentFunction();
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.toggle.test.file', () => {
      goGenerateTests.toggleTestFile();
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.debug.startSession', (config) => {
      let workspaceFolder;
      if (qv.window.activeTextEditor) {
        workspaceFolder = qv.workspace.getWorkspaceFolder(qv.window.activeTextEditor.document.uri);
      }

      return qv.debug.startDebugging(workspaceFolder, config);
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.show.commands', () => {
      const extCommands = getExtensionCommands();
      extCommands.push({
        command: 'editor.action.goToDeclaration',
        title: 'Go to Definition',
      });
      extCommands.push({
        command: 'editor.action.goToImplementation',
        title: 'Go to Implementation',
      });
      extCommands.push({
        command: 'workbench.action.gotoSymbol',
        title: 'Go to Symbol in File...',
      });
      extCommands.push({
        command: 'workbench.action.showAllSymbols',
        title: 'Go to Symbol in Workspace...',
      });
      qv.window.showQuickPick(extCommands.map((x) => x.title)).then((cmd) => {
        const selectedCmd = extCommands.find((x) => x.title === cmd);
        if (selectedCmd) {
          qv.commands.executeCommand(selectedCmd.command);
        }
      });
    })
  );

  ctx.subscriptions.push(qv.commands.registerCommand('go.get.package', goGetPackage));
  ctx.subscriptions.push(qv.commands.registerCommand('go.playground', playgroundCommand));
  ctx.subscriptions.push(qv.commands.registerCommand('go.lint.package', () => lintCode('package')));
  ctx.subscriptions.push(qv.commands.registerCommand('go.lint.workspace', () => lintCode('workspace')));
  ctx.subscriptions.push(qv.commands.registerCommand('go.lint.file', () => lintCode('file')));
  ctx.subscriptions.push(qv.commands.registerCommand('go.vet.package', vetCode));

  ctx.subscriptions.push(qv.commands.registerCommand('go.vet.workspace', () => vetCode(true)));

  ctx.subscriptions.push(qv.commands.registerCommand('go.build.package', buildCode));

  ctx.subscriptions.push(qv.commands.registerCommand('go.build.workspace', () => buildCode(true)));

  ctx.subscriptions.push(qv.commands.registerCommand('go.install.package', installCurrentPackage));

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.extractServerChannel', () => {
      showServerOutputChannel();
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.welcome', () => {
      WelcomePanel.createOrShow(ctx.extensionUri);
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.workspace.resetState', () => {
      resetWorkspaceState();
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.global.resetState', () => {
      resetGlobalState();
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.toggle.gc_details', () => {
      if (!languageServerIsRunning) {
        qv.window.showErrorMessage('"Go: Toggle gc details" command is available only when the language server is running');
        return;
      }
      const doc = qv.window.activeTextEditor?.document.uri.toString();
      if (!doc || !doc.endsWith('.go')) {
        qv.window.showErrorMessage('"Go: Toggle gc details" command cannot run when no Go file is open.');
        return;
      }
      qv.commands.executeCommand('gc_details', doc).then(undefined, (reason0) => {
        qv.commands.executeCommand('gopls.gc_details', doc).then(undefined, (reason1) => {
          qv.window.showErrorMessage(`"Go: Toggle gc details" command failed: gc_details:${reason0} gopls_gc_details:${reason1}`);
        });
      });
    })
  );

  ctx.subscriptions.push(
    qv.commands.registerCommand('go.apply.coverprofile', () => {
      if (!qv.window.activeTextEditor || !qv.window.activeTextEditor.document.fileName.endsWith('.go')) {
        qv.window.showErrorMessage('Cannot apply coverage profile when no Go file is open.');
        return;
      }
      const lastCoverProfilePathKey = 'lastCoverProfilePathKey';
      const lastCoverProfilePath = getFromWorkspaceState(lastCoverProfilePathKey, '');
      qv.window
        .showInputBox({
          prompt: 'Enter the path to the coverage profile for current package',
          value: lastCoverProfilePath,
        })
        .then((coverProfilePath) => {
          if (!coverProfilePath) {
            return;
          }
          if (!fileExists(coverProfilePath)) {
            qv.window.showErrorMessage(`Cannot find the file ${coverProfilePath}`);
            return;
          }
          if (coverProfilePath !== lastCoverProfilePath) {
            updateWorkspaceState(lastCoverProfilePathKey, coverProfilePath);
          }
          applyCodeCoverageToAllEditors(coverProfilePath, getWorkspaceFolderPath(qv.window.activeTextEditor.document.uri));
        });
    })
  );

  // Go Enviornment switching commands
  ctx.subscriptions.push(
    qv.commands.registerCommand('go.environment.choose', () => {
      chooseGoEnvironment();
    })
  );

  // Survey related commands
  ctx.subscriptions.push(qv.commands.registerCommand('go.survey.showConfig', () => showSurveyConfig()));
  ctx.subscriptions.push(qv.commands.registerCommand('go.survey.resetConfig', () => resetSurveyConfig()));

  qv.languages.setLanguageConfiguration(GO_MODE.language, {
    wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
  });
}

function showGoWelcomePage(ctx: qv.ExtensionContext) {
  // Update this list of versions when there is a new version where we want to
  // show the welcome page on update.
  const showVersions: string[] = ['0.22.0'];
  // TODO(hyangah): use the content hash instead of hard-coded string.
  // https://github.com/golang/vscode-go/issue/1179
  let goExtensionVersion = '0.22.0';
  let goExtensionVersionKey = 'go.extensionVersion';
  if (isInPreviewMode()) {
    goExtensionVersion = '0.0.0';
    goExtensionVersionKey = 'go.nightlyExtensionVersion';
  }

  const savedGoExtensionVersion = getFromGlobalState(goExtensionVersionKey, '');

  if (shouldShowGoWelcomePage(showVersions, goExtensionVersion, savedGoExtensionVersion)) {
    WelcomePanel.createOrShow(ctx.extensionUri);
  }
  if (goExtensionVersion !== savedGoExtensionVersion) {
    updateGlobalState(goExtensionVersionKey, goExtensionVersion);
  }
}

export function shouldShowGoWelcomePage(showVersions: string[], newVersion: string, oldVersion: string): boolean {
  if (newVersion === oldVersion) {
    return false;
  }
  const coercedNew = semver.coerce(newVersion);
  const coercedOld = semver.coerce(oldVersion);
  if (!coercedNew || !coercedOld) {
    return true;
  }
  // Both semver.coerce(0.22.0) and semver.coerce(0.22.0-rc.1) will be 0.22.0.
  return semver.gte(coercedNew, coercedOld) && showVersions.includes(coercedNew.toString());
}

async function showGoNightlyWelcomeMessage() {
  const shown = getFromGlobalState(goNightlyPromptKey, false);
  if (shown === true) {
    return;
  }
  const prompt = async () => {
    const selected = await qv.window.showInformationMessage(
      `Thank you for testing new features by using the Go Nightly extension!
We'd like to welcome you to share feedback and/or join our community of Go Nightly users and developers.`,
      'Share feedback',
      'Community resources'
    );
    switch (selected) {
      case 'Share feedback':
        await qv.env.openExternal(qv.Uri.parse('https://github.com/golang/vscode-go/blob/master/docs/nightly.md#feedback'));
        break;
      case 'Community resources':
        await qv.env.openExternal(qv.Uri.parse('https://github.com/golang/vscode-go/blob/master/docs/nightly.md#community'));
        break;
      default:
        return;
    }
    // Only prompt again if the user clicked one of the buttons.
    // They may want to look at the other option.
    prompt();
  };
  prompt();

  // Update state to indicate that we've shown this message to the user.
  updateGlobalState(goNightlyPromptKey, true);
}

const goNightlyPromptKey = 'goNightlyPrompt';

export function deactivate() {
  return Promise.all([cancelRunningTests(), Promise.resolve(cleanupTempDir()), Promise.resolve(disposeGoStatusBar())]);
}

function runBuilds(document: qv.TextDocument, goConfig: qv.WorkspaceConfiguration) {
  if (document.languageId !== 'go') {
    return;
  }

  buildDiagnosticCollection.clear();
  lintDiagnosticCollection.clear();
  vetDiagnosticCollection.clear();
  check(document.uri, goConfig)
    .then((results) => {
      results.forEach((result) => {
        handleDiagnosticErrors(document, result.errors, result.diagnosticCollection);
      });
    })
    .catch((err) => {
      qv.window.showInformationMessage('Error: ' + err);
    });
}

function addOnSaveTextDocumentListeners(ctx: qv.ExtensionContext) {
  qv.workspace.onDidSaveTextDocument(removeCodeCoverageOnFileSave, null, ctx.subscriptions);
  qv.workspace.onDidSaveTextDocument(
    (document) => {
      if (document.languageId !== 'go') {
        return;
      }
      const session = qv.debug.activeDebugSession;
      if (session && session.type === 'go') {
        const neverAgain = { title: "Don't Show Again" };
        const ignoreActiveDebugWarningKey = 'ignoreActiveDebugWarningKey';
        const ignoreActiveDebugWarning = getFromGlobalState(ignoreActiveDebugWarningKey);
        if (!ignoreActiveDebugWarning) {
          qv.window.showWarningMessage('A debug session is currently active. Changes to your Go files may result in unexpected behaviour.', neverAgain).then((result) => {
            if (result === neverAgain) {
              updateGlobalState(ignoreActiveDebugWarningKey, true);
            }
          });
        }
      }
      if (qv.window.visibleTextEditors.some((e) => e.document.fileName === document.fileName)) {
        runBuilds(document, getGoConfig(document.uri));
      }
    },
    null,
    ctx.subscriptions
  );
}

function addOnChangeTextDocumentListeners(ctx: qv.ExtensionContext) {
  qv.workspace.onDidChangeTextDocument(trackCodeCoverageRemovalOnFileChange, null, ctx.subscriptions);
  qv.workspace.onDidChangeTextDocument(removeTestStatus, null, ctx.subscriptions);
  qv.workspace.onDidChangeTextDocument(notifyIfGeneratedFile, ctx, ctx.subscriptions);
}

function addOnChangeActiveTextEditorListeners(ctx: qv.ExtensionContext) {
  [updateGoStatusBar, applyCodeCoverage].forEach((listener) => {
    // Call the listeners on initilization for current active text editor
    if (qv.window.activeTextEditor) {
      listener(qv.window.activeTextEditor);
    }
    qv.window.onDidChangeActiveTextEditor(listener, null, ctx.subscriptions);
  });
}

function checkToolExists(tool: string) {
  if (tool === getBinPath(tool)) {
    promptForMissingTool(tool);
  }
}

async function suggestUpdates(ctx: qv.ExtensionContext) {
  const updateToolsCmdText = 'Update tools';
  interface GoInfo {
    goroot: string;
    version: string;
  }
  const toolsGoInfo: { [id: string]: GoInfo } = ctx.globalState.get('toolsGoInfo') || {};
  const toolsGopath = getToolsGopath() || getCurrentGoPath();
  if (!toolsGoInfo[toolsGopath]) {
    toolsGoInfo[toolsGopath] = { goroot: null, version: null };
  }
  const prevGoroot = toolsGoInfo[toolsGopath].goroot;
  const currentGoroot: string = getCurrentGoRoot().toLowerCase();
  if (prevGoroot && prevGoroot.toLowerCase() !== currentGoroot) {
    qv.window.showInformationMessage(`Your current goroot (${currentGoroot}) is different than before (${prevGoroot}), a few Go tools may need recompiling`, updateToolsCmdText).then((selected) => {
      if (selected === updateToolsCmdText) {
        installAllTools(true);
      }
    });
  } else {
    const currentVersion = await getGoVersion();
    if (currentVersion) {
      const prevVersion = toolsGoInfo[toolsGopath].version;
      const currVersionString = currentVersion.format();

      if (prevVersion !== currVersionString) {
        if (prevVersion) {
          qv.window.showInformationMessage('Your Go version is different than before, a few Go tools may need re-compiling', updateToolsCmdText).then((selected) => {
            if (selected === updateToolsCmdText) {
              installAllTools(true);
            }
          });
        }
        toolsGoInfo[toolsGopath].version = currVersionString;
      }
    }
  }
  toolsGoInfo[toolsGopath].goroot = currentGoroot;
  ctx.globalState.update('toolsGoInfo', toolsGoInfo);
}

function configureLanguageServer(ctx: qv.ExtensionContext) {
  // Subscribe to notifications for changes to the configuration
  // of the language server, even if it's not currently in use.
  ctx.subscriptions.push(qv.workspace.onDidChangeConfiguration((e) => watchLanguageServerConfiguration(e)));

  // Set the function that is used to restart the language server.
  // This is necessary, even if the language server is not currently
  // in use.
  restartLanguageServer = async () => {
    startLanguageServerWithFallback(ctx, false);
  };

  // Start the language server, or fallback to the default language providers.
  return startLanguageServerWithFallback(ctx, true);
}

function getCurrentGoPathCommand() {
  const gopath = getCurrentGoPath();
  let msg = `${gopath} is the current GOPATH.`;
  const wasInfered = getGoConfig()['inferGopath'];
  const root = getWorkspaceFolderPath(qv.window.activeTextEditor && qv.window.activeTextEditor.document.uri);

  // not only if it was configured, but if it was successful.
  if (wasInfered && root && root.indexOf(gopath) === 0) {
    const inferredFrom = qv.window.activeTextEditor ? 'current folder' : 'workspace root';
    msg += ` It is inferred from ${inferredFrom}`;
  }

  qv.window.showInformationMessage(msg);
  return gopath;
}

async function getConfiguredGoToolsCommand() {
  outputChannel.show();
  outputChannel.clear();
  outputChannel.appendLine('Checking configured tools....');
  // Tool's path search is done by getBinPathWithPreferredGopath
  // which searches places in the following order
  // 1) absolute path for the alternateTool
  // 2) GOBIN
  // 3) toolsGopath
  // 4) gopath
  // 5) GOROOT
  // 6) PATH
  outputChannel.appendLine('GOBIN: ' + process.env['GOBIN']);
  outputChannel.appendLine('toolsGopath: ' + getToolsGopath());
  outputChannel.appendLine('gopath: ' + getCurrentGoPath());
  outputChannel.appendLine('GOROOT: ' + getCurrentGoRoot());
  outputChannel.appendLine('PATH: ' + process.env['PATH']);
  outputChannel.appendLine('');

  const goVersion = await getGoVersion();
  const allTools = getConfiguredTools(goVersion, getGoConfig(), getGoplsConfig());

  allTools.forEach((tool) => {
    const toolPath = getBinPath(tool.name);
    // TODO(hyangah): print alternate tool info if set.
    let msg = 'not installed';
    if (path.isAbsolute(toolPath)) {
      // getBinPath returns the absolute path is the tool exists.
      // (See getBinPathWithPreferredGopath which is called underneath)
      msg = 'installed';
    }
    outputChannel.appendLine(`   ${tool.name}: ${toolPath} ${msg}`);
  });

  let folders = qv.workspace.workspaceFolders?.map((folder) => {
    return { name: folder.name, path: folder.uri.fsPath };
  });
  if (!folders) {
    folders = [{ name: 'no folder', path: undefined }];
  }

  outputChannel.appendLine('');
  outputChannel.appendLine('go env');
  for (const folder of folders) {
    outputChannel.appendLine(`Workspace Folder (${folder.name}): ${folder.path}`);
    try {
      const out = await getGoEnv(folder.path);
      // Append '\t' to the beginning of every line (^) of 'out'.
      // 'g' = 'global matching', and 'm' = 'multi-line matching'
      outputChannel.appendLine(out.replace(/^/gm, '\t'));
    } catch (e) {
      outputChannel.appendLine(`failed to run 'go env': ${e}`);
    }
  }
}

function lintDiagnosticCollectionName(lintToolName: string) {
  if (!lintToolName || lintToolName === 'golint') {
    return 'go-lint';
  }
  return `go-${lintToolName}`;
}
