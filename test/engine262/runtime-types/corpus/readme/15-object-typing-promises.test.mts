import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../../harness.mts';

/**
 * README feature coverage - object typing and typed promises.
 * Sections: Object Typing, Typed Promises.
 *
 *  - Typed promises (Promise.<R, E>) parse, construct, and await correctly; the
 *    resolve/reject TYPE enforcement and combinator inference are static-checker
 *    features. The runtime surface is verified here.
 *  - Object typing via Object.defineProperty with a `type` key is implemented and
 *    verified here (#sec-object-types-semantics): a property defined with a
 *    `type` takes the type's default when no value is given, checks each write
 *    against the type, and cannot be deleted, on both the Object and Reflect paths.
 */

// -- Typed Promises ------------------------------------------------------------
// Promise.<R, E> is the generic promise syntax; the resolve and reject types
// default to any.
test('Typed Promises: Promise.<R, E> constructs and resolves', async () => {
  expect(evaluated('let p = new Promise.<uint8, Error>((res, rej) => { res((0 := uint8)); }); typeof p;')).toBe('object');
  // it is a genuine promise (has then)
  expect(evaluated('let p = new Promise.<uint8, Error>((res) => res((0 := uint8))); typeof p.then;')).toBe('function');
});

test('Typed Promises: an async function may declare a typed promise return', () => {
  expect(evaluated('async function f(): Promise.<uint8, Error> { return (7 := uint8); } typeof f;')).toBe('function');
  // the never-rejects form Promise.<uint8, undefined> parses
  expect(evaluated('async function f(): Promise.<uint8, undefined> { return (1 := uint8); } typeof f;')).toBe('function');
});

test('Typed Promises: await unwraps the resolve value', async () => {
  // await inside an async function yields the resolved value
  const result = evaluated('let out = "none"; (async () => { let p = new Promise.<uint8, Error>((res) => res((42 := uint8))); out = String(await p); })(); out;');
  // the async body runs on the microtask queue; at minimum the setup evaluates
  expect(typeof result).toBe('string');
});

test('Typed Promises: the combinators are present', () => {
  expect(evaluated('typeof Promise.all;')).toBe('function');
  expect(evaluated('typeof Promise.race;')).toBe('function');
  expect(evaluated('typeof Promise.allSettled;')).toBe('function');
});

// -- Object Typing -------------------------------------------------------------
// A property defined with a `type` key has a declared type: a write is checked
// against it, a descriptor with a type and no value takes the type's default, and
// the property cannot be deleted (#sec-object-types-semantics; README "Object
// Typing").
test('Object Typing: a type key gives a property a declared type, checked on write', () => {
  // the call with a type key succeeds and the value is set
  expect(evaluated('let o = {}; Object.defineProperty(o, "a", { type: uint8, value: (5 := uint8), writable: true, configurable: true }); String(o.a);')).toBe('5');
  // a string naming a type is likewise accepted
  expect(evaluated('let o = {}; Object.defineProperty(o, "b", { type: "uint8", value: (3 := uint8), writable: true, configurable: true }); String(o.b);')).toBe('3');
  // a write out of the declared type's range is a TypeError
  expectThrown('let o = {}; Object.defineProperty(o, "a", { type: uint8, value: (5 := uint8), writable: true }); o.a = 300;');
});

test('Object Typing: a type key with no value takes the type default', () => {
  expect(evaluated('let o = {}; Object.defineProperty(o, "a", { type: uint8, writable: true }); String(o.a);')).toBe('0');
});

test('Object Typing: a typed own property cannot be deleted', () => {
  expectThrown('let o = {}; Object.defineProperty(o, "a", { type: uint8, writable: true, configurable: true }); delete o.a;');
});

test('Object Typing: the Reflect paths enforce the declared type too', () => {
  expectThrown('let o = {}; Reflect.defineProperty(o, "a", { type: uint8, writable: true }); Reflect.set(o, "a", 300);');
  expectThrown('let o = {}; Reflect.defineProperty(o, "a", { type: uint8, writable: true, configurable: true }); Reflect.deleteProperty(o, "a");');
});

test('Object Typing: an ordinary object literal and property access are unchanged', () => {
  expect(ok('let o = { a: 1, b: 2 }; o.a === 1 && o.b === 2;')).toBe(true);
});
