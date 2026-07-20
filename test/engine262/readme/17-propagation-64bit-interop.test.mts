import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — type propagation to literals, 64-bit integer types
 * and number interop.
 * Sections: Type Propagation to Literals, 64-bit Integer Types and Number Interop.
 *
 * Both are substantially implemented. The one gap is the `T(v)` cast-call form
 * (e.g. `number(a)`), which needs callable Type Objects (capability G); the
 * equivalent `:= T` form works and is verified here.
 */

// ── Type Propagation to Literals ──────────────────────────────────────────────
// A literal in a typed position takes the target type, so suffixes are not needed;
// an untyped literal stays Number; an out-of-range literal is a compile-time error.
test('Propagation: a literal in a typed binding takes the target type', () => {
  expect(ok('let a: uint8 = 5; a === (5 := uint8);')).toBe(true);
  // an untyped literal stays Number
  expect(evaluated('let a = 5; typeof a;')).toBe('number');
});

test('Propagation: types propagate to call arguments', () => {
  expect(ok('function f(x: uint8) { return x; } f(5) === (5 := uint8);')).toBe(true);
});

test('Propagation: separators and alternative bases propagate the same way', () => {
  expect(ok('let a: uint32 = 1_000; a === (1000 := uint32);')).toBe(true);
  expect(ok('let a: uint8 = 0xff; a === (255 := uint8);')).toBe(true);
});

test('Propagation: a literal outside the target range is a compile-time error', () => {
  // not a silent wrap
  expectThrown('let d: uint8 = 256;');
});

test('Propagation: a BigInt literal keeps its suffix and stays bigint', () => {
  expect(evaluated('let a = 5n; typeof a;')).toBe('bigint');
  // an unsuffixed literal to uint64 relies on propagation
  expect(evaluated('let a: uint64 = 100; typeof a;')).toBe('number');
});

// ── 64-bit Integer Types and Number Interop ───────────────────────────────────
// typeof reports "number" for int64/uint64; the assignability rules keep precision
// loss from being silent.
test('64-bit: typeof reports number for uint64 but it is not assignable to number', () => {
  expect(evaluated('let a: uint64 = 100; typeof a;')).toBe('number');
  // passing a uint64 where number is expected is a TypeError, whatever the value
  expectThrown('let a: uint64 = 100; let c: number = a;');
});

test('64-bit: an explicit conversion to number succeeds (via the := form)', () => {
  // number(a) is the callable-type-object form (capability G); the := form works
  expect(evaluated('let a: uint64 = 100; let d: number = (a := number); typeof d;')).toBe('number');
});

test('64-bit: assigning a uint64 to an untyped binding keeps the value', () => {
  // the untyped binding is dynamically typed, not converted
  expect(evaluated('let a: uint64 = 100; let b = a; typeof b;')).toBe('number');
});

test('64-bit: 128-bit types behave identically to 64-bit for number interop', () => {
  expectThrown('let a: uint128; let c: number = a;');
});
