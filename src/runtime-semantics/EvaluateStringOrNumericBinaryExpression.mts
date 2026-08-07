import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { IsConstLiteralUse, IsLetConstantUse } from '../type-system/check.mts';
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
/**
 * The numeric constants of `Math`, named because none can be written as a
 * literal that denotes it. `Number`'s limits are deliberately absent: they are
 * facts about a REPRESENTATION rather than real numbers, so taking a position's
 * type would let `Number.MAX_SAFE_INTEGER` silently become a `float32` that is
 * not the maximum safe integer of anything.
 */
const WELL_KNOWN_MATH_CONSTANTS = new Set([
  'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2',
]);

function isWellKnownNumericConstant(n: ParseNode): boolean {
  const m = n as ParseNode & {
    MemberExpression?: { type?: string, name?: string },
    IdentifierName?: { name?: string },
  };
  return m.MemberExpression?.type === 'IdentifierReference'
    && m.MemberExpression.name === 'Math'
    && typeof m.IdentifierName?.name === 'string'
    && WELL_KNOWN_MATH_CONSTANTS.has(m.IdentifierName.name);
}

export function isNumericLiteralOperand(node: ParseNode): boolean {
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
    // A well-known numeric constant answers yes. `Math.PI * r` must mean what
    // `3.14159... * r` means, and the constant cannot be WRITTEN as a literal
    // that denotes it, which is the only reason a list is needed at all.
    //
    // Narrowing its `float64` value to the position's type is CORRECTLY
    // ROUNDED, not double rounding: an intermediate of 2p + 2 bits rounds
    // equivalently to rounding once, and `float64`'s 53 covers `float32`'s 50
    // and `float16`'s 24. Verified for all eight constants at both widths.
    if (n.type === 'MemberExpression' && isWellKnownNumericConstant(n)) {
      return true;
    }
    // A `const` bound to a compile-time numeric constant answers yes: its use
    // behaves as if the initializer were written here, which is what makes
    // `const K = 3.14; K * r` mean what `3.14 * r` means.
    if (n.type === 'IdentifierReference' && IsConstLiteralUse(n as object)) {
      return true;
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
    // For the diagnostic only: a `let` bound to a numeric constant does not
    // adopt, deliberately, but it is the one failure with a one-word fix.
    leftLetConst: IsLetConstantUse(leftOperand as object),
    rightLetConst: IsLetConstantUse(rightOperand as object),
  }));
}
