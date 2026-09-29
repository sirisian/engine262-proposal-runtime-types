import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * How numeric values of different types meet at run time, including the
 * conversions among the complex types. Every expectation is derived from the
 * specification's rows and measured:
 *
 * - Equality, as JavaScript treats `1` and `1n`: `===`, `Object.is` and a `Set`
 *   key see the type; `==` compares exact mathematical values, across every
 *   family, complex included.
 * - The `any` boundary, as #sec-requiretype specifies: the conversion row, refused
 *   only where it would wrap, truncate toward zero, overflow to an infinity, or
 *   lose NaN or an infinity; a real lifts into a complex, as `complex(x)` does,
 *   and a complex has no conversion to a real.
 */

const outcome = (expr: string) => evaluated(`let r; try { r = String(${expr}); } catch (e) { r = e.constructor.name; } r;`);
const at = (src: string, target: string) => outcome(`(() => { let b: any = ${src}; let a: ${target} = b; return a; })()`);

const EQUAL_ONE: [string, string][] = [["int32", "(1 := int32)"], ["int64", "(1 := int64)"], ["float32", "(1 := float32)"], ["float64", "(1 := float64)"], ["number", "1"], ["bigint", "1n"], ["decimal32", "decimal32.parse('1')"], ["decimal64", "decimal64.parse('1')"], ["rational.<8>", "rational.<8>(1, 1)"], ["rational64", "rational64(1, 1)"], ["complex64", "complex64.parse('1')"], ["complex128", "complex128.parse('1')"]];

test('equality between two numeric types: by type for ===, Object.is and keys; by value for ==', () => {
  for (let i = 0; i < EQUAL_ONE.length; i += 1) {
    for (let j = i + 1; j < EQUAL_ONE.length; j += 1) {
      const [na, a] = EQUAL_ONE[i]!;
      const [nb, b] = EQUAL_ONE[j]!;
      const got = outcome(`(() => { let a: any = ${a}; let b: any = ${b}; return [a === b, a == b, Object.is(a, b), new Set([a, b]).size].join(' '); })()`);
      expect(got, `${na} and ${nb}`).toBe('false true false 2');
    }
  }
});

test('== is exact, and cohorts within one decimal type are unchanged', () => {
  expect(outcome("(() => { let a: any = decimal64.parse('1.5'); let b: any = decimal64.parse('1.50'); return [a === b, a == b, Object.is(a, b), new Set([a, b]).size].join(' '); })()")).toBe('true true false 1');
  expect(outcome("(() => { let a: any = 0.1; let b: any = decimal64.parse('0.1'); return a == b; })()")).toBe('false');
  expect(outcome('(() => { let a: any = rational64(1, 3); let b: any = 1 / 3; return a == b; })()')).toBe('false');
  expect(outcome("(() => { let a: any = complex.parse('1+2i'); let b: any = 1; return a == b; })()")).toBe('false');
  expect(outcome('(() => { let a: any = (NaN := float128); return a == a; })()')).toBe('false');
});

test('the any boundary, from an integer', () => {
  const cases: [string, string, string, string][] = [["int32 1", "(1 := int32)", "int64", "1"], ["int32 100000", "(100000 := int32)", "int16", "RangeError"], ["int32 1", "(1 := int32)", "bigint", "1"], ["int32 1", "(1 := int32)", "float64", "1"], ["int32 16777217", "(16777217 := int32)", "float32", "16777216"], ["int32 1", "(1 := int32)", "number", "1"], ["int32 1", "(1 := int32)", "decimal64", "1"], ["int32 1", "(1 := int32)", "rational.<8>", "1"], ["int32 200", "(200 := int32)", "rational.<8>", "RangeError"], ["int32 1", "(1 := int32)", "complex128", "1+0i"]];
  for (const [label, src, target, rowWant] of cases) {
    const got = at(src, target);
    // Since the stricter-runtime decision a TYPED source of another numeric type
    // is checked at the boundary, not converted: a TypeError, whatever its range.
    const sourceType = label.split(' ')[0];
    const want = !['number', 'bigint'].includes(sourceType) && sourceType !== target ? 'TypeError' : rowWant;
    // '*' - a rounding the row gives, so a value rather than an error
    if (want === '*') {
      expect(['RangeError', 'TypeError'], `${label} at ${target}`).not.toContain(got);
    } else {
      expect(got, `${label} at ${target}`).toBe(want);
    }
  }
});

