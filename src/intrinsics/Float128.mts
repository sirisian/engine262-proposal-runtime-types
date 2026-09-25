import {
  ObjectValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { roundToFormat, toBinaryFloat, toShortestString, type Binary128 } from './Float128Arithmetic.mts';
import { surroundingAgent, Throw } from '#self';
import {
  CreateBuiltinFunction, Descriptor, OrdinaryObjectCreate, R, ToNumber, X, Q,
  type OrdinaryObject,
  Realm,
} from '#self';

/**
 * proposal-runtime-types #sec-binary-floating-point-types: `float128` has
 * "values of the corresponding IEEE 754-2019 binary interchange format", and
 * #table-binary-float-types gives it 128 bits with a 113-bit significand.
 *
 * No host type holds one, so a value is carried as an exact pair - a signed
 * BigInt significand and a binary exponent, the value being
 * SIGNIFICAND x 2**EXPONENT - in the shape `DecimalObject` already uses for
 * base 10. The pair is exact by construction, so nothing here rounds except
 * where the format requires it.
 *
 * WHY A SOFTWARE FORMAT RATHER THAN A DOUBLE. Every binary64 value is exactly a
 * binary128 value, so backing one with a double would be faithful for that
 * subset and silently wrong outside it - which is the shape of the wide-integer
 * defect that took four attempts to undo. A type whose
 * point is 113 bits of significand cannot be represented by 53.
 */
export interface Float128Object extends OrdinaryObject {
  /** The signed significand, exact. Zero for both zeroes and for the specials. */
  Float128Significand: bigint;
  /** The binary exponent, so the value is Float128Significand x 2**Float128Exponent. */
  Float128Exponent: number;
  /** *"finite"*, *"infinity"* or *"nan"*; a sign of -1 or 1 carries a signed zero. */
  Float128Class: 'finite' | 'infinity' | 'nan';
  Float128Sign: -1 | 1;
}

export function isFloat128Object(value: Value): value is Float128Object {
  return value instanceof ObjectValue && 'Float128Significand' in value;
}


export function CreateFloat128Value(significand: bigint, exponent: number, realmRec: Realm, cls: 'finite' | 'infinity' | 'nan' = 'finite', sign: -1 | 1 = 1): Float128Object {
  const proto = realmRec.Intrinsics['%float128.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['Float128Significand', 'Float128Exponent', 'Float128Class', 'Float128Sign']) as Mutable<Float128Object>;
  if (cls === 'finite') {
    const rounded = roundToFormat(significand, exponent);
    obj.Float128Significand = rounded.overflow ? 0n : rounded.significand;
    obj.Float128Exponent = rounded.overflow ? 0 : rounded.exponent;
    obj.Float128Class = rounded.overflow ? 'infinity' : 'finite';
    // A ZERO keeps the sign it was given rather than deriving one from the
    // significand, which is 0n for both zeroes. IEEE 754 distinguishes them and
    // so does SameValue, so losing it here would make `Object.is(-0, 0)` true
    // for float128 where it is false for every other float width.
    obj.Float128Sign = rounded.overflow
      ? (significand < 0n ? -1 : 1)
      : (rounded.significand === 0n ? sign : (rounded.significand < 0n ? -1 : 1));
  } else {
    obj.Float128Significand = 0n;
    obj.Float128Exponent = 0;
    obj.Float128Class = cls;
    obj.Float128Sign = sign;
  }
  return obj;
}

/**
 * A Number as a float128, EXACTLY. Every binary64 value is a binary128 value -
 * the format is strictly wider in both significand and exponent - so this
 * conversion never rounds, which is why it needs no rounding mode.
 */
export function Float128FromNumber(x: number, realmRec: Realm): Float128Object {
  if (Number.isNaN(x)) {
    return CreateFloat128Value(0n, 0, realmRec, 'nan');
  }
  if (!Number.isFinite(x)) {
    return CreateFloat128Value(0n, 0, realmRec, 'infinity', x < 0 ? -1 : 1);
  }
  if (x === 0) {
    return CreateFloat128Value(0n, 0, realmRec, 'finite', Object.is(x, -0) ? -1 : 1);
  }
  // Read the double's own bits rather than scaling in floating point, so the
  // pair is the value the double actually is.
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = (bits >> 63n) === 1n ? -1 : 1;
  const rawExponent = Number((bits >> 52n) & 0x7FFn);
  const rawFraction = bits & 0xF_FFFF_FFFF_FFFFn;
  const significand = rawExponent === 0 ? rawFraction : rawFraction | (1n << 52n);
  const exponent = (rawExponent === 0 ? -1074 : rawExponent - 1075);
  return CreateFloat128Value(sign === -1 ? -significand : significand, exponent, realmRec);
}

/**
 * The nearest Number, which ROUNDS: binary64 is the narrower format. Rounded
 * once from the exact value. This converted the significand to a double and then
 * scaled it, which is exact while the result is normal but ROUNDS AGAIN into the
 * double subnormal range - so a value below 2**-1022 could come out wrong.
 */
export function Float128ToNumber(v: Float128Object): number {
  return toBinaryFloat(Float128ToBinary128(v), 64);
}

/**
 * The text of a float128: the shortest decimal that reads back as the same value,
 * laid out as Number::toString lays out a Number - toString is one of the
 * operations a binary float defines. It printed the exact binary expansion,
 * truncated, so 0.1 showed 58 digits.
 */
export function Float128ToString(v: Float128Object): string {
  return toShortestString(Float128ToBinary128(v));
}

/** Two float128 values are the same value when their pairs agree. */
export function float128SameValue(x: Float128Object, y: Float128Object): boolean {
  if (x.Float128Class !== y.Float128Class) {
    return false;
  }
  if (x.Float128Class === 'nan') {
    return true;
  }
  if (x.Float128Class === 'infinity') {
    return x.Float128Sign === y.Float128Sign;
  }
  if (x.Float128Significand === 0n && y.Float128Significand === 0n) {
    return x.Float128Sign === y.Float128Sign;
  }
  return x.Float128Significand === y.Float128Significand
    && x.Float128Exponent === y.Float128Exponent;
}

/** Numerical equality, which unlike SameValue makes the two zeroes equal. */
export function float128Equals(x: Float128Object, y: Float128Object): boolean {
  if (x.Float128Class === 'nan' || y.Float128Class === 'nan') {
    return false;
  }
  if (x.Float128Significand === 0n && y.Float128Significand === 0n
    && x.Float128Class === 'finite' && y.Float128Class === 'finite') {
    return true;
  }
  return float128SameValue(x, y);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-binary-floating-point-types */
function* Float128Proto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isFloat128Object(thisValue)) {
    return Throw.TypeError('$1 is not a $2', thisValue, Value('float128'));
  }
  return Value(Float128ToString(thisValue));
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-binary-floating-point-types */
function* Float128Proto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isFloat128Object(thisValue)) {
    return Throw.TypeError('$1 is not a $2', thisValue, Value('float128'));
  }
  // REFUSES, as `decimal`'s, `rational`'s and `complex`'s do: ToNumber reaches an
  // object through valueOf, so answering here converted a float128 to a double
  // SILENTLY in every implicit Number context - which is how every operator came
  // to do double arithmetic on it. The explicit conversion is `Number(x)`,
  // `x := number` or `float64(x)`, each the same operation.
  return Throw.TypeError('a float128 has no Number value; this operation is not defined for float128');
}

