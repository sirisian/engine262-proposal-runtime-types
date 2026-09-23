import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-natural-alignment and #sec-layout-control.
 *
 * "It is a type error for a field to be placed outside the size a `size`
 * fixes." A control's argument is a numeric literal, so the placement is known
 * where the class is written. The run time computed it when the class was
 * evaluated and threw there; the checker now runs the same layout computation
 * over the resolved field types, and the run-time check stays behind it for a
 * class the checker cannot lay out.
 */

test('a field past the declared size is refused before the program runs', () => {
  expectStaticTypeError('@size(2) class A { x: float64 = 0; }');
  expectStaticTypeError('@size(4) class B { a: uint8 = 0; @offset(4) b: uint8 = 0; }');
  // A base class's fields count toward the subclass's size.
  expectStaticTypeError('class E { x: float64 = 0; } @size(8) class F extends E { y: uint8 = 0; }');
});

test('a layout that fits is unchanged', () => {
  expect(evaluated('@size(8) class C { x: float64 = 0; } String((type C).byteLength);')).toBe('8');
  expect(evaluated('@size(16) class D { x: float64 = 0; } String((type D).byteLength);')).toBe('16');
  expect(evaluated('@packed @size(3) class K { a: uint8 = 0; b: uint16 = 0; } String((type K).byteLength);')).toBe('3');
});

test('what the checker cannot read is still the run time\'s', () => {
  // A named constant is not a literal, and is refused where it was before.
  expectThrownKind('const N = 2; @size(N) class J { x: float64 = 0; }', 'TypeError');
  // An untyped field gives the class no layout for a size to bound.
  expect(evaluated('@size(1) class H { x = 0; } "ok";')).toBe('ok');
});
