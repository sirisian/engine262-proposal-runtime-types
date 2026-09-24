import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-conversions, #table-numeric-conversions.
 *
 * An explicit conversion "is an instruction to discard information ... and does
 * not fail merely because information is lost", and `bigint(v)` and
 * `v := bigint` are "the same operation". So a finite value with a fraction
 * truncates toward zero, as into every other integer target.
 *
 * NaN and the infinities are refused. A fixed-width target gives them 0 because
 * its conversion is total - a reduction modulo 2**M sends every input somewhere.
 * `bigint` has no width to reduce modulo and no maximum to saturate to, so any
 * integer chosen would be arbitrary. Rust's `num-bigint` and Python's `int`
 * refuse them for the same reason.
 *
 * JavaScript's own `BigInt(x)` is a separate operation and is unchanged: it
 * refuses a fraction too.
 */

const both = (v: string) => [`String(${v} := bigint);`, `String(bigint(${v}));`];

test('a finite fraction truncates toward zero, through both spellings', () => {
  for (const [v, want] of [['5.5', '5'], ['-5.5', '-5'], ['-0', '0'], ['5', '5'], ['1e21', '1000000000000000000000']]) {
    for (const src of both(v)) expect(evaluated(src)).toBe(want);
  }
});

test('every numeric source truncates alike', () => {
  // These threw: the conversion sent every non-Number source to the CHECKED
  // conversion, which refuses a lost fraction by design.
  expect(evaluated('String((5.5 := float32) := bigint);')).toBe('5');
  expect(evaluated('String((-5.5 := float64) := bigint);')).toBe('-5');
  expect(evaluated('String((5.5 := float16) := bigint);')).toBe('5');
  expect(evaluated('String((5.5 := rational) := bigint);')).toBe('5');
  expect(evaluated('String((-5.5 := rational) := bigint);')).toBe('-5');
  // Integer sources are exact - including a wide one above 2**53, which a read
  // through a Number would round.
  expect(evaluated('String((5 := uint8) := bigint);')).toBe('5');
  expect(evaluated('String((5 := int64) := bigint);')).toBe('5');
  expect(evaluated('String((9007199254740993n := int64) := bigint);')).toBe('9007199254740993');
  expect(evaluated('String((5 := rational) := bigint);')).toBe('5');
});

test('NaN and the infinities are a RangeError, from every source', () => {
  // A Number NaN crashed the host: `Math.trunc(NaN)` is NaN, and the host's own
  // `BigInt(NaN)` threw from outside the engine.
  for (const v of ['NaN', 'Infinity', '-Infinity']) {
    for (const src of both(v)) expectThrownKind(src, 'RangeError');
  }
  expectThrownKind('(NaN := float32) := bigint;', 'RangeError');
  expectThrownKind('(Infinity := float64) := bigint;', 'RangeError');
  expectThrownKind('(-Infinity := float16) := bigint;', 'RangeError');
});

test('fixed-width targets keep the ToInt32 shape', () => {
  // Total: truncate, wrap modulo the width, non-finite to 0 - unchanged.
  expect(evaluated('String(5.5 := int64);')).toBe('5');
  expect(evaluated('String(NaN := int64);')).toBe('0');
  expect(evaluated('String(NaN := uint64);')).toBe('0');
  expect(evaluated('String(Infinity := int32);')).toBe('0');
  expect(evaluated('String(-Infinity := int64);')).toBe('0');
  expect(evaluated('String(1e30 := int64);')).toBe('5076964154930102272');
  expect(evaluated('String(300 := uint8);')).toBe('44');
});

test('BigInt(...) and the boundary are unchanged', () => {
  expectThrownKind('BigInt(5.5);', 'RangeError');
  expect(evaluated('String(BigInt(5));')).toBe('5');
  // The boundary is the CHECKED conversion, and refuses both.
  expectThrownKind('let v: any = 5.5; let b: bigint = v;', 'RangeError');
  expectThrownKind('let v: any = NaN; let b: bigint = v;', 'RangeError');
  // A non-numeric source keeps its path.
  expectThrownKind("'5' := bigint;", 'TypeError');
});
