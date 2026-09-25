import { roundRationalToBinaryFloat } from './BinaryFloatRounding.mts';

/**
 * binary128 arithmetic on plain data - no engine objects, no realm - so it can
 * be read, and tested against an external reference, on its own. Float128.mts
 * wraps these in the engine's float128 objects.
 *
 * #sec-which-operations-each-family-defines gives a binary float unaryMinus,
 * exponentiate, multiply, divide, remainder, add, subtract, lessThan, equal,
 * sameValue, sameValueZero and toString. Each operation here computes its result
 * EXACTLY on the operands' significands and exponents and rounds it once, in
 * roundToFormat - so each is correctly rounded, as IEEE 754 requires of these
 * operations. Special values follow IEEE 754 and ECMAScript's Number operations.
 */

/** A binary128 value: finite - significand x 2**exponent, with a sign for zero - an infinity, or NaN. */
export interface Binary128 {
  readonly cls: 'finite' | 'infinity' | 'nan';
  readonly sign: -1 | 1;
  readonly sig: bigint;
  readonly exp: number;
}

/** binary128: 113 bits of significand, and an exponent range from the format. */
export const SIGNIFICAND_BITS = 113;
export const MAX_EXPONENT = 16383;
export const MIN_EXPONENT = -16382;

/**
 * Round an exact pair to the format: at most 113 significant bits, ties to
 * even, with overflow to an infinity and underflow to a subnormal or a zero.
 *
 * The rounding is the only place this file is not exact, and it is where the
 * format is actually imposed - a pair that fits is returned unchanged.
 */
export function roundToFormat(significand: bigint, exponent: number): { significand: bigint, exponent: number, overflow: boolean } {
  if (significand === 0n) {
    return { significand: 0n, exponent: 0, overflow: false };
  }
  const negative = significand < 0n;
  let s = negative ? -significand : significand;
  let e = exponent;
  // The exponent of the LAST significand bit the format keeps. A normal value
  // keeps 113 bits below its leading one; a subnormal - leading bit below
  // 2**-16382 - keeps only the bits down to 2**-16494, the smallest subnormal's,
  // so it rounds to that coarser grid. Keeping 113 bits at every magnitude, as
  // this did, made a subnormal more precise than the format can hold, and a
  // value near the smallest subnormal was flushed to zero by a threshold test
  // instead of rounded to its nearest neighbour.
  const leading = e + s.toString(2).length - 1;
  const last = Math.max(leading, MIN_EXPONENT) - (SIGNIFICAND_BITS - 1);
  if (e < last) {
    // Round to a multiple of 2**last, nearest, ties to even.
    const drop = BigInt(last - e);
    const keep = s >> drop;
    const rest = s - (keep << drop);
    const half = 1n << (drop - 1n);
    s = keep;
    e = last;
    if (rest > half || (rest === half && (keep & 1n) === 1n)) {
      s += 1n;
    }
  }
  if (s === 0n) {
    return { significand: 0n, exponent: 0, overflow: false };
  }
  // Normalize away trailing zeros so one value has one representation, which is
  // what lets equality be a comparison of the pair. (A carry out of the rounding
  // is absorbed here too: it only adds a trailing zero below a new leading bit.)
  while ((s & 1n) === 0n) {
    s >>= 1n;
    e += 1;
  }
  if (e + s.toString(2).length - 1 > MAX_EXPONENT) {
    return { significand: 0n, exponent: 0, overflow: true };
  }
  return { significand: negative ? -s : s, exponent: e, overflow: false };
}

export const NAN: Binary128 = { cls: 'nan', sign: 1, sig: 0n, exp: 0 };
export const infinity = (sign: -1 | 1): Binary128 => ({ cls: 'infinity', sign, sig: 0n, exp: 0 });
export const zero = (sign: -1 | 1): Binary128 => ({ cls: 'finite', sign, sig: 0n, exp: 0 });

