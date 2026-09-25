import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import { BigIntValue, NumberValue, ObjectValue, ReferenceValue, TypedNumberValue, Value, isTypedNumber } from '../value.mts';
import { typedBinary } from '../type-system/arithmetic.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { CreateRationalValue, isRationalObject, rationalAdd, rationalSub } from '../intrinsics/Rational.mts';
import {
  CreateDecimalValue, DecimalPartsInRange, decimalAdd, decimalSubtract, isDecimalObject, type DecimalObject,
} from '../intrinsics/Decimal.mts';
import { isComplexObject } from '../intrinsics/Complex.mts';
import type { ThrowCompletion } from '../completion.mts';
import { isFloat128Object, Float128ToBinary128, Binary128ToFloat128 } from '../intrinsics/Float128.mts';
import { add as float128Add, subtract as float128Subtract, finite as float128Finite } from '../intrinsics/Float128Arithmetic.mts';
import { surroundingAgent,
  Assert,
  Call,
  F,
  GetValue,
  LookupClassOperator,
  PutValue,
  ToNumeric,
  Z,
} from '#self';

/**
 * proposal-runtime-types #sec-which-operations-each-family-defines: an update
 * steps a value by its family's unit. A rational and a decimal step IN their
 * own type - neither has a Number value, so ToNumeric threw for both - and a
 * complex number has no step, so an update of one is refused rather than
 * evaluated to NaN+0i through ToNumeric (plan OQ3 C). Answers *undefined* for
 * every other value, which keeps the ordinary path.
 */
function stepExactNumeric(value: Value, operator: '++' | '--'): Value | ThrowCompletion | undefined {
  const realmRec = surroundingAgent.currentRealmRecord;
  if (isRationalObject(value)) {
    const one = X(CreateRationalValue(1n, 1n, realmRec)); // 1/1 always fits
    return operator === '++' ? rationalAdd(value, one, realmRec) : rationalSub(value, one, realmRec);
  }
  if (isDecimalObject(value)) {
    const one = CreateDecimalValue(1n, 0, value.DecimalWidth, realmRec) as DecimalObject;
    const r = operator === '++' ? decimalAdd(value, one) : decimalSubtract(value, one);
    if (!DecimalPartsInRange(r.parts, r.width)) {
      return Throw.RangeError('a decimal result is outside the range of $1', Value(`decimal${r.width}`));
    }
    return CreateDecimalValue(r.parts.significand, r.parts.exponent, r.width, realmRec);
  }
  // A float128 steps by an exact 1, rounded once, as `x + 1` does.
  if (isFloat128Object(value)) {
    const x = Float128ToBinary128(value);
    const one = float128Finite(1n, 0);
    return Binary128ToFloat128(operator === '++' ? float128Add(x, one) : float128Subtract(x, one), realmRec);
  }
  if (isComplexObject(value)) {
    return Throw.TypeError('$1 is not defined for $2', Value(operator), Value('complex'));
  }
  return undefined;
}

// proposal-runtime-types R6 (Option A): a typed number is a numeric value, so
// ++/-- produce and consume it alongside Number and BigInt.
type AnyNumericValue = BigIntValue | NumberValue | TypedNumberValue;

// proposal-runtime-types (operatoroverloading.md): the increment and decrement
// operators are overloadable. A class `operator++()` or `operator--()` takes no
// parameter, so it is registered under a `unary ` key like the other unary
// operators. When the operand is an instance carrying such an operator, it
// produces the updated value, which is then stored back into the operand's
// location; the prefix forms yield the updated value and the postfix forms the
// original. The lookup is synchronous, so the caller performs the call.
function findUnaryClassOperator(operand: Value, opText: string): Value | null {
  if (!surroundingAgent.feature('runtime-types') || !(operand instanceof ObjectValue)) {
    return null;
  }
  return LookupClassOperator(operand, `unary ${opText}`);
}
/**
 * proposal-runtime-types #sec-location-consuming-contexts: the operand of
 * `++`/`--` consumes a LOCATION, so a call that returned a borrow keeps it
 * across the boundary and the update reads, adds, and writes through that
 * location - the design's `first(a)++`, which writes into the element.
 *
 * A call the parser admitted here that did not in fact return a borrow has no
 * location to update. Where the callee's return type is known the type system
 * refuses the form before the source runs; where it is not, that check is
 * deferred to here, and this is what it throws.
 */
