import { test, expect } from 'vitest';
import { evaluated, evaluatedFlagOff, expectThrownFlagOff } from '../readme/harness.mts';

/**
 * proposal-runtime-types (spec, sec-numeric-predicates): `isFinite`, `isNaN`, and
 * the `Number` statics that ask the same questions are overloaded for the numeric
 * types, each overload taking one value of a numeric type and returning a boolean.
 *
 * The clause exists because these predicates test the VALUE, and without the
 * overloads they were testing a representation instead. The `Number` statics do
 * not coerce, so every one of them answered false for every typed value; the
 * global pair answered correctly for the integer and float families, but only
 * because ToNumber unwraps a typed number in passing, which was an accident of
 * the coercion rather than a rule.
 */

// -- The integer family: the first three questions are constants at the type ----
test('numeric predicates: an integer type answers from the type', () => {
  for (const t of ['int8', 'uint8', 'int32', 'uint32']) {
    expect(evaluated(`String(Number.isNaN((3 := ${t})));`)).toBe('false');
    expect(evaluated(`String(Number.isFinite((3 := ${t})));`)).toBe('true');
    expect(evaluated(`String(Number.isInteger((3 := ${t})));`)).toBe('true');
    expect(evaluated(`String(Number.isSafeInteger((3 := ${t})));`)).toBe('true');
    // the globals agree, now by rule rather than by the coercion's accident
    expect(evaluated(`String(isNaN((3 := ${t})));`)).toBe('false');
    expect(evaluated(`String(isFinite((3 := ${t})));`)).toBe('true');
  }
  // THE TRAP THIS CLOSES: before the overloads, both of these were false
  expect(evaluated('String(Number.isInteger((3 := int32)));')).toBe('true');
  expect(evaluated('String(Number.isFinite((0 := uint8)));')).toBe('true');
});

test('numeric predicates: safety asks about the mathematical value', () => {
  // a width at or below 53 bits cannot hold an unsafe integer, so it is constant
  expect(evaluated('String(Number.isSafeInteger((255 := uint8)));')).toBe('true');
  // and a wide width answers about the value, not about a payload's precision
  expect(evaluated('String(Number.isSafeInteger((1152921504606846976 := int64)));')).toBe('false');
  expect(evaluated('String(Number.isSafeInteger((5 := int64)));')).toBe('true');
});

// -- The float family: every question is a question about the value -------------
test('numeric predicates: a float type answers from the value', () => {
  expect(evaluated('String(Number.isNaN(Math.sqrt(((0 - 1) := float32))));')).toBe('true');
  expect(evaluated('String(isNaN(Math.sqrt(((0 - 1) := float32))));')).toBe('true');
  expect(evaluated('String(Number.isNaN((1.5 := float32)));')).toBe('false');
  // an infinity is not finite, and a Math return can produce one
  expect(evaluated('String(Number.isFinite(Math.exp((100 := float32))));')).toBe('false');
  expect(evaluated('String(isFinite(Math.exp((100 := float32))));')).toBe('false');
  expect(evaluated('String(Number.isFinite((1.5 := float32)));')).toBe('true');
  // integrality is about the value, so a float holding a whole number is integral
  expect(evaluated('String(Number.isInteger((2 := float32)));')).toBe('true');
  expect(evaluated('String(Number.isInteger((1.5 := float32)));')).toBe('false');
  expect(evaluated('String(Number.isSafeInteger((2 := float64)));')).toBe('true');
  expect(evaluated('String(Number.isSafeInteger((1.5 := float64)));')).toBe('false');
  // and a NaN is not an integer either
  expect(evaluated('String(Number.isInteger(Math.sqrt(((0 - 1) := float32))));')).toBe('false');
});

test('numeric predicates: float16 and float64 answer alike', () => {
  for (const t of ['float16', 'float32', 'float64']) {
    expect(evaluated(`String(Number.isFinite((1 := ${t})));`)).toBe('true');
    expect(evaluated(`String(Number.isNaN((1 := ${t})));`)).toBe('false');
  }
});

