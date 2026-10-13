import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { exactNumericValue } from '../abstract-ops/testing-comparison.mts';
import { CreateRangeObject, type RangeObject, type RangeEndpoint, type RangeBound } from '../intrinsics/Range.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { RangeIsEmpty } from './range-selection.mts';
import { NumericRangeDomain, negativeZero, numericRangeValue, numericRangeInfinity, type Fraction } from './range-numeric.mts';

type Coordinate = ({ kind: 'finite'; negative: boolean } & Fraction)
  | { kind: 'infinity'; sign: -1 | 1; absent: boolean };
type Edge = Coordinate & { closed: boolean };
type Interval = { low: Edge; high: Edge };

function edge(value: RangeEndpoint | undefined, bound: RangeBound | undefined, upper: boolean): Edge {
  if (value === undefined) return { kind: 'infinity', sign: upper ? 1 : -1, absent: true, closed: false };
  const x = exactNumericValue(value)!;
  const closed = bound === 'closed';
  if (x.kind === 'infinity') return { ...x, absent: false, closed };
  // NumericRangeDomain already rejected NaN, complex and nonnumeric values.
  if (x.kind !== 'finite') throw new Error('validated numeric interval endpoint');
  return { ...x, negative: x.n < 0n || negativeZero(value), closed };
}

function interval(range: RangeObject): Interval {
  return { low: edge(range.RangeStart, range.RangeStartBound, false), high: edge(range.RangeEnd, range.RangeEndBound, true) };
}

function sign(x: Coordinate): number {
  return x.kind === 'infinity' ? x.sign : x.n < 0n ? -1 : x.n > 0n ? 1 : 0;
}

function negative(x: Coordinate): boolean {
  return x.kind === 'infinity' ? x.sign < 0 : x.negative;
}

