/**
 * Rounding an exact value to a binary float format narrower than binary128 -
 * binary16, binary32 or binary64 - ONCE, to nearest with ties to even, as IEEE 754
 * requires of a conversion from an exact value. Pure: no engine state. Literals
 * at float16 and float32 (NumericValue) and float128's narrowing conversions
 * (Float128Arithmetic) share it, so there is one rounding for these formats.
 */

const FORMATS = {
  16: [11, -14, 15],
  32: [24, -126, 127],
  64: [53, -1022, 1023],
} as const;

/**
 * The value of the format nearest numerator/denominator (denominator > 0), ties
 * to even. Below the least normal a value is subnormal, and one that rounds past
 * the largest finite value is infinite.
 */
export function roundRationalToBinaryFloat(numerator: bigint, denominator: bigint, width: 16 | 32 | 64): number {
  if (numerator === 0n) {
    return 0;
  }
  const negative = numerator < 0n;
  const num = negative ? -numerator : numerator;
  const den = denominator;
  const [precision, emin, emax] = FORMATS[width];
  const atLeast = (k: number) => (k >= 0 ? num >= den << BigInt(k) : num << BigInt(-k) >= den);
  let e = num.toString(2).length - den.toString(2).length;
  while (!atLeast(e)) e -= 1;
  while (atLeast(e + 1)) e += 1;
  if (e > emax) {
    return negative ? -Infinity : Infinity;
  }
  const ulp = Math.max(e, emin) - (precision - 1);
  let n = num;
  let d = den;
  if (ulp >= 0) {
    d <<= BigInt(ulp);
  } else {
    n <<= BigInt(-ulp);
  }
  let m = n / d;
  const twice = (n - m * d) * 2n;
  if (twice > d || (twice === d && (m & 1n) === 1n)) {
    m += 1n;
  }
  // m has at most `precision` + 1 bits and 2**ulp is a power of two within the
  // double range, so this product is exact in a double.
  const magnitude = Number(m) * 2 ** ulp;
  const largest = (2 - 2 ** (1 - precision)) * 2 ** emax;
  const value = magnitude > largest ? Infinity : magnitude;
  return negative ? -value : value;
}
