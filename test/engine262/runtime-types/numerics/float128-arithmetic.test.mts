import { expect, test } from 'vitest';
import {
  add, subtract, multiply, divide, remainder, compare, exponentiate, finite, zero, infinity, NAN,
  type Binary128,
} from '../../../../src/intrinsics/Float128Arithmetic.mts';

/**
 * binary128 arithmetic, checked two ways, each needing nothing outside this file.
 *
 * ANCHORS are the outside authority: cases computed by gcc's __float128
 * (libquadmath), each operand and result written as the hex float string gcc
 * prints. They cover every operation at exact and rounded results, ties rounding
 * each way, subnormal results and a subnormal tie, overflow, and every special
 * value. To re-derive any row with gcc and libquadmath (`gcc x.c -lquadmath`):
 *
 *     char s[64];
 *     __float128 r = 0x1p-16494Q * 0x1.8p+0Q;   // fmodq(a, b) for `%`
 *     quadmath_snprintf(s, sizeof s, "%Qa", r);
 *
 * A REFERENCE gives breadth: exact rational arithmetic, rounded to binary128 by
 * bracketing the exact value between its two neighbouring binary128 values and
 * taking the nearer - written to be unlike Float128Arithmetic, which shifts and
 * keeps a sticky bit. It must agree with every anchor first; then it checks the
 * engine across a seeded sweep of operands that no table could list.
 */

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A binary128 value from gcc's `%Qa` text - already in the format, so not rounded. */
function parseHex(text: string): Binary128 {
  if (text === 'nan') return NAN;
  if (text === 'inf' || text === '-inf') return infinity(text === 'inf' ? 1 : -1);
  const m = /^(-?)0x([0-9a-f]+)(?:\.([0-9a-f]*))?p([+-]\d+)$/.exec(text);
  if (!m) throw new Error(`not a hex float: ${text}`);
  const sign = m[1] ? -1 : 1;
  const fraction = m[3] ?? '';
  let sig = BigInt(`0x${m[2]}${fraction}`);
  let exp = Number(m[4]) - 4 * fraction.length;
  if (sig === 0n) return zero(sign);
  while ((sig & 1n) === 0n) {
    sig >>= 1n;
    exp += 1;
  }
  return { cls: 'finite', sign, sig: BigInt(sign) * sig, exp };
}

/** One text per value, so two values are the same value exactly when their texts match. */
function key(x: Binary128 | undefined): string {
  if (x === undefined) return 'undefined';
  if (x.cls === 'nan') return 'nan';
  if (x.cls === 'infinity') return x.sign === -1 ? '-inf' : 'inf';
  if (x.sig === 0n) return x.sign === -1 ? '-0' : '+0';
  return `${x.sig}p${x.exp}`;
}

// ---------------------------------------------------------------------------
// Anchors: gcc's __float128
// ---------------------------------------------------------------------------

