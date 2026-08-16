import {
  Value, ObjectValue, JSStringValue,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw } from '#self';
import {
  OrdinaryObjectCreate,
  CreateBuiltinFunction,
  Descriptor,
  X,
  type OrdinaryObject,
  Realm,
} from '#self';

/**
 * proposal-runtime-types (decimal.md): the decimal value types, stage A of
 * PLAN-decimal.md.
 *
 * A decimal value is a SIGNIFICAND and an EXPONENT, so that the value denotes
 * significand x 10^exponent. That pair is the representation the type exists
 * for: `1.0`, `1.00` and `1.000` are three values of `decimal128` with one
 * numerical value, and **a JS number cannot hold that distinction** - all three
 * are the same double. IEEE 754 calls such a set a COHORT.
 *
 * The significand is a BigInt so the value is exact and the width is a property
 * of the TYPE rather than of the storage; `decimal32`, `decimal64` and
 * `decimal128` differ in how many significant digits they admit, which is a
 * later stage's business.
 *
 * **A decimal is an OBJECT with value semantics, not a new primitive** - the
 * shape `rational` already establishes here, and the reason is the same. Adding
 * a primitive would touch `typeof`, ToPrimitive and every conversion path; the
 * identity the design needs comes instead from a branch in SameValue, exactly
 * as rational's does. PLAN-decimal.md 4.2a asked this and it settled itself:
 * `SameValue` already carries `isRationalObject(x) || isRationalObject(y)`.
 *
 * What is NOT here, by design: arithmetic, literals, conversions, and the
 * width limits. Stage A is the representation and the equality split alone,
 * because the split is the whole reason the representation has to be a pair.
 */

export interface DecimalObject extends OrdinaryObject {
  /** The significand, exact and arbitrary-precision. */
  DecimalSignificand: bigint;
  /** The base-10 exponent, so the value is DecimalSignificand x 10^DecimalExponent. */
  DecimalExponent: number;
  /** Which of `decimal32`, `decimal64`, `decimal128` this value belongs to. */
  DecimalWidth: 32 | 64 | 128;
}

export function isDecimalObject(value: Value): value is DecimalObject {
  return value instanceof ObjectValue && 'DecimalSignificand' in value;
}

/**
 * The REDUCED member of a cohort: trailing zeros stripped from the significand,
 * the exponent raised to match.
 *
 * This is "the one member computable from the numerical value alone,
 * independent of the width" (composites.md), which is why it is what a
 * composite stores where the field's type declares no scale. Zero reduces to a
 * significand of 0 with exponent 0, since every `0 x 10^n` is the same
 * numerical value.
 */
export function ReduceDecimal(significand: bigint, exponent: number): { significand: bigint, exponent: number } {
  if (significand === 0n) {
    return { significand: 0n, exponent: 0 };
  }
  let s = significand;
  let e = exponent;
  while (s % 10n === 0n) {
    s /= 10n;
    e += 1;
  }
  return { significand: s, exponent: e };
}

/**
 * Whether two decimals are the same COHORT MEMBER - the same significand at the
 * same exponent.
 *
 * This is what SameValue asks: the spec settles that "SameValue distinguishes
 * cohort members, so `Object.is(1.0, 1.00)` is *false* for two `decimal128`
 * values of different exponents". IEEE 754 provides the same distinction as
 * `totalOrder`, alongside `compareQuietEqual` for numerical value.
 */
export function decimalSameValue(x: DecimalObject, y: DecimalObject): boolean {
  return x.DecimalSignificand === y.DecimalSignificand
    && x.DecimalExponent === y.DecimalExponent;
}

/**
 * Whether two decimals have the same NUMERICAL VALUE, whatever their cohort
 * members - what `==` and SameValueZero ask, and IEEE's `compareQuietEqual`.
 *
 * Compared through the reduced member rather than by scaling one operand to the
 * other's exponent: reduction is total, where scaling has to choose a direction
 * and can only widen.
 */
export function decimalEquals(x: DecimalObject, y: DecimalObject): boolean {
  const a = ReduceDecimal(x.DecimalSignificand, x.DecimalExponent);
  const b = ReduceDecimal(y.DecimalSignificand, y.DecimalExponent);
  return a.significand === b.significand && a.exponent === b.exponent;
}