/** The exact value significand x 2**exponent, rounded once to the format. */
export function finite(significand: bigint, exponent: number): Binary128 {
  const r = roundToFormat(significand, exponent);
  const sign = significand < 0n ? -1 : 1;
  if (r.overflow) return infinity(sign);
  return r.significand === 0n ? zero(sign) : { cls: 'finite', sign, sig: r.significand, exp: r.exponent };
}

const isZero = (x: Binary128) => x.cls === 'finite' && x.sig === 0n;

export function negate(x: Binary128): Binary128 {
  if (x.cls === 'nan') return x;
  if (x.cls === 'infinity') return infinity(x.sign === 1 ? -1 : 1);
  return isZero(x) ? zero(x.sign === 1 ? -1 : 1) : { ...x, sign: x.sign === 1 ? -1 : 1, sig: -x.sig };
}

export function add(x: Binary128, y: Binary128): Binary128 {
  if (x.cls === 'nan' || y.cls === 'nan') return NAN;
  if (x.cls === 'infinity' || y.cls === 'infinity') {
    // An infinity minus itself is NaN.
    if (x.cls === 'infinity' && y.cls === 'infinity' && x.sign !== y.sign) return NAN;
    return x.cls === 'infinity' ? x : y;
  }
  // -0 + -0 is -0; any other sum of zeroes is +0.
  if (isZero(x) && isZero(y)) return zero(x.sign === -1 && y.sign === -1 ? -1 : 1);
  const e = Math.min(x.exp, y.exp);
  const sum = (x.sig << BigInt(x.exp - e)) + (y.sig << BigInt(y.exp - e));
  // An exact cancellation is +0 under round-to-nearest.
  return sum === 0n ? zero(1) : finite(sum, e);
}

export function subtract(x: Binary128, y: Binary128): Binary128 {
  return add(x, negate(y));
}

export function multiply(x: Binary128, y: Binary128): Binary128 {
  if (x.cls === 'nan' || y.cls === 'nan') return NAN;
  const sign = (x.sign * y.sign) as -1 | 1;
  // 0 x infinity is NaN.
  if (x.cls === 'infinity' || y.cls === 'infinity') return isZero(x) || isZero(y) ? NAN : infinity(sign);
  if (isZero(x) || isZero(y)) return zero(sign);
  return finite(x.sig * y.sig, x.exp + y.exp);
}

export function divide(x: Binary128, y: Binary128): Binary128 {
  if (x.cls === 'nan' || y.cls === 'nan') return NAN;
  const sign = (x.sign * y.sign) as -1 | 1;
  if (x.cls === 'infinity') return y.cls === 'infinity' ? NAN : infinity(sign);
  if (y.cls === 'infinity') return zero(sign);
  if (isZero(y)) return isZero(x) ? NAN : infinity(sign);
  if (isZero(x)) return zero(sign);
  return quotient(x.sig, x.exp, y.sig, y.exp);
}

/**
 * (aSig x 2**aExp) / (bSig x 2**bExp), both nonzero, correctly rounded. The exact
 * quotient to at least 117 bits, then one STICKY bit below them recording whether
 * anything remained: rounding sees every bit it needs - the kept bits, the
 * rounding bit, and whether the rest is zero - so rounding this truncated
 * quotient gives the correctly rounded quotient, subnormal or not. The operands
 * need not be in the format: exponentiation divides by an exact power.
 */
function quotient(aSig: bigint, aExp: number, bSig: bigint, bExp: number): Binary128 {
  const negative = (aSig < 0n) !== (bSig < 0n);
  const a = aSig < 0n ? -aSig : aSig;
  const b = bSig < 0n ? -bSig : bSig;
  const shift = Math.max(0, b.toString(2).length - a.toString(2).length + 117);
  const n = a << BigInt(shift);
  const q = n / b;
  const sticky = n % b === 0n ? 0n : 1n;
  const significand = (q << 1n) | sticky;
  return finite(negative ? -significand : significand, aExp - bExp - shift - 1);
}

