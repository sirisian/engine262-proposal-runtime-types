import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

// ---------------------------------------------------------------------------
// A LOOP BINDING'S ANNOTATION IS HONOURED, AND CHECKED.
//
// `for (const x: string of arr)` on a `[].<uint8>` ran the loop twice and
// reported nothing: the binding took the ELEMENT type (or none), and a written
// annotation was neither used as the binding's type nor checked against what the
// loop yields. The same annotation on a `let` is refused, and on a destructuring
// member it is honoured - this was the one binding form that dropped it.
// ---------------------------------------------------------------------------

test('a loop binding\'s annotation must admit the element type', () => {
  expectStaticTypeError('const arr: [].<uint8> = [1, 2]; for (const x: string of arr) { }');
  // Not merely a different KIND: a numeric type the element does not fit is
  // refused too, since no implicit widening reaches the binding.
  expectStaticTypeError('const arr: [].<uint8> = [1]; for (const x: uint16 of arr) { }');
  // The annotation is the binding's type, so the body is checked against it.
  expectStaticTypeError('const arr: [].<uint8> = [1]; for (const x: uint8 of arr) { let s: string = x; }');
});

test('what the loop annotation does not change', () => {
  // A matching annotation runs, and the binding holds the element.
  expect(evaluated('const arr: [].<uint8> = [1, 2]; let n: uint8 = 0; for (const x: uint8 of arr) { n = x; } String(n);')).toBe('2');
  // An unannotated binding still takes the element type, as before.
  expectStaticTypeError('const arr: [].<uint8> = [1]; for (const x of arr) { let s: string = x; }');
  // An untyped source has no element type, so the annotation stands alone and
  // the run time decides, as it does for any borrow of an unknown location.
  expect(ok('const arr = [1]; for (const x: string of arr) { }')).toBe(true);
});
