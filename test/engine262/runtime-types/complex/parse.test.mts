import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: "for the binary floating-point, decimal, rational, and complex types it
 * is `parse(_string_)`." Design: complex.md names `complex.parse('3-2i')`
 * beside the literal as a construction form.
 *
 * `parse` lives on %Type.prototype%, so every Type Object inherits it - but the
 * operation dispatched on integer, float, and decimal only, and answered
 * "parse is not defined" for a complex.
 *
 * The grammar is the one the literal writes: an optional real part, an optional
 * SIGNED imaginary part suffixed `i`, or either alone.
 */

const C = 'type C = complex.<number>; ';
const parts = (expr: string) => `${C}const z = ${expr}; String(z.real) + "," + String(z.imaginary);`;

test('complex parse: both parts', () => {
  expect(evaluated(parts("C.parse('3-2i')"))).toBe('3,-2');
  expect(evaluated(parts("C.parse('3+4i')"))).toBe('3,4');
  expect(evaluated(parts("C.parse('1e2+1e-2i')"))).toBe('100,0.01');
});

test('complex parse: either part alone', () => {
  expect(evaluated(parts("C.parse('4i')"))).toBe('0,4');
  expect(evaluated(parts("C.parse('-2.5i')"))).toBe('0,-2.5');
  expect(evaluated(parts("C.parse('5')"))).toBe('5,0');
  // surrounding whitespace is ignored, as it is for the other numeric parses
  expect(evaluated(parts("C.parse(' 3-2i ')"))).toBe('3,-2');
});

test('complex parse: what is not a complex literal', () => {
  // the suffix is on a NUMERIC literal, so a bare `i` denotes nothing
  expectThrown(`${C}C.parse('i');`);
  // a sign between the parts is required: `3 2i` is two literals, not one
  expectThrown(`${C}C.parse('3 2i');`);
  expectThrown(`${C}C.parse('abc');`);
  expectThrown(`${C}C.parse('');`);
});

test('complex parse: the other numeric types are unaffected', () => {
  expect(evaluated("String(uint8.parse('42'));")).toBe('42');
  expect(evaluated("String(float64.parse('3.5'));")).toBe('3.5');
  expect(evaluated("String(decimal64.parse('19.99'));")).toBe('19.99');
});
