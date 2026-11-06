import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * Literal rules the specification already decides, at run time and in the
 * checker: a decimal takes a literal at the exact value its source text
 * denotes (#sec-literalvalueintype) in every equality and `case` label
 * (#sec-arithmetic-never-promotes); `==` converts a String or Boolean beside a
 * typed value as it does beside a Number (#sec-equality-and-comparison); and a
 * shift distance or an exponent keeps its own context, taken as written
 * (#sec-integer-operations).
 */
const D = 'let v: decimal128 = 0.2;';

test('a decimal takes an equality literal at its exact value, in typed and untyped code', () => {
  expect(evaluated(`${D} function g(i) { return i === 0.2; } String(g(v));`)).toBe('true');
  expect(evaluated(`${D} function g(i) { return i == 0.2; } String(g(v));`)).toBe('true');
  expect(evaluated(`${D} function g(i) { return i !== 0.2; } String(g(v));`)).toBe('false');
  expect(evaluated(`${D} function g(i) { switch (i) { case 0.2: return 'hit'; } return 'miss'; } g(v);`)).toBe('hit');
  expect(evaluated(`${D} function g(i) { return i === 0.3; } String(g(v));`)).toBe('false');
});

test('a decimal case label is judged at its exact value', () => {
  expect(evaluated("let v: decimal128 = 1.0; let r = 'miss'; switch (v) { case 1.0: r = 'hit'; } r;")).toBe('hit');
  expect(evaluated("let v: decimal128 = 1.0; let r = 'miss'; switch (v) { case 1.00: r = 'hit'; } r;")).toBe('hit');
});

test('== converts a String or Boolean beside a typed value', () => {
  const pair = (setup: string, expression: string, argument: string) => evaluated(`${setup} function g(p, q) { return ${expression}; } String(g(v, ${argument}));`);
  expect(pair('let v: uint8 = 5;', 'p == q', "'5'")).toBe('true');
  expect(pair('let v: uint8 = 5;', 'p != q', "'5'")).toBe('false');
  expect(pair('let v: uint8 = 5;', 'p == q', "' 5 '")).toBe('true');
  expect(pair('let v: uint8 = 5;', 'p == q', "'x'")).toBe('false');
  expect(pair('let v: uint8 = 1;', 'p == q', 'true')).toBe('true');
  expect(pair('let v: int64 = 5;', 'p == q', "'5'")).toBe('true');
});

test('a shift distance and an exponent keep their own context', () => {
  const untyped = (setup: string, expression: string) => evaluated(`${setup} function g(i) { return ${expression}; } String(g(v));`);
  expect(untyped('let v: uint8 = 5;', 'i << 300')).toBe('0');
  expect(untyped('let v: uint8 = 5;', 'i << 3')).toBe('40');
  expect(untyped('let v: int8 = -5;', 'i >> 300')).toBe('-1');
  expect(untyped('let v: uint8 = 2;', 'i ** 300')).toBe('0');
  expect(untyped('let v: uint8 = 2;', 'i ** 3')).toBe('8');
  expectThrown('let v: uint8 = 5; function g(i, k) { return i << k; } g(v, -1);', 'negative');
  expectStaticTypeError('let v: uint8 = 5; v << 300;');
});

test("an array literal's search methods take a literal at its element type", () => {
  // #sec-array-literal-static-type gives `[v]` the element type of `v`, and
  // #sec-array-defaults-and-stores reads `includes`, `indexOf` and
  // `lastIndexOf` at it, a literal argument adopting.
  for (const [type, literal] of [['uint8', '5'], ['int8', '5'], ['uint16', '5'], ['int32', '5'], ['uint32', '5'], ['int64', '5'],
    ['float32', '0.5'], ['float16', '0.5'], ['float64', '0.5'], ['decimal128', '1.0']] as const) {
    expect(evaluated(`let v: ${type} = ${literal}; String([v].includes(${literal})) + ' ' + String([v].indexOf(${literal})) + ' ' + String([v].lastIndexOf(${literal}));`), type).toBe('true 0 0');
  }
  expect(evaluated('let v: uint8 = 5; let w: uint8 = 7; String([v, w].indexOf(7));')).toBe('1');
  expect(evaluated('let v: uint8 = 5; let n = 5; String([v].includes(n));')).toBe('false');
  expectStaticTypeError('let v: uint8 = 5; [v].includes(300);');
});

test('a comparison of a typed value with a value of another type throws where the checker cannot see it', () => {
  // #sec-arithmetic-never-promotes reaches comparison as it reaches arithmetic;
  // only equality and `case` are excepted. A literal the type cannot hold
  // cannot become its value, and a Number of another type does not mix.
  expectThrown('let v: uint8 = 5; function g(i) { return i > 300; } g(v);', 'range');
  expectThrown('let v: uint8 = 5; function g(p, q) { return p < q; } g(v, 4);', 'do not mix');
  // A decimal takes an in-range literal at its exact value, so it answers.
  expect(evaluated('let v: decimal128 = 1.0; function g(i) { return i > 0.1; } String(g(v));')).toBe('true');
  expect(evaluated('let v: decimal128 = 0.1; function g(i) { return String(i >= 0.1) + " " + String(i > 0.1); } g(v);')).toBe('true false');
});
