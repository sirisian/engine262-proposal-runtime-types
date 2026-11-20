import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Question BB: a literal pattern whose position the checker gave no type takes
 * the subject's numeric type when the clause runs, as a `case` label takes the
 * discriminant's (#sec-arithmetic-never-promotes), so `match` and `switch`
 * agree over a value whose type only the run time knows. The literal stayed a
 * Number, so `when 1` missed an untyped `uint8` 1 that `case 1` selected, and
 * `when [1, let x]` missed a `[uint8, uint8]`, whose elements a pattern reads
 * through iteration, which gives no position type.
 *
 * Question BH: a bare `0` is the sameValueZero comparison within the type, so
 * it matches both zeros of a `float32` as of a Number.
 */

const M = (pattern: string) => `function f(k) { return match (k) { when ${pattern}: "yes"; when _: "no"; }; } `;

test('an untyped subject takes the literal at its own numeric type', () => {
  expect(evaluated(`${M('1')}f(uint8(1)) + f(uint8(2)) + f(1);`)).toBe('yesnoyes');
  expect(evaluated(`${M('0.1')}f(float32(0.1));`)).toBe('yes');
  expect(evaluated(`${M('1')}f(decimal64(1)) + f(rational64(1)) + f(float128(1));`)).toBe('yesyesyes');
  expect(evaluated('function f(k) { return k is 1; } String(f(uint8(1))) + String(f(int64(1)));')).toBe('truetrue');
  expect(evaluated('function f(k) { switch (k) { case 1: return "yes"; } return "no"; } f(uint8(1));')).toBe('yes');
});

test('what adopts nothing at an equality adopts nothing here', () => {
  // A BigInt keeps JavaScript's answer where no type was written, as `3n === 3` does.
  expect(evaluated(`${M('1')}f(1n);`)).toBe('no');
  expect(evaluated(`${M('"1"')}f(uint8(1));`)).toBe('no');
  expect(evaluated(`${M('300')}f(uint8(44));`)).toBe('no');
});

test('an array pattern\'s literal takes its element\'s type', () => {
  expect(evaluated('function f(t: [uint8, uint8]) { return match (t) { when [1, let x]: String(x); when _: "no"; }; } f([1, 2]);')).toBe('2');
});

test('a bare zero matches both zeros of a typed float', () => {
  expect(evaluated('function f(k: float32) { return match (k) { when 0: "zero"; when _: "other"; }; } f(-0) + f(0) + f(1);')).toBe('zerozeroother');
  expect(evaluated(`${M('0')}f(float32(-0)) + f(-0);`)).toBe('yesyes');
  // An explicit sign still tells the zeros apart.
  expect(evaluated('function f(k: float32) { return match (k) { when -0: "neg"; when _: "other"; }; } f(-0) + f(0);')).toBe('negother');
});

test('a literal written with no sign that is not a zero is compared as before', () => {
  // The parser's mark says only that no sign was written. Taken for a zero, it
  // compared every unsigned literal by sameValueZero, which counts a decimal's
  // cohort as one value, and narrowed `k is 5` to `5 | -0`.
  expect(evaluated('function f(k: decimal64) { return match (k) { when 1.50: "y"; when _: "n"; }; } f(decimal64.parse("1.5"));')).toBe('n');
  expect(evaluated('function f(k) { return k is 1.50; } String(f(decimal64.parse("1.5"))) + String(f(decimal64.parse("1.50")));')).toBe('falsetrue');
  expect(evaluated('function f(k: number) { if (k is 5) { const z: 5 = k; return z; } return 0; } String(f(5));')).toBe('5');
});
