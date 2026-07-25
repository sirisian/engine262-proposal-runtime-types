import { NumberValue, TypedNumberValue, Value, BigIntValue, ObjectValue } from '../value.mts';
import { decodeFloat16, encodeFloat16 } from '../host-defined/ieee754.mts';
import type { TypeRecord } from './records.mts';
import { SameType } from './relations.mts';
import { displayType } from './records.mts';
import { fitsNumericType } from './runtime.mts';
import { AbruptCompletion, Throw, type ThrowCompletion } from '#self';

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
/**
 * proposal-runtime-types: round to the nearest value the binary16 format holds.
 * float16 previously borrowed float32's rounding, which is a coarser grid, so a
 * float16 kept more precision than its own format allows and a value could differ
 * from the one a binary16 store and load would give. The host's Math.f16round is
 * used where it exists, and the format round trip otherwise, matching how the
 * Math.f16round built-in itself is implemented. NaN, the zeroes, and the
 * infinities are returned as they are, so a signed zero keeps its sign.
 */
function roundToFloat16(math: number): number {
  if (Number.isNaN(math) || math === 0 || !Number.isFinite(math)) {
    return math;
  }
  if ('f16round' in Math) {
    return (Math as unknown as { f16round(x: number): number }).f16round(math);
  }
  return decodeFloat16(encodeFloat16(math));
}

