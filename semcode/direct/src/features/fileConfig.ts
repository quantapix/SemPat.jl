import * as qv from 'vscode';
import type * as qp from '../protocol';
import { ServiceClient } from '../service';
import API from '../utils/api';
import { Disposable } from '../utils';
import * as fileSchemes from '../utils/fileSchemes';
import { isTypeScriptDocument } from '../utils/languageModeIds';
import { equals } from '../utils/objects';
import { ResourceMap } from '../utils/resourceMap';

interface FileConfig {
  readonly formatOptions: qp.FormatCodeSettings;
  readonly preferences: qp.UserPreferences;
}

function areFileConfigsEqual(a: FileConfig, b: FileConfig): boolean {
  return equals(a, b);
}

export default class FileConfigMgr extends Disposable {
  private readonly formatOptions: ResourceMap<Promise<FileConfig | undefined>>;

  public constructor(private readonly client: ServiceClient, onCaseInsenitiveFileSystem: boolean) {
    super();
    this.formatOptions = new ResourceMap(undefined, { onCaseInsenitiveFileSystem });
    qv.workspace.onDidCloseTextDocument(
      (textDocument) => {
        this.formatOptions.delete(textDocument.uri);
      },
      undefined,
      this._disposables
    );
  }

  public async ensureConfigForDocument(document: qv.TextDocument, token: qv.CancellationToken): Promise<void> {
    const formattingOptions = this.getFormattingOptions(document);
    if (formattingOptions) {
      return this.ensureConfigOptions(document, formattingOptions, token);
    }
  }

  private getFormattingOptions(document: qv.TextDocument): qv.FormattingOptions | undefined {
    const editor = qv.window.visibleTextEditors.find((editor) => editor.document.fileName === document.fileName);
    return editor
      ? ({
          tabSize: editor.options.tabSize,
          insertSpaces: editor.options.insertSpaces,
        } as qv.FormattingOptions)
      : undefined;
  }

  public async ensureConfigOptions(document: qv.TextDocument, options: qv.FormattingOptions, token: qv.CancellationToken): Promise<void> {
    const file = this.client.toOpenedFilePath(document);
    if (!file) {
      return;
    }

    const currentOptions = this.getFileOptions(document, options);
    const cachedOptions = this.formatOptions.get(document.uri);
    if (cachedOptions) {
      const cachedOptionsValue = await cachedOptions;
      if (cachedOptionsValue && areFileConfigsEqual(cachedOptionsValue, currentOptions)) {
        return;
      }
    }

    let resolve: (x: FileConfig | undefined) => void;
    this.formatOptions.set(document.uri, new Promise<FileConfig | undefined>((r) => (resolve = r)));

    const args: qp.ConfigureRequestArguments = {
      file,
      ...currentOptions,
    };
    try {
      const response = await this.client.execute('configure', args, token);
      resolve!(response.type === 'response' ? currentOptions : undefined);
    } finally {
      resolve!(undefined);
    }
  }

  public async setGlobalConfigFromDocument(document: qv.TextDocument, token: qv.CancellationToken): Promise<void> {
    const formattingOptions = this.getFormattingOptions(document);
    if (!formattingOptions) {
      return;
    }

    const args: qp.ConfigureRequestArguments = {
      file: undefined /*global*/,
      ...this.getFileOptions(document, formattingOptions),
    };
    await this.client.execute('configure', args, token);
  }

  public reset() {
    this.formatOptions.clear();
  }

  private getFileOptions(document: qv.TextDocument, options: qv.FormattingOptions): FileConfig {
    return {
      formatOptions: this.getFormatOptions(document, options),
      preferences: this.getPreferences(document),
    };
  }

