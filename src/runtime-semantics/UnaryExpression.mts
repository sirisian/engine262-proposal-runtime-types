import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { vectorShape } from '../type-system/vector-ops.mts';
import { CheckedConvertValue } from '../abstract-ops/runtime-types.mts';
import { Q } from '../completion.mts';
import {
  Value, ReferenceRecord, UndefinedValue, BigIntValue, BooleanValue, JSStringValue, NullValue, NumberValue, ObjectValue, SymbolValue,
  TypedNumberValue,
  VectorValue,
  isTypedNumber,
  ReferenceValue,
} from '../value.mts';
import { typedUnary } from '../type-system/arithmetic.mts';
import { isTypeObject } from '../type-system/intern.mts';
import { __ts_cast__, OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent, EnvironmentRecord } from '#self';
import { isRangeObject } from '../intrinsics/Range.mts';
import { rangeNegate } from '../type-system/range-ops.mts';
import {
  Assert,
  Call,
  GetValue,
  IsCallable,
  LookupClassOperator,
  IsPropertyReference,
  IsSuperReference,
  IsUnresolvableReference,
  ToBoolean,
  ToNumber,
  ToObject,
  ToNumeric,
  type PropertyReference,
  IsPropertyKey,
  IsPrivateReference,
  ToPropertyKey,
  Throw,
  isArrayIndex,
} from '#self';
import { isDecimalObject, decimalNegate, CreateDecimalValue } from '../intrinsics/Decimal.mts';

/** https://tc39.es/ecma262/#sec-delete-operator-runtime-semantics-evaluation */
//   UnaryExpression : `delete` UnaryExpression
function* Evaluate_UnaryExpression_Delete({ UnaryExpression }: ParseNode.UnaryExpression) {
  // 1. Let ref be the result of evaluating UnaryExpression.
  const ref = Q(yield* Evaluate(UnaryExpression));
  Q(ref);
  // 3. If ref is not a Reference Record, return true.
  if (!(ref instanceof ReferenceRecord)) {
    return Value.true;
  }
  // 4. If IsUnresolvableReference(ref) is true, then
  if (IsUnresolvableReference(ref) === Value.true) {
    // a. Assert: ref.[[Strict]] is false.
    Assert(ref.Strict === Value.false);
    // b. Return true.
    return Value.true;
  }
  // 5. If IsPropertyReference(ref) is true, then
  if (IsPropertyReference(ref) === Value.true) {
    __ts_cast__<PropertyReference>(ref);
    // a. Assert: IsPrivateReference(ref) is false.
    Assert(!IsPrivateReference(ref));
    // b. If IsSuperReference(ref) is true, throw a ReferenceError exception.
    if (IsSuperReference(ref) === Value.true) {
      return Throw.ReferenceError('Cannot delete a super property');
    }
    // c. Let baseObj be ? ToObject(ref.[[Base]]).
    const baseObj = Q(ToObject(ref.Base as Value));
    // d. If ref.[[ReferencedName]] is not a property key, then
    if (!IsPropertyKey(ref.ReferencedName)) {
      // Set ref.[[ReferencedName]] to ? ToPropertyKey(ref.[[ReferencedName]]).
      ref.ReferencedName = Q(yield* ToPropertyKey(ref.ReferencedName as Value));
    }
    // proposal-runtime-types (spec sec-array-defaults-and-stores): "Deleting a
    // typed field, A TYPED ELEMENT, or a member required by an implemented
    // interface throws a TypeError." A hole in a typed array is not a value of
    // the element type. This lives on the OPERATOR rather than in [[Delete]],
    // because ArraySetLength truncates by deleting from the top and asserts
    // that those deletes are infallible: shortening an array removes elements
    // without leaving a hole, and it is the hole this rule is about (F51).
    if (surroundingAgent.feature('runtime-types')
        && (baseObj as { TypedElement?: unknown }).TypedElement !== undefined
        && isArrayIndex(ref.ReferencedName as Value)) {
      return Throw.TypeError('$1 is a typed element and cannot be deleted', ref.ReferencedName as Value);
    }
    // e. Let deleteStatus be ? baseObj.[[Delete]](ref.[[ReferencedName]]).
    const deleteStatus = Q(yield* baseObj.Delete(ref.ReferencedName as JSStringValue));
    // f. If deleteStatus is false and ref.[[Strict]] is true, throw a TypeError exception.
    if (deleteStatus === Value.false && ref.Strict === Value.true) {
      return Throw.TypeError('Cannot not delete property $1 on $2', ref.ReferencedName, baseObj);
    }
    // g. Return deleteStatus.
    return deleteStatus;
  } else { // 6. Else,
    // a. Let base be ref.[[Base]].
    const base = ref.Base;
    // b. Assert: base is an Environment Record.
    Assert(base instanceof EnvironmentRecord);
    // c. Return ? bindings.DeleteBinding(GetReferencedName(ref)).
    return Q(yield* base.DeleteBinding(ref.ReferencedName as JSStringValue));
  }
}

