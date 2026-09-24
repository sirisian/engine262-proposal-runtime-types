import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-unary-operators-for-typed-values. "Unary `+` returns its operand
 * unchanged when the operand is a value of a numeric type of this proposal. It
 * continues to throw a TypeError for a BigInt, and continues to apply ToNumber
 * otherwise." #sec-numeric-types names the families: "Each integer, binary
 * floating-point, decimal floating-point, rational, complex, and vector type".
 *
 * The guard named four families and left out complex, so `+c` reached ToNumber
 * and answered NaN - a silent wrong value. Every family is now one membership
 * test, so each is checked here.
 */

const plus = (operand: string) =>
  `const x = ${operand}; String(+x) + ' [' + String(Reflect.typeOf(+x)) + ']';`;

test('complex returns itself, with its type', () => {
  expect(evaluated(plus('(3 := complex64)'))).toBe('3+0i [complex.<float32>]');
  expect(evaluated(plus('(2.5 := complex128)'))).toBe('2.5+0i [complex.<float64>]');
});

test('every other family of the proposal returns itself, with its type', () => {
  expect(evaluated(plus('rational(3, 4)'))).toBe('3/4 [rational]');
  expect(evaluated(plus('(5 := uint8)'))).toBe('5 [uint.<8>]');
  // Exactly - through ToNumber this would round to ...992.
  expect(evaluated(plus("(BigInt('9007199254740993') := int64)"))).toBe('9007199254740993 [int.<64>]');
  expect(evaluated(plus('(1.5 := float32)'))).toBe('1.5 [float32]');
  // A decimal keeps its cohort member.
  expect(evaluated(plus("decimal64('1.50')"))).toBe('1.50 [decimal64]');
  expect(evaluated('const v = float32x4(1, 2, 3, 4); String(Reflect.typeOf(+v));')).toBe('vector.<float32, 4>');
});

test('existing JavaScript is unchanged', () => {
  // Everything else still applies ToNumber, and a BigInt still throws.
  expect(evaluated(plus('5'))).toBe('5 [number]');
  expect(evaluated(plus("'5'"))).toBe('5 [number]');
  expect(evaluated(plus('true'))).toBe('1 [number]');
  expect(evaluated(plus('new Date(0)'))).toBe('0 [number]');
  expectThrownKind('let v: any = 5n; +v;', 'TypeError');
});

test('a Number is had from a proposal type by explicit conversion', () => {
  // Unary `+` is not the coercion idiom for these types; the conversion is.
  expect(evaluated('String(float64(rational(1, 4)));')).toBe('0.25');
});