/** [operation, a, b, result]; for `<` the result is -1, 0, 1, or u for unordered. */
const ANCHORS: readonly (readonly [string, string, string, string])[] = [
  ['+', '0x1p+0', '0x1.8p+1', '0x1p+2'],
  ['+', '0x1.999999999999999999999999999ap-4', '0x1.999999999999999999999999999ap-3', '0x1.3333333333333333333333333334p-2'],
  ['+', '0x1p+0', '0x1p-113', '0x1p+0'],
  ['+', '0x1.0000000000000000000000000001p+0', '0x1p-113', '0x1.0000000000000000000000000002p+0'],
  ['+', '0x1p+0', '0x1.8p-113', '0x1.0000000000000000000000000001p+0'],
  ['+', '0x1.ffffffffffffffffffffffffffffp+16383', '0x1.ffffffffffffffffffffffffffffp+16383', 'inf'],
  ['+', '0x1.ffffffffffffffffffffffffffffp+16383', '-0x1.ffffffffffffffffffffffffffffp+16383', '0x0p+0'],
  ['+', '-0x0p+0', '-0x0p+0', '-0x0p+0'],
  ['+', '0x0p+0', '-0x0p+0', '0x0p+0'],
  ['+', 'inf', '-inf', 'nan'],
  ['+', 'inf', '0x1p+0', 'inf'],
  ['+', '0x0.0000000000000000000000000001p-16382', '0x0.0000000000000000000000000001p-16382', '0x0.0000000000000000000000000002p-16382'],
  ['-', '0x1p-16382', '0x0.0000000000000000000000000001p-16382', '0x0.ffffffffffffffffffffffffffffp-16382'],
  ['-', '0x1p+0', '0x1.0000000000000000000000000001p+0', '-0x1p-112'],
  ['-', '0x1.999999999999999999999999999ap-4', '0x1.999999999999999999999999999ap-4', '0x0p+0'],
  ['-', '0x0.018p-16382', '0x0.0000000000000000000000000001p-16382', '0x0.017fffffffffffffffffffffffffp-16382'],
  ['*', '0x1.999999999999999999999999999ap-4', '0x1.8p+1', '0x1.3333333333333333333333333334p-2'],
  ['*', '0x1.0000000000000000000000000001p+0', '0x1.0000000000000000000000000001p+0', '0x1.0000000000000000000000000002p+0'],
  ['*', '0x1p-16382', '0x1p-1', '0x0.8p-16382'],
  ['*', '0x0.0000000000000000000000000001p-16382', '0x1p-1', '0x0p+0'],
  ['*', '0x0.0000000000000000000000000001p-16382', '0x1.8p-1', '0x0.0000000000000000000000000001p-16382'],
  ['*', '0x0.0000000000000000000000000001p-16382', '0x1.8p+0', '0x0.0000000000000000000000000002p-16382'],
  ['*', '0x1p-16382', '0x1.0000000000000000000000000001p-1', '0x0.8p-16382'],
  ['*', '0x1.ffffffffffffffffffffffffffffp+16383', '0x1p+1', 'inf'],
  ['*', '0x0p+0', 'inf', 'nan'],
  ['*', '-0x0p+0', '0x1.8p+1', '-0x0p+0'],
  ['*', '-0x1p+0', '0x0p+0', '-0x0p+0'],
  ['*', 'inf', '-inf', '-inf'],
  ['*', '0x1p-8000', '0x1p-8500', '0x0p+0'],
  ['*', '0x1p+8000', '0x1p+8000', '0x1p+16000'],
  ['/', '0x1p+0', '0x1.8p+1', '0x1.5555555555555555555555555555p-2'],
  ['/', '0x1p+1', '0x1.8p+1', '0x1.5555555555555555555555555555p-1'],
  ['/', '0x1.999999999999999999999999999ap-4', '0x1.8p+1', '0x1.1111111111111111111111111111p-5'],
  ['/', '0x1p+0', '0x1.0000000000000000000000000001p+0', '0x1.fffffffffffffffffffffffffffep-1'],
  ['/', '0x1.8p+1', '0x1p+1', '0x1.8p+0'],
  ['/', '0x1p-16382', '0x1.8p+1', '0x0.5555555555555555555555555555p-16382'],
  ['/', '0x0.0000000000000000000000000001p-16382', '0x1p+1', '0x0p+0'],
  ['/', '0x0.0000000000000000000000000001p-16382', '0x1.8p+0', '0x0.0000000000000000000000000001p-16382'],
  ['/', '0x0.0000000000000000000000000003p-16382', '0x1p+1', '0x0.0000000000000000000000000002p-16382'],
  ['/', '0x1p+0', '0x0p+0', 'inf'],
  ['/', '-0x1p+0', '0x0p+0', '-inf'],
  ['/', '0x0p+0', '0x0p+0', 'nan'],
  ['/', 'inf', 'inf', 'nan'],
  ['/', '0x1p+0', 'inf', '0x0p+0'],
  ['/', '-0x1p+0', 'inf', '-0x0p+0'],
  ['/', '0x1.ffffffffffffffffffffffffffffp+16383', '0x1p-1', 'inf'],
  ['/', '-0x0p+0', '0x1.8p+1', '-0x0p+0'],
  ['%', '0x1.cp+2', '0x1.8p+1', '0x1p+0'],
  ['%', '-0x1.cp+2', '0x1.8p+1', '-0x1p+0'],
  ['%', '0x1.cp+2', '-0x1.8p+1', '0x1p+0'],
  ['%', '0x1p+0', '0x1.3333333333333333333333333333p-2', '0x1.999999999999999999999999999cp-4'],
  ['%', '0x1p+0', '0x0p+0', 'nan'],
  ['%', 'inf', '0x1.8p+1', 'nan'],
  ['%', '0x1.8p+1', 'inf', '0x1.8p+1'],
  ['%', '-0x0p+0', '0x1.8p+1', '-0x0p+0'],
  ['%', '0x1.ffffffffffffffffffffffffffffp+16383', '0x1.8p+1', '0x1p+1'],
  ['%', '0x1.999999999999999999999999999ap-4', '0x0.0000000000000000000000000001p-16382', '0x0p+0'],
  ['%', '0x1.ffffffffffffffffffffffffffffp+16383', '0x0.018p-16382', '0x0.008p-16382'],
  ['%', 'nan', '0x1p+0', 'nan'],
  ['<', '0x1p+0', '0x1.8p+1', '-1'],
  ['<', '0x1.8p+1', '0x1p+0', '1'],
  ['<', '-0x0p+0', '0x0p+0', '0'],
  ['<', 'nan', '0x1p+0', 'u'],
  ['<', '0x1p+0', 'nan', 'u'],
  ['<', '0x0.0000000000000000000000000001p-16382', '0x0p+0', '1'],
  ['<', '-inf', '-0x1.ffffffffffffffffffffffffffffp+16383', '-1'],
  ['<', '0x1.ffffffffffffffffffffffffffffp+16383', 'inf', '-1'],
  ['<', '0x1.0000000000000000000000000001p+0', '0x1p+0', '1'],
];

