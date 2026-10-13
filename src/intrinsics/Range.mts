import {
  Value, ObjectValue, NumberValue, BigIntValue, TypedNumberValue, isTypedNumber, wellKnownSymbols,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { ScaleMetadataValue } from '../abstract-ops/runtime-types.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { RuntimeTypeOf } from '../type-system/runtime.mts';
import { exactNumericValue } from '../abstract-ops/testing-comparison.mts';
import { type Mutable } from '../utils/language.mts';
import { CreateNumericRangeIterator, NumericRangeIteratorNext } from '../type-system/range-iteration.mts';
import { NumericRangeLength, NumericRangeTakeOrDrop } from '../type-system/range-adapters.mts';
import { RangeEndpointCompare, RangeIsEmpty, rangeContainsRange, rangeIntersect } from '../type-system/range-selection.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw, Q, Get, Call, IsCallable } from '#self';
import { boundValue, intervalValue } from './RangeEnums.mts';
import {
  rangeScale, scaleFactor,
} from '../type-system/range-ops.mts';
import {

  OrdinaryObjectCreate,
  R,
  type OrdinaryObject,
  Realm,
} from '#self';

/**
 * What a range endpoint may be. proposal-runtime-types #sec-ranges makes a range
 * "a value type class over an ORDERED element type", which ranges.md constrains
 * as `RangeBounds<T: Ordered.<T>>` - an interface of one operator. So an
 * endpoint is a number, a bigint, or a value of a type declaring `operator<`.
 */
export type RangeEndpoint = NumberValue | BigIntValue | TypedNumberValue | ObjectValue;

/**
 * proposal-runtime-types (ranges.md "Types", #sec-ranges): the Range value and
 * its iteration.
 *
 * A range names an interval as a value, and carries A BOUND PER ENDPOINT rather
 * than one flag: [[RangeStartBound]] and [[RangeEndBound]] are each 'closed',
 * 'open', or ~undefined~ exactly where that endpoint is absent. That mirrors the
 * shape-independent endpoint view `RangeBounds` exposes -- start, end,
 * startBound, endBound -- so nothing here re-derives a range's shape from slot
 * absence plus a boolean, and the four intervals of a two-endpoint range are the
 * four pairs with nothing else expressible.
 *
 * One object models all four shapes. `Range`, `RangeFrom`, `RangeTo`, and
 * `RangeFull` are the TYPE system's classification of them, and an absent slot
 * is how this dynamic model already says which one it has.
 *
 * `interval` is DERIVED from the two bounds and never stored, per ranges.md: a
 * stored copy would be a second source of truth. Its exposed values are the
 * strings 'closed', 'closedOpen', 'openClosed', and 'open' until the design's
 * enum intrinsics exist.
 *
 * Deferred: the bounds' placement in the type (`Range.<T, S, E>`), the
 * `RangeBounds` operation `scale` with the
 * interval arithmetic, slicing, and the random and Temporal integrations.
 */

export type RangeBound = 'closed' | 'open';

export interface RangeObject extends OrdinaryObject {
  RangeElementType?: TypeRecord;
  RangeStart: RangeEndpoint | undefined;
  RangeEnd: RangeEndpoint | undefined;
  RangeStartBound: RangeBound | undefined;
  RangeEndBound: RangeBound | undefined;
}

export function isRangeObject(value: Value): value is RangeObject {
  return value instanceof ObjectValue && 'RangeStartBound' in value;
}

export function CreateRangeObject(start: RangeEndpoint | undefined, end: RangeEndpoint | undefined, startBound: RangeBound | undefined, endBound: RangeBound | undefined, realmRec: Realm, elementType?: TypeRecord): RangeObject {
  const proto = realmRec.Intrinsics['%Range.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['RangeStart', 'RangeEnd', 'RangeStartBound', 'RangeEndBound', 'RangeElementType']) as Mutable<RangeObject>;
  obj.RangeElementType = elementType;
  obj.RangeStart = start;
  obj.RangeEnd = end;
  obj.RangeStartBound = startBound;
  obj.RangeEndBound = endBound;
  return obj;
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-numeric-range-iteration */
function* RangeIteratorPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* NumericRangeIteratorNext(thisValue);
}

function thisRange(thisValue: Value): RangeObject | undefined {
  return isRangeObject(thisValue) ? thisValue : undefined;
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_startGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return self.RangeStart ?? Value.undefined;
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_endGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return self.RangeEnd ?? Value.undefined;
}

// The length of a bounded integer range is the count of its members; a range
// with an unbounded or non-integer endpoint has no finite length here.
/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_lengthGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return yield* NumericRangeLength(self);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_isEmptyGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  const empty = Q(yield* RangeIsEmpty(self));
  return empty ? Value.true : Value.false;
}

// A range is full when it constrains nothing, which is exactly the shape with
// neither endpoint.
/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_isFullGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return self.RangeStart === undefined && self.RangeEnd === undefined ? Value.true : Value.false;
}

