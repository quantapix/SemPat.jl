import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { fail } from '../common/debug';
import { TextRange } from '../common/textRange';
import { ParseNode, ParseNodeArray, ParseNodeType } from '../parser/parseNodes';
export class TestWalker extends ParseTreeWalker {
  constructor() {
    super();
  }
  visitNode(node: ParseNode) {
    const children = super.visitNode(node);
    this._verifyParentChildLinks(node, children);
    this._verifyChildRanges(node, children);
    return children;
  }
  private _verifyParentChildLinks(node: ParseNode, children: ParseNodeArray) {
    children.forEach((child) => {
      if (child) {
        if (child.parent !== node) {
          fail(`Child node ${child.nodeType} does not ` + `contain a reference to its parent ${node.nodeType}`);
        }
      }
    });
  }
  private _verifyChildRanges(node: ParseNode, children: ParseNodeArray) {
    let prevNode: ParseNode | undefined;
    children.forEach((child) => {
      if (child) {
        let skipCheck = false;
        if (node.nodeType === ParseNodeType.Assignment) {
          if (child === node.typeAnnotationComment) {
            skipCheck = true;
          }
        }
        if (node.nodeType === ParseNodeType.StringList) {
          if (child === node.typeAnnotation) {
            skipCheck = true;
          }
        }
        if (!skipCheck) {
          if (child.start < node.start || TextRange.getEnd(child) > TextRange.getEnd(node)) {
            fail(`Child node ${child.nodeType} is not ` + `contained within its parent ${node.nodeType}`);
          }
          if (prevNode) {
            if (child.start < TextRange.getEnd(prevNode)) {
              if (prevNode.nodeType !== ParseNodeType.FunctionAnnotation) {
                fail(`Child node is not after previous child node`);
              }
            }
          }
          prevNode = child;
        }
      }
    });
  }
}
