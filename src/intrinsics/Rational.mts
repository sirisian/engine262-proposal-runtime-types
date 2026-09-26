import {
  Value, ObjectValue, NumberValue, BigIntValue, isTypedNumber, TypedNumberValue,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q, type ValueEvaluator, type ThrowCompletion } from '../completion.mts';
import { isIntegerTypeName } from '../type-system/numeric-signatures.mts';
import { JSStringValue } from '../value.mts';
import { type Mutable } from '../utils/language.mts';
import { makePrimitive } from '../type-system/records.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { isDecimalObject, exactExpansionOfDouble } from './Decimal.mts';
import { isFloat128Object } from './Float128.mts';
import { surroundingAgent, Throw } from '#self';
import {
  OrdinaryObjectCreate,
  CreateBuiltinFunction, ToNumber,
  Descriptor,
  X,
  type OrdinaryObject,
  Realm,
} from '#self';

/**
 * proposal-runtime-types (rational.md): the rational value type.
 *
 * A rational is an exact fraction, a numerator over a denominator, always kept in
 * canonical form: reduced to lowest terms, denominator strictly positive, zero as
 * 0/1. Because the form is canonical, two rationals are equal exactly when their
 * numerator and denominator are, so structural equality is mathematical equality.
 * The value is backed by a pair of arbitrary-precision integers here, so the
 * arithmetic is exact without overflow; the design's fixed-width `rational.<N>`,
 * whose overflow is a RangeError, the `1/3`-in-a-rational-context literal sugar,
 * the float and integer conversions, and the Math overloads are its deferred
 * remainder, as are the sibling complex and decimal value types.
 */

export interface RationalObject extends OrdinaryObject {
  RationalNumerator: bigint;
  RationalDenominator: bigint;
  /** The type the value was built at: `rational.<N>`, the bare `rational` being width 64. */
  TypeRecord?: unknown;
}

