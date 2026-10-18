import { Value } from '../value.mts';
import { type ValueEvaluator } from '../evaluator.mts';
import { EnsureCompletion, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateResultValue, ToBoolean } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   LogicalANDExpression :
//     LogicalANDExpression `&&` BitwiseORExpression
export function* Evaluate_LogicalANDExpression({ LogicalANDExpression, BitwiseORExpression }: ParseNode.LogicalANDExpression): ValueEvaluator {
  const left = EnsureCompletion(yield* EvaluateResultValue(LogicalANDExpression));
  if (left.Type !== 'normal') return left;
  if (X(ToBoolean(left.Value)) === Value.false) return left;
  return yield* EvaluateResultValue(BitwiseORExpression);
}