/**
 * The significant digits each width admits, from IEEE 754-2008 Table 3.1.
 * `decimal128` carrying 34 is the figure decimal.md quotes.
 */
export function DecimalPrecision(width: 32 | 64 | 128): number {
  return width === 32 ? 7 : width === 64 ? 16 : 34;
}

/** How many decimal digits a magnitude has. */
function digitCount(v: bigint): number {
  const m = v < 0n ? -v : v;
  return m === 0n ? 1 : m.toString().length;
}

/**
 * Round a significand to at most `precision` digits, HALF-EVEN, raising the
 * exponent to match. Half-even is IEEE's default rounding direction and the one
 * decimal.md names ("rounds ties to even by default").
 */
function roundToPrecision(significand: bigint, exponent: number, precision: number): { significand: bigint, exponent: number } {
  const excess = digitCount(significand) - precision;
  if (excess <= 0) {
    return { significand, exponent };
  }
  const scale = 10n ** BigInt(excess);
  const negative = significand < 0n;
  const magnitude = negative ? -significand : significand;
  const quotient = magnitude / scale;
  const remainder = magnitude % scale;
  const half = scale / 2n;
  let rounded = quotient;
  if (remainder > half || (remainder === half && quotient % 2n === 1n)) {
    rounded += 1n;
  }
  return { significand: negative ? -rounded : rounded, exponent: exponent + excess };
}

/**
 * IEEE 754-2008 clause 5.1: an operation delivers its PREFERRED EXPONENT where
 * the result is exact, and otherwise the exponent closest to it that represents
 * the result.
 *
 * This is why `1.5 + 1.50` is `3.00` and not `3.0`: addition's preferred
 * exponent is min(Q(x), Q(y)), which is -2 here. **The rule is the standard's,
 * not this proposal's**, and taking it from the standard is what stops the
 * cohort member of a result from being invented per operation.
 */
function atPreferredExponent(significand: bigint, exponent: number, preferred: number, width: 32 | 64 | 128): DecimalParts {
  let s = significand;
  let e = exponent;
  // Lower the exponent toward the preferred one by lengthening the significand,
  // which is exact.
  while (e > preferred && digitCount(s) < DecimalPrecision(width)) {
    s *= 10n;
    e -= 1;
  }
  // Raise it toward the preferred one only where doing so loses nothing.
  while (e < preferred && s % 10n === 0n && s !== 0n) {
    s /= 10n;
    e += 1;
  }
  return roundToPrecision(s, e, DecimalPrecision(width));
}

export interface DecimalParts { significand: bigint, exponent: number }

/** Both operands at one exponent, which is the lower of the two - always exact. */
function align(x: DecimalObject, y: DecimalObject): { xs: bigint, ys: bigint, exponent: number } {
  const exponent = Math.min(x.DecimalExponent, y.DecimalExponent);
  const xs = x.DecimalSignificand * 10n ** BigInt(x.DecimalExponent - exponent);
  const ys = y.DecimalSignificand * 10n ** BigInt(y.DecimalExponent - exponent);
  return { xs, ys, exponent };
}

/** The wider of two widths - a mixed-width operation answers at the wider. */
function widerOf(x: DecimalObject, y: DecimalObject): 32 | 64 | 128 {
  return (Math.max(x.DecimalWidth, y.DecimalWidth) as 32 | 64 | 128);
}

export function decimalAdd(x: DecimalObject, y: DecimalObject): { parts: DecimalParts, width: 32 | 64 | 128 } {
  const { xs, ys, exponent } = align(x, y);
  const width = widerOf(x, y);
  // Addition's preferred exponent is min(Q(x), Q(y)), which is what `align`
  // already computed.
  return { parts: atPreferredExponent(xs + ys, exponent, exponent, width), width };
}

export function decimalSubtract(x: DecimalObject, y: DecimalObject): { parts: DecimalParts, width: 32 | 64 | 128 } {
  const { xs, ys, exponent } = align(x, y);
  const width = widerOf(x, y);
  return { parts: atPreferredExponent(xs - ys, exponent, exponent, width), width };
}

export function decimalMultiply(x: DecimalObject, y: DecimalObject): { parts: DecimalParts, width: 32 | 64 | 128 } {
  // Multiplication's preferred exponent is Q(x) + Q(y).
  const exponent = x.DecimalExponent + y.DecimalExponent;
  const width = widerOf(x, y);
  return {
    parts: atPreferredExponent(x.DecimalSignificand * y.DecimalSignificand, exponent, exponent, width),
    width,
  };
}

