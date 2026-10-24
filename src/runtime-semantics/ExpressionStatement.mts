import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EnsureCompletion, GetResultValue } from '#self';

/** https://tc39.es/ecma262/#sec-expression-statement-runtime-semantics-evaluation */
//   ExpressionStatement :
//     Expression `;`
export function* Evaluate_ExpressionStatement({ Expression }: ParseNode.ExpressionStatement): ValueEvaluator {
  // Preserve this source result when a do expression receives the statement's
  // normal value. Ordinary reads still contribute no construction selection.
  const result = EnsureCompletion(yield* Evaluate(Expression));
  if (result.Type !== 'normal') return result;
  return yield* GetResultValue(result);
}
