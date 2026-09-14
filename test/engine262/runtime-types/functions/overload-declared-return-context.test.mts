import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// #sec-published-return-types: inferred returns type a selected result, but do
// not participate in viability or replace an absent declared return.
const declarations = 'function f(x: uint8) { return x; } function f(x: string) { return x; }';

test('a contextual result selects a disjoint overload without a declared return', () => {
  expect(evaluated(`${declarations} const n: uint8 = f(1); String(n);`)).toBe('1');
  expect(ok(`${declarations} function unused() { const n: uint8 = f(1); }`)).toBe(true);
});

test('the selected inferred result is checked at its actual destination', () => {
  expectStaticTypeError(`${declarations} function unused() { const n: uint8 = f("s"); }`);
});

test('explicit returns and calls without result context still select normally', () => {
  expect(evaluated(`${declarations} String(f(1));`)).toBe('1');
  expect(evaluated('function f(x: uint8): uint8 { return x; } function f(x: string): string { return x; } const n: uint8 = f(1); String(n);')).toBe('1');
});
