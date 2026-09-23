import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-structure-of-arrays.
 *
 * "_T_ must be a value type class or a primitive ... a class with a field of
 * no layout has nothing to split and is a type error." The application was
 * accepted: the column split reads the evaluated class's layout, which a class
 * in the same source text does not have while the checker runs, so the failure
 * surfaced at `byteLength`, or as "has no default value".
 */

test('a field of no layout refuses the application', () => {
  expectStaticTypeError('class D2 { n: uint8 = 0; o: object = {}; } type S = SoA.<D2, 4>;');
  expectStaticTypeError('class D { s: string = ""; } let q: SoA.<D> | null = null;');
  expectStaticTypeError('class U { n: uint8 = 0; m = 1; } type S = SoA.<U, 4>;');
  // Through a base class and through a nested class.
  expectStaticTypeError('class B { s: string = ""; } class C extends B { n: uint8 = 0; } type S = SoA.<C, 2>;');
  expectStaticTypeError('class In { s: string = ""; } class Out { i: In = new In(); } type S = SoA.<Out, 2>;');
  // At a construction as at an annotation.
  expectStaticTypeError('class D { s: string = ""; } new SoA.<D, 4>();');
});

test('value type classes and primitives split as before', () => {
  expect(evaluated('class P { x: float32 = 0; y: float32 = 0; } String((type SoA.<P, 4>).byteLength);')).toBe('32');
  expect(evaluated('class V { x: float32 = 0; } class W { v: V = new V(); n: uint8 = 0; } type S = SoA.<W, 2>; "ok";')).toBe('ok');
  expect(evaluated('type S = SoA.<uint8, 4>; String((type S).byteLength);')).toBe('4');
});
