import {
  Value, ObjectValue, NumberValue, isTypedNumber,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { JSStringValue } from '../value.mts';
import { type Mutable } from '../utils/language.mts';
import { makePrimitive } from '../type-system/records.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { isDecimalObject, exactExpansionOfDouble } from './Decimal.mts';
import { surroundingAgent, Throw } from '#self';
import {
  OrdinaryObjectCreate,
  CreateBuiltinFunction,
  Descriptor,
  F, X,
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

export function CreateRationalValue(numerator: bigint, denominator: bigint, realmRec: Realm): RationalObject {
  const { num, den } = canonicalize(numerator, denominator);
  const proto = realmRec.Intrinsics['%rational.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['RationalNumerator', 'RationalDenominator']) as Mutable<RationalObject>;
  obj.RationalNumerator = num;
  obj.RationalDenominator = den;
  // A decimal object carries its Type Record so `CarriedTypeRecordOf` can answer
  // for it, which is how a decimal VALUE satisfies a `decimal64` annotation. A
  // rational carried none, so once `rational` became a primitive type the value
  // and the type no longer matched and every binding refused its own literal.
  (obj as Mutable<RationalObject> & { TypeRecord?: unknown }).TypeRecord = makePrimitive('rational', []);
  return obj;
}

// Exact arithmetic over canonical rationals. Each returns a fresh canonical value.
export function rationalAdd(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject {
  return CreateRationalValue(a.RationalNumerator * b.RationalDenominator + b.RationalNumerator * a.RationalDenominator, a.RationalDenominator * b.RationalDenominator, realmRec);
}
export function rationalSub(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject {
  return CreateRationalValue(a.RationalNumerator * b.RationalDenominator - b.RationalNumerator * a.RationalDenominator, a.RationalDenominator * b.RationalDenominator, realmRec);
}
export function rationalMul(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject {
  return CreateRationalValue(a.RationalNumerator * b.RationalNumerator, a.RationalDenominator * b.RationalDenominator, realmRec);
}
export function rationalDiv(a: RationalObject, b: RationalObject, realmRec: Realm): RationalObject | { zero: true } {
  if (b.RationalNumerator === 0n) {
    return { zero: true };
  }
  return CreateRationalValue(a.RationalNumerator * b.RationalDenominator, a.RationalDenominator * b.RationalNumerator, realmRec);
}
export function rationalPow(a: RationalObject, exp: bigint, realmRec: Realm): RationalObject | { zero: true } {
  if (exp >= 0n) {
    return CreateRationalValue(a.RationalNumerator ** exp, a.RationalDenominator ** exp, realmRec);
  }
  if (a.RationalNumerator === 0n) {
    return { zero: true };
  }
  const n = -exp;
  return CreateRationalValue(a.RationalDenominator ** n, a.RationalNumerator ** n, realmRec);
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
export function rationalEquals(a: RationalObject, b: RationalObject): boolean {
  return a.RationalNumerator === b.RationalNumerator && a.RationalDenominator === b.RationalDenominator;
}

// An integer argument to the constructor, from a Number holding an integer or a
// typed integer value. A non-integer is not accepted in this core.
function integerArg(v: Value): bigint | null {
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

function* RationalConstructor([a = Value.undefined, b]: Arguments, _ctx: FunctionCallContext): ValueEvaluator {
  const realmRec = surroundingAgent.currentRealmRecord;
  // ONE numeric argument is the CONVERSION of #table-numeric-conversions, not
  // the numerator of the two-argument constructor. The arms are told apart by
  // argument count, so neither has to guess at the other's intent.
  //
  // `rational(0.5)` was refused with "a rational numerator must be an integer",
  // which is the two-argument form's rule answering a call that never named a
  // numerator - while `rational(5)` worked, so one spelling gave two verdicts
  // by whether the source happened to be integral.
  if (b === undefined && integerArg(a) === null) {
    const fraction = exactFractionOf(a);
    if (fraction !== null) {
      return CreateRationalValue(fraction.num, fraction.den, realmRec);
    }
    // The row's own failure: "A *RangeError* ... if the source is NaN or an
    // infinity." Neither has an exact value to be the fraction of, so this is a
    // question of range rather than of kind, and the message says which.
    if ((a instanceof NumberValue || isTypedNumber(a))
      && !Number.isFinite(a.numberValue())) { // eslint-disable-line @engine262/mathematical-value -- finiteness of the stored Number is the question
      return Throw.RangeError('$1 is not in the range of $2', a, Value('rational'));
    }
  }
  const num = integerArg(a);
  if (num === null) {
    return Throw.TypeError('a rational numerator must be an integer');
  }
  let den = 1n;
  if (b !== undefined) {
    const d = integerArg(b);
    if (d === null) {
      return Throw.TypeError('a rational denominator must be an integer');
    }
    den = d;
  }
  if (den === 0n) {
    return Throw.RangeError('a rational cannot have a zero denominator');
  }
  return CreateRationalValue(num, den, realmRec);
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
  return F(Number(self.RationalNumerator));
}
/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-types */
function* RationalProto_denominator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRational(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  return F(Number(self.RationalDenominator));
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
  return CreateRationalValue(self.RationalDenominator, self.RationalNumerator, surroundingAgent.currentRealmRecord);
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
function ParseRationalLiteral(source: string): { numerator: bigint, denominator: bigint } | null {
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

export function bootstrapRational(realmRec: Realm): void {
  const proto = realmRec.Intrinsics['%rational.prototype%'];
  const cons = CreateBuiltinFunction(RationalConstructor, 2, Value('rational'), [], realmRec);
  X(cons.DefineOwnProperty(Value('prototype'), Descriptor({
    Value: proto,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  for (const [name, fn] of [['parse', RationalParse], ['tryParse', RationalTryParse]] as const) {
    X(cons.DefineOwnProperty(Value(name), Descriptor({
      Value: CreateBuiltinFunction(fn, 1, Value(name), [], realmRec),
      Writable: Value.true,
      Enumerable: Value.false,
      Configurable: Value.true,
    })));
  }
  realmRec.Intrinsics['%rational%'] = cons;
}
