import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A constant expression at a decimal or a `float128`: its literals take the type, and the type's
 * operators compute it.
 *
 * rational.md states the rule for every typed context - "the same tokens mean different things in
 * different contexts ... the literal never converts a typed value, it just adopts the type the
 * context asks for" - and decimal.md that "a decimal literal is read from its source digits
 * directly, not routed through a binary float64". Addition, subtraction and multiplication at a
 * decimal were read that way. A division was not: it was computed as Numbers and converted where
 * it landed, so `let d: decimal128 = 1 / 3` held the double nearest a third written to 34 digits,
 * 0.3333333333333333148296162562473910. At a `float128` every operator was, and `0.1 + 0.2` there
 * was the double sum. Beside an operand nothing converts: `d * (7 / 2)` was a TypeError, and
 * `d === 7 / 2` *false* for a `d` that is 3.5.
 */

test('a decimal divides as a decimal', () => {
  expect(evaluated('const d: decimal128 = 1 / 3; String(d);')).toBe('0.3333333333333333333333333333333333');
  expect(evaluated('const d: decimal64 = 2 / 3; String(d);')).toBe('0.6666666666666667');
  expect(evaluated('const d: decimal32 = 1 / 3; String(d);')).toBe('0.3333333');
  expect(evaluated('const d: decimal64 = 7 / 2; String(d);')).toBe('3.5');
  // The digits written are the digits kept, as the type's own division keeps them.
  expect(evaluated('const d: decimal64 = 1.10 / 1; String(d);')).toBe('1.10');
  expect(evaluated('const d: decimal64 = 1 / 10 + 2 / 10; String(d);')).toBe('0.3');
  expect(evaluated('const d: decimal64 = 0.1 * 3 / 3; String(d);')).toBe('0.1');
  expect(evaluated('const d: decimal64 = 7 % 4; String(d);')).toBe('3');
  // It is what the same division of two decimals gives.
  expect(evaluated('const one: decimal128 = 1; const three: decimal128 = 3; const d: decimal128 = 1 / 3; String(d === one / three);')).toBe('true');
  // At an argument and a return as at a declaration.
  expect(evaluated('function g(d: decimal128) { return String(d); } g(1 / 3);')).toBe('0.3333333333333333333333333333333333');
  expect(evaluated('function g(): decimal64 { return 1 / 10 + 2 / 10; } String(g());')).toBe('0.3');
});

test('beside a decimal operand the expression is that decimal', () => {
  const D = 'function f(d: decimal64) { return ';
  expect(evaluated(`${D}String(d * (7 / 2)) + "," + String(d + 7 / 2) + "," + String(d * (1 / 4)); } f(2);`)).toBe('7.0,5.5,0.50');
  expect(evaluated(`${D}String(d === 7 / 2) + String(d < 7 / 2) + String(7 / 2 === d); } f(3.5);`)).toBe('truefalsetrue');
  expect(evaluated(`${D}String(d * (7 % 4)); } f(2);`)).toBe('6');
  // A named constant is its initializer written there.
  expect(evaluated(`const K = 7 / 2; ${D}String(d * K) + String(d === K) + String(K); } f(3.5);`)).toBe('12.25true3.5');
  // A whole power is repeated multiplication, and exact.
  expect(evaluated(`${D}String(d * (2 ** 3)) + String(d === 2 ** 3) + String(d === 1.5 ** 2); } f(8);`)).toBe('64truefalse');
  expect(evaluated('const d: decimal64 = 1.5 ** 2; const e: decimal64 = 10 ** 3; String(d) + "," + String(e);')).toBe('2.25,1000');
  expect(evaluated('function f(d: decimal64, c: boolean) { return d === (c ? 7 / 2 : 1); } String(f(3.5, true)) + String(f(3.5, false));')).toBe('truefalse');
});

test('a float128 computes in float128', () => {
  expect(evaluated('const q: float128 = 0.1 + 0.2; const a: float128 = 0.1; const b: float128 = 0.2; String(q === a + b) + String(q);'))
    .toBe('true0.30000000000000000000000000000000004');
  expect(evaluated('const q: float128 = 1 / 3; String(q);')).toBe('0.3333333333333333333333333333333333');
  expect(evaluated('const K = 0.1 + 0.2; const q: float128 = K; const a: float128 = 0.1; const b: float128 = 0.2; String(q === a + b);')).toBe('true');
  const Q = 'function f(q: float128) { return ';
  expect(evaluated(`${Q}String(q * (0.1 + 0.2)) + "," + String(q + (1 + 2)); } f(1);`)).toBe('0.30000000000000000000000000000000004,4');
  expect(evaluated(`${Q}String(q === 0.1 + 0.2) + String(q < 0.1 + 0.2) + String(q > 1 / 4); } const s: float128 = 0.1 + 0.2; f(s);`)).toBe('truefalsetrue');
  expect(evaluated(`const K = 0.1 + 0.2; ${Q}String(q * K === q * (0.1 + 0.2)); } f(1);`)).toBe('true');
});

test('what was read before is read as it was', () => {
  // The exact folds of a decimal and a rational, and the narrow floats' rounding.
  expect(evaluated('const d: decimal64 = 0.1 + 0.2; const e: decimal64 = 1.10 + 1; String(d) + "," + String(e);')).toBe('0.3,2.10');
  expect(evaluated('const r: rational64 = 1 / 3 + 1 / 6; String(r);')).toBe('1/2');
  expect(evaluated('const f: float32 = 0.1 + 0.2; const g: float32 = 16777216 + 1 + 1; String(f) + "," + String(g);')).toBe('0.30000001192092896,16777218');
  expect(evaluated('const n: number = 1 / 3; const m = 0.1 + 0.2; String(n) + "," + String(m);')).toBe('0.3333333333333333,0.30000000000000004');
  // A power with no exact reading is the Number's, as it was: the run time has no `**` between
  // decimals, though decimal.md lists one.
  expect(evaluated('const d: decimal64 = 2 ** 0.5; String(d);')).toBe('1.414213562373095');
  // A constant of Math is a Number beside a decimal and is refused there.
  expect(() => evaluated('function f(d: decimal64) { return d * (Math.PI / 2); } f(1);')).toThrow();
});
