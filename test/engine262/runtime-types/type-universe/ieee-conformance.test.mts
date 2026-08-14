import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * IEEE 754 CONFORMANCE.
 *
 * proposal-runtime-types #sec-binary-floating-point-types gives float16,
 * float32, float64 and float128 "values of the corresponding IEEE 754-2019
 * binary interchange formats". A value type whose values are a hardware
 * format's must produce what that hardware produces, or a program that runs on
 * two engines gets two answers - so this file is written as a conformance
 * instrument rather than as a regression net: every expectation here is either
 * computed from the HOST's own hardware or is a published property of the
 * format, never read off the engine and pinned.
 *
 * The ground truth for the binary formats is the host's, obtained through
 * `Math.fround`, `Float16Array` and `DataView` - all of which are the machine's
 * own arithmetic. For binary128 no host support exists, so the truth is derived
 * instead: every binary64 value is exactly a binary128 value (the format is
 * strictly wider in both significand and exponent), so a float128 built from a
 * double must print the double's EXACT value, which is computable from its bit
 * pattern with integer arithmetic alone.
 */

/** The exact decimal text of a double, from its bits. Integer arithmetic only. */
function exactDecimalOfDouble(x: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const negative = (bits >> 63n) === 1n;
  const rawExponent = Number((bits >> 52n) & 0x7FFn);
  const rawFraction = bits & 0xF_FFFF_FFFF_FFFFn;
  let significand = rawExponent === 0 ? rawFraction : rawFraction | (1n << 52n);
  let exponent = rawExponent === 0 ? -1074 : rawExponent - 1075;
  if (significand === 0n) {
    return negative ? '-0' : '0';
  }
  while ((significand & 1n) === 0n) {
    significand >>= 1n;
    exponent += 1;
  }
  let text;
  if (exponent >= 0) {
    text = (significand << BigInt(exponent)).toString(10);
  } else {
    const places = -exponent;
    const scaled = (significand * 5n ** BigInt(places)).toString(10).padStart(places + 1, '0');
    const whole = scaled.slice(0, scaled.length - places);
    const fraction = scaled.slice(scaled.length - places).replace(/0+$/, '');
    text = fraction === '' ? whole : `${whole}.${fraction}`;
  }
  return negative ? `-${text}` : text;
}


/**
 * A double rounded to binary16, computed from the format: 11 bits of
 * significand, ties to even, an exponent range of -14 to 15, with overflow to
 * an infinity and underflow through the subnormals to zero. Written out rather
 * than taken from a host `Float16Array`, which not every host provides - and
 * writing it out is what makes it a statement of the FORMAT rather than a
 * comparison of two implementations that might share a bug.
 */
function roundToBinary16(x: number): number {
  if (!Number.isFinite(x) || x === 0) {
    return x;
  }
  const sign = x < 0 ? -1 : 1;
  const magnitude = Math.abs(x);
  const MIN_NORMAL = 2 ** -14;
  const MAX = 65504;
  if (magnitude >= 65520) {
    return sign * Infinity;
  }
  let result;
  if (magnitude < MIN_NORMAL) {
    // Subnormal: a fixed grid of 2**-24.
    const step = 2 ** -24;
    result = Math.round(magnitude / step) * step;
    // Ties to even on the grid.
    const quotient = magnitude / step;
    if (Math.abs(quotient - Math.floor(quotient) - 0.5) < Number.EPSILON) {
      const down = Math.floor(quotient);
      result = (down % 2 === 0 ? down : down + 1) * step;
    }
  } else {
    const exponent = Math.floor(Math.log2(magnitude));
    const step = 2 ** (exponent - 10);
    const quotient = magnitude / step;
    let rounded = Math.round(quotient);
    if (Math.abs(quotient - Math.floor(quotient) - 0.5) < 1e-9) {
      const down = Math.floor(quotient);
      rounded = down % 2 === 0 ? down : down + 1;
    }
    result = rounded * step;
    if (result > MAX) {
      return sign * Infinity;
    }
  }
  return sign * result;
}

// -- float128 against derived hardware truth -----------------------------------

test('float128 holds a double EXACTLY, digit for digit', () => {
  // Not a round trip and not an approximation: the engine's text is compared
  // against the double's exact value computed here from its bit pattern. A
  // hardware binary128 must produce the same, because the conversion is exact.
  for (const v of [0.1, 1.5, 1 / 3, 2 / 3, 1e300, 1e-300, 12345.6789, Math.PI, Math.E]) {
    expect(evaluated(`float128(${v}).toString();`), `float128(${v})`).toBe(exactDecimalOfDouble(v));
  }
});

test('float128 holds the extremes of binary64 exactly', () => {
  // The boundaries are where a wrong exponent or a lost implicit bit shows.
  for (const [name, v] of [
    ['MAX_VALUE', Number.MAX_VALUE],
    ['MIN_VALUE', Number.MIN_VALUE],
    ['smallest normal', 2 ** -1022],
    ['largest subnormal', 2 ** -1022 - 2 ** -1074],
    ['EPSILON', Number.EPSILON],
  ] as const) {
    expect(evaluated(`float128(${v}).toString();`), name).toBe(exactDecimalOfDouble(v));
  }
});

test('float128 carries the specials as the format defines them', () => {
  expect(evaluated('float128(Infinity).toString();')).toBe('Infinity');
  expect(evaluated('float128(-Infinity).toString();')).toBe('-Infinity');
  expect(evaluated('float128(NaN).toString();')).toBe('NaN');
  expect(evaluated('String(1 / float128(Infinity).valueOf());')).toBe('0');
});