// ---------------------------------------------------------------------------
// The reference: exact rationals, rounded by bracketing
// ---------------------------------------------------------------------------

const isZero = (x: Binary128) => x.cls === 'finite' && x.sig === 0n;
const signOf = (x: Binary128): -1 | 1 => (x.cls === 'finite' && x.sig !== 0n ? (x.sig < 0n ? -1 : 1) : x.sign);
const negated = (x: Binary128): Binary128 => {
  if (x.cls === 'nan') return x;
  if (x.cls === 'infinity') return infinity(x.sign === 1 ? -1 : 1);
  return isZero(x) ? zero(x.sign === 1 ? -1 : 1) : { ...x, sign: x.sign === 1 ? -1 : 1, sig: -x.sig };
};
/** A finite nonzero value as numerator / denominator, denominator positive. */
const exactOf = (x: Binary128) => (x.exp >= 0
  ? { num: x.sig << BigInt(x.exp), den: 1n }
  : { num: x.sig, den: 1n << BigInt(-x.exp) });

/**
 * The binary128 value nearest num / den (num nonzero, den positive), ties to even.
 * Near the exact value, binary128 values are spaced 2**q apart; it lies between the
 * neighbours below * 2**q and (below + 1) * 2**q, and the nearer is taken.
 */
function nearest(num: bigint, den: bigint): Binary128 {
  const sign = num < 0n ? -1 : 1;
  const a = num < 0n ? -num : num;
  const atLeast = (k: number) => (k >= 0 ? a >= den << BigInt(k) : a << BigInt(-k) >= den);
  let e = a.toString(2).length - den.toString(2).length;
  while (!atLeast(e)) e -= 1;
  while (atLeast(e + 1)) e += 1;
  if (e > 16383) return infinity(sign);
  const q = Math.max(e, -16382) - 112;
  const n = q >= 0 ? a : a << BigInt(-q);
  const d = q >= 0 ? den << BigInt(q) : den;
  const below = n / d;
  const past = 2n * (n - below * d);
  const m = past > d || (past === d && below % 2n === 1n) ? below + 1n : below;
  if (m === 0n) return zero(sign);
  if (q + m.toString(2).length - 1 > 16383) return infinity(sign);
  let s = m;
  let x = q;
  while (s % 2n === 0n) {
    s /= 2n;
    x += 1;
  }
  return { cls: 'finite', sign, sig: BigInt(sign) * s, exp: x };
}

