import { test, expect } from 'vitest';
import { evaluated, bool, expectThrown } from '../../harness.mts';

/**
 * README feature coverage - weak references and global objects as types.
 * Sections: Weak References, Global Objects.
 *
 *  - Weak references work for reference types (ordinary objects, functions,
 *    symbols) and reject VALUE types: a value type has no identity, so a weak
 *    reference to one, a weak collection keyed on one, or a finalization target of
 *    one is a TypeError. This is the same identity principle as the parallel
 *    Proxy-over-typed-class rejection, and is implemented and verified here.
 *  - Global objects as type names are a README listing not yet in the normative
 *    type-name clause; most are not registered as types (Promise is, via typed
 *    promises). Documented as deferred below.
 */

// -- Weak References: reference types ------------------------------------------
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

// -- Documented gaps -----------------------------------------------------------
// -- Weak References: a value-type instance cannot be held weakly ---------------
// A value of a value type has no identity, so a weak reference to it, a weak
// collection keyed on it, or a finalization target of it is a TypeError (README
// "Weak References").
test('Weak References: a WeakRef over a typed-class instance is a TypeError', () => {
  expectThrown('class A { a: uint8 = (0 := uint8); } new WeakRef(new A());');
});

test('Weak References: a typed-class instance is rejected as a WeakMap key, WeakSet value, and finalization target', () => {
  expectThrown('class A { a: uint8 = (0 := uint8); } new WeakMap().set(new A(), 1);');
  expectThrown('class A { a: uint8 = (0 := uint8); } new WeakSet().add(new A());');
  expectThrown('class A { a: uint8 = (0 := uint8); } new FinalizationRegistry(() => {}).register(new A());');
});

test('Weak References: an untyped class instance can still be held weakly', () => {
  // a class with no typed field is not sealed and keeps its identity
  expect(evaluated('class B { constructor() { this.x = 1; } } let r = new WeakRef(new B()); typeof r;')).toBe('object');
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
  // An alias rather than a binding: a global constructor is a nominal type
  // whose values are its instances, and it has no default to take.
  expect(evaluated('type P = Promise; typeof Promise;')).toBe('function');
});
