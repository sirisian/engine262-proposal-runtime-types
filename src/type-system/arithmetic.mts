import { NumberValue, TypedNumberValue, type Value, BigIntValue } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { SameType } from './relations.mts';

/**
 * proposal-runtime-types R3 #sec-numeric-types: arithmetic over numeric value
 * types. Each operation computes in the mathematical (JavaScript-number) domain
 * and then applies the target type's wrap/round rule, returning a value of that
 * type. This mirrors the specification's per-type operator methods
 * (T::add, T::multiply, and the rest) and its conversion rule: "the
 * mathematical value of the source modulo 2**M, interpreted as a value of the
 * target; signed targets wrap in two's complement; float targets round to
 * nearest, ties to even".
 */

function widthOf(t: TypeRecord): number | null {
  if (t.Kind !== 'primitive') {
    return null;
  }
  if (t.Name === 'uint' || t.Name === 'int') {
    return typeof t.Arguments[0] === 'number' ? t.Arguments[0] : null;
  }
  return null;
}

/** Applies the target numeric type's representation rule to a mathematical value. */
export function wrapToType(math: number, t: TypeRecord): number {
  if (t.Kind !== 'primitive') {
    return math;
  }
  if (t.Name === 'float16' || t.Name === 'float32') {
    // Round to the nearest representable float of the width. float32 uses the
    // engine's Math.fround; float16 falls back to float32 rounding, which is a
    // superset (exact for all float16 values) until a dedicated rounder lands.
    return t.Name === 'float32' ? Math.fround(math) : Math.fround(math);
  }
  if (t.Name === 'float64' || t.Name === 'number') {
    return math;
  }
  const bits = widthOf(t);
  if (bits === null || bits <= 0) {
    return math;
  }
  // Integer target: take the mathematical value modulo 2**bits. For a
  // non-finite or non-integer source, truncate toward zero first (the
  // float-to-integer rule); arithmetic here is already integer-domain.
  if (!Number.isFinite(math)) {
    return 0;
  }
  const modulus = 2 ** bits;
  // Truncate toward zero, then reduce modulo 2**bits into [0, modulus).
  let reduced = Math.trunc(math) % modulus;
  if (reduced < 0) {
    reduced += modulus;
  }
  if (t.Name === 'int') {
    // Signed: values at or above 2**(bits-1) wrap to their two's-complement
    // negative counterpart.
    const half = 2 ** (bits - 1);
    if (reduced >= half) {
      reduced -= modulus;
    }
  }
  return reduced;
}

/** The Type Record a binary operation on two numeric-typed operands produces. */
export function resultType(a: TypeRecord, b: TypeRecord): TypeRecord {
  // Same type: that type. This is the common and unambiguous case; mixed-type
  // arithmetic requires an explicit conversion under the proposal, so a
  // mismatch keeps the left operand's type as the result and the caller may
  // have already rejected the mix.
  return SameType(a, b) ? a : a;
}

type BinOp = '+' | '-' | '*' | '/' | '%' | '**' | '<<' | '>>' | '>>>' | '&' | '^' | '|';

function mathOp(op: BinOp, x: number, y: number): number {
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': return x / y;
    case '%': return x % y;
    case '**': return x ** y;
    case '<<': return x << y;
    case '>>': return x >> y;
    case '>>>': return x >>> y;
    case '&': return x & y;
    case '^': return x ^ y;
    case '|': return x | y;
    default: return NaN;
  }
}

function payload(v: Value): number {
  // proposal-runtime-types R6: read the numeric payload directly. Both
  // NumberValue and TypedNumberValue expose numberValue(); R would assert
  // instanceof NumberValue, which a typed number no longer satisfies.
  return (v as NumberValue | TypedNumberValue).numberValue(); // eslint-disable-line @engine262/mathematical-value
}

/** True when at least one operand is a typed number. */
/**
 * True when the operation is typed-number arithmetic: at least one operand is a
 * typed number and neither is a BigInt. A typed number mixed with a BigInt is
 * not typed arithmetic; it falls through to the standard numeric path, which
 * raises the same "cannot mix BigInt" TypeError as Number + BigInt.
 */
export function isTypedArithmetic(x: Value, y: Value): boolean {
  if (x instanceof BigIntValue || y instanceof BigIntValue) {
    return false;
  }
  return x instanceof TypedNumberValue || y instanceof TypedNumberValue;
}

/**
 * Computes a binary numeric operation where at least one operand is typed.
 * The result type is the typed operand's type (or the shared type when both are
 * typed); the mathematical result is wrapped into that type.
 */
export function typedBinary(op: BinOp, x: Value, y: Value): TypedNumberValue {
  const xt = x instanceof TypedNumberValue ? ((x as TypedNumberValue).TypeRecord as TypeRecord) : null;
  const yt = y instanceof TypedNumberValue ? ((y as TypedNumberValue).TypeRecord as TypeRecord) : null;
  const target = xt && yt ? resultType(xt, yt) : (xt ?? yt)!;
  const math = mathOp(op, payload(x), payload(y));
  return new TypedNumberValue(wrapToType(math, target), target);
}

/** Unary minus and bitwise NOT over a typed number. */
export function typedUnary(op: '-' | '~', x: TypedNumberValue): TypedNumberValue {
  const t = x.TypeRecord as TypeRecord;
  const math = op === '-' ? -payload(x) : ~payload(x);
  return new TypedNumberValue(wrapToType(math, t), t);
}
