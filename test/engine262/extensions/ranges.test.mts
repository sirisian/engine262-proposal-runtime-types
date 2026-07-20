import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * Extension coverage — ranges.md (ranges).
 *
 * The ranges extension (range literals `1..6`/`1..=6`, `Range.<T>`, range
 * iteration, `a[start..end]` slicing, range case labels and containment) is not
 * implemented; documented as capability Q. The core reserves the bare-range case
 * syntax so the extension can define it without conflict (verified in README file
 * 11). This file records the boundary.
 */

test('ranges: a range literal does not parse (documents the gap)', () => {
  // Target (ranges.md): `1..6` is a half-open interval value.
  expectThrown('let r = 1..6; typeof r;');
  // the inclusive form
  expectThrown('let r = 1..=6; typeof r;');
});

test('ranges: range iteration does not parse (documents the gap)', () => {
  // Target: `for (const i of 0..n)` iterates the interval.
  expectThrown('let sum = 0; for (const i of 0..5) { sum += i; } sum;');
});

test('ranges: the Range type is not defined (documents the gap)', () => {
  // Target: `Range.<uint32>` is the type of an integer range.
  expectThrown('type R = Range.<uint32>; typeof R;');
});

test('ranges: range slicing does not parse (documents the gap)', () => {
  // Target: `a[start..end]` is a view over the range.
  expectThrown('let a = [1,2,3,4,5]; let s = a[1..3]; typeof s;');
});

test('ranges: ordinary numeric member access is unaffected', () => {
  // `1..toString()` parses today as `(1.).toString()` and is not a range.
  expect(evaluated('(1).toString();')).toBe('1');
  // a normal for loop still works
  expect(evaluated('let sum = 0; for (let i = 0; i < 5; ++i) { sum += i; } String(sum);')).toBe('10');
});
