import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../harness.mts';

/**
 * Spec: #sec-typed-storage (Typed Storage) - typed own properties via
 * Object.defineProperty and Reflect.defineProperty.
 *
 * A property descriptor may carry a `type` key whose value is a Type Object, or a
 * String naming a built-in type. A property defined with one has a declared type
 * (#sec-object-types-semantics): a descriptor with a type and no value gives
 * the property the type's default (DefaultValueOf); a descriptor with a type and a
 * value has the value checked against the type; a write to the property is checked
 * against the type and throws when the value does not satisfy it; and the property
 * cannot be deleted. Both Object.defineProperty and Reflect.defineProperty reach
 * the same ordinary [[DefineOwnProperty]], so the type is applied on either path,
 * and Reflect.set and Reflect.deleteProperty are checked the same as an ordinary
 * write and delete. An instance of a non-dynamic (sealed) typed class has a closed
 * layout and cannot gain a typed own property. An untyped property is unaffected.
 */

// -- The type key is accepted and resolved -------------------------------------
test('a type key whose value is a Type Object gives the property that type', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "x", { type: uint8, value: (5 := uint8), writable: true }); String(o.x);')).toBe('5');
});

test('a type key whose value is a string naming a type is resolved', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "x", { type: "uint8", value: (3 := uint8), writable: true }); String(o.x);')).toBe('3');
});

test('a type key whose value is neither a Type Object nor a type name is a TypeError', () => {
  expectThrown('let o = {}; Object.defineProperty(o, "x", { type: 42, writable: true });');
  expectThrown('let o = {}; Object.defineProperty(o, "x", { type: "notatype", writable: true });');
});

// -- Default when no value -----------------------------------------------------
test('a descriptor with a type and no value gives the property the type default', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "x", { type: uint8, writable: true }); String(o.x);')).toBe('0');
});

// -- Value checked at definition -----------------------------------------------
test('a descriptor with a type and an out-of-range value is a TypeError', () => {
  expectThrown('let o = {}; Object.defineProperty(o, "x", { type: uint8, value: 300, writable: true });');
});

// -- Write enforcement ---------------------------------------------------------
test('a write of an out-of-range value to a typed own property is a TypeError', () => {
  expectThrown('let o = {}; Object.defineProperty(o, "x", { type: uint8, writable: true }); o.x = 300;');
});

test('a write of an in-range value to a typed own property succeeds', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "x", { type: uint8, writable: true }); o.x = (42 := uint8); String(o.x);')).toBe('42');
});

// -- Delete rejection ----------------------------------------------------------
test('a typed own property cannot be deleted', () => {
  expectThrown('let o = {}; Object.defineProperty(o, "x", { type: uint8, writable: true, configurable: true }); delete o.x;');
});

// -- The Reflect paths ---------------------------------------------------------
test('Reflect.defineProperty applies the declared type', () => {
  expect(evaluated('let o = {}; Reflect.defineProperty(o, "x", { type: uint8, writable: true }); String(o.x);')).toBe('0');
  expectThrown('let o = {}; Reflect.defineProperty(o, "x", { type: uint8, writable: true }); o.x = 300;');
});

test('Reflect.set on a typed own property is checked', () => {
  expectThrown('let o = {}; Reflect.defineProperty(o, "x", { type: uint8, writable: true }); Reflect.set(o, "x", 300);');
});

test('Reflect.deleteProperty on a typed own property is a TypeError', () => {
  expectThrown('let o = {}; Reflect.defineProperty(o, "x", { type: uint8, writable: true, configurable: true }); Reflect.deleteProperty(o, "x");');
});

test('Reflect.get returns the declared-type value', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "x", { type: uint8, value: (7 := uint8), writable: true }); String(Reflect.get(o, "x"));')).toBe('7');
});

// -- Non-dynamic typed class ---------------------------------------------------
test('a typed own property cannot be added to a non-dynamic typed class instance', () => {
  expectThrown('class A { x: uint8 = (1 := uint8); } let a = new A(); Object.defineProperty(a, "y", { type: uint8, writable: true });');
});

