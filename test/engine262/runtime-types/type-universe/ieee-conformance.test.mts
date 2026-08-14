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

// -- The complex family's operators (C99 Annex G over IEEE 754 components) ----
//
// #sec-which-operations-each-family-defines gives the family unaryMinus,
// exponentiate, multiply, divide, add, subtract, equal, sameValue,
// sameValueZero and toString, and denies it lessThan "since the complex numbers
// are not ordered", remainder, and the bitwise and shift operations. What the
// defined ones compute is not written there - #sec-extension-hooks assigns the
// operators outward - so the reference is C99 Annex G, which is what an engine
// backed by C's `_Complex` implements. Every expectation below is computed here
// from the component formulas rather than read off the engine.

/** The component formulas, applied to the same doubles the engine uses. */
function refMul(a: number, b: number, c: number, d: number): [number, number] {
  return [a * c - b * d, a * d + b * c];
}

function refDiv(a: number, b: number, c: number, d: number): [number, number] {
  // Smith's algorithm, which is what Annex G assumes: the naive conjugate form
  // computes c*c + d*d and overflows for operands whose squares do.
  if (Math.abs(c) >= Math.abs(d)) {
    const r = d / c;
    const denominator = c + d * r;
    return [(a + b * r) / denominator, (b - a * r) / denominator];
  }
  const r = c / d;
  const denominator = c * r + d;
  return [(a * r + b) / denominator, (b * r - a) / denominator];
}

test('complex arithmetic matches the component formulas', () => {
  const cases: [number, number, number, number][] = [
    [3, 4, 1, 2], [0.1, 0.2, 0.3, 0.4], [-5, 2.5, 7, -1.25], [1e10, 1e-10, 3, 7],
  ];
  for (const [a, b, c, d] of cases) {
    const label = `(${a}+${b}i) op (${c}+${d}i)`;
    expect(evaluated(`(complex(${a}, ${b}) + complex(${c}, ${d})).toString();`), label)
      .toBe(`${a + c}${b + d < 0 ? '' : '+'}${b + d}i`);
    const [mr, mi] = refMul(a, b, c, d);
    expect(evaluated(`(complex(${a}, ${b}) * complex(${c}, ${d})).toString();`), label)
      .toBe(`${mr}${mi < 0 ? '' : '+'}${mi}i`);
    const [dr, di] = refDiv(a, b, c, d);
    expect(evaluated(`(complex(${a}, ${b}) / complex(${c}, ${d})).toString();`), label)
      .toBe(`${dr}${di < 0 ? '' : '+'}${di}i`);
  }
});

test('complex division does not overflow where the quotient is finite', () => {
  // The single case that proves Smith's algorithm is in place: the naive
  // conjugate formula computes a denominator of Infinity here and answers NaN.
  const [r, i] = refDiv(1e200, 1e200, 3e200, 4e200);
  expect(r).toBe(0.28);
  expect(evaluated('(complex(1e200, 1e200) / complex(3e200, 4e200)).toString();'))
    .toBe(`${r}${i < 0 ? '' : '+'}${i}i`);
});

test('unary minus negates both components, including the zeroes', () => {
  expect(evaluated('(-complex(3, 4)).toString();')).toBe('-3-4i');
  // -complex(0, 0) is complex(-0, -0), which the component signs can see.
  expect(evaluated('const z = -complex(0, 0); `${Object.is(z.real, -0)}:${Object.is(z.imaginary, -0)}`;'))
    .toBe('true:true');
});

test('exponentiation agrees with repeated multiplication', () => {
  expect(evaluated('const a = complex(3, 4); const sq = a * a;'
    + ' const p = a ** complex(2, 0);'
    + ' `${Math.abs(p.real - sq.real) < 1e-9}:${Math.abs(p.imaginary - sq.imaginary) < 1e-9}`;')).toBe('true:true');
});

