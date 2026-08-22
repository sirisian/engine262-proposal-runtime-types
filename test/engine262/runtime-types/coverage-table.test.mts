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
  // Every probe sits in a text that ADMITS TYPE NAMES: `#sec-type-names` excepts
  // `typeof` from admitting, so without the annotation each line answers
  // 'undefined' and the test would pass while measuring nothing.
  //
  // The convention that makes `vector.preferredLanes` unreachable, which
  // #sec-vector-widths now records as an unsettled spelling. Asserted across the
  // family so a change to it is deliberate.
  expect(evaluated('type _ = uint8; String(typeof uint);')).toBe('undefined');
  expect(evaluated('type _ = uint8; String(typeof int);')).toBe('undefined');
  expect(evaluated('type _ = uint8; String(typeof vector);')).toBe('undefined');
  // An APPLIED name is a value, and a width shorthand is an application:
  // `uint8` is `uint.<8>` and `complex64` is `complex.<float32>`, so it belongs
  // in this group rather than beside the bare names above. It read as undefined
  // only while the name did not exist at all.
  expect(evaluated('type _ = uint8; String(typeof uint8);')).toBe('object');
  expect(evaluated('type _ = uint8; String(typeof float32x4);')).toBe('object');
  expect(evaluated('type _ = uint8; String(typeof complex64);')).toBe('object');
  // Bare `complex` is the exception among the parameterized primitives, and
  // #sec-complex-numbers is why: it has a DEFAULT argument - "the bare name
  // `complex` is `complex.<number>`" - so the bare name is already an
  // application. The binding is the pair constructor the clause writes its own
  // example with, `complex(0, 4)`.
  expect(evaluated('type _ = uint8; String(typeof complex);')).toBe('function');
  expect(evaluated('String((type complex) === (type complex.<number>));')).toBe('true');
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
