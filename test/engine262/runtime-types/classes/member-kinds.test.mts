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
 * value of the subclass. Question D, D6: the same holds of a class held by
 * reference, where what the base declares of a member must hold for every
 * value typed as the base, and the rule is judged for every class the checker
 * sees the chain of, as TypeScript judges it (2610, 2611).
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
  // (inherited-field-capabilities.test.mts), and a field over a method is not
  // this rule's.
  expect(evaluated('value class B { x: uint8 = 1; } value class D extends B { x(): string { return "s"; } } String(new D().x);')).toBe('1');
  expect(evaluated('class B { m(): uint8 { return 1; } } class D extends B { m: () => uint8 = () => 2; } String(new D().m());')).toBe('2');
});

test('a class held by reference keeps a member\'s kind along its chain', () => {
  const field = 'class B { get x(): uint8 { return 1; } } class D extends B { x: uint8 = 2; }';
  expectStaticTypeError(field);
  expectThrown(field, '"D" declares "x" a field, where "B" declares it an accessor; a member keeps its kind along a class chain');
  const getter = 'class B { x: uint8 = 1; } class D extends B { get x(): uint8 { return 2; } }';
  expectStaticTypeError(getter);
  expectThrown(getter, '"D" declares "x" an accessor, where "B" declares it a field; a member keeps its kind along a class chain');
  expectStaticTypeError('class B { set x(v: uint8) {} } class D extends B { x: uint8 = 2; }');
  expectStaticTypeError('class B { x: uint8 = 1; } class D extends B { accessor x: uint8 = 3; }');
  expectStaticTypeError('class B { get x(): uint8 { return 1; } } class C extends B { } class D extends C { x: uint8 = 2; }');
  // A class expression is named by the binding it initializes.
  expectThrown('const B = class { get x(): uint8 { return 1; } }; class D extends B { x: uint8 = 2; }', 'where "B" declares it an accessor');
  // The base's declaration is typed, so the rule is about it wherever the subclass is written.
  expectStaticTypeError('class B { get x(): uint8 { return 1; } } class D extends B { x = 2; }');
  // In checked code a class of the pinned edition is judged too.
  expectStaticTypeError('const n: uint8 = 1; class B { get x() { return 1; } } class D extends B { x = 2; }');
});

test('JavaScript, a static member, a private name and an unseen base are not this rule\'s', () => {
  expect(evaluated('class B { get x() { return 1; } } class D extends B { x = 2; } String(new D().x);')).toBe('2');
  expect(evaluated('class B { static get x(): uint8 { return 1; } } class D extends B { static x: uint8 = 2; } String(D.x);')).toBe('2');
  expect(evaluated('class B { get x(): uint8 { return 1; } } class D extends B { #x: uint8 = 2; } String(new D().x);')).toBe('1');
  expect(evaluated('const B: any = class { get x() { return 1; } }; class D extends B { x: uint8 = 2; } String(new D().x);')).toBe('2');
  expect(evaluated('class D extends Error { get message(): string { return "m"; } } new D().message;')).toBe('m');
});
