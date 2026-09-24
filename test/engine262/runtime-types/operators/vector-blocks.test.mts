import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * #sec-primitive-operator-blocks over `vector`: the design's dimensioned-vector
 * block (primitivemetadata.md) is
 * `primitive vector<float32.<const D: Dimensions>, const N: uint32> { ... }`.
 * Its component list is a specialization list over `vector`'s own parameters,
 * matched against the receiver's lane type and count by the specialization
 * matcher: D binds the lanes' metadata and N the lane count. Vector operators
 * went straight to the lane-wise operation, so no block was ever consulted.
 */

const D = `type Dim = { m: int32 };
meta Dim { default = { m: 0 }; subtype(a: Dim, b: Dim): boolean { return a.m === b.m; } }
primitive float32<const X: Dim> { operator float32.<X>() { return this; } }
type V = vector.<float32.<{ m: 1 }>, 4>;
const a: V = V(1, 2, 3, 4);
`;

test('a block binds its component captures by matching the receiver', () => {
  expect(evaluated(`${D} primitive vector<float32.<const D: Dim>, const N: uint32> {
      operator *(rhs: string): string { return 'N=' + String(N); } }
    String(a * 'x');`)).toBe('N=4');
});

test('a vector the pattern does not match is not spoken for', () => {
  // Dimensionless lanes do not match `float32.<const D: Dim>`: the lane-wise
  // operation runs as it always has.
  expect(evaluated(`${D} primitive vector<float32.<const D: Dim>, const N: uint32> {
      operator *(rhs: string): string { return 'matched'; } }
    String(float32x4(1, 2, 3, 4) * 'x');`)).toBe('(NaN, NaN, NaN, NaN)');
});

test('a bodyless definition gives the lane-wise result its type, lanes included', () => {
  const block = `primitive vector<float32.<const D: Dim>, const N: uint32> {
    operator +(rhs: vector.<float32.<D>, N>): vector.<float32.<{ m: 5 }>, N>; }`;
  expect(evaluated(`${D} ${block} const c = a + a;
    String(c) + ' ' + String(Reflect.typeOf(c)) + ' ' + String(Reflect.typeOf(c.x));`))
    .toBe('(2, 4, 6, 8) vector.<float32.<{ m: 5 }>, 4> float32.<{ m: 5 }>');
  // Without a block the lane-wise result keeps the operand type.
  expect(evaluated(`${D} const c = a + a; String(Reflect.typeOf(c));`)).toBe('vector.<float32.<{ m: 1 }>, 4>');
});

test("the component list admits the design's shapes and refuses others as unsupported", () => {
  // `uint` declares a parameter, so `uint.<...>` is not a metadata position.
  expectThrown('primitive vector<uint.<const W>, const N: uint32> {}', 'not supported yet');
});
