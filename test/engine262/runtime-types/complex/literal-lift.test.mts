import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-literal-propagation, the complex step. A numeric literal in a
 * complex position "takes the complex type, with the literal as its real
 * component and zero as its imaginary one", so `let r: complex = 5` is
 * `complex(5, 0)`.
 *
 * A real VALUE does not convert: `z + x` for a complex `z` and a `number` `x`
 * is a TypeError, which is the no-implicit-widening rule that holds between any
 * two numeric types here.
 */

const parts = (src: string) => `${src} String(z.real) + "," + String(z.imaginary);`;

test('complex lift: a literal in a declaration', () => {
  expect(evaluated(parts('let z: complex = 5;'))).toBe('5,0');
  expect(evaluated(parts('let z: complex = 0;'))).toBe('0,0');
  expect(evaluated(parts('let z: complex = -3;'))).toBe('-3,0');
  expect(evaluated(parts('let z: complex = 2.5;'))).toBe('2.5,0');
  // the Mandelbrot example's first line, which this is what unblocks
  expect(evaluated('function escapeTime(c: complex, limit: uint32): uint32 {'
    + ' let z: complex = 0; return 0; } String(escapeTime(complex(0, 0), 10));')).toBe('0');
});

test('complex lift: a literal beside a complex operand', () => {
  expect(evaluated(parts('const z = complex(1, 2) + 3;'))).toBe('4,2');
  expect(evaluated(parts('const z = complex(1, 2) * 2;'))).toBe('2,4');
  // an imaginary literal forces the real literal beside it onto the real axis
  expect(evaluated(parts('let z: complex = 3 + 4i;'))).toBe('3,4');
  // and the literal may be on either side
  expect(evaluated(parts('const z = 3 + complex(1, 2);'))).toBe('4,2');
});

test('complex lift: the component type decides representability', () => {
  // the literal's representability is the COMPONENT's, inherited rather than
  // stated: a literal no `float32` holds is no `complex.<float32>` either
  expect(evaluated('type C = complex.<float32>; let z: C = 5; String(z.real);')).toBe('5');
  expectThrown('type C = complex.<float32>; let z: C = 1e300;');
  expect(evaluated('type C = complex.<float64>; let z: C = 1e300; String(z.real);')).toBe('1e+300');
  expect(evaluated('type C = complex.<number>; let z: C = 5; String(z.real);')).toBe('5');
});

test('complex lift: a real VALUE is not a literal', () => {
  // `let`, not `const`: an unannotated `const` with a constant initializer is a
  // literal for this rule and would propagate
  expectThrown('const z = complex(1, 2); let x = 3; z + x;');
  expectThrown('function f() { return 3; } const z = complex(1, 2); z + f();');
});

test('complex lift: the other numeric types are unaffected', () => {
  expect(evaluated('let f: float32 = 5; String(f);')).toBe('5');
  expect(evaluated('let a: uint8 = 5; String(a);')).toBe('5');
  expectThrown('function big() { return 300; } let a: uint8 = big();');
});