const reference = {
  add(x: Binary128, y: Binary128): Binary128 {
    if (x.cls === 'nan' || y.cls === 'nan') return NAN;
    if (x.cls === 'infinity' && y.cls === 'infinity') return x.sign === y.sign ? x : NAN;
    if (x.cls === 'infinity') return x;
    if (y.cls === 'infinity') return y;
    if (isZero(x) && isZero(y)) return zero(x.sign === -1 && y.sign === -1 ? -1 : 1);
    if (isZero(y)) return x;
    if (isZero(x)) return y;
    const a = exactOf(x);
    const b = exactOf(y);
    const num = a.num * b.den + b.num * a.den;
    return num === 0n ? zero(1) : nearest(num, a.den * b.den);
  },
  subtract(x: Binary128, y: Binary128): Binary128 {
    return reference.add(x, negated(y));
  },
  multiply(x: Binary128, y: Binary128): Binary128 {
    if (x.cls === 'nan' || y.cls === 'nan') return NAN;
    const sign = (signOf(x) * signOf(y)) as -1 | 1;
    if (x.cls === 'infinity' || y.cls === 'infinity') return isZero(x) || isZero(y) ? NAN : infinity(sign);
    if (isZero(x) || isZero(y)) return zero(sign);
    const a = exactOf(x);
    const b = exactOf(y);
    return nearest(a.num * b.num, a.den * b.den);
  },
  divide(x: Binary128, y: Binary128): Binary128 {
    if (x.cls === 'nan' || y.cls === 'nan') return NAN;
    const sign = (signOf(x) * signOf(y)) as -1 | 1;
    if (x.cls === 'infinity') return y.cls === 'infinity' ? NAN : infinity(sign);
    if (y.cls === 'infinity') return zero(sign);
    if (isZero(y)) return isZero(x) ? NAN : infinity(sign);
    if (isZero(x)) return zero(sign);
    const a = exactOf(x);
    const b = exactOf(y);
    const num = a.num * b.den;
    const den = a.den * b.num;
    return den < 0n ? nearest(-num, -den) : nearest(num, den);
  },
  /** The truncated remainder x - trunc(x / y) * y, which is exact. */
  remainder(x: Binary128, y: Binary128): Binary128 {
    if (x.cls !== 'finite' || y.cls === 'nan' || isZero(y)) return NAN;
    if (y.cls === 'infinity' || isZero(x)) return x;
    const a = exactOf(x);
    const b = exactOf(y);
    const q = (a.num * b.den) / (a.den * b.num);
    const num = a.num * b.den - q * b.num * a.den;
    return num === 0n ? zero(signOf(x)) : nearest(num, a.den * b.den);
  },
  compare(x: Binary128, y: Binary128): -1 | 0 | 1 | undefined {
    if (x.cls === 'nan' || y.cls === 'nan') return undefined;
    const rank = (v: Binary128) => (v.cls === 'infinity' ? v.sign * 2 : 0);
    if (rank(x) !== rank(y)) return rank(x) < rank(y) ? -1 : 1;
    if (rank(x) !== 0) return 0;
    const a = isZero(x) ? { num: 0n, den: 1n } : exactOf(x);
    const b = isZero(y) ? { num: 0n, den: 1n } : exactOf(y);
    const d = a.num * b.den - b.num * a.den;
    return d === 0n ? 0 : (d < 0n ? -1 : 1);
  },
  /** An integer power of a finite nonzero base: exact, then rounded once. */
  power(x: Binary128, n: number): Binary128 {
    if (n === 0) return finite(1n, 0);
    const a = exactOf(x);
    const k = BigInt(Math.abs(n));
    return n > 0 ? nearest(a.num ** k, a.den ** k)
      : (a.num < 0n ? nearest(-(a.den ** k) * (k % 2n === 1n ? 1n : -1n), (-a.num) ** k) : nearest(a.den ** k, a.num ** k));
  },
};

const OPERATIONS: Record<string, [(x: Binary128, y: Binary128) => Binary128, (x: Binary128, y: Binary128) => Binary128]> = {
  '+': [add, reference.add],
  '-': [subtract, reference.subtract],
  '*': [multiply, reference.multiply],
  '/': [divide, reference.divide],
  '%': [remainder, reference.remainder],
};
const orderKey = (c: -1 | 0 | 1 | undefined) => (c === undefined ? 'u' : String(c));

// ---------------------------------------------------------------------------
// The sweep: a seeded, deterministic stream of operands
// ---------------------------------------------------------------------------

