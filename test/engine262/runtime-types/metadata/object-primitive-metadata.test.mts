import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * #sec-primitive-metadata for the primitives represented as OBJECTS: `complex`
 * and `rational` carried their component but not their metadata, so a value
 * that crossed into `complex.<float64>.<{ phase: 1 }>` reported
 * `complex.<float64>`, and a block's metadata capture had nothing to bind
 * from a complex receiver. A crossing now makes a fresh value carrying the
 * parameterization, as a typed number is rewrapped, and leaves the value it
 * was given as it was.
 */

const P = `type P = { phase: int32 };
meta P { default = { phase: 0 }; subtype(a: P, b: P): boolean { return a.phase === b.phase; } }
primitive complex<const E><const T: P> { operator complex.<E>.<T>() { return this; } }
type Ph = complex.<float64>.<{ phase: 1 }>;
`;
const U = `type U = { unit: int32 };
meta U { default = { unit: 0 }; subtype(a: U, b: U): boolean { return true; } }
primitive rational<const W><const T: U> { operator rational.<W>.<T>() { return this; } }
`;

test('a crossing carries the parameterization on a fresh value', () => {
  expect(evaluated(`${P}const c: complex128 = 1 + 2i; const p: Ph = c;
    String(Reflect.typeOf(p)) + ' / ' + String(Reflect.typeOf(c));`)).toBe('complex.<float64>.<{ phase: 1 }> / complex.<float64>');
  expect(evaluated(`${U}const r: rational = 1 / 3; const p: rational.<64>.<{ unit: 1 }> = r;
    String(Reflect.typeOf(p)) + ' / ' + String(Reflect.typeOf(r));`)).toBe('rational.<{ unit: 1 }> / rational');
});

test('membership reads the carried metadata', () => {
  expect(evaluated(`${P}const a: Ph = (1 + 2i := complex128); String(a is Ph) + ' ' + String((1 + 2i) is Ph);`)).toBe('true false');
});

test('a block binds its metadata capture from a complex receiver, and stamps the result', () => {
  expect(evaluated(`${P}primitive complex<const E><const T: P> {
      operator +(rhs: complex.<E>.<T>): complex.<E>.<T> { return this + rhs; }
    }
    const a: Ph = (1 + 2i := complex128); const b: Ph = (3 + 4i := complex128);
    const s = a + b; String(s) + ' ' + String(Reflect.typeOf(s));`)).toBe('4+6i complex.<float64>.<{ phase: 1 }>');
});

test('a value of a family represented as an object is not a type', () => {
  // Its carried [[TypeRecord]] made `isTypeObject` take it for one, while the
  // same annotation over a `uint8` value was refused.
  expectThrown('const r: rational = 1 / 3; let v: r = 2;', '"r" is not a type');
  expectThrown('const d: decimal128 = 1.5; let v: d = 2;', '"d" is not a type');
});
