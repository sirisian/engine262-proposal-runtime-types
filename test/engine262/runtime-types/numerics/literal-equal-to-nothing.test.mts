import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * Question BK: a literal the other operand's type cannot hold is "equal to
 * nothing as an operand of an equality, a `case` label, and an argument of
 * `Object.is`" (#sec-arithmetic-never-promotes), and a test that can never
 * succeed is refused where it decides a branch (#sec-narrowfrom). An integer
 * and a narrower float answered so. A decimal and a rational refused even
 * `return d === 1e400` as out of range, a rational's `case 1e30` and a
 * `float128`'s `if (q === 1e5000)` were branches never taken, and a label was
 * named by its Number: "the Infinity test".
 */

const families: [string, string][] = [
  ['decimal64', '1e400'], ['rational64', '1e30'], ['float128', '1e5000'], ['float64', '1e309'], ['complex128', '1e309'],
];

test('where no branch is decided, the equality is false', () => {
  for (const [type, big] of families) {
    expect(evaluated(`function g(x: ${type}) { return String(x === ${big}) + String(x !== ${big}) + String(x == ${big}); } g(1);`)).toBe('falsetruefalse');
    expect(evaluated(`function g(x: ${type}) { return Object.is(x, ${big}); } String(g(1));`)).toBe('false');
  }
});

test('where it decides a branch, the test can never succeed', () => {
  for (const [type, big] of families) {
    expectThrown(`function g(x: ${type}) { if (x === ${big}) return 1; return 0; }`, `the "${big}" test can never succeed`);
    expectThrown(`function g(x: ${type}) { switch (x) { case ${big}: return 1; } return 0; }`, `the "${big}" test can never succeed`);
  }
  expectThrown('function g(x: decimal64) { if (x !== -1e400) return 1; return 0; }', 'the "-1e400" test can never fail');
  expectStaticTypeError('const K = 1e400; function g(x: decimal64) { if (x === K) return 1; return 0; }');
});

test('a literal the type holds is compared as before', () => {
  expect(evaluated('function g(x: decimal64) { if (x === 1.5) return "a"; return "b"; } g(decimal64.parse("1.5"));')).toBe('a');
  expect(evaluated('function g(x: rational64) { switch (x) { case 0.5: return "a"; } return "b"; } g(rational64(1, 2));')).toBe('a');
  expect(evaluated('function g(x: float128) { switch (x) { case 1e4500: return "a"; } return "b"; } g(float128.parse("1e4500"));')).toBe('a');
});

test('where only the run time knows the type, it is equal to nothing loosely too', () => {
  // A `float64` infinity is no value of `1e309`, which only its Number is.
  expect(evaluated('function g(x) { return String(x == 1e309) + String(x != 1e309) + String(x === 1e309); } g(float64(Infinity));')).toBe('falsetruefalse');
  expect(evaluated('function g(x) { return x == 1e309; } String(g(Infinity));')).toBe('true');
});