test('the any boundary, from a bigint', () => {
  const cases: [string, string, string, string][] = [["bigint 5n", "5n", "int32", "5"], ["bigint 2n**40n", "2n ** 40n", "int32", "RangeError"], ["bigint 5n", "5n", "float64", "5"], ["bigint 2n**2000n", "2n ** 2000n", "float64", "RangeError"], ["bigint 5n", "5n", "number", "5"], ["bigint 5n", "5n", "decimal64", "5"], ["bigint 2n**200n", "2n ** 200n", "decimal32", "*"], ["bigint 5n", "5n", "rational64", "5"], ["bigint 2n**100n", "2n ** 100n", "rational64", "RangeError"], ["bigint 5n", "5n", "complex128", "5+0i"]];
  for (const [label, src, target, rowWant] of cases) {
    const got = at(src, target);
    // Since the stricter-runtime decision a TYPED source of another numeric type
    // is checked at the boundary, not converted: a TypeError, whatever its range.
    const sourceType = label.split(' ')[0];
    const want = !['number', 'bigint'].includes(sourceType) && sourceType !== target ? 'TypeError' : rowWant;
    // '*' - a rounding the row gives, so a value rather than an error
    if (want === '*') {
      expect(['RangeError', 'TypeError'], `${label} at ${target}`).not.toContain(got);
    } else {
      expect(got, `${label} at ${target}`).toBe(want);
    }
  }
});

test('the any boundary, from a binary float', () => {
  const cases: [string, string, string, string][] = [["float64 2", "(2 := float64)", "int32", "2"], ["float64 0.5", "(0.5 := float64)", "int32", "RangeError"], ["float64 1e10", "(1e10 := float64)", "int32", "RangeError"], ["float64 NaN", "(NaN := float64)", "int32", "RangeError"], ["float64 Infinity", "(Infinity := float64)", "int32", "RangeError"], ["float64 2", "(2 := float64)", "bigint", "2"], ["float64 0.5", "(0.5 := float64)", "bigint", "RangeError"], ["float64 NaN", "(NaN := float64)", "bigint", "RangeError"], ["float64 0.5", "(0.5 := float64)", "float32", "0.5"], ["float64 0.1", "(0.1 := float64)", "float32", "0.10000000149011612"], ["float64 1e300", "(1e300 := float64)", "float32", "RangeError"], ["float64 0.5", "(0.5 := float64)", "number", "0.5"], ["float64 0.1", "(0.1 := float64)", "decimal64", "*"], ["float64 0.5", "(0.5 := float64)", "rational.<8>", "1/2"], ["float64 0.1", "(0.1 := float64)", "rational.<8>", "RangeError"], ["float64 0.1", "(0.1 := float64)", "rational64", "3602879701896397/36028797018963968"], ["float64 NaN", "(NaN := float64)", "rational64", "RangeError"], ["float64 0.5", "(0.5 := float64)", "complex128", "0.5+0i"]];
  for (const [label, src, target, rowWant] of cases) {
    const got = at(src, target);
    // Since the stricter-runtime decision a TYPED source of another numeric type
    // is checked at the boundary, not converted: a TypeError, whatever its range.
    const sourceType = label.split(' ')[0];
    const want = !['number', 'bigint'].includes(sourceType) && sourceType !== target ? 'TypeError' : rowWant;
    // '*' - a rounding the row gives, so a value rather than an error
    if (want === '*') {
      expect(['RangeError', 'TypeError'], `${label} at ${target}`).not.toContain(got);
    } else {
      expect(got, `${label} at ${target}`).toBe(want);
    }
  }
});

