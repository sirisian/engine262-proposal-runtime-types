import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-ispermittedvaluedomain.
 *
 * A value domain is a primitive other than `type`, an enumeration or literal
 * type, a union of such, or a meta type's constraint shape; "No other object
 * type is a value domain". Functions, classes and interfaces were refused; the
 * `object` type, an object shape and a union containing one were accepted.
 *
 * An array or tuple whose elements are value domains stays admitted: its
 * argument binds by the literal type of its value (#sec-parameter-kinds), the
 * tuple of its elements' literal types, which is content rather than an
 * object's identity. One holding objects is refused.
 */

test('a domain whose values are objects is refused', () => {
  expectStaticTypeError('function f<T: object>() {}');
  expectStaticTypeError('class C<T: object> {}');
  expectStaticTypeError('function f<T: { a: uint8 }>() {}');
  expectStaticTypeError('function f<T: uint8 | object>() {}');
  expectStaticTypeError('function f<T: [].<object>>() {}');
});

test('value domains, arrays of them, value packs and meta shapes are admitted', () => {
  expect(evaluated('function f<V: 1 | 2>(): string { return String(V); } f.<2>();')).toBe('2');
  expect(evaluated('function f<T: [].<uint8>>(t: T): T { return t; } let g: any = f; String(g([1])[0]);')).toBe('1');
  expect(evaluated('function f<...I: [].<uint32>>() { return 1; } String(f.<1, 2>());')).toBe('1');
  expect(evaluated('type P = { phase: int32 }; meta P { default = { phase: 0 }; subtype(a: P, b: P): boolean { return true; } } '
    + 'function f<M: P>() { return 1; } "ok";')).toBe('ok');
});
