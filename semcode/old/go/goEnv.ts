import * as qv from 'vscode';
import { getGoConfig } from './config';
import { getCurrentGoPath, getToolsGopath, resolvePath } from './util';
import { logVerbose } from './goLogging';

export function toolInstallationEnvironment(): NodeJS.Dict<string> {
  const env = newEnvironment();
  let toolsGopath = getToolsGopath();
  if (toolsGopath) {
    env['GOBIN'] = '';
  } else {
    toolsGopath = getCurrentGoPath();
  }
  if (!toolsGopath) {
    const msg = 'Cannot install Go tools. Set either go.gopath or go.toolsGopath in settings.';
    qv.window.showInformationMessage(msg, 'Open User Settings', 'Open Workspace Settings').then((selected) => {
      switch (selected) {
        case 'Open User Settings':
          qv.commands.executeCommand('workbench.action.openGlobalSettings');
          break;
        case 'Open Workspace Settings':
          qv.commands.executeCommand('workbench.action.openWorkspaceSettings');
          break;
      }
    });
    return;
  }
  env['GOPATH'] = toolsGopath;

  delete env['GOOS'];
  delete env['GOARCH'];
  delete env['GOROOT'];
  delete env['GOFLAGS'];
  delete env['GOENV'];

  return env;
}

export function toolExecutionEnvironment(uri?: qv.Uri): NodeJS.Dict<string> {
  const env = newEnvironment();
  const gopath = getCurrentGoPath(uri);
  if (gopath) {
    env['GOPATH'] = gopath;
  }
  if (env['GOFLAGS'] && env['GOFLAGS'].includes('-json')) {
    env['GOFLAGS'] = env['GOFLAGS'].replace(/(^|\s+)-?-json[^\s]*/g, '');
    logVerbose(`removed -json from GOFLAGS: ${env['GOFLAGS']}`);
  }
  return env;
}

function newEnvironment(): NodeJS.Dict<string> {
  const toolsEnvVars = getGoConfig()['toolsEnvVars'];
  const env = Object.assign({}, process.env, toolsEnvVars);
  if (toolsEnvVars && typeof toolsEnvVars === 'object') {
    Object.keys(toolsEnvVars).forEach((key) => (env[key] = typeof toolsEnvVars[key] === 'string' ? resolvePath(toolsEnvVars[key]) : toolsEnvVars[key]));
  }

  const httpProxy = qv.workspace.getConfiguration('http', null).get('proxy');
  if (httpProxy && typeof httpProxy === 'string') {
    env['http_proxy'] = httpProxy;
    env['HTTP_PROXY'] = httpProxy;
    env['https_proxy'] = httpProxy;
    env['HTTPS_PROXY'] = httpProxy;
  }
  return env;
}