/** `%`: the truncated remainder, with the dividend's sign. Exact - never rounded. */
export function remainder(x: Binary128, y: Binary128): Binary128 {
  if (x.cls !== 'finite' || y.cls === 'nan' || isZero(y)) return NAN;
  if (y.cls === 'infinity' || isZero(x)) return x;
  const e = Math.min(x.exp, y.exp);
  const r = (x.sig << BigInt(x.exp - e)) % (y.sig << BigInt(y.exp - e));
  return r === 0n ? zero(x.sign) : finite(r, e);
}

/** -1, 0 or 1, or undefined where either is NaN. The two zeroes compare equal. */
export function compare(x: Binary128, y: Binary128): -1 | 0 | 1 | undefined {
  if (x.cls === 'nan' || y.cls === 'nan') return undefined;
  const rank = (v: Binary128) => (v.cls === 'infinity' ? v.sign * 2 : 0);
  if (rank(x) !== 0 || rank(y) !== 0) return rank(x) === rank(y) ? 0 : (rank(x) < rank(y) ? -1 : 1);
  const e = Math.min(x.exp, y.exp);
  const a = x.sig << BigInt(x.exp - e);
  const b = y.sig << BigInt(y.exp - e);
  return a === b ? 0 : (a < b ? -1 : 1);
}

/** Whether a value is a finite integer. A finite value is stored with an odd significand, so it is one exactly when its exponent is not negative. */
function isInteger(x: Binary128): boolean {
  return x.cls === 'finite' && (x.sig === 0n || x.exp >= 0);
}

/** Whether a value is an odd integer: odd significand, exponent zero. */
function isOddInteger(x: Binary128): boolean {
  return x.cls === 'finite' && x.sig !== 0n && x.exp === 0;
}

/** Exact results larger than this many bits are left to stage 2, not computed. */
const EXACT_POWER_LIMIT = 1 << 20;

/**
 * `**`, following Number::exponentiate's special cases - including that
 * `1 ** Infinity` is NaN in ECMAScript, where IEEE 754's pow gives 1.
 *
 * An INTEGER exponent is computed exactly and rounded once, so the result is
 * correctly rounded; certain overflow and underflow are decided from bounds on
 * the result's magnitude without computing it. UNDEFINED where the result cannot
 * be had that way - a non-integer exponent of a positive base, which needs a
 * transcendental function, or an exact power past EXACT_POWER_LIMIT bits (a base
 * near 1 with a huge exponent). Both are stage 2's; the caller refuses them by
 * name rather than return a value that is not correctly rounded.
 */
export function exponentiate(base: Binary128, exponent: Binary128): Binary128 | undefined {
  if (exponent.cls === 'nan') return NAN;
  if (isZero(exponent)) return finite(1n, 0);
  if (base.cls === 'nan') return NAN;
  const positive = exponent.cls === 'infinity' ? exponent.sign === 1 : exponent.sig > 0n;
  if (base.cls === 'infinity') {
    if (base.sign === 1) return positive ? infinity(1) : zero(1);
    return positive ? infinity(isOddInteger(exponent) ? -1 : 1) : zero(isOddInteger(exponent) ? -1 : 1);
  }
  if (isZero(base)) {
    if (base.sign === 1) return positive ? zero(1) : infinity(1);
    return positive ? zero(isOddInteger(exponent) ? -1 : 1) : infinity(isOddInteger(exponent) ? -1 : 1);
  }
  const magnitude = compare(base.sig < 0n ? negate(base) : base, finite(1n, 0))!;
  if (exponent.cls === 'infinity') {
    if (magnitude === 0) return NAN;
    return (magnitude > 0) === positive ? infinity(1) : zero(1);
  }
  if (!isInteger(exponent)) {
    // A negative base to a non-integer power is NaN; a positive one is stage 2's.
    return base.sig < 0n ? NAN : undefined;
  }
  const n = exponent.sig << BigInt(exponent.exp);
  const count = n < 0n ? -n : n;
  const resultSign: -1 | 1 = base.sig < 0n && (count & 1n) === 1n ? -1 : 1;
  const a = base.sig < 0n ? -base.sig : base.sig;
  if (a === 1n && base.exp === 0) return finite(BigInt(resultSign), 0); // |base| is 1
  // log2|base| lies in [lead, lead + 1), where lead is the leading bit's exponent.
  const lead = BigInt(base.exp + a.toString(2).length - 1);
  const low = n > 0n ? count * lead : -count * (lead + 1n);
  const high = n > 0n ? count * (lead + 1n) : -count * lead;
  if (low > BigInt(MAX_EXPONENT)) return infinity(resultSign);
  if (high <= BigInt(MIN_EXPONENT - SIGNIFICAND_BITS)) return zero(resultSign);
  if (count * BigInt(a.toString(2).length) > BigInt(EXACT_POWER_LIMIT)) return undefined;
  const power = (resultSign === -1 ? -1n : 1n) * a ** count;
  const powerExp = base.exp * Number(count);
  return n > 0n ? finite(power, powerExp) : quotient(1n, 0, power, powerExp);
}

