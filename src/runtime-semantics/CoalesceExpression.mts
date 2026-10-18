import { EnsureCompletion } from '../completion.mts';
import { type ValueEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateResultValue } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   CoalesceExpression :
//     CoalesceExpressionHead `??` BitwiseORExpression
export function* Evaluate_CoalesceExpression({ CoalesceExpressionHead, BitwiseORExpression }: ParseNode.CoalesceExpression): ValueEvaluator {
  const left = EnsureCompletion(yield* EvaluateResultValue(CoalesceExpressionHead));
  if (left.Type !== 'normal') return left;
  if (left.Value !== Value.undefined && left.Value !== Value.null) return left;
  return yield* EvaluateResultValue(BitwiseORExpression);
}
