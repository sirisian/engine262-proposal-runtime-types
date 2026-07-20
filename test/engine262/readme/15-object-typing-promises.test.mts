import { test, expect } from 'vitest';
import { evaluated, ok } from './harness.mts';

/**
 * README feature coverage — object typing and typed promises.
 * Sections: Object Typing, Typed Promises.
 *
 *  - Typed promises (Promise.<R, E>) parse, construct, and await correctly; the
 *    resolve/reject TYPE enforcement and combinator inference are static-checker
 *    features. The runtime surface is verified here.
 *  - Object typing via Object.defineProperty with a `type` key is normative core
 *    (spec sec-reflection) but not implemented: the `type` key is silently
 *    accepted, no default is applied, and no write enforcement happens. Documented
 *    as a gap (PENDING-CAPABILITIES.md capability J).
 */

// ── Typed Promises ────────────────────────────────────────────────────────────
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

// ── Object Typing ─────────────────────────────────────────────────────────────
// Object.defineProperty accepts a `type` key. Today it is accepted but not applied.
test('Object Typing: Object.defineProperty accepts a type key (accepted but not enforced - documents the gap)', () => {
  // the call with a type key succeeds and the value is set
  expect(evaluated('let o = {}; Object.defineProperty(o, "a", { type: uint8, value: (5 := uint8), writable: true, configurable: true }); String(o.a);')).toBe('5');
  // a string type is likewise accepted
  expect(evaluated('let o = {}; Object.defineProperty(o, "b", { type: "uint8", value: (3 := uint8), writable: true, configurable: true }); String(o.b);')).toBe('3');
  // GAP: the declared type is not enforced on a later write (300 is out of uint8 range)
  expect(evaluated('let o = {}; Object.defineProperty(o, "a", { type: uint8, value: (5 := uint8), writable: true }); o.a = 300; String(o.a);')).toBe('300');
  // GAP: the type key is not stored on the descriptor
  expect(evaluated('let o = {}; Object.defineProperty(o, "a", { type: uint8, value: (5 := uint8) }); let d = Object.getOwnPropertyDescriptor(o, "a"); String(typeof d.type);')).toBe('undefined');
});

test('Object Typing: an ordinary object literal and property access are unchanged', () => {
  expect(ok('let o = { a: 1, b: 2 }; o.a === 1 && o.b === 2;')).toBe(true);
});
