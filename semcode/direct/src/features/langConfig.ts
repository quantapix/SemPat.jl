import * as qv from 'vscode';
import { Disposable } from '../utils/dispose';
import * as languageModeIds from '../utils/languageModeIds';

const jsTsLanguageConfiguration: qv.LanguageConfiguration = {
  indentationRules: {
    decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[\}\]].*$/,
    increaseIndentPattern: /^((?!\/\/).)*(\{([^}"'`]*|(\t|[ ])*\/\/.*)|\([^)"'`]*|\[[^\]"'`]*)$/,
    // e.g.  * ...| or */| or *-----*/|
    unIndentedLinePattern: /^(\t|[ ])*[ ]\*[^/]*\*\/\s*$|^(\t|[ ])*[ ]\*\/\s*$|^(\t|[ ])*[ ]\*([ ]([^\*]|\*(?!\/))*)?$/,
  },
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  onEnterRules: [
    {
      // e.g. /** | */
      beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
      afterText: /^\s*\*\/$/,
      action: { indentAction: qv.IndentAction.IndentOutdent, appendText: ' * ' },
    },
    {
      // e.g. /** ...|
      beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
      action: { indentAction: qv.IndentAction.None, appendText: ' * ' },
    },
    {
      // e.g.  * ...|
      beforeText: /^(\t|[ ])*[ ]\*([ ]([^\*]|\*(?!\/))*)?$/,
      previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/,
      action: { indentAction: qv.IndentAction.None, appendText: '* ' },
    },
    {
      // e.g.  */|
      beforeText: /^(\t|[ ])*[ ]\*\/\s*$/,
      action: { indentAction: qv.IndentAction.None, removeText: 1 },
    },
    {
      // e.g.  *-----*/|
      beforeText: /^(\t|[ ])*[ ]\*[^/]*\*\/\s*$/,
      action: { indentAction: qv.IndentAction.None, removeText: 1 },
    },
    {
      beforeText: /^\s*(\bcase\s.+:|\bdefault:)$/,
      afterText: /^(?!\s*(\bcase\b|\bdefault\b))/,
      action: { indentAction: qv.IndentAction.Indent },
    },
  ],
};

const EMPTY_ELEMENTS: string[] = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'menuitem', 'meta', 'param', 'source', 'track', 'wbr'];

const jsxTagsLanguageConfiguration: qv.LanguageConfiguration = {
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
  onEnterRules: [
    {
      beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w\\-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
      afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
      action: { indentAction: qv.IndentAction.IndentOutdent },
    },
    {
      beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w\\-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
      action: { indentAction: qv.IndentAction.Indent },
    },
    {
      beforeText: /^>$/,
      afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
      action: { indentAction: qv.IndentAction.IndentOutdent },
    },
    {
      beforeText: /^>$/,
      action: { indentAction: qv.IndentAction.Indent },
    },
  ],
};

export class LanguageConfigurationManager extends Disposable {
  constructor() {
    super();
    const standardLanguages = [languageModeIds.javascript, languageModeIds.javascriptreact, languageModeIds.typescript, languageModeIds.typescriptreact];
    for (const language of standardLanguages) {
      this.registerConfiguration(language, jsTsLanguageConfiguration);
    }

    this.registerConfiguration(languageModeIds.jsxTags, jsxTagsLanguageConfiguration);
  }

  private registerConfiguration(language: string, config: qv.LanguageConfiguration) {
    this._register(qv.languages.setLanguageConfiguration(language, config));
  }
}