/** significand x 10**exponent - a decimal literal's exact value - rounded once to binary128. */
export function fromDecimal(significand: bigint, exponent: number): Binary128 {
  if (significand === 0n) return zero(1);
  return exponent >= 0
    ? finite(significand * 10n ** BigInt(exponent), 0)
    : quotient(significand, 0, 10n ** BigInt(-exponent), 0);
}

/** numerator / denominator (denominator > 0), exactly a rational, rounded once to binary128. */
export function fromRational(numerator: bigint, denominator: bigint): Binary128 {
  return numerator === 0n ? zero(1) : quotient(numerator, 0, denominator, 0);
}

/** The value truncated toward zero, exactly; undefined for NaN and the infinities. */
export function truncate(x: Binary128): bigint | undefined {
  if (x.cls !== 'finite') return undefined;
  if (x.exp >= 0) return x.sig << BigInt(x.exp);
  return x.sig / (1n << BigInt(-x.exp)); // BigInt division truncates toward zero
}

/** The value rounded ONCE to binary16, binary32 or binary64, as a Number. */
export function toBinaryFloat(x: Binary128, width: 16 | 32 | 64): number {
  if (x.cls === 'nan') return NaN;
  if (x.cls === 'infinity') return x.sign === -1 ? -Infinity : Infinity;
  if (x.sig === 0n) return x.sign === -1 ? -0 : 0;
  return x.exp >= 0
    ? roundRationalToBinaryFloat(x.sig << BigInt(x.exp), 1n, width)
    : roundRationalToBinaryFloat(x.sig, 1n << BigInt(-x.exp), width);
}

// ---------------------------------------------------------------------------
// Math. The exact functions need no rounding; sqrt, cbrt and hypot are computed
// through EXACT integer roots with a sticky bit and rounded once, so each is
// correctly rounded, as IEEE 754 requires of square root.
// ---------------------------------------------------------------------------

/** floor of the exact value significand x 2**exponent, as a BigInt. */
function floorOfPair(sig: bigint, exp: number): bigint {
  if (exp >= 0) return sig << BigInt(exp);
  const d = 1n << BigInt(-exp);
  const q = sig / d; // truncates toward zero
  return sig < 0n && q * d !== sig ? q - 1n : q;
}