// -- The bigint family ----------------------------------------------------------
test('numeric predicates: a bigint answers as the exact unbounded integer it is', () => {
  expect(evaluated('String(Number.isNaN(1n));')).toBe('false');
  expect(evaluated('String(Number.isFinite(1n));')).toBe('true');
  expect(evaluated('String(Number.isInteger(1n));')).toBe('true');
  expect(evaluated('String(Number.isSafeInteger(5n));')).toBe('true');
  // safety is a question about magnitude, which a bigint can exceed
  expect(evaluated('String(Number.isSafeInteger(9007199254740993n));')).toBe('false');
  expect(evaluated('String(Number.isSafeInteger(-9007199254740993n));')).toBe('false');
  // the globals threw on a BigInt before, ToNumber refusing it; now they answer
  expect(evaluated('String(isNaN(1n));')).toBe('false');
  expect(evaluated('String(isFinite(1n));')).toBe('true');
});

// -- The rational family --------------------------------------------------------
test('numeric predicates: a rational is never NaN and integral at a unit denominator', () => {
  expect(evaluated('String(Number.isNaN(rational(1, 2)));')).toBe('false');
  expect(evaluated('String(Number.isFinite(rational(1, 2)));')).toBe('true');
  expect(evaluated('String(isFinite(rational(1, 2)));')).toBe('true');
  expect(evaluated('String(Number.isInteger(rational(1, 2)));')).toBe('false');
  // canonical form means 4/2 has already reduced to 2/1, so it is an integer
  expect(evaluated('String(Number.isInteger(rational(4, 2)));')).toBe('true');
  expect(evaluated('String(Number.isInteger(rational(5)));')).toBe('true');
  expect(evaluated('String(Number.isSafeInteger(rational(4, 2)));')).toBe('true');
  expect(evaluated('String(Number.isSafeInteger(rational(1, 2)));')).toBe('false');
});

// -- The untyped surface is untouched -------------------------------------------
test('numeric predicates: an untyped call keeps its ordinary meaning', () => {
  // the globals coerce, as they always have
  expect(evaluated('String(isNaN("x"));')).toBe('true');
  expect(evaluated('String(isNaN("5"));')).toBe('false');
  expect(evaluated('String(isNaN(5));')).toBe('false');
  expect(evaluated('String(isFinite("5"));')).toBe('true');
  expect(evaluated('String(isFinite(Infinity));')).toBe('false');
  // and the statics decline to, as they always have
  expect(evaluated('String(Number.isNaN("x"));')).toBe('false');
  expect(evaluated('String(Number.isNaN(NaN));')).toBe('true');
  expect(evaluated('String(Number.isFinite("5"));')).toBe('false');
  expect(evaluated('String(Number.isInteger(3));')).toBe('true');
  expect(evaluated('String(Number.isInteger(3.5));')).toBe('false');
  expect(evaluated('String(Number.isSafeInteger(3));')).toBe('true');
  expect(evaluated('String(Number.isInteger({}));')).toBe('false');
  expect(evaluated('String(Number.isNaN(undefined));')).toBe('false');
});

// -- Gating ---------------------------------------------------------------------
test('numeric predicates: the overloads are gated, so flag-off is unchanged', () => {
  // with the flag off the statics decline every non-Number, including a BigInt,
  // and the globals still refuse to coerce one
  expect(evaluatedFlagOff('String(Number.isNaN(1n));')).toBe('false');
  expect(evaluatedFlagOff('String(Number.isInteger(1n));')).toBe('false');
  expect(evaluatedFlagOff('String(Number.isFinite(1n));')).toBe('false');
  // the ordinary Number answers are identical with the flag either way
  expect(evaluatedFlagOff('String(Number.isNaN(NaN));')).toBe('true');
  expect(evaluatedFlagOff('String(Number.isInteger(3));')).toBe('true');
  expect(evaluatedFlagOff('String(isNaN("x"));')).toBe('true');
  expect(evaluatedFlagOff('String(isFinite(1));')).toBe('true');
});

test('numeric predicates: a bigint still throws at the globals with the flag off', () => {
  // ToNumber refuses a BigInt, so the flag-off behaviour is the error it was
  expectThrownFlagOff('isNaN(1n);');
  expectThrownFlagOff('isFinite(1n);');
});
