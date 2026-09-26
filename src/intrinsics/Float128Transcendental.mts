import {
  finite, zero, infinity, NAN, compare, exponentiate, type Binary128,
} from './Float128Arithmetic.mts';

/**
 * Correctly rounded transcendental functions for binary128 - the float128 plan's
 * B4: every one answers the binary128 value nearest the exact mathematical
 * result, ties to even, the same on every implementation.
 *
 * Ziv's strategy. Each function is evaluated in exact integer arithmetic at a
 * working precision of `p` bits with a CONSERVATIVE error bound, giving an
 * interval that certainly holds the true value. Both ends of the interval are
 * rounded to binary128; where they agree, that is the correctly rounded result.
 * Where they do not, the true value is too near a rounding boundary to decide at
 * this precision, and the evaluation is repeated at twice the precision. For a
 * binary128 argument the results here are irrational except in the exact cases
 * each function answers directly (exp(0), log(1), log2(2**k), log10(10**k)), so
 * the true value is never exactly on a boundary and the loop ends.
 *
 * Pure: no engine objects, no realm, so it is tested on its own.
 */

// ---------------------------------------------------------------------------
// Fixed point: a real r is carried as the BigInt round(r * 2**P).
// ---------------------------------------------------------------------------

const ONE = (P: number) => 1n << BigInt(P);

/** A binary128 value's exact value, as numerator / 2**shift with shift >= 0. */
function exactOf(x: Binary128): { m: bigint, e: number } {
  return { m: x.sig, e: x.exp };
}

/** x * 2**P, truncated toward zero, for x = m * 2**e. */
function toFixed(m: bigint, e: number, P: number): bigint {
  const s = e + P;
  return s >= 0 ? m << BigInt(s) : m / (1n << BigInt(-s));
}

const lnTwoCache = new Map<number, bigint>();
/**
 * ln 2 * 2**P, within one unit: ln 2 = 2 atanh(1/3) = 2 * sum 1 / ((2k+1) 3**(2k+1)).
 */
function lnTwo(P: number): bigint {
  const cached = lnTwoCache.get(P);
  if (cached !== undefined) return cached;
  const G = P + 16;
  const one = ONE(G);
  let power = one / 3n; // (1/3)**(2k+1)
  let sum = 0n;
  for (let k = 0n; power !== 0n; k += 1n) {
    sum += power / (2n * k + 1n);
    power /= 9n;
  }
  const value = (2n * sum) >> 16n;
  lnTwoCache.set(P, value);
  return value;
}

/** ln 10 * 2**P, within a few units: ln 10 = 3 ln 2 + ln(5/4), ln(5/4) = 2 atanh(1/9). */
function lnTen(P: number): bigint {
  const G = P + 16;
  const one = ONE(G);
  let power = one / 9n;
  let sum = 0n;
  for (let k = 0n; power !== 0n; k += 1n) {
    sum += power / (2n * k + 1n);
    power /= 81n;
  }
  return ((3n * lnTwo(G) + 2n * sum) >> 16n);
}

// ---------------------------------------------------------------------------
// Ziv's loop
// ---------------------------------------------------------------------------

/**
 * An approximation `m * 2**e` of a nonzero real, with |error| <= 2**errExp.
 * Undefined where the evaluation at this precision cannot bound the value away
 * from zero, so the caller must try a higher precision.
 */
interface Approximation { m: bigint, e: number, errExp: number }

/** The rounded ends of the interval agree: the correctly rounded value, or undefined. */
function decide(a: Approximation): Binary128 | undefined {
  // The interval [m - u, m + u] * 2**e, u = 2**(errExp - e), made exact by
  // scaling so u is an integer.
  const shift = Math.max(0, a.e - a.errExp);
  const m = a.m << BigInt(shift);
  const e = a.e - shift;
  const u = 1n << BigInt(Math.max(0, a.errExp - e));
  const lo = m - u;
  const hi = m + u;
  if (lo <= 0n && hi >= 0n) return undefined; // straddles zero: the sign is not decided
  const low = finite(lo, e);
  const high = finite(hi, e);
  return compare(low, high) === 0 && low.cls === high.cls && low.sign === high.sign ? low : undefined;
}

/** Run an evaluation at 128, 256, 512 ... bits until the rounding is decided. */
function ziv(evaluate: (p: number) => Approximation): Binary128 {
  for (let p = 160; ; p *= 2) {
    const decided = decide(evaluate(p));
    if (decided) return decided;
    if (p > 1 << 20) throw new Error('float128: a transcendental result could not be decided');
  }
}

// ---------------------------------------------------------------------------
// exp and expm1
// ---------------------------------------------------------------------------

