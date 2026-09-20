import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * AN IMAGINARY LITERAL TAKES ITS COMPONENT FROM ITS CONTEXT.
 *
 * #sec-complex-numbers gives an imaginary literal "the type `complex`", and the
 * checker's note on that arm adds that literal propagation "is what puts a `4i`
 * in a `complex64` position at `complex64`". It did not. The literal was built
 * with no component, so it was a `complex.<number>`, and
 * `const c: complex128 = 4i` was refused - by the CHECKER, before the value was
 * ever built.
 *
 * Two halves were needed and the first alone did nothing: the literal must
 * REPORT the contextual type (or the declaration is refused before evaluation)
 * and must be BUILT at its component (or the value that reaches the store is of
 * the wrong type). Recording the component without returning it left every case
 * failing exactly as before, which is what made the missing half hard to see.
 *
 * The VALUE rows are unaffected and should stay that way: `complex.<number>` and
 * `complex.<float64>` are distinct types that convert explicitly, exactly as
 * `number` and `float64` do.
 */

test('the additive spelling works, which is the one the documents use', () => {
  // `1 + 2i` is #sec-complex-numbers' own spelling throughout its prose. The
  // context has to reach THROUGH the `+` to the imaginary literal: without that
  // the bare `4i` adopted its component and `1 + 2i` did not, so the two
  // spellings of one value disagreed.
  expect(evaluated('const c: complex128 = 1 + 2i; String(c);')).toBe('1+2i');
  expect(evaluated('const c: complex128 = 1 + 2i; String(Reflect.typeOf(c));')).toBe('complex.<float64>');
  expect(evaluated('const c: complex64 = 1 + 2i; String(Reflect.typeOf(c));')).toBe('complex.<float32>');
  // Subtraction is the same production.
  expect(evaluated('const c: complex128 = 1 - 2i; String(c);')).toBe('1-2i');
});

test('other contexts are not reshaped by that reach-through', () => {
  // The push happens only for a COMPLEX contextual; an ordinary sum and a
  // decimal sum must be untouched.
  expect(evaluated('const n: uint8 = 1 + 2; String(n);')).toBe('3');
  expect(evaluated('const d: decimal128 = 0.1 + 0.2; String(d);')).toBe('0.3');
});

test('a literal adopts the component its context asks for', () => {
  expect(evaluated('const c: complex128 = 4i; String(Reflect.typeOf(c));')).toBe('complex.<float64>');
  expect(evaluated('const c: complex64 = 4i; String(Reflect.typeOf(c));')).toBe('complex.<float32>');
  expect(evaluated('const c: complex.<float64> = 4i; String(Reflect.typeOf(c));')).toBe('complex.<float64>');
});

test('the value is right, not merely the type', () => {
  expect(evaluated('const c: complex128 = 4i; String(c.imaginary);')).toBe('4');
  expect(evaluated('const c: complex128 = 4i; String(c.real);')).toBe('0');
});

test('no context, and the bare complex, are unchanged', () => {
  expect(evaluated('const c: complex = 1 + 2i; String(c);')).toBe('1+2i');
  expect(evaluated('String((1 + 2i) * (3 - 1i));')).toBe('5+5i');
  expect(evaluated('const z = (0 + 1i) ** 2; String(z.real) + "," + String(z.imaginary);')).toBe('-1,0');
});

test('a complex VALUE still converts explicitly, as number and float64 do', () => {
  expectThrown('const a: complex = complex(1,2); const c: complex128 = a;', 'is not assignable to');
  // The explicit forms remain the way across.
  expect(evaluated('String(complex128(1, 2));')).toBe('1+2i');
  expect(evaluated('String((1 + 2i) := complex128);')).toBe('1+2i');
});
