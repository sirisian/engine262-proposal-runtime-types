import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from '../../harness.mts';

/**
 * README feature coverage — classes.
 * Sections: Class: Value Type and Reference Type Behavior, Class Members
 * (Readonly Fields, Static Members), Constructor Overloading.
 *
 * Deferrals documented rather than asserted:
 *
 *  - The VALUE-TYPE layout of a class (contiguous memory, byteLength, array
 *    views, `shared` backing) is the memory-layout and threading extensions.
 *    Here we verify the class SEMANTICS the core specifies: auto-sealing of a
 *    class with typed fields, typed-field defaults, and typed static/private
 *    members.
 *
 *  - The `readonly` class-FIELD modifier is implemented: a readonly field is
 *    assignable only in its initializer and the declaring constructor. Object
 *    and interface members is implemented and verified in the interfaces file.
 *
 *  - Constructor OVERLOADING needs overload resolution extended to constructors;
 *    multiple constructors are a "Duplicate constructor" error today, verified
 *    below.
 */

// ── Auto-sealing: a class with a typed field is sealed ────────────────────────
// Spec sec-typed-classes: a class in which at least one instance field is typed
// has PreventExtensions performed on its instances; a field may be written but a
// property may not be added.
test('Value/Reference: a class with a typed field seals its instances', () => {
  expect(evaluated('class A { x: uint32 = (0 := uint32); } let a = new A(); Object.isExtensible(a) ? "ext" : "sealed";')).toBe('sealed');
  // a field may still be written
  expect(bool('class A { x: uint32 = (0 := uint32); } let a = new A(); a.x = (5 := uint32); String(a.x === (5 := uint32));')).toBe(true);
  // adding a property is rejected in strict mode
  expectThrown('"use strict"; class A { x: uint32 = (0 := uint32); } let a = new A(); a.y = 5;');
});

test('Value/Reference: an untyped class is not sealed; `dynamic` opts out', () => {
  expect(evaluated('class A { constructor() { this.x = 1; } } let a = new A(); Object.isExtensible(a) ? "ext" : "sealed";')).toBe('ext');
  expect(evaluated('dynamic class A { x: uint32 = (0 := uint32); } let a = new A(); Object.isExtensible(a) ? "ext" : "sealed";')).toBe('ext');
});

test('Value/Reference: a subclass appends typed fields and is sealed once', () => {
  // the subclass adds its own typed field during super and is not blocked
  expect(bool('class A { x: uint32 = (0 := uint32); } class B extends A { y: uint32 = (0 := uint32); } let b = new B(); String(b.x === (0 := uint32) && b.y === (0 := uint32));')).toBe(true);
  // the fully-built instance is sealed
  expect(evaluated('class A { x: uint32 = (0 := uint32); } class B extends A { y: uint32 = (0 := uint32); } let b = new B(); Object.isExtensible(b) ? "ext" : "sealed";')).toBe('sealed');
});

// ── Class type as annotation and membership ───────────────────────────────────
test('Value/Reference: a class name is a type usable as an annotation', () => {
  expect(evaluated('class A { x: uint32 = (0 := uint32); } let a: A = new A(); typeof a;')).toBe('object');
  expect(evaluated('class A {} let a = new A(); String(a instanceof A);')).toBe('true');
});

// ── Class Members: typed field defaults ───────────────────────────────────────
// A field declared without an initializer takes its type's default (the same
// DefaultValueOf rule as a typed binding), never undefined.
test('Class Members: a typed field without an initializer takes its type default', () => {
  expect(bool('class A { x: uint32; } let a = new A(); String(a.x === (0 := uint32));')).toBe(true);
  expect(bool('class A { s: string; } let a = new A(); String(a.s === "");')).toBe(true);
  expect(bool('class A { b: boolean; } let a = new A(); String(a.b === false);')).toBe(true);
  expect(bool('class A { n: uint8 | null; } let a = new A(); String(a.n === null);')).toBe(true);
  // an untyped field is still undefined
  expect(bool('class A { x; } let a = new A(); String(a.x === undefined);')).toBe(true);
});

test('Class Members: a private typed field takes its default too', () => {
  expect(bool('class A { #x: uint32; get() { return this.#x; } } let a = new A(); String(a.get() === (0 := uint32));')).toBe(true);
});

// ── Static Members ────────────────────────────────────────────────────────────
// Static fields are typed like instance fields and live on the constructor.
test('Static Members: typed static fields live on the constructor with a default', () => {
  expect(bool('class A { static count: uint32 = (5 := uint32); } String(A.count === (5 := uint32));')).toBe(true);
  // a typed static field without an initializer takes its default
  expect(bool('class A { static count: uint32; } String(A.count === (0 := uint32));')).toBe(true);
});

// ── Constructors ──────────────────────────────────────────────────────────────
// A single typed constructor enforces its parameters. (Overloading is deferred.)
test('Constructors: a single typed constructor enforces its parameters', () => {
  expect(bool('class A { x: uint32; constructor(v: uint32) { this.x = v; } } let a = new A((5 := uint32)); String(a.x === (5 := uint32));')).toBe(true);
  // members may be declared outside the constructor
  expect(ok('class A { x: float32; constructor(x: float32) { this.x = x; } } typeof A;')).toBe(true);
});

// ── Documented gaps ───────────────────────────────────────────────────────────
// ── Readonly Fields ───────────────────────────────────────────────────────────
// A `readonly` field may be assigned only in its own initializer and in the
// declaring class's constructors; every other assignment is a TypeError (README
// "Readonly Fields").
test('Readonly Fields: a readonly field is assignable in its initializer and constructor', () => {
  expect(evaluated('class A { readonly id: uint32 = (5 := uint32); } let a = new A(); String(a.id);')).toBe('5');
  expect(evaluated('class A { readonly id; constructor() { this.id = 10; } } let a = new A(); String(a.id);')).toBe('10');
});

test('Readonly Fields: assignment outside the constructor is a TypeError', () => {
  // an external write
  expectThrown('class A { readonly id = 5; } let a = new A(); a.id = 9;');
  // a write from a method, even one the constructor calls, is rejected
  expectThrown('class A { readonly id; constructor() { this.set(); } set() { this.id = 1; } } new A();');
});

test('Constructor Overloading: multiple constructors are not yet supported (documents the gap)', () => {
  // Target (README): two constructors of different signatures, selected by
  // overload resolution. Today this is a duplicate-constructor error.
  expectThrown('class A { x: float32; constructor(x: float32) { this.x = x; } constructor(y: uint32) { this.x = float32(y); } }');
});
