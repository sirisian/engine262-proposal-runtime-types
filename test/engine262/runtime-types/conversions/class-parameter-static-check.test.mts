import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// A class-typed parameter was checked only at RUN time, where a primitive-typed
// one was checked at compile time. Not unsoundness - a wrong argument was still
// rejected - but rejected late, and it silently disabled every contextual type
// at an argument position.
//
// Cause: `declareFunctionSignatures` resolved each parameter's annotation before
// the pass that collects class names, so `resolveType` found nothing for a class
// and the parameter became `any`. Declaration order made no difference, because
// the collection ran after every signature in the list rather than after every
// statement.

test('a class-typed parameter is checked at the call site', () => {
  // A dead branch separates a static refusal from a runtime one: an early error
  // fires whether or not the branch runs.
  expectThrown('class A { } class B { } function f(p: A) { return 1; } if (false) { f(new B()); }');
  // Including when the class is declared AFTER the function that names it.
  expectThrown('function f(p: A) { return 1; } class A { } class B { } if (false) { f(new B()); }');
  // A primitive-typed parameter behaved this way already.
  expectThrown('function f(p: uint8) { return 1; } if (false) { f("s"); }');
});

test('correct arguments are unaffected', () => {
  expect(evaluated('class A { } function f(p: A) { return 1; } String(f(new A()));')).toBe('1');
  // And the conversions that reach a parameter still reach it.
  expect(evaluated('class M { constructor(a: float32) { this.v = a; } } function f(x: M) { return x.v; } String(Number(f(1)));')).toBe('1');
  expect(evaluated('class A { x = 7; operator number() { return this.x; } } function f(v: number) { return v; } String(f(new A()));')).toBe('7');
});