/** Math.floor, Math.ceil, Math.trunc and Math.round - exact, zero signs as for a Number. */
export function roundToInteger(x: Binary128, mode: 'floor' | 'ceil' | 'trunc' | 'round'): Binary128 {
  if (x.cls !== 'finite' || x.sig === 0n || x.exp >= 0) return x; // already an integer, or special
  const negative = x.sig < 0n;
  let n: bigint;
  if (mode === 'floor') n = floorOfPair(x.sig, x.exp);
  else if (mode === 'ceil') n = -floorOfPair(-x.sig, x.exp);
  else if (mode === 'trunc') n = x.sig / (1n << BigInt(-x.exp));
  else n = floorOfPair((x.sig << 1n) + (1n << BigInt(-x.exp)), x.exp - 1); // floor(x + 1/2): halves toward +Infinity
  // A zero result keeps the operand's sign, as Math.ceil(-0.5) and Math.round(-0.25) are -0.
  return n === 0n ? zero(negative ? -1 : 1) : finite(n, 0);
}

/**
 * The integer square root: the largest r with r * r <= n. Newton's method started
 * ABOVE the root, at 2**ceil(bits/2), decreases monotonically to it. (Seeded from
 * a double's estimate it could start ~2**64 BELOW a 234-bit operand's root, where
 * Newton stops at once and a unit-step correction never finishes.)
 */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let r = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (r + n / r) >> 1n;
    if (next >= r) return r;
    r = next;
  }
}

/** The integer cube root of n >= 0: the largest r with r**3 <= n. */
function icbrt(n: bigint): bigint {
  if (n < 2n) return n;
  let r = 1n << BigInt(Math.ceil(n.toString(2).length / 3));
  for (;;) {
    const next = (2n * r + n / (r * r)) / 3n;
    if (next >= r) break;
    r = next;
  }
  while (r * r * r > n) r -= 1n;
  while ((r + 1n) ** 3n <= n) r += 1n;
  return r;
}

/**
 * The k-th root (k = 2 or 3) of sig x 2**exp, sig > 0, correctly rounded: the
 * exponent is made a multiple of k, the significand widened so the root has at
 * least 117 bits, and a sticky bit records any remainder - as for division.
 */
function rootOfPair(sig: bigint, exp: number, k: 2 | 3): Binary128 {
  let s = sig;
  let e = exp;
  const r = ((e % k) + k) % k;
  if (r !== 0) {
    s <<= BigInt(r);
    e -= r;
  }
  const want = 117 * k;
  const bits = s.toString(2).length;
  const widen = Math.max(0, Math.ceil((want - bits) / k)) * k;
  s <<= BigInt(widen);
  e -= widen;
  const root = k === 2 ? isqrt(s) : icbrt(s);
  const sticky = (k === 2 ? root * root : root ** 3n) === s ? 0n : 1n;
  return finite((root << 1n) | sticky, e / k - 1);
}

export function sqrt(x: Binary128): Binary128 {
  if (x.cls === 'nan') return NAN;
  if (x.cls === 'finite' && x.sig === 0n) return x; // sqrt(-0) is -0
  if (x.sign === -1 && x.cls === 'infinity') return NAN;
  if (x.cls === 'finite' && x.sig < 0n) return NAN;
  if (x.cls === 'infinity') return x;
  return rootOfPair(x.sig, x.exp, 2);
}

export function cbrt(x: Binary128): Binary128 {
  if (x.cls !== 'finite' || x.sig === 0n) return x; // NaN, the infinities and the zeroes are their own cube roots
  const r = rootOfPair(x.sig < 0n ? -x.sig : x.sig, x.exp, 3);
  return x.sig < 0n ? negate(r) : r;
}

/** Math.hypot: an infinity wins over NaN; otherwise the square root of the exact sum of squares. */
export function hypot(xs: readonly Binary128[]): Binary128 {
  if (xs.some((x) => x.cls === 'infinity')) return infinity(1);
  if (xs.some((x) => x.cls === 'nan')) return NAN;
  const nonzero = xs.filter((x) => x.sig !== 0n);
  if (nonzero.length === 0) return zero(1);
  const e = Math.min(...nonzero.map((x) => 2 * x.exp));
  const sum = nonzero.reduce((acc, x) => acc + ((x.sig * x.sig) << BigInt(2 * x.exp - e)), 0n);
  return rootOfPair(sum, e, 2);
}

