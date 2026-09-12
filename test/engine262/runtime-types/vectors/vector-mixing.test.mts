import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-vector-types with spec 3149. An operator over two vectors is
 * lane-wise, so it needs one lane type and one lane count; the run time refused
 * the rest as "not assignable to vector.<float32, 4>". Both types are written
 * down, so the judgment is determinable.
 *
 * A vector is not a numeric VALUE type by `isNumericValueTypeName`, so it
 * reached neither the arithmetic mixing rule nor the relational one - the same
 * blind spot the binary floats had, one type over.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const F = 'let a: float32x4 = float32x4(1, 2, 3, 4); ';
const I = 'let b: int32x4 = int32x4(int32(1), int32(2), int32(3), int32(4)); ';
const D = 'let d: float64x2 = float64x2(1, 2); ';

test('two vectors of different LANE TYPE do not mix', () => {
  for (const op of ['+', '-', '*', '/']) {
    expectThrown(dead(`${F}${I}let q = a ${op} b;`), 'do not mix');
  }
  // A comparison is the same mistake; spec 3149 names relational operators
  // beside the arithmetic ones.
  expectThrown(dead(`${F}${I}let q = a < b;`), 'do not mix');
  expectThrown(dead(`${F}${I}let q = a >= b;`), 'do not mix');
});

test('two vectors of different LANE COUNT do not mix', () => {
  expectThrown(dead(`${F}${D}let q = a + d;`), 'do not mix');
  expectThrown(dead(`${F}${D}let q = a < d;`), 'do not mix');
});

test('what the rule does not reach', () => {
  // One type on both sides.
  expect(ok(dead(`${F}let c: float32x4 = float32x4(5, 6, 7, 8); let q = a + c;`))).toBe(true);
  expect(ok(dead(`${I}let c: int32x4 = int32x4(int32(5), int32(6), int32(7), int32(8));`
    + ' let q = b * c;'))).toBe(true);

  // A vector against its own LANE type is a lane-wise operation against a
  // scalar, not a mix of two vector types.
  expect(ok(dead(`${F}let f: float32 = float32(2); let q = a + f;`))).toBe(true);

  // An operand whose type is unknown is not judged.
  expect(ok(dead(`${F}let x: any = a; let q = a + x;`))).toBe(true);
  expect(ok(dead('const c = float32x4(1, 2, 3, 4); const e = float32x4(5, 6, 7, 8); let q = c + e;'))).toBe(true);
});
