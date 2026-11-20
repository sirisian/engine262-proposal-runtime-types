import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * The README's accessors section: "Replacing an inherited field with an
 * accessor of the same name, or the reverse, is a TypeError. A field occupies
 * a slot in the base's memory layout and an accessor doesn't, so the
 * substitution would change the layout of a type that already exists."
 *
 * Along a value class chain this was accepted, and neither half did what it
 * said: the base's field is an own property of every instance and shadows the
 * subclass's accessor on the prototype, so `get a()` over a field `a` was never
 * called, and a field over a getter left the base's getter unreachable on a
 * value of the subclass. A class held by reference is not judged by this rule.
 */

test('an accessor over an inherited field, and a field over an inherited accessor, are refused', () => {
  const getter = 'value class B { a: uint8 = 1; } value class D extends B { get a(): uint8 { return 2; } }';
  expectStaticTypeError(getter);
  expectThrown(getter, '"D" declares "a" an accessor, where "B" declares it a field');
  const field = 'value class B { get a(): uint8 { return 2; } } value class D extends B { a: uint8 = 1; }';
  expectStaticTypeError(field);
  expectThrown(field, '"D" declares "a" a field, where "B" declares it an accessor');
  expectStaticTypeError('value class B { a: uint8 = 1; } value class D extends B { set a(v: uint8) {} }');
  expectStaticTypeError('value class B { a: uint8 = 1; } value class D extends B { accessor a: uint8 = 3; }');
  expectStaticTypeError('value class B { accessor a: uint8 = 1; } value class D extends B { a: uint8 = 3; }');
  // Through a class that declares nothing of it.
  expectStaticTypeError('value class A { a: uint8 = 1; } value class B extends A { } value class D extends B { get a(): uint8 { return 1; } }');
});

test('what keeps its kind, and what is not this rule\'s, is accepted', () => {
  expect(evaluated('value class B { get a(): uint8 { return 1; } } value class D extends B { get a(): uint8 { return 2; } } String(new D().a);')).toBe('2');
  expect(evaluated('value class B { static a: uint8 = 1; } value class D extends B { static get a(): uint8 { return 2; } } String(D.a);')).toBe('2');
  expect(evaluated('value class B { #a: uint8 = 1; } value class D extends B { get a(): uint8 { return 2; } } String(new D().a);')).toBe('2');
  // A method over an inherited field keeps the field's precedence
  // (inherited-field-capabilities.test.mts), and a class held by reference is
  // not judged here.
  expect(evaluated('value class B { x: uint8 = 1; } value class D extends B { x(): string { return "s"; } } String(new D().x);')).toBe('1');
  expect(evaluated('class B { get x(): uint8 { return 1; } } class D extends B { x: uint8 = 2; } String(new D().x);')).toBe('2');
});
