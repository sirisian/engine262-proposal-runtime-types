import { Value, TypedNumberValue } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { F } from '../abstract-ops/spec-types.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { CreateRangeObject, type RangeObject, type RangeEndpoint } from '../intrinsics/Range.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { RuntimeTypeOf, fitsNumericType } from './runtime.mts';
import { SameType } from './relations.mts';
import { wrapToType } from './arithmetic.mts';
import { NumericRangeBase, NumericRangeValue, NumericRangeItemDomain } from './range-iteration.mts';
import { AdmitNumericRangeEndpoint } from './range-numeric.mts';

function finiteInteger(value: number | bigint | undefined): value is number | bigint {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value));
}

/** Count the integer lattice, not successful iterator admissions or metadata. */
export function* NumericRangeLength(range: RangeObject): ValueEvaluator {
  const start = NumericRangeValue(range.RangeStart);
  const end = NumericRangeValue(range.RangeEnd);
  if (!finiteInteger(start) || !finiteInteger(end)) return Throw.TypeError('range length requires finite integral numeric endpoints');
  const count = BigInt(end) - BigInt(start) + 1n
    - (range.RangeStartBound === 'open' ? 1n : 0n) - (range.RangeEndBound === 'open' ? 1n : 0n);
  return Value(count > 0n ? count : 0n);
}

/** A new cut must inhabit the item domain without wrap, rounding or rescaling. */
function* boundary(integer: bigint, domain: TypeRecord): PlainEvaluator<RangeEndpoint> {
  const base = NumericRangeBase(domain)!;
  let result: RangeEndpoint;
  if (base.Name === 'bigint') {
    result = Value(integer);
  } else if (base.Name === 'int' || base.Name === 'uint') {
    if (!fitsNumericType(integer, base.Name, base.Arguments)) return Throw.RangeError('range adapter boundary is outside its numeric type');
    result = new TypedNumberValue(wrapToType(integer, base), base);
  } else {
    const rounded = wrapToType(Number(integer), base) as number;
    if (!Number.isFinite(rounded) || BigInt(rounded) !== integer) return Throw.RangeError('range adapter boundary is not exactly representable');
    result = base.Name === 'number' ? F(rounded) : new TypedNumberValue(rounded, base);
  }
  return Q(yield* AdmitNumericRangeEndpoint(result, domain));
}

/** sec-numeric-range-adapters: pure boundary arithmetic, then publication. */
export function* NumericRangeTakeOrDrop(range: RangeObject, which: 'take' | 'drop', count: Value, realm: Realm): ValueEvaluator {
  const start = NumericRangeValue(range.RangeStart);
  const end = NumericRangeValue(range.RangeEnd);
  if (!finiteInteger(start) || (range.RangeEnd !== undefined && end === undefined)
      || (end !== undefined && !finiteInteger(end) && end !== Infinity && end !== -Infinity)) {
    return Throw.TypeError('range adapters require a finite integral numeric start and an integral or infinite numeric end');
  }
  const rawCount = NumericRangeValue(count);
  if (rawCount === undefined) return Throw.TypeError('range adapter count must be numeric');
  if (!finiteInteger(rawCount) || rawCount < 0) return Throw.RangeError('range adapter count must be a nonnegative finite integer');
  const n = BigInt(rawCount);
  const domain = (RuntimeTypeOf(range) as Extract<TypeRecord, { Kind: 'nominal' }>).Arguments[0] as TypeRecord;
  const copy = () => CreateRangeObject(range.RangeStart, range.RangeEnd, range.RangeStartBound, range.RangeEndBound, realm, domain);
  const empty = () => CreateRangeObject(range.RangeStart, range.RangeStart, 'closed', 'open', realm, domain);
  // Validate receiver/endpoints/count before zero, empty, or over-count exits.
  if (n === 0n) return which === 'take' ? empty() : copy();
  const first = BigInt(start) + (range.RangeStartBound === 'open' ? 1n : 0n);
  const last = finiteInteger(end) ? BigInt(end) - (range.RangeEndBound === 'open' ? 1n : 0n) : undefined;
  if (end === -Infinity || (last !== undefined && first > last)) return copy();
  if (last !== undefined && n >= last - first + 1n) return which === 'take' ? copy() : empty();
  const cut = first + n - 1n;
  // Reuse an original endpoint at the same integer: preserve -0 and metadata,
  // and do not re-run admission on an unchanged value.
  const itemDomain = NumericRangeItemDomain(range);
  const value = cut === BigInt(start) && SameType(RuntimeTypeOf(range.RangeStart!), itemDomain) ? range.RangeStart!
    : Q(yield* boundary(cut, itemDomain));
  return which === 'take'
    ? CreateRangeObject(range.RangeStart, value, range.RangeStartBound, 'closed', realm, domain)
    : CreateRangeObject(value, range.RangeEnd, 'open', range.RangeEndBound, realm, domain);
}
