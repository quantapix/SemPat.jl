import { ModuleNode, ParseNode } from '../parser/parseNodes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { ParseTreeWalker } from './parseTreeWalker';

export class ParseTreeCleanerWalker extends ParseTreeWalker {
  private _parseTree: ModuleNode;

  constructor(parseTree: ModuleNode) {
    super();

    this._parseTree = parseTree;
  }

  clean() {
    this.walk(this._parseTree);
  }

  visitNode(node: ParseNode) {
    AnalyzerNodeInfo.cleanNodeAnalysisInfo(node);
    return super.visitNode(node);
  }
}
