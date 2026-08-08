import { test, expect } from 'vitest';
import { ok, evaluated } from './harness.mts';

/**
 * A spot check of the specification's coverage table against the engine.
 *
 * The table claims a state per design document, and the SIMD work found one row
 * claiming "Specified" for a document with eleven sections of which two were
 * covered. That was found by checking the claim against the clauses rather than
 * by any test failing, so this file checks the remaining rows the same way:
 * one representative construction per extension, chosen from the design's own
 * spelling rather than a plausible one.
 *
 * These are not thorough tests of each extension - each has its own file. They
 * exist so that a row silently ceasing to be true is a failure rather than a
 * discovery, which is what happened with simd.md.
 */

test('the parameterized numeric extensions resolve in an annotation', () => {
  // Written as the design writes them: complex has NAMED widths and rational is
  // applied. Probing complex with `complex.<64>` or rational with `rational64`
  // reports "not defined" and would look like a gap in the coverage row - which
  // is how this check first went wrong.
  expect(ok('function f(x: complex64) {}')).toBe(true);
  expect(ok('function f(x: complex128) {}')).toBe(true);
  expect(ok('function f(x: rational.<64>) {}')).toBe(true);
  expect(ok('const d: decimal64 = decimal64("1.5");')).toBe(true);
});

test('a bare parameterized primitive is not a value, and an applied one is', () => {
  // The convention that makes `vector.preferredLanes` unreachable, which
  // #sec-vector-widths now records as an unsettled spelling. Asserted across the
  // family so a change to it is deliberate.
  expect(evaluated('String(typeof uint);')).toBe('undefined');
  expect(evaluated('String(typeof int);')).toBe('undefined');
  expect(evaluated('String(typeof vector);')).toBe('undefined');
  expect(evaluated('String(typeof complex64);')).toBe('undefined');
  expect(evaluated('String(typeof uint8);')).toBe('object');
  expect(evaluated('String(typeof float32x4);')).toBe('object');
});

test('the extensions this session did not touch still construct', () => {
  expect(ok('class P { @offset(0) x: uint8; }')).toBe(true);
  expect(ok('class V { operator+(o: V): V { return this; } }')).toBe(true);
  expect(ok('function d(t) { return t; } class C { @d m() {} }')).toBe(true);
  expect(ok('const r = match (1) { when 1: "one"; };')).toBe(true);
  expect(evaluated('String(5 |> % + 1);')).toBe('6');
  expect(evaluated('String(typeof uint8.tryParse);')).toBe('function');
});

test('primitive metadata refuses an unclaimed key', () => {
  // A correct refusal rather than a gap: the key has to be claimed by a meta
  // type. Asserted so the refusal is not later read as an unimplemented
  // extension.
  expect(ok('function f(x: float32.<{ unit: "m" }>) {}')).toBe(false);
});

test("this session's own surfaces hold end to end", () => {
  // Higher-kinded parameters, the unified iteration types, and the SIMD lane
  // operations - one construction each, as a guard against a later change
  // quietly undoing one.
  expect(ok('type Identity<T> = T; class B<W<_>> { v: W.<uint8>; } const b: B.<Identity> = new B.<Identity>();')).toBe(true);
  expect(ok('class B<W<_>> {} const b: B.<uint8> = null;')).toBe(false);
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterator.<uint8> = g();')).toBe(true);
  expect(ok('async function* a(): uint8 { yield 1; } const i: AsyncIterator.<uint8> = a();')).toBe(true);
  expect(evaluated('const v = float32x4(1, 2, 3, 4); String(v.wzyx);')).toBe('(4, 3, 2, 1)');
  expect(evaluated('function f(): uint32 { return 1; } function f(): string { return "two"; } const a: string = f(); String(a);')).toBe('two');
});
