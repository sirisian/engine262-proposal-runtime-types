import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Question BS: "An untyped numeric literal at a union is adapted toward the
 * member it FITS, by the rule SelectUnionMember applies to a value"
 * (#sec-literal-propagation), and "Where no member accepts the value the
 * literal is refused, as it is at a single type". A literal at a union with a
 * decimal, a rational, a `float128` or a complex member was left a Number for
 * the boundary: `let d: decimal64 | null = 0.1` and `= 5` were errors, a
 * `float128 | null` and a `rational64 | null` took the double's value, and
 * `1e30` at `rational64 | string` was stored as the string "1e+30".
 */

const at = (type: string, value: string) => `const d: ${type} = ${value}; String(d) + " " + String(Reflect.typeOf(d));`;

test('a literal takes the member it fits, exactly', () => {
  expect(evaluated(at('decimal64 | null', '0.1'))).toBe('0.1 decimal64');
  expect(evaluated(at('decimal64 | null', '5'))).toBe('5 decimal64');
  expect(evaluated(at('decimal64 | string', '1.50'))).toBe('1.50 decimal64');
  expect(evaluated(at('rational64 | null', '0.1'))).toBe('1/10 rational64');
  expect(evaluated(at('float128 | null', '0.1'))).toBe('0.1 float128');
  expect(evaluated(at('complex128 | null', '0.1'))).toBe('0.1+0i complex128');
  // A constant is computed in the member, as at the member alone.
  expect(evaluated(at('decimal64 | null', '0.1 + 0.2'))).toBe('0.3 decimal64');
  expect(evaluated(at('rational64 | null', '1 / 3'))).toBe('1/3 rational64');
  expect(evaluated('const K = 0.1; const d: decimal64 | null = K; String(d);')).toBe('0.1');
});

test('in every position a literal meets a union', () => {
  expect(evaluated('function f(x: decimal64 | null) { return String(x); } f(0.1);')).toBe('0.1');
  expect(evaluated('function f(): decimal64 | null { return 0.1; } String(f());')).toBe('0.1');
  expect(evaluated('let d: decimal64 | null = null; d = 0.1; String(d);')).toBe('0.1');
  expect(evaluated('const a: [].<decimal64 | null> = [0.1]; String(a[0]);')).toBe('0.1');
  expect(evaluated('const o: { p: decimal64 | null } = { p: 0.1 }; String(o.p);')).toBe('0.1');
  expect(evaluated('function f(x: decimal64 | null = 0.1) { return String(x); } f();')).toBe('0.1');
});

test('the member holding the value exactly is chosen, an integer one first', () => {
  const kind = (type: string, value: string) => evaluated(`const d: ${type} = ${value}; String(Reflect.typeOf(d));`);
  expect(kind('uint8 | decimal64', '5')).toBe('uint.<8>');
  expect(kind('uint8 | decimal64', '300')).toBe('decimal64');
  expect(kind('uint8 | decimal64', '0.5')).toBe('decimal64');
  expect(kind('float32 | decimal64', '0.1')).toBe('decimal64');
  expect(kind('decimal64 | rational64', '1 / 3')).toBe('rational64');
  expect(kind('decimal32 | decimal64', '12345679')).toBe('decimal64');
  // A Number is of `number`, and stays one.
  expect(kind('number | decimal64', '0.1')).toBe('number');
});

test('at every numeric union, the literal is read from its digits', () => {
  expect(evaluated('const d: uint64 | null = 9007199254740993; String(d);')).toBe('9007199254740993');
  expect(evaluated('const d: int64 | string = 2 ** 53 + 1; String(d);')).toBe('9007199254740993');
  // Rounded once to the member, as at the member alone.
  expect(evaluated('const d: float32 | null = 16777217.0000000001; String(d);')).toBe('16777218');
  // The member is the type's, however the union is spelled.
  expect(evaluated('const a: float32 | float16 = 0.1; const b: float16 | float32 = 0.1; String(Reflect.typeOf(a)) + " " + String(Reflect.typeOf(b));')).toBe('float16 float16');
  expect(evaluated('const d: float32 | float64 = 0.1; String(Reflect.typeOf(d));')).toBe('float64');
});

test('a case label over a union holds what a member holds', () => {
  // It was refused as a test that can never succeed.
  expect(evaluated('function f(x: decimal64 | decimal128) { switch (x) { case 0.1: return "hit"; } return "miss"; } f(decimal128.parse("0.1"));')).toBe('hit');
  expectThrown('function f(x: decimal32 | decimal64) { switch (x) { case 1e400: return 1; } return 0; }', 'the "1e400" test can never succeed');
});

test('a literal no member takes is refused, named as it is written', () => {
  expectThrown('const d: decimal64 | string = 1e400;', '"1e400" is not in the range of "decimal64 | string"');
  expectThrown('const d: rational64 | string = 1e30;', '"1e30" is not in the range of "rational64 | string"');
  expectThrown('const d: decimal32 | null = 12345679;', '"12345679" is not in the range of "decimal32 | null"');
  expectThrown('const d: decimal64 | uint8 = 1e400;', '"1e400" is not in the range of "decimal64 | uint.<8>"');
  expectThrown('const d: decimal64 | string = 1e400 * 1;', '"1e400 * 1" is not in the range of "decimal64 | string"');
  expectThrown('const d: decimal64 | null = Math.PI;', '"Math.PI" is not assignable to "decimal64 | null"');
});