/**
 * Division, which is where exactness runs out: `1 / 3` has no finite decimal
 * expansion, so the quotient is computed to the type's PRECISION and rounded
 * half-even. Where the division IS exact, the preferred exponent Q(x) - Q(y)
 * applies as the other operations' do.
 */
export function decimalDivide(x: DecimalObject, y: DecimalObject): { parts: DecimalParts, width: 32 | 64 | 128 } | 'divide-by-zero' {
  if (y.DecimalSignificand === 0n) {
    return 'divide-by-zero';
  }
  const width = widerOf(x, y);
  const precision = DecimalPrecision(width);
  const preferred = x.DecimalExponent - y.DecimalExponent;
  // Lengthen the dividend so the quotient has at least `precision` digits, then
  // round - which makes an exact division exact and an inexact one correctly
  // rounded.
  const extra = precision + 1 + Math.max(0, digitCount(y.DecimalSignificand) - digitCount(x.DecimalSignificand));
  const scaled = x.DecimalSignificand * 10n ** BigInt(extra);
  const quotient = scaled / y.DecimalSignificand;
  const exact = scaled % y.DecimalSignificand === 0n;
  const parts = exact
    ? atPreferredExponent(quotient, preferred - extra, preferred, width)
    : roundToPrecision(quotient, preferred - extra, precision);
  return { parts, width };
}

/** IEEE's remainder: x - y * n, where n is x/y rounded to nearest-even. */
export function decimalRemainder(x: DecimalObject, y: DecimalObject): { parts: DecimalParts, width: 32 | 64 | 128 } | 'divide-by-zero' {
  if (y.DecimalSignificand === 0n) {
    return 'divide-by-zero';
  }
  const { xs, ys, exponent } = align(x, y);
  const width = widerOf(x, y);
  // Remainder's preferred exponent is min(Q(x), Q(y)), and the result is always
  // exact, so no rounding is reachable here.
  return { parts: atPreferredExponent(xs % ys, exponent, exponent, width), width };
}

export function decimalNegate(x: DecimalObject): { parts: DecimalParts, width: 32 | 64 | 128 } {
  return { parts: { significand: -x.DecimalSignificand, exponent: x.DecimalExponent }, width: x.DecimalWidth };
}

/** -1, 0 or 1, comparing NUMERICAL VALUE - IEEE's `compareQuietLess` and friends. */
export function decimalCompare(x: DecimalObject, y: DecimalObject): number {
  const { xs, ys } = align(x, y);
  return xs < ys ? -1 : xs > ys ? 1 : 0;
}

/**
 * The EXACT decimal expansion of a binary double, before any rounding.
 *
 * Every binary float is a terminating decimal, because 2 divides 10: a double is
 * m x 2^e, and for a negative e that is m x 5^|e| / 10^|e| - exact, with no
 * division. `0.1` expands to 55 significant digits this way, which is the figure
 * the specification quotes when it flags this conversion as the hard one.
 */
function exactExpansionOfDouble(value: number): { significand: bigint, exponent: number } | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if (value === 0) {
    return { significand: 0n, exponent: 0 };
  }
  // Read the double's own significand and exponent from its bits, rather than
  // going through a decimal string - the string is already a rounding, and this
  // conversion is defined over what the float HOLDS.
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, value);
  const hi = buffer.getUint32(0);
  const lo = buffer.getUint32(4);
  const negative = (hi & 0x80000000) !== 0;
  const rawExponent = (hi >>> 20) & 0x7FF;
  const rawMantissa = (BigInt(hi & 0xFFFFF) << 32n) | BigInt(lo);
  // A subnormal has no implicit leading 1 and a fixed exponent.
  const mantissa = rawExponent === 0 ? rawMantissa : rawMantissa | (1n << 52n);
  const exponent = (rawExponent === 0 ? -1074 : rawExponent - 1075);
  let significand;
  let decimalExponent;
  if (exponent >= 0) {
    significand = mantissa << BigInt(exponent);
    decimalExponent = 0;
  } else {
    // m / 2^k = m x 5^k / 10^k, which is exact.
    significand = mantissa * 5n ** BigInt(-exponent);
    decimalExponent = exponent;
  }
  return { significand: negative ? -significand : significand, exponent: decimalExponent };
}

