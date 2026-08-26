import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * PLAN-typed-collections.md sec 6.3 - the remaining key families.
 *
 * The plan lists `typed-keys-types`, `typed-keys-enums`, `typed-keys-references`
 * and `typed-keys-composed` as four files. They are one here: each is a handful
 * of assertions about how a family's identity rule reaches a collection, and
 * splitting them four ways would put one test in each file and hide what they
 * have in common - which is that a collection keys on whatever its element type
 * says identity is, and does nothing of its own.
 *
 * The families with a rule worth a file of their own already have one:
 * `typed-keys-primitives`, `typed-keys-64bit`, `typed-keys-composite`, and
 * `value-type-keys` (blocked on D5).
 */

// ---------------------------------------------------------------------------
// Type objects as keys - the registry idiom
// ---------------------------------------------------------------------------

test('a type object is a key, and types are interned so one type is one key', () => {
  expect(evaluated('const m = new Map.<type, string>(); m.set(uint8, "u"); String(m.get(uint8));')).toBe('u');
  // Two mentions of one type are one key, which is what makes a type registry
  // work at all.
  expect(evaluated('const m = new Map.<type, string>(); m.set(type Map.<string, uint8>, "m"); String(m.get(type Map.<string, uint8>));')).toBe('m');
  expect(evaluated('const s = new Set.<type>(); s.add(uint8); s.add(uint8); String(s.size);')).toBe('1');
  // An instantiation and its base are two keys, and two instantiations are two.
  expect(evaluated('const s = new Set.<type>(); s.add(type Set.<uint8>); s.add(type Set); String(s.size);')).toBe('2');
  expect(evaluated('const s = new Set.<type>(); s.add(type Set.<uint8>); s.add(type Set.<string>); String(s.size);')).toBe('2');
});

test('the two comparisons a type registry rests on are different ones', () => {
  // A collection keys with SameValueZero, so `+0` and `-0` are ONE key. Type
  // INTERNING uses SameValue, so `A.<0>` and `A.<-0>` are two types. Both rules
  // are visible in one program and they do not have to agree, which is worth
  // pinning because a reader expects them to.
  expect(evaluated('const s = new Set(); s.add(0); s.add(-0); String(s.size);')).toBe('1');
  expect(evaluated('class A<N> { x: uint8; } String((type A.<0>) === (type A.<-0>));')).toBe('false');
});

// ---------------------------------------------------------------------------
// Enumerators
// ---------------------------------------------------------------------------

test('enumerators are keys by value, and two enums do not collide', () => {
  expect(evaluated('enum E: uint8 { A, B } const s = new Set.<E>(); s.add(E.A); s.add(E.A); String(s.size);')).toBe('1');
  expect(evaluated('enum E: uint8 { A, B } const s = new Set.<E>(); s.add(E.A); s.add(E.B); String(s.size);')).toBe('2');
  expect(evaluated('enum E: uint8 { A } const m = new Map.<E, string>(); m.set(E.A, "a"); String(m.get(E.A));')).toBe('a');
  // Two enums whose members share an underlying value are still two types, so
  // their members are two keys.
  expect(evaluated('enum E: uint8 { A } enum F: uint8 { A } const s = new Set(); s.add(E.A); s.add(F.A); String(s.size);')).toBe('2');
});

// ---------------------------------------------------------------------------
// Reference types - identity, not value
// ---------------------------------------------------------------------------

test('a reference-typed key is identity, and is held weakly where eligible', () => {
  expect(evaluated('const m = new Map.<object, string>(); m.set({}, "a"); m.set({}, "b"); String(m.size);')).toBe('2');
  expect(evaluated('const k = {}; const m = new Map.<object, string>(); m.set(k, "a"); String(m.get(k));')).toBe('a');
  // A class with a reference field is NOT a value type class, so its instances
  // keep identity - the contrast that makes `value-type-keys.test.mts` about
  // something else.
  expect(evaluated('class R { o: object | null = null; } const s = new Set.<R>(); s.add(new R()); s.add(new R()); String(s.size);')).toBe('2');
  // A function and an array are ordinary reference keys.
  expect(evaluated('const f = () => 1; const s = new Set(); s.add(f); s.add(f); String(s.size);')).toBe('1');
  expect(evaluated('const a = [1]; const m = new Map(); m.set(a, "x"); String(m.get(a)) + "/" + String(m.get([1]));')).toBe('x/undefined');
  // Eligible reference types may be held weakly, which is the property that
  // separates them from every family above.
  expect(ok('const k = {}; new WeakMap().set(k, 1); new WeakSet().add(k); new WeakRef(k);')).toBe(true);
});

// ---------------------------------------------------------------------------
// Composed types
// ---------------------------------------------------------------------------

test('literal-type and union keys', () => {
  expect(evaluated('const m = new Map.<"a" | "b", uint8>(); m.set("a", 1); String(m.get("a"));')).toBe('1');
  expect(ok('let m: Map.<"a" | "b", uint8> = new Map(); m.set("c", 1);')).toBe(false);
  // A union key admits either side and keys each by its own rule.
  expect(evaluated('const m = new Map.<uint8 | string, string>(); m.set(1, "n"); m.set("1", "s"); String(m.size);')).toBe('2');
  // A union VALUE takes either side.
  expect(evaluated('const m = new Map.<string, uint8 | string>(); m.set("a", 1); m.set("b", "x"); String(m.size);')).toBe('2');
});

test('a collection nests inside another collection', () => {
  expect(evaluated('const m = new Map.<string, Set.<uint8>>(); m.set("a", new Set.<uint8>()); String(m.size);')).toBe('1');
  expect(evaluated('const m = new Map.<string, Set.<uint8>>(); const inner = new Set.<uint8>(); inner.add(1); m.set("a", inner); String(m.get("a").size);')).toBe('1');
  // The inner collection keeps its own element type, so a bad store into it is
  // refused through the outer one.
  expect(ok('const m = new Map.<string, Set.<uint8>>(); m.set("a", new Set.<uint8>()); const bad = (300 := any); m.get("a").add(bad);')).toBe(false);
  // A Map of arrays, which is what `Map.groupBy` produces.
  expect(evaluated('const m = new Map.<string, [].<uint8>>(); m.set("a", [1, 2]); String(m.get("a").length);')).toBe('2');
});

test('a tuple and an array as values', () => {
  expect(evaluated('const m = new Map.<string, [uint8, string]>(); m.set("a", [1, "x"]); String(m.get("a")[1]);')).toBe('x');
  expect(ok('let m: Map.<string, [uint8, string]> = new Map(); m.set("a", ["x", 1]);')).toBe(false);
});

test('`any` admits anything, and a collection of `any` is still a collection', () => {
  expect(evaluated('const m = new Map.<any, any>(); m.set(1, "a"); m.set("b", {}); String(m.size);')).toBe('2');
  expect(evaluated('const s = new Set.<any>(); s.add(1); s.add("a"); String(s.size);')).toBe('2');
  // ...and it is the family top, so a specialization reaches it.
  expect(ok('function f(x: Set.<any>) {} let s: Set.<uint8> = new Set(); f(s);')).toBe(true);
});

test('a class instance and an interface-shaped value as keys', () => {
  expect(evaluated('class C { x: uint8; o: object | null = null; } const k = new C(); const m = new Map.<C, string>(); m.set(k, "hit"); String(m.get(k));')).toBe('hit');
  expectStaticTypeError('class C { x: uint8; } class D { x: uint8; } let m: Map.<C, string> = new Map(); m.set(new D(), "x");');
});
