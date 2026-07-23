import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

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

// -- A result that is not a number of the argument's kind stays plain -----------
test('numeric library: an integer argument keeps its type only where the result is an integer', () => {
  // a square root generally is not one, so it is not forced into a type it does
  // not belong to
  expect(evaluated('(Math.sqrt((2 := int32)) is int32) ? "yes" : "no";')).toBe('no');
  expect(evaluated('String(Math.sqrt((2 := int32)) > 1.41);')).toBe('true');
  // NaN is not an integer either
  expect(evaluated('String(Number.isNaN(Math.sqrt(((0 - 1) := int32))));')).toBe('true');
  // a float keeps its type for all of these, since every real is a value of the
  // width once rounded to it
  expect(evaluated('(Math.sqrt((2 := float32)) is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('(Math.sqrt(((0 - 1) := float32)) is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('(Math.log((0 := float32)) is float32) ? "yes" : "no";')).toBe('yes');
});

test('numeric library: a carried float result is a value of its width', () => {
  // the same wrapToType stability every other float value has
  expect(evaluated('let x = Math.sqrt((2 := float32)); String(Number(x) - Math.fround(Number(x)));')).toBe('0');
  expect(evaluated('let x = Math.exp((1 := float16)); String(Number(x) - Math.f16round(Number(x)));')).toBe('0');
  // and a negative zero survives the round trip
  expect(evaluated('String(1 / Number(Math.round(((0 - 0.4) := float32))));')).toBe('-Infinity');
});

// -- DIVERGENCE 1: an overflowing result is handled differently from an operator --
test('numeric library: an out-of-range result neither wraps nor throws (pending a spec decision)', () => {
  // The operators WRAP: this is the conversion rule, and uint8 arithmetic says so.
  expect(evaluated('String(Number((200 := uint8) + (100 := uint8)));')).toBe('44');
  // A Math function reaching the same overflow does a third thing: it declines to
  // carry the type and answers with a plain Number. So `+` and `Math.pow` disagree
  // about the same arithmetic.
  expect(evaluated('String(Math.pow((2 := uint8), (10 := uint8)));')).toBe('1024');
  expect(evaluated('(Math.pow((2 := uint8), (10 := uint8)) is uint8) ? "yes" : "no";')).toBe('no');
  // the same shape at the signed boundary, where the magnitude of the most
  // negative value is not representable
  expect(evaluated('String(Math.abs(((0 - 128) := int8)));')).toBe('128');
  expect(evaluated('(Math.abs(((0 - 128) := int8)) is int8) ? "yes" : "no";')).toBe('no');
});

// -- DIVERGENCE 2: a mixed-type call has no resolution rule ----------------------
test('numeric library: a mixed-type call falls back to a plain result (pending a spec decision)', () => {
  // two typed arguments of different types have no single type to preserve
  expect(evaluated('(Math.max((1 := uint8), (2 := uint16)) is uint8) ? "yes" : "no";')).toBe('no');
  expect(evaluated('(Math.max((1 := uint8), (2 := uint16)) is uint16) ? "yes" : "no";')).toBe('no');
  // a plain literal alongside a typed argument does not block preservation, which
  // is the case literal propagation covers
  expect(evaluated('(Math.pow((2 := float32), 3) is float32) ? "yes" : "no";')).toBe('yes');
  // but a plain argument OUTSIDE the typed argument's range silently produces a
  // plain result rather than being rejected
  expect(evaluated('String(Math.max((1 := uint8), 300));')).toBe('300');
  expect(evaluated('(Math.max((1 := uint8), 300) is uint8) ? "yes" : "no";')).toBe('no');
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
