import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-complex-numbers, #sec-imaginary-literals and #sec-literal-types.
 *
 * AN IMAGINARY LITERAL TAKES ITS COMPONENT FROM ITS CONTEXT. An imaginary literal
 * has the type `complex`, with the literal's value as its imaginary component and
 * zero as its real one, and literal propagation applies to it as to any numeric
 * literal, so a `4i` in a `complex64` position is a `complex64` and
 * `const c: complex128 = 4i` is accepted.
 *
 * Both halves are needed: the literal must REPORT the contextual type (or the
 * declaration is refused before evaluation) and must be BUILT at its component (or
 * the value that reaches the store has the wrong type).
 *
 * VALUES are not literals and are not adopted: `complex.<number>` and
 * `complex.<float64>` are distinct types that convert explicitly, exactly as
 * `number` and `float64` do.
 */

test('an imaginary literal beside a real one takes its component from context', () => {
  // `1 + 2i` is the spelling #sec-complex-numbers uses throughout its prose. The
  // context has to reach THROUGH the `+` to the imaginary literal, so that `1 + 2i`
  // and the bare `4i` take their component the same way and the two spellings of one
  // value agree.
  expect(evaluated('const c: complex128 = 1 + 2i; String(c);')).toBe('1+2i');
  expect(evaluated('const c: complex128 = 1 + 2i; String(Reflect.typeOf(c));')).toBe('complex128');
  expect(evaluated('const c: complex64 = 1 + 2i; String(Reflect.typeOf(c));')).toBe('complex64');
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
  expect(evaluated('const c: complex128 = 4i; String(Reflect.typeOf(c));')).toBe('complex128');
  expect(evaluated('const c: complex64 = 4i; String(Reflect.typeOf(c));')).toBe('complex64');
  expect(evaluated('const c: complex.<float64> = 4i; String(Reflect.typeOf(c));')).toBe('complex128');
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

test('a complex with no written component reports complex.<number>', () => {
  // #sec-type-names: `complex` declares the default `T = number`, so the bare name
  // denotes `complex.<number>` - the bare name IS the application. There is
  // therefore no complex without a component, only one whose component was never
  // written down, and such a value reports its type (`complex`) rather than an empty
  // object type.
  expect(evaluated('String(Reflect.typeOf(1 + 2i));')).toBe('complex');
  expect(evaluated('String(Reflect.typeOf(4i));')).toBe('complex');
  expect(evaluated('String(Reflect.typeOf(complex(1, 2)));')).toBe('complex');
});

test('and it is a member of the type it now reports', () => {
  expect(evaluated('String((1 + 2i) is complex);')).toBe('true');
  expect(evaluated('String((1 + 2i) is complex.<number>);')).toBe('true');
  // Still not a member of a width-named one, which is the scalar rule.
  expect(evaluated('String((1 + 2i) is complex128);')).toBe('false');
});
