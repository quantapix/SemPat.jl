const testRunner = require('../../../test/integration/electron/testrunner');

testRunner.configure({
  ui: 'tdd', // the TDD UI is being used in extension.test.ts (suite, test, etc.)
  color: !process.env.BUILD_ARTIFACTSTAGINGDIRECTORY && process.platform !== 'win32', // colored output from test results (only windows cannot handle)
  timeout: 60000,
});

export = testRunner;