/**
 * Legacy endpoint reader for arithmetic, random, and static range analysis.
 * Numeric cursors use range-iteration.mts's exact reader; ordering operations
 * use range-selection.mts. This reader does not certify those other arithmetic
 * consumers for wide typed integers or custom ordered domains.
 */
export function endpointOf(v: RangeEndpoint | undefined): number | bigint | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (isTypedNumber(v)) {
    return Number(v.numberValue());
  }
  // An endpoint of a user-declared ordered type has no mathematical value: it is
  // compared through `operator<` rather than converted. Every caller here wants
  // a number - `length`, `scale`, the numeric comparisons - and each is
  // arithmetic that `Ordered` does not carry, which is the same reason `scale`
  // lives on the `Scalable` instantiations only.
  if (v instanceof ObjectValue) {
    return undefined;
  }
  return R(v);
}

function boundMember(bound: RangeBound | undefined): Value {
  return bound === undefined ? Value.undefined : boundValue(bound === 'open' ? 'Open' : 'Closed');
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_startBoundGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return boundMember(self.RangeStartBound);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_endBoundGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return boundMember(self.RangeEndBound);
}

// Derived from the two bounds, never stored. Only a two-endpoint range has one of
// the four interval names; a shape missing an endpoint has no pair to name.
/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_intervalGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (self.RangeStartBound === undefined || self.RangeEndBound === undefined) {
    return Value.undefined;
  }
  // #sec-ranges: "The four-way name of a pair is an `Interval`". A member of the
  // enum, not a string: the name exists to be switched over exhaustively, and a
  // string carries neither exhaustiveness nor narrowing.
  const closedStart = self.RangeStartBound === 'closed';
  const closedEnd = self.RangeEndBound === 'closed';
  if (closedStart) {
    return intervalValue(closedEnd ? 'Closed' : 'ClosedOpen');
  }
  return intervalValue(closedEnd ? 'OpenClosed' : 'Open');
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_contains([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (isRangeObject(value)) {
    const contains = Q(yield* rangeContainsRange(self, value));
    return contains ? Value.true : Value.false;
  }
  // Preserve the existing refusal of nonnumeric primitive candidates. Class
  // candidates are compared by their declared ordering, without coercion.
  const numeric = exactNumericValue(value);
  if (numeric?.kind === 'nan' || (!(value instanceof ObjectValue) && numeric === undefined)) return Value.false;
  if (self.RangeStart !== undefined) {
    const order = Q(yield* RangeEndpointCompare(self.RangeStart, value));
    if (order > 0 || (order === 0 && self.RangeStartBound === 'open')) return Value.false;
  }
  if (self.RangeEnd !== undefined) {
    const order = Q(yield* RangeEndpointCompare(value, self.RangeEnd));
    if (order > 0 || (order === 0 && self.RangeEndBound === 'open')) return Value.false;
  }
  return Value.true;
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_intersect([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (!isRangeObject(other)) {
    return Throw.TypeError('$1 is not a range', other);
  }
  return Q(yield* rangeIntersect(self, other, surroundingAgent.currentRealmRecord));
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_scale([factor = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  const exact = exactNumericValue(factor);
  if (exact?.kind === 'finite' && !(factor instanceof NumberValue)) {
    if (exact.n === 0n) return rangeScale(self, 0, surroundingAgent.currentRealmRecord);
    const scale = function* (endpoint: RangeEndpoint | undefined): PlainEvaluator<RangeEndpoint | undefined> {
      if (endpoint === undefined) return undefined;
      const type = RuntimeTypeOf(endpoint);
      return Q(yield* ScaleMetadataValue(endpoint, exact.n, exact.d, type.Kind === 'parameterized' ? type.Base : type)) as RangeEndpoint;
    };
    const start = Q(yield* scale(self.RangeStart));
    const end = Q(yield* scale(self.RangeEnd));
    return exact.n < 0n
      ? CreateRangeObject(end, start, self.RangeEndBound, self.RangeStartBound, surroundingAgent.currentRealmRecord)
      : CreateRangeObject(start, end, self.RangeStartBound, self.RangeEndBound, surroundingAgent.currentRealmRecord);
  }
  const f = scaleFactor(factor);
  if (f === null || Number.isNaN(f)) {
    return Throw.TypeError('a range scale factor must be a number');
  }
  return rangeScale(self, f, surroundingAgent.currentRealmRecord);
}

/**
 * ranges.md: the ITERATOR HELPERS, on a range.
 *
 * Each constructs a FRESH iterator and forwards, which is the whole design. A
 * range is a VALUE - reusable, structurally compared, still answering
 * `contains` after being traversed - where an iterator is a single-use cursor.
 * Making a range *be* an iterator would make `[...r]` consume it; delegating
 * keeps `r.map(f)` callable twice and `r` a value afterwards.
 *
 * The range's own iterator already inherits `Iterator.prototype`, so the
 * forwarded method is the built-in one and the resulting chain is BRANDED -
 * standardlibrary.md's fast path, rather than the structural check a
 * hand-written iterable pays on the way in.
 */
function* delegateToIterator(name: string, args: Arguments, thisValue: Value): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  // ranges.md: a helper that must consume EVERY value cannot run on a range with
  // no end. `toArray`, `reduce`, and `forEach` each read the whole sequence, so
  // on `0..` they would not return - refusing says so instead of hanging, in the
  // way `sec-ranges` already makes a range with no START not iterable.
  //
  // `some`, `every`, and `find` are exempt, and the reason is short-circuiting
  // rather than which verdict they return: `every` stops at the first value that
  // fails exactly as `some` stops at the first that passes, so all three
  // terminate whenever the predicate decides. Grouping `every` with `toArray`
  // would refuse `(0..).every(v => v < 5)`, which answers false immediately.
  //
  // A positive infinite stop is endless for finite forward progression too.
  // Negative infinity instead makes a finite-origin forward interval empty.
  if (name === 'toArray' || name === 'reduce' || name === 'forEach') {
    const endValue = self.RangeEnd === undefined ? undefined : exactNumericValue(self.RangeEnd);
    const endless = self.RangeEnd === undefined
      || (endValue?.kind === 'infinity' && endValue.sign === 1);
    if (endless) {
      return Throw.TypeError('a range with no end cannot be consumed entirely; bound it with take(n)');
    }
  }
  const it = Q(yield* CreateNumericRangeIterator(self, surroundingAgent.currentRealmRecord));
  const fn = Q(yield* Get(it, Value(name)));
  if (!IsCallable(fn)) {
    return Throw.TypeError('$1 is not a function', fn);
  }
  return Q(yield* Call(fn, it, args));
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_map(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('map', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_filter(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('filter', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_flatMap(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('flatMap', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_reduce(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('reduce', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_toArray(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('toArray', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_forEach(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('forEach', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_some(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('some', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_every(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('every', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_find(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('find', args, thisValue);
}

/** Range adapters compute exact unit-lattice boundaries without enumeration. */
function* takeOrDrop(which: 'take' | 'drop', args: Arguments, thisValue: Value): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) return Throw.TypeError('$1 is not a range', thisValue);
  return yield* NumericRangeTakeOrDrop(self, which, args[0] ?? Value.undefined, surroundingAgent.currentRealmRecord);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_take(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* takeOrDrop('take', args, thisValue);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_drop(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* takeOrDrop('drop', args, thisValue);
}

function* RangeProto_iterator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  const it = Q(yield* CreateNumericRangeIterator(self, surroundingAgent.currentRealmRecord));
  return it;
}

// ranges.md: "a descending range is empty, not reversed ... `(0..<10).reverse()`
// is how you count down". So `reverse` iterates the SAME members in the opposite
// order, which is a step of -1 from the last member rather than a range with its
// endpoints exchanged - exchanging them would give an empty range by the rule
// above, which is precisely the mistake the rule exists to prevent.
/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_reverse(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return yield* CreateNumericRangeIterator(self, surroundingAgent.currentRealmRecord, true);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-ranges */
function* RangeProto_step([by = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return yield* CreateNumericRangeIterator(self, surroundingAgent.currentRealmRecord, false, by);
}

export function bootstrapRangeIteratorPrototype(realmRec: Realm): void {
  const proto = bootstrapPrototype(realmRec, [
    ['next', RangeIteratorPrototype_next, 0],
  ], realmRec.Intrinsics['%Iterator.prototype%'], 'Range Iterator');
  realmRec.Intrinsics['%RangeIteratorPrototype%'] = proto;
}

export function bootstrapRangePrototype(realmRec: Realm): void {
  const proto = bootstrapPrototype(realmRec, [
    ['start', [RangeProto_startGetter]],
    ['end', [RangeProto_endGetter]],
    ['startBound', [RangeProto_startBoundGetter]],
    ['endBound', [RangeProto_endBoundGetter]],
    ['interval', [RangeProto_intervalGetter]],
    ['length', [RangeProto_lengthGetter]],
    ['isEmpty', [RangeProto_isEmptyGetter]],
    ['isFull', [RangeProto_isFullGetter]],
    ['contains', RangeProto_contains, 1],
    ['intersect', RangeProto_intersect, 1],
    ['scale', RangeProto_scale, 1],
    ['reverse', RangeProto_reverse, 0],
    ['step', RangeProto_step, 1],
    ['map', RangeProto_map, 1],
    ['filter', RangeProto_filter, 1],
    ['flatMap', RangeProto_flatMap, 1],
    ['reduce', RangeProto_reduce, 1],
    ['toArray', RangeProto_toArray, 0],
    ['forEach', RangeProto_forEach, 1],
    ['some', RangeProto_some, 1],
    ['every', RangeProto_every, 1],
    ['find', RangeProto_find, 1],
    ['take', RangeProto_take, 1],
    ['drop', RangeProto_drop, 1],
    [wellKnownSymbols.iterator, RangeProto_iterator, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Range');
  realmRec.Intrinsics['%Range.prototype%'] = proto;
}
