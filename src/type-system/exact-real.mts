import type { ParseNode } from '../parser/ParseNode.mts';
import { exactExpansionOfDouble, isDecimalObject } from '../intrinsics/Decimal.mts';
import {
  BigIntValue, NumberValue, TypedNumberValue, type Value,
} from '../value.mts';
import { R } from '#self';

/**
 * An exact real for #sec-equality-and-comparison's answer across types: a
 * finite value is significand x 10^exponent, which a double, a BigInt, a
 * typed number, a decimal and a numeric literal's source text all have
 * exactly; NaN and the infinities are kept apart.
 */
export type ExactReal = { readonly special: 'NaN' | 'Infinity' | '-Infinity' } | { readonly special?: undefined, readonly significand: bigint, readonly exponent: number };

export function exactOfDouble(x: number): ExactReal {
  if (Number.isNaN(x)) return { special: 'NaN' };
  if (x === Infinity) return { special: 'Infinity' };
  if (x === -Infinity) return { special: '-Infinity' };
  return exactExpansionOfDouble(x) ?? { significand: 0n, exponent: 0 };
}

/** The value a numeric literal operand's source text denotes, exactly, rather than the double it evaluates to. */
export function exactOfLiteralText(node: ParseNode): ExactReal | undefined {
  let n = node;
  let negative = false;
  for (;;) {
    if (n.type === 'ParenthesizedExpression') {
      n = (n as { Expression: ParseNode }).Expression;
    } else if (n.type === 'CommaOperator') {
      n = n.ExpressionList.at(-1)!;
    } else if (n.type === 'UnaryExpression' && ((n as { operator?: string }).operator === '-' || (n as { operator?: string }).operator === '+')) {
      if ((n as { operator?: string }).operator === '-') negative = !negative;
      n = (n as { UnaryExpression: ParseNode }).UnaryExpression;
    } else {
      break;
    }
  }
  if (n.type !== 'NumericLiteral') return undefined;
  const text = n.sourceText.replace(/_/g, '');
  let significand: bigint;
  let exponent = 0;
  if (/^0[xXoObB]/.test(text) || text.endsWith('n')) {
    significand = BigInt(text.endsWith('n') ? text.slice(0, -1) : text);
  } else {
    // A legacy octal or a leading-zero decimal keeps its evaluated value.
    const m = /^0\d/.test(text) ? null : /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!m) return undefined;
    const fraction = m[2] ?? '';
    significand = BigInt(`${m[1] || '0'}${fraction}`);
    exponent = Number(m[3] ?? 0) - fraction.length;
  }
  return { significand: negative ? -significand : significand, exponent };
}

export function exactOfValue(v: Value): ExactReal | undefined {
  if (v instanceof TypedNumberValue) {
    return typeof (v as TypedNumberValue).value === 'bigint'
      ? { significand: (v as TypedNumberValue).bigintValue(), exponent: 0 }
      : exactOfDouble((v as TypedNumberValue).numberValue()); // eslint-disable-line @engine262/mathematical-value -- a typed number's payload, read exactly
  }
  if (isDecimalObject(v)) {
    return v.DecimalSpecial !== undefined ? { special: v.DecimalSpecial } : { significand: v.DecimalSignificand, exponent: v.DecimalExponent };
  }
  if (v instanceof NumberValue) return exactOfDouble(R(v));
  if (v instanceof BigIntValue) return { significand: R(v), exponent: 0 };
  return undefined;
}

/** The order of two exact reals, or undefined where either is NaN. */
export function compareExact(a: ExactReal, b: ExactReal): -1 | 0 | 1 | undefined {
  if (a.special === 'NaN' || b.special === 'NaN') return undefined;
  if (a.special !== undefined || b.special !== undefined) {
    const rank = (x: ExactReal) => (x.special === 'Infinity' ? 1 : x.special === '-Infinity' ? -1 : 0);
    const ra = rank(a);
    const rb = rank(b);
    return ra < rb ? -1 : ra > rb ? 1 : (a.special === undefined || b.special === undefined ? (ra === 0 ? 0 : ra) as -1 | 0 | 1 : 0);
  }
  const sa = a.significand < 0n ? -1 : a.significand > 0n ? 1 : 0;
  const sb = b.significand < 0n ? -1 : b.significand > 0n ? 1 : 0;
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (sa === 0) return 0;
  // Decide by magnitude where the decimal points lie far apart, so that a
  // literal such as 1e1000000000 never becomes a BigInt of that length.
  const magnitude = (s: bigint, e: number) => (s < 0n ? -s : s).toString().length + e;
  const ma = magnitude(a.significand, a.exponent);
  const mb = magnitude(b.significand, b.exponent);
  if (ma !== mb) return (ma < mb ? -1 : 1) * sa as -1 | 1;
  let x = a.significand;
  let y = b.significand;
  if (a.exponent > b.exponent) x *= 10n ** BigInt(a.exponent - b.exponent);
  else if (b.exponent > a.exponent) y *= 10n ** BigInt(b.exponent - a.exponent);
  return x < y ? -1 : x > y ? 1 : 0;
}
