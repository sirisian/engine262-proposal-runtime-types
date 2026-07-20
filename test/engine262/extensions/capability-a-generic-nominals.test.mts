import { test, expect } from 'vitest';
import { evaluated, ok, bool } from '../readme/harness.mts';

/**
 * Capability A — nominal-generic instantiation with argument-preserving reflection.
 *
 * A generic nominal type applied to type arguments (`Promise.<uint32>`,
 * `Box.<uint32>`) is a distinct interned type carrying its arguments, and a
 * builder can take it apart and put it back together: reflection exposes a
 * `generic` view ({ base, arguments }) whose base is the bare declaration's type
 * and whose arguments are the applied type objects, and `Reflect.makeType({ kind:
 * 'generic', base, arguments })` reconstructs the same interned type.
 *
 * This works uniformly for the built-in library nominal `Promise` and for
 * user-declared generic classes/interfaces. Instantiations are referenced through
 * type position (a type alias or annotation); a name in expression position is the
 * value (the constructor), which is a separate thing from the type object.
 */

// -- Library nominal: Promise --------------------------------------------------
test('capability A: Promise.<T> interns distinctly by its argument', () => {
  expect(ok('type A = Promise.<uint32>; type B = Promise.<uint32>; A === B;')).toBe(true);
  expect(bool('type A = Promise.<uint32>; type B = Promise.<string>; String(A === B);')).toBe(false);
  // the bare nominal and an instantiation are distinct
  expect(bool('type BB = Promise; type A = Promise.<uint32>; String(BB === A);')).toBe(false);
});

test('capability A: Promise.<T> reflects a generic view a builder can read', () => {
  expect(evaluated('type P = Promise.<uint32>; let r = Reflect.getReflection(P); r.generic ? "yes" : "no";')).toBe('yes');
  // the argument leaf is the applied type object
  expect(ok('type P = Promise.<uint32>; Reflect.getReflection(P).generic.arguments[0] === uint32;')).toBe(true);
  // the base is the bare nominal, stable across instantiations, and equal to `Promise` in type position
  expect(ok('type PB = Promise; type P = Promise.<uint32>; Reflect.getReflection(P).generic.base === PB;')).toBe(true);
  expect(ok('type A = Promise.<uint32>; type B = Promise.<string>; Reflect.getReflection(A).generic.base === Reflect.getReflection(B).generic.base;')).toBe(true);
});

test('capability A: makeType reconstructs Promise.<T> from base and arguments', () => {
  expect(evaluated('type PB = Promise; type A = Promise.<uint32>; let X = Reflect.makeType({ kind: "generic", base: PB, arguments: [uint32] }); X === A ? "ok" : "no";')).toBe('ok');
});

// -- User generic class: Box ---------------------------------------------------
test('capability A: a user generic class instantiates distinctly by its argument', () => {
  // this is the fix: different instantiations were previously collapsing to one type
  expect(bool('class Box<T> {} type A = Box.<uint32>; type B = Box.<string>; String(A === B);')).toBe(false);
  expect(ok('class Box<T> {} type A = Box.<uint32>; type B = Box.<uint32>; A === B;')).toBe(true);
  expect(bool('class Box<T> {} type BB = Box; type A = Box.<uint32>; String(BB === A);')).toBe(false);
});

test('capability A: a user generic class exposes the same generic reflection view', () => {
  expect(evaluated('class Box<T> {} type A = Box.<uint32>; Reflect.getReflection(A).generic ? "yes" : "no";')).toBe('yes');
  expect(ok('class Box<T> {} type A = Box.<uint32>; Reflect.getReflection(A).generic.arguments[0] === uint32;')).toBe(true);
  // base is the bare class type in type position, stable across instantiations
  expect(ok('class Box<T> {} type BB = Box; type A = Box.<uint32>; Reflect.getReflection(A).generic.base === BB;')).toBe(true);
  expect(ok('class Box<T> {} type A = Box.<uint32>; type B = Box.<string>; Reflect.getReflection(A).generic.base === Reflect.getReflection(B).generic.base;')).toBe(true);
});

test('capability A: makeType reconstructs a user generic class instantiation', () => {
  expect(evaluated('class Box<T> {} type BB = Box; type A = Box.<uint32>; let X = Reflect.makeType({ kind: "generic", base: BB, arguments: [uint32] }); X === A ? "ok" : "no";')).toBe('ok');
});

// -- Two arguments -------------------------------------------------------------
test('capability A: a two-parameter generic carries both arguments in order', () => {
  expect(ok('class Pair<A, B> {} type P = Pair.<uint32, string>; let r = Reflect.getReflection(P); r.generic.arguments[0] === uint32 && r.generic.arguments[1] === string;')).toBe(true);
  // order matters for identity
  expect(bool('class Pair<A, B> {} type P = Pair.<uint32, string>; type Q = Pair.<string, uint32>; String(P === Q);')).toBe(false);
});