function* EvaluateUpdateTarget(expr: ParseNode.LeftHandSideExpression | ParseNode.UnaryExpressionOrHigher) {
  const target = Q(yield* Evaluate(expr));
  if (target instanceof ReferenceValue) {
    return target.Location;
  }
  if (expr.type === 'CallExpression' && (expr as ParseNode.CallExpression).LocationConsuming === true) {
    return Throw.TypeError('this call did not return a ref, so there is no location to update');
  }
  return target;
}

// UpdateExpression :
//   LeftHandSideExpression `++`
//   LeftHandSideExpression `--`
//   `++` UnaryExpression
//   `--` UnaryExpression
export function* Evaluate_UpdateExpression({ LeftHandSideExpression, operator, UnaryExpression }: ParseNode.UpdateExpression): ValueEvaluator {
  switch (true) {
    // UpdateExpression : LeftHandSideExpression `++`
    // https://tc39.es/ecma262/#sec-postfix-increment-operator-runtime-semantics-evaluation
    case operator === '++' && !!LeftHandSideExpression: {
      // 1. Let lhs be the result of evaluating LeftHandSideExpression.
      const lhs = Q(yield* EvaluateUpdateTarget(LeftHandSideExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through ++ and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(lhs));
      // proposal-runtime-types (operatoroverloading.md): a class increment operator.
      const incOp = findUnaryClassOperator(rawOld, '++');
      if (incOp !== null) {
        const updated = Q(yield* Call(incOp, rawOld, []));
        Q(yield* PutValue(lhs, updated));
        return rawOld;
      }
      const exactStep = stepExactNumeric(rawOld, '++');
      if (exactStep !== undefined) {
        const stepped = Q(exactStep);
        Q(yield* PutValue(lhs, stepped));
        return rawOld;
      }
      let newValue: AnyNumericValue;
      let oldValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        oldValue = rawOld;
        // Both operands are of the same type here, so the mixed-type check of
        // typedBinary cannot fire; X records that.
        newValue = X(typedBinary('+', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never)));
      } else {
        // 2. Let oldValue be ? ToNumeric(? GetValue(lhs)).
        oldValue = Q(yield* ToNumeric(rawOld));
        // 3. If oldValue is a Number, Number::add(oldValue, 1); else BigInt::add.
        if (oldValue instanceof NumberValue) {
          newValue = NumberValue.add(oldValue, F(1));
        } else {
          Assert(oldValue instanceof BigIntValue);
          newValue = BigIntValue.add(oldValue, Z(1n));
        }
      }
      // 4. Perform ? PutValue(lhs, newValue).
      Q(yield* PutValue(lhs, newValue));
      // 5. Return oldValue.
      return oldValue;
    }

    // UpdateExpression : LeftHandSideExpression `--`
    // https://tc39.es/ecma262/#sec-postfix-decrement-operator-runtime-semantics-evaluation
    case operator === '--' && !!LeftHandSideExpression: {
      // 1. Let lhs be the result of evaluating LeftHandSideExpression.
      const lhs = Q(yield* EvaluateUpdateTarget(LeftHandSideExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through -- and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(lhs));
      // proposal-runtime-types (operatoroverloading.md): a class decrement operator.
      const decOp = findUnaryClassOperator(rawOld, '--');
      if (decOp !== null) {
        const updated = Q(yield* Call(decOp, rawOld, []));
        Q(yield* PutValue(lhs, updated));
        return rawOld;
      }
      const exactStep = stepExactNumeric(rawOld, '--');
      if (exactStep !== undefined) {
        const stepped = Q(exactStep);
        Q(yield* PutValue(lhs, stepped));
        return rawOld;
      }
      let newValue: AnyNumericValue;
      let oldValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        oldValue = rawOld;
        // Both operands are of the same type here, so the mixed-type check of
        // typedBinary cannot fire; X records that.
        newValue = X(typedBinary('-', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never)));
      } else {
        // 2. Let oldValue be ? ToNumeric(? GetValue(lhs)).
        oldValue = Q(yield* ToNumeric(rawOld));
        // 3. If oldValue is a Number, Number::subtract(oldValue, 1); else BigInt.
        if (oldValue instanceof NumberValue) {
          newValue = NumberValue.subtract(oldValue, F(1));
        } else {
          Assert(oldValue instanceof BigIntValue);
          newValue = BigIntValue.subtract(oldValue, Z(1n));
        }
      }
      // 4. Perform ? PutValue(lhs, newValue).
      Q(yield* PutValue(lhs, newValue));
      // 5. Return oldValue.
      return oldValue;
    }

    // UpdateExpression : `++` UnaryExpression
    // https://tc39.es/ecma262/#sec-prefix-increment-operator-runtime-semantics-evaluation
    case operator === '++' && !!UnaryExpression: {
      // 1. Let expr be the result of evaluating UnaryExpression.
      const expr = Q(yield* EvaluateUpdateTarget(UnaryExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through prefix ++ and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(expr));
      // proposal-runtime-types (operatoroverloading.md): a class increment operator.
      const incOp = findUnaryClassOperator(rawOld, '++');
      if (incOp !== null) {
        const updated = Q(yield* Call(incOp, rawOld, []));
        Q(yield* PutValue(expr, updated));
        return updated;
      }
      const exactStep = stepExactNumeric(rawOld, '++');
      if (exactStep !== undefined) {
        const stepped = Q(exactStep);
        Q(yield* PutValue(expr, stepped));
        return stepped;
      }
      let newValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        // Both operands are of the same type here, so the mixed-type check of
        // typedBinary cannot fire; X records that.
        newValue = X(typedBinary('+', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never)));
      } else {
        // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
        const oldValue = Q(yield* ToNumeric(rawOld));
        // 3. If oldValue is a Number, Number::add(oldValue, 1); else BigInt::add.
        if (oldValue instanceof NumberValue) {
          newValue = NumberValue.add(oldValue, F(1));
        } else {
          Assert(oldValue instanceof BigIntValue);
          newValue = BigIntValue.add(oldValue, Z(1n));
        }
      }
      // 4. Perform ? PutValue(expr, newValue).
      Q(yield* PutValue(expr, newValue));
      // 5. Return newValue.
      return newValue;
    }

    // UpdateExpression : `--` UnaryExpression
    // https://tc39.es/ecma262/#sec-prefix-decrement-operator-runtime-semantics-evaluation
    case operator === '--' && !!UnaryExpression: {
      // 1. Let expr be the result of evaluating UnaryExpression.
      const expr = Q(yield* EvaluateUpdateTarget(UnaryExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through prefix -- and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(expr));
      // proposal-runtime-types (operatoroverloading.md): a class decrement operator.
      const decOp = findUnaryClassOperator(rawOld, '--');
      if (decOp !== null) {
        const updated = Q(yield* Call(decOp, rawOld, []));
        Q(yield* PutValue(expr, updated));
        return updated;
      }
      const exactStep = stepExactNumeric(rawOld, '--');
      if (exactStep !== undefined) {
        const stepped = Q(exactStep);
        Q(yield* PutValue(expr, stepped));
        return stepped;
      }
      let newValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        // Both operands are of the same type here, so the mixed-type check of
        // typedBinary cannot fire; X records that.
        newValue = X(typedBinary('-', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never)));
      } else {
        // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
        const oldValue = Q(yield* ToNumeric(rawOld));
        // 3. If oldValue is a Number, Number::subtract(oldValue, 1); else BigInt.
        if (oldValue instanceof NumberValue) {
          newValue = NumberValue.subtract(oldValue, F(1));
        } else {
          Assert(oldValue instanceof BigIntValue);
          newValue = BigIntValue.subtract(oldValue, Z(1n));
        }
      }
      // 4. Perform ? PutValue(expr, newValue).
      Q(yield* PutValue(expr, newValue));
      // 5. Return newValue.
      return newValue;
    }

    default:
      throw OutOfRange.nonExhaustive(operator);
  }
}
