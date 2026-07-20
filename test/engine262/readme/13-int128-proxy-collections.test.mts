import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — 128-bit integers, Proxy and typed objects, keyed
 * collections.
 * Sections: 128-bit Integer Types, Proxy and Typed Objects, Keyed Collections.
 *
 *  - 128-bit types (int128/uint128) are core type names that resolve and intern;
 *    like the 64-bit types they do not implicitly convert to number. The
 *    value-level 128-bit arithmetic (two 64-bit limbs) is the numeric-value
 *    runtime the memory-layout/number sections cover.
 *  - Proxy over a typed-class instance is a TypeError (normative core): such a
 *    value is layout-backed and a trap has no correct point to run. Verified here.
 *  - Keyed collections work; the value-type-key structural comparison is the
 *    memory-layout extension (value type classes) and is not exercised here.
 */

// ── 128-bit Integer Types ─────────────────────────────────────────────────────
// int128 and uint128 are type names following the 64-bit rules.
test('128-bit: int128 and uint128 are type names that resolve and intern', () => {
  expect(evaluated('let x: uint128; typeof uint128;')).toBe('object');
  expect(evaluated('let x: int128; typeof int128;')).toBe('object');
  // interned identity
  expect(ok('type A = uint128; type B = uint128; A === B;')).toBe(true);
  expect(bool('type A = uint128; type B = int128; String(A === B);')).toBe(false);
});

test('128-bit: a 128-bit type does not implicitly convert to number', () => {
  // the non-implicit-conversion rule (as for other value types)
  expectThrown('let id: uint128; let n: number = id;');
});

// ── Proxy and Typed Objects ───────────────────────────────────────────────────
// Constructing a Proxy over a typed-class instance is a TypeError; an untyped
// object is unchanged.
test('Proxy: constructing a proxy over a typed-class instance is a TypeError', () => {
  expectThrown('class A { x: uint32 = (0 := uint32); } new Proxy(new A(), {});');
  // a field-only typed class (default constructor) is likewise rejected
  expectThrown('class A { x: uint32; } new Proxy(new A(), {});');
});

test('Proxy: an untyped object or class is still proxyable', () => {
  expect(evaluated('let p = new Proxy({ a: 0 }, {}); typeof p;')).toBe('object');
  // an untyped class instance has a property table, so it is proxyable
  expect(evaluated('class A { constructor() { this.x = 1; } } let p = new Proxy(new A(), {}); typeof p;')).toBe('object');
  // a `dynamic` typed class is unsealed and proxyable
  expect(evaluated('dynamic class A { x: uint32 = (0 := uint32); } let p = new Proxy(new A(), {}); typeof p;')).toBe('object');
});

// ── Keyed Collections ─────────────────────────────────────────────────────────
// Map and Set work with primitive and object keys as usual.
test('Keyed Collections: Map and Set behave normally for primitive and object keys', () => {
  expect(evaluated('let m = new Map(); m.set("a", 1); String(m.get("a"));')).toBe('1');
  expect(evaluated('let s = new Set(); s.add(1); s.add(1); String(s.size);')).toBe('1');
  // an object key compares by identity
  expect(evaluated('let k = {}; let m = new Map(); m.set(k, "v"); m.get(k);')).toBe('v');
});
