import { Value } from '../value.mts';
import { type ValueEvaluator } from '../evaluator.mts';
import { EnsureCompletion, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { RecordSelectedOperand } from '../type-system/numeric-constants.mts';
import { EvaluateResultValue, ToBoolean } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   LogicalANDExpression :
//     LogicalANDExpression `&&` BitwiseORExpression
export function* Evaluate_LogicalANDExpression(node: ParseNode.LogicalANDExpression): ValueEvaluator {
  const { LogicalANDExpression, BitwiseORExpression } = node;
  const left = EnsureCompletion(yield* EvaluateResultValue(LogicalANDExpression));
  if (left.Type !== 'normal') return left;
  // proposal-runtime-types: the operand produced is recorded as this returns.
  if (X(ToBoolean(left.Value)) === Value.false) {
    RecordSelectedOperand(node, LogicalANDExpression);
    return left;
  }
  const right = yield* EvaluateResultValue(BitwiseORExpression);
  RecordSelectedOperand(node, BitwiseORExpression);
  return right;
}
