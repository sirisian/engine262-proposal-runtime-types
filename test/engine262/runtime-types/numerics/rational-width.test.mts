import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * #sec-rational-types: "For each positive integer N, `rational.<N>` is a value
 * type whose values are the exact rational numbers representable as a quotient
 * of two values of `int.<N>`", in lowest terms, and "an operation whose exact
 * result is not representable ... throws a RangeError rather than rounding."
 *
 * The F10 plan: the width was dropped before anything ran - `rational.<8>` WAS
 * the bare `rational` constructor - so no width but 64 was enforced, a width-N
 * value failed its own type, and widths neither stayed distinct nor converted.
 * Every expectation here is computed from exact fractions by the oracle below,
 * never written by hand, at widths from the empty `rational.<1>` to 256.
 */

const WIDTHS = [1, 2, 7, 8, 16, 32, 64, 128, 256];
const T = (n: number) => (n === 64 ? 'rational' : `rational.<${n}>`);
const maxOf = (n: number) => (1n << BigInt(n - 1)) - 1n;
const minOf = (n: number) => -(1n << BigInt(n - 1));
const gcd = (a: bigint, b: bigint): bigint => {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

/** The oracle: num/den in lowest terms as the engine prints it, or 'RangeError' where width N cannot hold it. */
function expected(num: bigint, den: bigint, n: number): string {
  if (den < 0n) [num, den] = [-num, -den];
  const g = num === 0n ? den : gcd(num, den);
  const [p, q] = [num / g, den / g];
  if (p < minOf(n) || p > maxOf(n) || q < 1n || q > maxOf(n)) return 'RangeError';
  return q === 1n ? `${p}` : `${p}/${q}`;
}

/** What the engine answers: the value, or the name of what it throws. */
const outcome = (src: string) => evaluated(`let r; try { r = String(${src}); } catch (e) { r = e.constructor.name; } r;`);

for (const n of WIDTHS) {
  test(`construction at ${T(n)}: the bound, on the normalized fraction`, () => {
    const max = maxOf(n);
    const min = minOf(n);
    const cases: [bigint, bigint][] = [[max, 1n], [min, 1n], [max + 1n, 1n], [min - 1n, 1n], [1n, max], [1n, max + 1n],
      [2n * (max + 1n), 4n * (max + 1n)], [0n, 1n], [-1n, 3n]];
    // A zero denominator - `1/0` at width 1, whose maximum is 0 - is its own question.
    for (const [num, den] of cases.filter(([, b]) => b !== 0n)) {
      expect(outcome(`${T(n)}.parse('${num}/${den}')`), `${T(n)}.parse('${num}/${den}')`).toBe(expected(num, den, n));
    }
    if (n <= 16) {
      // The two-argument constructor, its parts written as literals.
      for (const [num, den] of cases.filter(([a, b]) => b > 0n && a >= -(1n << 20n) && a <= 1n << 20n && b <= 1n << 20n)) {
        expect(outcome(`${T(n)}(${num}, ${den})`), `${T(n)}(${num}, ${den})`).toBe(expected(num, den, n));
      }
    }
  });

  test(`conversions into ${T(n)}: exact, or a RangeError`, () => {
    const max = maxOf(n);
    // bigint values, at and past each end
    for (const k of [max, max + 1n, minOf(n), minOf(n) - 1n]) {
      expect(outcome(`(() => { const v = BigInt('${k}'); return v := ${T(n)}; })()`), `${k}n := ${T(n)}`).toBe(expected(k, 1n, n));
    }
    // a Number value is its exact dyadic value; a float32 value, its own
    expect(outcome(`(() => { let v = 0.1; return v := ${T(n)}; })()`)).toBe(expected(3602879701896397n, 1n << 55n, n));
    expect(outcome(`(() => { let v = 0.5; return v := ${T(n)}; })()`)).toBe(expected(1n, 2n, n));
    expect(outcome(`(() => { let v = (0.1 := float32); return v := ${T(n)}; })()`)).toBe(expected(13421773n, 1n << 27n, n));
    // a decimal is its exact value
    expect(outcome(`decimal64.parse('0.001') := ${T(n)}`)).toBe(expected(1n, 1000n, n));
    // a rational of another width converts exactly or not at all (X1)
    for (const m of WIDTHS.filter((w) => w >= 11)) {
      expect(outcome(`${T(m)}.parse('1/1000') := ${T(n)}`), `1/1000 at ${T(m)} := ${T(n)}`).toBe(expected(1n, 1000n, n));
    }
  });

  if (n >= 2) {
    test(`arithmetic at ${T(n)} keeps the width and its bound`, () => {
      const max = maxOf(n);
      const min = minOf(n);
      const at = (v: bigint, d = 1n) => `${T(n)}.parse('${v}/${d}')`;
      const cases: [string, bigint, bigint][] = [
        [`${at(max)} + ${at(1n)}`, max + 1n, 1n],
        [`${at(min)} - ${at(1n)}`, min - 1n, 1n],
        [`-${at(min)}`, -min, 1n],
        [`${at(max)} * ${at(max)}`, max * max, 1n],
        [`${at(1n, max)} + ${at(1n, max)}`, 2n, max],
        [`${at(1n)} / ${at(max)}`, 1n, max],
        [`${at(-1n)} * ${at(-1n)}`, 1n, 1n],
      ];
      for (const [src, num, den] of cases) {
        expect(outcome(src), src).toBe(expected(num, den, n));
      }
      // an in-range result keeps the width
      expect(outcome(`Reflect.typeOf(${at(0n)} + ${at(1n)})`)).toBe(T(n) === 'rational' ? 'rational' : T(n));
      // ++ past the end
      expect(outcome(`(() => { let r = ${at(max)}; r++; return r; })()`)).toBe(expected(max + 1n, 1n, n));
    });
  }

  test(`${T(n)}: parse, tryParse and the parts`, () => {
    const max = maxOf(n);
    expect(outcome(`${T(n)}.tryParse('x')`)).toBe('null');
    expect(outcome(`${T(n)}.tryParse('1/${max + 1n}')`)).toBe('RangeError');
    if (n >= 2) {
      expect(outcome(`Reflect.typeOf(${T(n)}.parse('${max}').numerator)`)).toBe(n === 64 ? 'int.<64>' : `int.<${n}>`);
      expect(outcome(`Reflect.typeOf(Math.floor(${T(n)}.parse('${max}')))`)).toBe(`int.<${n}>`);
      expect(outcome(`Math.abs(${T(n)}.parse('${minOf(n)}'))`)).toBe(expected(-minOf(n), 1n, n));
    }
  });
}

test('the widths are distinct types, meeting only through a conversion', () => {
  const widths = [8, 16, 64, 128];
  for (const a of widths) {
    for (const b of widths) {
      const va = `${T(a)}.parse('1/2')`;
      const vb = `${T(b)}.parse('1/2')`;
      // through ~any~, an annotation refuses another width
      expect(outcome(`(() => { let v: any = ${va}; let w: ${T(b)} = v; return w; })()`), `${T(a)} into ${T(b)}`).toBe(a === b ? '1/2' : 'TypeError');
      // strict equality and SameValue see the type; loose equality the value
      expect(outcome(`${va} === ${vb}`)).toBe(String(a === b));
      expect(outcome(`Object.is(${va}, ${vb})`)).toBe(String(a === b));
      expect(outcome(`${va} == ${vb}`)).toBe('true');
      expect(outcome(`Reflect.typeOf(${va} := ${T(b)})`)).toBe(T(b));
    }
  }
  expect(outcome('rational.<64> === rational')).toBe('true');
  expect(outcome('rational.<8> === rational')).toBe('false');
  expect(outcome('rational.<8> === rational.<8>')).toBe('true');
});

test('a literal takes its width, and one out of range is refused before the program runs', () => {
  expect(outcome('(() => { const x: rational.<8> = 1 / 3; return x + x; })()')).toBe('2/3');
  expect(outcome('(() => { const x: rational.<8> = 0.1; return Reflect.typeOf(x); })()')).toBe('rational.<8>');
  for (const src of ['const x: rational.<8> = 300;', 'const x: rational.<8> = 1 / 300;', 'let y = 128 := rational.<8>;',
    'const x: rational = 1180591620717411303424;', 'const x: rational.<1> = 0;']) {
    expectStaticTypeError(src);
  }
});

/** The closest value of rational.<N> to x with denominator <= bound, by searching every candidate. */
function bruteApproximate(x: number, bound: number, n: number): string {
  const max = maxOf(n);
  const min = minOf(n);
  // x as its exact dyadic value
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const m = (biased === 0 ? 0n : 1n << 52n) | (bits & ((1n << 52n) - 1n));
  const e = (biased === 0 ? 1 : biased) - 1075;
  const sign = bits >> 63n === 1n ? -1n : 1n;
  const [xn, xd] = e >= 0 ? [sign * (m << BigInt(e)), 1n] : [sign * m, 1n << BigInt(-e)];
  if (xn > max * xd || xn < min * xd) return 'RangeError';
  let best: [bigint, bigint] | undefined;
  const limit = BigInt(bound) < max ? BigInt(bound) : max;
  for (let q = 1n; q <= limit; q += 1n) {
    const floor = (xn * q) / xd - ((xn * q) % xd < 0n ? 1n : 0n);
    for (const p of [floor, floor + 1n]) {
      if (p < min || p > max) continue;
      if (best === undefined) {
        best = [p, q];
        continue;
      }
      const dNew = (p * xd - xn * q < 0n ? -(p * xd - xn * q) : p * xd - xn * q) * best[1];
      const dOld = (best[0] * xd - xn * best[1] < 0n ? -(best[0] * xd - xn * best[1]) : best[0] * xd - xn * best[1]) * q;
      // Of two equally near: the smaller denominator (q ascends, so the first
      // found), then the one nearer zero.
      const absP = (v: bigint) => (v < 0n ? -v : v);
      if (dNew < dOld || (dNew === dOld && q === best[1] && absP(p) < absP(best[0]))) best = [p, q];
    }
  }
  return expected(best![0], best![1], n);
}

for (const n of [2, 3, 5, 8]) {
  test(`approximate at ${T(n)}: the closest value of the type, found by searching them all`, () => {
    for (const x of [Math.PI, -Math.PI, Math.E, 0.3, -0.7, 1 / 3, 1.5, -1.5, 0.25, 100.3, -128]) {
      for (const bound of [1, 3, 10, 1000]) {
        expect(outcome(`${T(n)}.approximate(${x}, ${bound})`), `${T(n)}.approximate(${x}, ${bound})`).toBe(bruteApproximate(x, bound, n));
      }
    }
  });
}

test('approximate breaks a tie by the smaller denominator, then nearer zero', () => {
  // 1.5 is as near 1 as 2, and -1.5 as near -1 as -2: the one nearer zero.
  expect(outcome('rational.<3>.approximate(1.5, 1)')).toBe('1');
  expect(outcome('rational.<3>.approximate(-1.5, 1)')).toBe('-1');
  // 1/4 is as near 0/1 as 1/2: the smaller denominator.
  expect(outcome('rational.<8>.approximate(0.25, 2)')).toBe('0');
});

test('approximate: the design example at each width, and overflow refused', () => {
  expect(outcome('rational.<8>.approximate(Math.PI, 1000)')).toBe('22/7');
  expect(outcome('rational.<16>.approximate(Math.PI, 1000)')).toBe('355/113');
  expect(outcome('rational.approximate(Math.PI, 1000)')).toBe('355/113');
  expect(outcome('rational.<8>.approximate(1000, 10)')).toBe('RangeError');
  expect(outcome('uint8.approximate(1, 2)')).toBe('TypeError');
});

test('a width that is not a positive integer names no type', () => {
  // "For each positive integer N": `rational.<1.5>` reached BigInt with a fraction
  // and crashed the host, and `rational.<bigint>` was silently a 64-bit rational.
  // The widths are those of `int.<N>`, 1 to 2**16: `rational.<65537>` names no type.
  expect(outcome('rational.<65536>.byteLength')).toBe('16384');
  for (const w of ['1.5', '0', '-1', '65537', 'string', 'number']) {
    expect(outcome(`rational.<${w}>(1, 1)`), `rational.<${w}>(1, 1)`).toBe('TypeError');
    expect(outcome(`rational.<${w}>.parse('1')`), `rational.<${w}>.parse`).toBe('TypeError');
    expect(outcome(`rational.<${w}>.approximate(1, 2)`), `rational.<${w}>.approximate`).toBe('TypeError');
  }
  expectStaticTypeError('const x: rational.<1.5> = 1;');
  expect(evaluated("let m; try { rational.<string>(1, 3); } catch (e) { m = e.message; } m;"))
    .toBe('rational.<string> is not a type: a rational width is a positive integer');
});

// `rational.<bigint>`: the quotient of two `bigint` values - every rational, with
// no bound. Every rule of `rational.<N>`, with the bound removed.
const B = 'rational.<bigint>';
/** An exact fraction as the engine prints it, in lowest terms: no width, so never refused. */
function exact(num: bigint, den: bigint): string {
  if (den < 0n) [num, den] = [-num, -den];
  const g = num === 0n ? den : gcd(num, den);
  const [p, q] = [num / g, den / g];
  return q === 1n ? `${p}` : `${p}/${q}`;
}

test('rational.<bigint> holds every rational, and arithmetic never overflows', () => {
  expect(outcome(`String(${B})`)).toBe('rational.<bigint>');
  expect(outcome(`Reflect.typeOf(${B}(1, 3))`)).toBe('rational.<bigint>');
  expect(outcome(`${B}(2n ** 200n) / ${B}(3n)`)).toBe(exact(2n ** 200n, 3n));
  expect(outcome(`${B}(2n ** 62n) * ${B}(2n ** 62n)`)).toBe(exact(2n ** 124n, 1n));
  expect(outcome(`${B}(1, 0)`)).toBe('RangeError');
  // x * x + 1/7 from 1/3, eight steps: the denominator doubles in size each step,
  // far past every width, and every step is exact.
  let [n, d] = [1n, 3n];
  for (let i = 0; i < 8; i += 1) {
    [n, d] = [n * n * 7n + d * d, d * d * 7n];
    const g = gcd(n, d);
    [n, d] = [n / g, d / g];
  }
  expect(outcome(`(() => { let x = ${B}(1, 3); for (let i = 0; i < 8; i += 1) x = x * x + ${B}(1, 7); return x; })()`)).toBe(exact(n, d));
});

test('rational.<bigint>: conversions in are exact; out, exact or a RangeError', () => {
  expect(outcome(`(() => { const v = 2n ** 200n; return v := ${B}; })()`)).toBe(exact(2n ** 200n, 1n));
  expect(outcome(`(() => { let v = 0.1; return v := ${B}; })()`)).toBe(exact(3602879701896397n, 1n << 55n));
  expect(outcome(`(() => { let v = (0.1 := float32); return v := ${B}; })()`)).toBe(exact(13421773n, 1n << 27n));
  expect(outcome(`decimal64.parse('0.001') := ${B}`)).toBe(exact(1n, 1000n));
  for (const v of ['NaN', 'Infinity', '-Infinity']) {
    expect(outcome(`(() => { let v = ${v}; return v := ${B}; })()`), v).toBe('RangeError');
  }
  for (const m of WIDTHS.filter((w) => w >= 11)) {
    expect(outcome(`${T(m)}.parse('1/1000') := ${B}`), `from ${T(m)}`).toBe(exact(1n, 1000n));
  }
  // Out, to every width: the width's own bound decides.
  for (const n of WIDTHS) {
    expect(outcome(`${B}.parse('1/1000') := ${T(n)}`), `to ${T(n)}`).toBe(expected(1n, 1000n, n));
  }
  expect(outcome(`${B}(1, 3) := float64`)).toBe('0.3333333333333333');
  expect(outcome(`${B}(7, 2) := bigint`)).toBe('3');
});

test('rational.<bigint>: a type of its own, with bigint parts and no layout', () => {
  for (const n of [8, 64, 128]) {
    expect(outcome(`${B}(1, 2) === ${T(n)}.parse('1/2')`)).toBe('false');
    expect(outcome(`Object.is(${B}(1, 2), ${T(n)}.parse('1/2'))`)).toBe('false');
    expect(outcome(`${B}(1, 2) == ${T(n)}.parse('1/2')`)).toBe('true');
    expect(outcome(`(() => { let v: any = ${B}(1, 2); let w: ${T(n)} = v; return w; })()`)).toBe('TypeError');
  }
  expect(outcome(`${B}(1, 2) === ${B}(1, 2)`)).toBe('true');
  expectStaticTypeError(`${B}(1, 2) + rational(1, 2);`);
  expect(outcome(`Reflect.typeOf(${B}(2n ** 100n).numerator)`)).toBe('bigint');
  expect(outcome(`${B}(2n ** 100n, 3n).denominator`)).toBe('3');
  for (const f of ['floor', 'ceil', 'round', 'trunc']) {
    expect(outcome(`Reflect.typeOf(Math.${f}(${B}(7, 2)))`), f).toBe('bigint');
  }
  expect(outcome(`Math.floor(${B}(-(2n ** 100n) - 1n, 2n))`)).toBe(`${-(2n ** 99n) - 1n}`);
  expect(outcome(`Reflect.typeOf(Math.abs(${B}(-1, 3)))`)).toBe('rational.<bigint>');
  expect(outcome(`${B}.byteLength`)).toBe('TypeError');
  expect(outcome(`(() => { class Q { q: ${B} = 0; } return Q.byteLength; })()`)).toBe('TypeError');
});

test('rational.<bigint>: any literal fits, and parse reads any size', () => {
  expect(outcome(`(() => { const x: ${B} = 1180591620717411303424; return x; })()`)).toBe('1180591620717411303424');
  expect(outcome(`(() => { const x: ${B} = 1 / 3; return Reflect.typeOf(x); })()`)).toBe('rational.<bigint>');
  expect(outcome(`${B}.parse('1/12345678901234567890')`)).toBe('1/12345678901234567890');
  expect(outcome(`${B}.tryParse('x')`)).toBe('null');
});

/** The closest rational to x with denominator <= bound, the numerator unbounded, by searching them all. */
function bruteApproximateUnbounded(x: number, bound: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const m = (biased === 0 ? 0n : 1n << 52n) | (bits & ((1n << 52n) - 1n));
  const e = (biased === 0 ? 1 : biased) - 1075;
  const sign = bits >> 63n === 1n ? -1n : 1n;
  const [xn, xd] = e >= 0 ? [sign * (m << BigInt(e)), 1n] : [sign * m, 1n << BigInt(-e)];
  const abs = (v: bigint) => (v < 0n ? -v : v);
  let best: [bigint, bigint] | undefined;
  for (let q = 1n; q <= BigInt(bound); q += 1n) {
    const floor = (xn * q) / xd - ((xn * q) % xd < 0n ? 1n : 0n);
    for (const p of [floor, floor + 1n]) {
      if (best === undefined) {
        best = [p, q];
        continue;
      }
      const dNew = abs(p * xd - xn * q) * best[1];
      const dOld = abs(best[0] * xd - xn * best[1]) * q;
      if (dNew < dOld || (dNew === dOld && q === best[1] && abs(p) < abs(best[0]))) best = [p, q];
    }
  }
  return exact(best![0], best![1]);
}

test('rational.<bigint>: approximate bounds the denominator only, found by searching them all', () => {
  for (const x of [Math.PI, -Math.PI, Math.E, 0.3, -0.7, 1.5, -1.5, 0.25, 100.3, -128, 1e10, 123456789.123]) {
    for (const bound of [1, 3, 10, 1000]) {
      expect(outcome(`${B}.approximate(${x}, ${bound})`), `approximate(${x}, ${bound})`).toBe(bruteApproximateUnbounded(x, bound));
    }
  }
  expect(outcome(`${B}.approximate(1e30, 7)`)).toBe('1000000000000000019884624838656');
});

test('complex.<T> is its Type Object, as rational.<N> is', () => {
  expect(outcome('complex.<number> === complex')).toBe('true');
  expect(outcome('complex.<float32> === complex')).toBe('false');
  expect(outcome("complex.<float32>.parse('1e300')")).toBe('RangeError');
});
