import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * A literal at a narrow binary float rounds ONCE, from its digits.
 *
 * #sec-literalvalueintype: "the mathematical value denoted by the literal ...
 * before any rounding", rounded "to the nearest value of _t_, with ties to even".
 * Reading the double the lexer made and converting it rounded twice, and the
 * second rounding can land on the other neighbour: the decimal
 * 16777217.0000000001 lies just above the midpoint of the float32s 16777216 and
 * 16777218, but its double is exactly that midpoint, which rounds to even. C
 * draws the same line: `16777217.0000000001f` is 16777218, while
 * `(float)16777217.0000000001` - a double converted - is 16777216.
 */

const spellings = (type: string, lit: string) => [
  `let v: ${type} = ${lit}; String(v);`, `String(${type}(${lit}));`, `String(${lit} := ${type});`,
];

test('a literal rounds once, in every spelling and with either sign', () => {
  for (const src of spellings('float32', '16777217.0000000001')) expect(evaluated(src)).toBe('16777218');
  for (const src of spellings('float32', '-16777217.0000000001')) expect(evaluated(src)).toBe('-16777218');
  for (const src of spellings('float16', '2049.0000000000001')) expect(evaluated(src)).toBe('2050');
  for (const src of spellings('float16', '-2049.0000000000001')) expect(evaluated(src)).toBe('-2050');
});

test('a float value keeps its earlier rounding, as a C cast does', () => {
  // A `let`: a value. (A `const` bound to the literal would be a named literal,
  // which #sec-static-type-of-an-expression makes the literal itself, rounded
  // once - see named-constant-as-inlined.test.mts.)
  expect(evaluated('let x = 16777217.0000000001; String(float32(x));')).toBe('16777216');
});

test('ordinary literals, the boundaries, and the formats around them', () => {
  expect(evaluated('let v: float32 = 16777217; String(v);')).toBe('16777216'); // an exact tie, to even
  expect(evaluated('let v: float32 = 0.1; String(v);')).toBe('0.10000000149011612');
  expect(evaluated('let v: float32 = 3.4028235e38; String(v);')).toBe('3.4028234663852886e+38');
  expect(evaluated('let v: float32 = 1e-45; String(v);')).toBe('1.401298464324817e-45'); // subnormal
  expect(evaluated('let v: float32 = 7e-46; String(v);')).toBe('0');
  expect(evaluated('let v: float16 = 0.1; String(v);')).toBe('0.0999755859375');
  expect(evaluated('let v: float64 = 0.1; String(v);')).toBe('0.1');
  expect(evaluated('let v: float32 = 0x10; String(v);')).toBe('16');
});

test('a literal that rounds to an infinity is unrepresentable; a conversion is not', () => {
  // "If _v_ is an infinity and _mv_ is finite, return ~unrepresentable~."
  expectStaticTypeError('let v: float32 = 1e40;');
  expectStaticTypeError('let v: float16 = 65520;'); // the tie at the top rounds to even: infinite
  // A conversion "does not fail merely because information is lost".
  expect(evaluated('String(float32(1e40));')).toBe('Infinity');
  expect(evaluated('String(1e40 := float32);')).toBe('Infinity');
});