// ---------------------------------------------------------------------------
// toString: the SHORTEST decimal that reads back as the same binary128 value,
// laid out by Number::toString's rules - as a Number prints. Printing the exact
// binary expansion instead showed 0.1 as 0.1000000000000000000000000000000000048...
// ---------------------------------------------------------------------------

/** The exact value of a finite nonzero x as numerator / denominator, denominator > 0. */
function exactFraction(x: Binary128): { num: bigint, den: bigint } {
  return x.exp >= 0 ? { num: x.sig << BigInt(x.exp), den: 1n } : { num: x.sig, den: 1n << BigInt(-x.exp) };
}

/**
 * The fewest significant digits s, with exponent n, such that s x 10**(n - k) -
 * k the number of digits of s - reads back as x: for each k, the two k-digit
 * decimals nearest |x|, one either side, and the closer of those that read back.
 * Both sides are tried because at a power of two the interval that reads back is
 * narrower below the value than above it.
 */
function shortestDigits(x: Binary128): { digits: string, n: number } {
  const { num, den } = exactFraction(x);
  const a = num < 0n ? -num : num;
  // n: the decimal exponent with 10**(n-1) <= |x| < 10**n.
  let n = a.toString().length - den.toString().length;
  const atLeast = (p: number) => (p >= 0 ? a >= den * 10n ** BigInt(p) : a * 10n ** BigInt(-p) >= den);
  while (!atLeast(n - 1)) n -= 1;
  while (atLeast(n)) n += 1;
  for (let k = 1; k <= 36; k += 1) {
    // |x| x 10**(k - n), whose integer part has k digits.
    const scale = k - n;
    const sn = scale >= 0 ? a * 10n ** BigInt(scale) : a;
    const sd = scale >= 0 ? den : den * 10n ** BigInt(-scale);
    const low = sn / sd;
    const candidates = [low, low + 1n].filter((c) => c > 0n);
    const back = (c: bigint) => fromDecimal(c, n - k);
    const exactly = (v: Binary128) => v.cls === 'finite' && v.exp === x.exp && (v.sig < 0n ? -v.sig : v.sig) === (x.sig < 0n ? -x.sig : x.sig);
    const hits = candidates.filter((c) => exactly(back(c)));
    if (hits.length > 0) {
      // The closer to |x|: compare |c * sd - sn| with the scale's denominator.
      hits.sort((p, q) => {
        const dp = p * sd - sn < 0n ? sn - p * sd : p * sd - sn;
        const dq = q * sd - sn < 0n ? sn - q * sd : q * sd - sn;
        return dp < dq ? -1 : dp > dq ? 1 : 0;
      });
      let digits = hits[0].toString();
      let exponent = n;
      if (digits.length > k) {
        exponent += 1;
      } // low + 1 carried to 10**k
      digits = digits.replace(/0+$/, '') || '0';
      return { digits, n: exponent };
    }
  }
  throw new Error('binary128 always reads back within 36 digits');
}

/** x as Number::toString would write it, with binary128's shortest digits. */
export function toShortestString(x: Binary128): string {
  if (x.cls === 'nan') return 'NaN';
  if (x.cls === 'infinity') return x.sign === -1 ? '-Infinity' : 'Infinity';
  if (x.sig === 0n) return '0';
  const sign = x.sig < 0n ? '-' : '';
  const { digits: s, n } = shortestDigits(x);
  const k = s.length;
  if (k <= n && n <= 21) return sign + s + '0'.repeat(n - k);
  if (n > 0 && n <= 21) return `${sign}${s.slice(0, n)}.${s.slice(n)}`;
  if (n > -6 && n <= 0) return `${sign}0.${'0'.repeat(-n)}${s}`;
  const e = n - 1;
  const mantissa = k === 1 ? s : `${s[0]}.${s.slice(1)}`;
  return `${sign}${mantissa}e${e < 0 ? '-' : '+'}${Math.abs(e)}`;
}