/** exp(x) for a finite x, |x| <= 12000: exp(r) * 2**k, x = k ln 2 + r. */
function expApprox(x: Binary128, p: number): Approximation {
  const { m, e } = exactOf(x);
  const k = Math.round(Number(m) * 2 ** e / Math.LN2);
  const s = Math.ceil(Math.sqrt(p)); // halvings of r before the series
  const P = p + s + 40 + Math.ceil(Math.log2(Math.abs(k) + 2));
  const one = ONE(P);
  // r = x - k ln 2, and r / 2**s, in fixed point.
  let r = toFixed(m, e, P) - BigInt(k) * lnTwo(P);
  r >>= BigInt(s);
  // exp(r / 2**s) by its series, then squared s times.
  let term = one;
  let sum = one;
  for (let n = 1n; term !== 0n; n += 1n) {
    term = (term * r) / (one * n);
    sum += term;
  }
  for (let i = 0; i < s; i += 1) sum = (sum * sum) >> BigInt(P);
  // sum ~ exp(r) * 2**P, within a relative error far below 2**-(p + 8).
  return { m: sum, e: k - P, errExp: k - P + (P - p - 8) + 2 };
}

export function exp(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return x.sign === 1 ? infinity(1) : zero(1);
  if (x.sig === 0n) return finite(1n, 0);
  const approx = Number(x.sig) * 2 ** x.exp;
  if (approx > 11400) return infinity(1); // past binary128's largest finite exp
  if (approx < -11500) return zero(1); // below half its least subnormal
  return ziv((p) => {
    const a = expApprox(x, p);
    // The error bound above is relative to exp(r) ~ 1, i.e. in units of 2**k.
    return a;
  });
}

/** expm1(x) = exp(x) - 1, without the cancellation for small x. */
export function expm1(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return x.sign === 1 ? infinity(1) : finite(-1n, 0);
  if (x.sig === 0n) return x; // expm1(-0) is -0
  const approx = Number(x.sig) * 2 ** x.exp;
  if (approx > 11400) return infinity(1);
  if (approx < -200) return finite(-1n, 0) ; // e**x is below 2**-288: -1 + that rounds to -1
  const small = Math.abs(approx) < 1;
  if (!small) {
    return ziv((p) => {
      const a = expApprox(x, p);
      // exp(x) - 1 with exp(x) >= e**-200 and |exp(x) - 1| >= 1 - e**-1: no severe cancellation.
      // Beyond the working precision (a.e >= 0) the 1 is far below the error bound.
      const oneScaled = a.e < 0 ? 1n << BigInt(-a.e) : 0n;
      return { m: a.m - oneScaled, e: a.e, errExp: a.errExp };
    });
  }
  // |x| < 1: the series sum x**n / n!, n >= 1, whose value is ~x - relative precision.
  return ziv((p) => {
    const { m, e } = exactOf(x);
    const j = Math.max(0, -(e + m.toString(2).length)); // |x| ~ 2**-j
    const P = p + j + 40;
    const one = ONE(P);
    const X = toFixed(m, e, P);
    let term = X;
    let sum = X;
    let terms = 1;
    for (let n = 2n; term !== 0n; n += 1n) {
      term = (term * X) / (one * n);
      sum += term;
      terms += 1;
    }
    // Each term truncates by less than one unit: the error is under `terms` units.
    return { m: sum, e: -P, errExp: -P + Math.ceil(Math.log2(terms + 2)) + 1 };
  });
}

// ---------------------------------------------------------------------------
// log, log1p, log2, log10
// ---------------------------------------------------------------------------

/**
 * ln(x) for x = m * 2**e > 0, not 1: x = f * 2**k with f in [sqrt(1/2), sqrt(2)),
 * ln x = k ln 2 + 2 atanh((f - 1) / (f + 1)). Near x = 1 the working precision
 * grows by the bits cancellation would cost, so the relative precision holds.
 */
