import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A RATIONAL SOURCE IS THE IDENTITY, as every other numeric conversion is on its
 * own type: `uint8(x)` for a `uint8` and `float64(f)` for a `float64` both answer
 * the value. `rational(r)` alone raised "a rational numerator must be an
 * integer" - the two-argument form's rule answering a call that named no
 * numerator, the same shape as the earlier `rational(0.5)` defect.
 *
 * It matters beyond symmetry, and that is how it was found. A constant
 * expression at a rational contextual type folds to a rational
 * (`foldRationalConstant`), so once the evaluator began reading those folds,
 * `rational(1 / 3)`, `rational(1 + 1)` and `rational(-1)` all handed this a
 * rational and were refused for it - including `rational(-0.5)`, which a
 * suite test already pinned.
 */

test('a rational converts to itself', () => {
  expect(evaluated('const r = rational(1, 3); String(rational(r));')).toBe('1/3');
  expect(evaluated('let r: rational = 1 / 3; String(rational(r));')).toBe('1/3');
});

test('the other numeric conversions are identity on their own type too', () => {
  // The symmetry this restores.
  expect(evaluated('const x: uint8 = 5; String(uint8(x));')).toBe('5');
  expect(evaluated('const f: float64 = 1.5; String(float64(f));')).toBe('1.5');
});

test('a folded constant expression reaches the constructor', () => {
  expect(evaluated('String(rational(1 / 3));')).toBe('1/3');
  expect(evaluated('String(rational(1 + 1));')).toBe('2');
  expect(evaluated('String(rational(-1));')).toBe('-1');
  expect(evaluated('String(rational(-0.5));')).toBe('-1/2');
});

test('the other single-argument sources are unchanged', () => {
  expect(evaluated('String(rational(0.5));')).toBe('1/2');
  expect(evaluated('String(rational(5));')).toBe('5');
  expect(evaluated('String(rational(1, 3));')).toBe('1/3');
  // NaN and an infinity have no exact fraction: a question of range.
  expectThrown('rational(NaN);', 'is not in the range of');
  // A non-numeric source is refused by the CONVERSION, as `"s" := rational` is:
  // #sec-conversions makes the one-argument call and `:=` "the same operation".
  // It said "numerator must be an integer" here, the two-argument form's rule,
  // though a lone argument is the value converted and not a numerator.
  expectThrown('rational("s");', 'is not assignable to');
  expectThrown('"s" := rational;', 'is not assignable to');
  // The numerator rule still applies where there IS a numerator.
  expectThrown('rational("s", 1);', 'numerator must be an integer');
});
