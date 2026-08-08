import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Spec: sec-user-defined-conversions, the first of the three declaring forms.
//
// "A constructor taking one parameter of type S ... S to T. A converting
// constructor, so `let t: MyType = 1;` is legal when MyType's constructor takes
// a float32."
//
// The clause's own example was a TypeError: the checker refused the assignment
// before the boundary was reached, so BOTH halves were needed - the checker
// admits the conversion where assignability fails, and the membership path that
// then runs constructs rather than refusing.

test('the clause example: a one-parameter constructor converts', () => {
  expect(evaluated('class MyType { constructor(a: float32) { this.v = a; } } let t: MyType = 1; String(Number(t.v));')).toBe('1');
  // It CONSTRUCTS - the result is an instance, not the value retyped.
  expect(evaluated('class MyType { constructor(a: float32) { this.v = a; } } let t: MyType = 1; String(t instanceof MyType);')).toBe('true');
});

test('it applies at an assignment, an argument, and a return', () => {
  // The three boundaries the clause names.
  expect(evaluated('class MyType { constructor(a: float32) { this.v = a; } } function f(x: MyType) { return x.v; } String(Number(f(1)));')).toBe('1');
  expect(evaluated('class MyType { constructor(a: float32) { this.v = a; } } function g(): MyType { return 1; } String(Number(g().v));')).toBe('1');
  // And in an array element, which is a typed position like any other.
  expect(evaluated('class MyType { constructor(a: float32) { this.v = a; } } let a: [].<MyType> = [1, 2]; String(Number(a[1].v));')).toBe('2');
});

test('an exact match always wins, so no existing program changes', () => {
  // The conversion is reached only AFTER assignability fails. That ordering is
  // the ranking: a value already of the type is never routed through a user
  // conversion, so declaring a constructor cannot change which overload an
  // existing call selects.
  expect(evaluated('class MyType { constructor(a: float32) { this.v = a; } } const m = new MyType(5); let t: MyType = m; String(t === m);')).toBe('true');
});

test('what does NOT convert', () => {
  // No constructor at all.
  expectThrown('class Bare { } let t: Bare = 1;');
  // TWO parameters: the clause says "taking one parameter", and a constructor of
  // two is reached through target-typed construction instead.
  expectThrown('class Two { constructor(a: float32, b: float32) {} } let t: Two = 1;');
  // A source the declared parameter does not admit.
  expectThrown('class MyType { constructor(a: float32) { this.v = a; } } let t: MyType = "s";');
});
