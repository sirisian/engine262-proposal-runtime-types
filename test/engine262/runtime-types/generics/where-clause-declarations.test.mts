import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5 of the early-error survey, the where clause at its declaration.
 *
 * #sec-where-clauses: "It is an early error for a RefinementPredicate not to
 * be compile-time evaluable as a function of this"; #sec-generic-where refuses
 * a predicate that reads ambient mutable state or mutates through a helper,
 * and requires evaluability "independent of whether an application is
 * present". The screen ran only for a specialization predicate; a predicate
 * over a parameter, this or return could read a let, run a side effect at
 * every boundary, or name a binding declared nowhere. A result contract on a
 * void function constrains a result the function declares it has none of.
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule, phase: 'static' } });
};

test('a name declared nowhere is refused in every where form', () => {
  refused('function f<N: uint32>() where M > 0 { return N; }', 'rt-compile-time-evaluability');
  refused('function g(i: uint32) where j > 10 { return i; }', 'rt-compile-time-evaluability');
  refused('type Pos = { a: uint8 } where a > 0; let p: Pos = { a: 1 };', 'rt-compile-time-evaluability');
});

test('a side effect, a store to the subject, or a mutable read is refused on a runtime-subject predicate', () => {
  refused('let seen = 0; function f(i: uint32) where (seen++, i > 10) { return i; } f(20);', 'rt-compile-time-evaluability');
  refused('type Pos = { a: uint8 } where this.a++ > 0; let p: Pos = { a: 1 };', 'rt-compile-time-evaluability');
  refused('type Q = { a: uint8 } where (this.a = 1, true); let q: Q = { a: 1 };', 'rt-compile-time-evaluability');
  refused('let limit = 0; type Pos = { a: uint8 } where this.a > limit; let p: Pos = { a: 1 };', 'rt-compile-time-evaluability');
  refused('let limit = 10; function f(i: uint32) where i > limit { return i; } f(20);', 'rt-compile-time-evaluability');
});

test('a result contract on a void function is refused', () => {
  refused('function g(): void where return > 10 {} g();', 'rt-return-contract');
});

test('admissible predicates are unchanged', () => {
  expect(evaluated('function f(i: uint32) where i > 10 { return i; } String(f(11));')).toBe('11');
  expect(evaluated('const limit: uint8 = 0; type Q = { a: uint8 } where this.a > limit; let q: Q = { a: 1 }; String(q.a);')).toBe('1');
  expect(evaluated('type D = { c: "A" | "B" } where if (this.c == "A") { this is { p: string } } else { this is { q: string } }; let d: D = { c: "A", p: "s" }; "ok";')).toBe('ok');
  expect(evaluated('function h(i: uint32): uint32 where return > i { return i + 1; } String(h(5));')).toBe('6');
  expect(evaluated('function m(): uint32 where return > 10 { return 20; } String(m());')).toBe('20');
  expect(evaluated('function f<N: uint32 = 1>() where N > 0 { return N; } String(f());')).toBe('1');
});
