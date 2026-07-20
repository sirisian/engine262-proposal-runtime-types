import { test, expect } from 'vitest';
import { evaluated, bool } from './harness.mts';

/**
 * README feature coverage — weak references and global objects as types.
 * Sections: Weak References, Global Objects.
 *
 *  - Weak references work for reference types (ordinary objects, functions,
 *    symbols). The rejection of VALUE types (a value type has no identity, so
 *    weakly holding one is meaningless) follows from the value-type principle but
 *    has no explicit normative clause - unlike the parallel Proxy-over-typed-class
 *    rejection, which is normative and implemented - so it is documented as a gap
 *    (PENDING-CAPABILITIES.md capability I).
 *  - Global objects as type names are a README listing not yet in the normative
 *    type-name clause; most are not registered as types (Promise is, via typed
 *    promises). Documented as a gap.
 */

// ── Weak References: reference types ──────────────────────────────────────────
// WeakRef, WeakMap keys, and WeakSet values accept reference types.
test('Weak References: a WeakRef holds an ordinary object', () => {
  expect(evaluated('let o = {}; let r = new WeakRef(o); typeof r;')).toBe('object');
  // deref returns the referent while it is alive
  expect(evaluated('let o = { x: 1 }; let r = new WeakRef(o); String(r.deref() === o);')).toBe('true');
});

test('Weak References: WeakMap and WeakSet accept object keys/values', () => {
  expect(evaluated('let o = {}; let m = new WeakMap(); m.set(o, 42); String(m.get(o));')).toBe('42');
  expect(evaluated('let o = {}; let s = new WeakSet(); s.add(o); String(s.has(o));')).toBe('true');
});

// ── Documented gaps ───────────────────────────────────────────────────────────
test('Weak References: a value-type instance is not rejected (documents the gap)', () => {
  // Target (README): `new WeakRef(a)` for a value-type class A is a TypeError,
  // since a value type has no identity to weakly hold. This follows from the
  // value-type principle but has no explicit normative clause, so today it
  // succeeds. (The parallel Proxy-over-typed-class rejection IS normative and is
  // enforced - see the proxy file.)
  expect(evaluated('class A { a: uint8 = (0 := uint8); } let a = new A(); let r = new WeakRef(a); typeof r;')).toBe('object');
});

test('Global Objects: global constructors are usable as type names', () => {
  // README "Global Objects": Error, Map, Date, and the rest are usable as type
  // annotations, each a nominal type whose values are its instances.
  expect(evaluated('let e: Error = new Error("x"); typeof e;')).toBe('object');
  expect(evaluated('let m: Map = new Map(); typeof m;')).toBe('object');
  expect(evaluated('let d: Date = new Date(); typeof d;')).toBe('object');
  // membership is by the prototype chain, so a subtype relation holds
  expect(bool('let e = new TypeError("x"); String(e instanceof Error);')).toBe(true);
  // Promise remains registered with its dedicated typed-promise support
  expect(evaluated('let p: Promise; typeof Promise;')).toBe('function');
});
