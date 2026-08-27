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
  Descriptor,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { OrdinaryObjectCreate, OrdinaryGetPrototypeOf } from './all.mts';
import { SameType as SameTypeRecord } from '../type-system/relations.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { LayoutOf, type ClassLayout } from '../type-system/layout.mts';
import { RuntimeTypeOf } from '../type-system/runtime.mts';
import { isRationalObject, rationalEquals, rationalCompare } from '../intrinsics/Rational.mts';
import { isComplexObject, complexSameValue, complexEquals } from '../intrinsics/Complex.mts';
import { isDecimalObject, decimalEquals, decimalSameValue, decimalCompare } from '../intrinsics/Decimal.mts';
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
  // A value of a type wider than 53 bits carries its payload exactly, and
  // #sec-integer-types gives such a type "exactly 2**N values" - so comparing
  // through a Number would make adjacent values equal, which is the identity
  // half of what a double backing costs. Both carry the same representation
  // here, since the type records already matched above.
  const xv = (x as TypedNumberValue).value;
  const yv = (y as TypedNumberValue).value;
  if (typeof xv === 'bigint' || typeof yv === 'bigint') {
    return (x as TypedNumberValue).bigintValue() === (y as TypedNumberValue).bigintValue();
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
  // A VALUE TYPE CLASS compares by its fields here as it does at
  // `IsStrictlyEqual` and `SameValueZero` (D27). #sec-value-types: "two values
  // of the same value type that are the same value are indistinguishable", and
  // `Object.is` is a way of asking whether two values are the same one.
  //
  // Those two were hooked and this was not, so `_a_ === _b_` answered *true*
  // for two field-equal instances while `Object.is(_a_, _b_)` answered *false*.
  // Nearly unreachable while assignment ALIASES - most comparisons are then of a
  // thing with itself - and reached immediately once assignment COPIES, which
  // #sec-value-type-copying requires and which is the change this accompanies.
  const asValueClass = valueClassEquals(x, y, false);
  if (asValueClass !== undefined) {
    return asValueClass;
  }
  // proposal-runtime-types (rational.md): a rational's identity is its canonical
  // value, so SameValue and SameValueZero compare it structurally, which is what
  // lets it serve as a Map or Set key by value.
  if (surroundingAgent.feature('runtime-types') && (isRationalObject(x) || isRationalObject(y))) {
    return isRationalObject(x) && isRationalObject(y) && rationalEquals(x, y);
  }
  // #sec-which-operations-each-family-defines gives the complex family equal,
  // sameValue and sameValueZero - and only those, since "the complex numbers
  // are not ordered". Compared over the PAIR, so two complexes of equal
  // components are one value and can serve as a Map or Set key.
  if (surroundingAgent.feature('runtime-types') && (isComplexObject(x) || isComplexObject(y))) {
    return isComplexObject(x) && isComplexObject(y) && complexSameValue(x, y);
  }
  // proposal-runtime-types (decimal.md): a decimal's identity is its COHORT
  // MEMBER. "SameValue distinguishes cohort members, so `Object.is(1.0, 1.00)`
  // is *false* for two `decimal128` values of different exponents, while
  // SameValueZero and `==` compare numerical value and find them equal."
  //
  // IEEE 754 draws the same distinction with `totalOrder` against
  // `compareQuietEqual`, so the two predicates here are the standard's two
  // rather than an invention of this proposal.
  if (surroundingAgent.feature('runtime-types') && (isDecimalObject(x) || isDecimalObject(y))) {
    return isDecimalObject(x) && isDecimalObject(y) && decimalSameValue(x, y);
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
/**
 * proposal-runtime-types #sec-equality-and-comparison and #value-type-class: the
 * identity of a value type is its VALUE, so two instances of a value type class
 * are equal exactly when their fields are, compared field by field.
 *
 * "That `===` compares a value type class field by field rather than by
 * reference is what makes a value type a value: two `Vector2` instances holding
 * the same coordinates are the same value, AND A `Map` KEYED ON THEM HAS ONE
 * ENTRY. This is the existing rule for a `uint8` and a String applied to an
 * aggregate, not a new one."
 *
 * Before this, both instances fell through to SameValueNonNumber - reference
 * identity - so `new Vector2() === new Vector2()` was *false* and a Map keyed on
 * them had two entries. The scalar and built-in aggregate value types (rational,
 * complex, decimal, and the typed numbers) each had a branch already; the
 * user-declared aggregate had none.
 *
 * WHICH CLASSES. A class is a value type class exactly where it has a layout,
 * which is the condition #sec-layout-finiteness states and the predicate
 * `IsSharableValueType` already computes for `shared`. A class with a String, an
 * object, or a dynamic-array field has no layout and keeps reference identity,
 * which is what makes this rule apply to the aggregates that are values and to
 * nothing else.
 *
 * FIELD BY FIELD RATHER THAN BYTE BY BYTE, though #sec-default-values observes
 * that two instances equal field by field "are also equal byte for byte". The
 * derivation runs one way only: a byte comparison would report `-0` and `+0` as
 * different when `===` says they are the same, and would report two NaNs with
 * differing bit patterns as the same when `===` says neither is. Padding being
 * zero-filled makes the two agree on the instances an engine allocates; the
 * float rules make them disagree on the values a program writes.
 *
 * SAME CLASS REQUIRED. Distinct classes are distinct types even when
 * structurally identical, so two layouts that happen to match are not one type
 * and their instances are not one value.
 *
 * _zero_ selects SameValueZero at the leaves rather than `===`, which is what a
 * `Map` key needs: a `Vector2` holding a NaN is findable, and one holding `-0`
 * pairs with one holding `+0`, exactly as a bare NaN or `-0` key does.
 */
/**
 * A copy of _v_ where _v_ is an instance of a VALUE TYPE CLASS, or _v_ itself.
 *
 * #sec-typed-classes: "A typed class is a value type class when every one of its
 * fields has a type that is a value type. Instances ... are values in the sense
 * of #sec-value-types ... and ASSIGNING ONE COPIES IT."
 *
 * WHAT A COPY MUST CARRY, enumerated from an instance rather than assumed - four
 * attempts failed here, each losing a different thing:
 *
 *   - the FIELDS, taken from the LAYOUT so the copy holds what the storage holds
 *     rather than what a type record describes;
 *   - [[ConstructedBy]], the constructor list, which is what
 *     `OrdinaryPreventExtensions` and the sealing rules read;
 *   - [[TypedProperties]], the per-property type marks that make a store to a
 *     field check the field's declared type;
 *   - the PROTOTYPE, and the sealed state that #sec-typed-storage requires.
 *
 * Losing [[ConstructedBy]] and [[TypedProperties]] is what made an earlier copy
 * report the wrong `Reflect.typeOf`: an instance's nominal type is not derived
 * from its shape.
 *
 * The CALLER decides whether a copy is wanted. This operation cannot tell a
 * construction from a read, and #sec-value-type-copying makes that difference
 * decisive - construction builds in place and must NOT copy.
 */
export function CopyValueClassInstance(v: Value): Value {
  if (!surroundingAgent.feature('runtime-types') || !(v instanceof ObjectValue)) {
    return v;
  }
  const t = RuntimeTypeOf(v);
  if (t.Kind !== 'nominal' || t.EnumMembers !== undefined) {
    return v;
  }
  const layout = LayoutOf(t) as ClassLayout | null;
  if (layout === null || layout.fields === undefined) {
    return v;
  }
  const source = v as unknown as {
    ConstructedBy?: unknown[],
    TypedProperties?: Map<unknown, object>,
    BrandTypeRecord?: TypeRecord,
  };
  // `OrdinaryGetPrototypeOf`, NOT `v.GetPrototypeOf()`: the slot is a GENERATOR
  // method (`* GetPrototypeOf()`), so calling it directly yields a generator
  // object rather than the prototype - and `RuntimeTypeOf` finds a class
  // instance's nominal type "by walking the prototype chain to a constructor
  // with an associated class Type Object", so a junk prototype loses the type
  // silently. `Get` is a generator for the same reason and is called through its
  // abstract operation just below.
  const copy = OrdinaryObjectCreate(OrdinaryGetPrototypeOf(v as never) as ObjectValue, []);
  const target = copy as unknown as {
    ConstructedBy?: unknown[],
    TypedProperties?: Map<unknown, object>,
  };
  if (source.ConstructedBy !== undefined) {
    target.ConstructedBy = [...source.ConstructedBy];
  }
  if (source.TypedProperties !== undefined) {
    target.TypedProperties = new Map(source.TypedProperties);
  }
  if (source.BrandTypeRecord !== undefined) {
    Object.defineProperty(copy, 'BrandTypeRecord', {
      value: source.BrandTypeRecord, enumerable: false, configurable: true,
    });
  }
  for (const field of layout.fields) {
    // A PRIVATE field is not reachable through Get and needs the private element
    // list. Bailing out leaves such a class aliasing, which is wrong - but a copy
    // missing half its state is worse, and the gap is recorded rather than
    // silently shipped.
    if (typeof field.key !== 'string') {
      return v;
    }
    const key = Value(field.key);
    X(copy.DefineOwnProperty(key, Descriptor({
      Value: X(Get(v, key)),
      Writable: Value.true,
      Enumerable: Value.true,
      Configurable: Value.false,
    })));
  }
  X(copy.PreventExtensions());
  return copy;
}

function valueClassEquals(x: Value, y: Value, zero: boolean): boolean | undefined {
  if (!surroundingAgent.feature('runtime-types')
      || !(x instanceof ObjectValue) || !(y instanceof ObjectValue)) {
    return undefined;
  }
  const xt = RuntimeTypeOf(x);
  const yt = RuntimeTypeOf(y);
  if (xt.Kind !== 'nominal' || yt.Kind !== 'nominal' || xt.EnumMembers !== undefined) {
    return undefined;
  }
  const layout = LayoutOf(xt) as ClassLayout | null;
  if (layout === null || layout.fields === undefined) {
    return undefined;
  }
  // Distinct classes are distinct types: two matching layouts are not one type.
  if (!SameTypeRecord(xt, yt)) {
    return false;
  }
  for (const field of layout.fields) {
    if (typeof field.key !== 'string') {
      continue;
    }
    const key = Value(field.key);
    const xv = X(Get(x, key));
    const yv = X(Get(y, key));
    if (!fieldEquals(xv, yv, field.type, zero)) {
      return false;
    }
  }
  return true;
}

/**
 * Compare one field, by its DECLARED type rather than by what the values happen
 * to be.
 *
 * "a value type field recursively and structurally, a fixed-length array field
 * element by element, since it's inline storage, and a reference field by
 * identity."
 *
 * The fixed-extent array is the case that needs saying. Its field holds an Array
 * object, and comparing two of those the ordinary way is reference identity - so
 * a class with a `[4].<uint32>` field was unequal to a copy of itself, which is
 * the one shape where "field by field" alone gives the wrong answer. The array
 * is INLINE STORAGE in the layout, not a reference the class points at, so its
 * elements are as much part of the value as a scalar field is.
 *
 * A DYNAMIC array field does not arise: it has no layout, so a class holding one
 * is not a value type class and never reaches here.
 */
function fieldEquals(xv: Value, yv: Value, t: TypeRecord, zero: boolean): boolean {
  if (t.Kind === 'array' && typeof (t as { Extent?: unknown }).Extent === 'number') {
    const extent = (t as { Extent: number }).Extent;
    const element = (t as { Element: TypeRecord }).Element;
    if (!(xv instanceof ObjectValue) || !(yv instanceof ObjectValue)) {
      return zero ? SameValueZero(xv, yv) : IsStrictlyEqual(xv, yv);
    }
    for (let i = 0; i < extent; i += 1) {
      const k = Value(String(i));
      if (!fieldEquals(X(Get(xv, k)), X(Get(yv, k)), element, zero)) {
        return false;
      }
    }
    return true;
  }
  return zero ? SameValueZero(xv, yv) : IsStrictlyEqual(xv, yv);
}

export function SameValueZero(x: Value, y: Value): boolean {
  const asValueClass = valueClassEquals(x, y, true);
  if (asValueClass !== undefined) {
    return asValueClass;
  }
  // proposal-runtime-types (rational.md): a rational's identity is its canonical
  // value, so SameValue and SameValueZero compare it structurally, which is what
  // lets it serve as a Map or Set key by value.
  if (surroundingAgent.feature('runtime-types') && (isRationalObject(x) || isRationalObject(y))) {
    return isRationalObject(x) && isRationalObject(y) && rationalEquals(x, y);
  }
  // #sec-which-operations-each-family-defines gives the complex family equal,
  // sameValue and sameValueZero - and only those, since "the complex numbers
  // are not ordered". Compared over the PAIR, so two complexes of equal
  // components are one value and can serve as a Map or Set key.
  if (surroundingAgent.feature('runtime-types') && (isComplexObject(x) || isComplexObject(y))) {
    return isComplexObject(x) && isComplexObject(y) && complexSameValue(x, y);
  }
  // proposal-runtime-types (decimal.md): SameValueZero compares a decimal's
  // NUMERICAL VALUE, so `1.0` and `1.00` are ONE Map key where `Object.is`
  // tells them apart. This is the split Java's `BigDecimal` famously does NOT
  // make - its `equals` compares scale while `compareTo` does not, so a HashSet
  // and a TreeSet disagree about how many elements it holds - and avoiding that
  // is the reason the two predicates differ here.
  if (surroundingAgent.feature('runtime-types') && (isDecimalObject(x) || isDecimalObject(y))) {
    return isDecimalObject(x) && isDecimalObject(y) && decimalEquals(x, y);
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
    // PLAN-brand-layering-F.md. Compare the VALUE, not the object: a Boolean
    // carrying a Type Record is not one of the two singletons, and comparing by
    // identity made `B(true) === true` answer false.
    return x.booleanValue() === (y as BooleanValue).booleanValue();
    return false;
  }
  return x === y;
}

/** https://tc39.es/ecma262/#sec-islessthan */
export function* IsLessThan(x: Value, y: Value, LeftFirst = true): ValueEvaluator<BooleanValue | UndefinedValue> {
  // proposal-runtime-types #sec-which-operations-each-family-defines: the
  // complex family does NOT define lessThan, "since the complex numbers are not
  // ordered", and the operator table says its comparison is "equality only". So
  // every relational operator is a type error rather than an answer - without
  // this `complex(3,4) < complex(1,2)` reported *false*, which is an ordering
  // claim the type has no basis for.
  if (surroundingAgent.feature('runtime-types') && (isComplexObject(x) || isComplexObject(y))) {
    return Throw.TypeError('the complex numbers are not ordered, so this operator is not defined for a complex');
  }
  // proposal-runtime-types (rational.md): rationals have an exact total order by
  // cross-multiplication with positive denominators, so the comparison never
  // rounds and never converts the operands.
  if (surroundingAgent.feature('runtime-types') && isRationalObject(x) && isRationalObject(y)) {
    return rationalCompare(x, y) < 0 ? Value.true : Value.false;
  }
  // proposal-runtime-types (decimal.md): a decimal comparison is over NUMERICAL
  // VALUE, so `1.0 < 1.00` is false as `1.0 == 1.00` is true - the cohort is
  // invisible to the order, which is IEEE's `compareQuietLess` against its
  // `totalOrder`.
  if (surroundingAgent.feature('runtime-types') && isDecimalObject(x) && isDecimalObject(y)) {
    return decimalCompare(x, y) < 0 ? Value.true : Value.false;
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
  const asValueClass = valueClassEquals(x, y, false);
  if (asValueClass !== undefined) {
    return asValueClass;
  }
  // proposal-runtime-types (rational.md): two rationals are strictly equal iff
  // they are the same canonical value, which is byte equality of the reduced
  // numerator and denominator; a rational is never strictly equal to anything
  // else. This is what makes a rational usable as a Map or Set key by value.
  if (surroundingAgent.feature('runtime-types') && (isRationalObject(x) || isRationalObject(y))) {
    return isRationalObject(x) && isRationalObject(y) && rationalEquals(x, y);
  }
  // #sec-which-operations-each-family-defines gives the complex family equal,
  // sameValue and sameValueZero - and only those, since "the complex numbers
  // are not ordered". Compared over the PAIR, so two complexes of equal
  // components are one value and can serve as a Map or Set key.
  if (surroundingAgent.feature('runtime-types') && (isComplexObject(x) || isComplexObject(y))) {
    // `===` asks NUMERICAL equality, where the two zeroes of a component are
    // equal and a NaN component is equal to nothing - the same split every
    // other numeric type has between this and SameValue above.
    return isComplexObject(x) && isComplexObject(y) && complexEquals(x, y);
  }
  // proposal-runtime-types (decimal.md): "`==` compares numerical value, so
  // `1.0 == 1.00` is `true`". This is the half of the split that SameValue does
  // NOT make, and the pair is IEEE's `compareQuietEqual` against `totalOrder`.
  if (surroundingAgent.feature('runtime-types') && (isDecimalObject(x) || isDecimalObject(y))) {
    return isDecimalObject(x) && isDecimalObject(y) && decimalEquals(x, y);
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
    // A wide type's values are exact, so the comparison is too - through a
    // Number, `int64.parse("1152921504606846976")` and its successor would be
    // equal, which is the identity half of what a double backing costs. The
    // type records already matched, so both carry the same representation.
    const xv = (x as TypedNumberValue).value;
    const yv = (y as TypedNumberValue).value;
    if (typeof xv === 'bigint' || typeof yv === 'bigint') {
      return (x as TypedNumberValue).bigintValue() === (y as TypedNumberValue).bigintValue();
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
