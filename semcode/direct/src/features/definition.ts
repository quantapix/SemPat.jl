import { ClientCap, ServiceClient } from '../service';
import { condRegistration, requireSomeCap } from '../registration';
import * as qu from '../utils';
import * as qv from 'vscode';
import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { DeclarationType, isFunctionDeclaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { isOverloadedFunction } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { isDefined } from '../common/core';
import { convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position, rangesAreEqual } from '../common/textRange';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import cp = require('child_process');
import * as path from 'path';
import { getGoConfig } from '../config';
import { toolExecutionEnvironment } from '../goEnv';
import { promptForMissingTool, promptForUpdatingTool } from '../goInstallTools';
import { getModFolderPath, promptToUpdateToolForModules } from '../goModules';
import { byteOffsetAt, getBinPath, getFileArchive, getModuleCache, getWorkspaceFolderPath, goKeywords, isPositionInString, runGodoc } from '../util';
import { getCurrentGoRoot } from './utils/pathUtils';
import { killProcTree } from './utils/processUtils';
import { adjustWordPosition, definitionLocation, parseMissingError } from './go/definition';
import { canonicalizeGOPATHPrefix, goBuiltinTypes } from '../../../../old/go/util';
class TsBase {
  constructor(protected readonly client: ServiceClient) {}
  protected async getSymbolLocations(k: 'definition' | 'implementation' | 'typeDefinition', d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Location[] | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute(k, xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    return v.body.map((l) => qu.Location.fromTextSpan(this.client.toResource(l.file), l));
  }
}
class TsDefinition extends TsBase implements qv.DefinitionProvider {
  constructor(c: ServiceClient) {
    super(c);
  }
  public async provideDefinition(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.DefinitionLink[] | qv.Definition | undefined> {
    const f = this.client.toOpenedFilePath(d);
    if (!f) return undefined;
    const xs = qu.Position.toFileLocationRequestArgs(f, p);
    const v = await this.client.execute('definitionAndBoundSpan', xs, t);
    if (v.type !== 'response' || !v.body) return undefined;
    const s = v.body.textSpan ? qu.Range.fromTextSpan(v.body.textSpan) : undefined;
    return v.body.definitions.map(
      (l): qv.DefinitionLink => {
        const target = qu.Location.fromTextSpan(this.client.toResource(l.file), l);
        if (l.contextStart && l.contextEnd) {
          return {
            originSelectionRange: s,
            targetRange: qu.Range.fromLocations(l.contextStart, l.contextEnd),
            targetUri: target.uri,
            targetSelectionRange: target.range,
          };
        }
        return {
          originSelectionRange: s,
          targetRange: target.range,
          targetUri: target.uri,
        };
      }
    );
  }
}
class TypeDefinition extends TsBase implements qv.TypeDefinitionProvider {
  public provideTypeDefinition(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Definition | undefined> {
    return this.getSymbolLocations('typeDefinition', d, p, t);
  }
}
class Implementation extends TsBase implements qv.ImplementationProvider {
  public provideImplementation(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Promise<qv.Definition | undefined> {
    return this.getSymbolLocations('implementation', d, p, t);
  }
}
export function register(s: qu.DocumentSelector, c: ServiceClient) {
  return [
    condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
      return qv.languages.registerDefinitionProvider(s.syntax, new TsDefinition(c));
    }),
    condRegistration([requireSomeCap(c, ClientCap.EnhancedSyntax, ClientCap.Semantic)], () => {
      return qv.languages.registerTypeDefinitionProvider(s.syntax, new TypeDefinition(c));
    }),
    condRegistration([requireSomeCap(c, ClientCap.Semantic)], () => {
      return qv.languages.registerImplementationProvider(s.semantic, new Implementation(c));
    }),
  ];
}
export enum DefinitionFilter {
  All = 'all',
  PreferSource = 'preferSource',
  PreferStubs = 'preferStubs',
}
export class PyDefinition {
  static getDefinitionsForPosition(
    sourceMapper: SourceMapper,
    parseResults: ParseResults,
    position: Position,
    filter: DefinitionFilter,
    evaluator: TypeEvaluator,
    token: qv.CancellationToken
  ): DocumentRange[] | undefined {
    throwIfCancellationRequested(token);
    const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
    if (offset === undefined) return undefined;
    const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
    if (node === undefined) return undefined;
    const definitions: DocumentRange[] = [];
    if (node.nodeType === ParseNodeType.Name) {
      const declarations = evaluator.getDeclarationsForNameNode(node);
      if (declarations) {
        declarations.forEach((decl) => {
          let resolvedDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
          if (resolvedDecl && resolvedDecl.path) {
            if (resolvedDecl.type === DeclarationType.Alias && resolvedDecl.isUnresolved) return;
            if (resolvedDecl.type === DeclarationType.Alias && resolvedDecl.symbolName && resolvedDecl.submoduleFallback && resolvedDecl.submoduleFallback.path)
              resolvedDecl = resolvedDecl.submoduleFallback;
            this._addIfUnique(definitions, {
              path: resolvedDecl.path,
              range: resolvedDecl.range,
            });
            if (isFunctionDeclaration(resolvedDecl)) {
              const functionType = evaluator.getTypeForDeclaration(resolvedDecl);
              if (functionType && isOverloadedFunction(functionType)) {
                for (const overloadDecl of functionType.overloads.map((o) => o.details.declaration).filter(isDefined)) {
                  this._addIfUnique(definitions, {
                    path: overloadDecl.path,
                    range: overloadDecl.range,
                  });
                }
              }
            }
            if (isStubFile(resolvedDecl.path)) {
              if (resolvedDecl.type === DeclarationType.Alias) {
                sourceMapper
                  .findModules(resolvedDecl.path)
                  .map((m) => getFileInfo(m)?.filePath)
                  .filter(isDefined)
                  .forEach((f) => this._addIfUnique(definitions, this._createModuleEntry(f)));
              } else {
                const implDecls = sourceMapper.findDeclarations(resolvedDecl);
                for (const implDecl of implDecls) {
                  if (implDecl && implDecl.path) this._addIfUnique(definitions, { path: implDecl.path, range: implDecl.range });
                }
              }
            }
          }
        });
      }
    }
    if (definitions.length === 0) return undefined;
    if (filter === DefinitionFilter.All) return definitions;
    const preferStubs = filter === DefinitionFilter.PreferStubs;
    const wantedFile = (v: DocumentRange) => preferStubs === isStubFile(v.path);
    if (definitions.find(wantedFile)) {
      return definitions.filter(wantedFile);
    }
    return definitions;
  }
  private static _createModuleEntry(filePath: string): DocumentRange {
    return {
      path: filePath,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    };
  }
  private static _addIfUnique(definitions: DocumentRange[], itemToAdd: DocumentRange) {
    for (const def of definitions) {
      if (def.path === itemToAdd.path && rangesAreEqual(def.range, itemToAdd.range)) return;
    }
    definitions.push(itemToAdd);
  }
}
const missingToolMsg = 'Missing tool: ';
export interface GoDefinitionInformation {
  file: string;
  line: number;
  column: number;
  doc: string;
  declarationlines: string[];
  name: string;
  toolUsed: string;
}
interface GoDefinitionInput {
  doc: qv.TextDocument;
  pos: qv.Position;
  word: string;
  includeDocs: boolean;
  isMod: boolean;
  cwd: string;
}
interface GoGetDocOuput {
  name: string;
  import: string;
  decl: string;
  doc: string;
  pos: string;
}
interface GuruDefinitionOuput {
  objpos: string;
  desc: string;
}
export function definitionLocation(d: qv.TextDocument, p: qv.Position, goConfig: qv.WorkspaceConfiguration, includeDocs: boolean, t: qv.CancellationToken): Promise<GoDefinitionInformation> {
  const adjustedPos = adjustWordPosition(d, p);
  if (!adjustedPos[0]) return Promise.resolve(null);
  const word = adjustedPos[1];
  p = adjustedPos[2];
  if (!goConfig) goConfig = getGoConfig(d.uri);
  const toolForDocs = goConfig['docsTool'] || 'godoc';
  return getModFolderPath(d.uri).then((modFolderPath) => {
    const input: GoDefinitionInput = {
      doc: d,
      pos: p,
      word,
      includeDocs,
      isMod: !!modFolderPath,
      cwd: modFolderPath && modFolderPath !== getModuleCache() ? modFolderPath : getWorkspaceFolderPath(d.uri) || path.dirname(d.fileName),
    };
    if (toolForDocs === 'godoc') return definitionLocation_godef(input, t);
    else if (toolForDocs === 'guru') return definitionLocation_guru(input, t);
    return definitionLocation_gogetdoc(input, t, true);
  });
}
export function adjustWordPosition(d: qv.TextDocument, p: qv.Position): [boolean, string, qv.Position] {
  const wordRange = d.getWordRangeAtPosition(p);
  const lineText = d.lineAt(p.line).text;
  const word = wordRange ? d.getText(wordRange) : '';
  if (!wordRange || lineText.startsWith('//') || isPositionInString(d, p) || word.match(/^\d+.?\d+$/) || goKeywords.indexOf(word) > 0) {
    return [false, null, null];
  }
  if (p.isEqual(wordRange.end) && p.isAfter(wordRange.start)) {
    p = p.translate(0, -1);
  }
  return [true, word, p];
}
const godefImportDefinitionRegex = /^import \(.* ".*"\)$/;
function definitionLocation_godef(input: GoDefinitionInput, token: qv.CancellationToken, useReceivers = true): Promise<GoDefinitionInformation> {
  const godefTool = 'godef';
  const godefPath = getBinPath(godefTool);
  if (!path.isAbsolute(godefPath)) {
    return Promise.reject(missingToolMsg + godefTool);
  }
  const offset = byteOffsetAt(input.doc, input.pos);
  const env = toolExecutionEnvironment();
  env['GOROOT'] = getCurrentGoRoot();
  let p: cp.ChildProc;
  if (token) token.onCancellationRequested(() => killProcTree(p));
  return new Promise<GoDefinitionInformation>((resolve, reject) => {
    const args = ['-t', '-i', '-f', input.doc.fileName, '-o', offset.toString()];
    p = cp.execFile(godefPath, args, { env, cwd: input.cwd }, (err, stdout, stderr) => {
      try {
        if (err && (<any>err).code === 'ENOENT') {
          return reject(missingToolMsg + godefTool);
        }
        if (err) {
          if (input.isMod && !input.includeDocs && stderr && stderr.startsWith('godef: no declaration found for')) {
            promptToUpdateToolForModules('godef', 'To get the Go to Definition feature when using Go modules, please update your version of the "godef" tool.');
            return reject(stderr);
          }
          if (stderr.indexOf('flag provided but not defined: -r') !== -1) {
            promptForUpdatingTool('godef');
            p = null;
            return definitionLocation_godef(input, token, false).then(resolve, reject);
          }
          return reject(err.message || stderr);
        }
        const result = stdout.toString();
        const lines = result.split('\n');
        let match = /(.*):(\d+):(\d+)/.exec(lines[0]);
        if (!match) return resolve(null);
        const [, file, line, col] = match;
        const pkgPath = path.dirname(file);
        const definitionInformation: GoDefinitionInformation = {
          file,
          line: +line - 1,
          column: +col - 1,
          declarationlines: lines.slice(1),
          toolUsed: 'godef',
          doc: null,
          name: null,
        };
        if (!input.includeDocs || godefImportDefinitionRegex.test(definitionInformation.declarationlines[0])) {
          return resolve(definitionInformation);
        }
        match = /^\w+ \(\*?(\w+)\)/.exec(lines[1]);
        runGodoc(input.cwd, pkgPath, match ? match[1] : '', input.word, token)
          .then((doc) => {
            if (doc) definitionInformation.doc = doc;
            resolve(definitionInformation);
          })
          .catch((runGoDocErr) => {
            console.log(runGoDocErr);
            resolve(definitionInformation);
          });
      } catch (e) {
        reject(e);
      }
    });
    if (p.pid) p.stdin.end(input.doc.getText());
  });
}
function definitionLocation_gogetdoc(input: GoDefinitionInput, token: qv.CancellationToken, useTags: boolean): Promise<GoDefinitionInformation> {
  const gogetdoc = getBinPath('gogetdoc');
  if (!path.isAbsolute(gogetdoc)) {
    return Promise.reject(missingToolMsg + 'gogetdoc');
  }
  const offset = byteOffsetAt(input.doc, input.pos);
  const env = toolExecutionEnvironment();
  let p: cp.ChildProc;
  if (token) token.onCancellationRequested(() => killProcTree(p));
  return new Promise<GoDefinitionInformation>((resolve, reject) => {
    const gogetdocFlagsWithoutTags = ['-u', '-json', '-modified', '-pos', input.doc.fileName + ':#' + offset.toString()];
    const buildTags = getGoConfig(input.doc.uri)['buildTags'];
    const gogetdocFlags = buildTags && useTags ? [...gogetdocFlagsWithoutTags, '-tags', buildTags] : gogetdocFlagsWithoutTags;
    p = cp.execFile(gogetdoc, gogetdocFlags, { env, cwd: input.cwd }, (err, stdout, stderr) => {
      try {
        if (err && (<any>err).code === 'ENOENT') {
          return reject(missingToolMsg + 'gogetdoc');
        }
        if (stderr && stderr.startsWith('flag provided but not defined: -tags')) {
          p = null;
          return definitionLocation_gogetdoc(input, token, false).then(resolve, reject);
        }
        if (err) {
          if (input.isMod && !input.includeDocs && stdout.startsWith("gogetdoc: couldn't get package for")) {
            promptToUpdateToolForModules('gogetdoc', 'To get the Go to Definition feature when using Go modules, please update your version of the "gogetdoc" tool.');
            return resolve(null);
          }
          return reject(err.message || stderr);
        }
        const goGetDocOutput = <GoGetDocOuput>JSON.parse(stdout.toString());
        const match = /(.*):(\d+):(\d+)/.exec(goGetDocOutput.pos);
        const definitionInfo: GoDefinitionInformation = {
          file: null,
          line: 0,
          column: 0,
          toolUsed: 'gogetdoc',
          declarationlines: goGetDocOutput.decl.split('\n'),
          doc: goGetDocOutput.doc,
          name: goGetDocOutput.name,
        };
        if (!match) return resolve(definitionInfo);
        definitionInfo.file = match[1];
        definitionInfo.line = +match[2] - 1;
        definitionInfo.column = +match[3] - 1;
        return resolve(definitionInfo);
      } catch (e) {
        reject(e);
      }
    });
    if (p.pid) p.stdin.end(getFileArchive(input.doc));
  });
}
function definitionLocation_guru(input: GoDefinitionInput, token: qv.CancellationToken): Promise<GoDefinitionInformation> {
  const guru = getBinPath('guru');
  if (!path.isAbsolute(guru)) {
    return Promise.reject(missingToolMsg + 'guru');
  }
  const offset = byteOffsetAt(input.doc, input.pos);
  const env = toolExecutionEnvironment();
  let p: cp.ChildProc;
  if (token) token.onCancellationRequested(() => killProcTree(p));
  return new Promise<GoDefinitionInformation>((resolve, reject) => {
    p = cp.execFile(guru, ['-json', '-modified', 'definition', input.doc.fileName + ':#' + offset.toString()], { env }, (err, stdout, stderr) => {
      try {
        if (err && (<any>err).code === 'ENOENT') {
          return reject(missingToolMsg + 'guru');
        }
        if (err) return reject(err.message || stderr);
        const guruOutput = <GuruDefinitionOuput>JSON.parse(stdout.toString());
        const match = /(.*):(\d+):(\d+)/.exec(guruOutput.objpos);
        const definitionInfo: GoDefinitionInformation = {
          file: null,
          line: 0,
          column: 0,
          toolUsed: 'guru',
          declarationlines: [guruOutput.desc],
          doc: null,
          name: null,
        };
        if (!match) return resolve(definitionInfo);
        definitionInfo.file = match[1];
        definitionInfo.line = +match[2] - 1;
        definitionInfo.column = +match[3] - 1;
        return resolve(definitionInfo);
      } catch (e) {
        reject(e);
      }
    });
    if (p.pid) p.stdin.end(getFileArchive(input.doc));
  });
}
export function parseMissingError(err: any): [boolean, string] {
  if (err) {
    if (typeof err === 'string' && err.startsWith(missingToolMsg)) return [true, err.substr(missingToolMsg.length)];
  }
  return [false, null];
}
export class GoDefinition implements qv.DefinitionProvider {
  private goConfig: qv.WorkspaceConfiguration = null;
  constructor(goConfig?: qv.WorkspaceConfiguration) {
    this.goConfig = goConfig;
  }
  public provideDefinition(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): Thenable<qv.Location> {
    return definitionLocation(d, p, this.goConfig, false, t).then(
      (definitionInfo) => {
        if (definitionInfo === null || definitionInfo.file === null) return null;
        const definitionResource = qv.Uri.file(definitionInfo.file);
        const pos = new qv.Position(definitionInfo.line, definitionInfo.column);
        return new qv.Location(definitionResource, pos);
      },
      (err) => {
        const miss = parseMissingError(err);
        if (miss[0]) promptForMissingTool(miss[1]);
        else if (err) return Promise.reject(err);
        return Promise.resolve(null);
      }
    );
  }
}
interface GuruDescribeOutput {
  desc: string;
  pos: string;
  detail: string;
  value: GuruDescribeValueOutput;
}
interface GuruDescribeValueOutput {
  type: string;
  value: string;
  objpos: string;
  typespos: GuruDefinitionOutput[];
}
interface GuruDefinitionOutput {
  objpos: string;
  desc: string;
}
export class GoTypeDefinition implements qv.TypeDefinitionProvider {
  public provideTypeDefinition(d: qv.TextDocument, p: qv.Position, t: qv.CancellationToken): qv.ProviderResult<qv.Definition> {
    const adjustedPos = adjustWordPosition(d, p);
    if (!adjustedPos[0]) return Promise.resolve(null);
    p = adjustedPos[2];
    return new Promise<qv.Definition>((resolve, reject) => {
      const goGuru = getBinPath('guru');
      if (!path.isAbsolute(goGuru)) {
        promptForMissingTool('guru');
        return reject('Cannot find tool "guru" to find type definitions.');
      }
      const filename = canonicalizeGOPATHPrefix(d.fileName);
      const offset = byteOffsetAt(d, p);
      const env = toolExecutionEnvironment();
      const buildTags = getGoConfig(d.uri)['buildTags'];
      const args = buildTags ? ['-tags', buildTags] : [];
      args.push('-json', '-modified', 'describe', `${filename}:#${offset.toString()}`);
      const process = cp.execFile(goGuru, args, { env }, (guruErr, stdout) => {
        try {
          if (guruErr && (<any>guruErr).code === 'ENOENT') {
            promptForMissingTool('guru');
            return resolve(null);
          }
          if (guruErr) return reject(guruErr);
          const guruOutput = <GuruDescribeOutput>JSON.parse(stdout.toString());
          if (!guruOutput.value || !guruOutput.value.typespos) {
            if (guruOutput.value && guruOutput.value.type && !goBuiltinTypes.has(guruOutput.value.type) && guruOutput.value.type !== 'invalid type')
              console.log("no typespos from guru's output - try to update guru tool");
            return definitionLocation(d, p, null, false, t).then(
              (definitionInfo) => {
                if (definitionInfo === null || definitionInfo.file === null) return null;
                const definitionResource = qv.Uri.file(definitionInfo.file);
                const pos = new qv.Position(definitionInfo.line, definitionInfo.column);
                resolve(new qv.Location(definitionResource, pos));
              },
              (err) => {
                const miss = parseMissingError(err);
                if (miss[0]) promptForMissingTool(miss[1]);
                else if (err) return Promise.reject(err);
                return Promise.resolve(null);
              }
            );
          }
          const results: qv.Location[] = [];
          guruOutput.value.typespos.forEach((ref) => {
            const match = /^(.*):(\d+):(\d+)/.exec(ref.objpos);
            if (!match) return;
            const [, file, line, col] = match;
            const referenceResource = qv.Uri.file(file);
            const pos = new qv.Position(parseInt(line, 10) - 1, parseInt(col, 10) - 1);
            results.push(new qv.Location(referenceResource, pos));
          });
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
      if (process.pid) process.stdin.end(getFileArchive(d));
      t.onCancellationRequested(() => killProcTree(process));
    });
  }
}
