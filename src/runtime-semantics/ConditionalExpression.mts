import { Value } from '../value.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { RecordSelectedOperand } from '../type-system/numeric-constants.mts';
import { ToBoolean, GetValue, EvaluateResultValue } from '#self';

/** https://tc39.es/ecma262/#sec-conditional-operator-runtime-semantics-evaluation */
//   ConditionalExpression :
//     ShortCircuitExpression `?` AssignmentExpression `:` AssignmentExpression
export function* Evaluate_ConditionalExpression(node: ParseNode.ConditionalExpression): ValueEvaluator {
  const { ShortCircuitExpression, AssignmentExpression_a, AssignmentExpression_b } = node;
  // 1. Let lref be the result of evaluating ShortCircuitExpression.
  const lref = Q(yield* Evaluate(ShortCircuitExpression));
  // 2. Let lval be ! ToBoolean(? GetValue(lref)).
  const lval = X(ToBoolean(Q(yield* GetValue(lref))));
  // 3. If lval is true, then
  // proposal-runtime-types: the arm selected is recorded as this returns, for
  // an operator that reads the literal it produced (RecordSelectedOperand).
  const selected = lval === Value.true ? AssignmentExpression_a : AssignmentExpression_b;
  const result = yield* EvaluateResultValue(selected);
  RecordSelectedOperand(node, selected);
  return result;
}
