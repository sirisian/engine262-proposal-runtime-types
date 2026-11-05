import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * #sec-equality-and-comparison: a comparison produces a Boolean whatever its
 * operands' types, so where the checker cannot see them it answers by
 * mathematical value, as equality answers, rather than throwing: against a
 * literal its other operand's type cannot hold, against an operand of another
 * numeric type, and after ToNumeric against a String, a Boolean, null or
 * undefined. A literal is read at the value its source text denotes. Where
 * the checker sees the types, the early errors stay; arithmetic still throws.
 */
const untyped = (setup: string, expression: string): string => evaluated(`${setup} function g(i) { return ${expression}; } String(g(v));`);
const pair = (setup: string, expression: string, argument: string): string => evaluated(`${setup} function g(p, q) { return ${expression}; } String(g(v, ${argument}));`);
const U = 'let v: uint8 = 5;';

test('a literal its type cannot hold answers by mathematical value', () => {
  for (const [expression, answer] of [['i > 300', 'false'], ['300 < i', 'false'], ['i >= 256', 'false'], ['i <= -1', 'false'], ['i < 1.5', 'false'],
    ['i > -1', 'true'], ['i < 300', 'true'], ['i > 255', 'false'], ['i < 6', 'true']] as const) {
    expect(untyped(U, expression), expression).toBe(answer);
  }
});

test('every numeric type answers, a float literal rounding into range first', () => {
  expect(untyped('let v: int8 = -5;', 'i < -200')).toBe('false');
  expect(untyped('let v: int8 = -5;', 'i > 200')).toBe('false');
  expect(untyped('let v: uint16 = 5;', 'i > 70000')).toBe('false');
  expect(untyped('let v: int32 = 5;', 'i > 3000000000')).toBe('false');
  expect(untyped('let v: uint32 = 5;', 'i < -1')).toBe('false');
  expect(untyped('let v: int64 = 5;', 'i > 1e20')).toBe('false');
  expect(untyped('let v: float32 = 1;', 'i > 1e39')).toBe('false');
  expect(untyped('let v: float32 = 1;', 'i < -1e39')).toBe('false');
  expect(untyped('let v: float32 = 1;', 'i > 0.1')).toBe('true');
  expect(untyped('let v: float16 = 1;', 'i > 70000')).toBe('false');
  expect(untyped('let v: float16 = 1;', 'i > 65504')).toBe('false');
});

test('a decimal compares exactly, a literal read from its source text', () => {
  expect(untyped('let v: decimal128 = 1.0;', 'i > 0.1')).toBe('true');
  expect(untyped('let v: decimal128 = 0.1;', 'i >= 0.1')).toBe('true');
  expect(untyped('let v: decimal128 = 0.1;', 'i > 0.1')).toBe('false');
  expect(untyped('let v: decimal128 = 1.0;', 'i > 1e7000')).toBe('false');
  expect(untyped('let v: decimal128 = 1.0;', 'i > 1e1000000000')).toBe('false');
});

test('an operand of another numeric type, or a Number that is no literal, answers', () => {
  expect(pair(U, 'p < q', '300')).toBe('true');
  expect(pair(U, 'p < q', '4')).toBe('false');
  expect(pair(`${U} let w: int8 = 5;`, 'p < q', 'w')).toBe('false');
  expect(pair(`${U} let w: int8 = 5;`, 'p <= q', 'w')).toBe('true');
  expect(pair(U, 'p < q', '6n')).toBe('true');
  expect(pair(U, 'p < q', '5n')).toBe('false');
  expect(pair(U, 'p < q', 'NaN')).toBe('false');
  expect(pair(U, 'p < q', 'Infinity')).toBe('true');
});

test('a String, Boolean, null or undefined operand is converted as the base language converts it', () => {
  expect(pair(U, 'p < q', "'6'")).toBe('true');
  expect(pair(U, 'p < q', "'x'")).toBe('false');
  expect(pair(U, 'p < q', 'null')).toBe('false');
  expect(pair(U, 'p > q', 'null')).toBe('true');
  expect(pair(U, 'p < q', 'undefined')).toBe('false');
  expect(pair(U, 'p >= q', 'undefined')).toBe('false');
  expect(pair(U, 'p < q', 'true')).toBe('false');
  expect(pair(U, 'p > q', 'true')).toBe('true');
});

test('where the checker sees the types the early errors stay, and arithmetic still throws', () => {
  expectStaticTypeError(`${U} v > 300;`);
  expectStaticTypeError(`${U} 300 < v;`);
  expectStaticTypeError(`${U} let w: int8 = 5; v < w;`);
  expectThrown(`${U} function g(i) { return i + 300; } g(v);`, 'is not in the range of');
  expect(evaluated(`${U} let q: any = v; String(q > 300);`)).toBe('false');
});

test('a clause callback over a value generic answers at specialization', () => {
  expectThrown('function k<N: uint8>() where [N].some((i) => i > 300) { return 1; } function h<M: uint8>() { return k.<M>(); } h.<5>();',
    'is not satisfied by this application');
});