function logApprox(m: bigint, e: number, p: number): Approximation {
  const L = m.toString(2).length;
  let k = e + L - 1; // x / 2**k in [1, 2)
  // f > sqrt(2) <=> m**2 > 2**(2(L-1)+1)
  if (m * m > 1n << BigInt(2 * (L - 1) + 1)) k += 1;
  // How close x is to 1: |x - 1| ~ 2**-j, costing j bits to cancellation.
  let j = 0;
  if (k === 0) {
    const diff = e >= 0 ? (m << BigInt(e)) - 1n : m - (1n << BigInt(-e)); // (x - 1) * 2**max(0, -e)
    const scale = e >= 0 ? 0 : -e;
    if (diff !== 0n) j = Math.max(0, scale - (diff < 0n ? -diff : diff).toString(2).length);
  }
  const P = p + j + 48 + Math.ceil(Math.log2(Math.abs(k) + 2));
  const one = ONE(P);
  const F = toFixed(m, e - k, P); // f * 2**P
  const t = ((F - one) * one) / (F + one); // atanh argument, |t| <= 0.172
  const t2 = (t * t) >> BigInt(P);
  let power = t;
  let sum = t;
  let terms = 1;
  for (let n = 1n; power !== 0n; n += 1n) {
    // Division, not `>>`: t may be negative, and `>>` rounds toward minus
    // infinity, so a small negative term would settle at -1 and never reach 0.
    power = (power * t2) / one;
    sum += power / (2n * n + 1n);
    terms += 1;
  }
  const value = BigInt(k) * lnTwo(P) + 2n * sum;
  // t and t2 each carry under a unit of error, and each term adds under two
  // more; doubled, plus |k| + 1 units from k ln 2 - bounded generously.
  const units = 4 * (terms + 2) + Math.abs(k) + 2;
  return { m: value, e: -P, errExp: -P + Math.ceil(Math.log2(units)) + 2 };
}

/** Whether a positive finite value is exactly 1. */
const isOne = (x: Binary128) => x.cls === 'finite' && x.sig === 1n && x.exp === 0;

export function log(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return x.sign === 1 ? infinity(1) : NAN;
  if (x.sig === 0n) return infinity(-1);
  if (x.sig < 0n) return NAN;
  if (isOne(x)) return zero(1);
  return ziv((p) => logApprox(x.sig, x.exp, p));
}

/** log1p(x) = ln(1 + x), with 1 + x formed exactly, so nothing cancels. */
export function log1p(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return x.sign === 1 ? infinity(1) : NAN;
  if (x.sig === 0n) return x; // log1p(-0) is -0
  // 1 + x exactly: x = m * 2**e.
  const e = Math.min(x.exp, 0);
  const m = (x.sig << BigInt(x.exp - e)) + (1n << BigInt(-e));
  if (m < 0n) return NAN;
  if (m === 0n) return infinity(-1);
  return ziv((p) => logApprox(m, e, p));
}

/** Divide an approximation by a constant held in fixed point at 2**P: value / (c / 2**P). */
function divideBy(a: Approximation, c: bigint, P: number, extraErrBits: number): Approximation {
  const m = (a.m << BigInt(P)) / c;
  return { m, e: a.e, errExp: a.errExp + extraErrBits };
}

export function log2(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return x.sign === 1 ? infinity(1) : NAN;
  if (x.sig === 0n) return infinity(-1);
  if (x.sig < 0n) return NAN;
  // Exact at a power of two: the stored significand is odd, so 2**k is sig 1.
  if (x.sig === 1n) return x.exp === 0 ? zero(1) : finite(BigInt(x.exp), 0);
  return ziv((p) => {
    const a = logApprox(x.sig, x.exp, p);
    const P = p + 64;
    return divideBy(a, lnTwo(P), P, 2);
  });
}

export function log10(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return x.sign === 1 ? infinity(1) : NAN;
  if (x.sig === 0n) return infinity(-1);
  if (x.sig < 0n) return NAN;
  if (isOne(x)) return zero(1);
  // Exact at a power of ten that binary128 holds exactly: 10**k = 5**k * 2**k.
  if (x.exp >= 1) {
    let n = x.sig;
    let k = 0;
    while (n % 5n === 0n) {
      n /= 5n;
      k += 1;
    }
    if (n === 1n && k === x.exp) return finite(BigInt(k), 0);
  }
  return ziv((p) => {
    const a = logApprox(x.sig, x.exp, p);
    const P = p + 64;
    return divideBy(a, lnTen(P), P, 2);
  });
}

// ---------------------------------------------------------------------------
// The circular functions: pi, argument reduction, sin, cos, tan, atan, atan2,
// asin, acos.
// ---------------------------------------------------------------------------

/** The integer square root: the largest r with r * r <= n, by Newton's method from above. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let r = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (r + n / r) >> 1n;
    if (next >= r) return r;
    r = next;
  }
}

/** atan(1/n) * 2**G for an integer n > 1, by its alternating series. */
function atanInverse(n: bigint, G: number): bigint {
  let power = ONE(G) / n;
  const n2 = n * n;
  let sum = 0n;
  for (let k = 0n; power !== 0n; k += 1n) {
    const term = power / (2n * k + 1n);
    sum += k % 2n === 0n ? term : -term;
    power /= n2;
  }
  return sum;
}

let piCache: { P: number, value: bigint } | undefined;
/** pi * 2**P within two units - Machin: pi = 16 atan(1/5) - 4 atan(1/239). */
function pi(P: number): bigint {
  if (piCache && piCache.P >= P) return piCache.value >> BigInt(piCache.P - P);
  const G = P + 16;
  const value = (16n * atanInverse(5n, G) - 4n * atanInverse(239n, G)) >> 16n;
  piCache = { P, value };
  return value;
}