/**
 * A `float64` as a decimal of the given width.
 *
 * decimal.md settles which cohort member results, and it is the one that
 * surprises: "`decimal128(f)` CARRIES WHATEVER `f` ALREADY HOLDS, so a binary
 * `0.1` stays slightly off - which is why an exact decimal comes from a literal
 * or a string, never from a round trip through binary", and the comment beside
 * it reads "carries the float's binary value, ROUNDED TO 34 DIGITS".
 *
 * So this is the exact expansion rounded to the width's precision, and NOT the
 * shortest round-tripping digits. The alternative would make `decimal128(0.1)`
 * equal `decimal128('0.1')` and thereby hide the whole reason the decimal types
 * exist: the two are different values, and a conversion that pretended
 * otherwise would launder a binary approximation into an exact-looking decimal.
 */
export function DecimalFromDouble(value: number, width: 32 | 64 | 128): DecimalParts | undefined {
  const exact = exactExpansionOfDouble(value);
  if (!exact) {
    return undefined;
  }
  // REDUCE FIRST, then ask whether it fits. The exact expansion of `0.5` is
  // 2^52 x 5^53 over 10^53 - a 53-digit significand for a value with one
  // significant digit - so testing the UNREDUCED expansion against the
  // precision answers "does not fit" for a value that plainly does.
  const reduced = ReduceDecimal(exact.significand, exact.exponent);
  if (digitCount(reduced.significand) <= DecimalPrecision(width)) {
    // The double holds this value EXACTLY, so the conversion is exact and the
    // reduced member is what to deliver: `0.5` arrives as `0.5`, not as
    // `0.5000...0` padded to the width.
    return reduced;
  }
  // The value does NOT fit, so every digit kept is one the double actually
  // holds, and reducing would discard information this conversion exists to
  // expose - `decimal128(0.1)` is the binary approximation, not one tenth.
  return roundToPrecision(exact.significand, exact.exponent, DecimalPrecision(width));
}

/**
 * A decimal as a `float64` - the nearest double to the decimal's value.
 *
 * Exact where the value has an exact binary form and rounded where it does not,
 * which is the ordinary direction of loss and needs no rule of its own.
 */
/** A decimal re-rounded to another width's precision. */
export function RoundDecimalToWidth(d: DecimalObject, width: 32 | 64 | 128): DecimalParts {
  return roundToPrecision(d.DecimalSignificand, d.DecimalExponent, DecimalPrecision(width));
}

export function DoubleFromDecimal(d: DecimalObject): number {
  return Number(`${d.DecimalSignificand}e${d.DecimalExponent}`);
}

/** The decimal `significand x 10^exponent`, as an object of the given width. */
export function CreateDecimalValue(significand: bigint, exponent: number, width: 32 | 64 | 128, realmRec: Realm, typeRecord?: unknown): DecimalObject {
  const proto = realmRec.Intrinsics['%decimal.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['DecimalSignificand', 'DecimalExponent', 'DecimalWidth', 'TypeRecord']) as Mutable<DecimalObject>;
  obj.DecimalSignificand = significand;
  obj.DecimalExponent = exponent;
  obj.DecimalWidth = width;
  // proposal-runtime-types #sec-enums: an enumerator of a decimal-underlying
  // enum carries that enum here, so `Reflect.typeOf` reports it and membership
  // can tell one declaration's `1.0` from another's. The tag is set on a fresh
  // decimal rather than on the value the program wrote - a decimal may be
  // written from a shared binding, and tagging that would claim someone else's
  // object. A decimal is compared by content (decimalSameValue), so the copy is
  // SameValue-equal to the original and nothing observable changes.
  (obj as Mutable<DecimalObject> & { TypeRecord?: unknown }).TypeRecord = typeRecord;
  return obj;
}

/**
 * Read a decimal from its digits, which is where a cohort member comes from:
 * "a decimal type reads its cohort member from the SOURCE TEXT rather than from
 * the mathematical value, since `1.0` and `1.00` have the same mathematical
 * value". `'1.0'` is 10 x 10^-1 and `'1.00'` is 100 x 10^-2 - equal in value,
 * distinct as members.
 */
export function ParseDecimalDigits(text: string): { significand: bigint, exponent: number } | undefined {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m) {
    return undefined;
  }
  const [, sign, whole, frac] = m;
  const digits = (whole ?? '') + (frac ?? '');
  if (digits.length === 0) {
    return undefined;
  }
  const magnitude = BigInt(digits);
  return {
    significand: sign === '-' ? -magnitude : magnitude,
    exponent: -(frac?.length ?? 0),
  };
}

