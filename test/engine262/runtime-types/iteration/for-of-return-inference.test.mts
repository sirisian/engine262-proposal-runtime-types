import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * `return i` AS A SOURCE OF INFERENCE for an unannotated `for`-`of` binding.
 *
 * #sec-contextual-types: "the operand of a `return` in a function with a return
 * annotation" has the annotated return type. The checker keeps that type on a stack
 * as it enters each function - with the awaited type for `async`, the return (not
 * yield) type for a generator, and a CONTEXTUAL return type where a function takes one
 * from a target - so the pre-pass reads it rather than recomputing it.
 *
 * The run-time conversion already made the simple case run: `h()` returned a `uint8`.
 * What this fixes is the two cases that did not work - a union return type, refused
 * outright, and an out-of-range range, caught only when called.
 *
 * Only a `return` of the function CONTAINING the loop counts. A `return` inside a
 * function nested in the loop belongs to that function, which is not entered when the
 * pre-pass runs - the stack still holds the outer type - so it asks for nothing.
 */

const T = "let t = '';";
const LOOP = 'for (const i of 0..<3) { t = String(Reflect.typeOf(i)); return i; }';

// ---- the two gaps ---------------------------------------------------------

test('a return type is a source of inference', () => {
  expect(evaluated(`${T} function h(): uint8 { ${LOOP} return 0; } h(); t;`)).toBe('uint.<8>');
});

test('the range is checked against the return type before the program runs', () => {
  // Before, this was caught only when `h` was called and reached 256.
  expectStaticTypeError('function h(): uint8 { for (const i of 0..<300) { return i; } return 0; }');
});

test('a union return type is no longer refused', () => {
  // Refused before: the run-time conversion does not take a union target, and
  // `return` was not a source of inference, so nothing accepted the loop.
  expect(evaluated(`${T} function h(): uint8 | string { ${LOOP} return 0; } h(); t;`)).toBe('uint.<8>');
});

test('an out-of-range value in a union return does not become a string', () => {
  // THE UNION GUARD. At run time `uint8 | string` takes 300 as the string "300";
  // inferring the `uint8` member refuses it before the program runs, as the literal
  // `300` is refused there.
  expectStaticTypeError('function h(): uint8 | string { for (const i of 300..<301) { return i; } return 0; }');
});

// ---- every kind of function -----------------------------------------------

test('arrows, methods, getters and class methods', () => {
  expect(evaluated(`${T} const h = (): uint8 => { ${LOOP} return 0; }; h(); t;`)).toBe('uint.<8>');
  expect(evaluated(`${T} const o = { m(): uint8 { ${LOOP} return 0; } }; o.m(); t;`)).toBe('uint.<8>');
  expect(evaluated(`${T} const o = { get x(): uint8 { ${LOOP} return 0; } }; o.x; t;`)).toBe('uint.<8>');
  expect(evaluated(`${T} class C { m(): uint8 { ${LOOP} return 0; } } new C().m(); t;`)).toBe('uint.<8>');
});

test('async takes the awaited type; a generator its return type, not its yield type', () => {
  expect(evaluated(`${T} async function h(): Promise.<uint8> { ${LOOP} return 0; } h(); t;`)).toBe('uint.<8>');
  expect(evaluated(`${T} function* g(): Generator.<uint8, uint16, void> { ${LOOP} } [...g()]; t;`)).toBe('uint.<16>');
});

test('a contextual return type counts, as the function\'s own', () => {
  // The specification makes the signature a function takes from its target its
  // Static Type, so its return type is the function's own.
  expect(evaluated(`${T} type O = { m(): uint8 }; const o: O = { m() { ${LOOP} return 0; } }; o.m(); t;`))
    .toBe('uint.<8>');
});

test('an unannotated function, or a `number` return type, asks for nothing', () => {
  expect(evaluated(`${T} function h() { ${LOOP} } h(); t;`)).toBe('number');
  expect(evaluated(`${T} function h(): number { ${LOOP} return 0; } h(); t;`)).toBe('number');
});

// ---- where the return sits ------------------------------------------------

test('a return inside a function nested in the loop does not take the outer type', () => {
  // THE NESTED GUARD. The nested arrow is not entered when the pre-pass runs, so the
  // stack holds the OUTER `uint16`; reading it would type `i` wrongly.
  expect(evaluated(`${T} function h(): uint16 { for (const i of 0..<3) { const f = (): uint8 => { return i; }; `
    + 't = String(Reflect.typeOf(i)); } return 0; } h(); t;')).toBe('number');
  // A getter nested in the loop is a function too.
  expect(evaluated(`${T} function h(): uint16 { for (const i of 0..<3) { const o = { get x(): uint8 { return i; } }; `
    + 't = String(Reflect.typeOf(i)); } return 0; } h(); t;')).toBe('number');
});

test('a loop inside a nested function takes that function\'s type', () => {
  expect(evaluated(`${T} for (const k of 0..<1) { const f = (): uint8 => { ${LOOP} return 0; }; f(); } t;`))
    .toBe('uint.<8>');
});

// ---- the existing rules still apply ---------------------------------------

test('a return that disagrees with another use asks for nothing', () => {
  expect(evaluated(`${T} const s = new Set.<uint32>(); function h(): uint8 { `
    + 'for (const i of 0..<3) { s.add(i); t = String(Reflect.typeOf(i)); return i; } return 0; } h(); t;')).toBe('number');
});

test('untyped arithmetic still blocks', () => {
  expect(evaluated(`${T} function h(): uint8 { for (const i of 0..<3) { t = String(Reflect.typeOf(i)); return i * 2; } `
    + 'return 0; } h(); t;')).toBe('number');
});

test('a guard whose literal fits the return type does not block', () => {
  // `5` is a `uint8`, so comparing `i` with it says the same thing at either type.
  // This asserted `number` before comparisons with a fitting literal stopped
  // blocking; see `for-of-comparison-literals.test.mts`.
  expect(evaluated(`${T} function h(): uint8 { for (const i of 0..<3) { t = String(Reflect.typeOf(i)); if (i > 5) return i; } `
    + 'return 0; } h(); t;')).toBe('uint.<8>');
});

test('a guard whose literal does not fit still blocks', () => {
  expect(evaluated(`${T} function h(): uint8 { for (const i of 0..<3) { t = String(Reflect.typeOf(i)); if (i < 300) return i; } `
    + 'return 0; } h(); t;')).toBe('number');
});

test('a guard against a typed bound does not block', () => {
  expect(evaluated(`${T} function h(): uint8 { const lim: uint8 = 5; for (const i of 0..<3) { `
    + 't = String(Reflect.typeOf(i)); if (i > lim) return i; } return 0; } h(); t;')).toBe('uint.<8>');
});
