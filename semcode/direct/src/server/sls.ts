import { Range } from 'vscode-languageserver/lib/main';
import { Parser, SyntaxNode } from 'web-tree-sitter';
export function forEach(node: SyntaxNode, cb: (n: SyntaxNode) => void) {
  cb(node);
  if (node.children.length) {
    node.children.forEach((n) => forEach(n, cb));
  }
}
export function range(n: SyntaxNode): Range {
  return Range.create(n.startPosition.row, n.startPosition.column, n.endPosition.row, n.endPosition.column);
}
export function isDefinition(n: SyntaxNode): boolean {
  switch (n.type) {
    case 'variable_assignment':
    case 'function_definition':
      return true;
    default:
      return false;
  }
}
export function isReference(n: SyntaxNode): boolean {
  switch (n.type) {
    case 'variable_name':
    case 'command_name':
      return true;
    default:
      return false;
  }
}
export function findParent(start: SyntaxNode, predicate: (n: SyntaxNode) => boolean): SyntaxNode | null {
  let node = start.parent;
  while (node !== null) {
    if (predicate(node)) {
      return node;
    }
    node = node.parent;
  }
  return null;
}
export async function initializeParser(): Promise<Parser> {
  await Parser.init();
  const parser = new Parser();

  /**
   * See https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web#generate-wasm-language-files
   *
   * To compile and use a new tree-sitter-bash version:
   *    cd server
   *    yarn add web-tree-sitter
   *    yarn add --dev tree-sitter-bash tree-sitter-cli
   *    npx tree-sitter build-wasm node_modules/tree-sitter-bash
   *
   * Note down the versions (from the package.json) below and then run
   *    yarn remove tree-sitter-bash tree-sitter-cli
   *
   * The current files was compiled with:
   * "tree-sitter-bash": "^0.16.1",
   * "tree-sitter-cli": "^0.16.5"
   */
  const lang = await Parser.Lang.load(`${__dirname}/../tree-sitter-bash.wasm`);

  parser.setLang(lang);
  return parser;
}
