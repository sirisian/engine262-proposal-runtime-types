import {
  BigIntValue, NumberValue, ObjectValue, isTypedNumber, type Value,
} from '../value.mts';
import type { TypeRecord } from './records.mts';

/**
 * proposal-runtime-types (spec, the numeric predicates): `isFinite`, `isNaN`,
 * and the `Number` statics that ask the same questions are overloaded for the
 * numeric types, each overload taking one value of a numeric type and returning
 * a boolean.
 *
 * The point of the clause is that these are tests of the VALUE, never of a
 * representation. Two hazards follow from that and both are what this module
 * exists to remove. The `Number` statics do not coerce, so before this every one
 * of them answered false for every typed value: `Number.isInteger` of an int32
 * was false, and `Number.isNaN` of a float32 NaN was false, each predicate
 * quietly reporting on the representation where its name promises a value test.
 * The global pair reached the right answer for the integer and float families,
 * but only because ToNumber unwraps a typed number on the way past, which is an
 * accident of the coercion rather than a rule, and it gave no answer at all for
 * the families ToNumber cannot unwrap.
 *
 * The integer and rational columns are constants, and that is their point: a
 * sized integer is a type whose `isFinite` has one answer, and a predicate that
 * says so at the type is what lets a reader delete the check.
 */

/** The four questions of <emu-xref href="#table-numeric-predicates">. */
export type NumericPredicate = 'isNaN' | 'isFinite' | 'isInteger' | 'isSafeInteger';

const MAX_SAFE = (2 ** 53) - 1;
const MAX_SAFE_BIGINT = BigInt(MAX_SAFE);

function isIntegerTypeName(name: string): boolean {
  return name === 'int' || name === 'uint';
}

function isFloatTypeName(name: string): boolean {
  return name === 'float16' || name === 'float32' || name === 'float64';
}

/**
 * A rational is held as an ordinary object carrying an exact numerator and
 * denominator. The structural test is written out here rather than imported from
 * the Rational intrinsic so that the type system does not depend on an intrinsic
 * module; it is the same test that intrinsic's own guard makes.
 */
function asRational(value: Value): { numerator: bigint, denominator: bigint } | undefined {
  if (value instanceof ObjectValue && 'RationalNumerator' in value) {
    const o = value as ObjectValue & { RationalNumerator: bigint, RationalDenominator: bigint };
    return { numerator: o.RationalNumerator, denominator: o.RationalDenominator };
  }
  return undefined;
}

function bigIntMagnitude(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/**
 * Answer a numeric predicate for a value that carries a numeric type, or return
 * *undefined* when the value belongs to no numeric family, in which case the
 * caller keeps the behaviour it has today. A plain Number is deliberately in the
 * second group: the existing signatures over the Number type are unchanged, and
 * an untyped call must go on meaning what it means.
 */
export function numericPredicate(value: Value, which: NumericPredicate): boolean | undefined {
  if (isTypedNumber(value)) {
    const t = value.TypeRecord as TypeRecord;
    if (t.Kind !== 'primitive') {
      return undefined;
    }
    const n = value.value;
    if (isIntegerTypeName(t.Name)) {
      // An integer type has no NaN and no infinity, so the first three questions
      // have one answer at the type. Only safety asks about the value, and it
      // asks about the mathematical value: an int64 holding 2**60 is not a safe
      // integer because the value is out of range, not because a payload lost
      // precision on the way.
      switch (which) {
        case 'isNaN': return false;
        case 'isFinite': return true;
        case 'isInteger': return true;
        case 'isSafeInteger': return Number.isFinite(n) && Math.abs(n) <= MAX_SAFE;
        default: return undefined;
      }
    }
    if (isFloatTypeName(t.Name)) {
      // A float type has both, so every question is a question about the value.
      switch (which) {
        case 'isNaN': return Number.isNaN(n);
        case 'isFinite': return Number.isFinite(n);
        case 'isInteger': return Number.isInteger(n);
        case 'isSafeInteger': return Number.isSafeInteger(n);
        default: return undefined;
      }
    }
    return undefined;
  }
  if (value instanceof BigIntValue) {
    // A BigInt is a value of the `bigint` type, which is exact and unbounded.
    const v = value.value;
    switch (which) {
      case 'isNaN': return false;
      case 'isFinite': return true;
      case 'isInteger': return true;
      case 'isSafeInteger': return bigIntMagnitude(v) <= MAX_SAFE_BIGINT;
      default: return undefined;
    }
  }
  const rational = asRational(value);
  if (rational !== undefined) {
    // A rational is an exact fraction, so it is never NaN and never infinite; it
    // is an integer exactly when it has been reduced to a unit denominator.
    const isWhole = rational.denominator === 1n;
    switch (which) {
      case 'isNaN': return false;
      case 'isFinite': return true;
      case 'isInteger': return isWhole;
      case 'isSafeInteger': return isWhole && bigIntMagnitude(rational.numerator) <= MAX_SAFE_BIGINT;
      default: return undefined;
    }
  }
  if (value instanceof NumberValue) {
    // The Number signatures are unchanged; the caller answers.
    return undefined;
  }
  return undefined;
}
