import { test, expect } from 'vitest';
import { ok, expectStaticTypeError } from '../harness.mts';

/**
 * #sec-object-types: "The |Initializer| must be compile-time evaluable
 * (#sec-compile-time-evaluability) and it is a type error otherwise", for the
 * reason #sec-array-and-tuple-types gives of a tuple element's: an object type
 * is interned, so a member's default is one value shared by every use of the
 * type rather than a computation performed per construction.
 *
 * The rule was stated and unenforced - an arbitrary expression was accepted and
 * its effects landed. #annex-evaluable-fragment makes the syntactic half a walk
 * with a rejection list rather than an evaluator: "the ECMAScript grammar less
 * the following". The library half of the annex, about which BUILT-INS are
 * determined by their arguments, is a separate judgment and is not decided here.
 */

test('the fragment admits what a default needs', () => {
  expect(ok('type S = { p?: uint8 = 9 };')).toBe(true);
  expect(ok('type S = { p?: uint8 = 3 + 4 };')).toBe(true);
  expect(ok('const K = 5; type S = { p?: uint8 = K };')).toBe(true);
  expect(ok('function f() { return 6; } type S = { p?: uint8 = f() };')).toBe(true);
});

test('and refuses the forms it excludes, by name', () => {
  expectStaticTypeError('type S = { p?: uint8 = eval("5") };');
  expectStaticTypeError('type S = { p?: any = Function("return 5") };');
  expectStaticTypeError('type S = { p?: any = (class {}) };');
  expectStaticTypeError('type S = { p?: any = new Proxy({}, {}) };');
});

test('an interface member is held to the same rule, at a different moment', () => {
  // An object type "is the inline form of an interface", so a default written in
  // one is the default written in the other and every walk applies the test.
  expect(ok('interface I { p?: uint8 = 9 }')).toBe(true);
  expect(ok('interface I { p?: uint8 = eval("5") }')).toBe(false);
  // WHEN differs, and the asymmetry is the checker's rather than the rule's: an
  // object type is resolved where it is written, so a bad default there is an
  // early error against the source, while an interface is resolved when it is
  // USED, so an unused one is refused as the declaration runs instead. Both
  // refuse; only the first is static.
  expectStaticTypeError('type S = { p?: uint8 = eval("5") };');
  expect(ok('interface I { p?: uint8 = eval("5") } let v: I = { };')).toBe(false);
});
