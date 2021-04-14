import { cloneDiagRuleSet, DiagLevel, DiagRuleSet, getBooleanDiagRules, getDiagLevelDiagRules, getStrictDiagRuleSet, getStrictModeNotOverriddenRules } from '../common/configOptions';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Token } from '../parser/tokenizerTypes';
export function getFileLevelDirectives(tokens: TextRangeCollection<Token>, defaultRuleSet: DiagRuleSet, useStrict: boolean): DiagRuleSet {
  let ruleSet = cloneDiagRuleSet(defaultRuleSet);
  if (useStrict) _applyStrictRules(ruleSet);
  for (let i = 0; i < tokens.count; i++) {
    const token = tokens.getItemAt(i);
    if (token.comments) {
      for (const comment of token.comments) {
        const value = comment.value.trim();
        ruleSet = _parsePyrightComment(value, ruleSet);
      }
    }
  }
  return ruleSet;
}
function _applyStrictRules(ruleSet: DiagRuleSet) {
  const strictRuleSet = getStrictDiagRuleSet();
  const boolRuleNames = getBooleanDiagRules();
  const diagRuleNames = getDiagLevelDiagRules();
  const skipRuleNames = getStrictModeNotOverriddenRules();
  for (const ruleName of boolRuleNames) {
    if (skipRuleNames.find((r) => r === ruleName)) {
      continue;
    }
    if ((strictRuleSet as any)[ruleName]) {
      (ruleSet as any)[ruleName] = true;
    }
  }
  for (const ruleName of diagRuleNames) {
    if (skipRuleNames.find((r) => r === ruleName)) {
      continue;
    }
    const strictValue: DiagLevel = (strictRuleSet as any)[ruleName];
    const prevValue: DiagLevel = (ruleSet as any)[ruleName];
    if (strictValue === 'error' || (strictValue === 'warning' && prevValue !== 'error') || (strictValue === 'information' && prevValue !== 'error' && prevValue !== 'warning')) {
      (ruleSet as any)[ruleName] = strictValue;
    }
  }
}
function _parsePyrightComment(commentValue: string, ruleSet: DiagRuleSet) {
  const validPrefixes = ['pyright:', 'mspython:'];
  const prefix = validPrefixes.find((p) => commentValue.startsWith(p));
  if (prefix) {
    const operands = commentValue.substr(prefix.length).trim();
    const operandList = operands.split(',').map((s) => s.trim());
    if (operandList.some((s) => s === 'strict')) {
      _applyStrictRules(ruleSet);
    }
    for (const operand of operandList) {
      ruleSet = _parsePyrightOperand(operand, ruleSet);
    }
  }
  return ruleSet;
}
function _parsePyrightOperand(operand: string, ruleSet: DiagRuleSet) {
  const operandSplit = operand.split('=').map((s) => s.trim());
  if (operandSplit.length !== 2) return ruleSet;
  const ruleName = operandSplit[0];
  const boolRules = getBooleanDiagRules();
  const diagLevelRules = getDiagLevelDiagRules();
  if (diagLevelRules.find((r) => r === ruleName)) {
    const diagLevelValue = _parseDiagLevel(operandSplit[1]);
    if (diagLevelValue !== undefined) (ruleSet as any)[ruleName] = diagLevelValue;
  } else if (boolRules.find((r) => r === ruleName)) {
    const boolValue = _parseBoolSetting(operandSplit[1]);
    if (boolValue !== undefined) (ruleSet as any)[ruleName] = boolValue;
  }
  return ruleSet;
}
function _parseDiagLevel(value: string): DiagLevel | undefined {
  switch (value) {
    case 'false':
    case 'none':
      return 'none';
    case 'true':
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'information':
      return 'information';
    default:
      return undefined;
  }
}
function _parseBoolSetting(value: string): boolean | undefined {
  if (value === 'false') return false;
  else if (value === 'true') {
    return true;
  }
  return undefined;
}
