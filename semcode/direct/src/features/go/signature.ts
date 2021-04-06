import { CancellationToken, ParameterInformation, Position, SignatureHelp, SignatureHelpProvider, SignatureInformation, TextDocument, WorkspaceConfig } from 'vscode';
import { getGoConfig } from './config';
import { definitionLocation } from './go/definition';
import { getParametersAndReturnType, isPositionInComment, isPositionInString } from './util';
export class GoSignatureHelpProvider implements SignatureHelpProvider {
  constructor(private goConfig?: WorkspaceConfig) {}
  public async provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp> {
    let goConfig = this.goConfig || getGoConfig(document.uri);
    const theCall = this.walkBackwardsToBeginningOfCall(document, position);
    if (theCall == null) {
      return Promise.resolve(null);
    }
    const callerPos = this.previousTokenPosition(document, theCall.openParen);
    if (goConfig['docsTool'] === 'guru') {
      goConfig = Object.assign({}, goConfig, { docsTool: 'godoc' });
    }
    try {
      const res = await definitionLocation(document, callerPos, goConfig, true, token);
      if (!res) {
        return null;
      }
      if (res.line === callerPos.line) {
        return null;
      }
      let declarationText: string = (res.declarationlines || []).join(' ').trim();
      if (!declarationText) {
        return null;
      }
      const result = new SignatureHelp();
      let sig: string;
      let si: SignatureInformation;
      if (res.toolUsed === 'godef') {
        const nameEnd = declarationText.indexOf(' ');
        const sigStart = nameEnd + 5; // ' func'
        const funcName = declarationText.substring(0, nameEnd);
        sig = declarationText.substring(sigStart);
        si = new SignatureInformation(funcName + sig, res.doc);
      } else if (res.toolUsed === 'gogetdoc') {
        declarationText = declarationText.substring(5);
        const funcNameStart = declarationText.indexOf(res.name + '('); // Find 'functionname(' to remove anything before it
        if (funcNameStart > 0) {
          declarationText = declarationText.substring(funcNameStart);
        }
        si = new SignatureInformation(declarationText, res.doc);
        sig = declarationText.substring(res.name.length);
      }
      si.parameters = getParametersAndReturnType(sig).params.map((paramText) => new ParameterInformation(paramText));
      result.signatures = [si];
      result.activeSignature = 0;
      result.activeParameter = Math.min(theCall.commas.length, si.parameters.length - 1);
      return result;
    } catch (e) {
      return null;
    }
  }
  private previousTokenPosition(document: TextDocument, position: Position): Position {
    while (position.character > 0) {
      const word = document.getWordRangeAtPosition(position);
      if (word) {
        return word.start;
      }
      position = position.translate(0, -1);
    }
    return null;
  }
  private walkBackwardsToBeginningOfCall(document: TextDocument, position: Position): { openParen: Position; commas: Position[] } | null {
    let parenBalance = 0;
    let maxLookupLines = 30;
    const commas = [];
    for (let lineNr = position.line; lineNr >= 0 && maxLookupLines >= 0; lineNr--, maxLookupLines--) {
      const line = document.lineAt(lineNr);
      if (isPositionInComment(document, position)) {
        return null;
      }
      const [currentLine, characterPosition] = lineNr === position.line ? [line.text.substring(0, position.character), position.character] : [line.text, line.text.length - 1];
      for (let char = characterPosition; char >= 0; char--) {
        switch (currentLine[char]) {
          case '(':
            parenBalance--;
            if (parenBalance < 0) {
              return {
                openParen: new Position(lineNr, char),
                commas,
              };
            }
            break;
          case ')':
            parenBalance++;
            break;
          case ',':
            {
              const commaPos = new Position(lineNr, char);
              if (parenBalance === 0 && !isPositionInString(document, commaPos)) {
                commas.push(commaPos);
              }
            }
            break;
        }
      }
    }
    return null;
  }
}
