import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// A class DENOTES its type through its constructor - a class's type object is its constructor - so
// `Reflect.getReflection(K)` must reflect a class as it does any other type, though `isTypeObject` is
// `'TypeRecord' in value` and a constructor carries no record. The record cannot simply be attached to the
// constructor: that would make `typeof K` report "object", where ECMA-262 requires "function". A class is the
// one denotation whose shape is fixed by another specification, so the association is resolved at the
// reflection site instead. Every other type object reports typeof "object", which #sec-type-object-opacity
// requires: "This does not make a Type Object a function to `typeof`".

test('a class reflects through its constructor', () => {
  expect(evaluated('class K { x: uint8 = 1; } String(Reflect.getReflection(K).kind);')).toBe('primitive');
  expect(evaluated('class A { } class B extends A { } String(Reflect.getReflection(B).kind);')).toBe('primitive');
});

test('and `typeof` is untouched', () => {
  // The constraint that rules out attaching the record.
  expect(evaluated('class K { } typeof K;')).toBe('function');
  expect(evaluated('class Box<T: type> { v: T; } typeof Box;')).toBe('function');
  // While every other type object reports "object", as the spec requires - in a
  // text that ADMITS. `#sec-type-names` excepts `typeof` from admitting, so a
  // probe alone leaves the name unbound, which is what keeps an existing
  // `typeof string === "undefined"` true.
  expect(evaluated('typeof uint8;')).toBe('undefined');
  expect(evaluated('type A = uint8; typeof uint8;')).toBe('object');
  expect(evaluated('typeof [].<uint32>;')).toBe('object');
  expect(evaluated('type U = uint8 | string; typeof U;')).toBe('object');
});

test('a class still behaves as a class', () => {
  expect(evaluated('class K { x: uint8 = 1; } String(new K().x);')).toBe('1');
  expect(evaluated('class K { } String(new K() instanceof K);')).toBe('true');
});

test('the resolution does not admit non-types', () => {
  // A plain function is not a class and must still be refused, or the
  // association lookup would become a way to reflect anything callable.
  expectThrown('function f() { } Reflect.getReflection(f);');
  expectThrown('Reflect.getReflection(42);');
});
