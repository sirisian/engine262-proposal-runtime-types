import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../readme/harness.mts';

/**
 * A fixed extent is part of the type and does not move (spec
 * sec-array-and-tuple-types).
 *
 * The extent was dropped when the element type was stamped, so nothing enforced
 * it: a `[4].<float32>` accepted `push`, a `length` assignment, and a store past
 * the end. The extent is a compile-time constant the layout rules and the array
 * views both compute from - `byteElementLength` defaults from it and a view's
 * size check is stated in terms of it - so an extent a store could change was
 * not a constant at all. `SoA.<T, N>` already refused the same growth.
 */

test('a fixed-extent array cannot be grown', () => {
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a.push(5);', 'TypeError');
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a.length = 9;', 'TypeError');
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a[7] = 1;', 'TypeError');
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a.unshift(0);', 'TypeError');
  // the constructed form behaves as the annotated one does
  expectThrownKind('const a = new [4].<float32>(); a.push(5);', 'TypeError');
  expectThrownKind('const a = new [4].<float32>(); a.length = 9;', 'TypeError');
});

test('everything within the extent still works', () => {
  expect(evaluated('const a: [4].<float32> = [1, 2, 3, 4]; a[2] = 9; String(a[2]);')).toBe('9');
  expect(evaluated('const a: [4].<float32> = [1, 2, 3, 4]; String(a.length);')).toBe('4');
  expect(evaluated('const a: [4].<float32> = [1, 2, 3, 4]; String(a.map((v) => v).length);')).toBe('4');
  expect(evaluated('const a = new [4].<float32>(); a[0] = 7; String(a[0]);')).toBe('7');
  // the element type is still enforced within the extent
  expectThrownKind('const a: [4].<uint8> = [1, 2, 3, 4]; function big() { return 300; } a[0] = big();', 'RangeError');
});

test('a growable array and a plain array are untouched', () => {
  expect(evaluated('const a: [].<float32> = []; a.push(5); a.push(6); String(a.length);')).toBe('2');
  expect(evaluated('const a: [].<float32> = [1]; a.length = 0; String(a.length);')).toBe('0');
  expect(evaluated('const a = [1, 2]; a.push(3); a.length = 9; String(a.length);')).toBe('9');
});

test('a fixed SoA refuses growth as it always did', () => {
  expectThrownKind('class P { x: float32; } const s = new SoA.<P, 4>(); s.push({ x: 1 });', 'TypeError');
});
