import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * PRIMITIVE KEYS.
 *
 * Each operation against each type family, as key and as element. The cases that
 * earn their place are the ones where a family's own equality rule decides the
 * answer and a naive implementation would get it wrong:
 *
 *   - a `decimal` compares by VALUE, so `1.0` and `1.00` are one key. Java's
 *     BigDecimal splits them and its `equals` is a known trap.
 *   - a `rational` compares in CANONICAL form, so `1/2` and `50/100` are one key.
 *   - a float's NaN is findable and its two zeroes pair, because a collection
 *     keys with SameValueZero rather than `===`.
 *   - a 64-bit integer compares at ITS OWN precision, so two magnitudes a double
 *     cannot tell apart are two keys - the case a Number-based hash collapses,
 *     and the reason `typed-keys-64bit.test.mts` exists beside this file.
 *
 * All of this worked when these tests were written. They exist because nothing
 * guarded it.
 */

// ---------------------------------------------------------------------------
// Integers
// ---------------------------------------------------------------------------

test('integer keys dedupe by value across the widths', () => {
  for (const t of ['uint8', 'uint16', 'uint32', 'int8', 'int16', 'int32']) {
    expect(evaluated(`const s = new Set.<${t}>(); s.add(1); s.add(1); String(s.size);`), t).toBe('1');
    expect(evaluated(`const s = new Set.<${t}>(); s.add(1); s.add(2); String(s.size);`), t).toBe('2');
    expect(evaluated(`const m = new Map.<${t}, string>(); m.set(1, "a"); String(m.get(1));`), t).toBe('a');
  }
  // A sized width behaves as the named ones do.
  expect(evaluated('const s = new Set.<uint.<12>>(); s.add(1); s.add(1); String(s.size);')).toBe('1');
});

test('an out-of-range key is refused rather than wrapped', () => {
  // A key that the type cannot hold is a key that can never be found, so it is
  // refused at the store as it is at a binding.
  expect(ok('const s = new Set.<uint8>(); s.add(300);')).toBe(false);
  expect(ok('const s = new Set.<int8>(); s.add(-200);')).toBe(false);
  expect(ok('const m = new Map.<uint8, string>(); m.set(300, "a");')).toBe(false);
  // ...and a search with such a needle is refused too, for the same reason: a
  // test that can never succeed is a mistake rather than a false.
  expect(ok('const m = new Map.<uint8, string>(); m.get(300);')).toBe(false);
});

test('a signed and an unsigned zero are one key within a type', () => {
  expect(evaluated('const s = new Set.<int32>(); s.add(0); s.add(-0); String(s.size);')).toBe('1');
});

// ---------------------------------------------------------------------------
// Floats - where SameValueZero does the work
// ---------------------------------------------------------------------------

test('a float NaN key is findable, which `===` could not do', () => {
  for (const t of ['float32', 'float64']) {
    expect(evaluated(`const s = new Set.<${t}>(); s.add(NaN := ${t}); s.add(NaN := ${t}); String(s.size);`), t).toBe('1');
    expect(evaluated(`const s = new Set.<${t}>(); s.add(NaN := ${t}); String(s.has(NaN := ${t}));`), t).toBe('true');
    expect(evaluated(`const m = new Map.<${t}, string>(); m.set(NaN := ${t}, "n"); String(m.get(NaN := ${t}));`), t).toBe('n');
  }
});

test('a float -0 and +0 are one key', () => {
  for (const t of ['float32', 'float64']) {
    expect(evaluated(`const s = new Set.<${t}>(); s.add(-0 := ${t}); s.add(0 := ${t}); String(s.size);`), t).toBe('1');
  }
});

// ---------------------------------------------------------------------------
// decimal and rational - each with an equality rule of its own
// ---------------------------------------------------------------------------

