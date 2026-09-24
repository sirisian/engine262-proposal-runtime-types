import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-primitive-operator-blocks: an operator's own metadata parameter,
 * `operator *.<Y: Dim>(rhs: float32.<Y>)`, lets a Dimensions block combine two
 * DIFFERENT dimensions - the design's `operator*.<D2: Dimensions>`. The run
 * time is reached through `any` here; the checker's side is not yet in place.
 */

const M = `type Dim = { m: int32 };
meta Dim { default = { m: 0 }; subtype(a: Dim, b: Dim): boolean { return a.m === b.m; } }
primitive float32<const X: Dim> { operator float32.<X>() { return this; } }
const a: float32.<{ m: 1 }> = 3; const b: float32.<{ m: 2 }> = 4; const x: any = a;
`;

test('the primitive operation computes the value of operands with different metadata', () => {
  // "the primitive operation runs" on the values, whose metadata the bodyless
  // definition supplies; it refused the two as different numeric types.
  expect(evaluated(`${M} primitive float32<const X: Dim> { operator *.<Y: Dim>(rhs: float32.<Y>): float32.<{ m: 9 }>; }
    const c = x * b; String(c) + ' ' + String(Reflect.typeOf(c));`)).toBe('12 float32.<{ m: 9 }>');
});

test('a metadata value parameter reads as its metadata object', () => {
  // `const X: Dim` is a value parameter: an expression reads it as the
  // metadata object, not as a Type Object.
  expect(evaluated(`${M} primitive float32<const X: Dim> { operator *(rhs: string): string { return String(X.m); } }
    String(x * 'q');`)).toBe('1');
});