/** sin and cos of r = R / 2**P, |r| <= pi/4 + a little, by their series. */
function sinCos(R: bigint, P: number): { sin: bigint, cos: bigint, units: number } {
  const one = ONE(P);
  const r2 = (R * R) / one;
  let terms = 0;
  let term = R;
  let s = R;
  for (let n = 1n; term !== 0n; n += 2n) {
    term = -(term * r2) / (one * (n + 1n) * (n + 2n));
    s += term;
    terms += 1;
  }
  term = one;
  let c = one;
  for (let n = 0n; term !== 0n; n += 2n) {
    term = -(term * r2) / (one * (n + 1n) * (n + 2n));
    c += term;
    terms += 1;
  }
  return { sin: s, cos: c, units: terms + 6 };
}

/**
 * x = q * pi/2 + r for a binary128 x: q, and r * 2**P within about two units.
 * pi carries as many extra bits as x has before its binary point, so even the
 * largest binary128 reduces exactly. A tiny x is not reduced.
 */
function reduce(x: Binary128, P: number): { q: bigint, R: bigint } {
  const { m, e } = exactOf(x);
  const magnitude = e + (m < 0n ? -m : m).toString(2).length; // |x| < 2**magnitude
  if (magnitude <= -1) return { q: 0n, R: toFixed(m, e, P) }; // |x| < 1/2 < pi/4
  const Pr = P + magnitude + 24;
  const X = toFixed(m, e, Pr);
  const halfPi = pi(Pr + 1) >> 2n; // (pi/2) * 2**Pr: pi * 2**(Pr+1) / 4
  const q = X >= 0n ? (2n * X + halfPi) / (2n * halfPi) : -((-2n * X + halfPi) / (2n * halfPi));
  const R = X - q * halfPi;
  return { q, R: R / (1n << BigInt(Pr - P)) };
}

/** The approximation for a fixed-point value V / 2**P with an error of `units` units. */
const fixedApprox = (V: bigint, P: number, units: number): Approximation => ({
  m: V, e: -P, errExp: -P + Math.ceil(Math.log2(units + 1)) + 1,
});

/** Working precision for a result about as small as the argument: j more bits for |x| ~ 2**-j. */
function tinyBits(x: Binary128): number {
  return Math.max(0, -(x.exp + (x.sig < 0n ? -x.sig : x.sig).toString(2).length));
}

function circular(x: Binary128, which: 'sin' | 'cos' | 'tan'): Binary128 {
  if (x.cls === 'nan' || x.cls === 'infinity') return NAN;
  if (x.sig === 0n) return which === 'cos' ? finite(1n, 0) : x; // sin(-0) and tan(-0) are -0
  return ziv((p) => {
    const P = p + 40 + (which === 'cos' ? 0 : tinyBits(x));
    const { q, R } = reduce(x, P);
    const { sin: s, cos: c, units } = sinCos(R, P);
    const quadrant = Number(((q % 4n) + 4n) % 4n);
    if (which === 'sin') return fixedApprox([s, c, -s, -c][quadrant], P, units + 2);
    if (which === 'cos') return fixedApprox([c, -s, -c, s][quadrant], P, units + 2);
    // tan: sin/cos, or -cos/sin in the odd quadrants; the bound follows both parts.
    const [N, D] = quadrant % 2 === 0 ? [s, c] : [-c, s];
    return quotientApprox(N, D, P, units + 2);
  });
}

/**
 * (N / 2**P) / (D / 2**P), each within `units` units: the quotient's error is its
 * size times the two relative errors, plus a unit for the division.
 */
function quotientApprox(N: bigint, D: bigint, P: number, units: number): Approximation {
  const absN = N < 0n ? -N : N;
  const absD = D < 0n ? -D : D;
  if (absD <= BigInt(units) || absN === 0n) return { m: 0n, e: -P, errExp: 1 << 20 }; // not bounded yet
  const Q = (N << BigInt(P)) / D;
  const absQ = Q < 0n ? -Q : Q;
  const u = BigInt(units);
  const err = (absQ * u) / (absN > u ? absN - u : 1n) + (absQ * u) / (absD - u) + 2n;
  return { m: Q, e: -P, errExp: -P + err.toString(2).length + 1 };
}

export const sin = (x: Binary128) => circular(x, 'sin');
export const cos = (x: Binary128) => circular(x, 'cos');
export const tan = (x: Binary128) => circular(x, 'tan');

/**
 * atan(t) * 2**P for t = T / 2**P, 0 <= t <= 1, within the returned units:
 * halved by atan t = 2 atan(t / (1 + sqrt(1 + t**2))) until t <= 1/8, then the
 * alternating series.
 */
