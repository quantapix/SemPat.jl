import TypeScriptServiceClientHost from '../typeScriptServiceClientHost';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { Lazy } from '../utils/lazy';
import { PluginMgr } from './utils/plugins';
import * as qv from 'vscode';
import { openProjectConfigForFile, ProjectType } from './utils/tsconfig';
import { isTypeScriptDocument } from './utils/languageModeIds';

export interface Command {
  readonly id: string | string[];
  execute(...xs: any[]): void;
}

export class CommandMgr {
  private readonly cmds = new Map<string, qv.Disposable>();
  public dispose() {
    for (const r of this.cmds.values()) {
      r.dispose();
    }
    this.cmds.clear();
  }
  public register<T extends Command>(c: T): T {
    for (const id of Array.isArray(c.id) ? c.id : [c.id]) {
      this.registerCommand(id, c.execute, c);
    }
    return c;
  }
  private registerCommand(id: string, impl: (...xs: any[]) => void, thisArg?: any) {
    if (this.cmds.has(id)) return;
    this.cmds.set(id, qv.commands.registerCommand(id, impl, thisArg));
  }
}

export class ConfigurePluginCommand implements Command {
  public readonly id = '_typescript.configurePlugin';
  public constructor(private readonly pluginMgr: PluginMgr) {}
  public execute(id: string, cfg: any) {
    this.pluginMgr.setConfig(id, cfg);
  }
}

class TypeScriptGoToProjectConfigCommand implements Command {
  public readonly id = 'typescript.goToProjectConfig';
  public constructor(private readonly activeJsTsEditorTracker: ActiveJsTsEditorTracker, private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    const e = this.activeJsTsEditorTracker.activeJsTsEditor;
    if (e) openProjectConfigForFile(ProjectType.TypeScript, this.lazyClientHost.value.serviceClient, e.document.uri);
  }
}

class JavaScriptGoToProjectConfigCommand implements Command {
  public readonly id = 'javascript.goToProjectConfig';
  public constructor(private readonly activeJsTsEditorTracker: ActiveJsTsEditorTracker, private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    const e = this.activeJsTsEditorTracker.activeJsTsEditor;
    if (e) openProjectConfigForFile(ProjectType.JavaScript, this.lazyClientHost.value.serviceClient, e.document.uri);
  }
}

class LearnMoreAboutRefactoringsCommand implements Command {
  public static readonly id = '_typescript.learnMoreAboutRefactorings';
  public readonly id = LearnMoreAboutRefactoringsCommand.id;
  public execute() {
    const u =
      qv.window.activeTextEditor && isTypeScriptDocument(qv.window.activeTextEditor.document) ? 'https://go.microsoft.com/fwlink/?linkid=2114477' : 'https://go.microsoft.com/fwlink/?linkid=2116761';
    qv.env.openExternal(qv.Uri.parse(u));
  }
}

class OpenTSServerLogCommand implements Command {
  public readonly id = 'typescript.openTSServerLog';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.serviceClient.openTSServerLogFile();
  }
}

class ReloadTypeScriptProjectsCommand implements Command {
  public readonly id = 'typescript.reloadProjects';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.reloadProjects();
  }
}

class ReloadJavaScriptProjectsCommand implements Command {
  public readonly id = 'javascript.reloadProjects';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.reloadProjects();
  }
}

class RestartTSServerCommand implements Command {
  public readonly id = 'typescript.restartTSServer';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.serviceClient.restartTSServer();
  }
}

class SelectTSVersionCommand implements Command {
  public readonly id = 'typescript.selectTSVersion';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.serviceClient.showVersionPicker();
  }
}

export function registerBaseCommands(commandMgr: CommandMgr, lazyClientHost: Lazy<TypeScriptServiceClientHost>, pluginMgr: PluginMgr, activeJsTsEditorTracker: ActiveJsTsEditorTracker): void {
  commandMgr.register(new ReloadTypeScriptProjectsCommand(lazyClientHost));
  commandMgr.register(new ReloadJavaScriptProjectsCommand(lazyClientHost));
  commandMgr.register(new SelectTSVersionCommand(lazyClientHost));
  commandMgr.register(new OpenTSServerLogCommand(lazyClientHost));
  commandMgr.register(new RestartTSServerCommand(lazyClientHost));
  commandMgr.register(new TypeScriptGoToProjectConfigCommand(activeJsTsEditorTracker, lazyClientHost));
  commandMgr.register(new JavaScriptGoToProjectConfigCommand(activeJsTsEditorTracker, lazyClientHost));
  commandMgr.register(new ConfigurePluginCommand(pluginMgr));
  commandMgr.register(new LearnMoreAboutRefactoringsCommand());
}
