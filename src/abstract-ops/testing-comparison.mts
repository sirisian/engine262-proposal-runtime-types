import {
  BigIntValue,
  BooleanValue, UndefinedValue,
  SymbolValue,
  JSStringValue,
  NumberValue,
  ObjectValue,
  TypedNumberValue,
  Value,
  wellKnownSymbols,
  unwrapToNumber,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { SameType as SameTypeRecord } from '../type-system/relations.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { isRationalObject, rationalEquals, rationalCompare } from '../intrinsics/Rational.mts';
import {
  Assert,
  surroundingAgent,
  Get,
  ToBoolean,
  ToNumber,
  ToNumeric,
  ToPrimitive,
  StringToBigInt,
  isProxyExoticObject,
  isArrayExoticObject, R,
  SameType,
  type FunctionObject,
  type PropertyKeyValue,
  Throw,
  type PlainEvaluator,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-testing-and-comparison-operations */

/** https://tc39.es/ecma262/#sec-requireobjectcoercible */
export function RequireObjectCoercible(argument: Value) {
  if (argument === Value.undefined) {
    return Throw.TypeError('Cannot convert $1 to object', 'undefined');
  }
  if (argument === Value.null) {
    return Throw.TypeError('Cannot convert $1 to object', 'null');
  }
  return undefined;
}

/** https://tc39.es/ecma262/#sec-isarray */
export function IsArray(argument: Value) {
  if (!(argument instanceof ObjectValue)) {
    return Value.false;
  }
  if (isArrayExoticObject(argument)) {
    return Value.true;
  }
  if (isProxyExoticObject(argument)) {
    if (argument.ProxyHandler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'IsArray');
    }
    const target = argument.ProxyTarget;
    return IsArray(target);
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-iscallable */
export function IsCallable(argument: Value): argument is FunctionObject {
  if (!(argument instanceof ObjectValue)) {
    return false;
  }
  if ('Call' in argument) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-isconstructor */
export function IsConstructor(argument: Value): argument is FunctionObject {
  if (!(argument instanceof ObjectValue)) {
    return false;
  }
  if ('Construct' in argument) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-isextensible-o */
export function* IsExtensible(O: ObjectValue) {
  Assert(O instanceof ObjectValue);
  return yield* O.IsExtensible();
}

/** https://tc39.es/ecma262/#sec-isinteger */
export function IsIntegralNumber(argument: Value) {
  if (!(argument instanceof NumberValue)) {
    return Value.false;
  }
  if (argument.isNaN() || argument.isInfinity()) {
    return Value.false;
  }
  if (Math.floor(Math.abs(R(argument))) !== Math.abs(R(argument))) {
    return Value.false;
  }
  return Value.true;
}

/** https://tc39.es/ecma262/#sec-ispropertykey */
export function IsPropertyKey(argument: unknown): argument is PropertyKeyValue {
  if (argument instanceof JSStringValue) {
    return true;
  }
  if (argument instanceof SymbolValue) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-isregexp */
export function* IsRegExp(argument: Value): ValueEvaluator<BooleanValue> {
  if (!(argument instanceof ObjectValue)) {
    return Value.false;
  }
  const matcher = Q(yield* Get(argument, wellKnownSymbols.match));
  if (matcher !== Value.undefined) {
    return ToBoolean(matcher);
  }
  if ('RegExpMatcher' in argument) {
    return Value.true;
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-isstringprefix */
export function IsStringPrefix(p: JSStringValue, q: JSStringValue) {
  Assert(p instanceof JSStringValue);
  Assert(q instanceof JSStringValue);
  return q.stringValue().startsWith(p.stringValue());
}

/** https://tc39.es/ecma262/#sec-samevalue */
// proposal-runtime-types R1 #sec-value-types: a value type has no identity, so
// two typed numbers are the same value iff their Type Records are the same and
// their payloads match; a typed number is never the same value as a plain
// Number. Returns a verdict when at least one operand is typed, else null so
// the caller falls through to the ordinary Number path.
/**
 * proposal-runtime-types R1: typed numbers have value-type identity.
 *
 * `zeroInsensitive` is what parts SameValue from SameValueZero for them. The
 * specification enumerates the SameValueZero equivalence classes with more than
 * one member as "the signed zeros, handled above for the Number type and EACH
 * BINARY FLOAT WIDTH, and the decimal cohorts" - so `float32(-0)` and
 * `float32(+0)` are ONE class, exactly as `-0` and `+0` are for Number, while
 * SameValue keeps them apart.
 *
 * This was one comparison serving both, on the reasoning that "a value type has
 * no separate zero identity ... there is no distinct -0 typed value here".
 * There is: `float32(-0)` is a value and `Object.is` tells it from `float32(0)`.
 * The consequence was that a typed negative zero and a typed positive zero were
 * two Map keys where the specification makes them one - and that is the relation
 * composite interning is defined over, so a composite would have stored a value
 * unequal to the one its own clause says it stores.
 */
function typedNumberIdentity(x: Value, y: Value, zeroInsensitive = false): boolean | null {
  const xt = x instanceof TypedNumberValue;
  const yt = y instanceof TypedNumberValue;
  if (!xt && !yt) {
    return null;
  }
  if (!xt || !yt) {
    return false;
  }
  if (!SameTypeRecord((x as TypedNumberValue).TypeRecord as TypeRecord, (y as TypedNumberValue).TypeRecord as TypeRecord)) {
    return false;
  }
  // proposal-runtime-types R6: unwrap both to plain Numbers before the payload
  // comparison. A typed number is no longer a NumberValue, so it lacks the
  // isNaN/isFinite helpers Number::sameValue calls; unwrapToNumber gives a real
  // NumberValue with the same payload.
  const xn = unwrapToNumber(x as TypedNumberValue);
  const yn = unwrapToNumber(y as TypedNumberValue);
  if (zeroInsensitive) {
    return NumberValue.sameValueZero(xn, yn) === Value.true;
  }
  return NumberValue.sameValue(xn, yn) === Value.true;
}

export function SameValue(x: Value, y: Value): boolean {
  // proposal-runtime-types (rational.md): a rational's identity is its canonical
  // value, so SameValue and SameValueZero compare it structurally, which is what
  // lets it serve as a Map or Set key by value.
  if (surroundingAgent.feature('runtime-types') && (isRationalObject(x) || isRationalObject(y))) {
    return isRationalObject(x) && isRationalObject(y) && rationalEquals(x, y);
  }
  // proposal-runtime-types R1: typed numbers have value-type identity.
  const typed = typedNumberIdentity(x, y);
  if (typed !== null) {
    return typed;
  }
  // If SameType(x, y) is false, return false.
  if (!SameType(x, y)) {
    return false;
  }
  // If x is a Number, then
  if (x instanceof NumberValue) {
    // a. Return Number::sameValue(x, y).
    return NumberValue.sameValue(x, y as NumberValue) === Value.true;
  }
  // 3. Return SameValueNonNumber(x, y).
  return SameValueNonNumber(x, y);
}

/** https://tc39.es/ecma262/#sec-samevaluezero */
export function SameValueZero(x: Value, y: Value): boolean {
  // proposal-runtime-types (rational.md): a rational's identity is its canonical
  // value, so SameValue and SameValueZero compare it structurally, which is what
  // lets it serve as a Map or Set key by value.
  if (surroundingAgent.feature('runtime-types') && (isRationalObject(x) || isRationalObject(y))) {
    return isRationalObject(x) && isRationalObject(y) && rationalEquals(x, y);
  }
  // proposal-runtime-types R1: typed numbers have value-type identity, and
  // SameValueZero compares NUMERICAL VALUE within a type where SameValue
  // distinguishes representations - so a typed signed zero pairs with its
  // opposite here and not there.
  const typed = typedNumberIdentity(x, y, true);
  if (typed !== null) {
    return typed;
  }
  // 1. If SameType(x, y) is false, return false.
  if (!SameType(x, y)) {
    return false;
  }
  // 2. If x is a Number, then
  if (x instanceof NumberValue) {
    // a. Return Number::sameValueZero(x, y).
    return NumberValue.sameValueZero(x, y as NumberValue) === Value.true;
  }
  // 3. Return SameValueNonNumber(x, y).
  return SameValueNonNumber(x, y);
}

/** https://tc39.es/ecma262/#sec-samevaluenonnumber */
export function SameValueNonNumber(x: Value, y: Value): boolean {
  Assert(SameType(x, y));

  if (x === Value.undefined || x === Value.null) {
    return true;
  }

  if (x instanceof BigIntValue) {
    return BigIntValue.equal(x, y as BigIntValue) === Value.true;
  }

  if (x instanceof JSStringValue) {
    return x.stringValue() === (y as JSStringValue).stringValue();
  }

  if (x instanceof BooleanValue) {
    if (x === Value.true && y === Value.true) return true;
    if (x === Value.false && y === Value.false) return true;
    return false;
  }
  return x === y;
}

/** https://tc39.es/ecma262/#sec-islessthan */
export function* IsLessThan(x: Value, y: Value, LeftFirst = true): ValueEvaluator<BooleanValue | UndefinedValue> {
  // proposal-runtime-types (rational.md): rationals have an exact total order by
  // cross-multiplication with positive denominators, so the comparison never
  // rounds and never converts the operands.
  if (surroundingAgent.feature('runtime-types') && isRationalObject(x) && isRationalObject(y)) {
    return rationalCompare(x, y) < 0 ? Value.true : Value.false;
  }
  let px;
  let py;
  // 1. If the LeftFirst flag is true, then
  if (LeftFirst === true) {
    // a. Let px be ? ToPrimitive(x, number).
    px = Q(yield* ToPrimitive(x, 'number'));
    // b. Let py be ? ToPrimitive(y, number).
    py = Q(yield* ToPrimitive(y, 'number'));
  } else {
    // a. NOTE: The order of evaluation needs to be reversed to preserve left to right evaluation.
    // b. Let py be ? ToPrimitive(y, number).
    py = Q(yield* ToPrimitive(y, 'number'));
    // c. Let px be ? ToPrimitive(x, number).
    px = Q(yield* ToPrimitive(x, 'number'));
  }
  // 3. If Type(px) is String and Type(py) is String, then
  if (px instanceof JSStringValue && py instanceof JSStringValue) {
    // a. If IsStringPrefix(py, px) is true, return false.
    if (IsStringPrefix(py, px)) {
      return Value.false;
    }
    // b. If IsStringPrefix(px, py) is true, return true.
    if (IsStringPrefix(px, py)) {
      return Value.true;
    }
    // c. Let k be the smallest nonnegative integer such that the code unit at index k within px
    //    is different from the code unit at index k within py. (There must be such a k, for
    //    neither String is a prefix of the other.)
    let k = 0;
    while (true) {
      if (px.stringValue()[k] !== py.stringValue()[k]) {
        break;
      }
      k += 1;
    }
    // d. Let m be the integer that is the numeric value of the code unit at index k within px.
    const m = px.stringValue().charCodeAt(k);
    // e. Let n be the integer that is the numeric value of the code unit at index k within py.
    const n = py.stringValue().charCodeAt(k);
    // f. If m < n, return true. Otherwise, return false.
    if (m < n) {
      return Value.true;
    } else {
      return Value.false;
    }
  } else {
    // a. If Type(px) is BigInt and Type(py) is String, then
    if (px instanceof BigIntValue && py instanceof JSStringValue) {
      // i. Let ny be StringToBigInt(py).
      const ny = StringToBigInt(py);
      // ii. If ny is undefined, return undefined.
      if (ny === undefined) {
        return Value.undefined;
      }
      // iii. Return BigInt::lessThan(px, ny).
      return BigIntValue.lessThan(px, ny);
    }
    // b. If Type(px) is String and Type(py) is BigInt, then
    if (px instanceof JSStringValue && py instanceof BigIntValue) {
      // i. Let ny be StringToBigInt(py).
      const nx = StringToBigInt(px);
      // ii. If ny is undefined, return undefined.
      if (nx === undefined) {
        return Value.undefined;
      }
      // iii. Return BigInt::lessThan(px, ny).
      return BigIntValue.lessThan(nx, py);
    }
    // c. Let nx be ? ToNumeric(px). NOTE: Because px and py are primitive values evaluation order is not important.
    const nx = Q(yield* ToNumeric(px));
    // d. Let ny be ? ToNumeric(py).
    const ny = Q(yield* ToNumeric(py));
    // e. If Type(nx) is the same as Type(ny), return Type(nx)::lessThan(nx, ny).
    if (SameType(nx, ny)) {
      if (nx instanceof NumberValue) {
        return NumberValue.lessThan(nx, ny as NumberValue);
      } else {
        Assert(nx instanceof BigIntValue);
        return BigIntValue.lessThan(nx, ny as BigIntValue);
      }
    }
    // f. Assert: Type(nx) is BigInt and Type(ny) is Number, or Type(nx) is Number and Type(ny) is BigInt.
    Assert((nx instanceof BigIntValue && ny instanceof NumberValue) || (nx instanceof NumberValue && ny instanceof BigIntValue));
    // g. If nx or ny is NaN, return undefined.
    if ((nx.isNaN && nx.isNaN()) || (ny.isNaN && ny.isNaN())) {
      return Value.undefined;
    }
    // h. If nx is -∞ or ny is +∞, return true.
    if ((nx instanceof NumberValue && R(nx) === -Infinity) || (ny instanceof NumberValue && R(ny) === +Infinity)) {
      return Value.true;
    }
    // i. If nx is +∞ or ny is -∞, return false.
    if ((nx instanceof NumberValue && R(nx) === +Infinity) || (ny instanceof NumberValue && R(ny) === -Infinity)) {
      return Value.false;
    }
    // j. If the mathematical value of nx is less than the mathematical value of ny, return true; otherwise return false.
    const a = R(nx);
    const b = R(ny);
    return a < b ? Value.true : Value.false;
  }
}

/** https://tc39.es/ecma262/#sec-islooselyequal */
/**
 * proposal-runtime-types: the mathematical value of a numeric operand for the
 * loose equality above, or undefined when the operand is not numeric (a String,
 * Boolean, or Object keeps the ordinary algorithm's coercion steps). A typed
 * number always carries a Number payload, wide integer types included, so a
 * bigint here only ever comes from a plain BigInt operand.
 */
function mathematicalValueForLooseEquality(v: Value): number | bigint | undefined {
  if (v instanceof TypedNumberValue) {
    return (v as TypedNumberValue).numberValue(); // eslint-disable-line @engine262/mathematical-value -- R asserts instanceof NumberValue, which a typed number is not
  }
  if (v instanceof NumberValue) {
    return R(v as NumberValue);
  }
  if (v instanceof BigIntValue) {
    return R(v as BigIntValue);
  }
  return undefined;
}

/** Exact mathematical comparison, including across a Number and a BigInt. */
function sameMathematicalValue(a: number | bigint, b: number | bigint): boolean {
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a === b;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b;
  }
  // One of each: a NaN or a non-integral Number equals no BigInt, and otherwise
  // the comparison is exact once the Number is taken to a BigInt.
  const n = typeof a === 'number' ? a : (b as number);
  const big = typeof a === 'bigint' ? a : (b as bigint);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return false;
  }
  return BigInt(n) === big;
}

export function* IsLooselyEqual(x: Value, y: Value): PlainEvaluator<boolean> {
  // proposal-runtime-types (spec, the equality operators): `==` and `!=` between
  // typed values, and between a typed value and a plain Number or BigInt, compare
  // MATHEMATICAL values, so `uint8(1) == uint16(1)` is true even though
  // `uint8(1) === uint16(1)` is false. `===` keeps identity semantics and the
  // values of distinct value types are distinct, while equality asks a question
  // and produces a Boolean whatever its operands' types, so it has no result type
  // to fix and no information to lose by answering. Arithmetic across two value
  // types remains an error; the two are deliberately not aligned. This runs ahead
  // of the SameType step below, which would otherwise route two typed numbers of
  // different types into the strict comparison and answer false.
  if (surroundingAgent.feature('runtime-types')
      && (x instanceof TypedNumberValue || y instanceof TypedNumberValue)) {
    const xm = mathematicalValueForLooseEquality(x);
    const ym = mathematicalValueForLooseEquality(y);
    if (xm !== undefined && ym !== undefined) {
      return sameMathematicalValue(xm, ym);
    }
  }
  // 1. If SameType(x, y) is true, then
  if (SameType(x, y)) {
    // a. Return the result of performing Strict Equality Comparison x === y.
    return IsStrictlyEqual(x, y);
  }
  // 2. If x is null and y is undefined, return true.
  if (x === Value.null && y === Value.undefined) {
    return true;
  }
  // 3. If x is undefined and y is null, return true.
  if (x === Value.undefined && y === Value.null) {
    return true;
  }
  // 4. If Type(x) is Number and Type(y) is String, return the result of the comparison x == ! ToNumber(y).
  if (x instanceof NumberValue && y instanceof JSStringValue) {
    return X(yield* IsLooselyEqual(x, X(ToNumber(y))));
  }
  // 5. If Type(x) is String and Type(y) is Number, return the result of the comparison ! ToNumber(x) == y.
  if (x instanceof JSStringValue && y instanceof NumberValue) {
    return X(yield* IsLooselyEqual(X(ToNumber(x)), y));
  }
  // 6. If Type(x) is BigInt and Type(y) is String, then
  if (x instanceof BigIntValue && y instanceof JSStringValue) {
    // a. Let n be StringToBigInt(y).
    const n = StringToBigInt(y);
    // b. If n is undefined, return false.
    if (n === undefined) {
      return false;
    }
    // c. Return the result of the comparison x == n.
    return X(yield* IsLooselyEqual(x, n));
  }
  // 7. If Type(x) is String and Type(y) is BigInt, return the result of the comparison y == x.
  if (x instanceof JSStringValue && y instanceof BigIntValue) {
    return X(yield* IsLooselyEqual(y, x));
  }
  // 8. If Type(x) is Boolean, return the result of the comparison ! ToNumber(x) == y.
  if (x instanceof BooleanValue) {
    return X(yield* IsLooselyEqual(X(ToNumber(x)), y));
  }
  // 9. If Type(y) is Boolean, return the result of the comparison x == ! ToNumber(y).
  if (y instanceof BooleanValue) {
    return X(yield* IsLooselyEqual(x, X(ToNumber(y))));
  }
  // 10. If Type(x) is either String, Number, BigInt, or Symbol and Type(y) is Object, return the result of the comparison x == ToPrimitive(y).
  if ((x instanceof JSStringValue || x instanceof NumberValue || x instanceof BigIntValue || x instanceof SymbolValue) && y instanceof ObjectValue) {
    return X(yield* IsLooselyEqual(x, Q(yield* ToPrimitive(y))));
  }
  // 11. If Type(x) is Object and Type(y) is either String, Number, BigInt, or Symbol, return the result of the comparison ToPrimitive(x) == y.
  if (x instanceof ObjectValue && (y instanceof JSStringValue || y instanceof NumberValue || y instanceof BigIntValue || y instanceof SymbolValue)) {
    return X(yield* IsLooselyEqual(Q(yield* ToPrimitive(x)), y));
  }
  // 12. If Type(x) is BigInt and Type(y) is Number, or if Type(x) is Number and Type(y) is BigInt, then
  if ((x instanceof BigIntValue && y instanceof NumberValue) || (x instanceof NumberValue && y instanceof BigIntValue)) {
    // a. If x or y are any of NaN, +∞, or -∞, return false.
    if ((x.isNaN && (x.isNaN() || !x.isFinite())) || (y.isNaN && (y.isNaN() || !y.isFinite()))) {
      return false;
    }
    // b. If the mathematical value of x is equal to the mathematical value of y, return true; otherwise return false.
    const a = R(x);
    const b = R(y);
    return a == b; // eslint-disable-line eqeqeq
  }
  // 13. Return false.
  return false;
}

/** https://tc39.es/ecma262/#sec-isstrictlyequal */
export function IsStrictlyEqual(x: Value, y: Value): boolean {
  // proposal-runtime-types (rational.md): two rationals are strictly equal iff
  // they are the same canonical value, which is byte equality of the reduced
  // numerator and denominator; a rational is never strictly equal to anything
  // else. This is what makes a rational usable as a Map or Set key by value.
  if (surroundingAgent.feature('runtime-types') && (isRationalObject(x) || isRationalObject(y))) {
    return isRationalObject(x) && isRationalObject(y) && rationalEquals(x, y);
  }
  // proposal-runtime-types R1: === distinguishes value types. Two typed numbers
  // are strictly equal iff same type and same payload; a typed number is never
  // strictly equal to a plain Number.
  const xt = x instanceof TypedNumberValue;
  const yt = y instanceof TypedNumberValue;
  if (xt || yt) {
    if (!xt || !yt) {
      return false;
    }
    if (!SameTypeRecord((x as TypedNumberValue).TypeRecord as TypeRecord, (y as TypedNumberValue).TypeRecord as TypeRecord)) {
      return false;
    }
    // proposal-runtime-types R6: unwrap both to plain Numbers; a typed number
    // lacks the helpers Number::equal relies on.
    return NumberValue.equal(unwrapToNumber(x as TypedNumberValue), unwrapToNumber(y as TypedNumberValue)) === Value.true;
  }
// 1. If SameType(x, y) is false, return false.
  if (!SameType(x, y)) {
    return false;
  }
  // 2. If x is a Number, then
  if (x instanceof NumberValue) {
    // a. Return Number::equal(x, y).
    return NumberValue.equal(x, y as unknown as NumberValue) === Value.true;
  }
  // 3. Return SameValueNonNumber(x, y).
  return SameValueNonNumber(x, y);
}
