import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Weak references reject value types.
 *
 * A value of a value type has no identity (spec sec-value-types), so weakly
 * holding one is meaningless: there is nothing for the reference to observe the
 * liveness of. Constructing a WeakRef over a typed-class instance, using one as a
 * WeakMap key or WeakSet value, or registering one as a FinalizationRegistry
 * target is therefore a TypeError (README "Weak References"). This is the same
 * identity principle as the parallel rejection of a Proxy over a typed-class
 * instance. An ordinary object, a function, and a registered Symbol are held
 * weakly as before; only an instance of a typed class, the same instance that
 * cannot be proxied, is rejected.
 */

// -- WeakRef -------------------------------------------------------------------
test('a WeakRef over a typed-class instance is a TypeError', () => {
  expectThrown('class A { x: uint8 = (1 := uint8); } new WeakRef(new A());');
});

// -- WeakMap and WeakSet -------------------------------------------------------
test('a typed-class instance is rejected as a WeakMap key', () => {
  expectThrown('class A { x: uint8 = (1 := uint8); } let m = new WeakMap(); m.set(new A(), 1);');
});

test('a typed-class instance is rejected as a WeakSet value', () => {
  expectThrown('class A { x: uint8 = (1 := uint8); } let s = new WeakSet(); s.add(new A());');
});

// -- FinalizationRegistry ------------------------------------------------------
test('a typed-class instance is rejected as a FinalizationRegistry target', () => {
  expectThrown('class A { x: uint8 = (1 := uint8); } let r = new FinalizationRegistry(() => {}); r.register(new A());');
});

// -- Reference types are unaffected --------------------------------------------
test('an ordinary object can still be held weakly', () => {
  expect(evaluated('let o = {}; let w = new WeakRef(o); typeof w;')).toBe('object');
  expect(evaluated('let o = {}; let m = new WeakMap(); m.set(o, 1); String(m.get(o));')).toBe('1');
});

test('a function can still be held weakly', () => {
  expect(evaluated('function f() {} let w = new WeakRef(f); typeof w;')).toBe('object');
});

test('an untyped class instance keeps its identity and can be held weakly', () => {
  // a class with no typed field is not sealed, so it is an ordinary object
  expect(evaluated('class B { constructor() { this.x = 1; } } let w = new WeakRef(new B()); typeof w;')).toBe('object');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, weak references do not reject anything new', () => {
  // without the feature there are no typed-class instances; an ordinary object is held
  const c = runFlagOff('let o = {}; let w = new WeakRef(o); typeof w;') as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('object');
});
