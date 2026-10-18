import { Value } from '../value.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ToBoolean, GetValue, EvaluateResultValue } from '#self';

/** https://tc39.es/ecma262/#sec-conditional-operator-runtime-semantics-evaluation */
//   ConditionalExpression :
//     ShortCircuitExpression `?` AssignmentExpression `:` AssignmentExpression
export function* Evaluate_ConditionalExpression({
  ShortCircuitExpression,
  AssignmentExpression_a,
  AssignmentExpression_b,
}: ParseNode.ConditionalExpression): ValueEvaluator {
  // 1. Let lref be the result of evaluating ShortCircuitExpression.
  const lref = Q(yield* Evaluate(ShortCircuitExpression));
  // 2. Let lval be ! ToBoolean(? GetValue(lref)).
  const lval = X(ToBoolean(Q(yield* GetValue(lref))));
  // 3. If lval is true, then
  if (lval === Value.true) {
    return yield* EvaluateResultValue(AssignmentExpression_a);
  } else { // 4. Else,
    return yield* EvaluateResultValue(AssignmentExpression_b);
  }
}
