import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * PLAN-typed-collections.md §6.3 (`typed-keys-valuetypes`) and D5.
 *
 * THESE ARE EXPECTED FAILURES, and they are written now, before the work they
 * describe, so that they convert to passes the moment D5 lands and cannot be
 * forgotten in the meantime. `test.fails` is vitest's inversion: the test PASSES
 * while its assertions fail, and starts FAILING the moment they pass, which is
 * the notification this file exists to produce.
 *
 * WHAT D5 IS. `sec-equality-and-comparison` states that "two instances of a
 * value type class are `===` exactly when their fields are, compared field by
 * field", and its note names the consequence this file is about: "two `Vector2`
 * instances holding the same coordinates are the same value, AND A `Map` KEYED
 * ON THEM HAS ONE ENTRY." The design's Keyed Collections section is built
 * entirely on that rule - the `BitSet` archetype index is its worked example.
 *
 * The engine does not implement it. Confirmed at source rather than inferred:
 * `IsStrictlyEqual` (`abstract-ops/testing-comparison.mts` ~566) and
 * `SameValueZero` (~246) each carry branches for `rational`, `complex`,
 * `decimal` and `TypedNumberValue`, and NO branch for a value type class
 * instance, which falls through to `SameValueNonNumber` - reference identity.
 * `SameValueZero` is the operation `Map` and `Set` key on, so the gap lands
 * exactly where the collections need it not to.
 *
 * THE SCOPE IS NARROWER THAN IT LOOKS in one direction and wider in another.
 *
 * Narrower: the BUILT-IN aggregate value types compare structurally already,
 * because each has its own branch. `rational`, `complex` and `decimal` keys work
 * today and are asserted in the passing tests at the foot of this file, which is
 * both a control - the collection machinery is not what is broken - and a guard,
 * since the fix for D5 will touch the same two operations.
 *
 * Wider: copy semantics are absent too, not only equality, and absent
 * everywhere rather than only on assignment. And an earlier reading that
 * "classification is implemented" was wrong: the Proxy refusal reads "is a TYPED
 * CLASS and cannot be proxied", which is the sealed-typed-class predicate, not a
 * value-type one. The engine may have no value-type-class predicate at all, so
 * D5 is not "add an equality branch".
 *
 * D5 IS OUT OF SCOPE FOR THE COLLECTIONS WORK and needs its own plan. Nothing in
 * the typed-collections phases will move any of these.
 */

const V = 'class V { x: uint32; y: uint32; } ';
const BitSet = 'class BitSet { readonly words: [4].<uint32>; } ';

// ---------------------------------------------------------------------------
// Equality - the root of it
// ---------------------------------------------------------------------------

test('D5: two value type class instances with equal fields are ===', () => {
  // sec-equality-and-comparison: "the identity of a value type is its value".
  expect(evaluated(`${V} String(new V() === new V());`)).toBe('true');
});

test('D5: == on two equal value type class instances is true', () => {
  expect(evaluated(`${V} String(new V() == new V());`)).toBe('true');
});

test('D5: instances differing in a field are NOT ===', () => {
  // The other half, and the half that would pass vacuously if `===` were left
  // as identity - so it is only meaningful once the first test passes.
  expect(evaluated(`${V} const a = new V(); const b = new V(); b.x = (1 := uint32); String(a === b);`)).toBe('false');
  expect(evaluated(`${V} const a = new V(); const b = new V(); b.x = (1 := uint32); a.x = (1 := uint32); String(a === b);`)).toBe('true');
});

// ---------------------------------------------------------------------------
// Copy semantics - the other half, and the one that makes a stored key safe
// ---------------------------------------------------------------------------

test.fails('D5: a value type copies on assignment', () => {
  expect(evaluated(`${V} const a = new V(); const b = a; b.x = (9 := uint32); String(a.x);`)).toBe('0');
});

test.fails('D5: a value type copies when passed to a function', () => {
  expect(evaluated(`${V} function f(v: V) { v.x = (9 := uint32); } const a = new V(); f(a); String(a.x);`)).toBe('0');
});

test.fails('D5: reading an element out of a typed array copies it', () => {
  expect(evaluated(`${V} const arr: [2].<V>; const e = arr[0]; e.x = (9 := uint32); String(arr[0].x);`)).toBe('0');
});

// ---------------------------------------------------------------------------
// The collection consequences - what this plan actually needs
// ---------------------------------------------------------------------------

test('D5: a Map keyed on a value type class has one entry per VALUE', () => {
  // The design's worked example, in its own words: "index.get(b); // archetype,
  // the same key by value".
  expect(evaluated(`${BitSet} const a: BitSet; const b: BitSet; const m = new Map.<BitSet, string>(); m.set(a, "hit"); String(m.get(b));`)).toBe('hit');
  expect(evaluated(`${V} const a = new V(); const b = new V(); const m = new Map.<V, string>(); m.set(a, "hit"); m.set(b, "again"); String(m.size);`)).toBe('1');
});