test('the any boundary, from a Number', () => {
  const cases: [string, string, string, string][] = [["number 0.5", "0.5", "int32", "RangeError"], ["number 2", "2", "int32", "2"], ["number 0.5", "0.5", "bigint", "RangeError"], ["number 0.5", "0.5", "float32", "0.5"], ["number 0.5", "0.5", "float64", "0.5"], ["number 0.5", "0.5", "decimal64", "0.5"], ["number 0.5", "0.5", "rational64", "1/2"], ["number 0.5", "0.5", "complex128", "0.5+0i"]];
  for (const [label, src, target, rowWant] of cases) {
    const got = at(src, target);
    // Since the stricter-runtime decision a TYPED source of another numeric type
    // is checked at the boundary, not converted: a TypeError, whatever its range.
    const sourceType = label.split(' ')[0];
    const want = !['number', 'bigint'].includes(sourceType) && sourceType !== target ? 'TypeError' : rowWant;
    // '*' - a rounding the row gives, so a value rather than an error
    if (want === '*') {
      expect(['RangeError', 'TypeError'], `${label} at ${target}`).not.toContain(got);
    } else {
      expect(got, `${label} at ${target}`).toBe(want);
    }
  }
});

test('the any boundary, from a decimal', () => {
  const cases: [string, string, string, string][] = [["decimal64 2", "decimal64.parse('2')", "int32", "2"], ["decimal64 1.5", "decimal64.parse('1.5')", "int32", "RangeError"], ["decimal64 1e20", "decimal64.parse('1e20')", "int32", "RangeError"], ["decimal64 2", "decimal64.parse('2')", "bigint", "2"], ["decimal64 1.5", "decimal64.parse('1.5')", "bigint", "RangeError"], ["decimal64 1.5", "decimal64.parse('1.5')", "float64", "1.5"], ["decimal64 0.1", "decimal64.parse('0.1')", "float64", "0.1"], ["decimal128 1e400", "decimal128.parse('1e400')", "float64", "RangeError"], ["decimal64 1.5", "decimal64.parse('1.5')", "number", "1.5"], ["decimal64 1.5", "decimal64.parse('1.5')", "decimal32", "1.5"], ["decimal64 1.234567891", "decimal64.parse('1.234567891')", "decimal32", "1.234568"], ["decimal32 1.5", "decimal32.parse('1.5')", "decimal64", "1.5"], ["decimal64 1.5", "decimal64.parse('1.5')", "rational64", "3/2"], ["decimal64 0.001", "decimal64.parse('0.001')", "rational.<8>", "RangeError"], ["decimal64 1.5", "decimal64.parse('1.5')", "complex128", "TypeError"]];
  for (const [label, src, target, rowWant] of cases) {
    const got = at(src, target);
    // Since the stricter-runtime decision a TYPED source of another numeric type
    // is checked at the boundary, not converted: a TypeError, whatever its range.
    const sourceType = label.split(' ')[0];
    const want = !['number', 'bigint'].includes(sourceType) && sourceType !== target ? 'TypeError' : rowWant;
    // '*' - a rounding the row gives, so a value rather than an error
    if (want === '*') {
      expect(['RangeError', 'TypeError'], `${label} at ${target}`).not.toContain(got);
    } else {
      expect(got, `${label} at ${target}`).toBe(want);
    }
  }
});

