import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

// README "Capacity" writes `out.capacity;` as a READ, and its prose says
// "`capacity` reads it, `reserve(n)` grows it" - the language of a property
// beside a verb. It was registered as a METHOD, so `a.capacity` yielded the
// function object: truthy, so `if (a.capacity > 1000)` misbehaved silently
// rather than throwing, which is the worse failure of the two.

test('capacity reads as a property', () => {
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); typeof a.capacity;')).toBe('number');
  // The comparison the method form broke.
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity >= 64);')).toBe('true');
});

test('the capacity rules the design states', () => {
  // `reserve(n)` grows the allocation without changing the length.
  expect(evaluated('let a: [].<uint32> = [1, 2]; a.reserve(64); String(a.length) + "/" + String(a.capacity);')).toBe('2/64');
  // Capacity never shrinks implicitly.
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); a.reserve(8); String(a.capacity);')).toBe('64');
  // A capacity is kept at least the length, so `push` has somewhere to go.
  expect(evaluated('let a: [].<uint32> = []; a.push(1); String(a.capacity >= 1);')).toBe('true');
});
