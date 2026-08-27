import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * PLAN-typed-collections.md sec 6.3 - COMPOSITE KEYS.
 *
 * A composite is interned by its contents, so two separately built composites of
 * equal contents are one value and therefore ONE KEY. That is what makes a
 * composite the way to key a collection on more than one field without building
 * a string, and it is the case the collections work was asked to cover first.
 *
 * All of this already worked when these tests were written - the interning does
 * the job and no collection change was needed for it. They exist because nothing
 * guarded it: the behaviour rests on `Composite`'s interning, on SameValueZero,
 * and on the collections' key positions agreeing about identity, and a change to
 * any of the three would break it silently.
 *
 * The value-type-class half of "structural keys" is the OTHER file,
 * `value-type-keys.test.mts`, and it is only partly working (D5). A composite
 * needs none of that machinery: it is interned rather than compared.
 */

// ---------------------------------------------------------------------------
// A composite is one key per value
// ---------------------------------------------------------------------------

test('two separately built composites of equal contents are one key', () => {
  expect(evaluated('const s = new Set(); s.add(Composite({ a: 1 })); s.add(Composite({ a: 1 })); String(s.size);')).toBe('1');
  expect(evaluated('const m = new Map(); m.set(Composite({ a: 1 }), "hit"); String(m.get(Composite({ a: 1 })));')).toBe('hit');
  // ...and differing contents are two keys, so the relation discriminates.
  expect(evaluated('const s = new Set(); s.add(Composite({ a: 1 })); s.add(Composite({ a: 2 })); String(s.size);')).toBe('2');
  expect(evaluated('const m = new Map(); m.set(Composite({ a: 1 }), "one"); String(m.get(Composite({ a: 2 })));')).toBe('undefined');
});

test.fails('D23: a typed composite key type loses its object members', () => {
  // `Composite.<{cx: int32, cy: int32}>` resolves with an EMPTY object argument -
  // the diagnostic reads `Composite.<{  }>` - so nothing is assignable to it and
  // the chunk-store idiom composites.md names cannot be written with its key
  // type spelled out.
  //
  // PRE-EXISTING, and not a collection defect: the same failure appears in a
  // bare `let c: Composite.<{x: int32}> = Composite({ (x: int32): 1 });`, verified
  // on a clean build. It became visible here only once D13 gave
  // `new Map.<K, V>()` a Static Type, so the key position is checked where it
  // previously was not.
  const k = 'Composite({ (cx: int32): 1, (cy: int32): 2 })';
  expect(ok(`const m = new Map.<Composite.<{cx: int32, cy: int32}>, string>(); m.set(${k}, "chunk");`)).toBe(true);
  expect(ok('let c: Composite.<{x: int32}> = Composite({ (x: int32): 1 });')).toBe(true);
});

test('an UNTYPED composite key works, which is the idiom in practice', () => {
  // The same chunk store with the key type left to inference. This is what
  // composites.md's own examples write, and D23 does not reach it.
  const k = 'Composite({ cx: 1, cy: 2 })';
  expect(evaluated(`const m = new Map(); m.set(${k}, "chunk"); String(m.get(${k}));`)).toBe('chunk');
  expect(evaluated(`const m = new Map(); m.set(${k}, "chunk"); String(m.get(Composite({ cx: 9, cy: 2 })));`)).toBe('undefined');
});

test('a tuple composite and a record composite never intern together', () => {
  // composites.md is explicit that the two forms are distinct however alike
  // their contents look, so a positional composite cannot collide with a named
  // one that happens to carry the same values under index keys.
  expect(evaluated('const s = new Set(); s.add(Composite([1])); s.add(Composite({ 0: 1 })); String(s.size);')).toBe('2');
  expect(evaluated('const s = new Set(); s.add(Composite([1, 2])); s.add(Composite([1, 2])); String(s.size);')).toBe('1');
  expect(evaluated('const s = new Set(); s.add(Composite([1, 2])); s.add(Composite([2, 1])); String(s.size);')).toBe('2');
});

