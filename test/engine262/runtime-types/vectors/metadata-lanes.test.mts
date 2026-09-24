import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * #sec-vector-types, #sec-primitive-metadata: a parameterization of a lane type
 * is a lane type, so a vector's lanes can carry metadata - a vector of meters,
 * `vector.<float32.<{ m: 1 }>, 3>`, with the representation of
 * `vector.<float32, 3>`. The design's dimensioned vectors
 * (primitivemetadata.md, `primitive vector<float32.<const D: Dimensions>,
 * const N: uint32>`) are written this way, and it was refused: "not a valid
 * vector lane type".
 */

const D = `type D = { m: int32 };
meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }
primitive float32<const X: D> { operator float32.<X>() { return this; } }
type V = vector.<float32.<{ m: 1 }>, 4>;
`;

test('a parameterized lane type forms a vector type', () => {
  expect(evaluated(`${D} String(V);`)).toBe('vector.<float32.<{ m: 1 }>, 4>');
});

test('the lanes carry the metadata: construction, access, and arithmetic', () => {
  expect(evaluated(`${D} const v: V = V(1, 2, 3, 4); String(v) + ' ' + String(Reflect.typeOf(v));`))
    .toBe('(1, 2, 3, 4) vector.<float32.<{ m: 1 }>, 4>');
  expect(evaluated(`${D} const v: V = V(1, 2, 3, 4); String(Reflect.typeOf(v.x)) + ' ' + String(v.x);`))
    .toBe('float32.<{ m: 1 }> 1');
  // As for a scalar of one parameterized type, the built-in arithmetic keeps it.
  expect(evaluated(`${D} const a: V = V(1, 2, 3, 4); const c = a + a; String(c) + ' ' + String(Reflect.typeOf(c));`))
    .toBe('(2, 4, 6, 8) vector.<float32.<{ m: 1 }>, 4>');
});

test('a lane enters a parameterization as a scalar does: through a declared cast', () => {
  const noCast = `type D = { m: int32 };
    meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }
    type V = vector.<float32.<{ m: 1 }>, 4>;`;
  expectThrown(`${noCast} V(1, 2, 3, 4);`, 'is not assignable to "float32.<{ m: 1 }>"');
});

test('a vector of a parameterized lane widens to the vector of its base, and not back', () => {
  // As a meter is where a float32 is expected.
  expect(evaluated(`${D} const a: V = V(1, 2, 3, 4); const w: float32x4 = a; String(w);`)).toBe('(1, 2, 3, 4)');
  expectEarlyError(`${D} const f: float32x4 = float32x4(1, 2, 3, 4); const v: V = f;`, 'StaticTypeError');
  // Numeric lane widening changes the representation and is still refused.
  expectEarlyError('const a: uint8x16 = uint8x16(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16); const b: vector.<uint16, 16> = a;', 'StaticTypeError');
});