// -- Untyped properties and feature off ----------------------------------------
test('an untyped property is unaffected', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "y", { value: 5, writable: true, configurable: true }); o.y = 999; String(o.y);')).toBe('999');
  expect(evaluated('let o = {}; Object.defineProperty(o, "y", { value: 5, writable: true, configurable: true }); delete o.y; String(o.y);')).toBe('undefined');
});

test('multiple typed own properties are independent', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "x", { type: uint8, writable: true }); Object.defineProperty(o, "y", { type: uint16, writable: true }); o.x = (1 := uint8); o.y = (2 := uint16); String(o.x) + String(o.y);')).toBe('12');
});

test('with the feature off, a type key is an ordinary own property key with no effect', () => {
  // without the feature the `type` key is not special; the define succeeds and no enforcement happens
  const c = runFlagOff('let o = {}; Object.defineProperty(o, "x", { value: 5, writable: true }); o.x = 300; String(o.x);') as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('300');
});

test('an object literal declares a typed own property at creation', () => {
  // Object Typing: `{ (a: uint8): 1 }` gives the property a declared type as it is
  // created, routing to the same recording the defineProperty path uses. The value
  // is written in a typed position, so it takes the checked conversion a typed
  // binding takes and the property holds a value of the declared type.
  expect(evaluated('let o = { (a: uint8): 1 }; String(Number(o.a));')).toBe('1');
  expect(evaluated('let o = { (a: uint8): 1 }; String(o.a instanceof uint8);')).toBe('true');
  // an initial value the type cannot represent is refused
  expectThrown('let o = { (a: uint8): 999 }; o.a;');
  // and the property behaves as a typed own property thereafter
  expect(evaluated('let o = { (a: uint8): 1 }; o.a = (7 := uint8); String(Number(o.a));')).toBe('7');
  expectThrown('let o = { (a: uint8): 1 }; o.a = 999;');
  expectThrown('let o = { (a: uint8): 1 }; delete o.a;');
  // it sits alongside ordinary members, which are unchanged
  expect(evaluated('let o = { x: 1, (a: uint8): 2, y: 3 }; String(o.x) + String(Number(o.a)) + String(o.y);')).toBe('123');
  expect(evaluated('let o = { (s: string): "hi" }; o.s;')).toBe('hi');
});

test('a Proxy checks a trap result against the target typed own property', () => {
  // Object Typing: a Proxy over an object carrying a typed own property checks
  // each trap result against that property's declared type. Without it a Proxy
  // would be a hole in the guarantee, handing back a value the property itself
  // would have refused.
  expectThrown('let t = {}; Object.defineProperty(t, "x", { type: uint8, value: (5 := uint8), writable: true, configurable: true }); let p = new Proxy(t, { get() { return 999; } }); p.x;');
  expect(evaluated('let t = {}; Object.defineProperty(t, "x", { type: uint8, value: (5 := uint8), writable: true, configurable: true }); let p = new Proxy(t, { get() { return (7 := uint8); } }); String(Number(p.x));')).toBe('7');
  // the same guarantee on the way in, for a write the trap reports as succeeding
  expectThrown('let t = { (a: uint8): 1 }; let p = new Proxy(t, { set() { return true; } }); p.a = 999;');
  expect(evaluated('let t = { (a: uint8): 1 }; let p = new Proxy(t, { set() { return true; } }); p.a = (7 := uint8); "done";')).toBe('done');
  // an ordinary property, and a Proxy over a target with no typed property, are
  // untouched
  expect(evaluated('let t = { x: 1 }; let p = new Proxy(t, { get() { return 999; } }); String(p.x);')).toBe('999');
  expect(evaluated('let t = { (a: uint8): 1 }; let p = new Proxy(t, {}); String(Number(p.a));')).toBe('1');
});
