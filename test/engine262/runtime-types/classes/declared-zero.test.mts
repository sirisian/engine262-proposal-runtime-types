import { test, expect } from 'vitest';
import { evaluated, expectThrown, ok } from '../harness.mts';

test('a class may declare the zero its bindings hold', () => {
  // PLAN-type-declared-zero.md. #sec-declared-zero: a class may declare "the
  // value its bindings hold before assignment, in place of the one
  // DefaultValueOf derives field by field", as a static field named `default`.
  expect(evaluated('class Z { x: uint8; static default = new Z(); } let z: Z; String(z.x);')).toBe('0');
  // A class declaring NONE keeps the derived, field-by-field zero. This is the
  // case a REPLACEMENT rule breaks if it fires unconditionally.
  expect(evaluated('class P { x: uint8; } let p: P; String(p.x);')).toBe('0');
  // #sec-declared-zero: "it is a type error if the declared zero is not a value
  // of the class."
  expectThrown('class B { x: uint8; static default = 5; } let b: B;');
});

test('a static block may set the declared zero, and is what registration sees', () => {
  // PLAN-generic-declared-zero.md Q3. A block runs AFTER the static fields and
  // may assign `default`, so there are two moments a zero could be read. The
  // registration reads the FINISHED class - after fields and blocks both - so a
  // binding and the static field never disagree.
  expect(evaluated('class S { x: uint8; static default = new S(); '
    + 'static { S.default = new S(); S.default.x = (9 := uint8); } } '
    + 'let v: S; String(v.x) + "/" + String(S.default.x);')).toBe('9/9');
  // And a block assigning something the class rejects is CAUGHT. Reading before
  // the block would have snapshotted the valid instance and let this escape.
  expectThrown('class S2 { x: uint8; static default = new S2(); static { S2.default = null; } } let v: S2;');
});

test('an unspecialized generic keeps its DERIVED zero', () => {
  // PLAN-generic-declared-zero.md phase 1. A generic class DEFERS its static
  // fields and blocks - "a static field's initializer may read the class's type
  // parameters", and none are bound until an application. So `default` is not
  // set yet, and reading it at declaration would register *undefined* -
  // overriding the derived zero with nothing, which is worse than registering
  // nothing at all.
  //
  // Measured before the guard: this reported "undefined is not assignable to
  // Box.<uint.<8>>". It now falls back to the derived zero, which is where it
  // was before the feature existed.
  expect(evaluated('class Box<T> { x: uint8; static default = new Box(); } '
    + 'let b: Box.<uint8>; String(b.x);')).toBe('0');
  // The same class with no declared zero was always fine, and still is.
  expect(evaluated('class Box2<T> { x: uint8; } let b: Box2.<uint8>; String(b.x);')).toBe('0');
  // NOT a bug, and asserted so a later reader does not "fix" it: an
  // unspecialized generic's static field is undefined, and its APPLICATION has
  // the value. Static METHODS are unaffected, which is the tell that this is
  // deferral rather than loss.
  expect(evaluated('class G<T> { static s = 7; } String(G.s);')).toBe('undefined');
  expect(evaluated('class G2<T> { static s = 7; } String(G2.<uint8>.s);')).toBe('7');
  expect(ok('class G3<T> { static m() { return 1; } } G3.m();')).toBe(true);
});
