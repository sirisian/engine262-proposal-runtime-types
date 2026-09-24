import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * #sec-primitive-operator-blocks: an operator's own metadata parameter,
 * `operator *.<Y: Dim>(rhs: float32.<Y>)`, lets a Dimensions block combine two
 * DIFFERENT dimensions, with a result computed by a builder - the design's
 * `operator*.<D2: Dimensions>(rhs: float32.<D2>): vector.<float32.<multiplyDimensions(D, D2)>, N>;`.
 */

const M = `type Dim = { m: int32 };
meta Dim { default = { m: 0 }; subtype(a: Dim, b: Dim): boolean { return a.m === b.m; } }
primitive float32<const X: Dim> { operator float32.<X>() { return this; } }
function mul(a: Dim, b: Dim): Dim { return { m: a.m + b.m }; }
const a: float32.<{ m: 1 }> = 3; const b: float32.<{ m: 2 }> = 4;
`;

test('the primitive operation computes the value of operands with different metadata', () => {
  // "the primitive operation runs" on the values, whose metadata the bodyless
  // definition supplies; it refused the two as different numeric types.
  const block = 'primitive float32<const X: Dim> { operator *.<Y: Dim>(rhs: float32.<Y>): float32.<{ m: 9 }>; }';
  expect(evaluated(`${M} ${block} const c: float32.<{ m: 9 }> = a * b; String(c) + ' ' + String(Reflect.typeOf(c));`)).toBe('12 float32.<{ m: 9 }>');
  // The checker admits the pair through the operator's parameter, and types it.
  expectEarlyError(`${M} ${block} const c: float32.<{ m: 1 }> = a * b;`, 'StaticTypeError');
  // With no definition for the pair, the two still do not mix.
  expectThrown(`${M} a * b;`, 'are different numeric types and do not mix');
});

test('a metadata value parameter reads as its metadata object', () => {
  expect(evaluated(`${M} primitive float32<const X: Dim> { operator *(rhs: string): string { return String(X.m); } }
    String(a * 'q');`)).toBe('1');
});

test('a builder computes the result metadata from the parameters', () => {
  // The builder receives the metadata objects and returns a Dimensions object,
  // which is the result type's metadata, not a type.
  expect(evaluated(`${M} primitive float32<const X: Dim> { operator *.<Y: Dim>(rhs: float32.<Y>): float32.<mul(X, Y)>; }
    const c = a * b; String(c) + ' ' + String(Reflect.typeOf(c));`)).toBe('12 float32.<{ m: 3 }>');
});

test('a computed metadata argument is the metadata of the type, in any annotation', () => {
  expect(evaluated(`${M} type T = float32.<mul({ m: 2 }, { m: 3 })>; String(T);`)).toBe('float32.<{ m: 5 }>');
  expect(evaluated(`${M} const v: float32.<mul({ m: 2 }, { m: 3 })> = 7; String(Reflect.typeOf(v));`)).toBe('float32.<{ m: 5 }>');
});

test("an operator parameter binds its own meta type's portion of an operand carrying others", () => {
  // `Y: Dim` over a value that also carries bounds binds its Dim portion, as a
  // block capture does; it bound the whole metadata, and the operand - judged
  // only by Dim - was then refused at the body's parameter boundary.
  const two = `${M} type B = { lo: int32 };
    meta B { default = { lo: 0 }; subtype(a: B, b: B): boolean { return a.lo === b.lo; } }
    primitive float32<const Z: B> { operator float32.<Z>() { return this; } }
    function keys(o: object): string { return Object.keys(o).join(','); }
    const c1: float32.<{ m: 2, lo: 5 }> = 4;`;
  expect(evaluated(`${two} primitive float32<const X: Dim> { operator *.<Y: Dim>(rhs: float32.<Y>): float32.<mul(X, Y)>; }
    String(Reflect.typeOf(a * c1));`)).toBe('float32.<{ m: 3 }>');
  expect(evaluated(`${two} primitive float32<const X: Dim> { operator *.<Y: Dim>(rhs: float32.<Y>): string { return keys(Y) + '=' + String(Y.m); } }
    const s: string = a * c1; s;`)).toBe('m=2');
});
