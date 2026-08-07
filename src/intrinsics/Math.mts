import { VectorValue,
  Value,
  NumberValue,
  BigIntValue,
  TypedNumberValue,
  isTypedNumber,
  type Arguments,
  type NativeSteps,
  type FunctionCallContext,
} from '../value.mts';
import { EnsureCompletion, Q, X, isEvaluator, type ValueEvaluator } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import { endpointOf, type RangeObject } from './Range.mts';
import { SameType } from '../type-system/relations.mts';
import { fitsNumericType } from '../type-system/runtime.mts';
import { vectorShape } from '../type-system/vector-ops.mts';
import { CheckedConvertValue } from '../abstract-ops/runtime-types.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { isFloatTypeName, isIntegerTypeName, numericLibraryRows, type IntegerRow } from '../type-system/numeric-signatures.mts';
import { Decimal } from '../host-defined/decimal.mts';
import { decodeFloat16, encodeFloat16 } from '../host-defined/ieee754.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  surroundingAgent,
  ToNumber,
  F, R,
  Realm,
  RequireObjectCoercible,
  GetIterator,
  IteratorStepValue,
  IteratorClose,
  Throw,
  Assert,
  ToUint32,
} from '#self';

/** https://tc39.es/ecma262/#sec-math.abs */
function* Math_abs([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (Object.is(n.value, -0)) return F(+0);
  if (Object.is(n.value, -Infinity)) return F(Infinity);
  if (n.value < 0) return F(-n.value);
  return n;
}

/** https://tc39.es/ecma262/#sec-math.acos */
function* Math_acos([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value > 1 || n.value < -1) return F(NaN);
  if (n.value === 1) return F(+0);
  return F(Math.acos(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.acosh */
function* Math_acosh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (n.value < 1) return F(NaN);
  return F(Math.acosh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.asin */
function* Math_asin([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value > 1 || n.value < -1) return F(NaN);
  return F(Math.asin(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.asinh */
function* Math_asinh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  return F(Math.asinh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.atan */
function* Math_atan([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value === Infinity) return F(Math.PI / 2);
  if (n.value === -Infinity) return F(-Math.PI / 2);
  return F(Math.atan(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.atanh */
function* Math_atanh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value > 1 || n.value < -1) return F(NaN);
  if (n.value === 1) return F(Infinity);
  if (n.value === -1) return F(-Infinity);
  return F(Math.atanh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.atan2 */
function* Math_atan2([y = Value.undefined, x = Value.undefined]: Arguments): ValueEvaluator {
  const ny = Q(yield* ToNumber(y));
  const nx = Q(yield* ToNumber(x));
  if (ny.isNaN() || nx.isNaN()) return F(NaN);
  if (ny.value === Infinity) {
    if (nx.value === Infinity) return F(Math.PI / 4);
    if (nx.value === -Infinity) return F((3 * Math.PI) / 4);
    return F(Math.PI / 2);
  }
  if (ny.value === -Infinity) {
    if (nx.value === Infinity) return F(-Math.PI / 4);
    if (nx.value === -Infinity) return F((-3 * Math.PI) / 4);
    return F(-Math.PI / 2);
  }
  if (Object.is(ny.value, 0)) {
    if (nx.value > 0 || Object.is(nx.value, 0)) return F(+0);
    return F(Math.PI);
  }
  if (Object.is(ny.value, -0)) {
    if (nx.value > 0 || Object.is(nx.value, 0)) return F(-0);
    return F(-Math.PI);
  }
  Assert(ny.isFinite() && !Object.is(ny.value, 0) && !Object.is(ny.value, -0));
  if (ny.value > 0) {
    if (nx.value === Infinity) return F(0);
    if (nx.value === -Infinity) return F(Math.PI);
    if (Object.is(nx.value, 0) || Object.is(nx.value, -0)) return F(Math.PI / 2);
  }
  // eslint-disable-next-line no-compare-neg-zero
  if (ny.value < -0) {
    if (nx.value === Infinity) return F(-0);
    if (nx.value === -Infinity) return F(-Math.PI);
    if (Object.is(nx.value, 0) || Object.is(nx.value, -0)) return F(-Math.PI / 2);
  }
  Assert(ny.isFinite() && !Object.is(ny.value, 0) && !Object.is(ny.value, -0));
  // 12. Let r be the inverse tangent of abs(ℝ(ny) / ℝ(nx)).
  // 13. If nx < -0𝔽, then
  // a. If ny > +0𝔽, set r to π - r.
  // b. Else, set r to -π + r.
  // 14. Else,
  // a. If ny < -0𝔽, set r to -r.
  // 15. Return an implementation-approximated Number value representing r.
  return F(Math.atan2(ny.value, nx.value));
}

/** https://tc39.es/ecma262/#sec-math.cbrt */
function* Math_cbrt([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  return F(Math.cbrt(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.ceil */
function* Math_ceil([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0 && n.value > -1) return F(-0);
  if (n.isIntegralNumber()) return n;
  return F(Math.ceil(n.value));
}

/** https://tc39.es/ecma262/#sec-math.clz32 */
function* Math_clz32([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToUint32(x));
  // 2. Let p be the number of leading zero bits in the unsigned 32-bit binary representation of n.
  // 3. Return 𝔽(p).
  return F(Math.clz32(n.value));
}

/** https://tc39.es/ecma262/#sec-math.cos */
function* Math_cos([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite()) return F(NaN);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(1);
  return F(Math.cos(n.value));
}

/** https://tc39.es/ecma262/#sec-math.cosh */
function* Math_cosh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (n.isInfinity()) return F(Infinity);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(1);
  return F(Math.cosh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.exp */
function* Math_exp([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(1);
  if (n.value === -Infinity) return F(0);
  return F(Math.exp(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.expm1 */
function* Math_expm1([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0) || n.value === Infinity) return n;
  if (n.value === -Infinity) return F(-1);
  // 4. Let exp be the exponential function of ℝ(n).
  // 5. Return an implementation-approximated Number value representing exp - 1.
  return F(Math.expm1(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.floor */
function* Math_floor([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value < 1 && n.value > 0) return F(0);
  if (n.isIntegralNumber()) return n;
  return F(Math.floor(n.value));
}

/** https://tc39.es/ecma262/#sec-math.fround */
function* Math_fround([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (Object.is(n.value, 0) || Object.is(n.value, -0) || n.isInfinity()) return n;
  // 4. Let n32 be the result of converting n to IEEE 754-2019 binary32 format using roundTiesToEven mode.
  // 5. Let n64 be the result of converting n32 to IEEE 754-2019 binary64 format.
  // 6. Return the ECMAScript Number value corresponding to n64.
  return F(Math.fround(n.value));
}

/** https://tc39.es/ecma262/#sec-math.f16round */
function* Math_f16round([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (Object.is(n.value, 0) || Object.is(n.value, -0) || n.isInfinity()) return n;
  if ('f16round' in Math) {
    return F(Math.f16round(n.value));
  }
  return F(decodeFloat16(encodeFloat16(n.value)));
}

/** https://tc39.es/ecma262/#sec-math.hypot */
function* Math_hypot(args: Arguments): ValueEvaluator {
  const coerced = [];
  for (const arg of args) {
    const n = Q(yield* ToNumber(arg ?? Value.undefined));
    coerced.push(n);
  }
  for (const number of coerced) {
    if (number.isInfinity()) return F(Infinity);
  }
  let onlyZero = true;
  for (const number of coerced) {
    if (number.isNaN()) return F(NaN);
    if (!Object.is(number.value, 0) && !Object.is(number.value, -0)) {
      onlyZero = false;
    }
  }
  if (onlyZero) return F(+0);
  return F(Math.hypot(...coerced.map((value) => value.value)));
}

/** https://tc39.es/ecma262/#sec-math.imul */
function* Math_imul([x = Value.undefined, y = Value.undefined]: Arguments): ValueEvaluator {
  const a = Decimal(R(Q(yield* ToUint32(x))));
  const b = Decimal(R(Q(yield* ToUint32(y))));
  const product = a.multiply(b).modulo(2 ** 32);
  if (product.greaterThanOrEqual(2 ** 31)) return F(product.subtract(2 ** 32).toNumber());
  return F(product.toNumber());
}

/** https://tc39.es/ecma262/#sec-math.log */
function* Math_log([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(-Infinity);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.log(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.log1p */
function* Math_log1p([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0) || n.value === Infinity) return n;
  if (n.value === -1) return F(-Infinity);
  if (n.value < -1) return F(NaN);
  return F(Math.log1p(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.log10 */
function* Math_log10([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(-Infinity);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.log10(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.log2 */
function* Math_log2([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(-Infinity);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.log2(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.max */
function* Math_max(args: Arguments): ValueEvaluator {
  const coerced = [];
  for (const arg of args) {
    const n = Q(yield* ToNumber(arg ?? Value.undefined));
    coerced.push(n);
  }
  let highest = -Infinity;
  for (const number of coerced) {
    if (number.isNaN()) return number;
    if (Object.is(number.value, 0) && Object.is(highest, -0)) highest = 0;
    if (number.value > highest) highest = number.value;
  }
  return F(highest);
}

/** https://tc39.es/ecma262/#sec-math.min */
function* Math_min(args: Arguments): ValueEvaluator {
  const coerced = [];
  for (const arg of args) {
    const n = Q(yield* ToNumber(arg ?? Value.undefined));
    coerced.push(n);
  }
  let lowest = Infinity;
  for (const number of coerced) {
    if (number.isNaN()) return number;
    if (Object.is(number.value, -0) && Object.is(lowest, 0)) lowest = -0;
    if (number.value < lowest) lowest = number.value;
  }
  return F(lowest);
}

/** https://tc39.es/ecma262/#sec-math.pow */
function* Math_pow([base = Value.undefined, exponent = Value.undefined]: Arguments): ValueEvaluator {
  base = Q(yield* ToNumber(base));
  exponent = Q(yield* ToNumber(exponent));
  return NumberValue.exponentiate(base, exponent);
}

/** @param {bigint} h */
function fmix64(h: bigint) {
  h ^= h >> 33n;
  h *= 0xFF51AFD7ED558CCDn;
  h ^= h >> 33n;
  h *= 0xC4CEB9FE1A85EC53n;
  h ^= h >> 33n;
  return h;
}

const floatView = new Float64Array(1);
const big64View = new BigUint64Array(floatView.buffer);
/** The next value of the realm's PRNG stream, a Number in the interval [0, 1). */
function nextRandomDouble(realm: Realm): number {
  if (realm.randomState === undefined) {
    const seed = realm.HostDefined.randomSeed
      ? BigInt(X(realm.HostDefined.randomSeed()))
      : BigInt(Math.round(Math.random() * (2 ** 32)));
    realm.randomState = new BigUint64Array([
      fmix64(BigInt.asUintN(64, seed)),
      fmix64(BigInt.asUintN(64, ~seed)),
    ]);
  }
  const s = realm.randomState;

  // XorShift128+
  let s1 = s[0];
  const s0 = s[1];
  s[0] = s0;
  s1 ^= s1 << 23n;
  s1 ^= s1 >> 17n;
  s1 ^= s0;
  s1 ^= s0 >> 26n;
  s[1] = s1;

  // Convert to double in [0, 1) range
  big64View[0] = (s0 >> 12n) | 0x3FF0000000000000n;
  return floatView[0] - 1;
}

/** https://tc39.es/ecma262/#sec-math.random */
function Math_random() {
  return F(nextRandomDouble(surroundingAgent.currentRealmRecord));
}

/**
 * proposal-runtime-types (random.md): the no-argument typed form
 * `Math.random.<T>()`. For a float value type it is a value in [0, 1); for an
 * integer value type it is an integer across the type's full range, inclusive.
 * The result carries the value type T. Returns undefined when T is not a float or
 * integer value type this form supports (a plain `number`, a `bigint`, a 64- or
 * 128-bit integer, or a non-numeric type), so the caller falls back to the
 * ordinary untyped call. The array-fill and range overloads and the seeded PRNG
 * (`Math.PRNG`) are the extension's deferred remainder.
 */
export function TypedRandom(t: TypeRecord, realm: Realm): Value | undefined {
  if (t.Kind !== 'primitive') {
    return undefined;
  }
  const name = t.Name;
  const isFloat = name === 'float16' || name === 'float32' || name === 'float64';
  const isUint = name === 'uint';
  const isInt = name === 'int';
  if (!isFloat && !isUint && !isInt) {
    return undefined;
  }
  const d = nextRandomDouble(realm);
  if (isFloat) {
    // A float draw is taken on the uniform grid of the width's significand
    // (float32 has a 24-bit significand, float16 an 11-bit one; float64 takes
    // the draw as produced), so the value is exactly representable at the
    // width, unchanged by the checked conversion's rounding (wrapToType), and
    // strictly below 1, where rounding a raw double draw could reach 1.0.
    // `Math.random.<float32>()` is `Math.random.<float32>(0..<1)`.
    const sigBits = name === 'float64' ? 0 : (name === 'float32' ? 24 : 11);
    const value = sigBits === 0 ? d : Math.floor(d * (2 ** sigBits)) / (2 ** sigBits);
    return new TypedNumberValue(value, t);
  }
  // An integer draw covers the whole type range inclusively. Only widths whose
  // cardinality is an exact Number (<= 32 bits) are produced here; wider integer
  // types are deferred with the range forms.
  const bits = t.Arguments[0] as number;
  if (typeof bits !== 'number' || bits > 32) {
    return undefined;
  }
  const cardinality = 2 ** bits;
  const draw = Math.floor(d * cardinality);
  const value = isUint ? draw : draw - (2 ** (bits - 1));
  return new TypedNumberValue(value, t);
}

/**
 * proposal-runtime-types (random.md): the RANGE form `Math.random.<T>(range)`.
 *
 * "The bounds are a range, which may be any of the range forms. Its element type
 * is `T` and its interval is part of its type." Each of the four intervals is a
 * different draw, which is the whole reason the range syntax had to reach all
 * four: `0..<1` must not produce 1, `0<..=1` must not produce 0, and `-1..=1`
 * must be able to produce both endpoints.
 *
 * Returns undefined where the form is not one this produces, so the caller falls
 * through to the ordinary call rather than silently ignoring the bound.
 */
export function TypedRandomInRange(t: TypeRecord, range: RangeObject, realm: Realm): Value | ReturnType<typeof Throw.RangeError> | undefined {
  if (t.Kind !== 'primitive') {
    return undefined;
  }
  const name = t.Name;
  const isFloat = name === 'float16' || name === 'float32' || name === 'float64';
  const isUint = name === 'uint';
  const isInt = name === 'int';
  if (!isFloat && !isUint && !isInt) {
    return undefined;
  }
  // Through `endpointOf`, so a TYPED endpoint reads here the way it reads
  // everywhere else - `Math.random.<uint8>(x..=y)` over typed bounds is the
  // ordinary case, not a special one.
  const startEdge = endpointOf(range.RangeStart);
  const endEdge = endpointOf(range.RangeEnd);
  // A bigint endpoint is the wide-integer form, which this draw defers along
  // with `bits > 32` below: the grid it rides is a double's significand, so an
  // endpoint that does not fit one has no exactly representable draw here.
  if (typeof startEdge === 'bigint' || typeof endEdge === 'bigint') {
    return undefined;
  }
  const start: number | undefined = startEdge;
  const end: number | undefined = endEdge;
  const startOpen = range.RangeStartBound === 'open';
  const endOpen = range.RangeEndBound === 'open';
  const d = nextRandomDouble(realm);

  if (isUint || isInt) {
    const bits = t.Arguments[0] as number;
    if (typeof bits !== 'number' || bits > 32) {
      return undefined; // wide integers are deferred with the rest of the form
    }
    // "An open-ended range takes its missing endpoint from `T`", which for an
    // integer type is its own least and greatest value.
    const typeLo = isUint ? 0 : -(2 ** (bits - 1));
    const typeHi = isUint ? (2 ** bits) - 1 : (2 ** (bits - 1)) - 1;
    let lo = start === undefined ? typeLo : (startOpen ? start + 1 : start);
    let hi = end === undefined ? typeHi : (endOpen ? end - 1 : end);
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      return Throw.TypeError('a range over an integer type needs integer endpoints');
    }
    lo = Math.max(lo, typeLo);
    hi = Math.min(hi, typeHi);
    if (lo > hi) {
      // "An empty range produces no value ... a RangeError when the call is made."
      return Throw.RangeError('the range is empty');
    }
    return new TypedNumberValue(lo + Math.floor(d * (hi - lo + 1)), t);
  }

  // A float range needs both endpoints: an open-ended one would take its missing
  // endpoint from `T`, and random.md restricts that to "a type with finite
  // bounds: an integer type, or any type carrying `minimum`/`maximum`", which is
  // the metadata form and is deferred with the rest of it.
  if (start === undefined || end === undefined) {
    return undefined;
  }
  if (startOpen ? start >= end : start > end) {
    return Throw.RangeError('the range is empty');
  }
  // The draw rides a grid of the width's significand, as the no-argument form
  // does, so the value is exactly representable and the interval's own endpoints
  // are respected rather than approached.
  const grid = name === 'float64' ? 2 ** 53 : (name === 'float32' ? 2 ** 24 : 2 ** 11);
  const span = end - start;
  let u: number;
  if (!startOpen && !endOpen) {
    u = Math.floor(d * (grid + 1)) / grid; // [0, 1], both endpoints attainable
  } else if (!startOpen && endOpen) {
    u = Math.floor(d * grid) / grid; // [0, 1)
  } else if (startOpen && !endOpen) {
    u = 1 - (Math.floor(d * grid) / grid); // (0, 1]
  } else {
    u = (Math.floor(d * (grid - 1)) + 1) / grid; // (0, 1)
  }
  return new TypedNumberValue(start + (u * span), t);
}

/** https://tc39.es/ecma262/#sec-math.round */
function* Math_round([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || n.isIntegralNumber()) return n;
  if (n.value < 0.5 && n.value > 0) return F(0);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0 && n.value >= -0.5) return F(-0);
  return F(Math.round(n.value));
}

/** https://tc39.es/ecma262/#sec-math.sign */
function* Math_sign([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value < 0) return F(-1);
  return F(1);
}

/** https://tc39.es/ecma262/#sec-math.sin */
function* Math_sin([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.isInfinity()) return F(NaN);
  return F(Math.sin(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.sinh */
function* Math_sinh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  return F(Math.sinh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.sqrt */
/**
 * proposal-runtime-types (operatoroverloading.md): `Math.fma(a, b, c)` computes
 * `a * b + c` with a SINGLE rounding, and is overloaded for the scalar and
 * vector types - the lane-wise wrapper supplies the vector half.
 *
 * The single rounding is the whole of it. Computing `a * b` and then adding
 * rounds twice and is a different function, so this cannot be a shim over `*`
 * and `+`. The exact product of two doubles needs more bits than a double has,
 * so it is formed here in the arbitrary-precision rationals that BigInt gives
 * and rounded once at the end.
 */
/**
 * `a * b + c` rounded once. The product and sum are formed exactly as a rational
 * of BigInts - every finite double is one - and the result is rounded to the
 * nearest double at the end, which is what a hardware FMA does and what
 * multiplying and then adding does not.
 */
function fusedMultiplyAdd(a: number, b: number, c: number): number {
  const exact = exactTimes(a, b);
  const sum = { n: exact.n * splitDouble(c).d + splitDouble(c).n * exact.d, d: exact.d * splitDouble(c).d };
  return ratioToDouble(sum.n, sum.d);
}

/** A finite double as an exact fraction n/d of BigInts. */
function splitDouble(v: number): { n: bigint, d: bigint } {
  if (Number.isInteger(v)) {
    return { n: BigInt(v), d: 1n };
  }
  let scaled = v;
  let d = 1n;
  while (!Number.isInteger(scaled)) {
    scaled *= 2;
    d *= 2n;
  }
  return { n: BigInt(scaled), d };
}

function exactTimes(a: number, b: number): { n: bigint, d: bigint } {
  const x = splitDouble(a);
  const y = splitDouble(b);
  return { n: x.n * y.n, d: x.d * y.d };
}

/** The nearest double to n/d. */
function ratioToDouble(n: bigint, d: bigint): number {
  if (n === 0n) {
    return 0;
  }
  const negative = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  // A first estimate, then the two doubles either side of it: the estimate is
  // within an ulp, so the exact error of the three settles which is nearest.
  let guess = Number(an) / Number(ad);
  if (!Number.isFinite(guess)) {
    const shift = BigInt(Math.max(0, an.toString(2).length - 900));
    guess = (Number(an >> shift) / Number(ad)) * 2 ** Number(shift);
  }
  if (!Number.isFinite(guess)) {
    return negative ? -Infinity : Infinity;
  }
  let best = guess;
  let bestErr: bigint | null = null;
  for (const cand of [guess, nextAfter(guess, Infinity), nextAfter(guess, -Infinity)]) {
    if (!Number.isFinite(cand)) {
      continue;
    }
    const cf = splitDouble(cand);
    const diff = cf.n * ad - an * cf.d;
    const err = (diff < 0n ? -diff : diff) * (cf.d === 0n ? 1n : 1n);
    const scaled = err * (ad === 0n ? 1n : 1n);
    const normalized = scaled * cf.d / cf.d;
    if (bestErr === null || normalized < bestErr) {
      bestErr = normalized;
      best = cand;
    }
  }
  return negative ? -best : best;
}

/** The next representable double from `v` toward `dir`. */
function nextAfter(v: number, dir: number): number {
  if (Number.isNaN(v) || v === dir) {
    return v;
  }
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v);
  let bits = buf.getBigUint64(0);
  if (v === 0) {
    bits = dir > 0 ? 1n : (1n << 63n) | 1n;
  } else if ((v > 0) === (dir > v)) {
    bits += 1n;
  } else {
    bits -= 1n;
  }
  buf.setBigUint64(0, bits);
  return buf.getFloat64(0);
}

/**
 * proposal-runtime-types (operatoroverloading.md): "`Math.rsqrt(x)` is exactly
 * `1 / Math.sqrt(x)`, correctly rounded, so it does not lower to a bare
 * `rsqrtps`, which is a twelve-bit approximation."
 *
 * CORRECTLY ROUNDED is the operative half, and it is stronger than evaluating
 * `1 / Math.sqrt(x)` in doubles: that rounds twice, once at the square root and
 * once at the division, and differs from the correctly rounded result for
 * roughly a quarter of inputs. The weaker reading would also leave the function
 * with nothing to offer, a program being able to write `1 / Math.sqrt(x)` for
 * itself; what it cannot write for itself is the single rounding.
 *
 * The result is chosen by an EXACT test rather than computed approximately: for
 * adjacent doubles either side of the true value, the true 1/sqrt(x) is below
 * their midpoint _m_ exactly when _m_^2 * x > 1, and that comparison is done in
 * rationals of BigInts.
 */
function* Math_rsqrt([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) {
    return F(NaN);
  }
  const v = R(n);
  if (v < 0) {
    return F(NaN);
  }
  if (v === 0) {
    // 1/sqrt(+0) is +Infinity and 1/sqrt(-0) is -Infinity, since sqrt(-0) is -0
    // and 1/-0 is -Infinity. The sign is read from the Number rather than from
    // R, which reports a mathematical value and so has no negative zero.
    return F(Object.is(n.value, -0) ? -Infinity : Infinity);
  }
  if (v === Infinity) {
    return F(0);
  }
  return F(correctlyRoundedRsqrt(v));
}

/** The double nearest to the real number 1/sqrt(v), for finite positive v. */
function correctlyRoundedRsqrt(v: number): number {
  const exceedsOne = (c: number): boolean => {
    // c^2 * v > 1, exactly.
    const cf = splitDouble(c);
    const vf = splitDouble(v);
    return cf.n * cf.n * vf.n > cf.d * cf.d * vf.d;
  };
  let c = 1 / Math.sqrt(v);
  if (!Number.isFinite(c) || c === 0) {
    return c;
  }
  // Walk to the smallest double whose square exceeds 1/v, which brackets the
  // true value with its predecessor. The estimate is within a couple of ulps.
  let guard = 0;
  while (exceedsOne(c) && guard < 8) {
    c = nextAfter(c, 0);
    guard += 1;
  }
  while (!exceedsOne(c) && guard < 16) {
    c = nextAfter(c, Infinity);
    guard += 1;
  }
  const below = nextAfter(c, 0);
  if (!Number.isFinite(below) || below <= 0) {
    return c;
  }
  // Nearer of the two: the true value is below the midpoint exactly when the
  // midpoint's square exceeds 1/v.
  const mid = splitDouble(below);
  const above = splitDouble(c);
  const midN = mid.n * above.d + above.n * mid.d;
  const midD = mid.d * above.d * 2n;
  const vf = splitDouble(v);
  return midN * midN * vf.n > midD * midD * vf.d ? below : c;
}

function* Math_fma([x = Value.undefined, y = Value.undefined, z = Value.undefined]: Arguments): ValueEvaluator {
  const a = Q(yield* ToNumber(x));
  const b = Q(yield* ToNumber(y));
  const c = Q(yield* ToNumber(z));
  if (a.isNaN() || b.isNaN() || c.isNaN()) {
    return F(NaN);
  }
  if (!a.isFinite() || !b.isFinite() || !c.isFinite()) {
    // No exact product to form: the ordinary operators already agree with a
    // single rounding when an operand is an infinity, since no rounding occurs.
    return F(R(a) * R(b) + R(c));
  }
  return F(fusedMultiplyAdd(R(a), R(b), R(c)));
}

function* Math_sqrt([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0) || n.value === Infinity) return n;
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.sqrt(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.sumprecise */
function* Math_sumPrecise([items = Value.undefined]: Arguments): ValueEvaluator {
  Q(RequireObjectCoercible(items));
  const iteratorRecord = Q(yield* GetIterator(items, 'sync'));
  let state: 'minus-zero' | 'not-a-number' | 'minus-infinity' | 'plus-infinity' | 'finite' = 'minus-zero';
  // proposal-runtime-types (the listing's sumPrecise row): for an iterable of
  // values of one float type T, the exact sum rounded ONCE to T. The types are
  // inside the iterable rather than on an argument, so they are read here rather
  // than by the signature wrapper, which sees no typed argument at all.
  let carriedFloat: (TypeRecord & { Kind: 'primitive' }) | undefined;
  const sums: number[] = [];
  let count = 0;
  let next: 'not-started' | 'done' | Value = 'not-started';
  while (next !== 'done') {
    next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next !== 'done') {
      if (count >= 2 ** 53 - 1) {
        const error = Throw.RangeError('$1 is out of range', '');
        return Q(yield* IteratorClose(iteratorRecord, error));
      }
      let element = next;
      if (surroundingAgent.feature('runtime-types') && isTypedNumber(element)) {
        const record = element.TypeRecord as TypeRecord;
        if (record.Kind !== 'primitive' || !isFloatTypeName(record.Name)) {
          // The listing gives sumPrecise a float row and no other, so an integer
          // or other typed element is viable at no signature.
          const error = Throw.TypeError('$1 has no signature taking a value of type $2', Value('Math.sumPrecise'), Value(displayType(record)));
          return Q(yield* IteratorClose(iteratorRecord, error));
        }
        if (carriedFloat === undefined) {
          carriedFloat = record as TypeRecord & { Kind: 'primitive' };
        } else if (!SameType(carriedFloat, record)) {
          // An iterable mixing two float types is the mixing error, stated at
          // the element rather than at an argument.
          const error = Throw.TypeError('$1 has no signature taking values of two numeric types', Value('Math.sumPrecise'));
          return Q(yield* IteratorClose(iteratorRecord, error));
        }
        element = F(element.value);
      }
      if (!(element instanceof NumberValue)) {
        const error = Throw.TypeError('$1 is not a number', element);
        return Q(yield* IteratorClose(iteratorRecord, error));
      }
      const n = element.value;
      if (state !== 'not-a-number') {
        if (Number.isNaN(n)) {
          state = 'not-a-number';
        } else if (n === Infinity) {
          if (state === 'minus-infinity') {
            state = 'not-a-number';
          } else {
            state = 'plus-infinity';
          }
        } else if (n === -Infinity) {
          if (state === 'plus-infinity') {
            state = 'not-a-number';
          } else {
            state = 'minus-infinity';
          }
        } else if (!Object.is(n, -0) && (state === 'minus-zero' || state === 'finite')) {
          state = 'finite';
          sums.push(n);
        }
      }
      count += 1;
    }
  }
  // The exact sum is formed over every element and rounded ONCE, here, which is
  // the property the row promises and what distinguishes it from adding at T.
  const settle = (v: number) => (carriedFloat === undefined ? F(v) : new TypedNumberValue(wrapToType(v, carriedFloat), carriedFloat));
  if (state === 'not-a-number') {
    return settle(NaN);
  }
  if (state === 'plus-infinity') {
    return settle(Infinity);
  }
  if (state === 'minus-infinity') {
    return settle(-Infinity);
  }
  if (state === 'minus-zero') {
    return settle(-0);
  }
  return settle(sum(sums));

  function sum(items: number[]) {
    if ('sumPrecise' in Math) {
      // @ts-expect-error
      return Math.sumPrecise(items);
    }
    const fractional_parts: number[] = [];
    let whole_part_sum = 0n;
    items.forEach((n) => {
      const whole_num = Math.trunc(n);
      fractional_parts.push(n - whole_num);
      whole_part_sum += BigInt(whole_num);
    });
    const fractional_parts_as_hex = fractional_parts.map((n) => n.toString(32));

    const fractional: number[] = [];
    for (const fractional_str of fractional_parts_as_hex) {
      const neg = fractional_str[0] === '-';
      const prefix = neg ? 3 : 2; // -0.xxx or 0.xxx
      for (let index = prefix; index < fractional_str.length; index += 1) {
        fractional[index - prefix] ??= 0;
        if (neg) {
          fractional[index - prefix] -= parseInt(fractional_str[index], 32);
        } else {
          fractional[index - prefix] += parseInt(fractional_str[index], 32);
        }
      }
    }
    for (let index = fractional.length - 1; index >= 0; index -= 1) {
      const element = fractional[index];
      if (element >= 32) {
        fractional[index] = element % 32;
        fractional[index - 1] ??= 0;
        fractional[index - 1] += Math.floor(element / 32);
      }
      if (element < 0) {
        fractional[index] = 32 + element;
        fractional[index - 1] ??= 0;
        fractional[index - 1] -= 1;
      }
    }
    const fractional_part = fractional.reduceRight((acc, digit, index) => acc + digit * 32 ** -(index + 1), 0);
    if (fractional[-1]) {
      whole_part_sum += BigInt(fractional[-1]);
    }
    return Number(whole_part_sum) + fractional_part;
  }
}

/** https://tc39.es/ecma262/#sec-math.tan */
function* Math_tan([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.isInfinity()) return F(NaN);
  return F(Math.tan(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.tanh */
function* Math_tanh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value === Infinity) return F(1);
  if (n.value === -Infinity) return F(-1);
  return F(Math.tanh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.trunc */
function* Math_trunc([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value < 1 && n.value > 0) return F(0);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0 && n.value > -1) return F(-0);
  return F(Math.trunc(n.value));
}

/** https://tc39.es/ecma262/#sec-math-object */

/**
 * proposal-runtime-types (spec, the numeric library): the functions of the Math
 * object are overloaded for the numeric types, and the signature listing states
 * which functions have a row at which family, what each returns, and what happens
 * when a result does not fit. This implements the listing at run time: the wrapper
 * selects the row from the argument types, evaluates it, and applies the return
 * rule for the family.
 *
 * Three properties of the listing shape the code below.
 *
 * A row exists where the operation has an answer in the family's own mathematics.
 * The integer roots do (`Math.sqrt` of a uint8 is the integer square root, truncated
 * toward zero as integer division truncates), the transcendentals do not, so an
 * integer-typed argument to one fails resolution rather than promoting silently.
 *
 * Every signature takes its numeric parameters at ONE type, because no numeric value
 * type is assignable to another. Two typed arguments of different types match no
 * signature. A plain numeric argument beside a typed one is a literal, which takes
 * the parameter's type where it can represent it and is an error where it cannot.
 *
 * A declared return is a boundary. For an integer type the exact result is checked
 * and an unrepresentable one raises, which is why `Math.pow` and `**` deliberately
 * part ways: the operator wraps because it is the cheap form, and the named function
 * checks because it declares a return. For a float type the result rounds to the
 * width and overflows to an infinity, which is what float arithmetic already does.
 */

// The listing and the family-name predicates live in
// src/type-system/numeric-signatures.mts, shared with the static checker so
// the two phases read one table.

/** The declared width of a sized integer type. */
function integerWidth(t: TypeRecord & { Kind: 'primitive' }): number {
  const first = t.Arguments[0];
  return typeof first === 'number' ? first : 0;
}

/**
 * The exact integer square root: the greatest r with r*r <= n. The host's square
 * root is a double, so its floor can be off by one near a perfect square; the
 * corrections settle it exactly.
 */
function integerSqrt(n: number): number {
  if (n < 2) {
    return n;
  }
  let r = Math.floor(Math.sqrt(n));
  while (r > 0 && r * r > n) {
    r -= 1;
  }
  while ((r + 1) * (r + 1) <= n) {
    r += 1;
  }
  return r;
}

/** The exact integer cube root, truncated toward zero, so it is defined for a negative. */
function integerCbrt(n: number): number {
  const sign = n < 0 ? -1 : 1;
  const a = Math.abs(n);
  if (a < 2) {
    return sign * a;
  }
  let r = Math.floor(Math.cbrt(a));
  while (r > 0 && r * r * r > a) {
    r -= 1;
  }
  while ((r + 1) * (r + 1) * (r + 1) <= a) {
    r += 1;
  }
  return sign * r;
}

/**
 * The leading-zero count of a value at a width: the width less the bit length of
 * the value taken modulo 2**width, so a negative value counts in its two's
 * complement encoding.
 */
function countLeadingZeros(value: number, bits: number): number {
  const modulus = 2 ** bits;
  let v = ((value % modulus) + modulus) % modulus;
  let length = 0;
  while (v >= 1) {
    v = Math.floor(v / 2);
    length += 1;
  }
  return bits - length;
}

/**
 * The numeric library's dispatch. It wraps a Math function's native steps: with no
 * typed argument the ordinary steps run and mean what they mean today, and with one
 * the row of the listing is selected and its return rule applied.
 */
function withNumericLibrarySignatures(steps: NativeSteps, functionName: string): NativeSteps {
  const wrapped: NativeSteps = function* withNumericLibrarySignatures(this: ThisParameterType<NativeSteps>, args: Arguments, context: FunctionCallContext) {
    if (!surroundingAgent.feature('runtime-types')) {
      let plain = steps.call(this, args, context);
      if (isEvaluator(plain)) {
        plain = yield* plain;
      }
      return plain;
    }
    // proposal-runtime-types #sec-vector-lane-wise-math: a Math function applies
    // LANE-WISE to a vector argument, returning a vector of the argument's
    // shape. Arguments of one shape apply at each lane, and a scalar beside a
    // vector broadcasts.
    //
    // The exact functions - min, max, abs, sqrt, floor, ceil, round, trunc -
    // give the scalar result for each lane. The approximated ones are
    // approximated independently of their scalar forms, so a lane of
    // `Math.sin(v)` need not equal `Math.sin(v.lane.<j>())`; this implementation
    // computes lane-wise with the scalar function, which is one permitted
    // answer among several.
    if (args.some((a) => a !== undefined && a.type === 'Vector')) {
      return Q(yield* applyLaneWise(this, steps, args, context));
    }
    // Every signature takes its numeric parameters at one type. Two typed
    // arguments of different types are viable at no signature.
    let carried: (TypeRecord & { Kind: 'primitive' }) | undefined;
    for (const arg of args) {
      if (arg !== undefined && isTypedNumber(arg)) {
        const record = arg.TypeRecord as TypeRecord;
        if (record.Kind !== 'primitive') {
          continue;
        }
        if (carried === undefined) {
          carried = record as TypeRecord & { Kind: 'primitive' };
        } else if (!SameType(carried, record)) {
          return Throw.TypeError(
            '$1 has no signature taking values of two numeric types',
            Value(`Math.${functionName}`),
          );
        }
      }
    }
    if (carried === undefined) {
      // A BigInt is a value of the `bigint` type, so it selects that column of
      // the listing rather than falling through to the Number signature, which
      // would reach ToNumber and refuse it.
      if (args.some((arg) => arg instanceof BigIntValue)) {
        return yield* evaluateBigIntRow(functionName, args);
      }
      // No typed argument: the existing signature over the Number type, unchanged.
      let plain = steps.call(this, args, context);
      if (isEvaluator(plain)) {
        plain = yield* plain;
      }
      return plain;
    }
    const row = numericLibraryRows.get(functionName);
    const name = carried.Name;
    const integer = isIntegerTypeName(name);
    if (!row || (integer ? row.integer === undefined : !(isFloatTypeName(name) && row.float))) {
      return Throw.TypeError(
        '$1 has no signature taking a value of type $2',
        Value(`Math.${functionName}`),
        Value(displayType(carried)),
      );
    }
    // A plain numeric argument beside a typed one is a literal and takes the
    // parameter's type, so one it cannot represent matches no signature.
    for (const arg of args) {
      if (arg !== undefined && arg instanceof NumberValue && !fitsNumericType(R(arg) as number, name, carried.Arguments)) {
        return Throw.TypeError('$1 is not assignable to $2', arg, Value(displayType(carried)));
      }
    }
    if (integer) {
      return yield* evaluateIntegerRow(row.integer!, functionName, args, carried, steps, this, context);
    }
    // A float row: the ordinary steps compute the approximation, and the result is
    // rounded to the width, which is the conversion table's float rule and keeps
    // float values wrapToType-stable.
    let result = steps.call(this, args, context);
    if (isEvaluator(result)) {
      result = yield* result;
    }
    const value = Q(result);
    if (!(value instanceof NumberValue)) {
      return value;
    }
    const payload = value.numberValue(); // eslint-disable-line @engine262/mathematical-value -- the payload is stored as given, so a negative zero survives
    return new TypedNumberValue(wrapToType(payload, carried), carried);
  };
  // The wrapper stands in for the function it wraps, so it carries that function's
  // name and specification section: the suites check that every built-in has both,
  // and a wrapper that reported its own would make the built-in look undocumented.
  Object.defineProperty(wrapped, 'name', { value: steps.name, configurable: true });
  wrapped.section = steps.section;
  return wrapped;
}

/** Evaluate the integer row of the listing and apply its return rule. */
function* evaluateIntegerRow(
  row: IntegerRow,
  functionName: string,
  args: Arguments,
  t: TypeRecord & { Kind: 'primitive' },
  steps: NativeSteps,
  thisArg: ThisParameterType<NativeSteps>,
  context: FunctionCallContext,
) {
  const width = integerWidth(t);
  // The row's own domain errors are raised before any result exists.
  const first = args[0] ?? Value.undefined;
  if (functionName === 'sqrt' && isTypedNumber(first) && first.value < 0) {
    return Throw.RangeError('$1 of a negative value is not defined', Value('Math.sqrt'));
  }
  if (functionName === 'pow') {
    const exponent = args[1] ?? Value.undefined;
    const exponentValue = isTypedNumber(exponent)
      ? exponent.value
      : (exponent instanceof NumberValue ? (R(exponent) as number) : 0);
    if (exponentValue < 0) {
      return Throw.RangeError('$1 with a negative exponent is not defined for an integer type', Value('Math.pow'));
    }
  }
  if (row === 'identity') {
    // The floor, ceiling, and roundings of an integer are that integer.
    return first as Value;
  }
  if (row === 'imul') {
    // The result is fixed by the function's own definition rather than by the
    // argument's type, so it is an int32 whatever T the arguments carry.
    const a = Q(yield* ToUint32(args[0] ?? Value.undefined));
    const b = Q(yield* ToUint32(args[1] ?? Value.undefined));
    const product = ((R(a) as number) * (R(b) as number)) % (2 ** 32);
    const int32 = product >= 2 ** 31 ? product - 2 ** 32 : product;
    return new TypedNumberValue(int32, int32TypeRecord);
  }
  if (row === 'leadingZeros') {
    // clz32 counts in a 32-bit field whatever the argument's width; clz counts in
    // the argument's own. Both check their count at the return.
    const bits = functionName === 'clz32' ? 32 : width;
    const value = isTypedNumber(first)
      ? first.value
      : (R(Q(yield* ToNumber(first))) as number);
    const count = countLeadingZeros(Math.trunc(value), bits);
    return checkedIntegerResult(count, t);
  }
  if (row === 'root') {
    const value = isTypedNumber(first) ? first.value : 0;
    const result = functionName === 'sqrt' ? integerSqrt(value) : integerCbrt(value);
    return checkedIntegerResult(result, t);
  }
  // 'checked': the exact result of the ordinary steps, checked at T.
  let computed = steps.call(thisArg, args, context);
  if (isEvaluator(computed)) {
    computed = yield* computed;
  }
  const value = Q(computed);
  if (!(value instanceof NumberValue)) {
    return value;
  }
  return checkedIntegerResult(R(value) as number, t);
}

/**
 * The checked return of an integer row: a representable result is a value of the
 * type, and one the type cannot represent raises rather than wrapping, which is
 * what separates the named function from the operator.
 */
function checkedIntegerResult(result: number, t: TypeRecord & { Kind: 'primitive' }) {
  if (!Number.isInteger(result) || !fitsNumericType(result, t.Name, t.Arguments)) {
    return Throw.RangeError('$1 is not in the range of $2', Value(String(result)), Value(displayType(t)));
  }
  // An integer type has no signed zero.
  return new TypedNumberValue(result === 0 ? 0 : result, t);
}

/** https://sirisian.github.io/ecmascript-types/#sec-counting-leading-zeros */
function* Math_clz([x = Value.undefined]: Arguments): ValueEvaluator {
  // The wrapper evaluates the typed rows. Reaching the native steps means the
  // argument carried no numeric type, and `clz` has no untyped signature: the
  // width is the whole of its meaning, and `Math.clz32` is the 32-bit count.
  Q(yield* ToNumber(x));
  return Throw.TypeError('$1 requires an argument of a sized integer type', Value('Math.clz'));
}

/** The int32 type `Math.imul` returns, whatever type its arguments carry. */
/**
 * proposal-runtime-types (spec, table-numeric-library-signatures, the `bigint`
 * column): the rows the listing gives the bigint type.
 *
 * They are the seven functions of the TC39 BigInt Math proposal plus the rounding
 * family as the identity, and they agree with that proposal value for value: the
 * roots truncate toward zero, a negative square root raises, and exponentiation
 * refuses a negative exponent. That agreement is deliberate, so that if the
 * proposal advances, `BigInt.sqrt(x)` and `Math.sqrt` of a bigint are one
 * mathematics with two spellings rather than two answers.
 *
 * A bigint is exact and unbounded, so unlike the sized integer rows nothing here
 * checks a return: every result these produce is a value of the type. The
 * arithmetic is done on BigInt throughout for the same reason it has to be.
 */
function* evaluateBigIntRow(functionName: string, args: Arguments): ValueEvaluator {
  const operands: bigint[] = [];
  for (const arg of args) {
    if (arg === undefined) {
      continue;
    }
    if (!(arg instanceof BigIntValue)) {
      // Mixing a bigint with a value of another numeric type is viable at no
      // signature, exactly as mixing two sized widths is.
      return Throw.TypeError('$1 has no signature taking values of two numeric types', Value(`Math.${functionName}`));
    }
    operands.push(arg.value);
  }
  const a = operands[0];
  if (a === undefined) {
    return Throw.TypeError('$1 requires an argument', Value(`Math.${functionName}`));
  }
  switch (functionName) {
    case 'abs':
      return Value(a < 0n ? -a : a);
    case 'sign':
      return Value(a > 0n ? 1n : (a < 0n ? -1n : 0n));
    case 'floor': case 'ceil': case 'round': case 'trunc':
      // A bigint is already an integer, so each of these is the argument.
      return Value(a);
    case 'min': case 'max': {
      let best = a;
      for (const v of operands) {
        if (functionName === 'min' ? v < best : v > best) {
          best = v;
        }
      }
      return Value(best);
    }
    case 'sqrt': {
      if (a < 0n) {
        return Throw.RangeError('$1 of a negative value is not defined', Value('Math.sqrt'));
      }
      return Value(bigIntSqrt(a));
    }
    case 'cbrt':
      return Value(bigIntCbrt(a));
    case 'pow': {
      const b = operands[1];
      if (b === undefined) {
        return Throw.TypeError('$1 requires an argument', Value('Math.pow'));
      }
      if (b < 0n) {
        // BigInt::exponentiate's own rule, and the sized integer rows follow it.
        return Throw.RangeError('$1 with a negative exponent is not defined for an integer type', Value('Math.pow'));
      }
      return Value(a ** b);
    }
    default:
      // Every other row of the listing gives the bigint column no signature.
      return Throw.TypeError('$1 has no signature taking a value of type $2', Value(`Math.${functionName}`), Value('bigint'));
  }
}

/** The exact integer square root of a non-negative bigint, by Newton's method. */
function bigIntSqrt(n: bigint): bigint {
  if (n < 2n) {
    return n;
  }
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** The exact integer cube root, truncated toward zero, so it is defined for a negative. */
function bigIntCbrt(n: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const a = n < 0n ? -n : n;
  if (a < 2n) {
    return sign * a;
  }
  // Bisect on the magnitude: the root is at most the value itself.
  let low = 0n;
  let high = a;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (mid * mid * mid <= a) {
      low = mid;
    } else {
      high = mid - 1n;
    }
  }
  return sign * low;
}

const int32TypeRecord: TypeRecord & { Kind: 'primitive' } = { Kind: 'primitive', Name: 'int', Arguments: [32] };

/**
 * proposal-runtime-types (spec, checked and saturating arithmetic, and floored
 * division): the named arithmetic forms.
 *
 * The operators wrap, because an operator has to be cheap and a bit pattern wants
 * wrapping. That is the right answer when the value is a bit pattern and the wrong
 * one when it is a count, and since neither is right always, the operator takes
 * the case that has to be cheap and these take the rest. `a + 1` on a `uint8`
 * holding 255 is 0, `Math.addChecked(a, 1)` raises, and `Math.addSaturating(a, 1)`
 * is 255.
 *
 * They exist only for the integer types, because only there is wrapping the
 * default: a float already saturates to an infinity, and a decimal and a rational
 * already raise. Each family's overflow behaviour is the one its values make
 * available, and these give the integer types the two the others have built in.
 *
 * The arithmetic is done on BigInt rather than on the Number payload. That is not
 * incidental: `Math.mulChecked` at `uint32` has to decide whether a product near
 * 2**64 is representable, and a double cannot answer that question about itself.
 */
const enum OverflowMode { Checked, Saturating }

/** The inclusive range of an integer type, as exact integers. */
function integerRange(t: TypeRecord & { Kind: 'primitive' }): { low: bigint, high: bigint } {
  const bits = BigInt(integerWidth(t));
  if (t.Name === 'uint') {
    return { low: 0n, high: (1n << bits) - 1n };
  }
  return { low: -(1n << (bits - 1n)), high: (1n << (bits - 1n)) - 1n };
}

/**
 * Resolve the one integer type a named form's operands share, or report why they
 * do not. These have NO untyped signature: the forms exist for the integer types,
 * and a call with no typed operand names no type to work in.
 */
function* resolveIntegerOperands(args: Arguments, functionName: string): PlainEvaluator<{ t: TypeRecord & { Kind: 'primitive' }, a: bigint, b: bigint }> {
  let carried: (TypeRecord & { Kind: 'primitive' }) | undefined;
  for (const arg of args.slice(0, 2)) {
    if (arg !== undefined && isTypedNumber(arg)) {
      const record = arg.TypeRecord as TypeRecord;
      if (record.Kind !== 'primitive' || !isIntegerTypeName(record.Name)) {
        return Throw.TypeError('$1 has no signature taking a value of type $2', Value(`Math.${functionName}`), Value(displayType(record)));
      }
      if (carried === undefined) {
        carried = record as TypeRecord & { Kind: 'primitive' };
      } else if (!SameType(carried, record)) {
        return Throw.TypeError('$1 has no signature taking values of two numeric types', Value(`Math.${functionName}`));
      }
    }
  }
  if (carried === undefined) {
    return Throw.TypeError('$1 requires an argument of a sized integer type', Value(`Math.${functionName}`));
  }
  const read = function* read(arg: Value | undefined): PlainEvaluator<bigint> {
    if (arg !== undefined && isTypedNumber(arg)) {
      return BigInt(arg.value);
    }
    // A plain operand beside a typed one is a literal and takes the parameter's
    // type, so one the type cannot represent matches no signature.
    const n = R(Q(yield* ToNumber(arg ?? Value.undefined))) as number;
    if (!Number.isInteger(n) || !fitsNumericType(n, carried!.Name, carried!.Arguments)) {
      return Throw.TypeError('$1 is not assignable to $2', arg ?? Value.undefined, Value(displayType(carried!)));
    }
    return BigInt(n);
  };
  const a = Q(yield* read(args[0]));
  const b = Q(yield* read(args[1]));
  return { t: carried, a, b };
}

/** Apply the family's out-of-range treatment to an exact result. */
function settleInteger(exact: bigint, t: TypeRecord & { Kind: 'primitive' }, mode: OverflowMode) {
  const { low, high } = integerRange(t);
  if (exact >= low && exact <= high) {
    return new TypedNumberValue(Number(exact), t);
  }
  if (mode === OverflowMode.Checked) {
    return Throw.RangeError('$1 is not in the range of $2', Value(String(exact)), Value(displayType(t)));
  }
  // Saturating: the nearest value of the type, which is its greatest when the
  // exact result exceeds it and its least when the exact result falls below.
  return new TypedNumberValue(Number(exact > high ? high : low), t);
}

/** The eight checked and saturating forms, which differ only in that treatment. */
/**
 * proposal-runtime-types #sec-vector-lane-wise-math: apply a Math function at
 * each lane, returning a vector of the argument's shape. Arguments of one shape
 * apply lane by lane, and a scalar beside a vector broadcasts.
 *
 * Shared by every Math function that admits a vector. The checked and saturating
 * forms are "overloaded for every integer type" (README), and an integer-lane
 * vector is one - they were registered without the wrapper that carried this,
 * so `Math.addSaturating` over a `uint8x16` was refused while the scalar form
 * worked.
 */
function* applyLaneWise(thisValue: ThisParameterType<NativeSteps>, steps: NativeSteps, args: Arguments, context: FunctionCallContext): ValueEvaluator {
  const vectorArg = args.find((a) => a !== undefined && a.type === 'Vector') as VectorValue | undefined;
  if (vectorArg === undefined) {
    return Throw.TypeError('$1 is not assignable to $2', Value(0), Value('a vector'));
  }
  const shape = vectorShape(vectorArg);
  if (shape === null) {
    return Throw.TypeError('$1 is not assignable to $2', vectorArg, Value('a vector'));
  }
  for (const arg of args) {
    if (arg !== undefined && arg.type === 'Vector'
        && !SameType((arg as VectorValue).TypeRecord as TypeRecord, vectorArg.TypeRecord as TypeRecord)) {
      return Throw.TypeError('$1 is not assignable to $2', arg, Value(displayType(vectorArg.TypeRecord as TypeRecord)));
    }
  }
  const lanes: Value[] = [];
  for (let i = 0; i < shape.laneCount; i += 1) {
    const laneArgs = args.map((a) => (a !== undefined && a.type === 'Vector'
      ? (a as VectorValue).lanes[i] as Value
      : a)) as Arguments;
    let lane = steps.call(thisValue, laneArgs, context);
    if (isEvaluator(lane)) {
      lane = yield* lane;
    }
    const laneValue = Q(EnsureCompletion(lane)) as Value;
    lanes.push(Q(yield* CheckedConvertValue(laneValue, shape.laneType)) as Value);
  }
  return new VectorValue(lanes, vectorArg.TypeRecord);
}

function namedArithmetic(functionName: string, mode: OverflowMode, combine: (a: bigint, b: bigint) => bigint | 'divide-by-zero'): NativeSteps {
  const steps: NativeSteps = function* namedArithmetic(this: ThisParameterType<NativeSteps>, args: Arguments, context: FunctionCallContext): ValueEvaluator {
    if (args.some((a) => a !== undefined && a.type === 'Vector')) {
      return Q(yield* applyLaneWise(this, steps, args, context));
    }
    const operands = Q(yield* resolveIntegerOperands(args, functionName));
    const exact = combine(operands.a, operands.b);
    if (exact === 'divide-by-zero') {
      // A division by zero has no exact result at all, so there is nothing for
      // either treatment to act on: saturation is about a result the type cannot
      // hold, and here there is no result. Both forms raise.
      return Throw.RangeError('$1 by zero is not defined', Value(`Math.${functionName}`));
    }
    return settleInteger(exact, operands.t, mode);
  };
  Object.defineProperty(steps, 'name', { value: `Math_${functionName}`, configurable: true });
  steps.section = 'https://sirisian.github.io/ecmascript-types/#sec-checked-and-saturating-arithmetic';
  return steps;
}

/** Integer division truncating toward zero, as the `/` operator rounds. */
function truncatedQuotient(a: bigint, b: bigint): bigint | 'divide-by-zero' {
  return b === 0n ? 'divide-by-zero' : a / b;
}

/** The quotient rounded toward negative infinity. */
function flooredQuotient(a: bigint, b: bigint): bigint {
  const q = a / b;
  return (a % b !== 0n && ((a < 0n) !== (b < 0n))) ? q - 1n : q;
}

/**
 * proposal-runtime-types (spec, floored division): the floored pair also has a
 * signature over the Number type, unlike the checked and saturating forms.
 *
 * Those exist only for the integer types for a stated reason, that only there is
 * wrapping the default, and a checked form at `number` would have nothing to
 * check. That reasoning does not transfer here: this pair is not about overflow
 * at all but about ROUNDING DIRECTION, which is meaningful for any real. The
 * three precedents the clause names, Python's `%` and the `mod` of Kotlin and
 * Haskell, are ordinary-number operations, and the pair's own motivating use,
 * wrapping an index with `array[Math.mod(i, array.length)]`, is written in
 * untyped code where both operands are plain Numbers.
 *
 * A zero divisor follows the family, as every other rule in this specification
 * does. At an integer type it raises, because an integer type has no infinity and
 * no NaN and so has nothing to return, which is what Python, Java, Kotlin, Rust,
 * and Haskell all do for integer division by zero. At `number` there IS something
 * to return, and the answer is the one the operators already give: `Math.mod(_a_,
 * 0)` is *NaN*, as `_a_ % 0` is, and `Math.divFloor(_a_, 0)` is an infinity, as
 * `Math.floor(_a_ / 0)` is. That is also what C, Java, Rust, and every IEEE 754
 * host do for a floating-point remainder by zero.
 */
function plainFloored(args: Arguments, which: 'divFloor' | 'mod'): ValueEvaluator {
  return (function* plainFloored(): ValueEvaluator {
    const a = R(Q(yield* ToNumber(args[0] ?? Value.undefined))) as number;
    const b = R(Q(yield* ToNumber(args[1] ?? Value.undefined))) as number;
    const quotient = Math.floor(a / b);
    return F(which === 'divFloor' ? quotient : a - (b * quotient));
  }());
}

/** https://sirisian.github.io/ecmascript-types/#sec-floored-division */
function* Math_divFloor(args: Arguments): ValueEvaluator {
  if (!args.some((arg) => arg !== undefined && isTypedNumber(arg))) {
    return Q(yield* plainFloored(args, 'divFloor'));
  }
  const { t, a, b } = Q(yield* resolveIntegerOperands(args, 'divFloor'));
  if (b === 0n) {
    return Throw.RangeError('$1 by zero is not defined', Value('Math.divFloor'));
  }
  // The floored quotient overflows in exactly one case, the most negative value
  // divided by -1, and it is checked like any other declared return.
  return settleInteger(flooredQuotient(a, b), t, OverflowMode.Checked);
}

/** https://sirisian.github.io/ecmascript-types/#sec-floored-division */
function* Math_mod(args: Arguments): ValueEvaluator {
  if (!args.some((arg) => arg !== undefined && isTypedNumber(arg))) {
    return Q(yield* plainFloored(args, 'mod'));
  }
  const { t, a, b } = Q(yield* resolveIntegerOperands(args, 'mod'));
  if (b === 0n) {
    return Throw.RangeError('$1 by zero is not defined', Value('Math.mod'));
  }
  // The remainder whose sign follows the DIVISOR, which is the `%` of Python and
  // the `mod` of Kotlin and Haskell, and is what makes it usable for wrapping an
  // index: for a positive divisor the result is never negative. The operator `%`
  // follows the dividend instead, which is why both exist.
  const r = a - flooredQuotient(a, b) * b;
  return settleInteger(r, t, OverflowMode.Checked);
}

export function bootstrapMath(realmRec: Realm) {
  /** https://tc39.es/ecma262/#sec-value-properties-of-the-math-object */
  const readonly = { Writable: Value.false, Configurable: Value.false };

  // @@toStringTag is handled in the bootstrapPrototype() call.
  const mathObj = bootstrapPrototype(realmRec, [
    ['E', F(2.718281828459045), undefined, readonly],
    ['LN10', F(2.302585092994046), undefined, readonly],
    ['LN2', F(0.6931471805599453), undefined, readonly],
    ['LOG10E', F(0.4342944819032518), undefined, readonly],
    ['LOG2E', F(1.4426950408889634), undefined, readonly],
    ['PI', F(3.141592653589793), undefined, readonly],
    ['SQRT1_2', F(0.7071067811865476), undefined, readonly],
    ['SQRT2', F(1.4142135623730951), undefined, readonly],
    // proposal-runtime-types (spec, checked and saturating arithmetic, and
    // floored division): the named arithmetic forms. Gated, so the flag-off
    // engine is unchanged.
    ...(surroundingAgent.feature('runtime-types') ? [
      ['addChecked', namedArithmetic('addChecked', OverflowMode.Checked, (a, b) => a + b), 2],
      ['subChecked', namedArithmetic('subChecked', OverflowMode.Checked, (a, b) => a - b), 2],
      ['mulChecked', namedArithmetic('mulChecked', OverflowMode.Checked, (a, b) => a * b), 2],
      ['divChecked', namedArithmetic('divChecked', OverflowMode.Checked, truncatedQuotient), 2],
      ['addSaturating', namedArithmetic('addSaturating', OverflowMode.Saturating, (a, b) => a + b), 2],
      ['subSaturating', namedArithmetic('subSaturating', OverflowMode.Saturating, (a, b) => a - b), 2],
      ['mulSaturating', namedArithmetic('mulSaturating', OverflowMode.Saturating, (a, b) => a * b), 2],
      ['divSaturating', namedArithmetic('divSaturating', OverflowMode.Saturating, truncatedQuotient), 2],
      ['divFloor', Math_divFloor, 2],
      ['mod', Math_mod, 2],
    ] as [string, NativeSteps, number][] : []),
    ['abs', withNumericLibrarySignatures(Math_abs, 'abs'), 1],
    ['acos', withNumericLibrarySignatures(Math_acos, 'acos'), 1],
    ['acosh', withNumericLibrarySignatures(Math_acosh, 'acosh'), 1],
    ['asin', withNumericLibrarySignatures(Math_asin, 'asin'), 1],
    ['asinh', withNumericLibrarySignatures(Math_asinh, 'asinh'), 1],
    ['atan', withNumericLibrarySignatures(Math_atan, 'atan'), 1],
    ['atan2', withNumericLibrarySignatures(Math_atan2, 'atan2'), 2],
    ['atanh', withNumericLibrarySignatures(Math_atanh, 'atanh'), 1],
    ['cbrt', withNumericLibrarySignatures(Math_cbrt, 'cbrt'), 1],
    ['ceil', withNumericLibrarySignatures(Math_ceil, 'ceil'), 1],
    ['clz32', withNumericLibrarySignatures(Math_clz32, 'clz32'), 1],
    // proposal-runtime-types (spec, counting leading zeros): the width-relative
    // count. Gated, so the flag-off engine is unchanged.
    surroundingAgent.feature('runtime-types')
      ? ['clz', withNumericLibrarySignatures(Math_clz, 'clz'), 1] as const
      : undefined,
    ['cos', withNumericLibrarySignatures(Math_cos, 'cos'), 1],
    ['cosh', withNumericLibrarySignatures(Math_cosh, 'cosh'), 1],
    ['exp', withNumericLibrarySignatures(Math_exp, 'exp'), 1],
    ['expm1', withNumericLibrarySignatures(Math_expm1, 'expm1'), 1],
    ['f16round', withNumericLibrarySignatures(Math_f16round, 'f16round'), 1],
    ['floor', withNumericLibrarySignatures(Math_floor, 'floor'), 1],
    ['fround', withNumericLibrarySignatures(Math_fround, 'fround'), 1],
    ['hypot', withNumericLibrarySignatures(Math_hypot, 'hypot'), 2],
    ['imul', withNumericLibrarySignatures(Math_imul, 'imul'), 2],
    ['log', withNumericLibrarySignatures(Math_log, 'log'), 1],
    ['log10', withNumericLibrarySignatures(Math_log10, 'log10'), 1],
    ['log1p', withNumericLibrarySignatures(Math_log1p, 'log1p'), 1],
    ['log2', withNumericLibrarySignatures(Math_log2, 'log2'), 1],
    ['max', withNumericLibrarySignatures(Math_max, 'max'), 2],
    ['min', withNumericLibrarySignatures(Math_min, 'min'), 2],
    ['pow', withNumericLibrarySignatures(Math_pow, 'pow'), 2],
    ['random', Math_random, 0],
    ['round', withNumericLibrarySignatures(Math_round, 'round'), 1],
    ['sign', withNumericLibrarySignatures(Math_sign, 'sign'), 1],
    ['sin', withNumericLibrarySignatures(Math_sin, 'sin'), 1],
    ['sinh', withNumericLibrarySignatures(Math_sinh, 'sinh'), 1],
    ['fma', withNumericLibrarySignatures(Math_fma, 'fma'), 3],
    ['rsqrt', withNumericLibrarySignatures(Math_rsqrt, 'rsqrt'), 1],
    ['sqrt', withNumericLibrarySignatures(Math_sqrt, 'sqrt'), 1],
    ['sumPrecise', withNumericLibrarySignatures(Math_sumPrecise, 'sumPrecise'), 1],
    ['tan', withNumericLibrarySignatures(Math_tan, 'tan'), 1],
    ['tanh', withNumericLibrarySignatures(Math_tanh, 'tanh'), 1],
    ['trunc', withNumericLibrarySignatures(Math_trunc, 'trunc'), 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Math');

  realmRec.Intrinsics['%Math%'] = mathObj;
}