function atanFixed(T: bigint, P: number): { value: bigint, units: number } {
  const one = ONE(P);
  let t = T;
  let k = 0;
  while (t > one / 8n && k < 8) {
    const s = isqrt(one * one + t * t);
    t = (t * one) / (one + s);
    k += 1;
  }
  const t2 = (t * t) / one;
  let power = t;
  let sum = t;
  let terms = 1;
  for (let n = 1n; power !== 0n; n += 1n) {
    power = -(power * t2) / one;
    sum += power / (2n * n + 1n);
    terms += 1;
  }
  return { value: sum << BigInt(k), units: (terms + 4 * k + 6) * 2 ** k };
}

/**
 * atan2(y, x) for magnitudes given in fixed point at 2**P - Y, X >= 0 and not
 * both zero, each within `inUnits` - with the signs applied after: the angle in
 * [0, pi/2] from the ratio of the smaller to the larger, then pi - it where x
 * is negative, then the sign of y.
 */
function atan2Fixed(Y: bigint, X: bigint, P: number, inUnits: number, xNegative: boolean, yNegative: boolean): Approximation {
  const one = ONE(P);
  let A: bigint;
  let units: number;
  const halfPi = pi(P + 1) >> 2n;
  if (Y <= X) {
    const T = (Y * one) / X;
    const r = atanFixed(T, P);
    A = r.value;
    units = r.units + inUnits * 4 + 2;
  } else {
    const T = (X * one) / Y;
    const r = atanFixed(T, P);
    A = halfPi - r.value;
    units = r.units + inUnits * 4 + 4;
  }
  if (xNegative) {
    A = pi(P) - A;
    units += 2;
  }
  return fixedApprox(yNegative ? -A : A, P, units);
}

/** A binary128 value's magnitude in fixed point at 2**P. */
const magnitudeFixed = (v: Binary128, P: number) => toFixed(v.sig < 0n ? -v.sig : v.sig, v.exp, P);

export function atan(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.sig === 0n && x.cls === 'finite') return x;
  if (x.cls === 'infinity') {
    return ziv((p) => {
      const P = p + 40;
      const halfPi = pi(P + 1) >> 2n;
      return fixedApprox(x.sign === 1 ? halfPi : -halfPi, P, 4);
    });
  }
  const negative = x.sig < 0n;
  return ziv((p) => {
    const P = p + 48 + tinyBits(x);
    const X = magnitudeFixed(x, P);
    return atan2Fixed(X, ONE(P), P, 1, false, negative);
  });
}

export function atan2(y: Binary128, x: Binary128): Binary128 {
  if (y.cls === 'nan' || x.cls === 'nan') return NAN;
  const yNeg = y.cls === 'finite' && y.sig !== 0n ? y.sig < 0n : y.sign === -1;
  const xNeg = x.cls === 'finite' && x.sig !== 0n ? x.sig < 0n : x.sign === -1;
  const angle = (numerator: bigint, denominator: bigint) => ziv((p) => {
    const P = p + 40;
    // numerator/denominator quarters of pi: pi * 2**(P+2) * n / (16 d) = (n/d) * (pi/4) * 2**P.
    const v = (pi(P + 2) * numerator) / (denominator * 16n);
    return fixedApprox(yNeg ? -v : v, P, 4);
  });
  const yZero = y.cls === 'finite' && y.sig === 0n;
  const xZero = x.cls === 'finite' && x.sig === 0n;
  if (yZero) return xNeg ? angle(4n, 1n) : zero(yNeg ? -1 : 1); // +-pi, or +-0
  if (xZero) return angle(2n, 1n); // +-pi/2
  if (y.cls === 'infinity') {
    if (x.cls === 'infinity') return angle(xNeg ? 3n : 1n, 1n); // +-3pi/4, +-pi/4
    return angle(2n, 1n);
  }
  if (x.cls === 'infinity') return xNeg ? angle(4n, 1n) : zero(yNeg ? -1 : 1);
  return ziv((p) => {
    // A tiny angle - |y| much smaller than x > 0 - needs the bits it is below 1.
    const gap = xNeg ? 0 : Math.max(0, (x.exp + x.sig.toString(2).length) - (y.exp + y.sig.toString(2).length));
    const P = p + 48 + gap;
    // The ratio of the two exact values is what matters, so both are scaled to
    // a common exponent before going to fixed point.
    const shift = Math.min(x.exp, y.exp);
    const Y = toFixed(y.sig < 0n ? -y.sig : y.sig, y.exp - shift, 0);
    const X = toFixed(x.sig < 0n ? -x.sig : x.sig, x.exp - shift, 0);
    const scale = BigInt(P);
    return atan2Fixed(Y << scale, X << scale, P, 0, xNeg, yNeg);
  });
}

