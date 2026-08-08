import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * proposal-runtime-types sec-function-declarations: "A function declaration may
 * carry `where` clauses, the WhereClauses of sec-where-clauses, between its
 * return annotation and its body. On an ordinary function they are the
 * compile-time bound over its generic parameters."
 *
 * And sec-where-clauses: "a compile-time-evaluable Boolean expression over its
 * parameters, checked at each specialization once its parameters are bound.
 * Where the expression is false for an application's bindings, that application
 * is a type error."
 *
 * The clause was implemented for dependent record types and nowhere else, so
 * this form - the one sec-bounds-checks names, and the one README's own
 * `where U <= Unit.Hour` uses - was a Syntax Error.
 */

test('a function declaration may carry where clauses', () => {
  expect(evaluated('function t<U: uint32>(x: uint32): uint32 where U < 4 { return x; } String(Number(t.<2>(7)));')).toBe('7');
  // README's own example, which could not be written before.
  expect(evaluated('enum Unit: string { Second = "second", Hour = "hour", Day = "day" }; function total<U: Unit>(u: U): float64 where U <= Unit.Hour { return 1.0; } "ok";')).toBe('ok');
  // More than one clause, all of which must hold.
  expect(evaluated('function t<U: uint32>(x: uint32): uint32 where U < 8 where U > 2 { return x; } String(Number(t.<4>(7)));')).toBe('7');
});

test('a where clause is checked at each specialization', () => {
  // "Where the expression is false for an application's bindings, that
  // application is a type error." Parsing the clause without checking it would
  // let the constraint be written and silently ignored, which is worse than the
  // Syntax Error it replaced.
  expectThrownKind('function t<U: uint32>(x: uint32): uint32 where U < 4 { return x; } t.<9>(7);', 'TypeError');
  // The boundary: `U < 4` excludes 4.
  expectThrownKind('function t<U: uint32>(x: uint32): uint32 where U < 4 { return x; } t.<4>(7);', 'TypeError');
  // One clause failing is enough.
  expectThrownKind('function t<U: uint32>(x: uint32): uint32 where U < 8 where U > 2 { return x; } t.<1>(7);', 'TypeError');
});

test('functions without where clauses are unaffected', () => {
  expect(evaluated('function t<U: uint32>(x: uint32): uint32 { return x; } String(Number(t.<9>(7)));')).toBe('7');
  expect(evaluated('function f(x) { return x + 1; } String(f(1));')).toBe('2');
  // The dependent-record-type form, which already worked, still does.
  expect(evaluated('type R = { a?: uint32, b?: uint32 } where (this.a != null) == (this.b != null); "ok";')).toBe('ok');
});
