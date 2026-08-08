import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

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

test('an out-of-bounds READ is a RangeError', () => {
  // errorhandling.md: "an array access out of bounds is a `RangeError`, from the
  // bounds checks the array sections describe". It returned *undefined* - the
  // ordinary JavaScript answer for a missing property, and the wrong one for a
  // value whose type says how many elements it has.
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a[9];', 'RangeError');
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a[4];', 'RangeError');
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a[-1];', 'RangeError');
  // A DYNAMIC extent is bounds-checked too: its length is what it is, even
  // though it may grow.
  expectThrownKind('const a: [].<float32> = [1, 2, 3]; a[9];', 'RangeError');

  // A WRITE past a fixed extent stays a TypeError, because that is attempted
  // GROWTH rather than an out-of-bounds access - the same rule as `push` and
  // `length =` above, and the extent is part of the type.
  expectThrownKind('const a: [4].<float32> = [1, 2, 3, 4]; a[7] = 1;', 'TypeError');

  // A plain array keeps JavaScript's behaviour: nothing about it says what its
  // length ought to be.
  expect(evaluated('const a = [1, 2, 3]; String(a[9]);')).toBe('undefined');
});

test('a value generic may be the extent', () => {
  // `f.<4, 2>` binds a `uint32` 4, not a Number 4, and the two are never
  // SameValue - so requiring a plain Number rejected `[N].<T>` with a
  // value-generic extent, which is the shape sec-bounds-checks is written about.
  expect(evaluated('function f<N: uint32, I: uint32>(a: [N].<uint8>): uint8 { return a[I]; } let a: [4].<uint8> = [7,8,9,10]; String(Number(f.<4, 2>(a)));')).toBe('9');
  expect(evaluated('function f<N: uint32>(a: [N].<uint8>): uint32 { return a.length; } let a: [4].<uint8> = [7,8,9,10]; String(Number(f.<4>(a)));')).toBe('4');
  // The extent still has to match the argument.
  expectThrownKind('function f<N: uint32>(a: [N].<uint8>): uint32 { return a.length; } let a: [4].<uint8> = [7,8,9,10]; f.<3>(a);', 'TypeError');
  // A bare value generic index is NOT proven - inside the body nothing relates
  // I to N - so the bounds check does its work.
  expectThrownKind('function f<N: uint32, I: uint32>(a: [N].<uint8>): uint8 { return a[I]; } let a: [4].<uint8> = [7,8,9,10]; f.<4, 9>(a);', 'RangeError');
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

test('a fixed-extent array cannot be shortened either', () => {
  // the extent is the length, so removing is as much a change as adding
  expectThrownKind('const a: [4].<uint8> = [1, 2, 3, 4]; a.pop();', 'TypeError');
  expectThrownKind('const a: [4].<uint8> = [1, 2, 3, 4]; a.shift();', 'TypeError');
  expectThrownKind('const a: [4].<uint8> = [1, 2, 3, 4]; a.splice(0, 1);', 'TypeError');
  expectThrownKind('const a: [4].<uint8> = [1, 2, 3, 4]; delete a[0];', 'TypeError');
});

test('operations that keep the length are unaffected', () => {
  // an extent constrains the LENGTH, not the contents
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; a.fill(7);'
    + " String(a.length) + ',' + String(a[0]);")).toBe('4,7');
  expect(evaluated('const a: [4].<uint8> = [4, 3, 2, 1]; a.sort(); String(a.length);')).toBe('4');
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; a.reverse();'
    + " String(a.length) + ',' + String(a[0]);")).toBe('4,4');
});
