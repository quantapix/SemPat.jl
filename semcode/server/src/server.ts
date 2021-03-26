import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

const conn = createConnection(ProposedFeatures.all);
const docs: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let wsFolder: string | null;

let hasConfig: boolean = false;
let hasFolder: boolean = false;
let hasDiags: boolean = false;

conn.onInitialize((ps: InitializeParams) => {
  const cs = ps.capabilities;
  hasConfig = !!(cs.workspace && !!cs.workspace.configuration);
  hasFolder = !!(cs.workspace && !!cs.workspace.workspaceFolders);
  hasDiags = !!(cs.textDocument && cs.textDocument.publishDiagnostics && cs.textDocument.publishDiagnostics.relatedInformation);
  const y: InitializeResult = {
    capabilities: {
      //textDocumentSync: TextDocumentSyncKind.Incremental,
      textDocumentSync: { openClose: true, change: TextDocumentSyncKind.None },
      completionProvider: { resolveProvider: true },
    },
  };
  if (hasFolder) y.capabilities.workspace = { workspaceFolders: { supported: true } };
  wsFolder = ps.rootUri;
  conn.console.log(`[Server(${process.pid}) ${wsFolder}] Started and initialize received`);
  return y;
});
conn.onInitialized(() => {
  if (hasConfig) conn.client.register(DidChangeConfigurationNotification.type, undefined);
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
  let ds: Diagnostic[] = [];
  while ((m = pattern.exec(t)) && n < ss.maxNumberOfProblems) {
    n++;
    const d: Diagnostic = {
      severity: DiagnosticSeverity.Warning,
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

conn.onDidChangeWatchedFiles((_) => {
  conn.console.log('We received an file change event');
});
conn.onCompletion((_: TextDocumentPositionParams): CompletionItem[] => {
  return [
    { label: 'TypeScript', kind: CompletionItemKind.Text, data: 1 },
    { label: 'JavaScript', kind: CompletionItemKind.Text, data: 2 },
  ];
});
conn.onCompletionResolve(
  (i: CompletionItem): CompletionItem => {
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

docs.listen(conn);
conn.listen();