/** asin and acos, both through atan2 with sqrt(1 - x**2) from an EXACT 1 - x**2. */
function arcsine(x: Binary128, which: 'asin' | 'acos'): Binary128 {
  if (x.cls === 'nan' || x.cls === 'infinity') return NAN;
  if (x.sig === 0n) return which === 'asin' ? x : ziv((p) => fixedApprox(pi(p + 41) >> 2n, p + 40, 4));
  const negative = x.sig < 0n;
  const a = negative ? -x.sig : x.sig;
  // |x| = a * 2**e; 1 - x**2 = (2**(-2e) - a**2) * 2**(2e), exact.
  const e = x.exp;
  if (e >= 0) {
    if (a === 1n && e === 0) {
      if (which === 'asin') {
        return ziv((p) => {
          const P = p + 40;
          const halfPi = pi(P + 1) >> 2n;
          return fixedApprox(negative ? -halfPi : halfPi, P, 4);
        });
      }
      return negative ? ziv((p) => fixedApprox(pi(p + 40), p + 40, 4)) : zero(1);
    }
    return NAN; // |x| > 1
  }
  const oneMinus = (1n << BigInt(-2 * e)) - a * a; // (1 - x**2) * 2**(-2e)
  if (oneMinus < 0n) return NAN;
  return ziv((p) => {
    // 1 - x**2 ~ 2**-g: its square root is ~2**(-g/2), which the angle is for acos near 1.
    const g = Math.max(0, -2 * e - oneMinus.toString(2).length);
    const P = p + 48 + (which === 'asin' ? tinyBits(x) : (negative ? 0 : Math.ceil(g / 2)));
    // sqrt(1 - x**2) * 2**P, within a unit; the scaling shift may be negative for a tiny x.
    const shift = 2 * P + 2 * e;
    const S = isqrt(shift >= 0 ? oneMinus << BigInt(shift) : oneMinus >> BigInt(-shift));
    const X = toFixed(a, e, P);
    return which === 'asin'
      ? atan2Fixed(X, S, P, 1, false, negative)
      : atan2Fixed(S, X, P, 1, negative, false);
  });
}

export const asin = (x: Binary128) => arcsine(x, 'asin');
export const acos = (x: Binary128) => arcsine(x, 'acos');

// ---------------------------------------------------------------------------
// The hyperbolic functions and their inverses, and pow with a non-integer
// exponent.
// ---------------------------------------------------------------------------

/**
 * exp(z) for z = Z / 2**P, within `zUnits` units of the argument: the same
 * reduction and series as expApprox, for an argument that is itself an
 * approximation (pow's y ln x). The argument's error becomes a relative error
 * of the result of zUnits * 2**-P, which the bound carries.
 */
function expFixed(Z: bigint, P: number, zUnits: number): Approximation {
  const approxZ = Number(Z >> BigInt(Math.max(0, P - 60))) * 2 ** -Math.min(P, 60);
  const k = Math.round(approxZ / Math.LN2);
  const s = Math.ceil(Math.sqrt(P));
  const W = P + s + 40 + Math.ceil(Math.log2(Math.abs(k) + 2));
  const one = ONE(W);
  let r = (Z << BigInt(W - P)) - BigInt(k) * lnTwo(W);
  r /= 1n << BigInt(s);
  let term = one;
  let sum = one;
  for (let n = 1n; term !== 0n; n += 1n) {
    term = (term * r) / (one * n);
    sum += term;
  }
  for (let i = 0; i < s; i += 1) sum = (sum * sum) >> BigInt(W);
  // Internal error far below a unit at 2**-P; the argument's error dominates.
  return { m: sum, e: k - W, errExp: k - P + Math.ceil(Math.log2(zUnits + 2)) + 2 };
}

/** e**|x| and e**-|x| at one exponent: { big, small } in units of 2**e, and the error there. */
function expPair(x: Binary128, p: number): { big: bigint, small: bigint, e: number, errExp: number } {
  const ax: Binary128 = { ...x, sign: 1, sig: x.sig < 0n ? -x.sig : x.sig };
  const a = expApprox(ax, p + 20);
  // e**-|x| = 1 / (m * 2**e), in units of 2**e: 2**(-2e) / m - nothing where that is below a unit.
  const small = a.e < 0 ? (1n << BigInt(-2 * a.e)) / a.m : 0n;
  return { big: a.m, small, e: a.e, errExp: a.errExp + 1 };
}

