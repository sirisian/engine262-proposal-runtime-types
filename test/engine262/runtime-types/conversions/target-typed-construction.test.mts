import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Spec: sec-new-expressions, `new` `.` Arguments.
//
// Target-typed construction: it constructs the type its POSITION requires, so
// the type is not named. The checker resolves the contextual type and records
// it, because the runtime has no contextual type of its own and the annotation
// is enforced only after a value exists - too late for a form whose job is
// deciding what to construct.

test('the type comes from the position', () => {
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } const a: A = new.(10, 20); String(a.v);')).toBe('30');
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } const a: [].<A> = [new.(10, 20), new.(30, 40)]; String(a[1].v);')).toBe('70');
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } function g(): A { return new.(3, 4); } String(g().v);')).toBe('7');
  // Nesting: the inner position's type is the outer constructor's parameter.
  expect(evaluated('class B { constructor(n) { this.n = n; } } class A { constructor(b) { this.v = b.n; } } const a: A = new.(new B(7)); String(a.v);')).toBe('7');
});

test('it composes with a converting constructor in one literal', () => {
  // README's mixed example: explicit construction beside a bare element that
  // converts through the one-parameter constructor. Needs both features.
  expect(evaluated('class A { constructor(x: uint32) { this.v = Number(x); } } const a: [].<A> = [new.(9), 5]; String(a[0].v) + "/" + String(a[1].v);')).toBe('9/5');
});

test('the two refusals the clause names', () => {
  // "a position that requires no type gives nothing to construct" - a Syntax
  // Error rather than an inference, because inferring would be the binding-type
  // inference this proposal does not perform.
  expectThrown('const a = new.(1);');
  // And a contextual type that cannot be constructed.
  expectThrown('let n: uint8 = new.(1);');
});

test('the forms sharing this production are unchanged', () => {
  // `new.target`, ordinary `new` with a parenthesized callee, and placement
  // `new` all parse through the same production this form joins.
  expect(evaluated('function f() { return String(new.target); } f();')).toBe('undefined');
  expect(evaluated('class A { constructor() { this.k = "A"; } } const a = new(A); String(a.k);')).toBe('A');
  expect(evaluated('function F() { return new.target !== undefined; } String(new F() instanceof F);')).toBe('true');
});

test.fails('KNOWN GAP: an argument position carries no contextual type yet', () => {
  // sec-contextual-types lists "an argument of a call whose callee has a single
  // applicable signature", but the checker does not consult staticTypeIn there,
  // so this reports "requires a contextual type". The refusal is safe - nothing
  // is mis-constructed - but the position should work.
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } function f(p: A) { return p.v; } String(f(new.(1, 2)));')).toBe('3');
});
