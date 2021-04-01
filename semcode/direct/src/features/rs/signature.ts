import * as qv from 'vscode';
import { HoverRequest, LanguageClient } from 'vscode-languageclient';

export class SignatureHelpProvider implements qv.SignatureHelpProvider {
  private languageClient: LanguageClient;
  private previousFunctionPosition?: qv.Position;

  constructor(lc: LanguageClient) {
    this.languageClient = lc;
  }

  public provideSignatureHelp(document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken, context: qv.SignatureHelpContext): qv.ProviderResult<qv.SignatureHelp> {
    if (context.triggerCharacter === '(') {
      this.previousFunctionPosition = position;
      return this.provideHover(this.languageClient, document, position, token).then((hover) => this.hoverToSignatureHelp(hover, position, document));
    } else if (context.triggerCharacter === ',') {
      if (this.previousFunctionPosition && position.line === this.previousFunctionPosition.line) {
        return this.provideHover(this.languageClient, document, this.previousFunctionPosition, token).then((hover) => this.hoverToSignatureHelp(hover, position, document));
      } else {
        return null;
      }
    } else {
      if (context.isRetrigger === false) {
        this.previousFunctionPosition = undefined;
      }
      return null;
    }
  }

  private provideHover(lc: LanguageClient, document: qv.TextDocument, position: qv.Position, token: qv.CancellationToken): Promise<qv.Hover> {
    return new Promise((resolve, reject) => {
      lc.sendRequest(HoverRequest.type, lc.code2ProtocolConverter.asTextDocumentPositionParams(document, position.translate(0, -1)), token).then(
        (data) => resolve(lc.protocol2CodeConverter.asHover(data)),
        (error) => reject(error)
      );
    });
  }

  private hoverToSignatureHelp(hover: qv.Hover, position: qv.Position, document: qv.TextDocument): qv.SignatureHelp | undefined {
    /*
    The contents of a hover result has the following structure:
    contents:Array[2]
        0:Object
            value:"
            ```rust
            pub fn write(output: &mut dyn Write, args: Arguments) -> Result
            ```
            "
        1:Object
            value:"The `write` function takes an output stream, and an `Arguments` struct
            that can be precompiled with the `format_args!` macro.
            The arguments will be formatted according to the specified format string
            into the output stream provided.
            # Examples
    RLS uses the function below to create the tooltip contents shown above:
    fn create_tooltip(
        the_type: String,
        doc_url: Option<String>,
        context: Option<String>,
        docs: Option<String>,
    ) -> Vec<MarkedString> {}
    This means the first object is the type - function signature,
    but for the following, there is no way of certainly knowing which is the
    function documentation that we want to display in the tooltip.

    Assuming the context is never populated for a function definition (this might be wrong
    and needs further validation, but initial tests show it to hold true in most cases), and
    we also assume that most functions contain rather documentation, than just a URL without
    any inline documentation, we check the length of contents, and we assume that if there are:
        - two objects, they are the signature and docs, and docs is contents[1]
        - three objects, they are the signature, URL and docs, and docs is contents[2]
        - four objects -- all of them,  docs is contents[3]
    See https://github.com/rust-lang/rls/blob/master/rls/src/actions/hover.rs#L487-L508.
    */

    const label = (hover.contents[0] as qv.MarkdownString).value.replace('```rust', '').replace('```', '');

    if (!label.includes('fn') || document.lineAt(position.line).text.includes('fn ')) {
      return undefined;
    }

    const doc = hover.contents.length > 1 ? (hover.contents.slice(-1)[0] as qv.MarkdownString) : undefined;
    const si = new qv.SignatureInformation(label, doc);

    si.parameters = [];

    const sh = new qv.SignatureHelp();
    sh.signatures[0] = si;
    sh.activeSignature = 0;

    return sh;
  }
}