/** mulberry32: a small, fast, seeded 32-bit generator - the same stream on every run. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const integer = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const bits = (count: number) => {
    let v = 0n;
    for (let i = 0; i < count; i += 32) v = (v << 32n) | BigInt(Math.floor(next() * 4294967296));
    return v & ((1n << BigInt(count)) - 1n);
  };
  const SPECIAL = ['0x0p+0', '-0x0p+0', 'inf', '-inf', 'nan', '0x1p+0', '-0x1p+0', '0x1.0000000000000000000000000001p+0',
    '0x1.ffffffffffffffffffffffffffffp-1', '0x1.ffffffffffffffffffffffffffffp+16383', '0x1p-16382', '0x1p-16494', '0x3p-16494'];
  /** A value whose leading bit is 2**lead, with up to 113 significant bits - fewer where subnormal. */
  const valueAt = (lead: number): Binary128 => {
    const last = Math.max(lead - 112, -16494);
    const width = lead - last + 1;
    const sig = (1n << BigInt(width - 1)) | bits(Math.max(width - 1, 0));
    const x = parseHex(`0x${sig.toString(16)}p${last >= 0 ? '+' : ''}${last}`);
    return next() < 0.5 ? x : negated(x);
  };
  const operand = (): Binary128 => {
    const r = next();
    if (r < 0.12) return parseHex(SPECIAL[integer(0, SPECIAL.length - 1)]);
    if (r < 0.45) return valueAt(integer(-60, 60));
    if (r < 0.65) return valueAt(integer(-16494, -16383));
    if (r < 0.8) return valueAt(integer(16300, 16383));
    return valueAt(integer(-16494, 16383));
  };
  return { operand, integer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('the reference agrees with every gcc anchor', () => {
  for (const [op, a, b, want] of ANCHORS) {
    const x = parseHex(a);
    const y = parseHex(b);
    const got = op === '<' ? orderKey(reference.compare(x, y)) : key(OPERATIONS[op][1](x, y));
    expect(got, `reference: ${a} ${op} ${b}`).toBe(op === '<' ? want : key(parseHex(want)));
  }
});

test('the engine agrees with every gcc anchor', () => {
  for (const [op, a, b, want] of ANCHORS) {
    const x = parseHex(a);
    const y = parseHex(b);
    const got = op === '<' ? orderKey(compare(x, y)) : key(OPERATIONS[op][0](x, y));
    expect(got, `engine: ${a} ${op} ${b}`).toBe(op === '<' ? want : key(parseHex(want)));
  }
});

test('the engine agrees with the reference across a seeded sweep', () => {
  const { operand } = generator(0x5EED128);
  const mismatches: string[] = [];
  for (let i = 0; i < 2000; i += 1) {
    const x = operand();
    const y = operand();
    for (const [op, [engine, ref]] of Object.entries(OPERATIONS)) {
      const got = key(engine(x, y));
      const want = key(ref(x, y));
      if (got !== want) mismatches.push(`${key(x)} ${op} ${key(y)}: engine ${got}, reference ${want}`);
    }
    if (orderKey(compare(x, y)) !== orderKey(reference.compare(x, y))) mismatches.push(`${key(x)} < ${key(y)}`);
  }
  expect(mismatches.slice(0, 5)).toEqual([]);
});

test('an integer power is exact, then rounded once, across a seeded sweep', () => {
  const { integer } = generator(0x9095);
  const mismatches: string[] = [];
  for (let i = 0; i < 400; i += 1) {
    const sig = BigInt(integer(1, 0xFFFFFF)) * (integer(0, 1) ? 1n : -1n);
    const base = finite(sig, integer(-40, 40));
    const n = integer(-12, 12);
    const got = key(exponentiate(base, n === 0 ? zero(1) : finite(BigInt(n), 0)));
    const want = key(reference.power(base, n));
    if (got !== want) mismatches.push(`${key(base)} ** ${n}: engine ${got}, reference ${want}`);
  }
  expect(mismatches.slice(0, 5)).toEqual([]);
});

test('the special cases of Number::exponentiate', () => {
  const one = finite(1n, 0);
  const f = (sig: number, exp = 0) => finite(BigInt(sig), exp);
  const cases: [string, Binary128, Binary128, string][] = [
    ['NaN ** 0', NAN, zero(1), key(one)],
    ['1 ** Infinity is NaN in ECMAScript', one, infinity(1), 'nan'],
    ['-1 ** Infinity', f(-1), infinity(1), 'nan'],
    ['0.5 ** Infinity', f(1, -1), infinity(1), '+0'],
    ['-2 ** 0.5', f(-1, 1), f(1, -1), 'nan'],
    ['2 ** 0.5 waits for stage 2', f(1, 1), f(1, -1), 'undefined'],
    ['-0 ** -3', zero(-1), f(-3), '-inf'],
    ['-0 ** 2', zero(-1), f(2), '+0'],
    ['-Infinity ** 3', infinity(-1), f(3), '-inf'],
    ['-Infinity ** -3', infinity(-1), f(-3), '-0'],
    ['-1 ** 3', f(-1), f(3), key(f(-1))],
  ];
  for (const [name, b, e, want] of cases) expect(key(exponentiate(b, e)), name).toBe(want);
});
