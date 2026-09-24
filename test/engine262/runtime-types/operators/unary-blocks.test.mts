import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * #sec-primitive-operator-blocks for unary `-`: a block's `operator-()` speaks
 * for its receiver before the primitive negation, as its binary operators do.
 * Unary definitions were registered and never looked up - the design's
 * dimensioned vector declares `operator-(): vector.<float32.<D>, N>;` - and a
 * bodyless one was not registered at all.
 */

const D = `type Dim = { m: int32 };
meta Dim { default = { m: 0 }; subtype(a: Dim, b: Dim): boolean { return a.m === b.m; } }
primitive float32<const X: Dim> { operator float32.<X>() { return this; } }
const s: float32.<{ m: 1 }> = 3;
type V = vector.<float32.<{ m: 1 }>, 4>;
const a: V = V(1, 2, 3, 4);
`;

test('a unary definition with a body runs, typed by its return type', () => {
  expect(evaluated(`${D} primitive float32<const X: Dim> { operator -(): string { return 'neg'; } } const r: string = -s; r;`)).toBe('neg');
  expect(evaluated(`${D} primitive vector<float32.<const D: Dim>, const N: uint32> { operator -(): string { return 'n' + String(N); } } String(-a);`)).toBe('n4');
});

test('a bodyless unary definition gives the primitive negation its type', () => {
  const block = `primitive float32<const X: Dim> { operator -(): float32.<{ m: 7 }>; }`;
  expect(evaluated(`${D} ${block} const r: float32.<{ m: 7 }> = -s; String(r) + ' ' + String(Reflect.typeOf(-s));`)).toBe('-3 float32.<{ m: 7 }>');
  expectEarlyError(`${D} ${block} const r: float32.<{ m: 1 }> = -s;`, 'StaticTypeError');
  // The design's dimensioned-vector form keeps the receiver's own type.
  expect(evaluated(`${D} primitive vector<float32.<const D: Dim>, const N: uint32> { operator -(): vector.<float32.<D>, N>; }
    const r: V = -a; String(r);`)).toBe('(-1, -2, -3, -4)');
});

test('a block capturing no metadata may not redeclare unary minus', () => {
  expectThrown(`primitive float64 { operator -(): string { return 'r'; } }`, 'redeclares an operation the type already defines');
  // Without a block, negation is unchanged.
  expect(evaluated(`${D} String(-s) + ' ' + String(-a);`)).toBe('-3 (-1, -2, -3, -4)');
});
