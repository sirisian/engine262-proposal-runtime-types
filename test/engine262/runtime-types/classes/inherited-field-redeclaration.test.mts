import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-natural-alignment and #sec-typed-classes.
 *
 * "It is a type error ... for an inherited field to be redeclared, since the
 * redeclaration would have no defined offset." The rule is applied to every
 * class whose inherited field is typed, not only to value type classes: a typed
 * field has one declared type, and subtyping, readonly permission and the store
 * check all read that one declaration.
 *
 * Before this, a same-type redeclaration was laid out twice - `(type B2)
 * .byteLength` counted `x` again while an instance had one `x` - and a changed
 * type made the subclass silently not a subtype of its base, reported only where
 * an instance met the base type.
 */

test('a typed inherited field may not be redeclared', () => {
  expectStaticTypeError('class B { x: uint8 = 1; } class B2 extends B { x: uint8 = 5; }');
  expectStaticTypeError('class B { x: uint8 = 1; } class B2 extends B { x: uint16 = 300; }');
  expectStaticTypeError('class R { s: string = "a"; } class R2 extends R { s: uint8 = 1; }');
  // Unannotated, the redeclaration still defines the field a second time.
  expectStaticTypeError('class R { s: string = "a"; } class R2 extends R { s = "b"; }');
  // Through an intermediate class, and from a class expression.
  expectStaticTypeError('class A { x: uint8 = 1; } class B extends A { y: uint8 = 2; } class C extends B { x: uint8 = 3; }');
  expectStaticTypeError('class A { x: uint8 = 1; } const E = class extends A { x: uint8 = 2; };');
});

test('the forms the rule does not reach are unchanged', () => {
  expect(evaluated('class A { x: uint8 = 1; } class B extends A { y: uint8 = 2; } String((type B).byteLength);')).toBe('2');
  // An untyped base field has no declared type to disagree with.
  expect(evaluated('class A { x = 1; } class B extends A { x: uint8 = 2; } String(new B().x);')).toBe('2');
  // Private names are per class, and statics live on each constructor.
  expect(evaluated('class A { #x: uint8 = 1; } class B extends A { #x: uint8 = 2; } "ok";')).toBe('ok');
  expect(evaluated('class A { static x: uint8 = 1; } class B extends A { static x: uint8 = 2; } "ok";')).toBe('ok');
  // A different value for the inherited field is assigned, not redeclared.
  expect(evaluated('class A { x: uint8 = 1; } class B extends A { constructor() { super(); this.x = 5; } } String(new B().x);')).toBe('5');
});
