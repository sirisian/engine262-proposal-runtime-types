import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-composite-function.
 *
 * "It is a type error if the argument is not an ~object~, ~tuple~, ~array~, or
 * interface type, or if it has a Symbol-keyed member, since a composite's keys
 * are Strings."
 *
 * The application was accepted whatever its argument: `Composite.<uint8>`
 * resolved, and calling it failed at run time with "1 is not an object".
 */

test('the argument must be an object, tuple, array or interface type', () => {
  expectStaticTypeError('Composite.<uint8>;');
  expectStaticTypeError('let c: Composite.<uint8> | null = null;');
  expectStaticTypeError('class K { x: uint8 = 0; } Composite.<K>;');
});

test('the argument may not have a Symbol-keyed member', () => {
  expectStaticTypeError('Composite.<{ [Symbol.iterator]: uint8 }>;');
  expectStaticTypeError('interface I { [Symbol.iterator](): uint8; } Composite.<I>;');
});

test('object, tuple, array, interface and generic arguments are admitted', () => {
  expect(evaluated('const C = Composite.<{ x: uint8 }>; String(C({ x: 1 }).x);')).toBe('1');
  expect(evaluated('const T = Composite.<[uint8, uint8]>; String(T([1, 2])[1]);')).toBe('2');
  expect(evaluated('const A = Composite.<[].<uint8>>; String(A([1, 2, 3]).length);')).toBe('3');
  expect(evaluated('interface P { x: uint8; } const Q = Composite.<P>; String(Q({ x: 2 }).x);')).toBe('2');
  expect(evaluated('function f<T: type>(x: T) { return Composite.<T>; } "ok";')).toBe('ok');
});
