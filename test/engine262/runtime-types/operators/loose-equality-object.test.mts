import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Question AX: `==` between a numeric value of this proposal and an Object
 * converts the Object by ToPrimitive and compares again, as `3 == obj` does
 * (#sec-equality-and-comparison: typed values compare "by the loose-equality
 * algorithm they already use"). IsLooselyEqual's Object step did not see a
 * typed number, so `uint8(3) == { valueOf() { return 3; } }` was *false* and
 * the `valueOf` was never called.
 */

const F = 'let log = ""; const o = (v) => ({ valueOf() { log += "v"; return v; } }); function eq(a, b) { return a == b; } ';

test('an Object beside a typed number is the primitive it converts to', () => {
  expect(evaluated(`${F}String(eq(uint8(3), o(3))) + " " + log;`)).toBe('true v');
  expect(evaluated(`${F}String(eq(o(3), uint8(3))) + " " + log;`)).toBe('true v');
  expect(evaluated(`${F}String(eq(uint8(3), o(uint8(3))));`)).toBe('true');
  expect(evaluated(`${F}String(eq(uint8(3), o(4)));`)).toBe('false');
  expect(evaluated('function eq(a, b) { return a == b; } String(eq(uint8(3), new Number(3))) + " " + String(eq(uint8(3), [3]));')).toBe('true true');
});

test('the same holds of a decimal, and of an enumerator', () => {
  expect(evaluated(`${F}String(eq(decimal64(3), o(3)));`)).toBe('true');
  expect(evaluated(`enum E : uint8 { A = 1 } ${F}String(eq(E.A, o(1)));`)).toBe('true');
});

test('the comparisons that did not reach an Object are unchanged', () => {
  expect(evaluated('function eq(a, b) { return a == b; } String(eq(uint8(3), "3")) + " " + String(eq(uint8(1), true)) + " " + String(eq(uint8(0), null));')).toBe('true true false');
});
