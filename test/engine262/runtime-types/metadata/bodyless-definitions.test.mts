import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

/**
 * #sec-primitive-operator-blocks: "any number of definitions without a body
 * may match, each contributing its own meta type's portion of the result
 * through its return type; where no definition with a body matches, the
 * primitive operation runs". The design's metadata blocks (NumberBounds,
 * Dimensions, and the dimensioned vectors) are built of such definitions,
 * and neither the run time nor the checker applied them: registration skipped
 * a definition without a body, and a result kept the operand's metadata.
 */

const D = `type D = { m: int32 };
meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }
primitive float32<const X: D> { operator float32.<X>() { return this; } }
const a: float32.<{ m: 1 }> = 3; const b: float32.<{ m: 1 }> = 4;
`;
const square = 'primitive float32<const X: D> { operator *(rhs: float32.<X>): float32.<{ m: 2 }>; }';

test('the primitive operation computes the value, and the definition its metadata', () => {
  expect(evaluated(`${D} ${square} const c = a * b; String(c) + ' ' + String(Reflect.typeOf(c));`))
    .toBe('12 float32.<{ m: 2 }>');
});

test('the checker types the result as the run time stamps it', () => {
  expect(evaluated(`${D} ${square} const c: float32.<{ m: 2 }> = a * b; String(c);`)).toBe('12');
  expectEarlyError(`${D} ${square} const c: float32.<{ m: 1 }> = a * b;`, 'StaticTypeError');
});

test('an operator no definition speaks for keeps the operand type', () => {
  expect(evaluated(`${D} ${square} const c = a + b; String(Reflect.typeOf(c));`)).toBe('float32.<{ m: 1 }>');
  expect(evaluated(`${D} const c = a * b; String(Reflect.typeOf(c));`)).toBe('float32.<{ m: 1 }>');
});
