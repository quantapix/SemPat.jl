import * as qv from 'vscode';
import { Disposable } from '../utils';
import * as languageModeIds from '../utils/languageModeIds';

const jsTsLangConfig: qv.LangConfig = {
  indentationRules: {
    decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[\}\]].*$/,
    increaseIndentPattern: /^((?!\/\/).)*(\{([^}"'`]*|(\t|[ ])*\/\/.*)|\([^)"'`]*|\[[^\]"'`]*)$/,

    unIndentedLinePattern: /^(\t|[ ])*[ ]\*[^/]*\*\/\s*$|^(\t|[ ])*[ ]\*\/\s*$|^(\t|[ ])*[ ]\*([ ]([^\*]|\*(?!\/))*)?$/,
  },
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  onEnterRules: [
    {
      beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
      afterText: /^\s*\*\/$/,
      action: { indentAction: qv.IndentAction.IndentOutdent, appendText: ' * ' },
    },
    {
      beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
      action: { indentAction: qv.IndentAction.None, appendText: ' * ' },
    },
    {
      beforeText: /^(\t|[ ])*[ ]\*([ ]([^\*]|\*(?!\/))*)?$/,
      previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/,
      action: { indentAction: qv.IndentAction.None, appendText: '* ' },
    },
    {
      beforeText: /^(\t|[ ])*[ ]\*\/\s*$/,
      action: { indentAction: qv.IndentAction.None, removeText: 1 },
    },
    {
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

const jsxTagsLangConfig: qv.LangConfig = {
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

export class LangConfigMgr extends Disposable {
  constructor() {
    super();
    const standardLangs = [languageModeIds.javascript, languageModeIds.javascriptreact, languageModeIds.typescript, languageModeIds.typescriptreact];
    for (const language of standardLangs) {
      this.registerConfig(language, jsTsLangConfig);
    }

    this.registerConfig(languageModeIds.jsxTags, jsxTagsLangConfig);
  }

  private registerConfig(language: string, config: qv.LangConfig) {
    this._register(qv.languages.setLangConfig(language, config));
  }
}
