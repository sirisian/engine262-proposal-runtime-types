import type { ParseNode } from '../parser/ParseNode.mts';

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

export function isWellKnownNumericConstant(n: ParseNode): boolean {
  const m = n as ParseNode & {
    MemberExpression?: { type?: string, name?: string },
    IdentifierName?: { name?: string },
  };
  return m.MemberExpression?.type === 'IdentifierReference'
    && m.MemberExpression.name === 'Math'
    && typeof m.IdentifierName?.name === 'string'
    && WELL_KNOWN_MATH_CONSTANTS.has(m.IdentifierName.name);
}

/**
 * The integer a numeric constant operand - a use of a `const` bound to a
 * constant expression, or arithmetic over constants - denotes beside an
 * integer, where that is not the Number it evaluates to. The checker records
 * two things here, and the run time reads the record where it adopts the
 * operand into an integer type (`AdoptLiteralOperand`):
 *
 *  - beside an operand whose type the checker knows to be an integer, the
 *    value the operand has in that context (#sec-contextual-types): folded
 *    exactly, with `/` the integer's division and the bitwise operators the
 *    type's. `z < 7 / 2` is then `z < 3`, as `z * (7 / 2)` is `z * 3`;
 *  - for every such operand, the integer it writes, where it writes one:
 *    `2 ** 53 + 1` is 9007199254740993, and its Number is not. This serves an
 *    operand whose type is seen only when the line runs. No context reaches
 *    that position, so an expression that writes no integer - `7 / 2` - has
 *    no record, and is the Number it evaluates to.
 *
 * Read only beside an integer, so an operand the checker mistook the peer of
 * is still the Number beside anything else.
 */
export const integerContextOperands = new WeakMap<object, bigint>();

export function IntegerContextOperandValue(node: object): bigint | undefined {
  return integerContextOperands.get(node);
}

/**
 * Question BN: the exact value a numeric constant operand - a use of a `const`
 * bound to a constant expression, or arithmetic over constants - writes, for a
 * decimal, a rational or a `float128` beside it whose type is seen only when
 * the operand runs (`AdoptLiteralOperand`): the decimal its digits fold to,
 * where `+`, `-`, `*` and a whole power fold it, keeping the cohort the
 * checker gives it beside a decimal it knows; and the fraction it folds to,
 * with `/` the exact quotient. #sec-arithmetic-never-promotes: "its value takes
 * the type then, as a literal's does, or a RangeError is thrown where the type
 * has no such value. That value is read exactly, as a literal's is". Either is
 * null where the expression does not fold so.
 */
export interface ExactConstant {
  readonly decimal: { readonly sig: bigint, readonly exp: number } | null;
  readonly rational: { readonly num: bigint, readonly den: bigint } | null;
}

export const exactConstantOperands = new WeakMap<object, ExactConstant>();

export function ExactConstantOperandValue(node: object): ExactConstant | undefined {
  return exactConstantOperands.get(node);
}

/**
 * Question AN, AN1: the integer a literal or a constant operand writes, where the
 * checker saw it compared with an operand it knew to be of the `bigint` type, in
 * an equality or ordered comparison, a `case` label or the original
 * `Object.is`. The spec: "`bigint` takes a plain integer literal like any other
 * numeric type", and in a comparison a literal "still takes the other operand's
 * type". The run time reads it only beside a BigInt (`AdoptLiteralOperand`), so
 * code with no `bigint` annotation keeps JavaScript's `3n === 3` being *false*.
 * A literal that writes no integer has no record and keeps JavaScript's mixed
 * comparison of a BigInt with a Number.
 */
export const bigIntComparisonOperands = new WeakMap<object, bigint>();

export function BigIntComparisonOperandValue(node: object): bigint | undefined {
  return bigIntComparisonOperands.get(node);
}

/**
 * The operand a selecting expression produced when it was last evaluated: the
 * arm of a conditional, or the operand of `||`, `&&` or `??` whose value it
 * returned. #sec-contextual-types retains a position's context "through
 * value-preserving expression selection ... the selected conditional or
 * short-circuit operand, the final comma operand", so beside a typed operand
 * the literal such an expression SELECTS is a literal operand:
 * `z * (scale ?? 1)` is `z * 1` where `scale` is absent. Which operand was
 * selected is known only when the expression runs, and literalness is a fact
 * about the source text, so the evaluation records the one and the operand
 * test reads the other from it.
 *
 * Recorded as the selecting expression RETURNS, after its operand has been
 * evaluated, and read by the operator immediately after it evaluates the
 * operand, so no other evaluation of the same node comes between the two.
 */
const selectedOperands = new WeakMap<object, ParseNode>();

export function RecordSelectedOperand(selecting: object, selected: ParseNode): void {
  selectedOperands.set(selecting, selected);
}

/**
 * The expression that produced an operand's value: _node_ under its
 * parentheses, at the last expression of a comma, and at the operand each
 * selecting expression on the way last produced.
 */
export function ProducingOperand(node: ParseNode): ParseNode {
  let n = node;
  for (let depth = 0; depth < 1024; depth += 1) {
    if (n.type === 'ParenthesizedExpression') {
      n = n.Expression;
    } else if (n.type === 'CommaOperator') {
      n = n.ExpressionList.at(-1)!;
    } else if (n.type === 'ConditionalExpression' || n.type === 'LogicalORExpression'
        || n.type === 'LogicalANDExpression' || n.type === 'CoalesceExpression') {
      const selected = selectedOperands.get(n);
      if (selected === undefined) return n;
      n = selected;
    } else {
      return n;
    }
  }
  return n;
}
