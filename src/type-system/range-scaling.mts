import { Value } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { exactNumericValue } from '../abstract-ops/testing-comparison.mts';
import { CreateRangeObject, type RangeObject, type RangeEndpoint, type RangeBound } from '../intrinsics/Range.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { RuntimeTypeOf } from './runtime.mts';
import { RangeIsEmpty } from './range-selection.mts';
import { numericBase, numericDomain, negativeZero, numericRangeValue, numericRangeInfinity, type Fraction } from './range-numeric.mts';

type Edge = { value: RangeEndpoint | undefined; bound: RangeBound | undefined };
const numberType: TypeRecord = { Kind: 'primitive', Name: 'number', Arguments: [] };

function* scaleEdge(value: RangeEndpoint | undefined, bound: RangeBound | undefined, factor: Fraction, upper: boolean, realm: Realm): PlainEvaluator<Edge> {
  if (value === undefined) return { value, bound };
  const domain = RuntimeTypeOf(value);
  const x = exactNumericValue(value)!;
  if (x.kind === 'infinity') {
    const sign = x.sign * (factor.n < 0n ? -1 : 1);
    return { value: Q(yield* numericRangeInfinity(domain, sign < 0 ? -1 : 1, realm)), bound };
  }
  if (x.kind !== 'finite') return Throw.TypeError('range scaling requires ordered numeric endpoints');
  const product = { n: x.n * factor.n, d: x.d * factor.d };
  const negative = (x.n < 0n || negativeZero(value)) !== (factor.n < 0n);
  const scaled = Q(yield* numericRangeValue(domain, product, upper, negative, realm, value, factor.n === -factor.d));
  return { value: scaled.value, bound: scaled.rounded ? 'closed' : bound };
}

/** sec-numeric-range-scaling: validate, compute/admit in source order, publish. */
export function* NumericRangeScale(range: RangeObject, factor: Value, realm: Realm): ValueEvaluator {
  const domain = (RuntimeTypeOf(range) as Extract<TypeRecord, { Kind: 'nominal' }>).Arguments[0] as TypeRecord;
  if (!numericDomain(domain)) return Throw.TypeError('range scaling requires a numeric endpoint domain');
  for (const endpoint of [range.RangeStart, range.RangeEnd]) {
    if (endpoint === undefined) continue;
    const x = exactNumericValue(endpoint);
    if (!numericBase(RuntimeTypeOf(endpoint)) || !x || (x.kind !== 'finite' && x.kind !== 'infinity')) return Throw.TypeError('range scaling requires ordered numeric endpoints');
  }
  const f = exactNumericValue(factor);
  if (!f || f.kind !== 'finite') return Throw.TypeError('a range scale factor must be a finite real numeric value');
  const copy = () => CreateRangeObject(range.RangeStart, range.RangeEnd, range.RangeStartBound, range.RangeEndBound, realm, domain);
  if (Q(yield* RangeIsEmpty(range)) || f.n === f.d) return copy();
  if (f.n === 0n) {
    const zeroDomain = numericBase(domain) ? domain : range.RangeStart !== undefined ? RuntimeTypeOf(range.RangeStart)
      : range.RangeEnd !== undefined ? RuntimeTypeOf(range.RangeEnd) : domain.Kind === 'any' ? numberType : undefined;
    if (!zeroDomain) return Throw.TypeError('zero scaling requires a determined numeric endpoint type');
    const zero = Q(yield* numericRangeValue(zeroDomain, { n: 0n, d: 1n }, false, false, realm));
    return CreateRangeObject(zero.value, zero.value, 'closed', 'closed', realm, domain);
  }
  const reverse = f.n < 0n;
  const start = Q(yield* scaleEdge(range.RangeStart, range.RangeStartBound, f, reverse, realm));
  const end = Q(yield* scaleEdge(range.RangeEnd, range.RangeEndBound, f, !reverse, realm));
  return reverse
    ? CreateRangeObject(end.value, start.value, end.bound, start.bound, realm, domain)
    : CreateRangeObject(start.value, end.value, start.bound, end.bound, realm, domain);
}
