// PLAN-variadic-and-named-generic-arguments.md 2.5 / spec.emu #sec-function-types:
// `ref` on a rest parameter DISTRIBUTES over the run it collects, and the run
// binds no array - references are not values. Its name is usable in exactly
// three forms, each a direct use of one collected reference: `refs[k]` (read
// or written through), `refs.length` (a constant), and `...refs` forwarded
// into another call's ref-rest position. Everything else is the escape error a
// single ref parameter has. (The STATIC half - a constant index - is the
// checker's, Phase 6's remainder; at run time an in-range index reads.)
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const AB = 'let a: uint32 = 1; let b: uint32 = 2;';

test('a ref rest collects a run: length and indexed reads', () => {
  expect(evaluated(`function f(ref ...xs: [].<uint32>): uint32 { return xs.length; } ${AB} String(f(ref a, ref b));`)).toBe('2');
  expect(evaluated(`function f(ref ...xs: [].<uint32>): uint32 { return xs[1]; } ${AB} String(f(ref a, ref b));`)).toBe('2');
  expect(evaluated(`function f(ref ...xs: [].<uint32>): uint32 { return xs.length; } String(f());`)).toBe('0');
});

test('an indexed write goes through to the caller\'s location', () => {
  expect(evaluated(`function f(ref ...xs: [].<uint32>): void { xs[0] = 9; } ${AB} f(ref a, ref b); String(a) + "/" + String(b);`)).toBe('9/2');
});

test('`...refs` forwards the run into another ref-rest position', () => {
  expect(evaluated(`function g(ref ...ys: [].<uint32>): void { ys[1] = 7; } function f(ref ...xs: [].<uint32>): void { g(...xs); } ${AB} f(ref a, ref b); String(b);`)).toBe('7');
});

test('a generic ref rest binds its pack from the referents, and a callback takes the run (B.2, F-T)', () => {
  expect(evaluated('function apply2<...Cs>(cb: (ref ...xs: Cs) => void, ref ...xs: Cs): void { cb(...xs); } let a: uint32 = 1; apply2((ref x: uint32) => { x = 5; }, ref a); String(a);')).toBe('5');
  expect(evaluated('function apply2<...Cs>(cb: (ref ...xs: Cs) => void, ref ...xs: Cs): void { cb(...xs); } let a: uint32 = 1; let f: float32 = 2; apply2((ref x: uint32, ref y: float32) => { x = 2; y = 3; }, ref a, ref f); String(a) + "/" + String(f);')).toBe('2/3');
});

test('the second-class rule: a run is never stored, passed whole, or indexed out of range', () => {
  expectThrown(`function f(ref ...xs: [].<uint32>): void { const saved = xs; } ${AB} f(ref a);`, 'binds no array');
  expectThrown(`function f(ref ...xs: [].<uint32>): void { let s; s = xs; } ${AB} f(ref a);`, 'binds no array');
  expectThrown(`function h(z: any): void {} function f(ref ...xs: [].<uint32>): void { h(xs); } ${AB} f(ref a);`, 'binds no array');
  expectThrown(`function f(ref ...xs: [].<uint32>): uint32 { return xs[5]; } ${AB} String(f(ref a));`, 'in range');
  expectThrown(`function f(ref ...xs: [].<uint32>): void { xs.length = 0; } ${AB} f(ref a);`, 'constant');
});

test('a ref rest requires ref arguments', () => {
  expectThrown('function f(ref ...xs: [].<uint32>): void {} f(1, 2);', 'requires a ref argument');
});

test('the static half: a non-constant index, a property, a bare use, and a whole pass are refused before the program runs', () => {
  // These never evaluate the body - the refusal is the checker's.
  expectThrown('function f(ref ...xs: [].<uint32>): uint32 { let i = 0; return xs[i]; }', 'binds no array');
  expectThrown('function f(ref ...xs: [].<uint32>): uint32 { return xs.foo; }', 'binds no array');
  expectThrown('function f(ref ...xs: [].<uint32>): void { const saved = xs; }', 'binds no array');
  expectThrown('function h(z: any): void {} function f(ref ...xs: [].<uint32>): void { h(xs); }', 'binds no array');
  expectThrown('function f(ref ...xs: [].<uint32>): void { let s; s = xs; }', 'binds no array');
});

test('the static half admits the three forms, and a same-named binding elsewhere is not a ref rest', () => {
  expect(evaluated(`function g(ref ...ys: [].<uint32>): uint32 { return ys.length; } function f(ref ...xs: [].<uint32>): string { return String(xs[0]) + "/" + String(xs.length) + "/" + String(g(...xs)); } ${AB} f(ref a, ref b);`)).toBe('1/2/2');
  expect(evaluated('function f(ref ...xs: [].<uint32>): uint32 { return xs.length; } const xs = [1, 2, 3]; String(xs.length);')).toBe('3');
});
