import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * `yield i` AS A SOURCE OF INFERENCE for an unannotated `for`-`of` binding.
 *
 * A generator's plain `yield` operand has the generator's YIELD type as its context -
 * the `Y` of `Generator.<Y, R, N>` - just as a `return` operand has the return type.
 * The checker keeps the generator's type on a stack as it enters each generator, and
 * gives the operand `generatorParameters(...).Yield`; the pre-pass reads the same.
 *
 * The run-time conversion already made the simple case run - the yielded value was a
 * `uint8`. What this adds is the type on `i`, and so the range check before the
 * program runs.
 *
 * Only a `yield` of the generator CONTAINING the loop counts. A `yield` in a function
 * nested in the loop belongs to that function, which is not entered when the pre-pass
 * runs, so the stack still holds the outer generator. `yield*` delegates an iterable,
 * not a value, and asks for nothing - by construction: the operand of `yield* e` is an
 * iterable, so it is never the loop's number `i` directly.
 */

const T = "let t = '';";

test('a yield type is a source of inference', () => {
  expect(evaluated(`${T} function* g(): Generator.<uint8, void, void> { for (const i of 0..<3) { `
    + 't = String(Reflect.typeOf(i)); yield i; } } [...g()]; t;')).toBe('uint.<8>');
});

test('the range is checked against the yield type before the program runs', () => {
  expectStaticTypeError('function* g(): Generator.<uint8, void, void> { for (const i of 0..<300) { yield i; } }');
});

test('it is the yield type, not the return type', () => {
  // THE YIELD-NOT-RETURN GUARD. `Y` is `uint8` and `R` is `uint16`; reading the
  // return type would make `i` a `uint16`.
  expect(evaluated(`${T} function* g(): Generator.<uint8, uint16, void> { for (const i of 0..<3) { `
    + 't = String(Reflect.typeOf(i)); yield i; } return 7; } [...g()]; t;')).toBe('uint.<8>');
});

test('an async generator yields its yield type', () => {
  expect(evaluated(`${T} async function* g(): AsyncGenerator.<uint8, void, void> { for (const i of 0..<3) { `
    + 't = String(Reflect.typeOf(i)); yield i; } } g().next(); t;')).toBe('uint.<8>');
});

test('a yield inside a generator nested in the loop does not take the outer type', () => {
  // THE NESTED GUARD. The stack holds the OUTER generator's `uint16`.
  expect(evaluated(`${T} function* g(): Generator.<uint16, void, void> { for (const i of 0..<3) { `
    + 'const f = function* (): Generator.<uint8, void, void> { yield i; }; t = String(Reflect.typeOf(i)); } } '
    + '[...g()]; t;')).toBe('number');
});

test('the existing rules still apply', () => {
  // A disagreeing use, and a guard whose literal fits.
  expect(evaluated(`${T} const s = new Set.<uint32>(); function* g(): Generator.<uint8, void, void> { `
    + 'for (const i of 0..<3) { s.add(i); t = String(Reflect.typeOf(i)); yield i; } } [...g()]; t;')).toBe('number');
  expect(evaluated(`${T} function* g(): Generator.<uint8, void, void> { for (const i of 0..<3) { `
    + 't = String(Reflect.typeOf(i)); if (i > 1) yield i; } } [...g()]; t;')).toBe('uint.<8>');
});

test('an unannotated generator asks for nothing', () => {
  expect(evaluated(`${T} function* g() { for (const i of 0..<3) { t = String(Reflect.typeOf(i)); yield i; } } `
    + '[...g()]; t;')).toBe('number');
});
