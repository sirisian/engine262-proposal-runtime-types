import { test, expect } from 'vitest';
import { evaluated, expectError, expectThrown } from '../harness.mts';

/**
 * Typed destructuring members (spec sec-typed-destructuring): the optional
 * marker, the refusal of `ref` beside it, and a typed rest.
 */

test('an optional member binds undefined where the property is absent', () => {
  // the marker says the value may not be there, which is the rule an optional
  // PARAMETER already follows; it was parsed and then ignored here, so the
  // annotation was enforced against the absent property's undefined
  expect(evaluated('let o = {}; let { (x?: uint8) } = o; String(typeof x);')).toBe('undefined');
  // a supplied value is still enforced
  expect(evaluated('let o = { x: 1 }; let { (x?: uint8) } = o; String(x);')).toBe('1');
  expectThrown('let o = { x: "s" }; let { (x?: uint8) } = o;');
  // and a member that is NOT optional still requires its property
  expectThrown('let o = {}; let { (x: uint8) } = o;');
});

test('a ref parameter or member may not be optional', () => {
  // `?` says the argument may be omitted; a `ref` binds a LOCATION that an
  // omitted argument does not supply, so the pairing could never be honoured -
  // the same reason a `ref` parameter may not have a default
  expectError('function f(ref a?: uint32) { return 1; } "ran";');
  expectError('let o = { x: 1 }; let { (ref x?) } = o; "ran";');
  // the forms either half admits are unaffected
  expect(evaluated('function f(ref a: uint32) { return a; } let v = (7 := uint32); String(f(ref v));')).toBe('7');
  expect(evaluated('let o = { x: 1 }; let { (ref x) } = o; x = 5; String(o.x);')).toBe('5');
  expect(evaluated('function f(a?: uint32) { return typeof a; } String(f());')).toBe('undefined');
  // and a ref parameter still may not carry a default
  expectError('function f(ref a: uint32 = 1) { return a; } "ran";');
});

test('an object rest may state the type of what it collects', () => {
  // the rest is where a payload's unmodelled remainder goes, and was the one
  // position in a pattern that could not be typed
  expect(evaluated('let { (a: uint8), ...rest: object } = { a: 1, z: 2 }; String(rest.z);')).toBe('2');
  expect(evaluated('function f({ (a: uint8), ...rest: object }) { return rest.z; } String(f({ a: 1, z: 9 }));')).toBe('9');
  // the annotation is the type of the COLLECTION, so a member type is refused
  expectThrown('let { ...rest: uint8 } = { z: 2 };');
  // an untyped rest, and the array form, are unaffected
  expect(evaluated('let { a, ...rest } = { a: 1, z: 2 }; String(rest.z);')).toBe('2');
  expect(evaluated('let [a: uint8, ...b: [].<uint8>] = [1, 2, 3]; String(b.length);')).toBe('2');
});
