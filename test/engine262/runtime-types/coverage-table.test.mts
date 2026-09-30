import { test, expect } from 'vitest';
import { ok, evaluated } from './harness.mts';

/**
 * A spot check of the specification's coverage table (#sec-coverage-of-the-design-documents) against the engine.
 *
 * The table claims a state per design document. A row claiming "Specified" for a document whose sections are only
 * partly covered is found by checking the claim against the clauses, not by any test failing, so this file checks
 * the rows the same way: one representative construction per extension, chosen from the spelling the
 * specification and its examples use rather than a plausible one.
 *
 * These are not thorough tests of each extension - each has its own file. They exist so that a row silently
 * ceasing to be true is a failure rather than a discovery.
 */

test('the parameterized numeric extensions resolve in an annotation', () => {
  // Complex component aliases and explicit rational widths are concrete types.
  expect(ok('function f(x: complex64) {}')).toBe(true);
  expect(ok('function f(x: complex128) {}')).toBe(true);
  expect(ok('function f(x: rational.<64>) {}')).toBe(true);
  expect(ok('const d: decimal64 = decimal64.parse("1.5");')).toBe(true);
});

test('a bare parameterized primitive is not a value, and an applied one is', () => {
  // Every probe sits in a text that ADMITS TYPE NAMES: `#sec-type-names` excepts `typeof`
  // from admitting, so without the annotation each line answers 'undefined' and the test
  // would pass while measuring nothing.
  //
  // A bare parameterized primitive is not a value, which is the convention that makes
  // `vector.preferredLanes` unreachable and that #sec-vector-widths records as an unsettled
  // spelling. It is asserted across the family so that a change to it is deliberate.
  expect(evaluated('type _ = uint8; String(typeof uint);')).toBe('undefined');
  expect(evaluated('type _ = uint8; String(typeof int);')).toBe('undefined');
  expect(evaluated('type _ = uint8; String(typeof vector);')).toBe('undefined');
  // An APPLIED name is a value, and a width shorthand is an application: `uint8` is
  // `uint.<8>` and `complex64` is `complex.<float32>`, so it belongs in this group rather
  // than beside the bare names above.
  expect(evaluated('type _ = uint8; String(typeof uint8);')).toBe('object');
  expect(evaluated('type _ = uint8; String(typeof float32x4);')).toBe('object');
  expect(evaluated('type _ = uint8; String(typeof complex64);')).toBe('object');
  // Bare `complex` is the exception among the parameterized primitives, and
  // #sec-complex-numbers is why: it has a DEFAULT argument - "the bare name
  // `complex` is `complex.<number>`" - so the bare name is already an
  // application, and #sec-type-names' shorthand table lists it, beside
  // `rational` for `rational.<64>`. So each is a value as `uint8` is: its Type
  // Object, whose call still constructs from two parts, `complex(0, 4)`.
  expect(evaluated('type _ = uint8; String(typeof complex);')).toBe('object');
  expect(evaluated('type _ = uint8; String(typeof rational64);')).toBe('object');
  expect(evaluated('String((type rational64) === (type rational.<64>));')).toBe('true');
  expect(evaluated('String((type complex) === (type complex.<number>));')).toBe('true');
});

test('a representative construction of each remaining extension resolves', () => {
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

test('higher-kinded parameters, the iteration types, SIMD lanes and return-type overloading hold end to end', () => {
  // Higher-kinded parameters, the unified iteration types, the SIMD lane operations and
  // overloading on return type - one construction each, as a guard against a later change
  // quietly undoing one.
  expect(ok('type Identity<T: type> = T; class B<W<_>: type> { v: W.<uint8>; } const b: B.<Identity> = new B.<Identity>();')).toBe(true);
  expect(ok('class B<W<_>: type> {} const b: B.<uint8> = null;')).toBe(false);
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterator.<uint8> = g();')).toBe(true);
  expect(ok('async function* a(): uint8 { yield 1; } const i: AsyncIterator.<uint8> = a();')).toBe(true);
  expect(evaluated('const v = float32x4(1, 2, 3, 4); String(v.wzyx);')).toBe('(4, 3, 2, 1)');
  expect(evaluated('function f(): uint32 { return 1; } function f(): string { return "two"; } const a: string = f(); String(a);')).toBe('two');
});
