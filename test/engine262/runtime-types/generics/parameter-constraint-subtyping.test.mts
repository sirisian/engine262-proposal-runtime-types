import { expect, test } from 'vitest';
import { evaluated, expectError, ok } from '../harness.mts';

/**
 * proposal-runtime-types `#sec-issubtype`: a type parameter is a subtype of
 * itself and of its [[Constraint]], and nothing else is a subtype of IT.
 *
 * `PLAN-parameter-composition.md` Stage A. The rule was stated in neither the
 * specification nor the engine: `resolveType` built `{ Kind: 'parameter', Name }`
 * with no constraint, so the [[Constraint]] step had nothing to read, and a
 * constrained parameter was LESS usable than an unconstrained one - writing the
 * constraint bought its author nothing inside the declaration while still
 * restricting the caller.
 *
 * The asymmetry is the whole of it, so both directions are asserted for every
 * case: a `T` may be used AS its constraint, and its constraint may not be used
 * as a `T`.
 */

const okSrc = (s: string) => expect(ok(s), `expected accepted: ${s}`).toBe(true);

test('a T may be used AS its constraint', () => {
  okSrc('function f<T: string>(x: T): string { return x; }');
  okSrc('function f<T: string>(x: T) { let v: string = x; }');
});

test('a constraint that reads an EARLIER parameter resolves', () => {
  // `<T, K: keyof T>` is the ordinary shape, and the reason the scope is filled
  // in declaration order rather than all at once.
  okSrc('function p<T, K: keyof T>(o: T, k: K): keyof T { return k; }');
});

test('but the constraint may NOT be used as a T', () => {
  // `T: string` accepts `f.<"abc">("abc")`, so a String is not known to be a `T`.
  expectError('function f<T: string>(x: T) { let v: T = "s"; }');
  expectError('function f<T: string>(x: T): T { return "s"; }');
});

test('and a T is not a subtype of anything else', () => {
  expectError('function f<T: string>(x: T): uint8 { return x; }');
  expectError('function f<T: string>(x: T) { let v: T = 5; }');
});

test('an UNCONSTRAINED parameter is unchanged', () => {
  // Nothing to be a subtype of, so only the identity relation applies.
  okSrc('function f<T>(x: T): T { return x; }');
  expectError('function f<T>(x: T): string { return x; }');
  expectError('function f<T>(x: T) { let v: T = 5; }');
});

test('the CALL boundary is unchanged', () => {
  // A published signature over type parameters is not enforced at the boundary,
  // which is what lets `id(5)` bind `T` rather than check against it.
  okSrc('function id<T>(v: T) { return v; } id(5); id("hi"); id({});');
  // and an explicit type argument is still checked against the constraint
  expectError('function f<T: string>(x: T): void {} f.<number>(5);');
  expect(evaluated('function f<T: string>(x: T): T { return x; } String(f("s"));')).toBe('s');
});
