import { Value, NumberValue, BigIntValue, ObjectValue, TypedNumberValue, isTypedNumber } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { R, F } from '../abstract-ops/spec-types.mts';
import { OrdinaryObjectCreate, CreateIteratorResultObject } from '../abstract-ops/all.mts';
import { RequireType } from '../abstract-ops/runtime-types.mts';
import { Throw } from '../host-defined/error-messages.mts';
import type { RangeObject, RangeEndpoint, RangeBound } from '../intrinsics/Range.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { fitsNumericType, RuntimeTypeOf } from './runtime.mts';
import { wrapToType } from './arithmetic.mts';

type NumericType = Extract<TypeRecord, { Kind: 'primitive' }>;
type Numeric = number | bigint;
interface NumericCursor {
  domain: TypeRecord;
  base: NumericType;
  start: Numeric;
  end: Numeric | undefined;
  step: Numeric;
  index: bigint;
  endBound: RangeBound | undefined;
  exact: boolean;
  reverse: boolean;
  previous: Numeric | undefined;
  done: boolean;
  executing: boolean;
}

// Internal cursor state does not change the range or expose mutable properties.
const cursors = new WeakMap<ObjectValue, NumericCursor>();
const numberType: NumericType = { Kind: 'primitive', Name: 'number', Arguments: [] };

function numericBase(type: TypeRecord | undefined): NumericType | undefined {
  if (type?.Kind === 'parameterized') return numericBase(type.Base);
  if (type?.Kind === 'primitive' && ['number', 'bigint', 'int', 'uint', 'float16', 'float32', 'float64'].includes(type.Name)) return type;
  return undefined;
}

/** This reader never treats an unsupported present endpoint as an absent one. */
function numericValue(value: Value | undefined): Numeric | undefined {
  // R deliberately erases negative zero; a cursor retains its stored origin.
  if (value instanceof NumberValue) return value.numberValue(); // eslint-disable-line @engine262/mathematical-value
  if (value instanceof BigIntValue) return R(value);
  if (value && isTypedNumber(value) && numericBase(RuntimeTypeOf(value))) return value.value;
  return undefined;
}

function integral(value: Numeric): boolean {
  return typeof value === 'bigint' || Number.isInteger(value);
}

function typedEndpoint(value: RangeEndpoint | undefined): TypeRecord | undefined {
  if (value instanceof BigIntValue || (value && isTypedNumber(value))) return RuntimeTypeOf(value);
  return undefined;
}

/** Iterator items and endpoint-domain reflection are distinct judgments. */
function itemDomain(range: RangeObject): TypeRecord {
  if (numericBase(range.RangeElementType)) return range.RangeElementType!;
  return typedEndpoint(range.RangeStart) ?? typedEndpoint(range.RangeEnd) ?? numberType;
}

function pastEnd(value: Numeric, cursor: NumericCursor): boolean {
  if (cursor.end === undefined) return false;
  if (cursor.reverse) return cursor.endBound === 'closed' ? value < cursor.end : value <= cursor.end;
  return cursor.endBound === 'closed' ? value > cursor.end : value >= cursor.end;
}

/** sec-numeric-range-iteration: acquisition validates without enumerating. */
export function* CreateNumericRangeIterator(range: RangeObject, realm: Realm, reverse = false, by?: Value): PlainEvaluator<ObjectValue> {
  const origin = reverse ? range.RangeEnd : range.RangeStart;
  const stop = reverse ? range.RangeStart : range.RangeEnd;
  if (origin === undefined) return Throw.TypeError('a range without a traversal origin cannot be iterated');
  const start = numericValue(origin);
  const end = numericValue(stop);
  if (start === undefined || (stop !== undefined && end === undefined)) {
    return Throw.TypeError('range iteration requires numeric endpoints');
  }
  if (typeof start === 'number' && !Number.isFinite(start)) {
    return Throw.TypeError('range iteration requires a finite origin');
  }
  if (typeof end === 'number' && Number.isNaN(end)) return Throw.TypeError('range iteration requires ordered endpoints');
  const domain = itemDomain(range);
  const base = numericBase(domain);
  if (!base) return Throw.TypeError('range iteration requires a numeric item type');
  let step: Numeric = 1n;
  if (by !== undefined) {
    const supplied = numericValue(by);
    if (supplied === undefined || supplied <= 0 || (typeof supplied === 'number' && !Number.isFinite(supplied))) {
      return Throw.TypeError('a range step must be a positive finite numeric value');
    }
    step = supplied;
  } else if (!integral(start) || (end !== undefined && (typeof end === 'bigint' || Number.isFinite(end)) && !integral(end))) {
    return Throw.TypeError('a range with a non-integer endpoint has no implicit step; use step(by)');
  }
  const integerCarrier = base.Name === 'int' || base.Name === 'uint' || base.Name === 'bigint';
  if (integerCarrier && (!integral(start) || !integral(step))) return Throw.TypeError('an integer range requires an integral origin and step');
  const exact = integral(start) && integral(step);
  // Fractional progression uses binary64 multiply, then add, then item-width
  // rounding. A wider integer operand must not be silently rounded on entry.
  if (!exact && [start, step].some((x) => typeof x === 'bigint' && (!Number.isFinite(Number(x)) || BigInt(Number(x)) !== x))) {
    return Throw.RangeError('a fractional range progression requires exactly representable operands');
  }
  const startBound = reverse ? range.RangeEndBound : range.RangeStartBound;
  const endBound = reverse ? range.RangeStartBound : range.RangeEndBound;
  const empty = end !== undefined && ((reverse ? start < end : start > end)
    || (start >= end && start <= end && (startBound === 'open' || endBound === 'open')));
  const cursor: NumericCursor = {
    domain, base, start, end, step: reverse ? -step : step, exact, reverse,
    index: startBound === 'open' ? 1n : 0n,
    endBound,
    previous: startBound === 'open' ? start : undefined,
    done: empty, executing: false,
  };
  // Advertise hidden state to existing admission rules for opaque objects.
  const iterator = OrdinaryObjectCreate(realm.Intrinsics['%RangeIteratorPrototype%'], ['NumericRangeIteratorState']);
  cursors.set(iterator, cursor);
  return iterator;
}

