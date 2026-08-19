import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

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

test('a copy of a typed array carries its element type', () => {
  // PLAN-tuple-stores.md phase 2. #sec-array-defaults-and-stores says a method
  // that takes or returns an ELEMENT does so at the element type, and says
  // nothing about a method that returns an ARRAY - so `slice()` handed back
  // something that accepted a String at any index and grew without limit. The
  // copy holds the receiver's elements, so it holds values of its element type.
  const a = 'let a: [].<uint8> = [1, 2, 3]; let bad = {}; bad.v = "no"; ';
  for (const copy of ['a.slice()', 'a.slice(0, 2)', 'a.toReversed()', 'a.toSorted()', 'a.with(0, 5)', 'a.filter(v => true)']) {
    expectThrown(`${a} const r = ${copy}; r[0] = bad.v;`);
    expect(evaluated(`${a} const r = ${copy}; r[0] = 9; String(r[0]);`)).toBe('9');
  }
  // `map` is excluded on purpose: its callback returns whatever it likes, so
  // the result's elements do not come from the receiver.
  expect(evaluated(`${a} const r = a.map(v => "text"); r[0] = "more text"; r[0];`)).toBe('more text');
});
