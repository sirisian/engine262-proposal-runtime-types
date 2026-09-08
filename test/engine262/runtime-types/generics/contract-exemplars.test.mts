import { test, expect } from 'vitest';
import { ok } from '../harness.mts';

/**
 * #sec-checked-contracts: "A generic declaration may carry an `exemplars`
 * decorator naming types, which forces specialization of the declaration at
 * those arguments during compile-time evaluation, so that a builder's contracts
 * are evaluated where the declaration is rather than only where a caller reaches
 * it."
 *
 * A contract is verified at every concrete evaluation, so a builder nobody
 * applies has its contracts checked nowhere - measured before this landed: a
 * false contract on a builder that is never applied, or used only in a generic
 * signature, was caught by nothing. An exemplar is a concrete argument, so
 * forcing an evaluation at the declaration puts the check where the author is,
 * and VerifyContracts does the rest unchanged.
 */

const D = 'function exemplars(types, c) { Reflect.declareExemplars(c, types); } ';

test('a false contract fails at the declaration when exemplars name an argument', () => {
  expect(ok(`${D}
    @exemplars([type { a: uint8 }])
    function bad(T: type): type where Reflect.getReflection(return).kind === "tuple" { return T; }`)).toBe(false);
});

test('and is still uncaught without them, which is what exemplars are for', () => {
  expect(ok(`${D}
    function bad(T: type): type where Reflect.getReflection(return).kind === "tuple" { return T; }`)).toBe(true);
});

test('a contract that holds at its exemplars passes', () => {
  expect(ok(`${D}
    @exemplars([type { a: uint8 }])
    function good(T: type): type where Reflect.getReflection(return).kind === "object" { return T; }`)).toBe(true);
});

test('an exemplar may be a list, for a builder of several parameters', () => {
  expect(ok(`${D}
    @exemplars([[type { a: uint8 }, "a"]])
    function two(T: type, k: string): type where Reflect.getReflection(return).kind === "object" { return T; }`)).toBe(true);
});

test('the primitive takes only an open decoration context', () => {
  // Recorded through the context like an inverse, so exemplars are a fact of the
  // declaration rather than a registration anything can make later.
  expect(ok('Reflect.declareExemplars({}, []);')).toBe(false);
});
