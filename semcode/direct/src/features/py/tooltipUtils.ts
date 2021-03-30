import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { OverloadedFunctionType } from '../analyzer/types';

export function getOverloadedFunctionTooltip(type: OverloadedFunctionType, evaluator: TypeEvaluator, columnThreshold = 70) {
  let content = '';
  const overloads = type.overloads.map((o) => o.details.name + evaluator.printType(o, /* expandTypeAlias */ false));

  for (let i = 0; i < overloads.length; i++) {
    if (i !== 0 && overloads[i].length > columnThreshold && overloads[i - 1].length <= columnThreshold) {
      content += '\n';
    }

    content += overloads[i];

    if (i < overloads.length - 1) {
      content += '\n';
      if (overloads[i].length > columnThreshold) {
        content += '\n';
      }
    }
  }

  return content;
}
