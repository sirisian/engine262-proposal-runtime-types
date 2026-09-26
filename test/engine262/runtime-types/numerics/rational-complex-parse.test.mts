import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-parsing. "Each numeric type has a `parse` function ... for the
 * binary floating-point, decimal, RATIONAL, and COMPLEX types it is
 * `parse(_string_)` ... Each type also has a `tryParse` function."
 *
 * Two families had neither. `rational` and `complex` are bound as CONSTRUCTORS
 * rather than as type objects - deliberately, because the clause writes them
 * that way, `complex(0, 4)` being its own example - so they inherit nothing
 * from `%Type.prototype%`, where every other numeric type finds its `parse`.
 *
 * The gap was masked for complex by its width-named shorthands: `complex64` is
 * a genuine type object and `complex64.parse` worked, while bare `complex.parse`
 * was not a function at all. Rational has no shorthand, so nothing masked it.
 *
 * Defining the two functions on the constructors puts them where the clause
 * says they are without disturbing the two-argument form it depends on.
 */

test('a rational parses its own written form', () => {
  // #sec-rational-types defines no literal, so the accepted input is the form
  // the type WRITES. Where a type has no literal, its written form is the only
  // available reading of "the grammar of a literal of that type".
  expect(evaluated("String(rational.parse('1/2'));")).toBe('1/2');
  expect(evaluated("String(rational.parse('-1/2'));")).toBe('-1/2');
  // A bare integer stands for a denominator of one.
  expect(evaluated("String(rational.parse('5'));")).toBe('5');
  // Construction normalizes, so the parse lands in lowest terms.
  expect(evaluated("String(rational.parse('2/4'));")).toBe('1/2');
  // Separators and surrounding space, as the clause requires of every parse.
  expect(evaluated("String(rational.parse('1_000/3'));")).toBe('1000/3');
  expect(evaluated("String(rational.parse('  1/2  '));")).toBe('1/2');
});

test('a rational round-trips its toString', () => {
  expect(evaluated('let r = rational(3, 7); String(rational.parse(String(r)));')).toBe('3/7');
});

test('what a rational refuses', () => {
  // A denominator of zero is a literal whose value no rational type can represent:
  // the Parsing clause's RangeError, the one `rational(1, 0)` throws. A SIGNED
  // denominator is not a literal of the type at all.
  expectThrownKind("rational.parse('1/0');", 'RangeError');
  expectThrownKind("rational.parse('1/-2');", 'SyntaxError');
  expectThrownKind("rational.parse('zz');", 'SyntaxError');
  // "The entire string must be a literal of the type: no trailing text."
  expectThrownKind("rational.parse('1/2x');", 'SyntaxError');
  expect(evaluated("String(rational.tryParse('zz'));")).toBe('null');
  expect(evaluated("String(rational.tryParse('1/2'));")).toBe('1/2');
});

test('the bare complex parses what its shorthands parse', () => {
  // One reader for both spellings, so they cannot drift.
  expect(evaluated("String(complex.parse('1+2i'));")).toBe('1+2i');
  expect(evaluated("String(complex.parse('4i'));")).toBe('4i');
  expect(evaluated("String(complex.parse('3'));")).toBe('3+0i');
  expect(evaluated("String(complex64.parse('1+2i'));")).toBe('1+2i');
  expectThrownKind("complex.parse('zz');", 'SyntaxError');
  expect(evaluated("String(complex.tryParse('zz'));")).toBe('null');
});

test('the constructor forms the clause writes are untouched', () => {
  // "`4i` is `complex(0, 4)`" - the clause's own example.
  expect(evaluated('String(complex(0, 4));')).toBe('4i');
  expect(evaluated('String(rational(1, 2));')).toBe('1/2');
  // And the one-argument conversion stays a conversion.
  expect(evaluated('String(rational(0.5));')).toBe('1/2');
});
