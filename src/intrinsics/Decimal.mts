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

/** The decimal `significand x 10^exponent`, as an object of the given width. */
export function CreateDecimalValue(significand: bigint, exponent: number, width: 32 | 64 | 128, realmRec: Realm): DecimalObject {
  const proto = realmRec.Intrinsics['%decimal.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['DecimalSignificand', 'DecimalExponent', 'DecimalWidth']) as Mutable<DecimalObject>;
  obj.DecimalSignificand = significand;
  obj.DecimalExponent = exponent;
  obj.DecimalWidth = width;
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
