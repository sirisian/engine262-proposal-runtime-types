import {
  ObjectValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
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

/** binary128: 113 bits of significand, and an exponent range from the format. */
const SIGNIFICAND_BITS = 113;
const MAX_EXPONENT = 16383;
const MIN_EXPONENT = -16382;

/**
 * Round an exact pair to the format: at most 113 significant bits, ties to
 * even, with overflow to an infinity and underflow to a subnormal or a zero.
 *
 * The rounding is the only place this file is not exact, and it is where the
 * format is actually imposed - a pair that fits is returned unchanged.
 */
function roundToFormat(significand: bigint, exponent: number): { significand: bigint, exponent: number, overflow: boolean } {
  if (significand === 0n) {
    return { significand: 0n, exponent: 0, overflow: false };
  }
  const negative = significand < 0n;
  let s = negative ? -significand : significand;
  let e = exponent;
  // Trim to the format's precision, rounding to nearest with ties to even.
  let bits = s.toString(2).length;
  if (bits > SIGNIFICAND_BITS) {
    const drop = bits - SIGNIFICAND_BITS;
    const keep = s >> BigInt(drop);
    const rest = s - (keep << BigInt(drop));
    const half = 1n << BigInt(drop - 1);
    s = keep;
    e += drop;
    if (rest > half || (rest === half && (keep & 1n) === 1n)) {
      s += 1n;
      // The increment may carry into a new bit, which costs one more.
      if (s.toString(2).length > SIGNIFICAND_BITS) {
        s >>= 1n;
        e += 1;
      }
    }
    bits = SIGNIFICAND_BITS;
  }
  // Normalize away trailing zeros so one value has one representation, which is
  // what lets equality be a comparison of the pair.
  while (s !== 0n && (s & 1n) === 0n) {
    s >>= 1n;
    e += 1;
  }
  if (s === 0n) {
    return { significand: 0n, exponent: 0, overflow: false };
  }
  const magnitude = e + s.toString(2).length - 1;
  if (magnitude > MAX_EXPONENT) {
    return { significand: 0n, exponent: 0, overflow: true };
  }
  if (magnitude < MIN_EXPONENT - SIGNIFICAND_BITS) {
    // Below the smallest subnormal: the value rounds to a zero of its sign.
    return { significand: 0n, exponent: 0, overflow: false };
  }
  return { significand: negative ? -s : s, exponent: e, overflow: false };
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

/** The nearest Number, which ROUNDS: binary64 is the narrower format. */
export function Float128ToNumber(v: Float128Object): number {
  if (v.Float128Class === 'nan') {
    return NaN;
  }
  if (v.Float128Class === 'infinity') {
    return v.Float128Sign === -1 ? -Infinity : Infinity;
  }
  if (v.Float128Significand === 0n) {
    return v.Float128Sign === -1 ? -0 : 0;
  }
  // Scaling by 2**exponent in steps keeps an intermediate from overflowing
  // where the result itself does not.
  let result = Number(v.Float128Significand);
  let e = v.Float128Exponent;
  while (e > 0 && Number.isFinite(result)) {
    const step = Math.min(e, 1000);
    result *= 2 ** step;
    e -= step;
  }
  while (e < 0 && result !== 0) {
    const step = Math.max(e, -1000);
    result *= 2 ** step;
    e -= step;
  }
  return result;
}

/**
 * The exact decimal text of a float128.
 *
 * SIGNIFICAND x 2**EXPONENT is always exactly representable in decimal: for a
 * non-negative exponent it is an integer, and for a negative one it is
 * SIGNIFICAND x 5**|EXPONENT| scaled by 10**-|EXPONENT|. So the text below is
 * the value rather than an approximation of it, which is the point of having
 * the format at all.
 */
export function Float128ToString(v: Float128Object): string {
  if (v.Float128Class === 'nan') {
    return 'NaN';
  }
  if (v.Float128Class === 'infinity') {
    return v.Float128Sign === -1 ? '-Infinity' : 'Infinity';
  }
  if (v.Float128Significand === 0n) {
    return v.Float128Sign === -1 ? '-0' : '0';
  }
  const negative = v.Float128Significand < 0n;
  const magnitude = negative ? -v.Float128Significand : v.Float128Significand;
  let text;
  if (v.Float128Exponent >= 0) {
    text = (magnitude << BigInt(v.Float128Exponent)).toString(10);
  } else {
    const places = -v.Float128Exponent;
    const scaled = (magnitude * 5n ** BigInt(places)).toString(10).padStart(places + 1, '0');
    const whole = scaled.slice(0, scaled.length - places);
    const fraction = scaled.slice(scaled.length - places).replace(/0+$/, '');
    text = fraction === '' ? whole : `${whole}.${fraction}`;
  }
  return negative ? `-${text}` : text;
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

/** https://sirisian.github.io/proposal-runtime-types/#sec-extended-floats */
function* Float128Proto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isFloat128Object(thisValue)) {
    return Throw.TypeError('$1 is not a $2', thisValue, Value('float128'));
  }
  return Value(Float128ToString(thisValue));
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-extended-floats */
function* Float128Proto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isFloat128Object(thisValue)) {
    return Throw.TypeError('$1 is not a $2', thisValue, Value('float128'));
  }
  return Value(Float128ToNumber(thisValue));
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