export function isRationalObject(value: Value): value is RationalObject {
  return value instanceof ObjectValue && 'RationalNumerator' in value;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

// Reduce to lowest terms with a strictly positive denominator, zero as 0/1.
function canonicalize(num: bigint, den: bigint): { num: bigint, den: bigint } {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  if (num === 0n) {
    return { num: 0n, den: 1n };
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/**
 * The width _N_ of a `rational.<N>` type record: its argument where it has one,
 * and 64 for the bare `rational`, which is `rational.<64>`.
 */
/** The type's name as a diagnostic shows it: `rational` for width 64. */
export function rationalDisplay(typeRecord: unknown): string {
  const width = rationalWidthOf(typeRecord);
  return width === 64 ? 'rational' : `rational.<${width}>`;
}

export function rationalWidthOf(typeRecord: unknown): number {
  const args = (typeRecord as { Arguments?: readonly unknown[] } | undefined)?.Arguments;
  if (args === undefined || args.length === 0) {
    return 64;
  }
  // #sec-rational-types: "For each positive integer N". Any other argument -
  // `rational.<1.5>`, `rational.<0>`, `rational.<bigint>` - names no type: NaN, which
  // no width equals. It answered 64 for anything that was not a number, so
  // `rational.<bigint>` was silently a 64-bit rational, and a non-integer width
  // reached `BigInt` and crashed the host.
  const width = args[0];
  return typeof width === 'number' && Number.isInteger(width) && width >= 1 ? width : Number.NaN;
}

/** Refusal of a rational type whose width is not a positive integer: it names no type. */
function refuseRationalWidth(typeRecord: unknown): ThrowCompletion {
  const width = (typeRecord as { Arguments?: readonly unknown[] } | undefined)?.Arguments?.[0];
  const shown = typeof width === 'number' ? String(width) : ((width as { Name?: string } | undefined)?.Name ?? 'a type');
  return Throw.TypeError(`rational.<${shown}> is not a type: a rational width is a positive integer`);
}

/**
 * Every `rational` value is built here - by conversion, arithmetic, literals,
 * `Math` and `++` alike - so this is the one place the type's BOUND is enforced,
 * and no path can reach a value without passing it.
 *
 * #sec-rational-types: `rational.<N>` holds "the exact rational numbers
 * representable as a quotient of two values of `int.<N>`", and "an operation
 * whose exact result is not representable, including one whose normalized
 * numerator or denominator falls outside `int.<N>`, throws a RangeError rather
 * than rounding." These were unbounded BigInts and nothing checked, so
 * `rational(2**62, 1) * rational(2**62, 1)` was a numerator of 2**124.
 *
 * The check is on the NORMALIZED fraction: an intermediate may exceed the width
 * so long as the reduced result fits, which the BigInt arithmetic computes
 * exactly. The canonical denominator is positive, so it must fit 1 to
 * 2**(N-1) - 1; the numerator must fit all of `int.<N>`.
 */
export function CreateRationalValue(numerator: bigint, denominator: bigint, realmRec: Realm, typeRecord?: unknown): RationalObject | ThrowCompletion {
  const { num, den } = canonicalize(numerator, denominator);
  if (Number.isNaN(rationalWidthOf(typeRecord))) {
    return refuseRationalWidth(typeRecord);
  }
  const width = BigInt(rationalWidthOf(typeRecord));
  const max = (1n << (width - 1n)) - 1n;
  if (num < -max - 1n || num > max || den > max) {
    return Throw.RangeError('$1 is not in the range of $2', Value(`${num}/${den}`),
      Value(width === 64n ? 'rational' : `rational.<${width}>`));
  }
  const proto = realmRec.Intrinsics['%rational.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['RationalNumerator', 'RationalDenominator']) as Mutable<RationalObject>;
  obj.RationalNumerator = num;
  obj.RationalDenominator = den;
  // A decimal object carries its Type Record so `CarriedTypeRecordOf` can answer
  // for it, which is how a decimal VALUE satisfies a `decimal64` annotation. A
  // rational carried none, so once `rational` became a primitive type the value
  // and the type no longer matched and every binding refused its own literal.
  // A crossing into a parameterization passes the parameterized type.
  (obj as Mutable<RationalObject> & { TypeRecord?: unknown }).TypeRecord = typeRecord ?? makePrimitive('rational', []);
  return obj;
}

// Exact arithmetic over canonical rationals. Each returns a fresh canonical value.
export function rationalAdd(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject | ThrowCompletion {
  return CreateRationalValue(a.RationalNumerator * b.RationalDenominator + b.RationalNumerator * a.RationalDenominator, a.RationalDenominator * b.RationalDenominator, realmRec, a.TypeRecord);
}
export function rationalSub(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject | ThrowCompletion {
  return CreateRationalValue(a.RationalNumerator * b.RationalDenominator - b.RationalNumerator * a.RationalDenominator, a.RationalDenominator * b.RationalDenominator, realmRec, a.TypeRecord);
}
export function rationalMul(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject | ThrowCompletion {
  return CreateRationalValue(a.RationalNumerator * b.RationalNumerator, a.RationalDenominator * b.RationalDenominator, realmRec, a.TypeRecord);
}
/**
 * `rational::unaryMinus` - #sec-which-operations-each-family-defines lists it for
 * the rational family, and rational.md says "unary `-` negates the numerator".
 * The type record is kept, so a `rational.<N>` stays one. Built through the one
 * constructor, so negating a numerator of -2**(N-1), whose magnitude does not fit
 * `int.<N>`, is the bound's RangeError. A rational has no negative zero, so -0/1
 * is 0/1.
 */
export function rationalNegate(a: RationalObject, realmRec: Realm): RationalObject | ThrowCompletion {
  return CreateRationalValue(-a.RationalNumerator, a.RationalDenominator, realmRec,
    (a as { TypeRecord?: unknown }).TypeRecord);
}
export function rationalDiv(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject | ThrowCompletion | { zero: true } {
  if (b.RationalNumerator === 0n) {
    return { zero: true };
  }
  return CreateRationalValue(a.RationalNumerator * b.RationalDenominator, a.RationalDenominator * b.RationalNumerator, realmRec, a.TypeRecord);
}
export function rationalPow(a: RationalObject, exp: bigint, realmRec: Realm): RationalObject | ThrowCompletion | { zero: true } {
  if (exp >= 0n) {
    return CreateRationalValue(a.RationalNumerator ** exp, a.RationalDenominator ** exp, realmRec, a.TypeRecord);
  }
  if (a.RationalNumerator === 0n) {
    return { zero: true };
  }
  const n = -exp;
  return CreateRationalValue(a.RationalDenominator ** n, a.RationalNumerator ** n, realmRec, a.TypeRecord);
}
// The sign of a - b, by cross-multiplication with positive denominators.
export function rationalCompare(a: RationalObject, b: RationalObject): number {
  const lhs = a.RationalNumerator * b.RationalDenominator;
  const rhs = b.RationalNumerator * a.RationalDenominator;
  if (lhs < rhs) {
    return -1;
  }
  if (lhs > rhs) {
    return 1;
  }
  return 0;
}
/**
 * Whether two rationals are of one width. #sec-rational-types makes each width
 * its own type, and the design has them compare "just as `int32` and `int64`"
 * do - `===`, SameValue and SameValueZero see the type, `==` compares the value.
 * These three compared the value alone, so a `rational.<8>` was `===` a
 * `rational` holding the same number, where `(1 := int32) === (1 := int64)` is
 * false.
 */
export function rationalSameWidth(a: RationalObject, b: RationalObject): boolean {
  return rationalWidthOf(a.TypeRecord) === rationalWidthOf(b.TypeRecord);
}

export function rationalEquals(a: RationalObject, b: RationalObject): boolean {
  return a.RationalNumerator === b.RationalNumerator && a.RationalDenominator === b.RationalDenominator;
}

// An integer argument to the constructor, from a Number holding an integer or a
// typed integer value. A non-integer is not accepted in this core.
function integerArg(v: Value): bigint | null {
  // A typed INTEGER is read exactly. Read through its Number, an `int64` above
  // 2**53 rounds: `rational(x, 1)` for an `int64` x of 2**63 - 1 became 2**63
  // and overflowed `int.<64>`, and 2**53 + 1 became ...992. The one-argument
  // conversion already reads it exactly; the two-argument form now does too.
  if (isTypedNumber(v)) {
    const record = v.TypeRecord as { Kind?: string, Name?: string };
    if (record.Kind === 'primitive' && isIntegerTypeName(record.Name as string)) {
      return v.bigintValue(); // eslint-disable-line @engine262/mathematical-value -- the exact value of a wide integer; R is reachable only through ToNumber, which rounds an int64 above 2**53
    }
  }
  let n: number | undefined;
  // NumberValue and TypedNumberValue expose numberValue(); R would assert on a
  // TypedNumberValue, so this mirrors the typed-arithmetic module's access.
  if (v instanceof NumberValue) {
    n = v.numberValue(); // eslint-disable-line @engine262/mathematical-value
  } else if (isTypedNumber(v)) {
    n = v.numberValue(); // eslint-disable-line @engine262/mathematical-value
  }
  if (n !== undefined && Number.isInteger(n)) {
    return BigInt(n);
  }
  return null;
}

/**
 * The exact value of a numeric source as a fraction in lowest terms, or *null*
 * where the source is not one this conversion reaches.
 *
 * #table-numeric-conversions, `binary float or the Number type` to `rational`:
 * "The source's exact value, which is a dyadic rational, in lowest terms." A
 * double IS a dyadic rational - it is a mathematical value of the form
 * _m_ x 2**_e_ - so the conversion is exact and loses nothing, which is why the
 * row admits it where the reverse direction rounds.
 *
 * decimal.md gives the decimal source the same treatment: "a terminating
 * decimal is exactly a rational with a power-of-ten denominator, so
 * `rational(d)` is exact - `0.1` becomes `1/10`".
 *
 * Both are read through their DECIMAL expansion, significand over a power of
 * ten, and then reduced: a double's expansion terminates, so reducing a
 * power-of-ten denominator against it leaves the power of two the dyadic form
 * has. Going through the digits rather than the bits means one routine serves
 * both sources.
 */
function exactFractionOf(v: Value): { num: bigint, den: bigint } | null {
  // A float128 is exactly significand x 2**exponent; NaN and the infinities are
  // not rationals.
  if (isFloat128Object(v)) {
    if (v.Float128Class !== 'finite') return null;
    return v.Float128Exponent >= 0
      ? { num: v.Float128Significand << BigInt(v.Float128Exponent), den: 1n }
      : { num: v.Float128Significand, den: 1n << BigInt(-v.Float128Exponent) };
  }
  let significand: bigint;
  let exponent: number;
  if (isDecimalObject(v)) {
    significand = (v as { DecimalSignificand: bigint }).DecimalSignificand;
    exponent = (v as { DecimalExponent: number }).DecimalExponent;
  } else {
    let n: number | undefined;
    if (v instanceof NumberValue) {
      n = v.numberValue(); // eslint-disable-line @engine262/mathematical-value -- the exact double is wanted, not its mathematical normalization
    } else if (isTypedNumber(v)) {
      n = v.numberValue(); // eslint-disable-line @engine262/mathematical-value -- as above
    }
    if (n === undefined || !Number.isFinite(n)) {
      return null;
    }
    const digits = exactExpansionOfDouble(n);
    if (!digits) {
      return null;
    }
    significand = digits.significand;
    exponent = digits.exponent;
  }
  let num = exponent >= 0 ? significand * (10n ** BigInt(exponent)) : significand;
  let den = exponent >= 0 ? 1n : 10n ** BigInt(-exponent);
  const gcd = (x: bigint, y: bigint): bigint => (y === 0n ? (x < 0n ? -x : x) : gcd(y, x % y));
  const g = gcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  return { num, den };
}

/**
 * The single-argument conversion to `rational`, and the ONLY one.
 *
 * #sec-conversions: an explicit conversion "is written as a call on the type,
 * `uint8(v)`, or with the conversion operator after the value, `v := uint8`. The
 * two are the same operation." They were three: this call form, a `:=` path that
 * reached no `rational` case at all, and a checked copy at the boundary that
 * threw a TypeError for NaN and handled only a plain Number. So `rational(NaN)`
 * was a RangeError while `NaN := rational` was a TypeError, and a `float32` or a
 * `decimal` converted by one spelling and not the other. Every path now calls
 * this, so they cannot disagree on a value that reaches the conversion.
 *
 * They can still disagree on a CONSTANT, which the checker folds before any
 * conversion runs - and folds differently for each spelling: `rational(1 / 10)`
 * is folded to exactly `1/10` while `rational(0.1)` is not, and `0.1 := rational`
 * is folded while `(1 / 10) := rational` is not. That is static typing of the
 * operand, not this conversion, and is recorded separately.
 *
 * - a `rational` is itself;
 * - an integer is its value over 1 - EXACTLY, for a wide one too (below);
 * - a finite Number, typed float or `decimal` is its exact value in lowest
 *   terms, per #table-numeric-conversions;
 * - NaN and the infinities are a RangeError. #sec-rational-types: "A rational
 *   type has no negative zero, no infinity, and no NaN", and a value it cannot
 *   represent is "an error, not an approximation". Neither has an exact value to
 *   be the fraction of, so this is a question of RANGE rather than of kind -
 *   #sec-requiretype's rule for a numeric value at a numeric type;
 * - anything else is a TypeError.
 *
 * The 64-bit bound of `rational.<64>` is not enforced here, as it is not
 * anywhere yet; adding it belongs in this one place.
 */
export function ToRational(a: Value, realmRec: Realm, typeRecord?: unknown): RationalObject | ThrowCompletion {
  // A rational of this width is the value; one of another width converts to
  // this one exactly, or is a RangeError - #sec-rational-types refuses rather
  // than rounds, and the design has the widths meet "with an explicit cast".
  // This returned any rational as it stood, so `r8 := rational.<32>` kept its
  // width and failed its own target.
  if (isRationalObject(a)) {
    if (rationalWidthOf(a.TypeRecord) === rationalWidthOf(typeRecord)) {
      return a;
    }
    return CreateRationalValue(a.RationalNumerator, a.RationalDenominator, realmRec, typeRecord);
  }
  // A typed INTEGER is read exactly. Through a Number (`integerArg`) an `int64`
  // above 2**53 rounds, which would contradict the integer row's "the source's
  // value" - and `:=` now reaches this, where before it refused integers.
  if (isTypedNumber(a)) {
    const record = a.TypeRecord as { Kind?: string, Name?: string };
    if (record.Kind === 'primitive' && isIntegerTypeName(record.Name as string)) {
      return CreateRationalValue(a.bigintValue(), 1n, realmRec, typeRecord); // eslint-disable-line @engine262/mathematical-value -- the exact value of a wide integer; R is reachable only through ToNumber, which rounds an int64 above 2**53
    }
  }
  if (a instanceof NumberValue) {
    const integer = integerArg(a);
    if (integer !== null) {
      return CreateRationalValue(integer, 1n, realmRec, typeRecord);
    }
  }
  const fraction = exactFractionOf(a);
  if (fraction !== null) {
    return CreateRationalValue(fraction.num, fraction.den, realmRec, typeRecord);
  }
  if ((a instanceof NumberValue || isTypedNumber(a))
    && !Number.isFinite(a.numberValue())) { // eslint-disable-line @engine262/mathematical-value -- finiteness of the stored Number is the question
    return Throw.RangeError('$1 is not in the range of $2', a, Value('rational'));
  }
  // A `bigint` is the source's value over 1, a RangeError where it does not fit -
  // the integer row's own terms. The table had no row from `bigint`, though
  // `rational -> bigint` exists, and the way round it, `x := int64`, WRAPS.
  if (a instanceof BigIntValue) {
    return CreateRationalValue(a.bigintValue(), 1n, realmRec, typeRecord); // eslint-disable-line @engine262/mathematical-value -- the exact value of an unbounded integer
  }
  return Throw.TypeError('$1 is not assignable to $2', a, Value(rationalDisplay(typeRecord)));
}

function* RationalConstructor(args: Arguments, _ctx: FunctionCallContext): ValueEvaluator {
  return yield* RationalConstructAt(args, undefined);
}

/**
 * The constructor at a width - `rational(...)` at 64, and a `rational.<N>` Type
 * Object's call at N: one argument converts, two are the `int.<N>` parts.
 */
export function* RationalConstructAt([a = Value.undefined, b]: Arguments, typeRecord: unknown): ValueEvaluator {
  const realmRec = surroundingAgent.currentRealmRecord;
  // ONE numeric argument is the CONVERSION of #table-numeric-conversions, not
  // the numerator of the two-argument constructor. The arms are told apart by
  // argument count, so neither has to guess at the other's intent.
  //
  // `rational(0.5)` was refused with "a rational numerator must be an integer",
  // which is the two-argument form's rule answering a call that never named a
  // numerator - while `rational(5)` worked, so one spelling gave two verdicts
  // by whether the source happened to be integral.
  // A RATIONAL SOURCE is the identity, as every other numeric conversion is on
  // its own type: `uint8(x)` for a `uint8` and `float64(f)` for a `float64` both
  // answer the value. `rational(r)` alone raised "a rational numerator must be
  // an integer" - the two-argument form's rule answering a call that named no
  // numerator, the same shape as the `rational(0.5)` defect below.
  //
  // It matters beyond symmetry. A constant expression at a rational contextual
  // type folds to a rational (`foldRationalConstant`), so `rational(1 / 3)` and
  // `rational(-1)` hand this a rational and were refused for it.
  // One argument: the conversion, shared with `:=` and the boundary.
  if (b === undefined) {
    return ToRational(a, realmRec, typeRecord);
  }
  // A BigInt IS an integer, so "must be an integer" misstated why it is
  // refused. It is refused because the parts are `int.<N>`, and rational.md
  // has "a value of another integer type ... converted explicitly" - so it is
  // named as not assignable to `int.<64>`, the wording the one-argument form
  // uses for `rational(5n)`. A non-integral Number keeps the integer message.
  const num = integerArg(a);
  if (num === null) {
    if (a instanceof BigIntValue) {
      return Throw.TypeError('$1 is not assignable to $2', a, Value(`int.<${rationalWidthOf(typeRecord)}>`));
    }
    return Throw.TypeError('a rational numerator must be an integer');
  }
  let den = 1n;
  if (b !== undefined) {
    const d = integerArg(b);
    if (d === null) {
      if (b instanceof BigIntValue) {
        return Throw.TypeError('$1 is not assignable to $2', b, Value(`int.<${rationalWidthOf(typeRecord)}>`));
      }
      return Throw.TypeError('a rational denominator must be an integer');
    }
    den = d;
  }
  if (den === 0n) {
    return Throw.RangeError('a rational cannot have a zero denominator');
  }
  return CreateRationalValue(num, den, realmRec, typeRecord);
}

function thisRational(thisValue: Value): RationalObject | undefined {
  return isRationalObject(thisValue) ? thisValue : undefined;
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-types */
function* RationalProto_numerator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRational(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  // The `int.<N>` field itself, exactly - rational.md: "`.numerator` and
  // `.denominator` return the `int.<N>` fields." This returned a Number, so a
  // field above 2**53 read back rounded: a numerator of 2**53+1 was ...992. The
  // bound guarantees the field fits `int.<N>`, and `Math.floor` already returns
  // an `int.<N>` this way.
  const fieldType = { Kind: 'primitive', Name: 'int', Arguments: [rationalWidthOf((self as { TypeRecord?: unknown }).TypeRecord)] };
  return new TypedNumberValue(self.RationalNumerator, fieldType as never);
}
/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-types */
function* RationalProto_denominator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRational(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  // The `int.<N>` field itself, exactly - rational.md: "`.numerator` and
  // `.denominator` return the `int.<N>` fields." This returned a Number, so a
  // field above 2**53 read back rounded: a numerator of 2**53+1 was ...992. The
  // bound guarantees the field fits `int.<N>`, and `Math.floor` already returns
  // an `int.<N>` this way.
  const fieldType = { Kind: 'primitive', Name: 'int', Arguments: [rationalWidthOf((self as { TypeRecord?: unknown }).TypeRecord)] };
  return new TypedNumberValue(self.RationalDenominator, fieldType as never);
}
/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-types */
function* RationalProto_reciprocal(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRational(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  if (self.RationalNumerator === 0n) {
    return Throw.RangeError('the reciprocal of zero is undefined');
  }
  return CreateRationalValue(self.RationalDenominator, self.RationalNumerator, surroundingAgent.currentRealmRecord, self.TypeRecord);
}
/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-types */
function* RationalProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRational(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  const s = self.RationalDenominator === 1n
    ? `${self.RationalNumerator}`
    : `${self.RationalNumerator}/${self.RationalDenominator}`;
  return Value(s);
}

export function bootstrapRationalPrototype(realmRec: Realm): void {
/**
 * A rational has no Number to be, so coercing one is refused rather than
 * answered.
 *
 * #sec-numeric-types states Math over a rational exactly - "For a rational type
 * the result is exact, and a fixed-width result whose lowest-terms numerator or
 * denominator does not fit its int.<N> throws a RangeError exception" - and
 * none of that is implemented. Without a valueOf, the ordinary coercion found
 * Object.prototype.valueOf, returned the object, and ToNumber made it *NaN*:
 * Math.abs(rational(-1, 2)) was NaN, as were Math.max and Math.sign of a
 * rational. A silent NaN is the one answer that is neither right nor honest.
 *
 * A decimal already refuses here for the same reason, in the same shape, and
 * this keeps the two families telling the same story until the arithmetic of
 * either is defined.
 */
function* RationalProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isRationalObject(thisValue)) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  return Throw.TypeError('a rational has no Number value; this operation is not defined for rationals');
}

  const proto = bootstrapPrototype(realmRec, [
    ['numerator', [RationalProto_numerator]],
    ['denominator', [RationalProto_denominator]],
    ['reciprocal', RationalProto_reciprocal, 0],
    ['toString', RationalProto_toString, 0],
    ['valueOf', RationalProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'rational');
  realmRec.Intrinsics['%rational.prototype%'] = proto;
}

/**
 * A rational's written form: a numerator, a solidus and a denominator, or a
 * bare integer standing for a denominator of one.
 *
 * #sec-parsing requires it - "for the binary floating-point, decimal, RATIONAL,
 * and complex types it is `parse(_string_)`" - and #sec-rational-types defines
 * no literal, so the accepted input is the form the type WRITES:
 * `String(rational(1, 2))` is `1/2`, and this reads it back. Where a type has
 * no literal, its own written form is the only available reading of "the
 * grammar of a literal of that type", and it is what every rational library
 * accepts.
 *
 * Separators are accepted and a sign may lead, as the clause requires of every
 * `parse`. A sign on the DENOMINATOR is refused: the type holds a denominator
 * greater than zero, so `1/-2` names no value of it, and normalizing is the
 * constructor's job rather than a text reader's.
 */
export function ParseRationalLiteral(source: string): { numerator: bigint, denominator: bigint } | null {
  const text = source.trim();
  if (/^_|_$|__|_\/|\/_|[+-]_/.test(text)) {
    return null;
  }
  const bare = /^([+-]?\d[\d_]*)$/.exec(text);
  if (bare) {
    return { numerator: BigInt(bare[1]!.replace(/_/g, '')), denominator: 1n };
  }
  const quotient = /^([+-]?\d[\d_]*)\/(\d[\d_]*)$/.exec(text);
  if (!quotient) {
    return null;
  }
  const denominator = BigInt(quotient[2]!.replace(/_/g, ''));
  if (denominator === 0n) {
    return null;
  }
  return { numerator: BigInt(quotient[1]!.replace(/_/g, '')), denominator };
}

/**
 * `parse` and `tryParse` sit on the CONSTRUCTOR rather than on a type object.
 *
 * `rational` is bound as a constructor because the clause writes it that way -
 * `complex(re, im)` is its own example - and a constructor is not a type
 * object, so the `parse` that every other numeric type inherits from
 * `%Type.prototype%` never reached this family: `rational.parse` was not a
 * function at all, where `uint8.parse`, `float64.parse`, `decimal64.parse` and
 * `complex64.parse` all are. Defining them here puts the function where
 * #sec-parsing says it is, without disturbing the two-argument form the clause
 * depends on.
 */
function* RationalParse([S = Value.undefined]: Arguments): ValueEvaluator {
  if (!(S instanceof JSStringValue)) {
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  const parsed = ParseRationalLiteral(S.stringValue());
  if (!parsed) {
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  return CreateRationalValue(parsed.numerator, parsed.denominator, surroundingAgent.currentRealmRecord);
}

/** *null* where `parse` would fail to parse, as #sec-parsing gives it. */
function* RationalTryParse([S = Value.undefined]: Arguments): ValueEvaluator {
  if (!(S instanceof JSStringValue) || !ParseRationalLiteral(S.stringValue())) {
    return Value.null;
  }
  const parsed = ParseRationalLiteral(S.stringValue())!;
  return CreateRationalValue(parsed.numerator, parsed.denominator, surroundingAgent.currentRealmRecord);
}

function* RationalApproximate(args: Arguments): ValueEvaluator {
  return yield* RationalApproximateAt(args, undefined);
}

/** A double's exact value, a dyadic rational: numerator over a power of two. */
function exactOfDouble(v: number): { n: bigint, d: bigint } {
  if (v === 0) {
    return { n: 0n, d: 1n };
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  const bits = view.getBigUint64(0);
  const sign = (bits >> 63n) === 1n ? -1n : 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const m = biased === 0 ? fraction : fraction | (1n << 52n);
  const e = (biased === 0 ? 1 : biased) - 1075;
  return e >= 0 ? { n: sign * (m << BigInt(e)), d: 1n } : { n: sign * m, d: 1n << BigInt(-e) };
}

/**
 * The closest value of the type to x whose denominator does not exceed `bound` -
 * the design's `approximate`, at a width (the F10 plan's A1). A value of
 * `rational.<N>` has BOTH parts in `int.<N>`, so the continued-fraction search is
 * bounded twice: the denominator by the bound and the type's maximum, the
 * numerator by the type's range. Its last convergent within both bounds and the
 * best semiconvergent short of them are the two candidates; the nearer wins, and
 * of two equally near, the smaller denominator, then the one nearer zero. An x outside the type's range is overflow, not
 * approximation, and is refused: saturating would answer 127 for 1000 at width 8.
 */
function approximateInWidth(x: number, bound: bigint, typeRecord: unknown): { num: bigint, den: bigint } | 'range' {
  const width = BigInt(rationalWidthOf(typeRecord));
  const max = (1n << (width - 1n)) - 1n;
  const { n: xn, d: xd } = exactOfDouble(x);
  if (xn > max * xd || xn < (-max - 1n) * xd) {
    return 'range';
  }
  const negative = xn < 0n;
  const an = negative ? -xn : xn;
  const denominatorBound = bound < max ? bound : max;
  const numeratorBound = negative ? max + 1n : max;
  let [p0, q0, p1, q1] = [0n, 1n, 1n, 0n];
  let [n, d] = [an, xd];
  while (d !== 0n) {
    const a = n / d;
    const p2 = p0 + a * p1;
    const q2 = q0 + a * q1;
    if (q2 > denominatorBound || p2 > numeratorBound) {
      break;
    }
    [p0, q0, p1, q1] = [p1, q1, p2, q2];
    [n, d] = [d, n - a * d];
  }
  let p = p1;
  let q = q1;
  if (d !== 0n) {
    const kq = (denominatorBound - q0) / q1;
    const kp = p1 === 0n ? kq : (numeratorBound - p0) / p1;
    const k = kq < kp ? kq : kp;
    const sp = p0 + k * p1;
    const sq = q0 + k * q1;
    // |p1/q1 - x| against |sp/sq - x|, cross-multiplied. The nearer wins; of two
    // equally near, the smaller denominator, then the one nearer zero - a rule
    // stated by the values alone, so it does not depend on this algorithm.
    const abs = (v: bigint) => (v < 0n ? -v : v);
    if (sq !== 0n) {
      const semi = abs(sp * xd - an * sq) * q1;
      const conv = abs(p1 * xd - an * q1) * sq;
      if (semi < conv || (semi === conv && (sq < q1 || (sq === q1 && sp < p1)))) {
        p = sp;
        q = sq;
      }
    }
  }
  return { num: negative ? -p : p, den: q };
}

/** `approximate` at a type: the bare constructor's at 64, a `rational.<N>` Type Object's at N. */
export function* RationalApproximateAt([x = Value.undefined, bound = Value.undefined]: Arguments, typeRecord: unknown): ValueEvaluator {
  const realmRec = surroundingAgent.currentRealmRecord;
  if (Number.isNaN(rationalWidthOf(typeRecord))) {
    return refuseRationalWidth(typeRecord);
  }
  const n = Q(yield* ToNumber(x));
  const value = n.numberValue(); // eslint-disable-line @engine262/mathematical-value -- the source is a Number and its stored payload is what is approximated
  if (!Number.isFinite(value)) {
    return Throw.RangeError('$1 is not in the range of $2', x, Value(rationalDisplay(typeRecord)));
  }
  const b = Q(yield* ToNumber(bound));
  const limit = b.numberValue(); // eslint-disable-line @engine262/mathematical-value -- a denominator bound is a count
  if (!Number.isFinite(limit) || limit < 1) {
    return Throw.RangeError('$1 is not in the range of $2', bound, Value('a denominator bound'));
  }
  const approximation = approximateInWidth(value, BigInt(Math.floor(limit)), typeRecord);
  if (approximation === 'range') {
    return Throw.RangeError('$1 is not in the range of $2', x, Value(rationalDisplay(typeRecord)));
  }
  return CreateRationalValue(approximation.num, approximation.den, realmRec, typeRecord);
}

export function bootstrapRational(realmRec: Realm): void {
  const proto = realmRec.Intrinsics['%rational.prototype%'];
  const cons = CreateBuiltinFunction(RationalConstructor, 2, Value('rational'), [], realmRec);
  X(cons.DefineOwnProperty(Value('prototype'), Descriptor({
    Value: proto,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  for (const [name, fn] of [['parse', RationalParse], ['tryParse', RationalTryParse], ['approximate', RationalApproximate]] as const) {
    X(cons.DefineOwnProperty(Value(name), Descriptor({
      Value: CreateBuiltinFunction(fn, 1, Value(name), [], realmRec),
      Writable: Value.true,
      Enumerable: Value.false,
      Configurable: Value.true,
    })));
  }
  realmRec.Intrinsics['%rational%'] = cons;
}
