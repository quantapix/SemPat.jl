import { Range } from './textRange';

export interface TextEditAction {
  range: Range;
  replacementText: string;
}

export interface FileEditAction extends TextEditAction {
  filePath: string;
}
