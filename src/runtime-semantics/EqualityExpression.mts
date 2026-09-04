import { Q, X } from '../completion.mts';
import { AdoptLiteralOperand, DecayEnumOperands } from '../type-system/arithmetic.mts';
import { vectorComparison } from '../type-system/vector-ops.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Value, ObjectValue } from '../value.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { isNumericLiteralOperand } from './EvaluateStringOrNumericBinaryExpression.mts';
import {
  IsLooselyEqual,
  GetValue,
  IsStrictlyEqual,
  BooleanValue,
  Call,
  ToBoolean,
  surroundingAgent,
  LookupClassOperator,
  RightOperandDeclaresOperator,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-equality-operators-runtime-semantics-evaluation */
//   EqualityExpression :
//     EqualityExpression `==` RelationalExpression
//     EqualityExpression `!=` RelationalExpression
//     EqualityExpression `===` RelationalExpression
//     EqualityExpression `!==` RelationalExpression
export function* Evaluate_EqualityExpression({ EqualityExpression, operator, RelationalExpression }: ParseNode.EqualityExpression): ValueEvaluator<BooleanValue> {
  // 1. Let lref be the result of evaluating EqualityExpression.
  const lref = Q(yield* Evaluate(EqualityExpression));
  // 2. Let lval be ? GetValue(lref).
  let lval = Q(yield* GetValue(lref));
  // 3. Let rref be the result of evaluating RelationalExpression.
  const rref = Q(yield* Evaluate(RelationalExpression));
  // 4. Let rval be ? GetValue(rref).
  let rval = Q(yield* GetValue(rref));
  // proposal-runtime-types (spec sec-class-operators): the equality operators are
  // overloadable. When the left operand is an Object whose class declares
  // `operator==`, `==` dispatches to it (receiver is the left operand, parameter
  // the right) and `!=` returns its negation. Strict equality `===`/`!==` keeps
  // its own semantics and does not consult the operator. The untyped path is
  // unaffected.
  // proposal-runtime-types #sec-vector-comparisons: a comparison between vectors
  // of one shape yields one lane per input lane, and equality is a comparison
  // like any other - Intel's `_mm_cmpeq_epi32` beside its `_mm_cmpgt_epi32`.
  // Only the ORDERING operators reached the vector path, so `a == b` fell
  // through to the scalar abstract comparison and answered a single boolean:
  // `const m: boolean32x4 = a == b` reported that *false* was not assignable to
  // `uint.<1>`.
  if (surroundingAgent.feature('runtime-types')
      && (lval.type === 'Vector' || rval.type === 'Vector')
      && (operator === '==' || operator === '!=')) {
    return Q(yield* vectorComparison(lval, operator, rval)) as never;
  }
  if (surroundingAgent.feature('runtime-types')
      && lval instanceof ObjectValue
      && (operator === '==' || operator === '!=')) {
    const opFn = LookupClassOperator(lval, '==');
    if (opFn) {
      const result = Q(yield* Call(opFn as Value, lval, [rval]));
      const truthy = ToBoolean(result) === Value.true;
      if (operator === '==') {
        return truthy ? Value.true : Value.false;
      }
      return truthy ? Value.false : Value.true;
    }
  }
  // proposal-runtime-types (operatoroverloading.md): an equality operator declared
  // by the RIGHT operand is not reached, since dispatch keys on the left. Report it
  // rather than falling through to the abstract equality comparison.
  if ((operator === '==' || operator === '!=')
      && RightOperandDeclaresOperator(lval, rval, '==')) {
    return Throw.TypeError('operator $1 is declared by the right operand, but operator dispatch keys on the left operand', '==');
  }
  // proposal-runtime-types (#sec-arithmetic-never-promotes, the literal rule):
  // "where one operand is a literal it takes the type of the other, so a
  // literal never forces a conversion". The clause names arithmetic, bitwise,
  // shift, and relational operators, and EQUALITY was left out - so
  // `(65 := uint16) < 66` compared but `(65 := uint16) === 65` was *false*, the
  // same literal adopting in one operator and not the next. The BigInt
  // precedent does not govern: a BigInt has its own literal syntax, `1n`, so it
  // never needed adoption, while these types have none and `65` is the only way
  // to write sixty-five. Adopting here is what Rust, Go, Swift, and Haskell do
  // with an untyped numeric literal.
  if (surroundingAgent.feature('runtime-types')) {
    // proposal-runtime-types #sec-enums: an enum operand is read at its
    // underlying type where the other operand is not of an enum type. Before
    // the literal rule, so a literal adopts the UNDERLYING type rather than the
    // enum, which no literal can represent.
    const decayed = DecayEnumOperands(lval, rval);
    if (decayed) {
      lval = decayed.left;
      rval = decayed.right;
    }
    const adopted = AdoptLiteralOperand(lval, rval, {
      left: isNumericLiteralOperand(EqualityExpression as ParseNode),
      right: isNumericLiteralOperand(RelationalExpression as ParseNode),
    });
    if (adopted) {
      lval = adopted.left;
      rval = adopted.right;
    }
  }
  switch (operator) {
    case '==':
      // 5. Return the result of performing Abstract Equality Comparison rval == lval.
      return Value(Q(yield* IsLooselyEqual(rval, lval)));
    case '!=': {
      // 5. Let r be the result of performing Abstract Equality Comparison rval == lval.
      const r = Q(yield* IsLooselyEqual(rval, lval));
      // 7. If r is true, return false. Otherwise, return true.
      if (r) {
        return Value.false;
      } else {
        return Value.true;
      }
    }
    case '===':
      // 5. Return the result of performing Strict Equality Comparison rval === lval.
      return Value(IsStrictlyEqual(rval, lval));
    case '!==': {
      // 5. Let r be the result of performing Strict Equality Comparison rval === lval.
      // 6. Assert: r is a normal completion.
      const r = X(IsStrictlyEqual(rval, lval));
      // 7. If r.[[Value]] is true, return false. Otherwise, return true.
      if (r) {
        return Value.false;
      } else {
        return Value.true;
      }
    }

    default:
      throw OutOfRange.exhaustive(operator);
  }
}