test('every operation the family denies is refused', () => {
  // Asserted one at a time: a group passes if any single one throws.
  for (const op of ['%', '<', '<=', '>', '>=', '<<', '>>', '>>>', '&', '|', '^']) {
    expect(evaluated(`const a = complex(3, 4), b = complex(1, 2); let m = "accepted";`
      + ` try { a ${op} b; } catch (e) { m = "refused"; } m;`), op).toBe('refused');
  }
  // And `+` no longer CONCATENATES, which is what it did before the family
  // reached the operator dispatch at all.
  expect(evaluated('String(complex(1, 0) + complex(2, 0));')).toBe('3+0i');
  // A complex mixes with no VALUE implicitly, as a decimal does not. A LITERAL
  // is a different case: complex.md has "a real literal propagates onto the real
  // axis, so `z + 3` and `z * 2` read naturally ... but a real value does not
  // convert on its own", which is literal propagation rather than widening.
  // `let`, not `const`: an unannotated `const` with a constant initializer IS a
  // literal for this rule, so a `const x = 1` would propagate as one.
  expect(evaluated('let x = 1; let m = "accepted";'
    + ' try { complex(1, 0) + x; } catch (e) { m = "refused"; } m;')).toBe('refused');
  expect(evaluated('String(complex(1, 0) + 1);')).toBe('2+0i');
  expect(evaluated('String(complex(1, 2) * 2);')).toBe('2+4i');
});

test('equality is over the pair, and splits the way every numeric type does', () => {
  expect(evaluated('String(complex(3, 4) === complex(3, 4));')).toBe('true');
  expect(evaluated('String(complex(3, 4) === complex(3, 5));')).toBe('false');
  expect(evaluated('String(Object.is(complex(3, 4), complex(3, 4)));')).toBe('true');
  // `===` makes the two zeroes equal and Object.is does not - the same split
  // the Number type has.
  expect(evaluated('String(complex(0, 0) === complex(-0, 0));')).toBe('true');
  expect(evaluated('String(Object.is(complex(0, 0), complex(-0, 0)));')).toBe('false');
  // A complex serves as a Map key by value.
  expect(evaluated('const m = new Map(); m.set(complex(3, 4), "v"); String(m.get(complex(3, 4)));')).toBe('v');
});

test('the Math additions answer a REAL, not a complex', () => {
  // "`Math.abs` of a `complex.<T>` is the real magnitude, a value of _T_", and
  // it is hypot: sqrt(x*x + y*y) overflows where hypot does not.
  expect(evaluated('String(Math.abs(complex(3, 4)));')).toBe('5');
  expect(evaluated('String(Math.abs(complex(1e200, 1e200)));')).toBe(String(Math.hypot(1e200, 1e200)));
  expect(evaluated('String(Math.arg(complex(0, 1)));')).toBe(String(Math.PI / 2));
  expect(evaluated('Math.conj(complex(3, 4)).toString();')).toBe('3-4i');
  // conj IS a complex, being the family's own operation.
  expect(evaluated('const c = Math.conj(complex(3, 4)); `${c.real}:${c.imaginary}`;')).toBe('3:-4');
});

test('a result carries the operand type, with its components rounded', () => {
  // The operator table says a binary operator yields "the operand type", so a
  // complex64 product is a pair of FLOAT32s - not a pair of doubles labelled
  // complex64. Chosen so the exact product is not a float32.
  const exact = 0.1 * 0.3 - 0.2 * 0.4;
  expect(evaluated('const a = complex64(complex(0.1, 0.2)), b = complex64(complex(0.3, 0.4));'
    + ' String((a * b).real);')).toBe(String(Math.fround(Math.fround(0.1) * Math.fround(0.3) - Math.fround(0.2) * Math.fround(0.4))));
  // And the same values at `complex` keep double components, so the two differ.
  expect(evaluated('const a = complex(0.1, 0.2), b = complex(0.3, 0.4); String((a * b).real);')).toBe(String(exact));
});

// -- A member expression's base is walked (#sec-literalvalueintype) -----------
//
// A wide literal's exact digits are recorded by the WALK of its enclosing
// conversion and read back at evaluation. A member expression exited the walk's
// switch without descending into its own subtree, so a conversion standing as a
// member base was never walked and its literal evaluated from the double the
// lexer scanned.

