import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import { BigIntValue, NumberValue, TypedNumberValue, isTypedNumber } from '../value.mts';
import { typedBinary } from '../type-system/arithmetic.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent,
  Assert,
  F,
  GetValue,
  PutValue,
  ToNumeric,
  Z,
} from '#self';

// proposal-runtime-types R6 (Option A): a typed number is a numeric value, so
// ++/-- produce and consume it alongside Number and BigInt.
type AnyNumericValue = BigIntValue | NumberValue | TypedNumberValue;
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
      const lhs = Q(yield* Evaluate(LeftHandSideExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through ++ and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(lhs));
      let newValue: AnyNumericValue;
      let oldValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        oldValue = rawOld;
        newValue = typedBinary('+', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never));
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
      const lhs = Q(yield* Evaluate(LeftHandSideExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through -- and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(lhs));
      let newValue: AnyNumericValue;
      let oldValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        oldValue = rawOld;
        newValue = typedBinary('-', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never));
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
      const expr = Q(yield* Evaluate(UnaryExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through prefix ++ and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(expr));
      let newValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        newValue = typedBinary('+', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never));
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
      const expr = Q(yield* Evaluate(UnaryExpression));
      // proposal-runtime-types R3: read the raw value; a typed number keeps its
      // type through prefix -- and must be seen before ToNumeric unwraps it.
      const rawOld = Q(yield* GetValue(expr));
      let newValue: AnyNumericValue;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(rawOld)) {
        newValue = typedBinary('-', rawOld, new TypedNumberValue(1, rawOld.TypeRecord as never));
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