function compare(a: Coordinate, b: Coordinate): number {
  if (a.kind === 'infinity') return b.kind === 'infinity' ? a.sign - b.sign : a.sign;
  if (b.kind === 'infinity') return -b.sign;
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

function hasZero(x: Interval): boolean {
  return (sign(x.low) < 0 || (sign(x.low) === 0 && x.low.closed))
    && (sign(x.high) > 0 || (sign(x.high) === 0 && x.high.closed));
}

function hasFinite(x: Interval): boolean {
  return !(x.low.kind === 'infinity' && x.low.sign > 0) && !(x.high.kind === 'infinity' && x.high.sign < 0);
}

function hasSign(x: Interval, s: number): boolean {
  return s > 0 ? sign(x.high) > 0 : sign(x.low) < 0;
}

function explicitInfinity(x: Interval, s?: number, closed = false): boolean {
  return [x.low, x.high].some((e) => e.kind === 'infinity' && !e.absent && (s === undefined || s === e.sign) && (!closed || e.closed));
}

function zero(negativeSign: boolean, closed: boolean): Edge {
  return { kind: 'finite', n: 0n, d: 1n, negative: negativeSign, closed };
}

/** Exact candidates only: no intermediate reciprocal, rounding or admission.
 * Missing bounds are limits, never manufactured infinity values. A doubly
 * unbounded quotient corner contributes no constraint; its other corners do.
 */
function candidate(a: Edge, b: Edge, divide: boolean): Edge | undefined {
  const neg = negative(a) !== negative(b);
  const closed = a.closed && b.closed;
  if (divide && b.kind === 'infinity') {
    if (a.kind === 'finite' || !b.absent) return zero(neg, closed);
    return undefined;
  }
  if (a.kind === 'finite' && b.kind === 'finite') {
    let n = divide ? a.n * b.d : a.n * b.n;
    let d = divide ? a.d * b.n : a.d * b.d;
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    return { kind: 'finite', n, d, negative: neg, closed };
  }
  if (!divide && (sign(a) === 0 || sign(b) === 0)) return zero(neg, closed);
  return { kind: 'infinity', sign: neg ? -1 : 1, absent: (a.kind === 'infinity' && a.absent) || (b.kind === 'infinity' && b.absent), closed };
}

/** Tied infinite extrema retain absence provenance. At finite zero, ties
 * select -0 below and +0 above when both signs occur, independently of order.
 */
function select(candidates: Edge[], upper: boolean): Edge {
  let result = candidates[0];
  for (const next of candidates.slice(1)) {
    const order = compare(next, result);
    if (upper ? order > 0 : order < 0) result = next;
    else if (order === 0) {
      if (result.kind === 'infinity' && next.kind === 'infinity') result = { ...result, absent: result.absent || next.absent, closed: result.closed || next.closed };
      else if (result.kind === 'finite' && next.kind === 'finite') result = { ...result, negative: upper ? result.negative && next.negative : result.negative || next.negative, closed: result.closed || next.closed };
    }
  }
  return result;
}

/** Corners alone miss constant images attained by interior values. */
function attained(e: Edge, a: Interval, b: Interval, divide: boolean): boolean {
  if (e.closed) return true;
  if (e.kind === 'finite') {
    return e.n === 0n && (hasZero(a) || (divide ? explicitInfinity(b, undefined, true) && hasFinite(a) : hasZero(b)));
  }
  for (const s of [-1, 1]) {
    if (explicitInfinity(a, s, true) && hasSign(b, s * e.sign) && (!divide || hasFinite(b))) return true;
    if (!divide && explicitInfinity(b, s, true) && hasSign(a, s * e.sign)) return true;
  }
  return false;
}

function* represent(e: Edge, upper: boolean, a: Interval, b: Interval, divide: boolean, domain: TypeRecord, realm: Realm): PlainEvaluator<{ value: RangeEndpoint | undefined; bound: RangeBound | undefined }> {
  if (e.kind === 'infinity') {
    // Absence removes an outward constraint. A +Infinity lower bound or a
    // -Infinity upper bound still constrains the result to that extreme; a
    // present infinity in an operand necessarily established this case.
    if (e.absent && (upper ? e.sign > 0 : e.sign < 0)) return { value: undefined, bound: undefined };
    return { value: Q(yield* numericRangeInfinity(domain, e.sign, realm)), bound: attained(e, a, b, divide) ? 'closed' : 'open' };
  }
  const result = Q(yield* numericRangeValue(domain, e, upper, e.negative, realm));
  return { value: result.value, bound: result.rounded || attained(e, a, b, divide) ? 'closed' : 'open' };
}

/** sec-multiplicative-range-arithmetic: domain, empty, singularity, exact
 * candidate preflight, lower representation/admission, upper, publication.
 */
export function* NumericRangeProduct(left: RangeObject, right: RangeObject, divide: boolean, realm: Realm): ValueEvaluator {
  const domain = Q(yield* NumericRangeDomain(left, right));
  for (const range of [left, right]) {
    if (Q(yield* RangeIsEmpty(range))) return CreateRangeObject(range.RangeStart, range.RangeEnd, range.RangeStartBound, range.RangeEndBound, realm, domain);
  }
  const a = interval(left);
  const b = interval(right);
  if (divide && !(sign(b.low) > 0 || sign(b.high) < 0)) return CreateRangeObject(undefined, undefined, undefined, undefined, realm, domain);
  // Explicit indeterminate coordinates are errors, even at excluded bounds.
  // An interior zero is just as capable of making a product indeterminate.
  const touchesZero = (x: Interval) => hasZero(x) || sign(x.low) === 0 || sign(x.high) === 0;
  if (divide ? explicitInfinity(a) && explicitInfinity(b)
    : (touchesZero(a) && explicitInfinity(b)) || (touchesZero(b) && explicitInfinity(a))) {
    return Throw.RangeError('indeterminate infinite interval endpoint');
  }
  const candidates: Edge[] = [];
  for (const x of [a.low, a.high]) {
    for (const y of [b.low, b.high]) {
      const c = candidate(x, y, divide);
      if (c) candidates.push(c);
    }
  }
  const low = Q(yield* represent(select(candidates, false), false, a, b, divide, domain, realm));
  const high = Q(yield* represent(select(candidates, true), true, a, b, divide, domain, realm));
  return CreateRangeObject(low.value, high.value, low.bound, high.bound, realm, domain);
}
