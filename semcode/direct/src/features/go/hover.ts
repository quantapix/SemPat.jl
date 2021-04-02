import * as qv from 'vscode';
import { CancellationToken, Hover, HoverProvider, Position, TextDocument, WorkspaceConfig } from 'vscode';
import { getGoConfig } from '../../../../old/go/config';
import { definitionLocation } from './go/definition';

export class GoHoverProvider implements HoverProvider {
  private goConfig: WorkspaceConfig | undefined;

  constructor(goConfig?: WorkspaceConfig) {
    this.goConfig = goConfig;
  }

  public provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> {
    if (!this.goConfig) {
      this.goConfig = getGoConfig(document.uri);
    }
    let goConfig = this.goConfig;
    if (goConfig['docsTool'] === 'guru') {
      goConfig = Object.assign({}, goConfig, { docsTool: 'godoc' });
    }
    return definitionLocation(document, position, goConfig, true, token).then(
      (definitionInfo) => {
        if (definitionInfo == null) {
          return null;
        }
        const lines = definitionInfo.declarationlines.filter((line) => line !== '').map((line) => line.replace(/\t/g, '    '));
        let text;
        text = lines.join('\n').replace(/\n+$/, '');
        const hoverTexts = new qv.MarkdownString();
        hoverTexts.appendCodeblock(text, 'go');
        if (definitionInfo.doc != null) {
          hoverTexts.appendMarkdown(definitionInfo.doc);
        }
        const hover = new Hover(hoverTexts);
        return hover;
      },
      () => {
        return null;
      }
    );
  }
}
