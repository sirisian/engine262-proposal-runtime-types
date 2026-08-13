import { vectorComparison } from '../type-system/vector-ops.mts';
import { isRangeObject } from '../intrinsics/Range.mts';
import { StringValue } from '../static-semantics/all.mts';
import {
  TypedStringValue,
  ObjectValue,
  Value,
  wellKnownSymbols,
} from '../value.mts';
import { Q, X } from '../completion.mts';
import { Evaluate } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { AbruptCompletion } from '../completion.mts';
import { JSStringValue, TypedNumberValue } from '../value.mts';
import { TypedOperandType } from '../type-system/arithmetic.mts';
import { isNumericLiteralOperand } from './EvaluateStringOrNumericBinaryExpression.mts';
import {
  IsLessThan,
  SameValue,
  Call,
  GetMethod,
  GetValue,
  HasProperty,
  IsCallable,
  OrdinaryHasInstance,
  ToBoolean,
  ToPropertyKey,
  PrivateElementFind,
  Throw,
  surroundingAgent,
  LookupClassOperator,
  RightOperandDeclaresOperator,
} from '#self';
import { ResolvePrivateIdentifier, type PrivateEnvironmentRecord } from '#self';

/** https://tc39.es/ecma262/#sec-instanceofoperator */
export function* InstanceofOperator(V: Value, target: Value) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('Right-hand side of "instanceof" ($1) is not an object', target);
  }
  // 2. Let instOfHandler be ? GetMethod(target, @@hasInstance).
  const instOfHandler = Q(yield* GetMethod(target, wellKnownSymbols.hasInstance));
  // 3. If instOfHandler is not undefined, then
  if (instOfHandler !== Value.undefined) {
    // a. Return ! ToBoolean(? Call(instOfHandler, target, « V »)).
    return X(ToBoolean(Q(yield* Call(instOfHandler, target, [V]))));
  }
  // 4. If IsCallable(target) is false, throw a TypeError exception.
  if (!IsCallable(target)) {
    return Throw.TypeError('Right-hand side of "instanceof" ($1) is not a function', target);
  }
  // 5. Return ? OrdinaryHasInstance(target, V).
  return Q(yield* OrdinaryHasInstance(target, V));
}