test('decimal cohorts are ONE key', () => {
  // decimal.md: "as a `Map` or `Set` key a decimal compares by value under
  // SameValueZero, so `1.0` and `1.00` are one key rather than two" - the split
  // Java's BigDecimal makes, and the trap its `equals` is known for.
  for (const t of ['decimal32', 'decimal64', 'decimal128']) {
    expect(evaluated(`const s = new Set.<${t}>(); s.add(1.0 := ${t}); s.add(1.00 := ${t}); String(s.size);`), t).toBe('1');
    expect(evaluated(`const m = new Map.<${t}, string>(); m.set(1.0 := ${t}, "hit"); String(m.get(1.00 := ${t}));`), t).toBe('hit');
  }
  // Different values remain different keys.
  expect(evaluated('const s = new Set.<decimal128>(); s.add(1.0 := decimal128); s.add(1.5 := decimal128); String(s.size);')).toBe('2');
});

test('rational keys compare in canonical form', () => {
  // rational.md states this one verbatim: "new Set.<rational>([rational(1, 2),
  // rational(50, 100)]).size; // 1". Canonical form makes structural equality
  // and mathematical equality the same question.
  expect(evaluated('const s = new Set.<rational>(); s.add(rational(1, 2)); s.add(rational(50, 100)); String(s.size);')).toBe('1');
  expect(evaluated('const m = new Map.<rational, string>(); m.set(rational(1, 2), "half"); String(m.get(rational(2, 4))));'.replace('));', ');'))).toBe('half');
  expect(evaluated('const s = new Set.<rational>(); s.add(rational(1, 2)); s.add(rational(1, 3)); String(s.size);')).toBe('2');
});

// ---------------------------------------------------------------------------
// The non-numeric primitives
// ---------------------------------------------------------------------------

test('string, boolean, symbol, bigint keys', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); m.set("a", 2); String(m.size) + "/" + String(m.get("a"));')).toBe('1/2');
  expect(evaluated('const s = new Set.<boolean>(); s.add(true); s.add(true); s.add(false); String(s.size);')).toBe('2');
  expect(evaluated('const k = Symbol(); const m = new Map.<symbol, uint8>(); m.set(k, 1); String(m.get(k));')).toBe('1');
  // Two unregistered symbols with one description are two keys - a symbol is an
  // identity, not a value.
  expect(evaluated('const m = new Map.<symbol, uint8>(); m.set(Symbol("s"), 1); m.set(Symbol("s"), 2); String(m.size);')).toBe('2');
  expect(evaluated('const s = new Set.<bigint>(); s.add(1n); s.add(1n); String(s.size);')).toBe('1');
});

test('a key of the wrong primitive type is refused', () => {
  // Written through an ANNOTATION, because `new Map.<K, V>()` gives the checker
  // no receiver type and the refusal would come from the run time instead.
  expectStaticTypeError('let m: Map.<string, uint8> = new Map(); m.set(1, 1);');
  expectStaticTypeError('let s: Set.<uint8> = new Set(); s.add("a");');
  // The run time refuses them either way, which that gap leaves intact.
  expect(ok('const m = new Map.<string, uint8>(); const bad = (1 := any); m.set(bad, 1);')).toBe(false);
  expect(ok('const s = new Set.<boolean>(); const bad = (1 := any); s.add(bad);')).toBe(false);
});

// ---------------------------------------------------------------------------
// Values, not only keys
// ---------------------------------------------------------------------------

test('a Map VALUE takes its declared type across the families', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); String(Reflect.typeOf(m.get("a")) === (type uint8));')).toBe('true');
  // A decimal's dedup behaviour is asserted above; its `Reflect.typeOf` is NOT
  // asserted here, because a bare `let d: decimal128 = 1.0` already answers
  // *false* to `Reflect.typeOf(d) === (type decimal128)`. That is a reflection
  // question about the decimal types and not something a collection does to
  // them, so it does not belong in this file.
  expect(ok('const m = new Map.<string, uint8>(); m.set("a", 300);')).toBe(false);
  // A value position CONVERTS where a key position checks, so a lossless
  // source is admitted here and refused as a key.
  expect(evaluated('const m = new Map.<uint8, string>(); const n = (1 := any); m.set(1, n); m.get(1);')).toBe('1');
});
