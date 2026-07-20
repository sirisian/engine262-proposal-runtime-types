import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — parseFloat and parseInt for each new type.
 * Section: parseFloat and parseInt For Each New Type.
 *
 * A numeric Type Object has a `parse` method: `uint8.parse('1')` returns the
 * value as that type. For integer types the signature is parse(string, radix=10).
 * The accepted input is exactly a literal of the type, with optional surrounding
 * whitespace and an optional sign; numeric separators are accepted and the radix
 * form accepts the matching base prefix. Unlike parseInt/parseFloat, no trailing
 * text is consumed and a failed parse throws rather than returning NaN: a
 * malformed string is a SyntaxError, and a well-formed literal out of range is a
 * RangeError (spec sec-parse-for-numeric-types).
 */

// ── The parse method exists on numeric types ──────────────────────────────────
test('parse: a numeric type has a parse method', () => {
  expect(evaluated('typeof uint8.parse;')).toBe('function');
  expect(evaluated('typeof int32.parse;')).toBe('function');
  expect(evaluated('typeof float32.parse;')).toBe('function');
});

// ── Integer parsing ───────────────────────────────────────────────────────────
test('parse: an integer type parses a decimal literal to that type', () => {
  expect(ok('uint8.parse("1") === (1 := uint8);')).toBe(true);
  expect(ok('uint32.parse("1000") === (1000 := uint32);')).toBe(true);
  // a signed literal
  expect(ok('int8.parse("-5") === (-5 := int8);')).toBe(true);
});

test('parse: numeric separators are accepted', () => {
  expect(ok('uint32.parse("1_000") === (1000 := uint32);')).toBe(true);
});

test('parse: the radix form accepts the matching base and prefix', () => {
  expect(ok('uint8.parse("ff", 16) === (255 := uint8);')).toBe(true);
  // binary
  expect(ok('uint8.parse("101", 2) === (5 := uint8);')).toBe(true);
});

// ── Float parsing ─────────────────────────────────────────────────────────────
test('parse: a float type parses a float literal', () => {
  expect(ok('float32.parse("3.5") === (3.5 := float32);')).toBe(true);
  // an exponent form
  expect(ok('float64.parse("1e3") === (1000 := float64);')).toBe(true);
});

// ── Errors: no trailing garbage, throw not NaN ────────────────────────────────
test('parse: a malformed string is a SyntaxError, not NaN', () => {
  // trailing garbage is not consumed
  expectThrown('uint8.parse("12abc");');
  // trailing whitespace-separated text is rejected
  expectThrown('uint8.parse("1 2");');
  // an empty string is not a literal
  expectThrown('uint8.parse("");');
});

test('parse: a well-formed literal out of range is a RangeError', () => {
  // 256 is a valid literal but out of uint8 range
  expectThrown('uint8.parse("256");');
  // a negative into an unsigned type is out of range
  expectThrown('uint8.parse("-1");');
});
