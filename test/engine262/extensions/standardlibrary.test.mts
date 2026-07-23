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

// ── The numeric library: a Math function preserves the type it is given ───────
test('standard library: a Math function preserves a float argument type', () => {
  // the numeric library overloads the existing functions so that they preserve the
  // type they are given, so no conversion is written at a call
  expect(evaluated('(Math.sqrt((4 := float32)) is float32) ? "f32" : "plain";')).toBe('f32');
  expect(evaluated('String(Number(Math.sqrt((4 := float32))));')).toBe('2');
  expect(evaluated('(Math.floor((1.7 := float32)) is float32) ? "f32" : "plain";')).toBe('f32');
  // and the carried result is a value of that width, rounded to it
  expect(evaluated('let x = Math.sqrt((2 := float32)); String(Number(x) - Math.fround(Number(x)));')).toBe('0');
});

test('standard library: an integer type is preserved only where the result is one', () => {
  // the rule holds where the result is a number of the same kind
  expect(evaluated('(Math.abs(((0 - 5) := int32)) is int32) ? "i32" : "plain";')).toBe('i32');
  expect(evaluated('(Math.sign(((0 - 5) := int32)) is int32) ? "i32" : "plain";')).toBe('i32');
  expect(evaluated('(Math.max((1 := uint8), (2 := uint8)) is uint8) ? "u8" : "plain";')).toBe('u8');
  // a square root is generally not an integer, so it stays a plain Number rather
  // than being forced into a type it does not belong to
  expect(evaluated('(Math.sqrt((2 := int32)) is int32) ? "i32" : "plain";')).toBe('plain');
  expect(evaluated('String(Math.sqrt((2 := int32)) > 1.41);')).toBe('true');
  expect(evaluated('String(Number.isNaN(Math.sqrt(((0 - 1) := int32))));')).toBe('true');
});

test('standard library: preservation needs agreement, and a plain literal does not block it', () => {
  // a literal written at a call is the case literal propagation already covers
  expect(evaluated('(Math.pow((2 := float32), 3) is float32) ? "f32" : "plain";')).toBe('f32');
  // two typed arguments of different types have no one type to preserve
  expect(evaluated('(Math.max((1 := uint8), (2 := uint16)) is uint8) ? "u8" : "plain";')).toBe('plain');
  // and an untyped call is untouched
  expect(evaluated('String(Math.sqrt(4));')).toBe('2');
  expect(evaluated('String(Math.max(1, 2));')).toBe('2');
});
