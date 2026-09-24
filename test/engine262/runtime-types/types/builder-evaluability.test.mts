import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-computed-types.
 *
 * A |ComputedType|'s "call must be compile-time evaluable", and "a call that is
 * not evaluable, that completes abruptly, or that does not produce a Type
 * Object is a type error".
 *
 * A builder naming ambient state was refused only where its annotation ran,
 * and never in a signature nothing called. A builder that threw an Error object
 * was not evaluated by the checking pass at all, because it names `Error`, so
 * its throw escaped at run time as the program's own exception.
 */

test('a builder naming ambient state is refused where a type position calls it', () => {
  expectStaticTypeError('function b() { return Date.now() > 0 ? uint8 : string; } function g(x: b()) {}');
  expectStaticTypeError('function b() { return Date.now() > 0 ? uint8 : string; } type T = b();');
  expectStaticTypeError('function b() { globalThis.x = 1; return uint8; } type T = b();');
});

test('a builder that throws an error object is a type error', () => {
  expectStaticTypeError('function boom() { throw new Error("x"); } type T = boom();');
  expectStaticTypeError('function boom() { throw new RangeError("r"); } type T = boom();');
});

test('pure builders, shadowed names, and builders that construct errors without throwing are unchanged', () => {
  expect(evaluated('function b() { return uint8; } type T = b(); let v: T = 3; String(v);')).toBe('3');
  expect(evaluated('function b() { const Date = 1; return Date === 1 ? uint8 : string; } type T = b(); let v: T = 3; String(v);')).toBe('3');
  expect(evaluated('function b() { const e = new Error("x"); return uint8; } type T = b(); let v: T = 1; String(v);')).toBe('1');
});