test('a wide literal is exact however it is spelled', () => {
  // The two spellings of one operation, which is the property worth asserting
  // rather than either value alone: a reader takes them to be the same.
  expect(evaluated('String((9223372036854775807 := int64));')).toBe('9223372036854775807');
  expect(evaluated('(9223372036854775807 := int64).toString();')).toBe('9223372036854775807');
  // The second was not merely rounded but WRAPPED: the literal became a double,
  // rounded up to 2**63, and re-entered int64 as -2**63.
  expect(evaluated('String((9223372036854775807 := int64).toString() === String((9223372036854775807 := int64)));')).toBe('true');
});

test('a literal beyond a double answers from its digits', () => {
  // The discriminator that ruled out a rounding: no rounding of this value
  // gives zero, which is what `.toString()` answered.
  const wide = '1606938044258990275541962092341162602522202993782792835301375';
  expect(evaluated(`(${wide} := uint.<200>).toString();`)).toBe(wide);
  expect(evaluated(`String((${wide} := uint.<200>));`)).toBe(wide);
});

test('arithmetic over wide casts agrees in both spellings', () => {
  expect(evaluated('((9223372036854775807 := int64) + (1 := int64)).toString();')).toBe('-9223372036854775808');
  expect(evaluated('String((9223372036854775807 := int64) + (1 := int64));')).toBe('-9223372036854775808');
});

test('valueOf still answers a Number, which is its contract', () => {
  // Pinned so a later reader does not "fix" it: valueOf is defined to produce a
  // Number, and a Number cannot hold this value. That is not the same defect.
  expect(evaluated('String((9223372036854775807 := int64).valueOf());')).toBe('9223372036854776000');
});

// -- Shifts at the type's width (#sec-integer-operations) ---------------------
//
// Each integer type has the operations of its family AT ITS OWN WIDTH.
// JavaScript's shift operators truncate their operand to 32 bits, so a type
// whose values a double holds - width 33 to 53 - answered a 32-bit shift, while
// the exact path above 53 had computed these at the width all along. The
// expectations below come from BigInt.asIntN/asUintN, which are the reduction
// the width defines, rather than from what the engine prints.

test('every shift is performed at the type\'s own width', () => {
  const widths = [33, 40, 52, 53, 54, 64];
  const distances = [0, 1, 31, 32];
  for (const bits of widths) {
    for (const dist of distances.concat([bits - 1, bits, bits + 1])) {
      const d = BigInt(((dist % bits) + bits) % bits);
      const expected = BigInt.asUintN(bits, 1n << d).toString();
      expect(
        evaluated(`String((1 := uint.<${bits}>) << (${dist} := uint.<${bits}>));`),
        `uint.<${bits}> 1 << ${dist}`,
      ).toBe(expected);
    }
  }
});

test('the right shifts read the operand at the width', () => {
  // `>>` passing before the fix was a coincidence - sign extension agrees at
  // every width for -1 - so both are asserted over operands where they differ.
  for (const bits of [33, 40, 52, 53, 54]) {
    const max = BigInt.asUintN(bits, -1n);
    expect(
      evaluated(`String((${max} := uint.<${bits}>) >>> (4 := uint.<${bits}>));`),
      `uint.<${bits}> max >>> 4`,
    ).toBe((max >> 4n).toString());
    expect(
      evaluated(`String((-1 := int.<${bits}>) >>> (4 := int.<${bits}>));`),
      `int.<${bits}> -1 >>> 4`,
    ).toBe((BigInt.asUintN(bits, -1n) >> 4n).toString());
    expect(
      evaluated(`String((-1 := int.<${bits}>) >> (4 := int.<${bits}>));`),
      `int.<${bits}> -1 >> 4`,
    ).toBe('-1');
  }
});

test('widths at or below 32 keep the semantics every program uses', () => {
  // The band is `> 32 && <= 53`. Below it JavaScript's own shift IS the width's,
  // and getting that bound wrong would change an operator every program uses.
  for (const bits of [8, 16, 31, 32]) {
    for (const dist of [0, 1, 4, bits - 1]) {
      const d = BigInt(((dist % bits) + bits) % bits);
      expect(
        evaluated(`String((1 := uint.<${bits}>) << (${dist} := uint.<${bits}>));`),
        `uint.<${bits}> 1 << ${dist}`,
      ).toBe(BigInt.asUintN(bits, 1n << d).toString());
    }
  }
});
