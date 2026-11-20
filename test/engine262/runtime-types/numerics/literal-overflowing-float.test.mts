import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * Question BJ: #sec-literalvalueintype makes a literal unrepresentable at a
 * binary float where "_v_ is an infinity and _mv_ is finite", and
 * #sec-arithmetic-never-promotes refuses a literal the other operand's type
 * cannot hold as an operand of an arithmetic or relational operator, finds it
 * equal to nothing in an equality, and throws a RangeError where the type is
 * known only when the expression runs. A `float16` or a `float32` declaration
 * refused such a literal, and nothing else did: `x * 1e39` beside a `float32`
 * was Infinity, `const y: float64 = 1e309` and `const q: float128 = 1e5000`
 * were infinities, and beside a decimal, a rational or a `float128` that only
 * the run time knew, the literal fell to the TypeError for operands that do
 * not mix.
 */

test('a typed operand refuses a literal it rounds to an infinity', () => {
  for (const [type, big] of [['float16', '70000'], ['float32', '1e39'], ['float64', '1e309'], ['float128', '1e5000']]) {
    expectStaticTypeError(`function g(x: ${type}) { return x * ${big}; }`);
    expectStaticTypeError(`function g(x: ${type}) { return ${big} + x; }`);
    expectStaticTypeError(`function g(x: ${type}) { return x < ${big}; }`);
    expectStaticTypeError(`function g(x: ${type}) { return x - -${big}; }`);
    expectStaticTypeError(`function g(x: ${type}) { x *= ${big}; return x; }`);
  }
  expectStaticTypeError('function g(c: complex64) { return c * 1e39; }');
  expectStaticTypeError('function g(c: complex128) { return c + 1e309; }');
  expectThrown('function g(x: float32) { return x * 1e39; }', '"1e39" is not in the range of "float32"');
});

test('so does a declaration at a float64, a float128 or a complex over them', () => {
  for (const source of [
    'const x: float64 = 1e309;',
    'const x: float64 = -1e309;',
    'const x: float64 = (1e309);',
    'function g(x: float64) { return x; } g(1e309);',
    'function g(): float64 { return 1e309; }',
    'const a: [].<float64> = [1e309];',
    'const x: float128 = 1e5000;',
    'const c: complex128 = 1e309;',
    'const c: complex = 1e309;',
    'const x: float64 | null = 1e309;',
    'const x: float128 | string = -1e5000;',
  ]) expectStaticTypeError(source);
  expectThrown('const x: float64 = -1e309;', '"-1e309" is not in the range of "float64"');
  // A signed literal at a decimal is judged as the literal it signs; it was a
  // RangeError when it ran that wrote out every digit.
  expectThrown('const d: decimal64 = -1e400;', '"-1e400" is not in the range of "decimal64"');
});

test('so does a named constant or a constant expression it rounds to an infinity', () => {
  // A constant is a literal where the type beside it is known
  // (#sec-arithmetic-never-promotes): `const K = 1e39` and then `x * K` beside
  // a `float32` was Infinity, and `x * (4 * 1e38)` a RangeError when it ran.
  for (const source of [
    'const K = 1e39; function g(x: float32) { return x * K; }',
    'const K = -1e39; function g(x: float32) { return x - K; }',
    'const A = 1e39; const K = A; function g(x: float32) { return x * K; }',
    'const K = 70000; function g(x: float16) { return x < K; }',
    'function g(x: float32) { return x * (4 * 1e38); }',
    'const y: float32 = 1e38 * 10;',
    'const K = 1e39; function g(c: complex64) { return c * K; }',
    'const K = 1e309; function g(c: complex128) { return c * K; }',
    'const K = 1e309; function g(x: float64) { return x < K; }',
  ]) expectStaticTypeError(source);
  expectThrown('const K = 1e39; function g(x: float32) { return x * K; }', '"1e39" is not in the range of "float32"');
  expect(evaluated('const K = 3e38; function g(x: float32) { return x * K; } String(g(1));')).toBe(String(Math.fround(3e38)));
  expect(evaluated('const y: float32 = 2e38 + 1e38; String(y);')).toBe(String(Math.fround(3e38)));
  expect(evaluated('String(float32(1e38 * 10));')).toBe('Infinity');
});

test('what the type holds is unchanged', () => {
  expect(evaluated('const x: float64 = 1.7976931348623157e308; String(x);')).toBe('1.7976931348623157e+308');
  expect(evaluated('const x: float128 = 1e4000; String(x);')).toBe('1e+4000');
  expect(evaluated('function g(x: float32) { return x * 3e38; } String(g(1));')).toBe(String(Math.fround(3e38)));
  // A conversion rounds, and `number` is the language's own type.
  expect(evaluated('String(float64(1e309)) + String(1e5000 := float128) + String(float32(1e39));')).toBe('InfinityInfinityInfinity');
  expect(evaluated('const n: number = 1e309; String(n);')).toBe('Infinity');
  expect(evaluated('const n: float64 | number = 1e309; String(n);')).toBe('Infinity');
});

test('an equality finds it equal to nothing', () => {
  expect(evaluated('function g(x: float64) { return x === 1e309; } String(g(float64(Infinity)));')).toBe('false');
  expect(evaluated('function g(x) { return x === 1e309; } String(g(float64(Infinity)));')).toBe('false');
  expect(evaluated('function g(x: float128) { return x === 1e5000; } String(g(1));')).toBe('false');
  expect(evaluated('function g(x) { switch (x) { case 1e39: return "big"; } return "none"; } g(complex64(1));')).toBe('none');
});

test('where only the run time knows the type, the literal is a RangeError', () => {
  const U = (value: string, body: string) => `function f(a) { ${body} } f(${value});`;
  for (const [value, big] of [['float64(1)', '1e309'], ['float128(1)', '1e5000'], ['decimal64(1)', '1e400'], ['rational64(1)', '1e30'], ['complex64(1)', '1e39']]) {
    expectThrownKind(U(value, `return a + ${big};`), 'RangeError');
    expectThrownKind(U(value, `return ${big} * a;`), 'RangeError');
    expectThrownKind(U(value, `a *= ${big}; return a;`), 'RangeError');
  }
  for (const [value, big] of [['float64(1)', '1e309'], ['decimal64(1)', '1e400'], ['rational64(1)', '1e30']]) {
    expectThrownKind(U(value, `return a < ${big};`), 'RangeError');
  }
  expectThrown(U('decimal64(1)', 'return a + 1e400;'), '"1e400" is not in the range of "decimal64"');
  expectThrown(U('rational64(1)', 'return a - -1e30;'), '"-1e30" is not in the range of "rational64"');
  // A complex has no order, a decimal's or a rational's exponent is a count,
  // and a binding adopts nothing.
  expectThrown(U('complex64(1)', 'return a < 1e39;'), 'not ordered');
  expect(evaluated('function f(a) { return a ** 1e30; } String(f(rational64(1)));')).toBe('1');
  expectThrownKind('function f(a, n) { return a + n; } f(decimal64(1), 1e400);', 'TypeError');
});

test('a literal far past a float128\'s range is judged without its digits', () => {
  // Rounding wrote out the power of ten first, a billion digits here.
  expect(evaluated('const x: float128 = 1e-999999999; String(x);')).toBe('0');
  expectStaticTypeError('const x: float128 = 1e999999999;');
  expectThrownKind('float128.parse("1e999999999");', 'RangeError');
});
