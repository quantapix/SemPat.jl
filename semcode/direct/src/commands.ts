import TypeScriptServiceClientHost from '../typeScriptServiceClientHost';
import { ActiveJsTsEditorTracker } from './utils/activeJsTsEditorTracker';
import { Lazy } from '../utils/lazy';
import { PluginManager } from './utils/plugins';
import * as qv from 'vscode';
import { openProjectConfigForFile, ProjectType } from './utils/tsconfig';
import { isTypeScriptDocument } from './utils/languageModeIds';

export interface Command {
  readonly id: string | string[];
  execute(...xs: any[]): void;
}

export class CommandManager {
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
  public constructor(private readonly pluginManager: PluginManager) {}
  public execute(id: string, cfg: any) {
    this.pluginManager.setConfiguration(id, cfg);
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

class OpenTsServerLogCommand implements Command {
  public readonly id = 'typescript.openTsServerLog';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.serviceClient.openTsServerLogFile();
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

class RestartTsServerCommand implements Command {
  public readonly id = 'typescript.restartTsServer';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.serviceClient.restartTsServer();
  }
}

class SelectTypeScriptVersionCommand implements Command {
  public readonly id = 'typescript.selectTypeScriptVersion';
  public constructor(private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>) {}
  public execute() {
    this.lazyClientHost.value.serviceClient.showVersionPicker();
  }
}

export function registerBaseCommands(
  commandManager: CommandManager,
  lazyClientHost: Lazy<TypeScriptServiceClientHost>,
  pluginManager: PluginManager,
  activeJsTsEditorTracker: ActiveJsTsEditorTracker
): void {
  commandManager.register(new ReloadTypeScriptProjectsCommand(lazyClientHost));
  commandManager.register(new ReloadJavaScriptProjectsCommand(lazyClientHost));
  commandManager.register(new SelectTypeScriptVersionCommand(lazyClientHost));
  commandManager.register(new OpenTsServerLogCommand(lazyClientHost));
  commandManager.register(new RestartTsServerCommand(lazyClientHost));
  commandManager.register(new TypeScriptGoToProjectConfigCommand(activeJsTsEditorTracker, lazyClientHost));
  commandManager.register(new JavaScriptGoToProjectConfigCommand(activeJsTsEditorTracker, lazyClientHost));
  commandManager.register(new ConfigurePluginCommand(pluginManager));
  commandManager.register(new LearnMoreAboutRefactoringsCommand());
}
