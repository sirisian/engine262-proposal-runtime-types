import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Question BA: a numeric literal takes the type of a rational, a complex and a
 * `float128` beside it, as it takes every other numeric type's
 * (#sec-literalvalueintype has a row for each): in a pattern, at the
 * pattern's position; and in arithmetic, a comparison, an equality, a `case`
 * label and `Object.is`, at the other operand's type, where the checker knew
 * it and, when the type is known only from the value, when the expression
 * runs (#sec-arithmetic-never-promotes). The run time took a literal beside a
 * typed integer and a decimal only, and the pattern judgment asked a
 * position's `typeof`, which is "object" for a rational and a complex.
 */

test('a float128 takes a literal over its whole range', () => {
  // The run time read a literal's digits to an exponent of 4096 only, and a
  // binary128's exponents reach 4932 above and past -4950 below.
  expect(evaluated('function f(a) { return a === 1e4500; } String(f(float128.parse("1e4500")));')).toBe('true');
  expect(evaluated('function f(a) { switch (a) { case 1e4500: return "y"; } return "n"; } f(float128.parse("1e4500"));')).toBe('y');
  expect(evaluated('function f(a) { return a + 1e-4500 === float128.parse("1e-4500"); } String(f(float128(0)));')).toBe('true');
});

test('a literal pattern takes a rational or a complex position', () => {
  const R = 'function f(k: rational64) { return ';
  expect(evaluated(`${R}k is 1; } String(f(rational64(1))) + String(f(rational64(2)));`)).toBe('truefalse');
  expect(evaluated(`${R}k is 0.5; } String(f(rational64(1, 2)));`)).toBe('true');
  expect(evaluated(`${R}k is -2; } String(f(rational64(-2)));`)).toBe('true');
  expect(evaluated(`${R}match (k) { when 1 or 2: "small"; when _: "other"; }; } f(rational64(2)) + f(rational64(3));`)).toBe('smallother');
  expect(evaluated('function f(k: complex64) { return match (k) { when 1: "one"; when _: "other"; }; } f(complex64(1)) + f(complex64(1, 2));')).toBe('oneother');
});

test('a case label takes the discriminant\'s type, typed or not', () => {
  const S = (type: string, value: string) => `function f(k${type}) { switch (k) { case 1: return "one"; case 0.5: return "half"; } return "none"; } f(${value});`;
  expect(evaluated(S(': rational64', 'rational64(1, 2)'))).toBe('half');
  expect(evaluated(S('', 'rational64(1)'))).toBe('one');
  expect(evaluated(S(': complex64', 'complex64(1)'))).toBe('one');
  expect(evaluated(S(': complex64', 'complex64(1, 2)'))).toBe('none');
  expect(evaluated(S(': float128', 'float128(1)'))).toBe('one');
  expect(evaluated(S('', 'float128(0.5)'))).toBe('half');
});

test('beside a value whose type only the run time knows, a literal is read from its digits', () => {
  const U = (value: string, body: string) => `function f(a) { return ${body}; } String(f(${value}));`;
  expect(evaluated(U('rational64(1, 10)', 'a === 0.1'))).toBe('true');
  expect(evaluated(U('rational64(1, 2)', 'a + 1'))).toBe('3/2');
  expect(evaluated(U('rational64(1)', 'a / 3'))).toBe('1/3');
  expect(evaluated(U('rational64(1, 2)', 'a < 1'))).toBe('true');
  expect(evaluated(U('float128(0.1)', 'a === 0.1'))).toBe('true');
  expect(evaluated(U('float128(4)', 'a ** 0.5'))).toBe('2');
  expect(evaluated(U('decimal128.parse("19.99")', 'a * 3'))).toBe('59.97');
  expect(evaluated(U('decimal64(3)', '2 ** a'))).toBe('8');
  expect(evaluated(U('complex64(1)', 'a === 1'))).toBe('true');
  expect(evaluated(U('rational64(5)', 'Object.is(a, 5)'))).toBe('true');
  // A literal the type cannot hold equals none of its values.
  expect(evaluated(U('rational64(1)', 'a === 1e30'))).toBe('false');
});

test('a binding adopts nothing, and a count is taken as written', () => {
  expect(evaluated('function f(a, n) { return a === n; } String(f(rational64(1), 1));')).toBe('false');
  expectThrownKind('function f(a, n) { return a + n; } f(rational64(1), 1);', 'TypeError');
  expect(evaluated('function f(a) { return a ** 2; } String(f(rational64(1, 2))) + " " + String(f(decimal64(3)));')).toBe('1/4 9');
});

test('a literal type in a type pattern takes a rational, a complex or a bigint member', () => {
  expect(evaluated('function f(o: { a: rational64 }) { return o is { a: 0.5 }; } String(f({ a: rational64(1, 2) }));')).toBe('true');
  expect(evaluated('function f(o: { a: complex64 }) { return o is { a: 1 }; } String(f({ a: complex64(1) }));')).toBe('true');
  expect(evaluated('function f(o: { a: bigint }) { return o is { a: 1 }; } String(f({ a: 1n })) + String(f({ a: 2n }));')).toBe('truefalse');
});

test('a literal base takes a rational exponent\'s type, as a decimal one\'s', () => {
  // Question BG: the checker took the literal in `2 ** q` for an exponent,
  // and a rational's exponent is a count, so it stayed a Number.
  expect(evaluated('function f(q: rational64) { return 2 ** q; } String(f(3));')).toBe('8');
  expect(evaluated('function f(q) { return 2 ** q; } String(f(rational64(3)));')).toBe('8');
  expectThrownKind('function f(q: rational64) { return 2 ** q; } f(rational64(1, 2));', 'RangeError');
  expect(evaluated('function f(q: rational64) { return q ** 2; } String(f(rational64(1, 2)));')).toBe('1/4');
});

test('a compound assignment takes the literal as its desugaring does', () => {
  const C = (op: string, value: string) => `function f(a) { a ${op}; return a; } String(f(${value}));`;
  expect(evaluated(C('+= 0.1', 'decimal64(1)'))).toBe('1.1');
  expect(evaluated(C('+= 1', 'rational64(1, 2)'))).toBe('3/2');
  expect(evaluated(C('/= 3', 'rational64(1)'))).toBe('1/3');
  expect(evaluated(C('+= 1', 'float128(1)'))).toBe('2');
  expect(evaluated(C('**= 0.5', 'float128(4)'))).toBe('2');
  expect(evaluated(C('+= 1', 'complex64(1, 2)'))).toBe('2+2i');
  expect(evaluated(C('**= 2', 'decimal64(3)'))).toBe('9');
  expectThrownKind('function f(a, n) { a += n; return a; } f(decimal64(1), 1);', 'TypeError');
  // A complex target refused the literal in typed code too, where `a = a * 0.5` ran.
  expect(evaluated('function f(a: complex64) { a *= 0.5; return a; } String(f(complex64(1, 2)));')).toBe('0.5+1i');
  expect(evaluated('const o: { c: complex64 } = { c: complex64(1, 2) }; o.c += 1; String(o.c);')).toBe('2+2i');
});
