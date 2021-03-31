import * as path from 'path';
import * as qv from 'vscode';
import { isModSupported } from './goModules';
import { extractInstanceTestName, findAllTestSuiteRuns, getBenchmarkFunctions, getTestFlags, getTestFunctionDebugArgs, getTestFunctions, getTestTags, goTest, TestConfig } from './testUtils';

// lastTestConfig holds a reference to the last executed TestConfig which allows
// the last test to be easily re-executed.
let lastTestConfig: TestConfig;

export type TestAtCursorCmd = 'debug' | 'test' | 'benchmark';

/**
 * Executes the unit test at the primary cursor using `go test`. Output
 * is sent to the 'Go' channel.
 * @param goConfig Configuration for the Go extension.
 * @param cmd Whether the command is test , benchmark or debug.
 * @param args
 */
export function testAtCursor(goConfig: qv.WorkspaceConfiguration, cmd: TestAtCursorCmd, args: any) {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    qv.window.showInformationMessage('No editor is active.');
    return;
  }
  if (!editor.document.fileName.endsWith('_test.go')) {
    qv.window.showInformationMessage('No tests found. Current file is not a test file.');
    return;
  }

  const getFunctions = cmd === 'benchmark' ? getBenchmarkFunctions : getTestFunctions;

  editor.document.save().then(async () => {
    try {
      const testFunctions = await getFunctions(editor.document, null);
      // We use functionName if it was provided as argument
      // Otherwise find any test function containing the cursor.
      const testFunctionName = args && args.functionName ? args.functionName : testFunctions.filter((func) => func.range.contains(editor.selection.start)).map((el) => el.name)[0];
      if (!testFunctionName) {
        qv.window.showInformationMessage('No test function found at cursor.');
        return;
      }

      if (cmd === 'debug') {
        await debugTestAtCursor(editor, testFunctionName, testFunctions, goConfig);
      } else if (cmd === 'benchmark' || cmd === 'test') {
        await runTestAtCursor(editor, testFunctionName, testFunctions, goConfig, cmd, args);
      } else {
        throw new Error('Unsupported command.');
      }
    } catch (err) {
      console.error(err);
    }
  });
}

/**
 * Runs the test at cursor.
 */
async function runTestAtCursor(editor: qv.TextEditor, testFunctionName: string, testFunctions: qv.DocumentSymbol[], goConfig: qv.WorkspaceConfiguration, cmd: TestAtCursorCmd, args: any) {
  const testConfigFns = [testFunctionName];
  if (cmd !== 'benchmark' && extractInstanceTestName(testFunctionName)) {
    testConfigFns.push(...findAllTestSuiteRuns(editor.document, testFunctions).map((t) => t.name));
  }

  const isMod = await isModSupported(editor.document.uri);
  const testConfig: TestConfig = {
    goConfig,
    dir: path.dirname(editor.document.fileName),
    flags: getTestFlags(goConfig, args),
    functions: testConfigFns,
    isBenchmark: cmd === 'benchmark',
    isMod,
    applyCodeCoverage: goConfig.get<boolean>('coverOnSingleTest'),
  };
  // Remember this config as the last executed test.
  lastTestConfig = testConfig;
  return goTest(testConfig);
}

/**
 * Executes the sub unit test at the primary cursor using `go test`. Output
 * is sent to the 'Go' channel.
 *
 * @param goConfig Configuration for the Go extension.
 */
export async function subTestAtCursor(goConfig: qv.WorkspaceConfiguration, args: any) {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    qv.window.showInformationMessage('No editor is active.');
    return;
  }
  if (!editor.document.fileName.endsWith('_test.go')) {
    qv.window.showInformationMessage('No tests found. Current file is not a test file.');
    return;
  }

  await editor.document.save();
  try {
    const testFunctions = await getTestFunctions(editor.document, null);
    // We use functionName if it was provided as argument
    // Otherwise find any test function containing the cursor.
    const currentTestFunctions = testFunctions.filter((func) => func.range.contains(editor.selection.start));
    const testFunctionName = args && args.functionName ? args.functionName : currentTestFunctions.map((el) => el.name)[0];

    if (!testFunctionName || currentTestFunctions.length === 0) {
      qv.window.showInformationMessage('No test function found at cursor.');
      return;
    }

    const testFunction = currentTestFunctions[0];
    const simpleRunRegex = /t.Run\("([^"]+)",/;
    const runRegex = /t.Run\(/;
    let lineText: string;
    let runMatch: RegExpMatchArray | null;
    let simpleMatch: RegExpMatchArray | null;
    for (let i = editor.selection.start.line; i >= testFunction.range.start.line; i--) {
      lineText = editor.document.lineAt(i).text;
      simpleMatch = lineText.match(simpleRunRegex);
      runMatch = lineText.match(runRegex);
      if (simpleMatch || (runMatch && !simpleMatch)) {
        break;
      }
    }

    if (!simpleMatch) {
      qv.window.showInformationMessage('No subtest function with a simple subtest name found at cursor.');
      return;
    }

    const subTestName = testFunctionName + '/' + simpleMatch[1];

    return await runTestAtCursor(editor, subTestName, testFunctions, goConfig, 'test', args);
  } catch (err) {
    qv.window.showInformationMessage('Unable to run subtest: ' + err.toString());
    console.error(err);
  }
}

