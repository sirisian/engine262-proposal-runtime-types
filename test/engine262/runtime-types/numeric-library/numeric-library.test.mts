import { test, expect } from 'vitest';
import { expectStaticTypeError, evaluated, evaluatedFlagOff, expectThrownKind } from '../harness.mts';

/**
 * Extension coverage - the numeric library, read as generics over the numeric types.
 *
 * The specification says the functions of the Math object, and the other library
 * functions that take or return a numeric value, are overloaded for the numeric
 * types, and that a signature taking a value of a numeric type T returns a value of
 * T where its result is a number of the same kind. This file walks that claim over
 * the type space and over a representative spread of the operations.
 *
 * It pins three DIVERGENCES as well as the working cases. They are marked where
 * they appear, and each is a question the specification has not answered rather
 * than an implementation oversight: the clause asserts the overloading without
 * listing the signatures, so there is nothing yet to say what happens when a result
 * does not fit its type, what a mixed-type call resolves to, or how a width wider
 * than a Number can carry its value.
 */

const INT_WIDTHS = ['int8', 'int16', 'int32', 'int64', 'int128'];
const UINT_WIDTHS = ['uint8', 'uint16', 'uint32', 'uint64', 'uint128'];
const FLOAT_WIDTHS = ['float16', 'float32', 'float64'];

// -- The type is preserved across every width that has values -------------------
test('numeric library: a unary Math function preserves every integer width', () => {
  for (const t of [...INT_WIDTHS, ...UINT_WIDTHS]) {
    expect(evaluated(`(Math.abs((5 := ${t})) is ${t}) ? "yes" : "no";`)).toBe('yes');
    expect(evaluated(`String(Number(Math.abs((5 := ${t}))));`)).toBe('5');
    expect(evaluated(`(Math.trunc((5 := ${t})) is ${t}) ? "yes" : "no";`)).toBe('yes');
    expect(evaluated(`(Math.min((5 := ${t}), (7 := ${t})) is ${t}) ? "yes" : "no";`)).toBe('yes');
  }
});

test('numeric library: a unary Math function preserves every float width', () => {
  for (const t of FLOAT_WIDTHS) {
    expect(evaluated(`(Math.abs((5 := ${t})) is ${t}) ? "yes" : "no";`)).toBe('yes');
    expect(evaluated(`(Math.sqrt((4 := ${t})) is ${t}) ? "yes" : "no";`)).toBe('yes');
    expect(evaluated(`(Math.floor((5 := ${t})) is ${t}) ? "yes" : "no";`)).toBe('yes');
    expect(evaluated(`(Math.max((5 := ${t}), (7 := ${t})) is ${t}) ? "yes" : "no";`)).toBe('yes');
  }
});

test('numeric library: the rounding family and the transcendentals preserve a float', () => {
  for (const fn of ['floor', 'ceil', 'round', 'trunc', 'sign', 'sqrt', 'cbrt', 'exp', 'log', 'sin', 'cos', 'atan']) {
    expect(evaluated(`(Math.${fn}((1 := float32)) is float32) ? "yes" : "no";`)).toBe('yes');
  }
});

