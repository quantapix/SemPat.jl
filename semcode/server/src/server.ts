import * as ql from 'vscode-languageserver/node';
import { getLangModes, LangModes } from './modes';
import { TextDocument } from 'vscode-languageserver-textdocument';

const conn = ql.createConnection(ql.ProposedFeatures.all);
conn.console.info(`Server running in node ${process.version}`);

const docs: ql.TextDocuments<TextDocument> = new ql.TextDocuments(TextDocument);

let langModes: LangModes;
let wsFolder: string | null;

let hasConfig: boolean = false;
let hasFolder: boolean = false;
let hasDiags: boolean = false;

conn.onInitialize((ps: ql.InitializeParams) => {
  langModes = getLangModes();
  const cs = ps.capabilities;
  hasConfig = !!(cs.workspace && !!cs.workspace.configuration);
  hasFolder = !!(cs.workspace && !!cs.workspace.workspaceFolders);
  hasDiags = !!(cs.textDocument && cs.textDocument.publishDiagnostics && cs.textDocument.publishDiagnostics.relatedInformation);
  const y: ql.InitializeResult = {
    capabilities: {
      //textDocumentSync: ql.TextDocumentSyncKind.Incremental,
      textDocumentSync: { openClose: true, change: ql.TextDocumentSyncKind.None },
      //completionProvider: { resolveProvider: false },
      completionProvider: { resolveProvider: true },
      codeActionProvider: true,
      executeCommandProvider: { commands: ['semcode.fixMe'] },
    },
  };
  if (hasFolder) y.capabilities.workspace = { workspaceFolders: { supported: true } };
  wsFolder = ps.rootUri;
  conn.console.log(`[Server(${process.pid}) ${wsFolder}] started and initialize received`);
  return y;
});
conn.onInitialized(() => {
  if (hasConfig) conn.client.register(ql.DidChangeConfigurationNotification.type, undefined);
  if (hasFolder) {
    conn.workspace.onDidChangeWorkspaceFolders((_) => {
      conn.console.log('Workspace folder changed');
    });
  }
});

interface Settings {
  maxNumberOfProblems: number;
}

const defaultSettings: Settings = { maxNumberOfProblems: 1000 };
let globals: Settings = defaultSettings;

let docSettings: Map<string, Thenable<Settings>> = new Map();

conn.onDidChangeConfiguration((c) => {
  if (hasConfig) docSettings.clear();
  else globals = <Settings>(c.settings.languageServerExample || defaultSettings);
  docs.all().forEach(validateTextDocument);
});

function getDocumentSettings(r: string): Thenable<Settings> {
  if (!hasConfig) return Promise.resolve(globals);
  let y = docSettings.get(r);
  if (!y) {
    y = conn.workspace.getConfiguration({ scopeUri: r, section: 'languageServerExample' });
    docSettings.set(r, y);
  }
  return y;
}

docs.onDidOpen((e) => {
  conn.console.log(`[Server(${process.pid}) ${wsFolder}] Document opened: ${e.document.uri}`);
});
docs.onDidClose((e) => {
  langModes.onDocumentRemoved(e.document);
  docSettings.delete(e.document.uri);
});
docs.onDidChangeContent((c) => {
  validateTextDocument(c.document);
});

async function validateTextDocument(doc: TextDocument): Promise<void> {
  let ss = await getDocumentSettings(doc.uri);
  let t = doc.getText();
  let pattern = /\b[A-Z]{2,}\b/g;
  let m: RegExpExecArray | null;
  let n = 0;
  let ds: ql.Diagnostic[] = [];
  while ((m = pattern.exec(t)) && n < ss.maxNumberOfProblems) {
    n++;
    const d: ql.Diagnostic = {
      severity: ql.DiagnosticSeverity.Warning,
      range: { start: doc.positionAt(m.index), end: doc.positionAt(m.index + m[0].length) },
      message: `${m[0]} is all uppercase.`,
      source: 'ex',
    };
    if (hasDiags) {
      d.relatedInformation = [
        {
          location: { uri: doc.uri, range: Object.assign({}, d.range) },
          message: 'Spelling matters',
        },
        {
          location: { uri: doc.uri, range: Object.assign({}, d.range) },
          message: 'Particularly for names',
        },
      ];
    }
    ds.push(d);
  }
  conn.sendDiagnostics({ uri: doc.uri, diagnostics: ds });
}
async function validateTextDocument2(doc: TextDocument) {
  try {
    const v = doc.version;
    const ds: ql.Diagnostic[] = [];
    if (doc.languageId === 'html1') {
      const ms = langModes.getAllModesInDocument(doc);
      const d = docs.get(doc.uri);
      if (d && d.version === v) {
        ms.forEach((m) => {
          if (m.doValidation) {
            m.doValidation(d).forEach((x) => {
              ds.push(x);
            });
          }
        });
        conn.sendDiagnostics({ uri: d.uri, diagnostics: ds });
      }
    }
  } catch (e) {
    conn.console.error(`Error while validating ${doc.uri}`);
    conn.console.error(e);
  }
}
function validate(d: TextDocument): void {
  conn.sendDiagnostics({
    uri: d.uri,
    version: d.version,
    diagnostics: [ql.Diagnostic.create(ql.Range.create(0, 0, 0, 10), 'Something is wrong here', ql.DiagnosticSeverity.Warning)],
  });
}

conn.onDidChangeWatchedFiles((_) => {
  conn.console.log('We received an file change event');
});
conn.onCompletion((_: ql.TextDocumentPositionParams): ql.CompletionItem[] => {
  return [
    { label: 'TypeScript', kind: ql.CompletionItemKind.Text, data: 1 },
    { label: 'JavaScript', kind: ql.CompletionItemKind.Text, data: 2 },
  ];
});
conn.onCompletion(async (pos, tok) => {
  const d = docs.get(pos.textDocument.uri);
  if (!d) return null;
  const m = langModes.getModeAtPosition(d, pos.position);
  if (!m || !m.doComplete) return ql.CompletionList.create();
  const doComplete = m.doComplete!;
  return doComplete(d, pos.position);
});
conn.onCompletionResolve(
  (i: ql.CompletionItem): ql.CompletionItem => {
    if (i.data === 1) {
      i.detail = 'TypeScript details';
      i.documentation = 'TypeScript documentation';
    } else if (i.data === 2) {
      i.detail = 'JavaScript details';
      i.documentation = 'JavaScript documentation';
    }
    return i;
  }
);
conn.onCodeAction((ps) => {
  const d = docs.get(ps.textDocument.uri);
  if (d === undefined) return undefined;
  const t = 'With User Input';
  return [ql.CodeAction.create(t, ql.Command.create(t, 'sample.fixMe', d.uri), ql.CodeActionKind.QuickFix)];
});

conn.onExecuteCommand(async (ps) => {
  if (ps.command !== 'sample.fixMe' || ps.arguments === undefined) return;
  const d = docs.get(ps.arguments[0]);
  if (d === undefined) return;
  const newText = typeof ps.arguments[1] === 'string' ? ps.arguments[1] : 'Eclipse';
  conn.workspace.applyEdit({
    documentChanges: [ql.TextDocumentEdit.create({ uri: d.uri, version: d.version }, [ql.TextEdit.insert(ql.Position.create(0, 0), newText)])],
  });
});

conn.onShutdown(() => {
  langModes.dispose();
});

docs.listen(conn);
conn.listen();
