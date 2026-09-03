import { expect, test } from 'vitest';
import { evaluated, expectError } from '../harness.mts';

/**
 * `#sec-overload-resolution`: "A declaration that writes no return annotation
 * declares the SAME return as another that writes none, so two declarations of
 * one name that annotate the same parameter types and neither annotate a return
 * are one signature written twice, and are a type error at the second.
 * Declaring nothing is a declaration of nothing, not an unknown."
 *
 * Before this, `function f() {} function f() {}`
 * was accepted at the declarations and then AMBIGUOUS at every call — an error
 * naming neither of them, and arriving at a place the author had not written.
 * The annotated pair was already refused here, early; this is the same rule
 * reaching the case that declares nothing.
 *
 * The distinction that makes it safe: `sameForOverloading` refuses to equate
 * ABSENT types on purpose, because an annotation this pass cannot resolve proves
 * nothing — it once refused `f(c: Reflect.ClassField)` beside
 * `f(c: Reflect.ClassAccessor)` for exactly that reason. "No annotation was
 * written" is a different fact from "an annotation did not resolve", and only the
 * first is equated.
 */

test('two declarations that declare nothing are one signature twice', () => {
  expectError('function f() { return 1; } function f() { return 2; }');
  expectError('function f(a) { return 1; } function f(a) { return 2; }');
});

test('and it is EARLY, not at the call', () => {
  // The point of the change. Neither program calls `f`, and both are refused —
  // before this, both were accepted and only a call failed.
  expectError('function f() { return 1; } function f() { return 2; }');
  expectError('function f(a) { return a; } function f(a) { return a; }');
});

test('an ANNOTATED parameter still distinguishes', () => {
  // The guard. A rule that equated absent types too eagerly would refuse this,
  // and it is the ordinary way to write an overload beside an untyped fallback.
  expect(evaluated('function f(a: uint8) { return 1; } function f(a) { return 2; } String(f(1));')).toBe('1');
});

test('… as do different parameter types, and different arities', () => {
  expect(evaluated('function f(a: uint8) { return 1; } function f(a: string) { return "s"; } String(f(1));')).toBe('1');
  expect(evaluated('function f(a: uint8) { return 1; } function f(a: uint8, b: uint8) { return 2; } String(f(1));')).toBe('1');
});

test('… and a declared RETURN, which was the only thing that distinguished them before', () => {
  // `#sec-overloading-on-return-type`: two declarations may differ in the return
  // alone. That still holds, and is what the new rule is carefully NOT breaking.
  //
  // Selected by the CONTEXTUAL type, because "the return type does not
  // participate in ranking - it participates in filtering": a bare `f(1)` has
  // nothing to filter on and is ambiguous, which is the documented behaviour and
  // not a consequence of this change.
  const D = 'function f(a: uint8): uint8 { return 1; } function f(a: uint8): string { return "s"; } ';
  expect(evaluated(`${D}let v: uint8 = f(1); String(v);`)).toBe('1');
  expect(evaluated(`${D}let v: string = f(1); String(v);`)).toBe('s');
  // While two IDENTICAL declared returns remain the error they already were.
  expectError('function f(a: uint8): uint8 { return 1; } function f(a: uint8): uint8 { return 2; }');
});

test('a single declaration is unaffected', () => {
  expect(evaluated('function f() { return 1; } String(f());')).toBe('1');
  expect(evaluated('function f(a) { return a; } String(f(7));')).toBe('7');
});
