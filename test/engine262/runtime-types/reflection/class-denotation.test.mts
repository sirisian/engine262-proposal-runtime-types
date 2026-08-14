import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// A class DENOTES its type through its constructor - the design's "a class's type
// object is its constructor" - but `Reflect.getReflection(K)` threw "is not a
// type", because `isTypeObject` is `'TypeRecord' in value` and a constructor
// carries no record.
//
// The record CANNOT simply be attached to it. Doing so makes `typeof K` report
// "object", where ECMA-262 requires "function" - measured, and it failed twelve
// tests. A class is the one denotation whose shape is fixed by another
// specification, so the association is resolved at the reflection site instead.
//
// Every other type object reports typeof "object", which sec-type-objects
// requires: "This does not make a Type Object a function to `typeof`".

test('a class reflects through its constructor', () => {
  expect(evaluated('class K { x: uint8 = 1; } String(Reflect.getReflection(K).kind);')).toBe('primitive');
  expect(evaluated('class A { } class B extends A { } String(Reflect.getReflection(B).kind);')).toBe('primitive');
});

test('and `typeof` is untouched', () => {
  // The constraint that rules out attaching the record.
  expect(evaluated('class K { } typeof K;')).toBe('function');
  expect(evaluated('class Box<T> { v: T; } typeof Box;')).toBe('function');
  // While every other type object reports "object", as the spec requires.
  expect(evaluated('typeof uint8;')).toBe('object');
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