/** sec-numeric-range-iteration: checked items, fused exhaustion and failures. */
export function* NumericRangeIteratorNext(value: Value): ValueEvaluator {
  const cursor = value instanceof ObjectValue ? cursors.get(value) : undefined;
  if (!cursor) return Throw.TypeError('$1 is not a range iterator', value);
  if (cursor.executing) return Throw.TypeError('a range iterator is already executing');
  if (cursor.done) return CreateIteratorResultObject(Value.undefined, Value.true);
  cursor.executing = true;
  // Any abrupt admission leaves this cursor exhausted, including metadata
  // checks. Reentrancy cannot observe a half-published index or previous item.
  cursor.done = true;
  try {
    let item: Numeric;
    if (cursor.exact) {
      item = BigInt(cursor.start) + cursor.index * BigInt(cursor.step);
    } else {
      const raw = cursor.index === 0n ? Number(cursor.start)
        : Number(cursor.start) + Number(cursor.index) * Number(cursor.step);
      item = wrapToType(raw, cursor.base);
    }
    // An excluded stop or a next value beyond the endpoint is not an item and
    // need not fit the carrier. Floating bounds compare the rounded item.
    if (pastEnd(item, cursor)) return CreateIteratorResultObject(Value.undefined, Value.true);
    let result: Value;
    if (cursor.base.Name === 'bigint') {
      result = Value(BigInt(item));
    } else if (cursor.base.Name === 'int' || cursor.base.Name === 'uint') {
      if (!fitsNumericType(item, cursor.base.Name, cursor.base.Arguments)) {
        return Throw.RangeError('a range item is outside its numeric type');
      }
      result = new TypedNumberValue(wrapToType(item, cursor.base), cursor.base);
    } else {
      const rounded = wrapToType(Number(item), cursor.base) as number;
      if (!Number.isFinite(rounded) || (cursor.exact && BigInt(rounded) !== item)) {
        return Throw.RangeError('a range item is not exactly representable in its numeric type');
      }
      // The closed origin is its stored value, including negative zero.
      const numeric = cursor.index === 0n && cursor.start === 0 ? Number(cursor.start) : rounded;
      item = numeric;
      result = cursor.base.Name === 'number' ? F(numeric) : new TypedNumberValue(numeric, cursor.base);
    }
    if (cursor.previous !== undefined && (cursor.reverse ? item >= cursor.previous : item <= cursor.previous)) {
      return Throw.RangeError('a range progression must advance');
    }
    if (cursor.domain !== cursor.base) {
      result = Q(yield* RequireType(result, cursor.domain));
      const admitted = numericValue(result);
      if (admitted === undefined || admitted < item || admitted > item
          || (typeof admitted === 'number' && Number.isNaN(admitted))
          || (item === 0 && !Object.is(admitted, item))) {
        return Throw.RangeError('range item admission must preserve its numeric value');
      }
    }
    cursor.previous = item;
    cursor.index += 1n;
    // Cross-representation equality (for example bigint cursor vs Number end).
    cursor.done = cursor.end !== undefined && item >= cursor.end && item <= cursor.end;
    return CreateIteratorResultObject(result, Value.false);
  } finally {
    cursor.executing = false;
  }
}
