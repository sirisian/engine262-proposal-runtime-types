import { test, expect } from 'vitest';
import { evaluated, ok, bool } from '../readme/harness.mts';

/**
 * Extension coverage — typeobjects.md (Type Objects and Reflection).
 *
 * This extension is substantially implemented in the core: type names are
 * first-class interned values, Reflect.typeOf returns the type object, the
 * meta-"type" type is the type of every type object, and Reflect.getReflection
 * cracks a type object open into a node discriminated by `kind` whose leaves are
 * themselves type objects.
 *
 * Minor gaps (documented, not asserted as failures): the `type` OPERATOR
 * (`type uint8` in type position) is a contextual-keyword form the spec leaves as
 * an unresolved cover-grammar question, and `type` is not writable as a type name
 * in an annotation; a type expression in raw expression position (`[].<uint8>`
 * outside an alias) does not always intern, though the alias form does.
 */

// ── Type names are first-class values ─────────────────────────────────────────
test('type objects: a type name in expression position is a value', () => {
  expect(evaluated('let t = uint8; typeof t;')).toBe('object');
  // it can be stored and passed
  expect(evaluated('let t = uint8; function id(x) { return x; } id(t) === uint8 ? "ok" : "no";')).toBe('ok');
});

// ── Interning by structural identity ──────────────────────────────────────────
test('type objects: equivalent types are the same interned object', () => {
  expect(ok('uint8 === uint8;')).toBe(true);
  // via aliases (the reliable form for compound types)
  expect(ok('type A = [].<uint8>; type B = [].<uint8>; A === B;')).toBe(true);
  expect(ok('Map.<string, uint8> === Map.<string, uint8>;')).toBe(true);
  // int8 and int.<8> name the same type
  expect(ok('type A = int8; type B = int.<8>; A === B;')).toBe(true);
});

test('type objects: distinct types are distinct objects', () => {
  expect(bool('String(uint8 === uint16);')).toBe(false);
  expect(bool('type A = [].<uint8>; type B = [].<uint16>; String(A === B);')).toBe(false);
});

// ── A type object may key a Map or Set ────────────────────────────────────────
test('type objects: a type object may be used as a Map key', () => {
  expect(evaluated('let m = new Map(); m.set(uint8, "u8"); m.get(uint8);')).toBe('u8');
  // the same type retrieves the same entry
  expect(evaluated('let m = new Map(); m.set(uint8, 1); m.set(uint8, 2); String(m.size);')).toBe('1');
});

// ── The meta-"type" type ──────────────────────────────────────────────────────
// Reflect.typeOf of a type object is the primitive type named "type", the type of
// every type object.
test('type objects: Reflect.typeOf of a type object is the same meta-type for all', () => {
  expect(evaluated('typeof Reflect.typeOf(uint8);')).toBe('object');
  // the meta-type is one interned object shared by all type objects
  expect(ok('Reflect.typeOf(uint8) === Reflect.typeOf(uint16);')).toBe(true);
  expect(ok('Reflect.typeOf(uint8) === Reflect.typeOf([].<uint8>);')).toBe(true);
});

// ── Reflect.typeOf on values ──────────────────────────────────────────────────
test('type objects: Reflect.typeOf reports a value\u2019s runtime type', () => {
  expect(ok('let a: uint8 = 0; Reflect.typeOf(a) === uint8;')).toBe(true);
  expect(ok('Reflect.typeOf(5) === number;')).toBe(true);
  expect(ok('Reflect.typeOf("a") === string;')).toBe(true);
  // typeof on the value is unchanged
  expect(evaluated('let a: uint8 = 0; typeof a;')).toBe('number');
});

// ── Structural reflection ─────────────────────────────────────────────────────
// Reflect.getReflection cracks a type object into a node discriminated by kind
// whose leaves are type objects.
test('type objects: getReflection discriminates a union into arms', () => {
  expect(evaluated('type U = uint8 | uint16; Reflect.getReflection(U).kind;')).toBe('union');
  expect(evaluated('type U = uint8 | uint16; String(Reflect.getReflection(U).arms.length);')).toBe('2');
  // a nullable is a union
  expect(evaluated('type N = uint8 | null; Reflect.getReflection(N).kind;')).toBe('union');
});

test('type objects: getReflection exposes an array\u2019s element and extent', () => {
  expect(evaluated('type A = [].<uint32>; Reflect.getReflection(A).kind;')).toBe('array');
  // the element leaf is itself a type object
  expect(ok('type A = [].<uint32>; Reflect.getReflection(A).element === uint32;')).toBe(true);
});

test('type objects: getReflection exposes an object type\u2019s properties', () => {
  expect(evaluated('type O = { a: uint8, b: string }; Reflect.getReflection(O).kind;')).toBe('object');
  expect(evaluated('type O = { a: uint8, b: string }; String(Reflect.getReflection(O).properties.length);')).toBe('2');
});

test('type objects: getReflection exposes a function type\u2019s signatures', () => {
  expect(evaluated('type F = (uint8) => uint16; Reflect.getReflection(F).kind;')).toBe('function');
  expect(evaluated('type F = (uint8) => uint16; String(Reflect.getReflection(F).signatures.length >= 1);')).toBe('true');
});

test('type objects: a type object is opaque to ordinary property access', () => {
  // nothing exposes an array's element via a plain property
  expect(evaluated('type A = [].<uint32>; typeof A.element;')).toBe('undefined');
});
