import { test, expect } from 'vitest';
import {
  evaluated, expectThrown, expectThrownKind, expectErrorFlagOff,
} from '../harness.mts';

/**
 * Extension coverage - dependentrecordtypes.md, `where` clauses.
 *
 * A record type may carry `where` clauses stating cross-field dependencies. A
 * value is of the type only when every predicate holds, evaluated with `this`
 * bound to the value. The check runs at typed boundaries (construction, function
 * calls, object assignment, and the `is` operator), not on independent field
 * assignment, so an object may be momentarily invalid between boundaries. The
 * plain predicate form and the `if (test) { ... } else { ... }` form are covered;
 * `where match`, class `where` clauses, and narrowing-based check elision are
 * deferred.
 */

// -- The plain predicate form is enforced --------------------------------------
test('where: a plain predicate is evaluated with `this` bound to the value', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; ({ a: (5 := uint8) } is Pos) ? "y" : "n";')).toBe('y');
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; ({ a: (0 := uint8) } is Pos) ? "y" : "n";')).toBe('n');
});

test('where: a structural failure is still rejected, independently of the predicate', () => {
  // missing the required field `a`
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; ({ b: (5 := uint8) } is Pos) ? "y" : "n";')).toBe('n');
});

// -- dependentRequired: a symmetric cross-field predicate ----------------------
test('where: dependentRequired composes two optional fields', () => {
  const P = 'type Payment = { name: string, creditCard?: number, billingAddress?: string } where (this.creditCard != null) == (this.billingAddress != null);';
  expect(evaluated(`${P} ({ name: "A" } is Payment) ? "y" : "n";`)).toBe('y'); // neither
  expect(evaluated(`${P} ({ name: "A", creditCard: 4111 } is Payment) ? "y" : "n";`)).toBe('n'); // one only
  expect(evaluated(`${P} ({ name: "A", creditCard: 4111, billingAddress: "X" } is Payment) ? "y" : "n";`)).toBe('y'); // both
});

// -- The if / else (ConditionalRefinement) form --------------------------------
test('where: an if/else predicate selects the branch to check', () => {
  const A = "type Address = { country: 'US' | 'CA', postalCode: string | number } where if (this.country == 'US') { this.postalCode is number } else { this.postalCode is string };";
  expect(evaluated(`${A} ({ country: "US", postalCode: 12345 } is Address) ? "y" : "n";`)).toBe('y');
  expect(evaluated(`${A} ({ country: "US", postalCode: "x" } is Address) ? "y" : "n";`)).toBe('n'); // then branch fails
  expect(evaluated(`${A} ({ country: "CA", postalCode: "M4W" } is Address) ? "y" : "n";`)).toBe('y'); // else branch
  expect(evaluated(`${A} ({ country: "CA", postalCode: 999 } is Address) ? "y" : "n";`)).toBe('n'); // else branch fails
});

test('where: an if with no else imposes no constraint when the test is false', () => {
  const D = 'type Dep = { flag: boolean, x?: number } where if (this.flag) { this.x != null };';
  expect(evaluated(`${D} ({ flag: true, x: 1 } is Dep) ? "y" : "n";`)).toBe('y');
  expect(evaluated(`${D} ({ flag: true } is Dep) ? "y" : "n";`)).toBe('n'); // test true, constraint fails
  expect(evaluated(`${D} ({ flag: false } is Dep) ? "y" : "n";`)).toBe('y'); // test false, no constraint
});

test('where: `this is { ... }` inside a predicate checks a refined shape', () => {
  const W = "type Wrap = { kind: 'a' | 'b', val: number | string } where if (this.kind == 'a') { this is { kind: 'a' | 'b', val: number } } else { this is { kind: 'a' | 'b', val: string } };";
  expect(evaluated(`${W} ({ kind: "a", val: 5 } is Wrap) ? "y" : "n";`)).toBe('y');
  expect(evaluated(`${W} ({ kind: "a", val: "s" } is Wrap) ? "y" : "n";`)).toBe('n');
});

// -- Multiple clauses compose as a conjunction ---------------------------------
test('where: multiple clauses compose as a conjunction', () => {
  const M = 'type M = { a: uint8, b: uint8 } where this.a > 0 where this.b > 0;';
  expect(evaluated(`${M} ({ a: (1 := uint8), b: (1 := uint8) } is M) ? "y" : "n";`)).toBe('y');
  expect(evaluated(`${M} ({ a: (1 := uint8), b: (0 := uint8) } is M) ? "y" : "n";`)).toBe('n'); // second clause fails
});

// -- Boundaries: construction, function call, object assignment ----------------
test('where: construction checks the predicate', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; String(p.a);')).toBe('5');
  expectThrown('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (0 := uint8) }; p.a;');
});

test('where: a function call checks the predicate at the parameter boundary', () => {
  const F = 'type Pos = { a: uint8 } where this.a > 0; function f(p: Pos) { return p.a; }';
  expect(evaluated(`${F} String(f({ a: (5 := uint8) }));`)).toBe('5');
  expectThrown(`${F} f({ a: (0 := uint8) });`);
});

test('where: object assignment checks the predicate', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; let q: Pos = p; String(q.a);')).toBe('5');
});

// -- Field assignment is NOT a boundary ----------------------------------------
test('where: an independent field assignment is not checked, so an object may be momentarily invalid', () => {
  // The store to p.a is not a boundary and is allowed even though it violates the predicate.
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; p.a = (0 := uint8); String(p.a);')).toBe('0');
  // An explicit `is` test observes that the object is now invalid.
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; p.a = (0 := uint8); (p is Pos) ? "y" : "n";')).toBe('n');
});

// -- Identity: a where clause gives the alias declaration identity -------------
test('where: a dependent record type is nominal, a plain alias is structural', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; Reflect.getReflection(Pos).kind;')).toBe('primitive');
  expect(evaluated('type Plain = { a: uint8 }; Reflect.getReflection(Plain).kind;')).toBe('object');
});

// -- keyof sees through the where to the base keys -----------------------------
test('where: keyof sees through the where to the base keys', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let k: keyof Pos = "a"; k;')).toBe('a');
  expectThrown('type Pos = { a: uint8 } where this.a > 0; let k: keyof Pos = "b"; k;');
});

// -- Flag off: the where and is syntax is inert --------------------------------
test('where: with the feature off, a where clause is a syntax error', () => {
  expectErrorFlagOff('type Pos = { a: uint8 } where this.a > 0; let p = { a: 0 }; p.a;');
});

// -- where on a function declaration ---------------------------------------------

/**
 * Spec: #sec-where-clauses (Where Clauses) on a function declaration: "A
 * function declaration may
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
 * this form - the one #sec-check-elision names, and the one README's own
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

// -- A where clause at a boundary, through the alias -----------------------------

test('dependent records: a where clause makes the alias a dependent record type', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; typeof Pos;')).toBe('object');
  // A where clause gives the alias declaration identity, so it resolves to a
  // nominal type (which reflects as 'primitive', as every nominal type does)
  // rather than the transparent structural object a plain alias resolves to.
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; Reflect.getReflection(Pos).kind;')).toBe('primitive');
  expect(evaluated('type Plain = { a: uint8 }; Reflect.getReflection(Plain).kind;')).toBe('object');
});

test('dependent records: the where predicate is enforced at a boundary', () => {
  // A value satisfying the predicate is accepted; one violating it is rejected.
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; String(p.a);')).toBe('5');
  expectThrown('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (0 := uint8) }; p.a;');
});

// -- Temporal: not exposed here ------------------------------------------------
