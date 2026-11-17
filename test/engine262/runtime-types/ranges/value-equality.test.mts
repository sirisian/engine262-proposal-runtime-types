import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A range compared and held as a value (#sec-ranges, #sec-equality-and-comparison).
 *
 * "A range is a value type class over an ordered element type and a bound at each endpoint it has."
 * So two ranges are `===` exactly when they are of one shape and one element type, with the same
 * bound at each endpoint, and each endpoint they carry is equal; an equal range is one key of a Map;
 * and a range, having no identity, cannot be held weakly.
 *
 * A range was compared as two objects are, which the suite recorded as a divergence, and was held
 * weakly.
 */

test('two ranges of one shape with equal endpoints are the same value', () => {
  expect(evaluated('const a = 0..<3, b = 0..<3; String(a === b) + String(a !== b) + String(Object.is(a, b));')).toBe('truefalsetrue');
  expect(evaluated('const a: uint8 = 1, b: uint8 = 9; const r = a..=b, s = a..=b; String(r === s);')).toBe('true');
});

test('another endpoint, another bound, another shape and another element type are other values', () => {
  expect(evaluated('const u: any = { a: 0..<3, b: 0..<4, c: 0..=3, d: 0.., e: 1..<3 }; String(u.a === u.b) + String(u.a === u.c) + String(u.a === u.d) + String(u.a === u.e);'))
    .toBe('falsefalsefalsefalse');
  expect(evaluated('const x: uint8 = 0, y: uint8 = 3; const u: any = { a: 0..<3, b: x..<y }; String(u.a === u.b) + String(u.a === 3) + String(u.a === u);')).toBe('falsefalsefalse');
});

test('an equal range is one key of a Map and one member of a Set', () => {
  expect(evaluated("const m = new Map(); m.set(0..<3, 'x'); String(m.get(0..<3)) + String(m.get(0..<4)) + String(new Set([1..=2, 1..=2, 1..<2]).size);")).toBe('xundefined2');
});

test('a range cannot be held weakly', () => {
  expect(evaluated("let out = ''; const at = (g) => { try { g(); out += 'ok,'; } catch (e) { out += e.name + ','; } }; const u: any = { r: 0..<3 }; at(() => { new WeakRef(u.r); }); at(() => { new WeakMap().set(u.r, 1); }); at(() => { new WeakSet().add(u.r); }); out;"))
    .toBe('TypeError,TypeError,TypeError,');
});
