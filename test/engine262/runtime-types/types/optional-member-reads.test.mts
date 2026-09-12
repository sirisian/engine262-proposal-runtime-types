import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-object-types. "Reading a property that a declaration marked
 * OPTIONAL yields the union of its type with `undefined`, which is what reading
 * an absent property gives."
 *
 * The read answered the declared type alone, so `{ a?: string }` and
 * `{ a: string | undefined }` disagreed about the same read - the second
 * refused `let s: string = x.a` and the first accepted it, though the marker is
 * exactly what says the value may not be there. The two are not the same TYPE,
 * and need not be; they are the same READ.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('reading an optional member yields the union with undefined', () => {
  expectThrown(dead('type A = { a?: string }; let x: A = {}; let s: string = x.a;'),
    'not assignable');
  expectThrown(dead('type A = { a?: uint8 }; let x: A = {}; let n: uint8 = x.a;'),
    'not assignable');
  // Through an interface, which declares its members the same way.
  expectThrown(dead('interface I { a?: string } function f(i: I) { let s: string = i.a; }'),
    'not assignable');
  // The explicit union has always answered this way; the two now agree.
  expectThrown(dead('type B = { a: string | undefined }; let x: B = { a: undefined };'
    + ' let s: string = x.a;'), 'not assignable');
});

test('what the read still admits', () => {
  // The union itself, which is what the read now yields.
  expect(ok(dead('type A = { a?: string }; let x: A = {}; let s: string | undefined = x.a;'))).toBe(true);
  // A REQUIRED member is unaffected.
  expect(ok(dead('type A = { a: string }; let x: A = { a: "s" }; let s: string = x.a;'))).toBe(true);
  expect(ok(dead('interface I { a: uint8 } function f(i: I) { let n: uint8 = i.a; }'))).toBe(true);
  // Writing one is a separate question and is not touched by the read rule.
  expect(ok(dead('type A = { a?: string }; let x: A = {}; x.a = "s";'))).toBe(true);
  // An optional member may still be omitted at a check site.
  expect(ok(dead('type A = { a?: string }; let x: A = {};'))).toBe(true);
  expect(ok(dead('type A = { a?: string }; let x: A = { a: "s" };'))).toBe(true);
});