/** sinh of |x| < 1/2 by its odd series, at relative precision: sum x**(2n+1) / (2n+1)!. */
function sinhSmall(x: Binary128, P: number): { value: bigint, units: number } {
  const one = ONE(P);
  const X = toFixed(x.sig, x.exp, P);
  const x2 = (X * X) / one;
  let term = X;
  let sum = X;
  let terms = 1;
  for (let n = 1n; term !== 0n; n += 2n) {
    term = (term * x2) / (one * (n + 1n) * (n + 2n));
    sum += term;
    terms += 1;
  }
  return { value: sum, units: terms + 2 };
}

const isSmall = (x: Binary128) => x.exp + (x.sig < 0n ? -x.sig : x.sig).toString(2).length <= -1; // |x| < 1/2

export function sinh(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity' || x.sig === 0n) return x;
  if (Math.abs(Number(x.sig) * 2 ** x.exp) > 11400) return infinity(x.sig < 0n ? -1 : 1);
  if (isSmall(x)) {
    return ziv((p) => {
      const P = p + 40 + tinyBits(x);
      const r = sinhSmall(x, P);
      return fixedApprox(r.value, P, r.units);
    });
  }
  return ziv((p) => {
    const { big, small, e, errExp } = expPair(x, p);
    const v = (big - small) / 2n;
    return { m: x.sig < 0n ? -v : v, e, errExp };
  });
}

export function cosh(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return infinity(1);
  if (x.sig === 0n) return finite(1n, 0);
  if (Math.abs(Number(x.sig) * 2 ** x.exp) > 11400) return infinity(1);
  return ziv((p) => {
    const { big, small, e, errExp } = expPair(x, p);
    return { m: (big + small) / 2n, e, errExp };
  });
}

export function tanh(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return finite(x.sign === 1 ? 1n : -1n, 0);
  if (x.sig === 0n) return x;
  const negative = x.sig < 0n;
  if (Math.abs(Number(x.sig) * 2 ** x.exp) > 200) return finite(negative ? -1n : 1n, 0); // 1 - 2e**-400 rounds to 1
  return ziv((p) => {
    const P = p + 48 + tinyBits(x);
    if (isSmall(x)) {
      const s = sinhSmall(x, P);
      const c = expPair(x, P);
      // cosh in fixed point at 2**P from its value at 2**e.
      const shift = c.e + P;
      const C = shift >= 0 ? (c.big + c.small) << BigInt(shift) : (c.big + c.small) / (1n << BigInt(-shift));
      return quotientApprox(s.value, C / 2n, P, s.units + 4);
    }
    const c = expPair(x, P);
    const N = c.big - c.small;
    const D = c.big + c.small;
    // The ratio is scale-free; it is taken at the loop's precision.
    return quotientApprox(negative ? -N : N, D, P, 4);
  });
}

/** ln(value) for a positive fixed-point value V / 2**P carried with `units` of error. */
function logOfFixed(V: bigint, P: number, units: number, p: number): Approximation {
  const a = logApprox(V, -P, p);
  // d ln v = dv / v: the input's error, relative to V, as an absolute error.
  const extra = units === 0 ? 0n : (BigInt(units) << BigInt(Math.max(0, P + 2))) / V;
  const errUnits = (1n << BigInt(Math.max(0, a.errExp + P))) + extra;
  return { m: a.m, e: a.e, errExp: Math.max(a.errExp, -P + errUnits.toString(2).length + 1) };
}

export function asinh(x: Binary128): Binary128 {
  if (x.cls === 'nan' || x.cls === 'infinity' || x.sig === 0n) return x;
  const negative = x.sig < 0n;
  const a = negative ? -x.sig : x.sig;
  const signed = (r: Approximation) => (negative ? { ...r, m: -r.m } : r);
  return ziv((p) => {
    const P = p + 48 + tinyBits(x);
    const one = ONE(P);
    const magnitude = x.exp + a.toString(2).length;
    if (magnitude > P / 2 + 8) {
      // |x| is so large that sqrt(x**2 + 1) = |x| within 2**-P: ln(2|x|).
      // 2|x| is exact; what is neglected, about 1/(4 x**2), is below 2**-(P+16).
      return signed(logOfFixed(a << 1n, -x.exp, 0, p));
    }
    const X = toFixed(a, x.exp, P);
    const S = isqrt(X * X + one * one); // sqrt(x**2 + 1) * 2**P
    if (isSmall(x)) {
      // log1p(|x| + x**2 / (1 + sqrt(1 + x**2))), nothing cancelling.
      const W = X + (X * X) / (one + S);
      return signed(logOfFixed(one + W, P, 4, p));
    }
    return signed(logOfFixed(X + S, P, 4, p));
  });
}

