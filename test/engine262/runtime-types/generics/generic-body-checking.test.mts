import { expect, test } from 'vitest';
import { evaluated, expectError, ok } from '../harness.mts';

/**
 * proposal-runtime-types `#sec-type-expressions`: "A type-position expression
 * inside a generic declaration evaluates at each specialization, once every
 * generic parameter it reads is bound."
 *
 * `FINDING-generic-body-unchecked.md`. The body used to be walked with no type
 * parameter in scope, so `T` there resolved to nothing and `let v: T = 5` was
 * accepted for want of a constraint to violate. This file pins the three things
 * that boundary turns on:
 *
 *   - what is enforced at the CALL, which must not regress;
 *   - what a generic BODY may and may not do;
 *   - the boundary case that decides how the fix had to be scoped.
 *
 * The body cases were `test.fails` while the gap stood. They pass now: the
 * checker pushes the declaration's type parameters around the body walk, and
 * the opaque-parameter relation `relations.mts` already stated does the rest.
 */

const okSrc = (s: string) => expect(ok(s), `expected accepted: ${s}`).toBe(true);

// -- what works, and must not regress -----------------------------------------

test('a type parameter is enforced at the CALL', () => {
  // The half that is implemented: an explicit type argument constrains the
  // argument, and a constraint on the parameter constrains the type argument.
  expectError('function f<T>(x: T): void {} f.<string>(5);');
  expectError('function f<T: string>(x: T): void {} f.<number>(5);');
  okSrc('function f<T: string>(x: T): void {} f.<string>("s");');
});

test('a CONCRETE return is still checked, which is the control', () => {
  // Whatever is wrong below is specific to a type-position expression that reads
  // a generic parameter, not to returns in general.
  expectError('function h(): string { return 5; }');
});

test('a generic body that is correct still runs', () => {
  expect(evaluated('function p<T, K: keyof T>(o: T, k: K): T[K] { return o[k]; } let u = { n: "x" }; String(p(u, "n"));')).toBe('x');
});

// -- what is CORRECTLY accepted ------------------------------------------------

test('a value OF THE BOUND is not a value of the parameter', () => {
  // NOT the other way round, which an earlier draft of this file asserted. `T`
  // may be instantiated with a literal type - `f.<"abc">("abc")` is accepted -
  // so a String is not known to be a `T: string`, and assigning one is refused.
  // A parameter is opaque: a subtype of itself and of its constraint, and
  // nothing relates to IT.
  expectError('function f<T: string>(x: T) { let v: T = "s"; }');
  expectError('function f<T>(x: T) { let v: T = 5; }');
});

test('but a T IS a T, which is what makes a generic body writable', () => {
  okSrc('function f<T>(x: T) { let v: T = x; }');
  okSrc('function f<T>(x: T): T { return x; }');
  okSrc('function p<T, K: keyof T>(o: T, k: K): T[K] { return o[k]; }');
});

// -- what the specification says should be refused -----------------------------

test('a CONSTRAINED parameter should refute an impossible body binding', () => {
  // Wrong for EVERY binding of `T`: every `T` is a subtype of `string`, and 5 is
  // not a String. Decidable from the bound alone - no specialization needed.
  expectError('function f<T: string>(x: T) { let v: T = 5; }');
});

test('a CONSTRAINED parameter should refute an impossible return', () => {
  expectError('function f<T: string>(x: T): T { return 5; }');
});

test('a body annotation should be evaluated at each specialization', () => {
  // Needs the binding: `T` is unconstrained, so this is only wrong once the call
  // binds `T` to `string`.
  expectError('function f<T>(x: T) { let v: T = 5; } let s: string = "a"; f(s);');
});

test('a return should be evaluated at each specialization', () => {
  expectError('function f<T>(x: T): T { return 5; } let s: string = "a"; f(s);');
});

test('an indexed access over a parameter is deferred, not unresolvable', () => {
  // Was `test.fails` while `T[K]` over an opaque parameter resolved to nothing
  // and the annotation was unchecked. `PLAN-parameter-composition` Stage C: it
  // answers a DEFERRED type instead - opaque like the parameters it composes -
  // so nothing concrete is assignable to it.
  expectError('function p<T, K: keyof T>(o: T, k: K): T[K] { return 5; }');
  expectError('function p<T, K: keyof T>(o: T, k: K) { let v: T[K] = 5; }');
  // And the EXPRESSION reaches the same record, which is what keeps the correct
  // program working: `o[k]` and `T[K]` are one operation with two spellings.
  okSrc('function p<T, K: keyof T>(o: T, k: K): T[K] { return o[k]; }');
  okSrc('function p<T, K: keyof T>(o: T, k: K) { let v: T[K] = o[k]; }');
  expectError('function p<T, K: keyof T>(o: T, k: K) { let v: string = o[k]; }');
});
