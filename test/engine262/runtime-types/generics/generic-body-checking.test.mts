import { expect, test } from 'vitest';
import { evaluated, expectError, ok } from '../harness.mts';

/**
 * proposal-runtime-types `#sec-type-expressions`: "A type-position expression
 * inside a generic declaration evaluates at each specialization, once every
 * generic parameter it reads is bound."
 *
 * `FINDING-generic-body-unchecked.md`. Only part of that happens: the SIGNATURE's
 * parameter positions are evaluated at specialization, and the body's annotations
 * and return are not. This file pins the boundary between what works, what is
 * deliberately accepted, and what the specification says should be refused, so
 * the difference is written down rather than rediscovered:
 *
 *   - what already works, which must not regress;
 *   - what is CORRECTLY accepted, because refusing it would be wrong;
 *   - what should be refused, marked `test.fails` until it is.
 *
 * The `test.fails` cases are the specification's behaviour. When one starts
 * passing, this file fails and says so, which is the point.
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
  // The case a fix must not break, and the reason the rule has to be "refute
  // against the upper bound" rather than "check against it": `T` may be a
  // literal subtype of `string`, so assigning a String is not refutable.
  okSrc('function f<T: string>(x: T) { let v: T = "s"; }');
  // and with no constraint there is nothing to refute against at all
  okSrc('function f<T>(x: T) { let v: T = 5; }');
});

// -- what the specification says should be refused -----------------------------

test.fails('a CONSTRAINED parameter should refute an impossible body binding', () => {
  // Wrong for EVERY binding of `T`: every `T` is a subtype of `string`, and 5 is
  // not a String. Decidable from the bound alone - no specialization needed.
  expectError('function f<T: string>(x: T) { let v: T = 5; }');
});

test.fails('a CONSTRAINED parameter should refute an impossible return', () => {
  expectError('function f<T: string>(x: T): T { return 5; }');
});

test.fails('a body annotation should be evaluated at each specialization', () => {
  // Needs the binding: `T` is unconstrained, so this is only wrong once the call
  // binds `T` to `string`.
  expectError('function f<T>(x: T) { let v: T = 5; } let s: string = "a"; f(s);');
});

test.fails('a return should be evaluated at each specialization', () => {
  expectError('function f<T>(x: T): T { return 5; } let s: string = "a"; f(s);');
});

test.fails('an indexed-access return should be evaluated too', () => {
  // The case that led here: `T[K]` parses and runs in a generic return position,
  // and returning something else from it is accepted.
  expectError('function p<T, K: keyof T>(o: T, k: K): T[K] { return 5; } let u = { n: "x" }; p(u, "n");');
});