/** https://tc39.es/ecma262/#sec-void-operator-runtime-semantics-evaluation */
//   UnaryExpression : `void` UnaryExpression
function* Evaluate_UnaryExpression_Void({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // 2. Perform ? GetValue(expr).
  Q(yield* GetValue(expr));
  // 3. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-typeof-operator-runtime-semantics-evaluation */
// UnaryExpression : `typeof` UnaryExpression
function* Evaluate_UnaryExpression_Typeof({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let val be the result of evaluating UnaryExpression.
  const _val = Q(yield* Evaluate(UnaryExpression));
  // 2. If Type(val) is Reference, then
  if (_val instanceof ReferenceRecord) {
    // a. If IsUnresolvableReference(val) is true, return "undefined".
    if (IsUnresolvableReference(_val) === Value.true) {
      return Value('undefined');
    }
  }
  // 3. Set val to ? GetValue(val).
  const val = Q(yield* GetValue(_val));
  // 4. Return a String according to Table 37.
  if (val instanceof UndefinedValue) {
    return Value('undefined');
  } else if (val instanceof NullValue) {
    return Value('object');
  } else if (val instanceof BooleanValue) {
    return Value('boolean');
  } else if (val instanceof NumberValue) {
    return Value('number');
  } else if (isTypedNumber(val)) {
    // proposal-runtime-types R6: a typed number is a numeric primitive; typeof
    // reports 'number', consistent with it reading as its underlying Number.
    return Value('number');
  } else if (val instanceof JSStringValue) {
    return Value('string');
  } else if (val instanceof BigIntValue) {
    return Value('bigint');
  } else if (val instanceof SymbolValue) {
    return Value('symbol');
  } else if (val instanceof ObjectValue) {
    // proposal-runtime-types (spec sec-reflect-typeof): a Type Object is callable
    // (a call on the type is a conversion, `uint8(v)`), but `typeof` reports
    // "object", since a Type Object is an Object and `typeof uint8 === "object"`
    // is the feature detection for this proposal. So a Type Object is "object"
    // even though it is callable.
    if (surroundingAgent.feature('runtime-types') && isTypeObject(val)) {
      return Value('object');
    }
    if (IsCallable(val)) {
      return Value('function');
    }
    return Value('object');
  }
  if (val instanceof ReferenceValue) {
    // proposal-runtime-types (references extension): a reference value never
    // reaches typeof; every read that could carry one dereferences first.
    throw OutOfRange.nonExhaustive(val);
  }
  if (val instanceof VectorValue) {
    // proposal-runtime-types #sec-vector-types: a vector is a value type, and
    // `typeof` on one is 'object' for the same reason it is for the other
    // aggregate value types - it is not a primitive of the base language, and
    // its own type is read with Reflect.typeOf rather than with typeof.
    return Value('object');
  }
  throw OutOfRange.exhaustive(val);
}

/** https://tc39.es/ecma262/#sec-unary-plus-operator-runtime-semantics-evaluation */
//   UnaryExpression : `+` UnaryExpression
function* Evaluate_UnaryExpression_Plus({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  const rawValue = Q(yield* GetValue(expr));
  // proposal-runtime-types (operatoroverloading.md): a class unary-plus operator.
  const unaryOp = findUnaryClassOperator(rawValue, '+');
  if (unaryOp !== null) {
    return Q(yield* Call(unaryOp, rawValue, []));
  }
  // 2. Return ? ToNumber(? GetValue(expr)).
  return Q(yield* ToNumber(rawValue));
}

/** https://tc39.es/ecma262/#sec-unary-minus-operator-runtime-semantics-evaluation */
//   UnaryExpression : `-` UnaryExpression
function* Evaluate_UnaryExpression_Minus({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // proposal-runtime-types R3: read the raw value first; a typed number keeps
  // its type through unary minus, and must be seen before ToNumeric unwraps it.
  const rawValue = Q(yield* GetValue(expr));
  if (surroundingAgent.feature('runtime-types') && rawValue instanceof TypedNumberValue) {
    return typedUnary('-', rawValue as TypedNumberValue);
  }
  // proposal-runtime-types (simd.md): negation applies lane-wise and keeps the
  // vector's type, as every other arithmetic operator on a vector does. Without
  // this the operand reached ToNumeric, which has no reading for a vector, and
  // `-v` reported that the vector was not assignable to its own type.
  if (surroundingAgent.feature('runtime-types') && rawValue.type === 'Vector') {
    const v = rawValue as VectorValue;
    const shape = vectorShape(v);
    // A lane carries its own numeric type, so negating one is the typed unary
    // this function already performs on a scalar.
    if (shape !== null && v.lanes.every((lane) => lane instanceof TypedNumberValue)) {
      const lanes: Value[] = [];
      for (const lane of v.lanes) {
        lanes.push(Q(yield* CheckedConvertValue(
          typedUnary('-', lane as TypedNumberValue) as Value,
          shape.laneType,
        )) as Value);
      }
      return new VectorValue(lanes, v.TypeRecord);
    }
  }
  // proposal-runtime-types (decimal.md): unary minus on a decimal keeps its
  // COHORT MEMBER - `-1.50` is `-1.50`, not `-1.5` - since negation changes the
  // sign and nothing about the significance.
  if (surroundingAgent.feature('runtime-types') && isDecimalObject(rawValue)) {
    const negated = decimalNegate(rawValue);
    return CreateDecimalValue(negated.parts.significand, negated.parts.exponent, negated.width, surroundingAgent.currentRealmRecord);
  }
  // proposal-runtime-types (ranges.md "Types"): negating a range reflects it, so
  // the endpoints exchange places and carry their bounds with them - the image of
  // [a, b) under negation is (-b, -a] - and a from-range becomes a to-range.
  if (surroundingAgent.feature('runtime-types') && isRangeObject(rawValue)) {
    return rangeNegate(rawValue, surroundingAgent.currentRealmRecord);
  }
  // proposal-runtime-types (operatoroverloading.md): a class unary operator.
  const unaryOp = findUnaryClassOperator(rawValue, '-');
  if (unaryOp !== null) {
    return Q(yield* Call(unaryOp, rawValue, []));
  }
  // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
  const oldValue = Q(yield* ToNumeric(rawValue));
  // 3. If oldValue is a Number, then
  if (oldValue instanceof NumberValue) {
    // a. Return Number::unaryMinus(oldValue).
    return NumberValue.unaryMinus(oldValue);
  } else {
    // a. Assert: oldValue is a BigInt.
    // b. Return BigInt::unaryMinus(oldValue).
    Assert(oldValue instanceof BigIntValue);
    return BigIntValue.unaryMinus(oldValue);
  }
}

// proposal-runtime-types (operatoroverloading.md): a unary class operator has no
// parameter and its receiver is the operand, so it is registered and looked up
// under a key distinct from the binary operator of the same spelling. When the
// operand is an instance carrying such an operator, the operator supplies the
// result; otherwise the caller falls back to the built-in meaning. The lookup is
// synchronous, so the caller performs the call.
function findUnaryClassOperator(operand: Value, opText: string): Value | null {
  if (!surroundingAgent.feature('runtime-types') || !(operand instanceof ObjectValue)) {
    return null;
  }
  return LookupClassOperator(operand, `unary ${opText}`);
}

/** https://tc39.es/ecma262/#sec-bitwise-not-operator-runtime-semantics-evaluation */
//   UnaryExpression : `~` UnaryExpression
function* Evaluate_UnaryExpression_Tilde({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // proposal-runtime-types R3: read the raw value first; bitwise NOT preserves
  // the numeric value type and must see it before ToNumeric unwraps.
  const rawValue = Q(yield* GetValue(expr));
  if (surroundingAgent.feature('runtime-types') && rawValue instanceof TypedNumberValue) {
    return typedUnary('~', rawValue as TypedNumberValue);
  }
  // proposal-runtime-types (operatoroverloading.md): a class unary operator.
  const unaryOp = findUnaryClassOperator(rawValue, '~');
  if (unaryOp !== null) {
    return Q(yield* Call(unaryOp, rawValue, []));
  }
  // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
  const oldValue = Q(yield* ToNumeric(rawValue));
  // 3. If oldValue is a Number, then
  if (oldValue instanceof NumberValue) {
    // a. Return Number::bitwiseNOT(oldValue).
    return NumberValue.bitwiseNOT(oldValue);
  } else {
    // a. Assert: oldValue is a BigInt.
    // b. Return BigInt::bitwiseNOT(oldValue).
    Assert(oldValue instanceof BigIntValue);
    return BigIntValue.bitwiseNOT(oldValue);
  }
}

/** https://tc39.es/ecma262/#sec-logical-not-operator-runtime-semantics-evaluation */
//   UnaryExpression : `!` UnaryExpression
function* Evaluate_UnaryExpression_Bang({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  const rawValue = Q(yield* GetValue(expr));
  // proposal-runtime-types (operatoroverloading.md): a class logical-not operator.
  const unaryOp = findUnaryClassOperator(rawValue, '!');
  if (unaryOp !== null) {
    return Q(yield* Call(unaryOp, rawValue, []));
  }
  // 2. Let oldValue be ! ToBoolean(? GetValue(expr)).
  const oldValue = ToBoolean(rawValue);
  // 3. If oldValue is true, return false.
  if (oldValue === Value.true) {
    return Value.false;
  }
  // 4. Return true.
  return Value.true;
}

// UnaryExpression :
//  `delete` UnaryExpression
//  `void` UnaryExpression
//  `typeof` UnaryExpression
//  `+` UnaryExpression
//  `-` UnaryExpression
//  `~` UnaryExpression
//  `!` UnaryExpression
export function* Evaluate_UnaryExpression(UnaryExpression: ParseNode.UnaryExpression) {
  switch (UnaryExpression.operator) {
    case 'delete':
      Q(surroundingAgent.debugger_cannotPreview);
      return yield* Evaluate_UnaryExpression_Delete(UnaryExpression);
    case 'void':
      return yield* Evaluate_UnaryExpression_Void(UnaryExpression);
    case 'typeof':
      return yield* Evaluate_UnaryExpression_Typeof(UnaryExpression);
    case '+':
      return yield* Evaluate_UnaryExpression_Plus(UnaryExpression);
    case '-':
      return yield* Evaluate_UnaryExpression_Minus(UnaryExpression);
    case '~':
      return yield* Evaluate_UnaryExpression_Tilde(UnaryExpression);
    case '!':
      return yield* Evaluate_UnaryExpression_Bang(UnaryExpression);

    default:
      throw OutOfRange.nonExhaustive(UnaryExpression);
  }
}