// RelationalExpression : PrivateIdentifier `in` ShiftExpression
export function* Evaluate_RelationalExpression_PrivateIdentifier({ PrivateIdentifier, ShiftExpression }: ParseNode.RelationalExpression) {
  // 1. Let privateIdentifier be the StringValue of PrivateIdentifier.
  const privateIdentifier = StringValue(PrivateIdentifier!);
  // 2. Let rref be the result of evaluating ShiftExpression.
  const rref = Q(yield* Evaluate(ShiftExpression));
  // 3. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  // 4. If Type(rval) is not Object, throw a TypeError exception.
  if (!(rval instanceof ObjectValue)) {
    return Throw.TypeError('Right-hand side of "in" ($1) is not an object', rval);
  }
  // 5. Let privateEnv be the running execution context's PrivateEnvironment.
  const privateEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment as PrivateEnvironmentRecord;
  // 6. Let privateName be ! ResolvePrivateIdentifier(privateEnv, privateIdentifier).
  const privateName = X(ResolvePrivateIdentifier(privateEnv, privateIdentifier));
  // 7. If ! PrivateElementFind(privateName, rval) is not empty, return true.
  if (X(PrivateElementFind(privateName, rval)) !== undefined) {
    return Value.true;
  }
  // 8. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-relational-operators-runtime-semantics-evaluation */
//   RelationalExpression :
//     RelationalExpression `<` ShiftExpression
//     RelationalExpression `>` ShiftExpression
//     RelationalExpression `<=` ShiftExpression
//     RelationalExpression `>=` ShiftExpression
//     RelationalExpression `instanceof` ShiftExpression
//     RelationalExpression `in` ShiftExpression
//     PrivateIdentifier `in` ShiftExpression
/**
 * The declaration positions of two values that are enumerators of ONE enum, or
 * ~undefined~ where they are not.
 *
 * Both must belong to the SAME enum: comparing across two enums, or an
 * enumerator against a bare string of equal value, has no single declaration
 * order to consult and keeps the ordinary comparison.
 */
function StringEnumOrdinals(lval: Value, rval: Value): [number, number] | undefined {
  if (!(lval instanceof TypedStringValue) || !(rval instanceof TypedStringValue)) {
    return undefined;
  }
  const lt = lval.TypeRecord as { EnumMembers?: readonly Value[] } | undefined;
  const rt = rval.TypeRecord as unknown;
  if (!lt || lt !== rt || !lt.EnumMembers) {
    return undefined;
  }
  const li = lt.EnumMembers.findIndex((m) => SameValue(m, lval));
  const ri = lt.EnumMembers.findIndex((m) => SameValue(m, rval));
  if (li < 0 || ri < 0) {
    return undefined;
  }
  return [li, ri];
}

export function* Evaluate_RelationalExpression(expr: ParseNode.RelationalExpression) {
  if (expr.PrivateIdentifier) {
    return yield* Evaluate_RelationalExpression_PrivateIdentifier(expr);
  }

  const { RelationalExpression, operator, ShiftExpression } = expr;

  // 1. Let lref be the result of evaluating RelationalExpression.
  const lref = Q(yield* Evaluate(RelationalExpression!));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let rref be the result of evaluating ShiftExpression.
  const rref = Q(yield* Evaluate(ShiftExpression));
  // 4. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  // proposal-runtime-types (spec sec-class-operators): the relational operators
  // are overloadable. When the left operand is an Object whose class declares the
  // operator, dispatch to it with the receiver being the left operand and the
  // declaration's parameter the right, in place of the abstract comparison. The
  // untyped path (no such operator) is unaffected. `instanceof` and `in` are not
  // overloadable and keep their semantics.
  // proposal-runtime-types #sec-vector-comparisons: "A comparison between two
  // vectors of one shape yields one lane per input lane." The result is a MASK -
  // a vector whose lane type is `uint.<1>`, the design's boolean_N - with each
  // lane set where the comparison holds.
  if (surroundingAgent.feature('runtime-types')
      && (lval.type === 'Vector' || rval.type === 'Vector')
      && (operator === '<' || operator === '>' || operator === '<=' || operator === '>=')) {
    return Q(yield* vectorComparison(lval, operator, rval));
  }
  if (surroundingAgent.feature('runtime-types')
      && lval instanceof ObjectValue
      && (operator === '<' || operator === '>' || operator === '<=' || operator === '>=')) {
    const opFn = LookupClassOperator(lval, operator);
    if (opFn) {
      return Q(yield* Call(opFn as Value, lval, [rval]));
    }
    // A relational operator the class does not declare is DERIVED from the one
    // it does, rather than falling through to the abstract comparison below.
    //
    // Falling through gave wrong answers, not missing ones: two objects coerce
    // to "[object Object]" and comparing that string with itself makes `>`
    // always false and `<=` and `>=` always true. Half of those are right by
    // coincidence, which is how it survived - only the reversed operand order
    // shows it, `M(2) > M(1)` answering false.
    //
    // Reached only after the explicit lookup above has missed, so a declared
    // operator keeps winning with no separate check.
    const lessFn = LookupClassOperator(lval, '<');
    if (lessFn && operator !== '<') {
      // `a > b` is `b < a`; `a <= b` is `!(b < a)`; `a >= b` is `!(a < b)`.
      const swapped = operator === '>' || operator === '<=';
      const receiver = swapped ? rval : lval;
      const argument = swapped ? lval : rval;
      // The declared operator is a USER function and may return anything, so
      // the result is coerced before being negated rather than assumed boolean.
      const raw = Q(yield* Call(lessFn as Value, receiver, [argument]));
      const less = ToBoolean(raw) === Value.true;
      const negate = operator === '<=' || operator === '>=';
      return (negate ? !less : less) ? Value.true : Value.false;
    }
  }
  // proposal-runtime-types (operatoroverloading.md): the same operator declared by
  // the RIGHT operand is not reached, since dispatch keys on the left. Report it
  // rather than falling through to the abstract comparison, whose answer would not
  // be the one the declared operator gives.
  if ((operator === '<' || operator === '>' || operator === '<=' || operator === '>=')
      && RightOperandDeclaresOperator(lval, rval, operator)) {
    return Throw.TypeError('operator $1 is declared by the right operand, but operator dispatch keys on the left operand', operator);
  }
  // proposal-runtime-types (#sec-arithmetic-never-promotes): the clause names
  // "an arithmetic, bitwise, shift, or RELATIONAL operator", so two operands of
  // different numeric types do not compare any more than they add, and a
  // literal takes the type of the other operand here too. The comparison path
  // does not route through ApplyStringOrNumericBinaryOperator, so it asked for
  // the rule separately and, until F53, did not get it: `(1 := uint8) <
  // (2 := uint16)` answered true. Literalness is syntactic, as it is for
  // arithmetic, so the operand nodes decide it.
  if (surroundingAgent.feature('runtime-types')
      && (operator === '<' || operator === '>' || operator === '<=' || operator === '>=')
      && (lval instanceof TypedNumberValue || rval instanceof TypedNumberValue)
      // A String operand is not a numeric type, so the clause does not reach
      // it and the existing coercion governs, exactly as the string behaviour
      // of `+` is left alone.
      && !(lval instanceof JSStringValue)
      && !(rval instanceof JSStringValue)) {
    const decided = TypedOperandType(lval, rval, {
      left: isNumericLiteralOperand(RelationalExpression as ParseNode),
      right: isNumericLiteralOperand(ShiftExpression as ParseNode),
    });
    if (decided instanceof AbruptCompletion) {
      return decided;
    }
  }
  // proposal-runtime-types (ranges.md, #sec-range-literals): a RANGE is rejected
  // as a relational operand. "A range does not implement `Ordered`, so the
  // comparison is meaningless, and the base language would otherwise answer it
  // with `false` - which is worse than an error because it is invisible."
  //
  // The unspaced spellings are already Syntax Errors, because a range binds
  // looser than the relational operators, so this rule reaches only the
  // parenthesized forms: `(a..) < b`, `(0..<3) < 5`. It is a runtime rejection
  // until ranges carry types the checker can reject by, at which point the same
  // rule moves to check time and this branch becomes the backstop.
  // sec-enums: an enum whose underlying type is `string` orders by DECLARATION
  // POSITION - "a sequence of named steps like time units or severities is meant
  // to compare in the order it's written, not alphabetically". The enumerator IS
  // the string the program wrote, so the comparison below saw two ordinary
  // strings and ordered them alphabetically, inverting the design's rule.
  //
  // The type comes from the value being a TypedStringValue carrying its record -
  // NOT from `RegisteredEnumOf`, a WeakMap on object identity that does not hold
  // string enumerators. A first attempt used it and silently found nothing.
  if (surroundingAgent.feature('runtime-types')
      && (operator === '<' || operator === '>' || operator === '<=' || operator === '>=')) {
    const ordinals = StringEnumOrdinals(lval, rval);
    if (ordinals !== undefined) {
      const [li, ri] = ordinals;
      switch (operator) {
        case '<': return li < ri ? Value.true : Value.false;
        case '>': return li > ri ? Value.true : Value.false;
        case '<=': return li <= ri ? Value.true : Value.false;
        default: return li >= ri ? Value.true : Value.false;
      }
    }
  }
  if (surroundingAgent.feature('runtime-types')
      && (operator === '<' || operator === '>' || operator === '<=' || operator === '>=')
      && (isRangeObject(lval) || isRangeObject(rval))) {
    return Throw.TypeError('a range is not an ordered value and cannot be compared');
  }
  switch (operator) {
    case '<': {
      // 5. Let r be the result of performing Abstract Relational Comparison lval < rval.
      const r = yield* IsLessThan(lval, rval);
      Q(r);
      // 7. If r is undefined, return false. Otherwise, return r.
      if (r === Value.undefined) {
        return Value.false;
      }
      return r;
    }
    case '>': {
      // 5. Let r be the result of performing Abstract Relational Comparison rval < lval with LeftFirst equal to false.
      const r = yield* IsLessThan(rval, lval, false);
      Q(r);
      // 7. If r is undefined, return false. Otherwise, return r.
      if (r === Value.undefined) {
        return Value.false;
      }
      return r;
    }
    case '<=': {
      // 5. Let r be the result of performing Abstract Relational Comparison rval < lval with LeftFirst equal to false.
      const r = yield* IsLessThan(rval, lval, false);
      Q(r);
      // 7. If r is true or undefined, return false. Otherwise, return true.
      if (r === Value.true || r === Value.undefined) {
        return Value.false;
      }
      return Value.true;
    }
    case '>=': {
      // 5. Let r be the result of performing Abstract Relational Comparison lval < rval.
      const r = yield* IsLessThan(lval, rval);
      Q(r);
      // 7. If r is true or undefined, return false. Otherwise, return true.
      if (r === Value.true || r === Value.undefined) {
        return Value.false;
      }
      return Value.true;
    }
    case 'instanceof':
      // 5. Return ? InstanceofOperator(lval, rval).
      return Q(yield* InstanceofOperator(lval, rval));
    case 'in':
      // 5. Return ? InstanceofOperator(lval, rval).
      if (!(rval instanceof ObjectValue)) {
        return Throw.TypeError('Right-hand side of "in" ($1) is not an object', rval);
      }
      // 6. Return ? HasProperty(rval, ? ToPropertyKey(lval)).
      return Q(yield* HasProperty(rval, Q(yield* ToPropertyKey(lval))));
    default:
      throw OutOfRange.exhaustive(operator);
  }
}
