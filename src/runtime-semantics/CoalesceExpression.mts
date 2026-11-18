import { EnsureCompletion } from '../completion.mts';
import { type ValueEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { RecordSelectedOperand } from '../type-system/numeric-constants.mts';
import { EvaluateResultValue } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   CoalesceExpression :
//     CoalesceExpressionHead `??` BitwiseORExpression
export function* Evaluate_CoalesceExpression(node: ParseNode.CoalesceExpression): ValueEvaluator {
  const { CoalesceExpressionHead, BitwiseORExpression } = node;
  const left = EnsureCompletion(yield* EvaluateResultValue(CoalesceExpressionHead));
  if (left.Type !== 'normal') return left;
  // proposal-runtime-types: the operand produced is recorded as this returns.
  if (left.Value !== Value.undefined && left.Value !== Value.null) {
    RecordSelectedOperand(node, CoalesceExpressionHead);
    return left;
  }
  const right = yield* EvaluateResultValue(BitwiseORExpression);
  RecordSelectedOperand(node, BitwiseORExpression);
  return right;
}