function* Float128Constructor([value = Value(0)]: Arguments): ValueEvaluator {
  const n = R(Q(yield* ToNumber(value))) as number;
  return Float128FromNumber(n, surroundingAgent.currentRealmRecord);
}

/** The sign of a zero, which `Object.is` is the only reliable way to read. */
export function float128IsNegativeZero(v: Float128Object): boolean {
  return v.Float128Class === 'finite' && v.Float128Significand === 0n && v.Float128Sign === -1;
}

export function bootstrapFloat128Prototype(realmRec: Realm): void {
  const proto = bootstrapPrototype(realmRec, [
    ['toString', Float128Proto_toString, 0],
    ['valueOf', Float128Proto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'float128');
  realmRec.Intrinsics['%float128.prototype%'] = proto;
}

export function bootstrapFloat128(realmRec: Realm): void {
  const proto = realmRec.Intrinsics['%float128.prototype%'];
  const cons = CreateBuiltinFunction(Float128Constructor, 1, Value('float128'), [], realmRec);
  X(cons.DefineOwnProperty(Value('prototype'), Descriptor({
    Value: proto,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  realmRec.Intrinsics['%float128%'] = cons;
}

/** A float128 object as plain binary128 data, for Float128Arithmetic. */
export function Float128ToBinary128(x: Float128Object): Binary128 {
  return { cls: x.Float128Class, sign: x.Float128Sign, sig: x.Float128Significand, exp: x.Float128Exponent };
}

/** Plain binary128 data as a float128 object. Already in the format: no rounding here. */
export function Binary128ToFloat128(v: Binary128, realmRec: Realm): Float128Object {
  return v.cls === 'finite' && v.sig !== 0n
    ? CreateFloat128Value(v.sig, v.exp, realmRec)
    : CreateFloat128Value(0n, 0, realmRec, v.cls, v.sign);
}
