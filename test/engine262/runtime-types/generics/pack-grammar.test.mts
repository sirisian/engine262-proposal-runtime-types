// The grammar of variadic parameters, spread arguments, generic function types,
// call
// signatures, and `ref` on rests - what PARSES and which early errors fire
// (spec.emu #sec-type-parameters, #sec-type-references, #sec-function-types,
// #sec-object-types). Binding a pack at an application is covered elsewhere;
// this file applies nothing variadic.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

test('a variadic parameter parses with a collection-typed constraint (A1, A2)', () => {
  expect(evaluated('function swizzle<...I: [].<uint32>>(): uint32 { return 1; } "ok";')).toBe('ok');
  expect(evaluated('class Q { each<...Cs extends [].<any>>(): void {} } "ok";')).toBe('ok');
  expect(evaluated('function lanes<...I: [4].<uint8>>(): uint32 { return 4; } "ok";')).toBe('ok');
});

test('per run: a pack counts as defaulted and restarts the run', () => {
  expect(evaluated('function f<T = uint8, ...I: [].<uint32>>(): uint32 { return 1; } "ok";')).toBe('ok');
  expect(evaluated('function g<...I: [].<uint32>, N: uint32>(): uint32 { return N; } "ok";')).toBe('ok');
  expectThrown('function h<...I: [].<uint32>, T = uint8, N: uint32>(): uint32 { return N; }');
  expectThrown('function k<T = uint8, N: uint32>(): uint32 { return N; }');   // the plain rule, unchanged
});

test('the syntactic half: adjacent packs where the first is unconstrained', () => {
  expectThrown('function f<...A, ...B>() {}', 'nothing typed');
  expect(evaluated('function g<...A: [].<uint32>, ...B: [].<string>>(): uint32 { return 1; } "ok";')).toBe('ok');
  expect(evaluated('function h<...A: [].<uint32>, ...B: [].<uint32>>(): uint32 { return 1; } "ok";')).toBe('ok');   // same bound: admitted
});

test('a variance modifier precedes the pack marker', () => {
  expect(evaluated('interface Tup<out ...Ts extends [].<any>> {} "ok";')).toBe('ok');
});

test('a generic function type parses and resolves its own parameters', () => {
  expect(evaluated('type Id = <T>(x: T) => T; "ok";')).toBe('ok');
  expect(evaluated('type Bounded = <T extends Event>(e: T) => void; "ok";')).toBe('ok');
  // (a `let` with a function-type annotation needs an initializer - a pre-existing rule - so the forms are aliases)
  expect(evaluated('type G = { g: <T>(x: T) => T }; "ok";')).toBe('ok');
});

test('an object type of call signatures is the function type they form', () => {
  expect(evaluated('let g: { (uint32): uint32 } = (x: uint32): uint32 => x; String(g(2));')).toBe('2');
  expect(evaluated('type Two = { (uint32): uint32; (string): string }; "ok";')).toBe('ok');
  expect(evaluated('type Gen = { <T>(x: T): T }; "ok";')).toBe('ok');
  expectThrown('type Mixed = { (uint32): uint32; name: string };', 'do not mix');
});

test('`ref` distributes over a rest in function types and declarations', () => {
  expect(evaluated('type Each = (e: uint32, ref ...rs: [].<uint32>) => void; "ok";')).toBe('ok');
  expect(evaluated('type Cb = (ref ...[].<uint32>) => void; "ok";')).toBe('ok');
  expect(evaluated('function f(ref ...xs: [].<uint32>) {} "declared";')).toBe('declared');   // binding semantics are covered elsewhere
});

test('a spread type argument parses', () => {
  expect(evaluated('type Pair = [0, 1]; function s<...I: [].<uint32>>(): uint32 { return 1; } function u() { return s.<...Pair>(); } "ok";')).toBe('ok');
});

