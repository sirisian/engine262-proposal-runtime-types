import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * KEY POSITIONS ARE CHECKED, NOT CONVERTED.
 *
 * `table-string-conversion-sources` admits a numeric or Boolean source at a
 * `string` target, converting with ToString, and argues the case: ToString is
 * total and lossless, so nothing is lost - `5` is `'5'` and reads back as `5`.
 * That reasoning is about a STORE, a slot holding one value. A key is a store
 * whose value is also an IDENTITY, and a conversion that loses nothing as a
 * value can still lose an identity by mapping two distinct sources onto one key.
 *
 * The measurement that decided it:
 *
 *     new Map.<string, uint8>()  ->  set(1, .), set("1", .)  ->  size 1
 *     new Map()                  ->  set(1, .), set("1", .)  ->  size 2
 *
 * Typing a collection MERGED two keys that were distinct - silently, and only
 * when both spellings happened to occur, which is a data-dependent failure that
 * survives every test exercising one of them.
 *
 * WHY THIS IS A CONSISTENCY FIX RATHER THAN A NEW RULE. The numeric target
 * already has the property: RequireType admits an `any` numeric source only
 * where the target represents it exactly and raises a RangeError otherwise, so
 * `Map.<uint8, V>` could never merge two keys. The `string` target is the one
 * boundary in the language admitting a conversion that does not preserve
 * identity, and it is the outlier rather than the rule.
 *
 * NARROW ON PURPOSE. Only the string conversion is withheld, and only at an
 * identity-bearing position. A value position keeps the conversion rule in full.
 * Literal propagation is untouched. Every statically typed language in the
 * sample - Rust, C++, Java, C#, TypeScript - refuses a converted key outright,
 * so the direction is not controversial; only its scope here is.
 */

const HIDE = 'const n = (1 := any); const b = (true := any); const s = ("1" := any); ';

// ---------------------------------------------------------------------------
// A key position checks
// ---------------------------------------------------------------------------

test('a key that is not already of the key type is refused', () => {
  expect(ok(`const m = new Map.<string, uint8>(); ${HIDE} m.set(n, 1);`)).toBe(false);
  expect(ok(`const m = new Map.<string, uint8>(); ${HIDE} m.set(b, 1);`)).toBe(false);
  // A Set's element is the same position.
  expect(ok(`const s2 = new Set.<string>(); ${HIDE} s2.add(n);`)).toBe(false);
  expect(ok(`const s2 = new Set.<string>(); ${HIDE} s2.add(b);`)).toBe(false);
  // As is a weak collection's.
  expect(ok(`const w = new WeakSet.<object>(); ${HIDE} w.add(n);`)).toBe(false);
});

test('the merge the rule exists to prevent cannot happen', () => {
  // The two spellings can no longer land on one entry, because the first is
  // refused rather than converted.
  expect(ok(`const m = new Map.<string, uint8>(); ${HIDE} m.set(n, 1); m.set(s, 2);`)).toBe(false);
  // And the untyped collection is untouched: two keys, as it always was.
  expect(evaluated('const u = new Map(); u.set(1, 1); u.set("1", 2); String(u.size);')).toBe('2');
});

test('a SEARCH position checks too, so the two agree', () => {
  // A needle the key type cannot hold makes a test that can never succeed. This
  // was already the rule for the numeric types, and it now holds for `string`
  // as well, so `get`, `has` and `delete` agree with `set` about what a key is.
  expect(ok(`const m = new Map.<string, uint8>(); ${HIDE} m.get(n);`)).toBe(false);
  expect(ok(`const m = new Map.<string, uint8>(); ${HIDE} m.has(n);`)).toBe(false);
  expect(ok(`const m = new Map.<string, uint8>(); ${HIDE} m.delete(n);`)).toBe(false);
  expect(ok(`const m = new Map.<string, uint8>(); ${HIDE} m.getOrInsert(n, 1);`)).toBe(false);
});

test('the CONSTRUCTOR seed checks the same way', () => {
  // The seed reaches a different code path from the prototype methods, and a
  // rule enforced at some positions is a rule a program can walk around. This
  // was exactly that hole.
  expect(ok('const m = new Map.<string, uint8>([[1, 2]]);')).toBe(false);
  expect(ok('const s2 = new Set.<string>([1]);')).toBe(false);
  expect(ok('let m: Map.<string, uint8> = new Map([[1, 2]]);')).toBe(false);
  // A seed that is already of the key type is fine.
  expect(evaluated('const m = new Map.<string, uint8>([["a", 1]]); String(m.get("a"));')).toBe('1');
});

// ---------------------------------------------------------------------------
// A VALUE position is untouched
// ---------------------------------------------------------------------------

test('a value position still converts, per the conversion rule', () => {
  // The scope of the change: only identity-bearing positions. A Map's value is
  // an ordinary store and keeps the whole conversion rule.
  expect(evaluated(`const m = new Map.<uint8, string>(); ${HIDE} m.set(1, n); m.get(1);`)).toBe('1');
  expect(evaluated(`const m = new Map.<uint8, string>(); ${HIDE} m.set(1, b); m.get(1);`)).toBe('true');
  // Including through the constructor seed.
  expect(evaluated('const m = new Map.<uint8, string>([[1, 2]]); m.get(1);')).toBe('2');
});

test('everything that worked before still works', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); String(m.get("a"));')).toBe('1');
  expect(evaluated('const m = new Map.<uint8, string>(); m.set(1, "a"); m.get(1);')).toBe('a');
  expect(evaluated('const s2 = new Set.<string>(); s2.add("x"); String(s2.size);')).toBe('1');
  // A literal takes the target's type rather than converting to it, so literal
  // propagation is unaffected - which is the common spelling and the one a
  // reader would notice breaking.
  expect(evaluated('const s2 = new Set.<uint8>(); s2.add(1); String(s2.size);')).toBe('1');
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 300 - 299); String(m.get("a"));')).toBe('1');
  // A branded string still satisfies a `string` key, being a String.
  expect(evaluated('const m = new Map.<string, uint8>(); const k = ("a" := string); m.set(k, 1); String(m.get("a"));')).toBe('1');
});

test('the untyped collection is untouched, as ever', () => {
  expect(evaluated('const m = new Map(); m.set(1, "a"); m.set(true, "b"); m.set({}, "c"); String(m.size);')).toBe('3');
  expect(evaluated('const s2 = new Set(); s2.add(1); s2.add("1"); String(s2.size);')).toBe('2');
});