/**
 * Debugs the test at cursor.
 */
async function debugTestAtCursor(editor: qv.TextEditor, testFunctionName: string, testFunctions: qv.DocumentSymbol[], goConfig: qv.WorkspaceConfiguration) {
  const args = getTestFunctionDebugArgs(editor.document, testFunctionName, testFunctions);
  const tags = getTestTags(goConfig);
  const buildFlags = tags ? ['-tags', tags] : [];
  const flagsFromConfig = getTestFlags(goConfig);
  let foundArgsFlag = false;
  flagsFromConfig.forEach((x) => {
    if (foundArgsFlag) {
      args.push(x);
      return;
    }
    if (x === '-args') {
      foundArgsFlag = true;
      return;
    }
    buildFlags.push(x);
  });
  const workspaceFolder = qv.workspace.getWorkspaceFolder(editor.document.uri);
  const debugConfig: qv.DebugConfiguration = {
    name: 'Debug Test',
    type: 'go',
    request: 'launch',
    mode: 'auto',
    program: editor.document.fileName,
    env: goConfig.get('testEnvVars', {}),
    envFile: goConfig.get('testEnvFile'),
    args,
    buildFlags: buildFlags.join(' '),
  };
  return await qv.debug.startDebugging(workspaceFolder, debugConfig);
}

/**
 * Runs all tests in the package of the source of the active editor.
 *
 * @param goConfig Configuration for the Go extension.
 */
export async function testCurrentPackage(goConfig: qv.WorkspaceConfiguration, isBenchmark: boolean, args: any) {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    qv.window.showInformationMessage('No editor is active.');
    return;
  }

  const isMod = await isModSupported(editor.document.uri);
  const testConfig: TestConfig = {
    goConfig,
    dir: path.dirname(editor.document.fileName),
    flags: getTestFlags(goConfig, args),
    isBenchmark,
    isMod,
    applyCodeCoverage: goConfig.get<boolean>('coverOnTestPackage'),
  };
  // Remember this config as the last executed test.
  lastTestConfig = testConfig;
  return goTest(testConfig);
}

/**
 * Runs all tests from all directories in the workspace.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function testWorkspace(goConfig: qv.WorkspaceConfiguration, args: any) {
  if (!qv.workspace.workspaceFolders.length) {
    qv.window.showInformationMessage('No workspace is open to run tests.');
    return;
  }
  let workspaceUri = qv.workspace.workspaceFolders[0].uri;
  if (qv.window.activeTextEditor && qv.workspace.getWorkspaceFolder(qv.window.activeTextEditor.document.uri)) {
    workspaceUri = qv.workspace.getWorkspaceFolder(qv.window.activeTextEditor.document.uri).uri;
  }

  const testConfig: TestConfig = {
    goConfig,
    dir: workspaceUri.fsPath,
    flags: getTestFlags(goConfig, args),
    includeSubDirectories: true,
  };
  // Remember this config as the last executed test.
  lastTestConfig = testConfig;

  isModSupported(workspaceUri, true).then((isMod) => {
    testConfig.isMod = isMod;
    goTest(testConfig).then(null, (err) => {
      console.error(err);
    });
  });
}

/**
 * Runs all tests in the source of the active editor.
 *
 * @param goConfig Configuration for the Go extension.
 * @param isBenchmark Boolean flag indicating if these are benchmark tests or not.
 */
export async function testCurrentFile(goConfig: qv.WorkspaceConfiguration, isBenchmark: boolean, args: string[]): Promise<boolean> {
  const editor = qv.window.activeTextEditor;
  if (!editor) {
    qv.window.showInformationMessage('No editor is active.');
    return;
  }
  if (!editor.document.fileName.endsWith('_test.go')) {
    qv.window.showInformationMessage('No tests found. Current file is not a test file.');
    return;
  }

  const getFunctions = isBenchmark ? getBenchmarkFunctions : getTestFunctions;
  const isMod = await isModSupported(editor.document.uri);

  return editor.document
    .save()
    .then(() => {
      return getFunctions(editor.document, null).then((testFunctions) => {
        const testConfig: TestConfig = {
          goConfig,
          dir: path.dirname(editor.document.fileName),
          flags: getTestFlags(goConfig, args),
          functions: testFunctions.map((sym) => sym.name),
          isBenchmark,
          isMod,
          applyCodeCoverage: goConfig.get<boolean>('coverOnSingleTestFile'),
        };
        // Remember this config as the last executed test.
        lastTestConfig = testConfig;
        return goTest(testConfig);
      });
    })
    .then(null, (err) => {
      console.error(err);
      return Promise.resolve(false);
    });
}

/**
 * Runs the previously executed test.
 */
export function testPrevious() {
  if (!lastTestConfig) {
    qv.window.showInformationMessage('No test has been recently executed.');
    return;
  }
  goTest(lastTestConfig).then(null, (err) => {
    console.error(err);
  });
}
