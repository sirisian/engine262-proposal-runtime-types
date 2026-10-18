import { EnsureCompletion, type NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateResultValue, type Value, type ValueEvaluator } from '#self';

/** https://tc39.es/ecma262/#sec-comma-operator-runtime-semantics-evaluation */
export function* Evaluate_CommaOperator({ ExpressionList }: ParseNode.CommaOperator): ValueEvaluator {
  let result!: NormalCompletion<Value>;
  for (const Expression of ExpressionList) {
    const next = EnsureCompletion(yield* EvaluateResultValue(Expression));
    if (next.Type !== 'normal') return next;
    result = next;
  }
  return result;
}
