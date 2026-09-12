import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * A symbol has a Static Type, and a symbol key is not an index.
 *
 * `Symbol.for` answered `symbol` all along, but `Symbol(...)` and the
 * well-known symbols answered nothing. That absence reached further than it
 * looks: every element-read rule decides a NUMERIC key - a literal index
 * against an extent, a tuple position, a computed index at the index type - and
 * the array arm ends by returning [[Element]] for whatever key it was given. So
 * `a[Symbol.iterator]` on a `[].<uint8>` read as a `uint8`, claiming an element
 * where a method stands, and the callability rule had to be scoped away from
 * computed receivers to avoid refusing `a[Symbol.iterator]()`.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a symbol has a static type', () => {
  expectThrown(dead('let s: string = Symbol.iterator;'), 'symbol');
  expectThrown(dead('let s: string = Symbol("k");'), 'symbol');
  expectThrown(dead('let s: string = Symbol.for("k");'), 'symbol');
  expectThrown(dead('let n: uint8 = Symbol.asyncIterator;'), 'symbol');
  // `Symbol.keyFor` answers a string, not a symbol.
  expectThrown(dead('let n: uint8 = Symbol.keyFor(Symbol.for("k"));'), 'string');
});

test('a symbol key does not read as an element', () => {
  // The method is reachable, and is not the array's element type.
  expect(ok(dead('let a: [].<uint8> = []; let q = a[Symbol.iterator]();'))).toBe(true);
  expect(ok(dead('let a: [].<uint8> = []; let f = a[Symbol.iterator];'))).toBe(true);
  expect(ok(dead('let a: [].<uint8> = []; let s: string = a[Symbol.iterator];'))).toBe(true);
  expect(ok(dead('let t: [uint8, string] = [uint8(1), "s"]; let q = t[Symbol.iterator]();'))).toBe(true);
  // A user symbol reads the same way.
  expect(ok(dead('const K = Symbol("k"); let a: [].<uint8> = []; let q = a[K];'))).toBe(true);
});

test('a NUMERIC key still reads as an element', () => {
  // Calling an element is refused on the element's own type - the case the
  // callability rule was exempted from while symbol keys read as indices.
  expectThrown(dead('let a: [].<uint8> = []; let q = a[0]();'), 'is not callable');
  expectThrown(dead('let a: [].<uint8> = []; let s: string = a[0];'), 'not assignable');
  expectThrown(dead('let a: [4].<uint8> = [uint8(1), uint8(2), uint8(3), uint8(4)]; let q = a[9];'),
    'is not an index of');
  expectThrown(dead('let t: [uint8, string] = [uint8(1), "s"]; let q: uint8 = t[1];'), 'not assignable');
  expectThrown(dead('let t: [uint8, string] = [uint8(1), "s"]; let q = t[5];'), 'is not an index of');
  // A computed index of the index type reads the element, as before.
  expect(ok(dead('let a: [].<uint8> = []; let i: uint64 = uint64(0); let q: uint8 = a[i];'))).toBe(true);
  // A string key on an index-signature type is not affected.
  expect(ok(dead('let o: { [k: string]: uint8 } = {}; let q: uint8 = o["k"];'))).toBe(true);
});
