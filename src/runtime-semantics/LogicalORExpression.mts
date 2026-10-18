import { Value } from '../value.mts';
import { type ValueEvaluator } from '../evaluator.mts';
import { EnsureCompletion, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateResultValue, ToBoolean } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   LogicalORExpression :
//     LogicalORExpression `||` LogicalANDExpression
export function* Evaluate_LogicalORExpression({ LogicalORExpression, LogicalANDExpression }: ParseNode.LogicalORExpression): ValueEvaluator {
  const left = EnsureCompletion(yield* EvaluateResultValue(LogicalORExpression));
  if (left.Type !== 'normal') return left;
  if (X(ToBoolean(left.Value)) === Value.true) return left;
  return yield* EvaluateResultValue(LogicalANDExpression);
}
