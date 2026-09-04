import { expect, test } from 'vitest';
import { evaluated, expectError } from '../harness.mts';

/**
 * `#sec-overload-resolution`: "A declaration that writes no return annotation
 * declares the SAME return as another that writes none, so two declarations of
 * one name that annotate the same parameter types and neither annotate a return
 * are one signature written twice, and are a type error at the second.
 * Declaring nothing is a declaration of nothing, not an unknown."
 *
 * Before this, `function f(a: uint8) {} function f(a: uint8) {}` was accepted at
 * the declarations and then AMBIGUOUS at every call — an error naming neither of
 * them, and arriving at a place the author had not written. The annotated pair
 * was already refused here, early; this is the same rule reaching the case that
 * declares nothing.
 *
 * THE RULE IS SCOPED TO TYPED DECLARATIONS, and that scope is what keeps the
 * proposal a superset. `function f() { return 1; } function f() { return 2; }`
 * is legal JavaScript — function declarations are var-scoped and the last one
 * wins — so refusing it would reject a program every engine runs. A function
 * that annotates nothing is not part of an overload set, publishes no inferred
 * return, and keeps its JavaScript meaning. What is refused is a repeat within a
 * TYPED set, where the ambiguity has somewhere to arrive.
 *
 * The distinction that makes it safe: `sameForOverloading` refuses to equate
 * ABSENT types on purpose, because an annotation this pass cannot resolve proves
 * nothing — it once refused `f(c: Reflect.ClassField)` beside
 * `f(c: Reflect.ClassAccessor)` for exactly that reason. "No annotation was
 * written" is a different fact from "an annotation did not resolve", and only the
 * first is equated.
 */

test('two TYPED declarations that declare nothing are one signature twice', () => {
  // Neither writes a return, so each INFERS one, and both infer the same type:
  // one signature written twice.
  expectError('function f(a: uint8) { return 1; } function f(a: uint8) { return 2; }');
  expectError('function f(a: string) { return a; } function f(a: string) { return a; }');
});

test('two typed declarations that INFER DIFFERENT returns are two signatures', () => {
  // The guard on the rule above. A typed function has a return type whether or
  // not it writes one, so the comparison is between what each infers - and these
  // infer `string` and `uint8`. Reading two absent annotations as one type
  // refused this pair, which is an ordinary overload set.
  expect(evaluated('function f(a: uint8) { return "s"; } function f(a: string) { return uint8(1); } "ok";')).toBe('ok');
});

test.fails('an UNTYPED duplicate keeps its JavaScript meaning', () => {
  // RECORDED, NOT FIXED. Function declarations are var-scoped and the last one
  // wins; every engine runs both of these and answers 2.
  //
  // The DECLARATIONS are no longer refused, which is half the rule: a wholly
  // untyped function publishes no inferred return, so it is not a signature
  // written twice. But an untyped declaration still JOINS the overload set, so
  // the call is refused as "ambiguous between two declared signatures" - the
  // error the author never wrote, one step later than before.
  //
  // The remaining half is that an untyped declaration should not form an
  // overload set at all. A superset may add meanings; it may not remove
  // programs, and this program is removed.
  expect(evaluated('function f() { return 1; } function f() { return 2; } String(f());')).toBe('2');
  expect(evaluated('function f(a) { return 1; } function f(a) { return 2; } String(f(0));')).toBe('2');
});

test('and it is EARLY, not at the call', () => {
  // The point of the change. Neither program calls `f`, and both are refused —
  // before this, both were accepted and only a call failed.
  expectError('function f(a: uint8) { return 1; } function f(a: uint8) { return 2; }');
  expectError('function f(a: string) { return a; } function f(a: string) { return a; }');
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
