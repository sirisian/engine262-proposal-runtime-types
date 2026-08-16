import {
  Value, ObjectValue, NumberValue, isTypedNumber,
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

function* RationalConstructor([a = Value.undefined, b]: Arguments, _ctx: FunctionCallContext): ValueEvaluator {
  const realmRec = surroundingAgent.currentRealmRecord;
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

/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-type */
function* RationalProto_numerator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRational(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  return F(Number(self.RationalNumerator));
}
/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-type */
function* RationalProto_denominator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRational(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a rational', thisValue);
  }
  return F(Number(self.RationalDenominator));
}
/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-type */
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
/** https://sirisian.github.io/proposal-runtime-types/#sec-rational-type */
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
  const proto = bootstrapPrototype(realmRec, [
    ['numerator', [RationalProto_numerator]],
    ['denominator', [RationalProto_denominator]],
    ['reciprocal', RationalProto_reciprocal, 0],
    ['toString', RationalProto_toString, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'rational');
  realmRec.Intrinsics['%rational.prototype%'] = proto;
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
  realmRec.Intrinsics['%rational%'] = cons;
}
