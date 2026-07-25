import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ApplyStringOrNumericBinaryOperator, type BinaryOperator } from './all.mts';
import { GetValue } from '#self';

/**
 * #sec-arithmetic-never-promotes: "Where one operand is a literal it takes the
 * type of the other, so a literal never forces a conversion." Literalness is a
 * property of the SOURCE TEXT, not of the value - by the time a NumericLiteral
 * has been evaluated it is an ordinary Number, indistinguishable from one that
 * arrived through a variable of the `any` type, and those two must behave
 * differently: the literal adopts the type, the `any` value is a mix and
 * throws. So the operand nodes answer the question and the answer travels with
 * the values (F52). A parenthesized literal and a negated one are literals.
 */
function isNumericLiteralOperand(node: ParseNode): boolean {
  let n = node;
  for (;;) {
    if (n.type === 'ParenthesizedExpression') {
      n = (n as { Expression: ParseNode }).Expression;
      continue;
    }
    if (n.type === 'UnaryExpression' && ((n as { operator?: string }).operator === '-' || (n as { operator?: string }).operator === '+')) {
      n = (n as { UnaryExpression: ParseNode }).UnaryExpression;
      continue;
    }
    return n.type === 'NumericLiteral';
  }
}

/** https://tc39.es/ecma262/#sec-evaluatestringornumericbinaryexpression */
export function* EvaluateStringOrNumericBinaryExpression(leftOperand: ParseNode.Expression, opText: BinaryOperator, rightOperand: ParseNode.Expression): ValueEvaluator {
  // 1. Let lref be the result of evaluating leftOperand.
  const lref = Q(yield* Evaluate(leftOperand));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let rref be the result of evaluating rightOperand.
  const rref = Q(yield* Evaluate(rightOperand));
  // 4. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  // 5. Return ? ApplyStringOrNumericBinaryOperator(lval, opText, rval).
  return Q(yield* ApplyStringOrNumericBinaryOperator(lval, opText, rval, {
    left: isNumericLiteralOperand(leftOperand as ParseNode),
    right: isNumericLiteralOperand(rightOperand as ParseNode),
  }));
}