/** The decimal's digits, at its own exponent - so a cohort member prints as written. */
export function DecimalToString(d: DecimalObject): string {
  const negative = d.DecimalSignificand < 0n;
  const digits = (negative ? -d.DecimalSignificand : d.DecimalSignificand).toString();
  let out;
  if (d.DecimalExponent >= 0) {
    out = digits + '0'.repeat(d.DecimalExponent);
  } else {
    const places = -d.DecimalExponent;
    const padded = digits.padStart(places + 1, '0');
    out = `${padded.slice(0, padded.length - places)}.${padded.slice(padded.length - places)}`;
  }
  return negative ? `-${out}` : out;
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-decimal-types */
function* DecimalProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isDecimalObject(thisValue)) {
    return Throw.TypeError('$1 is not a decimal', thisValue);
  }
  return Value(DecimalToString(thisValue));
}

/**
 * REFUSES, until the operator set lands.
 *
 * A `valueOf` returning the digit STRING would make `d1 + d2` concatenate -
 * measured, `decimal128('1.0') + decimal128('2.0')` gave `'1.02.0'` - and one
 * returning a Number would give an ANSWER, silently rounded through the binary
 * double this type exists to avoid. **Both are worse than an error**: the first
 * is nonsense that looks like a value, the second is a wrong value that looks
 * right.
 *
 * Stage C owns the operators, with IEEE's exponent rules deciding which cohort
 * member results - `1.5 + 1.50` is `3.00`, not `3.0`.
 */
/** https://sirisian.github.io/proposal-runtime-types/#sec-decimal-types */
function* DecimalProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isDecimalObject(thisValue)) {
    return Throw.TypeError('$1 is not a decimal', thisValue);
  }
  return Throw.TypeError('decimal arithmetic is not yet defined; use toString to read the value');
}

function* DecimalConstructorBody(width: 32 | 64 | 128, args: Arguments): ValueEvaluator {
  const [input] = args;
  if (input instanceof JSStringValue) {
    const parsed = ParseDecimalDigits(input.stringValue());
    if (!parsed) {
      return Throw.SyntaxError('$1 is not a decimal', input);
    }
    return CreateDecimalValue(parsed.significand, parsed.exponent, width, surroundingAgent.currentRealmRecord);
  }
  // A NUMBER argument is deliberately refused for now. `decimal128(0.1)` would
  // have to choose a cohort member for a binary double whose exact expansion is
  // 55 digits, and the spec flags that conversion as the hard one - "the
  // difficulty is not arithmetic but which cohort member results". Stage F owns
  // it; refusing is what keeps a wrong answer from being shipped meanwhile.
  return Throw.TypeError('a decimal is constructed from a string of digits; the conversion from $1 is not yet defined', input ?? Value.undefined);
}

export function bootstrapDecimalPrototype(realmRec: Realm): void {
  const proto = bootstrapPrototype(realmRec, [
    ['toString', DecimalProto_toString, 0],
    ['valueOf', DecimalProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'decimal');
  realmRec.Intrinsics['%decimal.prototype%'] = proto;
}

export function bootstrapDecimal(realmRec: Realm): void {
  const proto = realmRec.Intrinsics['%decimal.prototype%'];
  for (const width of [32, 64, 128] as const) {
    const ctor = CreateBuiltinFunction(
      function* decimalCtor(_thisValue: Value, args: Arguments, _ctx: FunctionCallContext): ValueEvaluator {
        return yield* DecimalConstructorBody(width, args);
      } as never,
      1,
      Value(`decimal${width}`),
      [],
      realmRec,
    );
    X(ctor.DefineOwnProperty(Value('prototype'), Descriptor({
      Value: proto, Writable: Value.false, Enumerable: Value.false, Configurable: Value.false,
    })));
    realmRec.Intrinsics[`%decimal${width}%` as '%decimal128%'] = ctor;
  }
}