test('the any boundary, from a rational', () => {
  const cases: [string, string, string, string][] = [["rational 2", "rational64(2, 1)", "int32", "2"], ["rational 1/2", "rational64(1, 2)", "int32", "RangeError"], ["rational 2", "rational64(2, 1)", "bigint", "2"], ["rational 1/2", "rational64(1, 2)", "bigint", "RangeError"], ["rational 1/3", "rational64(1, 3)", "float64", "0.3333333333333333"], ["rational 1/3", "rational64(1, 3)", "number", "0.3333333333333333"], ["rational 1/2", "rational64(1, 2)", "decimal64", "0.5"], ["rational 1/3", "rational64(1, 3)", "decimal64", "*"], ["rational 1/2", "rational64(1, 2)", "rational.<8>", "1/2"], ["rational 1/1000", "rational64(1, 1000)", "rational.<8>", "RangeError"], ["rational.<8> 1/2", "rational.<8>(1, 2)", "rational64", "1/2"], ["rational 1/2", "rational64(1, 2)", "rational.<bigint>", "1/2"], ["rational 1/2", "rational64(1, 2)", "complex128", "TypeError"]];
  for (const [label, src, target, rowWant] of cases) {
    const got = at(src, target);
    // Since the stricter-runtime decision a TYPED source of another numeric type
    // is checked at the boundary, not converted: a TypeError, whatever its range.
    const sourceType = label.split(' ')[0];
    const want = !['number', 'bigint'].includes(sourceType) && sourceType !== target ? 'TypeError' : rowWant;
    // '*' - a rounding the row gives, so a value rather than an error
    if (want === '*') {
      expect(['RangeError', 'TypeError'], `${label} at ${target}`).not.toContain(got);
    } else {
      expect(got, `${label} at ${target}`).toBe(want);
    }
  }
});

test('the any boundary, from a complex', () => {
  const cases: [string, string, string, string][] = [["complex128 1+0i", "complex128.parse('1')", "complex64", "1+0i"], ["complex64 1+0i", "complex64.parse('1')", "complex128", "1+0i"], ["complex128 1+0i", "complex128.parse('1')", "float64", "TypeError"], ["complex128 1+0i", "complex128.parse('1')", "int32", "TypeError"], ["complex128 1+0i", "complex128.parse('1')", "decimal64", "TypeError"], ["complex128 1+0i", "complex128.parse('1')", "rational64", "TypeError"]];
  for (const [label, src, target, rowWant] of cases) {
    const got = at(src, target);
    // Since the stricter-runtime decision a TYPED source of another numeric type
    // is checked at the boundary, not converted: a TypeError, whatever its range.
    const sourceType = label.split(' ')[0];
    const want = !['number', 'bigint'].includes(sourceType) && sourceType !== target ? 'TypeError' : rowWant;
    // '*' - a rounding the row gives, so a value rather than an error
    if (want === '*') {
      expect(['RangeError', 'TypeError'], `${label} at ${target}`).not.toContain(got);
    } else {
      expect(got, `${label} at ${target}`).toBe(want);
    }
  }
});

// An any float64 NaN at a decimal is the decimal NaN
// (#sec-decimal-floating-point-types).
test('the any boundary, a float NaN at a decimal', () => {
  // A typed NaN of another type is refused at the boundary (stricter-runtime decision).
  expect(at('(NaN := float64)', 'decimal64')).toBe('TypeError');
});

test('the explicit conversions the boundary runs, in both spellings', () => {
  const cases: [string, string][] = [["decimal64.parse('1.5') := int32", "1"], ["int32(decimal64.parse('-1.5'))", "-1"], ["decimal64.parse('300') := uint8", "44"], ["uint8(decimal64.parse('300'))", "44"], ["decimal64.parse('-1.5') := bigint", "-1"], ["rational64(300, 1) := uint8", "44"], ["uint8(rational64(300, 1))", "44"], ["rational64(-3, 2) := int32", "-1"], ["rational.<bigint>(2n ** 70n + 5n, 1n) := int64", "5"], ["complex128.parse('1e300') := complex64", "Infinity+0i"], ["complex64(complex128.parse('1e300'))", "Infinity+0i"], ["complex(complex64.parse('1.5+2i'))", "1.5+2i"], ["complex(3)", "3+0i"], ["complex(1, 2)", "1+2i"]];
  for (const [expr, want] of cases) {
    expect(outcome(expr), expr).toBe(want);
  }
  // the boundary refuses the overflow the explicit conversion makes an infinity,
  // for a complex part and for a real lifted into one
  // A typed complex128 at a complex64 boundary is refused before any overflow
  // (stricter-runtime decision); an untyped Number still meets the range.
  expect(at("complex128.parse('1e300')", 'complex64')).toBe('TypeError');
  expect(at('1e300', 'complex64')).toBe('RangeError');
});
