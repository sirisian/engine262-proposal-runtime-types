import { Value } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { Call, ToBoolean } from '../abstract-ops/all.mts';
import { LookupClassOperator } from '../abstract-ops/runtime-types.mts';
import { exactNumericValue } from '../abstract-ops/testing-comparison.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { CreateRangeObject, type RangeObject, type RangeEndpoint, type RangeBound } from '../intrinsics/Range.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { RuntimeTypeOf } from './runtime.mts';
import { joinTypes } from './logical-types.mts';
import type { TypeRecord } from './records.mts';

/** Ordered endpoint comparison never converts a value or reads a public bound.
 * Numeric values compare exactly; class endpoints use only their declared <.
 * Equivalence is the total order's equivalence, not object/value identity.
 */
export function* RangeEndpointCompare(a: Value, b: Value): PlainEvaluator<-1 | 0 | 1> {
  const x = exactNumericValue(a);
  const y = exactNumericValue(b);
  if (x && y && x.kind !== 'nan' && y.kind !== 'nan' && x.kind !== 'complex' && y.kind !== 'complex') {
    if (x.kind === 'infinity') {
      if (y.kind === 'infinity') return x.sign === y.sign ? 0 : x.sign;
      return x.sign;
    }
    if (y.kind === 'infinity') return y.sign === 1 ? -1 : 1;
    const left = x.n * y.d;
    const right = y.n * x.d;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (x || y) return Throw.TypeError('range endpoints must be ordered with one another');
  const less = LookupClassOperator(a, '<');
  const greater = LookupClassOperator(b, '<');
  if (less === null || greater === null) return Throw.TypeError('range endpoints must be ordered with one another');
  const before = Q(yield* Call(less, a, [b]));
  if (ToBoolean(before) === Value.true) return -1;
  const after = Q(yield* Call(greater, b, [a]));
  return ToBoolean(after) === Value.true ? 1 : 0;
}

export function* RangeIsEmpty(range: RangeObject): PlainEvaluator<boolean> {
  if (range.RangeStart === undefined || range.RangeEnd === undefined) {
    const endpoint = range.RangeStart ?? range.RangeEnd;
    const numeric = endpoint === undefined ? undefined : exactNumericValue(endpoint);
    // In the extended numeric order, nothing is strictly beyond an extremal
    // infinity. A closed extremal infinity still denotes its singleton.
    return numeric?.kind === 'infinity' && (range.RangeStart !== undefined
      ? numeric.sign === 1 && range.RangeStartBound === 'open'
      : numeric.sign === -1 && range.RangeEndBound === 'open');
  }
  const order = Q(yield* RangeEndpointCompare(range.RangeStart, range.RangeEnd));
  return order > 0 || (order === 0 && (range.RangeStartBound === 'open' || range.RangeEndBound === 'open'));
}

/** Empty intervals are subsets even when their crossed endpoints lie outside. */
export function* rangeContainsRange(outer: RangeObject, inner: RangeObject): PlainEvaluator<boolean> {
  if (Q(yield* RangeIsEmpty(inner))) return true;
  if (outer.RangeStart !== undefined) {
    if (inner.RangeStart === undefined) return false;
    const order = Q(yield* RangeEndpointCompare(outer.RangeStart, inner.RangeStart));
    if (order > 0 || (order === 0 && outer.RangeStartBound === 'open' && inner.RangeStartBound !== 'open')) return false;
  }
  if (outer.RangeEnd !== undefined) {
    if (inner.RangeEnd === undefined) return false;
    const order = Q(yield* RangeEndpointCompare(outer.RangeEnd, inner.RangeEnd));
    if (order < 0 || (order === 0 && outer.RangeEndBound === 'open' && inner.RangeEndBound !== 'open')) return false;
  }
  return true;
}

interface SelectedEndpoint {
  value: RangeEndpoint | undefined;
  bound: RangeBound | undefined;
}

/** Missing bounds impose no constraint. On equivalent endpoints retain the
 * left value and combine exclusion, preserving signed zero and class payloads.
 */
function* selectEndpoint(a: SelectedEndpoint, b: SelectedEndpoint, low: boolean): PlainEvaluator<SelectedEndpoint> {
  if (a.value === undefined) return b;
  if (b.value === undefined) return a;
  const order = Q(yield* RangeEndpointCompare(a.value, b.value));
  if (order === 0) return { value: a.value, bound: a.bound === 'open' || b.bound === 'open' ? 'open' : 'closed' };
  return (low ? order > 0 : order < 0) ? a : b;
}

function domainOf(range: RangeObject): TypeRecord {
  return (RuntimeTypeOf(range) as Extract<TypeRecord, { Kind: 'nominal' }>).Arguments[0] as TypeRecord;
}

/** A full any range has neither an endpoint nor a domain constraint. Other
 * domains participate even when their endpoints are not selected.
 */
function selectionDomain(a: RangeObject, b: RangeObject): TypeRecord {
  const x = domainOf(a);
  const y = domainOf(b);
  if (x.Kind === 'any' && a.RangeStart === undefined && a.RangeEnd === undefined) return y;
  if (y.Kind === 'any' && b.RangeStart === undefined && b.RangeEnd === undefined) return x;
  return joinTypes(x, y);
}

export function* rangeIntersect(a: RangeObject, b: RangeObject, realm: Realm): ValueEvaluator {
  const low = Q(yield* selectEndpoint({ value: a.RangeStart, bound: a.RangeStartBound }, { value: b.RangeStart, bound: b.RangeStartBound }, true));
  const high = Q(yield* selectEndpoint({ value: a.RangeEnd, bound: a.RangeEndBound }, { value: b.RangeEnd, bound: b.RangeEndBound }, false));
  return CreateRangeObject(low.value, high.value, low.bound, high.bound, realm, selectionDomain(a, b));
}
