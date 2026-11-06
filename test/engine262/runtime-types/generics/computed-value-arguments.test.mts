import { test, expect } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

// #sec-type-references: a computed value argument is written as a builder
// call, evaluated once its parameters are bound, and for a value parameter
// its result is the argument; a name in that position is a type reference
// unless it names a value generic parameter.

test('a builder call supplies a value parameter its computed value', () => {
  expect(evaluated('function Inc(n: uint32): uint32 { return n + 1; } function g<N: uint32>(): string { return String(N); } g.<Inc(150)>();')).toBe('151');
});

test('a computed value outside the parameter domain is refused', () => {
  expect(observeScript('function Big(): uint32 { return 300; } function g<N: uint8>(): string { return String(N); } g.<Big()>();').completion.Type).toBe('throw');
});

test('a builder call still supplies a type parameter its type', () => {
  expect(evaluated("function T(): type { return uint8; } function h<U: type>(): string { return 'ok'; } h.<T()>();")).toBe('ok');
});

test('a constant name in the argument position is a type reference', () => {
  expect(observeScript('const K: uint32 = 151; function g<N: uint32>(): string { return String(N); } g.<K>();').completion.Type).toBe('throw');
});
