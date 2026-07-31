import { test, expect } from 'vitest';
import { ok } from '../readme/harness.mts';

/**
 * PLAN-iteration-types-engine.md phases 2 and 4, per #sec-iteration-types.
 *
 * The relations below are DECLARED rather than inspected: a library type is an
 * opaque nominal here, its members held in side tables consulted at the
 * member-access site, so it has no structural form to compare against an
 * interface. The declared-implements table is what makes a generator an
 * iterable iterator, and the entries in that table are exactly the assertions
 * in this file — which is the point of writing them here, since a
 * hand-maintained table of claims is only as true as its tests.
 */

test('the iteration types resolve', () => {
  expect(ok('function f(x: Iterator.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: Iterable.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: IterableIterator.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: AsyncIterator.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: AsyncIterable.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: AsyncIterableIterator.<uint8>) {}')).toBe(true);
});

test('a hand-written object satisfies Iterator', () => {
  // The reason the protocols are interfaces rather than the class: `for`-`of`
  // asks whether the members are there, never what the value declared.
  expect(ok('const i: Iterator.<uint8> = { next: () => ({ value: 1, done: false }) };')).toBe(true);
});

test('the shorthand interns', () => {
  // Not merely assignable — the same interned type. A shorthand producing an
  // equal-but-distinct record would pass an assignability check and fail this.
  expect(ok('const a: boolean = Iterator.<uint8> === Iterator.<uint8, void, void>;')).toBe(true);
});

test('a generator IS an iterator', () => {
  // The relation both documents state and the engine did not hold until the
  // declared-implements table existed.
  const g = 'function* g(): uint8 { yield 1; } ';
  expect(ok(`${g}const i: Iterable.<uint8> = g();`)).toBe(true);
  expect(ok(`${g}const i: Iterator.<uint8> = g();`)).toBe(true);
  expect(ok(`${g}const i: IterableIterator.<uint8> = g();`)).toBe(true);
});

test('an async generator IS an async iterator', () => {
  const ag = 'async function* ag(): uint8 { yield 1; } ';
  expect(ok(`${ag}const i: AsyncIterable.<uint8> = ag();`)).toBe(true);
  expect(ok(`${ag}const i: AsyncIterableIterator.<uint8> = ag();`)).toBe(true);
});

test('the element type still has to match', () => {
  // What keeps the four above from passing vacuously: if the relation were
  // unconditional, this would pass too.
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterable.<string> = g();')).toBe(false);
});

test('no per-collection iteration types', () => {
  // TypeScript has ArrayIterator, MapIterator, SetIterator to carry a narrower
  // return type; the shorthand carries it here, so the family stays at six.
  expect(ok('const t = ArrayIterator.<uint8>;')).toBe(false);
  expect(ok('const t = MapIterator.<uint8>;')).toBe(false);
});