  private getFormatOptions(document: qv.TextDocument, options: qv.FormattingOptions): qp.FormatCodeSettings {
    const config = qv.workspace.getConfig(isTypeScriptDocument(document) ? 'typescript.format' : 'javascript.format', document.uri);

    return {
      tabSize: options.tabSize,
      indentSize: options.tabSize,
      convertTabsToSpaces: options.insertSpaces,

      newLineCharacter: '\n',
      insertSpaceAfterCommaDelimiter: config.get<boolean>('insertSpaceAfterCommaDelimiter'),
      insertSpaceAfterConstructor: config.get<boolean>('insertSpaceAfterConstructor'),
      insertSpaceAfterSemicolonInForStatements: config.get<boolean>('insertSpaceAfterSemicolonInForStatements'),
      insertSpaceBeforeAndAfterBinaryOperators: config.get<boolean>('insertSpaceBeforeAndAfterBinaryOperators'),
      insertSpaceAfterKeywordsInControlFlowStatements: config.get<boolean>('insertSpaceAfterKeywordsInControlFlowStatements'),
      insertSpaceAfterFunctionKeywordForAnonymousFunctions: config.get<boolean>('insertSpaceAfterFunctionKeywordForAnonymousFunctions'),
      insertSpaceBeforeFunctionParenthesis: config.get<boolean>('insertSpaceBeforeFunctionParenthesis'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces'),
      insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingEmptyBraces'),
      insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces'),
      insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: config.get<boolean>('insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces'),
      insertSpaceAfterTypeAssertion: config.get<boolean>('insertSpaceAfterTypeAssertion'),
      placeOpenBraceOnNewLineForFunctions: config.get<boolean>('placeOpenBraceOnNewLineForFunctions'),
      placeOpenBraceOnNewLineForControlBlocks: config.get<boolean>('placeOpenBraceOnNewLineForControlBlocks'),
      semicolons: config.get<qp.SemicolonPreference>('semicolons'),
    };
  }

  private getPreferences(document: qv.TextDocument): qp.UserPreferences {
    if (this.client.apiVersion.lt(API.v290)) {
      return {};
    }

    const config = qv.workspace.getConfig(isTypeScriptDocument(document) ? 'typescript' : 'javascript', document.uri);

    const preferencesConfig = qv.workspace.getConfig(isTypeScriptDocument(document) ? 'typescript.preferences' : 'javascript.preferences', document.uri);

    const preferences: qp.UserPreferences = {
      quotePreference: this.getQuoteStylePreference(preferencesConfig),
      importModuleSpecifierPreference: getImportModuleSpecifierPreference(preferencesConfig),
      importModuleSpecifierEnding: getImportModuleSpecifierEndingPreference(preferencesConfig),
      allowTextChangesInNewFiles: document.uri.scheme === fileSchemes.file,
      providePrefixAndSuffixTextForRename: preferencesConfig.get<boolean>('renameShorthandProperties', true) === false ? false : preferencesConfig.get<boolean>('useAliasesForRenames', true),
      allowRenameOfImportPath: true,
      includeAutomaticOptionalChainCompletions: config.get<boolean>('suggest.includeAutomaticOptionalChainCompletions', true),
      provideRefactorNotApplicableReason: true,
      generateReturnInDocTemplate: config.get<boolean>('suggest.jsdoc.generateReturns', true),
    };

    return preferences;
  }

  private getQuoteStylePreference(config: qv.WorkspaceConfig) {
    switch (config.get<string>('quoteStyle')) {
      case 'single':
        return 'single';
      case 'double':
        return 'double';
      default:
        return this.client.apiVersion.gte(API.v333) ? 'auto' : undefined;
    }
  }
}

function getImportModuleSpecifierPreference(config: qv.WorkspaceConfig) {
  switch (config.get<string>('importModuleSpecifier')) {
    case 'project-relative':
      return 'project-relative';
    case 'relative':
      return 'relative';
    case 'non-relative':
      return 'non-relative';
    default:
      return undefined;
  }
}

function getImportModuleSpecifierEndingPreference(config: qv.WorkspaceConfig) {
  switch (config.get<string>('importModuleSpecifierEnding')) {
    case 'minimal':
      return 'minimal';
    case 'index':
      return 'index';
    case 'js':
      return 'js';
    default:
      return 'auto';
  }
}