export function acosh(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'infinity') return x.sign === 1 ? infinity(1) : NAN;
  if (x.sig <= 0n) return NAN;
  if (isOne(x)) return zero(1);
  const e = x.exp;
  const a = x.sig;
  if (e >= 0 ? false : a < (1n << BigInt(-e))) return NAN; // x < 1
  return ziv((p) => {
    const magnitude = e + a.toString(2).length;
    // Near 1, acosh(1 + t) ~ sqrt(2t): half of t's bits below 1 more.
    const tBits = e < 0 ? Math.max(0, -e - (a - (1n << BigInt(-e))).toString(2).length) : 0;
    const P = p + 48 + Math.ceil(tBits / 2);
    const one = ONE(P);
    if (magnitude > P / 2 + 8) return logOfFixed(a << 1n, -e, 0, p); // ln(2x): exact input, 1/(4x**2) neglected
    const X = toFixed(a, e, P);
    const T = X - one; // x - 1, exact for x near 1 at this precision
    if (magnitude <= 1) {
      // log1p(t + sqrt(2t + t**2)), t = x - 1: nothing cancelling.
      const S = isqrt(2n * T * one + T * T);
      return logOfFixed(one + T + S, P, 4, p);
    }
    const S = isqrt(X * X - one * one);
    return logOfFixed(X + S, P, 4, p);
  });
}

export function atanh(x: Binary128): Binary128 {
  if (x.cls === 'nan' || x.cls === 'infinity') return NAN;
  if (x.sig === 0n) return x;
  const negative = x.sig < 0n;
  const a = negative ? -x.sig : x.sig;
  const e = x.exp;
  if (e >= 0) return a === 1n && e === 0 ? infinity(negative ? -1 : 1) : NAN;
  const oneMinus = (1n << BigInt(-e)) - a; // (1 - |x|) * 2**(-e), exact
  if (oneMinus < 0n) return NAN;
  return ziv((p) => {
    const P = p + 48 + tinyBits(x);
    const one = ONE(P);
    // atanh|x| = ln((1 + |x|) / (1 - |x|)) / 2 = log1p(2|x| / (1 - |x|)) / 2.
    const R = ((2n * a) << BigInt(P)) / oneMinus;
    const l = logOfFixed(one + R, P, 1, p);
    return { m: negative ? -l.m : l.m, e: l.e - 1, errExp: l.errExp - 1 };
  });
}

/**
 * x ** y for a finite x > 0 and a finite y with no exact route: exp(y ln x),
 * correctly rounded. The working precision grows by the size of y ln x, whose
 * absolute error becomes the result's relative error.
 */
export function powTranscendental(x: Binary128, y: Binary128): Binary128 {
  const lx = Math.log2(Number(x.sig)) + x.exp; // log2 x, roughly
  const ylx = Number(y.sig) * 2 ** y.exp * lx * Math.LN2; // y ln x, roughly
  if (ylx > 11400) return infinity(1);
  if (ylx < -11500) return zero(1);
  return ziv((p) => {
    const grow = Math.ceil(Math.log2(Math.abs(ylx) + 2)) + Math.max(0, y.exp + y.sig.toString(2).length);
    const P = p + 48 + grow;
    const L = logApprox(x.sig, x.exp, P); // ln x at 2**L.e, within 2**L.errExp
    // z = y * ln x in fixed point at 2**P.
    const shift = y.exp + L.e + P;
    const prod = y.sig * L.m;
    const Z = shift >= 0 ? prod << BigInt(shift) : prod / (1n << BigInt(-shift));
    const yAbs = y.sig < 0n ? -y.sig : y.sig;
    const zErrExp = y.exp + L.errExp + yAbs.toString(2).length + P; // log2 of Z's error in units
    return expFixed(Z, P, 2 ** Math.min(Math.max(zErrExp, 0), 1000) + 2);
  });
}

/**
 * `**` and Math.pow on float128: the exact route where there is one
 * (Float128Arithmetic.exponentiate - the special cases, and an integer exponent
 * computed exactly), and otherwise exp(y ln |x|), correctly rounded: a positive
 * base to a non-integer power, or an integer power too large to compute
 * exactly, whose sign is (-1)**y.
 */
export function pow(x: Binary128, y: Binary128): Binary128 {
  const exact = exponentiate(x, y);
  if (exact !== undefined) return exact;
  const negative = x.sig < 0n;
  const magnitude = powTranscendental(negative ? { ...x, sign: 1, sig: -x.sig } : x, y);
  const oddInteger = y.cls === 'finite' && y.sig !== 0n && y.exp === 0 && (y.sig & 1n) === 1n;
  if (!negative || !oddInteger) return magnitude;
  if (magnitude.cls === 'nan') return magnitude;
  if (magnitude.cls === 'infinity') return infinity(-1);
  return magnitude.sig === 0n ? zero(-1) : { ...magnitude, sign: -1, sig: -magnitude.sig };
}
