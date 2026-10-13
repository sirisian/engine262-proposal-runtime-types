import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { exactNumericValue } from '../abstract-ops/testing-comparison.mts';
import { CreateRangeObject, type RangeObject, type RangeEndpoint, type RangeBound } from '../intrinsics/Range.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { RangeIsEmpty } from './range-selection.mts';
import { NumericRangeDomain, negativeZero, numericRangeValue, numericRangeInfinity } from './range-numeric.mts';

type Edge = { value: RangeEndpoint | undefined; bound: RangeBound | undefined };

/** Lower result first, including admission, then upper result. Absent inputs
 * supply no bound. Indeterminate explicit infinity arithmetic is a failure,
 * never a NaN endpoint or an invented missing bound.
 */
function* combine(x: Edge, y: Edge, subtract: boolean, upper: boolean, domain: TypeRecord, realm: Realm): PlainEvaluator<Edge> {
  if (x.value === undefined || y.value === undefined) return { value: undefined, bound: undefined };
  const a = exactNumericValue(x.value)!;
  const b = exactNumericValue(y.value)!;
  const bound = x.bound === 'open' || y.bound === 'open' ? 'open' : 'closed';
  if (a.kind === 'infinity' || b.kind === 'infinity') {
    const sa = a.kind === 'infinity' ? a.sign : undefined;
    const sb = b.kind === 'infinity' ? (subtract ? -b.sign : b.sign) : undefined;
    if (sa !== undefined && sb !== undefined && sa !== sb) return Throw.RangeError('indeterminate infinite interval endpoint');
    const sign = sa ?? sb!;
    return { value: Q(yield* numericRangeInfinity(domain, sign < 0 ? -1 : 1, realm)), bound };
  }
  if (a.kind !== 'finite' || b.kind !== 'finite') return Throw.TypeError('interval addition requires ordered numeric endpoints');
  const n = a.n * b.d + (subtract ? -b.n : b.n) * a.d;
  const d = a.d * b.d;
  // Cancellation yields +0. Adding two -0 values, or subtracting +0 from -0,
  // keeps -0; the exact rational alone cannot carry this representation bit.
  const negative = n < 0n || (n === 0n && a.n === 0n && b.n === 0n && negativeZero(x.value)
    && (subtract ? !negativeZero(y.value) : negativeZero(y.value)));
  const result = Q(yield* numericRangeValue(domain, { n, d }, upper, negative, realm));
  return { value: result.value, bound: result.rounded ? 'closed' : bound };
}

/** sec-additive-range-arithmetic: validate, empty image, lower/upper, publish. */
export function* NumericRangeAdd(a: RangeObject, b: RangeObject, subtract: boolean, realm: Realm): ValueEvaluator {
  const domain = Q(yield* NumericRangeDomain(a, b));
  for (const range of [a, b]) {
    if (Q(yield* RangeIsEmpty(range))) return CreateRangeObject(range.RangeStart, range.RangeEnd, range.RangeStartBound, range.RangeEndBound, realm, domain);
  }
  const start = (range: RangeObject): Edge => ({ value: range.RangeStart, bound: range.RangeStartBound });
  const end = (range: RangeObject): Edge => ({ value: range.RangeEnd, bound: range.RangeEndBound });
  const low = Q(yield* combine(start(a), subtract ? end(b) : start(b), subtract, false, domain, realm));
  const high = Q(yield* combine(end(a), subtract ? start(b) : end(b), subtract, true, domain, realm));
  return CreateRangeObject(low.value, high.value, low.bound, high.bound, realm, domain);
}
