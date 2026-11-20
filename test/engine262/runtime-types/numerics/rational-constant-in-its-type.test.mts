import { expect, test } from 'vitest';
import { evaluated, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * Question BR: a constant at a rational type is computed by the type's own
 * operators, each literal taking the type, where the exact fold declines it:
 * for a zero divisor, a power past 4096 and a literal past every width. Each
 * was left a Number: `const q: rational64 = 1e999999999 * 2` and `1 / 0` there
 * were refused as Infinity when they ran, `q * (1 / 0)` was a TypeError, and
 * `const r: rational.<bigint> = 2 ** 5000` was Infinity, where 2**5000 is one
 * of its values.
 */

test('a constant the fold declines is computed in the type', () => {
  expectThrown('const q: rational64 = 1e999999999 * 2;', '"1e999999999" is not in the range of "rational64"');
  expectThrown('const q: rational64 = 1 / 0;', 'division of a rational by zero');
  expectThrownKind('const q: rational64 = 1; q * (1 / 0);', 'RangeError');
  expect(evaluated('const r: rational.<bigint> = 2 ** 5000; String(r.numerator === 2n ** 5000n);')).toBe('true');
  // A named constant is its initializer there, as if inlined.
  expect(evaluated('const K = 1 / 3; const q: rational64 = K * 3; String(q);')).toBe('1');
});
