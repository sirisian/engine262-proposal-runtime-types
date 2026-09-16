import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A METHOD IS AN OWN PROPERTY, for freshness.
 *
 * #sec-literal-freshness: "an own property the expected type neither declares
 * nor admits through an index signature is a type error, reported against the
 * property." A method shorthand is an own property, and the method branch of the
 * literal check compared signatures without ever applying freshness - so one
 * literal against one type answered two ways by how a member was spelled.
 */

test('an excess member is refused however it is spelled', () => {
  expectThrown('type T = { a?: uint8 }; let x: T = { zz: 1 };', '"zz" is not declared');
  expectThrown('type T = { a?: uint8 }; let x: T = { zz(q) { return 1; } };', '"zz" is not declared');
  // Together in one literal, so neither spelling can hide behind the other.
  expectThrown('type T = { a?: uint8 }; let x: T = { zz: 1, mm(q) { return 1; } };', 'is not declared');
});

test('a declared member is admitted, in either spelling', () => {
  expect(evaluated('type T = { a?: (x: uint8) => uint8 }; let x: T = { a(q) { return q; } }; `${typeof x}`;')).toBe('object');
  expect(evaluated('type T = { a?: uint8 }; let x: T = { a: (1 := uint8) }; `${typeof x}`;')).toBe('object');
  // An all-optional target admits a literal supplying nothing at all, which is
  // what freshness must not break.
  expect(evaluated('type T = { a?: uint8 }; let x: T = {}; `${typeof x}`;')).toBe('object');
});

test('the generator and async spellings are own properties too', () => {
  // The branch covers four node types; a fix that read only `MethodDefinition`
  // would leave three ways to write the same mistake.
  expectThrown('type T = { a?: uint8 }; let x: T = { *zz() { yield 1; } };', 'is not declared');
  expectThrown('type T = { a?: uint8 }; let x: T = { async zz() { return 1; } };', 'is not declared');
});