test('D5: a Set of value type class instances dedups structurally', () => {
  expect(evaluated(`${V} const s = new Set.<V>(); s.add(new V()); s.add(new V()); String(s.size);`)).toBe('1');
  // And `has` finds an equal-but-distinct instance.
  expect(evaluated(`${V} const s = new Set.<V>(); s.add(new V()); String(s.has(new V()));`)).toBe('true');
});

test.fails('D5: insertion COPIES the key, so mutating the original does not move it', () => {
  // "This is worth stating because it's the failure mode of struct keys in other
  // languages, where a mutable key inserted by reference corrupts the table it
  // lives in. Value semantics forecloses it." The stored key must be unaffected
  // by a later write to the variable it came from - so the ORIGINAL key is still
  // found, and the mutated variable is not.
  const setup = `${V} const k = new V(); const m = new Map.<V, string>(); m.set(k, "hit"); k.x = (7 := uint32); `;
  expect(evaluated(`${setup} String(m.get(k));`)).toBe('undefined');
  expect(evaluated(`${setup} String(m.size);`)).toBe('1');
});

test('D5: comparison recurses by field KIND, not by byte image', () => {
  // "a value type field recursively and structurally, a fixed-length array field
  // element by element, since it's inline storage, and a reference field by
  // identity."
  const nested = 'class Inner { a: uint8; } class Outer { i: Inner; b: uint8; } ';
  expect(evaluated(`${nested} String(new Outer() === new Outer());`)).toBe('true');
  // A fixed-length array field is inline storage, so it compares element-wise.
  expect(evaluated(`${BitSet} String(new BitSet() === new BitSet());`)).toBe('true');
  // A class with a REFERENCE field is not a value type at all, so its instances
  // keep identity semantics. This one should already hold, and is here so that a
  // D5 fix that over-reaches is caught.
  expect(evaluated('class R { o: object | null = null; } String(new R() === new R());')).toBe('false');
});

// ---------------------------------------------------------------------------
// Controls - these pass today and must keep passing through any D5 fix
// ---------------------------------------------------------------------------

test('control: the built-in aggregate value types already key structurally', () => {
  // rational.md states this one verbatim: "new Set.<rational>([rational(1, 2),
  // rational(50, 100)]).size; // 1". Canonical form makes structural equality
  // and mathematical equality the same question.
  expect(evaluated('const s = new Set.<rational>(); s.add(rational(1, 2)); s.add(rational(50, 100)); String(s.size);')).toBe('1');
  // decimal.md: "as a `Map` or `Set` key a decimal compares by value under
  // SameValueZero, so `1.0` and `1.00` are one key rather than two" - the split
  // Java's BigDecimal does not make.
  expect(evaluated('const s = new Set.<decimal128>(); s.add(1.0 := decimal128); s.add(1.00 := decimal128); String(s.size);')).toBe('1');
  // A complex compares over the pair.
  expect(ok('const s = new Set.<complex>(); s.add(1 + 2i); s.add(1 + 2i);')).toBe(true);
});

test('control: a value type class is refused where identity is required', () => {
  // These already hold, and they are the reason an earlier reading concluded
  // that value-type CLASSIFICATION was implemented. It is not - the refusal is
  // on the sealed-typed-class predicate, whose extension merely overlaps. Kept
  // as a control so that a D5 fix which introduces a real predicate does not
  // change these answers.
  expect(ok(`${V} new WeakRef(new V());`)).toBe(false);
  expect(ok(`${V} new WeakMap().set(new V(), 1);`)).toBe(false);
  expect(ok(`${V} new WeakSet().add(new V());`)).toBe(false);
  expect(ok(`${V} new Proxy(new V(), {});`)).toBe(false);
});

test('control: the scalar value types key by value already', () => {
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); s.add(1); String(s.size);')).toBe('1');
  // At the type's OWN precision - two magnitudes one double cannot tell apart
  // are two keys.
  expect(evaluated('const s = new Set.<uint64>(); s.add(9007199254740993n := uint64); s.add(9007199254740992n := uint64); String(s.size);')).toBe('2');
  // A float NaN is one key, and the two zeroes pair, per SameValueZero.
  expect(evaluated('const s = new Set.<float32>(); s.add(NaN := float32); s.add(NaN := float32); String(s.size);')).toBe('1');
  expect(evaluated('const s = new Set.<float32>(); s.add(-0 := float32); s.add(0 := float32); String(s.size);')).toBe('1');
});
