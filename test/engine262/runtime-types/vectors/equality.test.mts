import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Two vectors compared as values (#sec-equality-and-comparison, #sec-which-operations-each-family-defines).
 *
 * "Every `vector.<T, N>` is a value type. It copies on assignment, it has no identity." The vector
 * family defines `equal`, `sameValue` and `sameValueZero`, "applied lane-wise". So two vectors of one
 * type are `===` exactly when each pair of lanes is, are the same value to `Object.is` when each lane
 * is the same value, and are one key of a Map likewise. `==` is not this: it is the lane comparison,
 * and yields a mask.
 *
 * A vector was compared as two objects are, so two vectors with the same lanes were never equal, and
 * neither were two instances of a value type class holding one.
 */

test('two vectors of one type with equal lanes are the same value', () => {
  expect(evaluated('function f() { const a = vector.<float32, 4>(1, 2, 3, 4); const b = vector.<float32, 4>(1, 2, 3, 4); const c = vector.<float32, 4>(1, 2, 3, 5); const u: any = { a, b, c }; return String(u.a === u.b) + String(u.a === u.c) + String(u.a !== u.c) + String(Object.is(u.a, u.b)) + String(Object.is(u.a, u.c)); } f();'))
    .toBe('truefalsetruetruefalse');
  // A default is the vector of zeroes, and two of them are one value.
  expect(evaluated('function f() { let a: vector.<float32, 4>; let b: vector.<float32, 4>; const u: any = { a, b }; return String(u.a === u.b); } f();')).toBe('true');
  // The named shorthands are the same types.
  expect(evaluated('String(int32x4(1, 2, 3, 4) === int32x4(1, 2, 3, 4)) + String(int32x4(1, 2, 3, 4) === int32x4(1, 2, 3, 5));')).toBe('truefalse');
});

test('a vector of another type, and a value that is no vector, are other values', () => {
  expect(evaluated('function f() { const a = vector.<float32, 4>(1, 2, 3, 4); const b = vector.<int32, 4>(1, 2, 3, 4); const u: any = { a, b }; return String(u.a === u.b) + String(u.a === 1) + String(u.a === undefined) + String(u.a === u); } f();'))
    .toBe('falsefalsefalsefalse');
  // Where both types are known the comparison is refused: it can never be true.
  expectStaticTypeError('const a = vector.<float32, 4>(1, 2, 3, 4); const b = vector.<int32, 4>(1, 2, 3, 4); a === b;');
});

test('each lane compares as its type does: a NaN lane and the two zeroes', () => {
  // `===` asks numerical equality, `Object.is` the same value, and a Set the same value with the zeroes merged.
  expect(evaluated('function f() { const a = vector.<float32, 2>(NaN, 0); const u: any = { a }; return String(u.a === u.a) + String(Object.is(u.a, u.a)) + String(new Set([u.a]).has(u.a)); } f();'))
    .toBe('falsetruetrue');
  expect(evaluated('function f() { const z = vector.<float32, 2>(1, 0); const w = vector.<float32, 2>(1, -0); const u: any = { z, w }; return String(u.z === u.w) + String(Object.is(u.z, u.w)) + String(new Set([u.z]).has(u.w)); } f();'))
    .toBe('truefalsetrue');
});

test('an equal vector is one key of a Map and one member of a Set', () => {
  expect(evaluated("function f() { const a = vector.<float32, 4>(1, 2, 3, 4); const b = vector.<float32, 4>(1, 2, 3, 4); const m = new Map(); m.set(a, 'x'); return String(m.get(b)) + String(new Set([a, b]).size) + String([a].includes(b)) + String([a].indexOf(b)); } f();"))
    .toBe('x1true0');
});

test('a value type class holding a vector is compared by it', () => {
  expect(evaluated('class K { v: vector.<float32, 4>; n: uint8; } function f() { const x = new K(); const y = new K(); const u: any = { x, y }; const same = u.x === u.y; y.n = 1; return String(same) + String(u.x === u.y) + String(new Set([x]).has(new K())); } f();'))
    .toBe('truefalsetrue');
});

test('== between vectors is still the lane comparison', () => {
  expect(evaluated('function f(): string { const a = vector.<float32, 4>(1, 2, 3, 4); const b = vector.<float32, 4>(1, 0, 3, 0); const m: boolean32x4 = a == b; return String(m.lane.<0>().all()) + String(m.lane.<1>().all()); } f();'))
    .toBe('truefalse');
});