test('the field TYPE participates in the key, not only the value', () => {
  // The interning hazard composites.md calls out: the same source text under a
  // different type is a different composite, so a program that means one key
  // must write one type. Asserted so that a change making interning value-only
  // is caught here rather than in a chunk store.
  const typed = 'Composite({ (x: int32): 1 })';
  const untyped = 'Composite({ x: 1 })';
  expect(evaluated(`const s = new Set(); s.add(${typed}); s.add(${untyped}); String(s.size);`)).toBe('2');
  expect(evaluated(`const s = new Set(); s.add(${typed}); s.add(${typed}); String(s.size);`)).toBe('1');
});

// ---------------------------------------------------------------------------
// The idioms the design names
// ---------------------------------------------------------------------------

test('Map.groupBy over a composite key groups by contents', () => {
  // "Group by a composite" is the idiom composites.md gives for grouping on
  // more than one field, and it works only because equal composites are one key.
  expect(evaluated('const g = Map.groupBy([1, 2, 1], (n) => Composite({ v: n })); String(g.size);')).toBe('2');
  expect(evaluated('const g = Map.groupBy([1, 2, 1], (n) => Composite({ v: n })); String(g.get(Composite({ v: 1 })).length);')).toBe('2');
});

test('array membership finds a composite by value', () => {
  // `positions.includes(Composite({x, y}))` lands on the interned pointer, so a
  // membership test does not have to walk fields.
  expect(evaluated('const positions = [Composite({ x: 1, y: 2 })]; String(positions.includes(Composite({ x: 1, y: 2 })));')).toBe('true');
  expect(evaluated('const positions = [Composite({ x: 1, y: 2 })]; String(positions.includes(Composite({ x: 9, y: 2 })));')).toBe('false');
});

test('a composite key survives delete and re-insert, and clears', () => {
  const k = 'Composite({ a: 1 })';
  expect(evaluated(`const m = new Map(); m.set(${k}, 1); m.delete(${k}); String(m.size);`)).toBe('0');
  expect(evaluated(`const m = new Map(); m.set(${k}, 1); m.set(${k}, 2); String(m.size) + "/" + String(m.get(${k}));`)).toBe('1/2');
  expect(evaluated(`const s = new Set(); s.add(${k}); String(s.has(${k})) + "/" + String(s.delete(${k})) + "/" + String(s.size);`)).toBe('true/true/0');
});

// ---------------------------------------------------------------------------
// Where a composite may not go
// ---------------------------------------------------------------------------

test('a composite cannot be held weakly', () => {
  // sec-composite-canbeheldweakly: a composite has no identity beyond its
  // contents, so there is nothing for a weak reference to observe the death of.
  expect(ok('new WeakSet().add(Composite({ a: 1 }));')).toBe(false);
  expect(ok('new WeakMap().set(Composite({ a: 1 }), 1);')).toBe(false);
  expect(ok('new WeakRef(Composite({ a: 1 }));')).toBe(false);
  // A strong collection is unaffected, which is the contrast that makes the
  // refusal about weakness rather than about composites.
  expect(evaluated('const s = new Set(); s.add(Composite({ a: 1 })); String(s.size);')).toBe('1');
});

// ---------------------------------------------------------------------------
// The untyped collection is untouched
// ---------------------------------------------------------------------------

test('composite keys work the same in an untyped collection', () => {
  // Interning is a property of the composite and not of the collection, so
  // nothing here depends on the collection carrying type arguments - which is
  // what sec 0 requires and what makes composites usable in ordinary code.
  expect(evaluated('const m = new Map(); m.set(Composite({ a: 1 }), "x"); m.set(Composite({ a: 1 }), "y"); String(m.size) + "/" + m.get(Composite({ a: 1 }));')).toBe('1/y');
  expect(evaluated('const s = new Set(); s.add(Composite([1])); s.add(Composite([1])); String(s.size);')).toBe('1');
});
