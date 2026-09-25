import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  add, subtract, multiply, divide, remainder, compare, exponentiate, finite, zero, infinity, NAN,
  type Binary128,
} from '../../../../src/intrinsics/Float128Arithmetic.mts';

/**
 * binary128 arithmetic, checked bit for bit against values from OUTSIDE the
 * engine: gcc's __float128 for the basic operations and comparisons, and exact
 * rational arithmetic rounded independently for integer powers. See
 * float128-reference/make-reference.py, which regenerates reference.json.
 *
 * The values include the smallest normal and subnormal, the largest finite
 * value, 1 + ulp, both zeroes, both infinities and NaN - so the subnormal
 * rounding, overflow and every IEEE special case are covered.
 */

type Ref = { cls: string, sign?: number, sig?: string, exp?: number };
const ref = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'float128-reference', 'reference.json'), 'utf8'));
const make = (v: Ref): Binary128 => {
  if (v.cls === 'nan') return NAN;
  if (v.cls === 'infinity') return infinity(v.sign as -1 | 1);
  if (v.cls === 'zero') return zero(v.sign as -1 | 1);
  return finite(BigInt(v.sig!), v.exp!);
};
const show = (x: Binary128 | undefined): Ref | string => {
  if (x === undefined) return 'stage 2';
  if (x.cls === 'nan') return { cls: 'nan' };
  if (x.cls === 'infinity') return { cls: 'infinity', sign: x.sign };
  if (x.sig === 0n) return { cls: 'zero', sign: x.sign };
  return { cls: 'finite', sig: String(x.sig), exp: x.exp };
};
const vals: Record<string, Binary128> = Object.fromEntries(Object.entries(ref.values).map(([k, v]) => [k, make(v as Ref)]));

test('the basic operations are correctly rounded, bit for bit against gcc', () => {
  const ops: Record<string, (a: Binary128, b: Binary128) => Binary128> = { '+': add, '-': subtract, '*': multiply, '/': divide, '%': remainder };
  for (const [key, want] of Object.entries(ref.operations)) {
    const [i, op, j] = key.split(' ');
    expect(show(ops[op](vals[i], vals[j])), key).toEqual(want);
  }
});

test('comparisons, NaN unordered and the zeroes equal', () => {
  for (const [key, want] of Object.entries(ref.comparisons)) {
    const [i, j] = key.split(' ');
    const c = compare(vals[i], vals[j]);
    expect(c === undefined ? 'u' : String(c), key).toBe(want);
  }
});

test('an integer power is exact, then rounded once', () => {
  for (const [b, n, want] of ref.integerPowers as [string, number, Ref][]) {
    expect(show(exponentiate(vals[b], n === 0 ? zero(1) : finite(BigInt(n), 0))), `${b} ** ${n}`).toEqual(want);
  }
});

test('the special cases of Number::exponentiate', () => {
  const one = finite(1n, 0);
  const f = (sig: number, exp = 0) => finite(BigInt(sig), exp);
  const cases: [string, Binary128, Binary128, Ref | string][] = [
    ['NaN ** 0', NAN, zero(1), { cls: 'finite', sig: '1', exp: 0 }],
    ['1 ** Infinity is NaN in ECMAScript', one, infinity(1), { cls: 'nan' }],
    ['-1 ** Infinity', f(-1), infinity(1), { cls: 'nan' }],
    ['0.5 ** Infinity', f(1, -1), infinity(1), { cls: 'zero', sign: 1 }],
    ['-2 ** 0.5', f(-1, 1), f(1, -1), { cls: 'nan' }],
    ['2 ** 0.5 waits for stage 2', f(1, 1), f(1, -1), 'stage 2'],
    ['-0 ** -3', zero(-1), f(-3), { cls: 'infinity', sign: -1 }],
    ['-0 ** 2', zero(-1), f(2), { cls: 'zero', sign: 1 }],
    ['-Infinity ** 3', infinity(-1), f(3), { cls: 'infinity', sign: -1 }],
    ['-Infinity ** -3', infinity(-1), f(-3), { cls: 'zero', sign: -1 }],
    ['-1 ** 3', f(-1), f(3), { cls: 'finite', sig: '-1', exp: 0 }],
  ];
  for (const [name, b, e, want] of cases) expect(show(exponentiate(b, e)), name).toEqual(want);
});
