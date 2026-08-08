import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * proposal-runtime-types #sec-metadata-objects: `partial interface`.
 *
 * A metadata object is extended by declaring a partial interface over it, not a
 * partial class. The reason is not stylistic and is recorded in
 * ANALYSIS-metadata-channel.md: the decorators extension has a subclass's
 * metadata inherit PROTOTYPICALLY, falling through for a key it does not set and
 * shadowing without mutating for one it does - and an instance of a class with a
 * typed field is NOT EXTENSIBLE, so it cannot be prototypically linked at all.
 * A class-based metadata object could not obey its own inheritance rule.
 *
 * An interface declares the shape and constructs nothing, so the three reasons
 * the partial CLASS clause gives for its restriction - no subclass, no instance
 * state, no change to a layout - all hold of it. That is why the restriction a
 * class needs, an interface does not.
 */

test('a partial interface contributes members to an existing one', () => {
  expect(evaluated('interface I { a: uint8; } partial interface I { b: string; } let v: I = { a: 1, b: "x" }; "accepted";')).toBe('accepted');
  // THE ASSERTION THAT MATTERS: the added member is REQUIRED afterwards. A merge
  // that parsed and did nothing would pass the line above on its own, which is
  // exactly what the first attempt at this did - the members were merged into a
  // new record that interned as a SECOND type, while every type-position
  // reference kept resolving through the original declaration.
  expectThrown('interface I { a: uint8; } partial interface I { b: string; } let w: I = { a: 1 };');
  // The original member is still required too.
  expectThrown('interface I { a: uint8; } partial interface I { b: string; } let x: I = { b: "s" };');
});

test('several partials each contribute, and a redeclared member is refused', () => {
  expect(evaluated('interface D { a: uint8; } partial interface D { b: string; } partial interface D { c: uint8; } '
    + 'let v: D = { a: 1, b: "x", c: 2 }; "accepted";')).toBe('accepted');
  expectThrown('interface D { a: uint8; } partial interface D { b: string; } partial interface D { c: uint8; } let w: D = { a: 1, b: "x" };');
  // A member already declared is a TypeError rather than an override, so the
  // meaning of an interface does not depend on the order its declarations load.
  expectThrown('interface C { a: uint8; } partial interface C { a: string; }');
});

test('the metadata shape it exists for', () => {
  // #sec-metadata-objects: "a program adds to one by declaring a `partial
  // interface` over it whose members are typed and Symbol-keyed".
  expect(evaluated('const k = Symbol("k"); interface Meta { } partial interface Meta { [k]: string; } "declared";')).toBe('declared');
  // A partial interface binds no name of its own - it extends one someone else
  // bound - so it neither collides nor shadows.
  expect(evaluated('interface N { a: uint8; } partial interface N { b: string; } typeof N;')).toBe('object');
});
