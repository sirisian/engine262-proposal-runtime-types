import { test, expect } from 'vitest';
import { ok } from '../harness.mts';

/**
 * #sec-checked-contracts: "at every concrete evaluation of the builder ... EACH
 * CLAUSE is evaluated with `return` bound to it, and a clause that is falsy is a
 * type error naming the builder, the arguments it was given, and the clause."
 *
 * VerifyContracts skipped any clause whose predicate did not mention `return`.
 * So a clause constraining only the arguments - the ordinary shape of a
 * precondition, and the one Eiffel's `require`, Dafny's `requires` and Ada's
 * `Pre` all take - was accepted at every application and checked nowhere. It
 * read as a guarantee and was inert, with no diagnostic to say otherwise.
 *
 * The guard was deciding two things and should have decided one: when to push
 * the `return` binding, which is cheap enough to do unconditionally, and whether
 * to evaluate at all, which was never its business. The alias-application path
 * already evaluated every clause without such a guard; a builder's clauses and
 * an alias's now agree.
 */

test('a precondition constraining only the arguments is checked', () => {
  expect(ok('function f(T: type): type where Reflect.getReflection(T).kind === "object" { return T; }'
    + ' type R = f(type { a: uint8 });')).toBe(true);
  expect(ok('function f(T: type): type where Reflect.getReflection(T).kind === "tuple" { return T; }'
    + ' type R = f(type { a: uint8 });')).toBe(false);
});

test('a clause mentioning neither argument nor return is still a clause', () => {
  expect(ok('function g(T: type): type where Reflect.isAssignable(type "x", type string) { return T; }'
    + ' type R = g(type { a: uint8 });')).toBe(true);
  expect(ok('function h(T: type): type where Reflect.isAssignable(type string, uint8) { return T; }'
    + ' type R = h(type { a: uint8 });')).toBe(false);
});

test('a clause mentioning return keeps its behaviour', () => {
  expect(ok('function i(T: type): type where Reflect.getReflection(return).kind === "object" { return T; }'
    + ' type R = i(type { a: uint8 });')).toBe(true);
  expect(ok('function j(T: type): type where Reflect.getReflection(return).kind === "tuple" { return T; }'
    + ' type R = j(type { a: uint8 });')).toBe(false);
});

test('a builder with no clauses is untouched', () => {
  expect(ok('function k(T: type): type { return T; } type R = k(type { a: uint8 });')).toBe(true);
});
