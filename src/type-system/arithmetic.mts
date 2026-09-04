import { NumberValue, TypedNumberValue, Value, BigIntValue, ObjectValue } from '../value.mts';
import { decodeFloat16, encodeFloat16 } from '../host-defined/ieee754.mts';
import type { TypeRecord } from './records.mts';
import { SameType } from './relations.mts';
import { displayType, UnderlyingOf } from './records.mts';
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

export function wrapToType(math: number | bigint, t: TypeRecord): number | bigint {
  if (typeof math === 'bigint') {
    // The exact path. A wide type keeps the BigInt, which is the whole point:
    // #sec-integer-operations wraps modulo 2**N, and asIntN/asUintN ARE that
    // reduction at the type's width.
    if (t.Kind !== 'primitive') {
      return math;
    }
    const wideBits = widthOf(t);
    if (wideBits === null) {
      return math;
    }
    const wrapped = t.Name === 'int' ? BigInt.asIntN(wideBits, math) : BigInt.asUintN(wideBits, math);
    // A type a double still holds exactly keeps its Number representation, so
    // only the wide types carry a BigInt and nothing narrower changes shape.
    return wideBits > 53 ? wrapped : Number(wrapped);
  }
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
  // A modulus of 2**bits is not exactly representable as a Number once bits
  // exceeds 53, and the reduction below then loses the value entirely: for
  // `int64`, `-5 + 2**64` rounds to exactly 2**64, the signed step subtracts
  // 2**64, and the result is 0. Every negative value of an `int64` or `int128`
  // became zero this way, as did `-v` and `Math.abs` over one.
  //
  // Above 53 bits the reduction is done in BigInt, which is exact, and the
  // two's-complement step is what BigInt.asIntN and asUintN already are.
  if (bits > 53) {
    // Reached where the operands were Numbers but the TYPE is wide - a literal
    // adopted into a wide type, say. The reduction was already exact; what was
    // lost was returning it as a Number, which put the answer back into the
    // representation that cannot hold it.
    const truncated = BigInt(Math.trunc(math));
    return t.Name === 'int'
      ? BigInt.asIntN(bits, truncated)
      : BigInt.asUintN(bits, truncated);
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

/**
 * proposal-runtime-types #sec-integer-types: an integer type's values are the
 * integers of its width, and a double distinguishes those only to 53 bits. A
 * type wider than that computes in BigInt, which is what makes the operation
 * answer the type's own values rather than the nearest doubles to them.
 */
export function isWideIntegerType(t: TypeRecord): boolean {
  if (t.Kind !== 'primitive' || (t.Name !== 'int' && t.Name !== 'uint')) {
    return false;
  }
  const bits = widthOf(t);
  return bits !== null && bits > 53;
}

/** mathOp over the exact integers, for a type a double cannot hold. */
function mathOpExact(op: BinOp, x: bigint, y: bigint, bits: number, signed: boolean): bigint | undefined {
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    // Integer division truncates toward zero, which is what BigInt division
    // already does; `/` on an integer type is the truncating one and divFloor
    // is the other (#sec-floored-division).
    case '/': return y === 0n ? undefined : x / y;
    case '%': return y === 0n ? undefined : x % y;
    case '**': return y < 0n ? undefined : x ** y;
    // The shifts are performed at the TYPE'S width rather than at 32, and the
    // distance is taken modulo that width. The Number path has a known
    // divergence here; the exact path gets it right from the start rather than
    // inheriting the same defect.
    case '<<': return x << (((y % BigInt(bits)) + BigInt(bits)) % BigInt(bits));
    case '>>': return x >> (((y % BigInt(bits)) + BigInt(bits)) % BigInt(bits));
    case '>>>': {
      const distance = ((y % BigInt(bits)) + BigInt(bits)) % BigInt(bits);
      // An unsigned shift reads the operand as its two's-complement bit pattern
      // at the width, which is what BigInt.asUintN gives.
      return BigInt.asUintN(bits, x) >> distance;
    }
    case '&': return x & y;
    case '^': return x ^ y;
    case '|': return x | y;
    default: return undefined;
  }
  void signed;
}

function payload(v: Value): number {
  // proposal-runtime-types R6: read the numeric payload directly. Both
  // NumberValue and TypedNumberValue expose numberValue(); R would assert
  // instanceof NumberValue, which a typed number no longer satisfies.
  return (v as NumberValue | TypedNumberValue).numberValue(); // eslint-disable-line @engine262/mathematical-value
}

/** The payload as an exact integer, for the wide path. */
function payloadExact(v: Value): bigint {
  if (v instanceof TypedNumberValue) {
    return (v as TypedNumberValue).bigintValue();
  }
  return BigInt(Math.trunc(payload(v)));
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
 * which is the one thing this proposal's arithmetic is most emphatic about.
 * LITERALNESS IS SYNTACTIC, so the operand nodes decide it: the caller
 * passes which side was written as a numeric literal, and a literal adopts the
 * other's type while any other untyped operand is a mix and throws.
 */
export function typedBinary(op: BinOp, x: Value, y: Value, literals?: { left: boolean, right: boolean, leftLetConst?: boolean, rightLetConst?: boolean }): TypedNumberValue | ThrowCompletion {
  const target = TypedOperandType(x, y, literals);
  if (target instanceof AbruptCompletion) {
    return target as ThrowCompletion;
  }
  // proposal-runtime-types #table-family-operations: a binary floating-point type
  // "does not define bitwiseNOT, the shifts, and the bitwise operations, since
  // each would require converting the operand to an integer type". The decimal
  // family already refuses them; the binary one fell through to Number
  // semantics, so `(4 := float32) << (1 := float32)` answered 8 for an operation
  // the table says the type does not have.
  if ((target.Kind === 'primitive' && /^float(16|32|64|128)$/.test(target.Name))
      && (op === '<<' || op === '>>' || op === '>>>' || op === '&' || op === '|' || op === '^')) {
    return Throw.TypeError('this operator is not defined for a binary floating-point type') as ThrowCompletion;
  }
  if (isWideIntegerType(target)) {
    const bits = widthOf(target) as number;
    const exact = mathOpExact(op, payloadExact(x), payloadExact(y), bits, (target as { Name: string }).Name === 'int');
    if (exact !== undefined) {
      return new TypedNumberValue(wrapToType(exact, target), target);
    }
    // A division by zero has no integer answer; fall through to the Number
    // path, which reports it the way it always has.
  }
  // proposal-runtime-types #sec-integer-operations gives each type the
  // operations of its family AT ITS OWN WIDTH. JavaScript's shift operators are
  // defined to truncate their operand to 32 bits, so `mathOp`'s `x << y`
  // answers a 32-bit shift whatever the type says - which was invisible above
  // 53, where the exact path already computes the shifts at the width, and
  // wrong for every width from 33 to 53.
  //
  // Those widths are NUMBER-BACKED because a double holds them exactly, so the
  // fix is not to widen the carrier - that would cost every operation in the
  // band for no exactness gain. It is to compute the shift arithmetically:
  // `<<` multiplies by 2**distance, `>>` divides the SIGNED value, and `>>>`
  // divides the value read as unsigned at the width. Each is exact in a double,
  // because `m * 2**d` needs no more significand than `m` does - the
  // multiplication only moves the exponent - and `wrapToType` below already
  // reduces the result through asIntN/asUintN at the width.
  const shiftBits = widthOf(target);
  if (shiftBits !== null && shiftBits > 32 && shiftBits <= 53
    && (op === '<<' || op === '>>' || op === '>>>')) {
    const left = payload(x) as number;
    const distance = (((payload(y) as number) % shiftBits) + shiftBits) % shiftBits;
    const scale = 2 ** distance;
    let shifted;
    if (op === '<<') {
      shifted = left * scale;
    } else if (op === '>>') {
      shifted = Math.floor(left / scale);
    } else {
      // An unsigned shift reads the operand as its two's-complement bit pattern
      // at the width, which for a Number-backed type is the value plus 2**N
      // where it is negative.
      shifted = Math.floor((left < 0 ? left + 2 ** shiftBits : left) / scale);
    }
    return new TypedNumberValue(wrapToType(shifted, target), target);
  }
  const math = mathOp(op, payload(x), payload(y));
  return new TypedNumberValue(wrapToType(math, target), target);
}

/**
 * proposal-runtime-types #sec-enums at an equality or `case` position.
 *
 * The clause's subtype rule reads an enum operand at its UNDERLYING type
 * "wherever the underlying type is required". A comparison requires nothing of
 * its operands - #sec-arithmetic-never-promotes says it "answers rather than
 * computing" - so what licenses the reading here is the OTHER operand
 * establishing that the position is an underlying-typed one: a literal, or a
 * value of a type that is not an enum. Where both operands are of enum types
 * nothing establishes it, so two distinct enums stay distinct and compare
 * unequal, as two distinct value types do, and two values of ONE enum compare
 * by value without needing this at all.
 *
 * This is the equality half of the rule; the arithmetic half is unconditional
 * and lives in TypedOperandType, because there a numeric operand IS required.
 *
 * Returns the operand pair to use, or undefined where neither side changes.
 */
export function DecayEnumOperands(x: Value, y: Value): { left: Value, right: Value } | undefined {
  const xt = x instanceof TypedNumberValue ? ((x as TypedNumberValue).TypeRecord as TypeRecord) : null;
  const yt = y instanceof TypedNumberValue ? ((y as TypedNumberValue).TypeRecord as TypeRecord) : null;
  const xIsEnum = xt !== null && UnderlyingOf(xt) !== xt;
  const yIsEnum = yt !== null && UnderlyingOf(yt) !== yt;
  if (xIsEnum === yIsEnum) {
    return undefined;
  }
  if (xIsEnum) {
    return { left: new TypedNumberValue((x as TypedNumberValue).value, UnderlyingOf(xt!)), right: y };
  }
  return { left: x, right: new TypedNumberValue((y as TypedNumberValue).value, UnderlyingOf(yt!)) };
}

/**
 * The literal rule alone, for the operators that ADOPT but do not otherwise
 * constrain their operands: equality compares rather than computes, so a
 * literal takes the other operand's type and a mismatch is an ordinary
 * *false* rather than a type error. Returns the operand pair to use, or
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
  // was a host crash rather than a wrong answer, which is how it was found.
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
 * arithmetic ones, because it is the same rule and a second copy would drift.
 */
export function TypedOperandType(x: Value, y: Value, literals?: { left: boolean, right: boolean, leftLetConst?: boolean, rightLetConst?: boolean }): TypeRecord | ThrowCompletion {
  // proposal-runtime-types #sec-enums: an operand of an enum type is read at its
  // UNDERLYING type here, which is what the clause means by "an enum can be used
  // for arithmetic, indexing, and comparison without a cast" and by `comp / 32`
  // reading directly. It is also what keeps the RESULT sound: the operands of
  // `C.One + C.Two` are both of type `C`, and the rule of the enclosing clause
  // would give the result that type - but an enum's values are exactly its
  // enumerators, and the sum need not be one of them.
  const xt = x instanceof TypedNumberValue ? UnderlyingOf((x as TypedNumberValue).TypeRecord as TypeRecord) : null;
  const yt = y instanceof TypedNumberValue ? UnderlyingOf((y as TypedNumberValue).TypeRecord as TypeRecord) : null;
  // `bigint` is a numeric type like any other here, so a typed value does not
  // mix with one. The arithmetic operators reach the same verdict by a
  // different road - they fall through to the standard path, which raises the
  // existing "cannot mix BigInt" TypeError - but the comparison path has BigInt
  // cases of its own that would otherwise compare the payloads and answer.
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
      // A `let` bound to a numeric constant is the one failure here with a
      // one-word fix, so say it rather than reporting an unexplained mismatch.
      // The binding does not adopt because a mutable one's type must be fixed -
      // a reassignment would otherwise have nothing to check against - and
      // `const` is the better spelling anyway for something never reassigned.
      const untypedIsLetConst = xt ? literals?.rightLetConst : literals?.leftLetConst;
      if (untypedIsLetConst) {
        return Throw.TypeError('a $1 holds a $2 rather than taking this position\'s $3; declare it $4 if it is never reassigned, or annotate it', Value('let'), Value('number'), Value(displayType(target)), Value('const'));
      }
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
  // The enum rule of TypedOperandType, at the unary operators: `-C.One` computes
  // in the underlying type and is a value of it.
  const t = UnderlyingOf(x.TypeRecord as TypeRecord);
  const math = op === '-' ? -payload(x) : ~payload(x);
  return new TypedNumberValue(wrapToType(math, t), t);
}
