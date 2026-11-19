import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Question AO, AO1 at a `float128` and a rational. A constant with a bitwise operator or a shift,
 * every operand of which is an integer, is the integer JavaScript computes for it, and a `float128`
 * and a rational hold every `int32` exactly, so beside one it is taken as that integer, as beside a
 * decimal: `q * (6 | 1)` is `q * 7`. It was a TypeError when it ran, while `const q: float128 =
 * 6 | 1` was already 7.
 */

test('a bitwise constant beside a float128 or a rational is the integer it computes', () => {
  expect(evaluated('const q: float128 = 2; String(q * (6 | 1)) + " " + String(q * (1 << 4)) + " " + String(q + ~0);')).toBe('14 32 1');
  expect(evaluated('const q: rational64 = 2; String(q * (6 | 1)) + " " + String(q * (1 << 4)) + " " + String(q + ~0);')).toBe('14 32 1');
  expect(evaluated('const q: rational64 = 6 | 1; const f: float128 = 6 | 1; String(q) + " " + String(f);')).toBe('7 7');
  expect(evaluated('const q: float128 = 1; String(Reflect.typeOf(q * (6 | 1)));')).toBe('float128');
  // A rational type too narrow for the integer refuses it before running.
  expect(observeScript('const q: rational.<8> = 1; q * (1 << 10);').completion.Type).toBe('throw');
});
