import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * A signed literal is recognised through its parentheses: `-(0.5)` is `-0.5`.
 *
 * The unary rule typed `-lit` as a literal only when the literal was its direct
 * operand, so `let v: float32 = -(0.5)` was refused as a Number while `-0.5`,
 * `(-0.5)` and `-(0.5 + 0.25)` were accepted. Parentheses change nothing about a
 * value.
 */

const decl = (type: string, init: string) => evaluated(`let v: ${type} = ${init}; String(v);`);

test('a parenthesized signed literal takes the declared type', () => {
  expect(decl('float32', '-(0.5)')).toBe('-0.5');
  expect(decl('float32', '+(0.5)')).toBe('0.5');
  expect(decl('float32', '-((0.5))')).toBe('-0.5');
  expect(decl('float64', '-(0.5)')).toBe('-0.5');
  expect(decl('complex64', '-(0.5)')).toBe('-0.5+0i');
});

test('it is rounded once, like any literal', () => {
  expect(decl('float32', '-(16777217.0000000001)')).toBe('-16777218');
});

test('what a literal cannot be is still refused', () => {
  expectStaticTypeError('let v: uint8 = -(5);');
  expectStaticTypeError('let v: float16 = -(70000);');
});