export function wrapToType(math: number, t: TypeRecord): number {
  if (t.Kind !== 'primitive') {
    return math;
  }
  if (t.Name === 'float16' || t.Name === 'float32') {
    // Round to the nearest float the width can represent: float32 through the
    // host's Math.fround, float16 through the rounder below.
    return t.Name === 'float32' ? Math.fround(math) : roundToFloat16(math);
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
  // An integer type has no signed zero, so a negative zero reaching one becomes
  // positive zero rather than carrying a sign the type cannot represent.
  if (reduced === 0) {
    return 0;
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
  // proposal-runtime-types: typed-number arithmetic reads each operand's numeric
  // payload directly, so it only applies when both operands are numeric values.
  // A typed number combined with an Object (a plain object, or a typed-class
  // instance with an operator) must fall through to the standard path, which
  // performs ToPrimitive / class-operator dispatch; taking the typed path here
  // would read a numeric payload the object does not have.
  if (x instanceof ObjectValue || y instanceof ObjectValue) {
    return false;
  }
  return x instanceof TypedNumberValue || y instanceof TypedNumberValue;
}

/**
 * #sec-arithmetic-never-promotes: "Two operands of the same value type produce a
 * result of that type. Two operands of different value types are a type error,
 * since neither is assignable to the other. WHERE ONE OPERAND IS A LITERAL IT
 * TAKES THE TYPE OF THE OTHER, so a literal never forces a conversion." And
 * #sec-operator-dispatch: the TypeError for operands of different numeric types
 * "applies to every numeric type", so `uint8(1) + uint16(1)` throws for exactly
 * the reason `1n + 1` does.
 *
 * The engine promoted instead: it wrapped the other operand into the typed
 * operand's type, so `uint8(1) + uint16(1)` was 2 and `uint8(1) + any(300)` was
 * 45 - a silent conversion across value types at every arithmetic operator,
 * which is the one thing this proposal's arithmetic is most emphatic about
 * (F52). LITERALNESS IS SYNTACTIC, so the operand nodes decide it: the caller
 * passes which side was written as a numeric literal, and a literal adopts the
 * other's type while any other untyped operand is a mix and throws.
 */
export function typedBinary(op: BinOp, x: Value, y: Value, literals?: { left: boolean, right: boolean }): TypedNumberValue | ThrowCompletion {
  const target = TypedOperandType(x, y, literals);
  if (target instanceof AbruptCompletion) {
    return target as ThrowCompletion;
  }
  const math = mathOp(op, payload(x), payload(y));
  return new TypedNumberValue(wrapToType(math, target), target);
}

/**
 * The literal rule alone, for the operators that ADOPT but do not otherwise
 * constrain their operands: equality compares rather than computes, so a
 * literal takes the other operand's type and a mismatch is an ordinary
 * *false* rather than a type error (F65). Returns the operand pair to use, or
 * undefined where neither side needs adopting.
 */
export function AdoptLiteralOperand(x: Value, y: Value, literals: { left: boolean, right: boolean }): { left: Value, right: Value } | undefined {
  const xt = x instanceof TypedNumberValue ? ((x as TypedNumberValue).TypeRecord as TypeRecord) : null;
  const yt = y instanceof TypedNumberValue ? ((y as TypedNumberValue).TypeRecord as TypeRecord) : null;
  if ((xt && yt) || (!xt && !yt)) {
    return undefined;
  }
  const target = (xt ?? yt)!;
  const literalIsRight = !!xt;
  if (literalIsRight ? !literals.right : !literals.left) {
    return undefined;
  }
  const untyped = literalIsRight ? y : x;
  // A BIGINT literal is written `5n` and is a NumericLiteral node like any
  // other, but it is not a Number and must not adopt a Number-family type: a
  // BigInt is a numeric type of its own, so `(5 := uint8) === 5n` stays false
  // rather than becoming a uint8 comparison. Reading its payload as a Number
  // was a host crash rather than a wrong answer, which is how it was found
  // (F74).
  if (!(untyped instanceof NumberValue)) {
    return undefined;
  }
  const literalValue = payload(untyped);
  const prim = target as TypeRecord & { Kind: 'primitive' };
  if (!fitsNumericType(literalValue, prim.Name, prim.Arguments)) {
    // A literal the type cannot represent is simply not equal to any value of
    // it, which is the answer a comparison wants. Adoption declines and the
    // ordinary comparison reports *false*.
    return undefined;
  }
  const adopted = new TypedNumberValue(wrapToType(literalValue, target), target);
  return literalIsRight ? { left: x, right: adopted } : { left: adopted, right: y };
}

/**
 * The operand rule of #sec-arithmetic-never-promotes, shared by every operator
 * the clause names: "an arithmetic, bitwise, shift, or RELATIONAL operator".
 * Returns the type the operation is in, or the completion that says why the
 * operands do not mix. Relational operators reach it through the same door as
 * arithmetic ones, because it is the same rule and a second copy would drift
 * (F53).
 */
export function TypedOperandType(x: Value, y: Value, literals?: { left: boolean, right: boolean }): TypeRecord | ThrowCompletion {
  const xt = x instanceof TypedNumberValue ? ((x as TypedNumberValue).TypeRecord as TypeRecord) : null;
  const yt = y instanceof TypedNumberValue ? ((y as TypedNumberValue).TypeRecord as TypeRecord) : null;
  // `bigint` is a numeric type like any other here, so a typed value does not
  // mix with one. The arithmetic operators reach the same verdict by a
  // different road - they fall through to the standard path, which raises the
  // existing "cannot mix BigInt" TypeError - but the comparison path has BigInt
  // cases of its own that would otherwise compare the payloads and answer
  // (F53).
  if ((xt && y instanceof BigIntValue) || (yt && x instanceof BigIntValue)) {
    return Throw.TypeError('$1 and $2 are different numeric types and do not mix; convert one of them', Value(displayType((xt ?? yt)!)), Value('bigint'));
  }
  if (xt && yt && !SameType(xt, yt)) {
    return Throw.TypeError('$1 and $2 are different numeric types and do not mix; convert one of them', Value(displayType(xt)), Value(displayType(yt)));
  }
  const target = (xt ?? yt)!;
  // The untyped side, if there is one, must be a literal to take the type.
  if (!xt || !yt) {
    const untypedIsLiteral = xt ? literals?.right : literals?.left;
    if (!untypedIsLiteral) {
      return Throw.TypeError('a value of the $1 type and a $2 are different numeric types and do not mix; convert one of them', Value('number'), Value(displayType(target)));
    }
    const literalValue = payload(xt ? y : x);
    if (!fitsNumericType(literalValue, (target as TypeRecord & { Kind: 'primitive' }).Name, (target as TypeRecord & { Kind: 'primitive' }).Arguments)) {
      // "A literal that does not fit its type" is an Early Error where the
      // checker sees it; this is the run-time backstop, the same RangeError a
      // parameter boundary raises.
      return Throw.RangeError('$1 is not in the range of $2', Value(literalValue), Value(displayType(target)));
    }
  }
  return target;
}

/** Unary minus and bitwise NOT over a typed number. */
export function typedUnary(op: '-' | '~', x: TypedNumberValue): TypedNumberValue {
  const t = x.TypeRecord as TypeRecord;
  const math = op === '-' ? -payload(x) : ~payload(x);
  return new TypedNumberValue(wrapToType(math, t), t);
}
