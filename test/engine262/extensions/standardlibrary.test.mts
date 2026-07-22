import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * Extension coverage — standardlibrary.md (Standard Library Signatures).
 *
 * This extension is explicitly "signature listings rather than new features":
 * every method it types already exists, and the signatures state how element and
 * key types flow through so a fully typed call site infers its callbacks. The
 * type-level signatures are a static-checker concern (there is no separate
 * runtime feature). The underlying methods are all present and are verified here;
 * the typed-signature inference rides on the (deferred) static type checker.
 */

// ── Iterator helpers ──────────────────────────────────────────────────────────
test('standard library: Iterator map/filter/take/drop work', () => {
  expect(evaluated('String([1,2,3].values().map(x => x * 2).toArray().length);')).toBe('3');
  expect(evaluated('String([1,2,3,4].values().filter(x => x % 2 === 0).toArray().length);')).toBe('2');
  expect(evaluated('String([1,2,3,4,5].values().take(2).toArray().length);')).toBe('2');
  expect(evaluated('String([1,2,3,4,5].values().drop(2).toArray().length);')).toBe('3');
});

test('standard library: Iterator reduce/some/every/find work', () => {
  expect(evaluated('String([1,2,3].values().reduce((a, b) => a + b, 0));')).toBe('6');
  expect(evaluated('String([1,2,3].values().some(x => x === 2));')).toBe('true');
  expect(evaluated('String([1,2,3].values().every(x => x > 0));')).toBe('true');
  expect(evaluated('String([1,2,3].values().find(x => x === 2));')).toBe('2');
});

test('standard library: flatMap and forEach work', () => {
  expect(evaluated('String([1,2].values().flatMap(x => [x, x]).toArray().length);')).toBe('4');
  expect(evaluated('let n = 0; [1,2,3].values().forEach(() => { n += 1; }); String(n);')).toBe('3');
});

// ── Grouping ──────────────────────────────────────────────────────────────────
test('standard library: Object.groupBy groups by the callback key', () => {
  expect(evaluated('let g = Object.groupBy([1,2,3,4], x => x % 2 === 0 ? "even" : "odd"); String(g.even.length);')).toBe('2');
  expect(evaluated('let g = Object.groupBy([1,2,3,4], x => x % 2 === 0 ? "even" : "odd"); String(g.odd.length);')).toBe('2');
});

// ── Set operations ────────────────────────────────────────────────────────────
test('standard library: the Set operations work', () => {
  expect(evaluated('String(new Set([1,2]).union(new Set([2,3])).size);')).toBe('3');
  expect(evaluated('String(new Set([1,2,3]).intersection(new Set([2,3,4])).size);')).toBe('2');
  expect(evaluated('String(new Set([1,2,3]).difference(new Set([2])).size);')).toBe('2');
});

// ── Promise statics ───────────────────────────────────────────────────────────
test('standard library: the Promise combinators are present', () => {
  expect(evaluated('typeof Promise.all;')).toBe('function');
  expect(evaluated('typeof Promise.allSettled;')).toBe('function');
  expect(evaluated('typeof Promise.any;')).toBe('function');
  expect(evaluated('typeof Array.fromAsync;')).toBe('function');
});

// ── The built-in method signatures are not yet typed ──────────────────────────
test('standard library: an array method does not carry a typed signature (documents the gap)', () => {
  // standardlibrary.md: the built-in signatures should be typed, so a callback
  // parameter and the result element type follow the receiver's element type.
  // Today the methods are the ordinary untyped ones: a callback returning a plain
  // value out of the element type's range is neither rejected nor coerced, so the
  // result holds a plain number rather than a value of the element type.
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let good = "no-throw"; try { a.map((x) => 999); } catch { good = "throws"; } good;')).toBe('no-throw');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let b = a.map((x) => 999); String(b[0]);')).toBe('999');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let b = a.map((x) => 999); String(b[0] instanceof uint8);')).toBe('false');
});
