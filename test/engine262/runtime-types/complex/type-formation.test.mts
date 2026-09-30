import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-complex-types and #sec-narrowing.
 *
 * `complex.<T>` is a value type whose components are values of a real numeric type
 * `T`: `number` or one of the binary floating-point types. Any other component type
 * does not form a type, and the width-named shorthands are the applications
 * (`complex64` is `complex.<float32>`).
 *
 * A complex is not one of the existing language types, so `typeof` cannot separate it
 * from other objects and `instanceof` is the form that narrows a union containing one.
 */

test('the component type is number or a binary floating-point type', () => {
  expect(evaluated('type T = complex.<number>; "formed";')).toBe('formed');
  expect(evaluated('type T = complex.<float16>; "formed";')).toBe('formed');
  expect(evaluated('type T = complex.<float32>; String(T === complex64);')).toBe('true');
  expect(evaluated('type T = complex.<float64>; String(T === complex128);')).toBe('true');
});

test('any other component type is refused', () => {
  for (const component of ['uint8', 'int32', 'bigint', 'decimal64', 'rational64', 'string']) {
    expectThrown(`type T = complex.<${component}>; "formed";`, 'valid complex component type');
  }
});

test('instanceof narrows a union containing a complex', () => {
  // The function type-checks only because each branch is narrowed: the first returns a
  // number for the complex arm, the second returns the remaining `uint8` as a `uint8`.
  expect(evaluated(`
    function f(v: uint8 | complex): uint8 { if (v instanceof complex) { return 0; } return v; }
    String(f(complex(1, 2))) + '/' + String(f(7 := uint8));
  `)).toBe('0/7');
  expect(evaluated(`
    function f(v: uint8 | complex): complex { if (v instanceof complex) { return v; } return complex(0, 0); }
    String(f(complex(1, 2)));
  `)).toBe('1+2i');
});

test('without the instanceof test the same union is not assignable to either arm', () => {
  // The control for the test above: it is the narrowing that makes those functions valid.
  expectStaticTypeError('function f(v: uint8 | complex): uint8 { return v; }');
  expectStaticTypeError('function f(v: uint8 | complex): complex { return v; }');
});

// #sec-narrowing: `typeof` "reports "object" for the SIMD, rational, and complex
// types", so a `typeof v === "object"` test on a union containing one has a branch
// that is taken for the complex arm. `typeof` at run time does say "object".
test('typeof reports "object" for a complex at run time', () => {
  expect(evaluated('String(typeof complex(1, 2));')).toBe('object');
});

// A complex value is an Object, so a `typeof` "object" test on a union containing one
// can succeed, and #sec-narrowfrom does not report it (the same holds for a rational
// and a SIMD vector).
test('a typeof "object" test on a union containing a complex guards a live branch', () => {
  expect(evaluated(`
    function f(v: uint8 | complex) { if (typeof v === "object") { return 1; } return 0; }
    String(f(complex(1, 2)));
  `)).toBe('1');
});
