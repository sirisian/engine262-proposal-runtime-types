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

// ── tryParse: the same parse, reporting failure beside the type ───────────────
// The Parsing clause pairs `parse` with `tryParse`: same parameters, a value of
// the type where `parse` would return one, and null where it would fail. The
// union is the point. A sentinel would have to be a value of the type, and an
// integer type has none to spare, which is the same reason `parse` throws rather
// than returning NaN. Reporting the failure beside the type instead lets it be
// handled by narrowing.
test('tryParse: a numeric type has a tryParse method', () => {
  expect(evaluated('typeof uint8.tryParse;')).toBe('function');
  expect(evaluated('typeof float64.tryParse;')).toBe('function');
  expect(evaluated('String(uint8.tryParse.length);')).toBe('1');
  expect(evaluated('String(uint8.tryParse.name);')).toBe('tryParse');
});

test('tryParse: it returns the value where parse would', () => {
  expect(evaluated('String(Number(uint8.tryParse("5")));')).toBe('5');
  expect(evaluated('String(Number(int8.tryParse("-5")));')).toBe('-5');
  expect(evaluated('String(Number(float64.tryParse("1.5")));')).toBe('1.5');
  expect(evaluated('String(Number(float64.tryParse("Infinity")));')).toBe('Infinity');
  // the same leniencies parse has, and no others
  expect(evaluated('String(Number(uint8.tryParse(" 5 ")));')).toBe('5');
  expect(evaluated('String(Number(uint16.tryParse("1_000")));')).toBe('1000');
  expect(evaluated('String(Number(uint8.tryParse("ff", 16)));')).toBe('255');
  // and the result carries the type, so no cast is needed after a test
  expect(evaluated('(uint8.tryParse("5") is uint8) ? "yes" : "no";')).toBe('yes');
});

test('tryParse: it returns null where parse would throw', () => {
  // a SyntaxError case: not a literal of the type
  expect(evaluated('String(uint8.tryParse("12abc"));')).toBe('null');
  expect(evaluated('String(uint8.tryParse(""));')).toBe('null');
  expect(evaluated('String(float64.tryParse("abc"));')).toBe('null');
  expect(evaluated('String(uint16.tryParse("1__000"));')).toBe('null');
  expect(evaluated('String(uint8.tryParse("5", 99));')).toBe('null');
  // a RangeError case: a literal the type cannot hold
  expect(evaluated('String(uint8.tryParse("256"));')).toBe('null');
  expect(evaluated('String(uint8.tryParse("-1"));')).toBe('null');
  expect(evaluated('String(int8.tryParse("-200"));')).toBe('null');
  // a non-string argument is not a literal either
  expect(evaluated('String(uint8.tryParse(5));')).toBe('null');
  // null is not a value of the type, which is what makes the union honest
  expect(evaluated('(uint8.tryParse("x") is uint8) ? "yes" : "no";')).toBe('no');
});

test('tryParse: the two agree by construction', () => {
  // tryParse delegates to parse, so whatever parse accepts it accepts
  expect(evaluated('String(Number(uint8.tryParse("5")) === Number(uint8.parse("5")));')).toBe('true');
  expect(evaluated('String(Number(uint8.tryParse("ff", 16)) === Number(uint8.parse("ff", 16)));')).toBe('true');
  // and where parse throws, tryParse is null
  expect(evaluated('let threw = false; try { uint8.parse("256"); } catch (e) { threw = true; } String(threw && uint8.tryParse("256") === null);')).toBe('true');
});

test('tryParse: misusing the method is still an error, not a null', () => {
  // a null answer means "that string did not parse". A receiver that is not a
  // type, or a type with no parse, is a mistake in the program, and answering
  // null there would report a bad call as a bad input.
  expectThrown('string.tryParse("5");');
  expectThrown('uint8.tryParse.call({}, "5");');
});

test('tryParse: the failure is handled by narrowing', () => {
  // the idiom the clause exists for: no cast in the branch that tested
  expect(evaluated(`
    let p = uint16.tryParse("8080");
    let out = 0;
    if (p !== null) { out = Number(p); }
    String(out);
  `)).toBe('8080');
  expect(evaluated(`
    let p = uint16.tryParse("not a port");
    let out = 0;
    if (p !== null) { out = Number(p); } else { out = 3000; }
    String(out);
  `)).toBe('3000');
});

test('tryParse: it is gated with the rest of the feature', () => {
  expect(ok('typeof uint8.tryParse;')).toBe(true);
});
