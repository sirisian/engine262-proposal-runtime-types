import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Question AL, AL2: an instance of a class with a typed field is sealed as `Object.seal` seals it.
 *
 * The README says a typed instance is sealed "As if Object.seal was called on it". The engine made
 * it non-extensible and left its fields configurable, so `Object.isSealed` answered *false*, and
 * `Object.defineProperty(v, "x", { enumerable: false })` succeeded: one instance of a fixed layout
 * then showed `Object.keys` and `JSON.stringify` something its class does not. Sealed, each field is
 * non-configurable, and the language's own invariants refuse the change. A field stays writable.
 */

const V = 'class V { x: uint8 = 0; y: uint8 = 0; }';
const sealed = (expression: string) => `String(Object.isSealed(${expression})) + String(Object.isExtensible(${expression})) + String(Object.isFrozen(${expression}))`;

test('a constructed instance is sealed and its fields are writable', () => {
  expect(evaluated(`${V} const v = new V(); ${sealed('v')};`)).toBe('truefalsefalse');
  expect(evaluated(`${V} const d = Object.getOwnPropertyDescriptor(new V(), "x"); String(d.writable) + String(d.enumerable) + String(d.configurable);`))
    .toBe('truetruefalse');
  expect(evaluated(`${V} const v = new V(); v.x = 7; Object.defineProperty(v, "y", { value: 9 }); String(v.x) + String(v.y);`)).toBe('79');
  expect(evaluated(`${V} const v = new V(); Object.freeze(v); String(Object.isFrozen(v));`)).toBe('true');
});

test('every way of making an instance seals it', () => {
  // A constructor of its own, a subclass that adds fields, and an untyped subclass that adds a
  // property in its constructor: the seal comes at the end, once.
  expect(evaluated(`class C { x: uint8; constructor(a: uint8) { this.x = a; } } const c = new C(3); ${sealed('c')};`)).toBe('truefalsefalse');
  expect(evaluated('class B { x: uint8 = 0; } class D extends B { y: uint8 = 1; } const d = new D(); String(Object.isSealed(d)) + Object.keys(d).join();'))
    .toBe('truex,y');
  expect(evaluated('class B { x: uint8 = 0; } class D extends B { constructor() { super(); this.z = 5; } } const d: any = new D(); String(Object.isSealed(d)) + Object.keys(d).join();'))
    .toBe('truex,z');
  // A literal fill and the call that converts.
  expect(evaluated(`${V} const v = { x: 1 } := V; ${sealed('v')};`)).toBe('truefalsefalse');
  expect(evaluated(`${V} const v = V({ x: 1 }); ${sealed('v')};`)).toBe('truefalsefalse');
  // A default, an element of an array of a value class, and a copy.
  expect(evaluated('value class P { x: uint8 = 0; } let p: P; String(Object.isSealed(p));')).toBe('true');
  expect(evaluated('value class P { x: uint8 = 0; } const a = new [2].<P>(); String(Object.isSealed(a[0]));')).toBe('true');
  expect(evaluated('value class P { x: uint8 = 0; } const a = new P(); const b = a; String(Object.isSealed(b));')).toBe('true');
  expect(evaluated('value class P { x: uint8 = 0; y: uint8 = 0; } const s = new SoA.<P>(2); String(Object.isSealed(s[0]));')).toBe('true');
});

test('a field cannot be redefined or deleted', () => {
  expectThrown(`${V} const v = new V(); Object.defineProperty(v, "x", { enumerable: false });`, 'Cannot define property');
  expect(evaluated(`${V} const v = new V(); String(Reflect.defineProperty(v, "x", { enumerable: false })) + Object.keys(v).join();`)).toBe('falsex,y');
  expectThrown(`${V} const v: any = new V(); delete v.x;`, 'cannot be deleted');
  expectThrown(`"use strict"; ${V} const v: any = new V(); delete v.x;`, 'cannot be deleted');
});

test('a class that does not seal its instances leaves them as JavaScript does', () => {
  expect(evaluated(`dynamic class Q { x: uint8 = 0; } const q = new Q(); ${sealed('q')};`)).toBe('falsetruefalse');
  expect(evaluated(`class U { x = 0; } const u = new U(); ${sealed('u')};`)).toBe('falsetruefalse');
});
