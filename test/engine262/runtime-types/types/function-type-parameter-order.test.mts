import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-function-types, with #sec-named-arguments.
 *
 * A required parameter may not follow a defaulted one in a function type where
 * no call could reach it: an UNNAMED parameter is reached only positionally,
 * and a call that reaches it has filled the defaulted position too, so the
 * default could never be taken. A NAMED one is filled by a named argument and
 * leaves the default to be taken - the shape of the clause's own example,
 * `(string = '5', named: uint32)`.
 */

test('an unnamed required parameter may not follow a defaulted one', () => {
  expectStaticTypeError('type G = (uint8 = 1, uint8) => void;');
  expectStaticTypeError('type O = { (uint8 = 1, string): void };');
  expectStaticTypeError('interface J { (uint8 = 1, string): void; }');
  expectStaticTypeError('let g: (x: (uint8 = 1, uint8) => void) => void;');
});

test('a named, optional or rest parameter may follow one', () => {
  expect(evaluated('type F = (a: uint8 = 1, b: uint8) => void; "ok";')).toBe('ok');
  expect(evaluated('interface I { (string = \'5\', named: uint32): void; } "ok";')).toBe('ok');
  expect(evaluated('type H = (uint8 = 1, ...[].<uint8>) => void; "ok";')).toBe('ok');
  expect(evaluated('type K = (uint8 = 1, b?: uint8) => void; "ok";')).toBe('ok');
});

test('a function declaration is ordinary JavaScript and unchanged', () => {
  expect(evaluated('function f(a = 1, b) { return b; } String(f(2, 3));')).toBe('3');
});
