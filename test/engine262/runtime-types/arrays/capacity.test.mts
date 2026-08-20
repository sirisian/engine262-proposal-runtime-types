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

test('with() takes its value at the position it writes', () => {
  // PLAN-tuple-stores.md phase 3. `with` WRITES a position, so the rule that a
  // method taking an ELEMENT takes it at the element type governs it - and for
  // a tuple that means the type of the position written, since the positions
  // differ. It checked nothing, which mattered more once the copy carried a
  // type: `a.with(0, "no")` on a `[].<uint8>` produced a copy STAMPED uint8
  // around a String.
  const a = 'let a: [].<uint8> = [1, 2]; let bad = {}; bad.v = "no"; ';
  expectThrown(`${a} a.with(0, bad.v);`);
  expect(evaluated(`${a} const r = a.with(0, 9); String(r[0]) + "," + String(r[1]);`)).toBe('9,2');
  const t = 'let t: [uint8, string] = [1, "s"]; let bad = {}; bad.v = "no"; ';
  expectThrown(`${t} t.with(0, bad.v);`);
  expect(evaluated(`${t} const r = t.with(1, "ok"); r[1];`)).toBe('ok');
  // A position the rest collects takes the rest's type.
  expect(evaluated('let r: [uint8, ...string] = [1, "a", "b"]; r.with(2, "z")[2];')).toBe('z');
  // An untyped array is untouched.
  expect(evaluated('const u = [1, 2]; String(u.with(0, "x")[0]);')).toBe('x');
});

test("a tuple's arity is fixed against length", () => {
  // The store rules already refuse a write past the arity; this is the same
  // rule reached through `length`, which is how the fixed-extent array case
  // reaches it too. A rest collects any number, so a length at or above the
  // fixed positions is within the type.
  expectThrown('let t: [uint8, string] = [1, "s"]; t.length = 1;');
  expect(evaluated('let t: [uint8, string] = [1, "s"]; t.length = 2; String(t.length);')).toBe('2');
  expect(evaluated('let r: [uint8, ...string] = [1, "a", "b"]; r.length = 2; String(r.length);')).toBe('2');
  expectThrown('let r: [uint8, ...string] = [1, "a"]; r.length = 0;');
  // A dynamic array's length is not part of its type.
  expect(evaluated('let a: [].<uint8> = [1, 2]; a.length = 1; String(a.length);')).toBe('1');
});

test('a copy of a tuple carries the shape the operation produced', () => {
  // PLAN-tuple-stores.md phase 2, the tuple half. An array's copy has the same
  // element type whatever the operation did; a tuple's does not - `toReversed`
  // permutes the positions, `slice` takes a window, `with` leaves them alone -
  // so each method states the shape it produced rather than sharing one rule.
  const t = 'let t: [uint8, string] = [1, "s"]; let bad = {}; bad.v = "no"; ';
  // Reversed: position 0 is now the string and position 1 the uint8.
  expect(evaluated(`${t} const r = t.toReversed(); r[0] = "ok"; r[0];`)).toBe('ok');
  expectThrown(`${t} const r = t.toReversed(); r[1] = bad.v;`);
  // `with` replaces one position with a value already checked against that
  // position's type, so the shape is unchanged.
  expectThrown(`${t} const r = t.with(1, "x"); r[0] = bad.v;`);
  // A slice is a window on the positions, and the indices are known at run time
  // even where they were not known statically.
  expect(evaluated(`${t} const r = t.slice(1); r[0] = "fine"; r[0];`)).toBe('fine');
  expectThrown(`${t} const r = t.slice(0, 1); r[0] = bad.v;`);
  // A sort permutes, so the shape survives only where permuting cannot change
  // it: every position the same type.
  expectThrown('let h: [uint8, uint8] = [2, 1]; let bad = {}; bad.v = "no"; const r = h.toSorted(); r[0] = bad.v;');
  // A heterogeneous tuple sorted by an arbitrary comparator has no position
  // types this operation can state, so the copy carries none rather than a
  // guess. Recorded as the measured answer, not as the desired one.
  expect(evaluated(`${t} const r = t.toSorted(); r[0] = bad.v; String(r[0]);`)).toBe('no');
  // A tuple with a REST is left alone: its positions are not a fixed list.
  expect(evaluated('let r: [uint8, ...string] = [1, "a"]; const c = r.toReversed(); c[0] = 5; String(c[0]);')).toBe('5');
});

test('a count is checked as a count, not coerced', () => {
  // ISSUES-found-while-writing-examples.md I2. #sec-toindextype: "If value is
  // not a value of the index type, throw a TypeError exception", and the clause
  // gives the reason - "`length` and `capacity` READ at the index type, so a
  // count that could be written as a String and silently converted would make
  // the operations that accept a count disagree with the ones that report one".
  //
  // `reserve` and the Span builder used `ToLength`/`ToIndex`, which coerce, so
  // through an `any`-typed value they accepted a String, a negative clamped to
  // 0, and a fraction truncated - all silently, while the checker refused the
  // same calls written literally.
  const anyv = 'let bad = {}; bad.s = "4"; bad.n = -1; bad.f = 2.5; ';
  const arr = 'let a: [].<uint8> = []; a.push((1 := uint8)); ';
  expectThrown(`${anyv}${arr} a.reserve(bad.s);`);
  expectThrown(`${anyv}${arr} a.reserve(bad.n);`);
  expectThrown(`${anyv}${arr} a.reserve(bad.f);`);
  expectThrown(`${anyv} [].<uint8>.withCapacity(bad.s);`);
  expectThrown(`${anyv} Span.<uint8>(new ArrayBuffer(4), 0, bad.s, 1);`);
  // A real count still works everywhere, which is what keeps the check from
  // being a refusal of the operation itself.
  expect(evaluated(`${arr} a.reserve(8); String(a.capacity);`)).toBe('8');
  expect(evaluated('String([].<uint8>.withCapacity(4).capacity);')).toBe('4');
  expect(evaluated('String(Span.<uint8>(new ArrayBuffer(4), 0, 4, 1).length);')).toBe('4');
});
