import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-computed-constraints.
 *
 * "Parameters bind left to right", and a constraint or default "may be a
 * |ComputedType| that reads parameters declared earlier in the same
 * |TypeParameterList|. It is a type error for it to read the parameter it
 * belongs to or one declared later in the list."
 *
 * Neither was refused. A forward read was resolved at each CALL, which binds the
 * later parameter first - the one order the declaration does not have - and a
 * self read through `keyof` resolved to `never`, surfacing as a refused
 * argument at a call rather than as a mistake in the declaration.
 */

test('a constraint or default may not read a later parameter', () => {
  expectStaticTypeError('function f<K: keyof T, T>(k: K, x: T): K { return k; }');
  expectStaticTypeError('class Box<K: keyof T, T> { }');
  expectStaticTypeError('function g<T = U, U = uint8>(x: T) {}');
  // A later parameter's name is the parameter's even where an outer binding of
  // that name exists: the list, not the enclosing scope, owns the name.
  expectStaticTypeError('type T = { a: uint8 }; function h<K: keyof T, T>(k: K, x: T): K { return k; }');
});

test('an evaluated constraint or any default may not read its own parameter', () => {
  expectStaticTypeError('function f<T: keyof T>(x: T): T { return x; }');
  expectStaticTypeError('function g<T = [T]>(x: T) {}');
});

test('earlier parameters, F-bounds and inner binders are admitted', () => {
  expect(evaluated('function f<T, K: keyof T>(x: T, k: K): K { return k; } f({ a: 1 }, "a");')).toBe('a');
  // `T: Ordered.<T>` is the F-bounded constraint the design writes for
  // NumberBounds (primitivemetadata.md), checked once T has its binding.
  expect(evaluated('interface Ordered<T> { operator<(other: T): boolean; } '
    + 'type NB<T: Ordered.<T>> = { nonZero?: boolean }; "ok";')).toBe('ok');
  // A name a binder inside the constraint declares is that binder's.
  expect(evaluated('function q<F: <T>(x: T) => T, T>(f: F, t: T) {} "ok";')).toBe('ok');
});