test('numeric library: the two-argument forms preserve a shared type', () => {
  expect(evaluated('(Math.hypot((3 := float32), (4 := float32)) is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('String(Number(Math.hypot((3 := float32), (4 := float32))));')).toBe('5');
  expect(evaluated('(Math.atan2((1 := float64), (1 := float64)) is float64) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('(Math.imul((3 := int32), (4 := int32)) is int32) ? "yes" : "no";')).toBe('yes');
  // the clause names this one as an example of the rule
  expect(evaluated('(Math.clz32((1 := uint32)) is uint32) ? "yes" : "no";')).toBe('yes');
});

// -- The integer rows are the integer mathematics, not a fallback ---------------
test('numeric library: a root at an integer type is the integer root', () => {
  // The listing gives sqrt and cbrt integer rows: the exact root truncated toward
  // zero, the direction integer division truncates, as BigInt.sqrt specifies.
  expect(evaluated('(Math.sqrt((2 := int32)) is int32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('String(Number(Math.sqrt((2 := int32))));')).toBe('1');
  expect(evaluated('String(Number(Math.sqrt((17 := uint8))));')).toBe('4');
  expect(evaluated('String(Number(Math.sqrt((16 := uint8))));')).toBe('4');
  // the correction loops matter: a perfect square must not come back one short
  expect(evaluated('String(Number(Math.sqrt((1048576 := uint32))));')).toBe('1024');
  // a negative square root has no integer answer, so it raises rather than
  // returning a NaN the family has no value for
  expectThrownKind('Math.sqrt(((0 - 1) := int32));', 'RangeError');
  // cbrt is defined for a negative and truncates toward zero
  expect(evaluated('String(Number(Math.cbrt(((0 - 9) := int32))));')).toBe('-2');
  expect(evaluated('String(Number(Math.cbrt((27 := int32))));')).toBe('3');
  // a float keeps its type for all of these, since every real is a value of the
  // width once rounded to it
  expect(evaluated('(Math.sqrt((2 := float32)) is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('(Math.sqrt(((0 - 1) := float32)) is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('String(Number.isNaN(Number(Math.sqrt(((0 - 1) := float32)))));')).toBe('true');
  expect(evaluated('(Math.log((0 := float32)) is float32) ? "yes" : "no";')).toBe('yes');
});

test('numeric library: a transcendental has no integer row', () => {
  // sin of an integer is not integer mathematics, so resolution fails and the
  // program writes the promotion it means
  // no signature at this family is a resolution failure, which is a type error
  expectStaticTypeError('Math.sin((1 := int32));');
  expectStaticTypeError('Math.exp((1 := uint8));');
  expectStaticTypeError('Math.atan2((1 := int32), (1 := int32));');
  // the conversion is what makes it work
  expect(evaluated('String(Math.sin(Number((0 := int32))));')).toBe('0');
  // and the float rows are untouched
  expect(evaluated('(Math.sin((0 := float32)) is float32) ? "yes" : "no";')).toBe('yes');
});

test('numeric library: a carried float result is a value of its width', () => {
  // the same wrapToType stability every other float value has
  expect(evaluated('let x = Math.sqrt((2 := float32)); String(Number(x) - Math.fround(Number(x)));')).toBe('0');
  expect(evaluated('let x = Math.exp((1 := float16)); String(Number(x) - Math.f16round(Number(x)));')).toBe('0');
  // and a negative zero survives the round trip
  expect(evaluated('String(1 / Number(Math.round(((0 - 0.4) := float32))));')).toBe('-Infinity');
});

// -- RESOLVED (D1): a declared return is a checked boundary ---------------------
test('numeric library: an out-of-range integer result raises rather than wrapping', () => {
  // The operators WRAP: this is the conversion rule, and uint8 arithmetic says so.
  expect(evaluated('String(Number((200 := uint8) + (100 := uint8)));')).toBe('44');
  expect(evaluated('String(Number((2 := uint8) ** (10 := uint8)));')).toBe('0');
  // A named function declares a return, and a declared return is checked, so the
  // same arithmetic raises. The asymmetry is the design's own: the operator is the
  // cheap wrapping form and the function the checked one.
  expectThrownKind('Math.pow((2 := uint8), (10 := uint8));', 'RangeError');
  // the same shape at the signed boundary, where the magnitude of the most
  // negative value is not representable
  expectThrownKind('Math.abs(((0 - 128) := int8));', 'RangeError');
  // and one width up it is simply the answer
  expect(evaluated('String(Number(Math.abs(((0 - 128) := int16))));')).toBe('128');
  // an exponent a negative integer cannot answer raises before any result exists
  expectThrownKind('Math.pow((2 := int32), ((0 - 1) := int32));', 'RangeError');
  // a result that fits is just the value, carrying the type
  expect(evaluated('String(Number(Math.pow((2 := uint8), (5 := uint8))));')).toBe('32');
  expect(evaluated('(Math.pow((2 := uint8), (5 := uint8)) is uint8) ? "yes" : "no";')).toBe('yes');
});

// -- RESOLVED (R2): one type per signature, and literals are ranked --------------
test('numeric library: a mixed-type call matches no signature', () => {
  // no numeric value type is assignable to another, so two typed arguments of
  // different types are viable at no signature at all
  expectStaticTypeError('Math.max((1 := uint8), (2 := uint16));');
  // the program states the conversion
  expect(evaluated('String(Number(Math.max(uint16((1 := uint8)), (2 := uint16))));')).toBe('2');
  // a plain literal alongside a typed argument is ranked, not typed: it takes the
  // parameter's type where it can represent it
  expect(evaluated('(Math.pow((2 := float32), 3) is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('(Math.max((1 := uint8), 3) is uint8) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('String(Number(Math.max((1 := uint8), 3)));')).toBe('3');
  // and a literal the parameter type cannot represent matches no signature either
  expectStaticTypeError('Math.max((1 := uint8), 300);');
});

// -- DIVERGENCE 3: a width wider than a Number cannot carry its value exactly ----
test('numeric library: a wide integer width preserves the type but not the value (pending a spec decision)', () => {
  // the type is carried
  expect(evaluated('(Math.abs((1152921504606846976 := int64)) is int64) ? "yes" : "no";')).toBe('yes');
  // but the payload is a Number, so a value past the exact-integer range is not
  // the value that was written. Carrying the type over an inexact payload makes
  // the answer look more authoritative than it is.
  expect(evaluated('String(Number(Math.abs((1152921504606846976 := int64))) === 1152921504606846976);')).toBe('true');
  expect(evaluated('String(Number(Math.abs((1152921504606846976 := int64))));')).toBe('1152921504606847000');
});

// -- The untyped path is untouched ----------------------------------------------
test('numeric library: an untyped call keeps its ordinary meaning', () => {
  expect(evaluated('String(Math.sqrt(4));')).toBe('2');
  expect(evaluated('String(Math.max(1, 2));')).toBe('2');
  expect(evaluated('String(Math.max());')).toBe('-Infinity');
  expect(evaluated('String(Math.clz32(1));')).toBe('31');
  expect(evaluated('String(Math.abs(-5));')).toBe('5');
});

// -- The types the library does not reach at all --------------------------------
test('numeric library: the wider numeric types have no values to overload over', () => {
  // float128 and the decimals are named types with no values, so the overloading
  // question does not arise for them yet
  for (const t of ['float128', 'decimal32', 'decimal64', 'decimal128']) {
    expect(evaluated(`let m = ""; try { (5 := ${t}); } catch (e) { m = "refused"; } m;`)).toBe('refused');
  }
});

// -- Math.clz: the width-relative leading-zero count -----------------------------
test('numeric library: clz counts in the argument own width', () => {
  // clz32 counts in a 32-bit field whatever the argument carries, which is why the
  // clause names it as preserving rather than as fixing uint32
  expect(evaluated('String(Number(Math.clz32((1 := uint8))));')).toBe('31');
  // clz counts in the argument's own width, which is what typed code means
  expect(evaluated('String(Number(Math.clz((1 := uint8))));')).toBe('7');
  expect(evaluated('String(Number(Math.clz((1 := uint16))));')).toBe('15');
  expect(evaluated('String(Number(Math.clz((128 := uint8))));')).toBe('0');
  expect(evaluated('String(Number(Math.clz((0 := uint8))));')).toBe('8');
  // the two agree at exactly 32 bits, which is the replacement story
  expect(evaluated('String(Number(Math.clz((1 := uint32))) === Number(Math.clz32((1 := uint32))));')).toBe('true');
  expect(evaluated('String(Number(Math.clz((0 := uint32))) === Number(Math.clz32((0 := uint32))));')).toBe('true');
  // the count carries the argument's type
  expect(evaluated('(Math.clz((1 := uint8)) is uint8) ? "yes" : "no";')).toBe('yes');
  // a negative value counts in its two's complement encoding, so it has no
  // leading zeros at its own width
  expect(evaluated('String(Number(Math.clz(((0 - 1) := int32))));')).toBe('0');
});

test('numeric library: clz has no untyped and no float signature', () => {
  // the width is the whole of the meaning, so there is no untyped signature
  expectThrownKind('Math.clz(1);', 'TypeError');
  expectStaticTypeError('Math.clz((1 := float32));');
  // and no bigint signature: a bigint has no width to count from the top of
  expectThrownKind('Math.clz(1n);', 'TypeError');
});

test('numeric library: clz is gated, so the flag-off engine is unchanged', () => {
  expect(evaluated('String(typeof Math.clz);')).toBe('function');
  expect(evaluatedFlagOff('String(typeof Math.clz);')).toBe('undefined');
  // clz32 is untouched with the flag off
  expect(evaluatedFlagOff('String(Math.clz32(1));')).toBe('31');
});

// -- The remaining exceptions of the listing -------------------------------------
test('numeric library: imul is fixed by its own definition', () => {
  // the result IS an int32 by construction, whatever type the arguments carry
  expect(evaluated('(Math.imul((3 := uint8), (4 := uint8)) is int32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('String(Number(Math.imul((3 := uint8), (4 := uint8))));')).toBe('12');
  expect(evaluated('(Math.imul((3 := uint8), (4 := uint8)) is uint8) ? "yes" : "no";')).toBe('no');
  // and the untyped call is unchanged
  expect(evaluated('String(Math.imul(3, 4));')).toBe('12');
});

test('numeric library: the format functions take only the float families', () => {
  expect(evaluated('(Math.fround((1.5 := float64)) is float64) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('(Math.f16round((1.5 := float32)) is float32) ? "yes" : "no";')).toBe('yes');
  // rounding an integer through binary32 is a conversion, which is written
  expectStaticTypeError('Math.fround((1 := int32));');
  expectStaticTypeError('Math.f16round((1 := uint8));');
});

test('numeric library: the rounding family is identity at an integer type', () => {
  for (const fn of ['floor', 'ceil', 'round', 'trunc']) {
    expect(evaluated(`String(Number(Math.${fn}((5 := int32))));`)).toBe('5');
    expect(evaluated(`(Math.${fn}((5 := int32)) is int32) ? "yes" : "no";`)).toBe('yes');
    expect(evaluated(`String(Number(Math.${fn}(((0 - 5) := int32))));`)).toBe('-5');
  }
});

// -- The bigint column of the listing -------------------------------------------
// A BigInt is a value of the `bigint` type, so it selects that column rather than
// reaching the Number signature, which would call ToNumber and refuse it. The
// rows are the seven functions of the TC39 BigInt Math proposal plus the rounding
// family as the identity, and they agree with it value for value.
test('numeric library: the bigint rows are exact and unbounded', () => {
  expect(evaluated('String(Math.abs(-5n));')).toBe('5');
  expect(evaluated('String(Math.sign(-5n));')).toBe('-1');
  expect(evaluated('String(Math.sign(0n));')).toBe('0');
  expect(evaluated('String(Math.min(3n, 1n, 2n));')).toBe('1');
  expect(evaluated('String(Math.max(3n, 1n, 2n));')).toBe('3');
  // a bigint is already an integer, so the rounding family is the argument
  for (const fn of ['floor', 'ceil', 'round', 'trunc']) {
    expect(evaluated(`String(Math.${fn}(7n));`)).toBe('7');
    expect(evaluated(`String(Math.${fn}(-7n));`)).toBe('-7');
  }
  // the result is a bigint, not a Number
  expect(evaluated('String(typeof Math.abs(-5n));')).toBe('bigint');
  // and nothing here can overflow, so no row checks a return
  expect(evaluated('String(Math.pow(2n, 70n));')).toBe('1180591620717411303424');
});

test('numeric library: the bigint roots truncate toward zero and are exact', () => {
  expect(evaluated('String(Math.sqrt(17n));')).toBe('4');
  expect(evaluated('String(Math.sqrt(16n));')).toBe('4');
  expect(evaluated('String(Math.cbrt(27n));')).toBe('3');
  // defined for a negative, truncating toward zero
  expect(evaluated('String(Math.cbrt(-9n));')).toBe('-2');
  // EXACT at a magnitude no double could answer for: the square root of 10**40
  expect(evaluated('String(Math.sqrt(10n ** 40n));')).toBe('100000000000000000000');
  expect(evaluated('String(Math.sqrt(10n ** 40n) * Math.sqrt(10n ** 40n) === 10n ** 40n);')).toBe('true');
  // a negative square root has no answer in the family
  expectThrownKind('Math.sqrt(-1n);', 'RangeError');
  // and exponentiation refuses a negative exponent, BigInt::exponentiate's rule
  expectThrownKind('Math.pow(2n, -1n);', 'RangeError');
});

test('numeric library: the bigint column has no other rows', () => {
  // the transcendentals, the format functions, and the bit functions all give
  // the bigint column no signature
  for (const fn of ['sin', 'cos', 'exp', 'log', 'log2', 'log10', 'fround', 'f16round', 'clz32', 'clz']) {
    expectThrownKind(`Math.${fn}(1n);`, 'TypeError');
  }
  expectThrownKind('Math.imul(1n, 1n);', 'TypeError');
  expectThrownKind('Math.atan2(1n, 1n);', 'TypeError');
  // and mixing a bigint with another numeric type is viable at no signature
  expectThrownKind('Math.max(1n, 2);', 'TypeError');
  expectThrownKind('Math.max(1n, (2 := uint8));', 'TypeError');
});

// -- sumPrecise reads the types INSIDE its iterable ------------------------------
test('numeric library: sumPrecise rounds once to the element type', () => {
  expect(evaluated('(Math.sumPrecise([(1 := float32), (2 := float32)]) is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('String(Number(Math.sumPrecise([(1 := float32), (2 := float32)])));')).toBe('3');
  expect(evaluated('(Math.sumPrecise([(1 := float64), (2 := float64)]) is float64) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('(Math.sumPrecise([(1 := float16)]) is float16) ? "yes" : "no";')).toBe('yes');
  // the mixing error, stated at the element rather than at an argument
  expectThrownKind('Math.sumPrecise([(1 := float32), (2 := float64)]);', 'TypeError');
  // the row is a float row and no other
  expectThrownKind('Math.sumPrecise([(1 := uint8)]);', 'TypeError');
  // and an untyped iterable is untouched
  expect(evaluated('String(Math.sumPrecise([1, 2, 3]));')).toBe('6');
});