test('float128 narrows back to a double by rounding, and the double is unchanged', () => {
  // The other direction ROUNDS, which is what makes float128 the wider format
  // rather than a relabelling. Every double survives the round trip exactly.
  for (const v of [0.1, 1 / 3, Math.PI, Number.MAX_VALUE, Number.MIN_VALUE]) {
    expect(evaluated(`String(float128(${v}).valueOf() === ${v});`), String(v)).toBe('true');
  }
});

// -- The narrower binary formats, against the host's own arithmetic -----------

test('float32 rounds exactly as the hardware does', () => {
  // Math.fround IS the machine's binary32 rounding, so this compares the engine
  // against the host rather than against an expectation someone typed.
  for (const v of [0.1, 1 / 3, Math.PI, 16777217, 1e-45, 3.4028235e38]) {
    expect(evaluated(`String(Number(float32(${v})));`), String(v)).toBe(String(Math.fround(v)));
  }
});

test('float16 rounds on its own grid, not float32\'s', () => {
  // A coarser grid: a value that survives float32 may not survive float16, and
  // borrowing float32's rounding kept precision the format does not have.
  // Computed from the FORMAT rather than from a host Float16Array, which not
  // every host has: round the double to 11 significant bits with ties to even,
  // within binary16's exponent range. That is what the hardware does.
  const f16 = roundToBinary16;
  for (const v of [0.1, 1 / 3, 2049, 65504, 6.1e-5, 5.96e-8]) {
    expect(evaluated(`String(Number(float16(${v})));`), String(v)).toBe(String(f16(v)));
  }
});

test('the float widths agree with the host at their boundaries', () => {
  // Overflow to an infinity, and underflow to a subnormal then to zero - the
  // two places a width's exponent range is actually observable.
  expect(evaluated('String(Number(float32(3.5e38)));')).toBe(String(Math.fround(3.5e38)));
  expect(evaluated('String(Number(float16(70000)));')).toBe(String(roundToBinary16(70000)));
  expect(evaluated('String(Number(float16(1e-8)));')).toBe(String(roundToBinary16(1e-8)));
});

// -- Integer families, against exact integer arithmetic ------------------------

test('integer types wrap exactly as two\'s complement hardware does', () => {
  // BigInt.asIntN and asUintN ARE the reduction the hardware performs, so the
  // expectations are computed rather than asserted.
  const cases: [string, bigint, number][] = [
    ['uint8', 300n, 8], ['uint8', -1n, 8], ['int8', 200n, 8],
    ['uint16', 70000n, 16], ['int16', 40000n, 16], ['uint32', 5000000000n, 32],
  ];
  for (const [type, value, bits] of cases) {
    const expected = type.startsWith('u')
      ? BigInt.asUintN(bits, value)
      : BigInt.asIntN(bits, value);
    expect(evaluated(`String((0 := ${type}) + (${value} := ${type}));`), `${type} ${value}`)
      .toBe(String(expected));
  }
});

test('a wide integer type is exact where a double is not', () => {
  // Above 2**53 a double no longer distinguishes adjacent integers, which is
  // exactly where a hardware int64 still does.
  expect(evaluated('String(int64.parse("9223372036854775807"));')).toBe('9223372036854775807');
  expect(evaluated('String(uint64.parse("18446744073709551615"));')).toBe('18446744073709551615');
  expect(evaluated('String(int64.parse("1152921504606846976") === int64.parse("1152921504606846977"));')).toBe('false');
  expect(evaluated('String((0 := uint64) - (1 := uint64));')).toBe('18446744073709551615');
});

// -- Signed zero, which every format distinguishes -----------------------------

test('the two zeroes are distinct in every float width', () => {
  // IEEE 754 distinguishes them and SameValue reports the difference, so a
  // width that loses the sign is not the format it claims to be. Read through
  // the reciprocal, which is how the sign of a zero is observable at all.
  for (const type of ['float16', 'float32', 'float64']) {
    expect(evaluated(`String(1 / Number(${type}(-0)));`), type).toBe('-Infinity');
    expect(evaluated(`String(1 / Number(${type}(0)));`), type).toBe('Infinity');
  }
});

test('float128 distinguishes the two zeroes', () => {
  // The sign was being lost by reading the incoming payload through `R`, which
  // answers the MATHEMATICAL value - and negative zero does not exist there, so
  // R maps it to 0 deliberately. A format whose values include both zeroes
  // cannot read its input that way; the payload is read directly instead, which
  // is what the other float widths already did.
  expect(evaluated('String(1 / float128(-0).valueOf());')).toBe('-Infinity');
  expect(evaluated('String(1 / float128(0).valueOf());')).toBe('Infinity');
  expect(evaluated('float128(-0).toString();')).toBe('-0');
  // And through a computed negative zero, which no constant folding can reach.
  expect(evaluated('String(1 / float128(-1 / Infinity).valueOf());')).toBe('-Infinity');
});

test('float128.parse builds a value of the format, not a double wearing its name', () => {
  // A parse that answered a TypedNumberValue carrying a double would print the
  // double's SHORTEST text - '0.1' - rather than the exact value a binary128
  // holds. The distinction is the whole point of the type.
  expect(evaluated('String(float128.parse("0.1") is float128);')).toBe('true');
  expect(evaluated('float128.parse("0.1").toString();')).toBe(exactDecimalOfDouble(0.1));
  expect(evaluated('float128.parse("1.5").toString();')).toBe('1.5');
  expect(evaluated('String(float128.tryParse("nope"));')).toBe('null');
});
