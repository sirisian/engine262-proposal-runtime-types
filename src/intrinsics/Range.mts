import {
  Value, ObjectValue, NumberValue, BigIntValue, TypedNumberValue, isTypedNumber, wellKnownSymbols,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw, Q, Get, Call, IsCallable, ToIntegerOrInfinity } from '#self';
import { boundValue, intervalValue } from './RangeEnums.mts';
import {
  rangeContainsRange, rangeIntersect, rangeScale, scaleFactor,
} from '../type-system/range-ops.mts';
import {
  OrdinaryObjectCreate,
  CreateIteratorResultObject,
  F, R,
  type OrdinaryObject,
  Realm,
} from '#self';

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
 * `RangeBounds` operations `contains(range)`, `intersect`, and `scale` with the
 * interval arithmetic, slicing, and the random and Temporal integrations.
 */

export type RangeBound = 'closed' | 'open';

export interface RangeObject extends OrdinaryObject {
  RangeStart: NumberValue | BigIntValue | TypedNumberValue | undefined;
  RangeEnd: NumberValue | BigIntValue | TypedNumberValue | undefined;
  RangeStartBound: RangeBound | undefined;
  RangeEndBound: RangeBound | undefined;
}

export function isRangeObject(value: Value): value is RangeObject {
  return value instanceof ObjectValue && 'RangeStartBound' in value;
}

export function CreateRangeObject(start: NumberValue | BigIntValue | TypedNumberValue | undefined, end: NumberValue | BigIntValue | TypedNumberValue | undefined, startBound: RangeBound | undefined, endBound: RangeBound | undefined, realmRec: Realm): RangeObject {
  const proto = realmRec.Intrinsics['%Range.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['RangeStart', 'RangeEnd', 'RangeStartBound', 'RangeEndBound']) as Mutable<RangeObject>;
  obj.RangeStart = start;
  obj.RangeEnd = end;
  obj.RangeStartBound = startBound;
  obj.RangeEndBound = endBound;
  return obj;
}

interface RangeIteratorObject extends OrdinaryObject {
  IteratedStart: number | bigint;
  IteratedEnd: number | bigint | undefined;
  IteratedStep: number | bigint;
  IteratedEndBound: RangeBound | undefined;
  IteratedIndex: number;
}

/**
 * The index the iteration begins at. An open start excludes its own endpoint, so
 * the first value it yields is one step in: `(0<..<4)` yields 1, 2, 3, and
 * `(0<..).step(0.25)` yields 0.25 first.
 *
 * FEEDBACK: neither ranges.md "Iteration" nor #sec-ranges states this. Both fix
 * the nth value as start + n * step and were written while a closed start was
 * the only start a literal could spell, so an open start's first index is
 * unspecified. n >= 1 for an open start and n >= 0 otherwise is what this
 * implements and what the documents should say.
 */
function firstIndex(startBound: RangeBound | undefined): number {
  return startBound === 'open' ? 1 : 0;
}

function CreateRangeIterator(start: number | bigint, end: number | bigint | undefined, step: number | bigint, startBound: RangeBound | undefined, endBound: RangeBound | undefined, realmRec: Realm): RangeIteratorObject {
  const proto = realmRec.Intrinsics['%RangeIteratorPrototype%'];
  const it = OrdinaryObjectCreate(proto, [
    'IteratedStart', 'IteratedEnd', 'IteratedStep', 'IteratedEndBound', 'IteratedIndex',
  ]) as Mutable<RangeIteratorObject>;
  it.IteratedStart = start;
  it.IteratedEnd = end;
  it.IteratedStep = step;
  it.IteratedEndBound = endBound;
  it.IteratedIndex = firstIndex(startBound);
  return it;
}

// A value is past the end of a range when, iterating in the direction of the
// step, it has reached or passed the endpoint. A range with no end never ends,
// and a closed end admits the endpoint itself.
function reachedEnd(value: number | bigint, end: number | bigint | undefined, step: number | bigint, endBound: RangeBound | undefined): boolean {
  if (end === undefined) {
    return false;
  }
  const inclusive = endBound === 'closed';
  if (step >= 0) {
    return inclusive ? value > end : value >= end;
  }
  return inclusive ? value < end : value <= end;
}

function* RangeIteratorPrototype_next(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  if (!(O instanceof ObjectValue) || !('IteratedIndex' in O)) {
    return Throw.TypeError('$1 is not a range iterator', O);
  }
  const it = O as Mutable<RangeIteratorObject>;
  // The nth value is start + n * step, computed from the index rather than by
  // repeated addition, so a fractional step does not accumulate error.
  // The nth value is start + n * step in the ELEMENT TYPE's arithmetic: a bigint
  // range steps by `1n` and a Number range by `1`, and the two do not mix.
  const value = typeof it.IteratedStart === 'bigint'
    ? it.IteratedStart + BigInt(it.IteratedIndex) * (it.IteratedStep as bigint)
    : it.IteratedStart + it.IteratedIndex * (it.IteratedStep as number);
  if (reachedEnd(value, it.IteratedEnd, it.IteratedStep, it.IteratedEndBound)) {
    return CreateIteratorResultObject(Value.undefined, Value.true);
  }
  it.IteratedIndex += 1;
  return CreateIteratorResultObject(typeof value === 'bigint' ? Value(value) : F(value), Value.false);
}

function thisRange(thisValue: Value): RangeObject | undefined {
  return isRangeObject(thisValue) ? thisValue : undefined;
}

function* RangeProto_startGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return self.RangeStart ?? Value.undefined;
}

function* RangeProto_endGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return self.RangeEnd ?? Value.undefined;
}

// The length of a bounded integer range is the count of its members; a range
// with an unbounded or non-integer endpoint has no finite length here.
function* RangeProto_lengthGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (self.RangeStart === undefined || self.RangeEnd === undefined) {
    return Throw.TypeError('a range without both endpoints has no length');
  }
  const start = (endpointOf(self.RangeStart) as number | bigint);
  const end = (endpointOf(self.RangeEnd) as number | bigint);
  // A bigint endpoint is an integer by construction; the test is the Number one.
  if (typeof start === 'number' && (!Number.isInteger(start) || !Number.isInteger(end as number))) {
    return Throw.TypeError('a range with a non-integer endpoint has no length');
  }
  // The count of members, one adjustment per open endpoint: [a,b] holds
  // b - a + 1, [a,b) and (a,b] hold b - a, and (a,b) holds b - a - 1.
  //
  // FEEDBACK: #sec-ranges gives no length rule for the open forms, having been
  // written when only the closed and half-open ones had literals.
  // #sec-ranges: the count is "one more than the difference of its endpoints
  // less one for each endpoint whose bound excludes its own value". The
  // arithmetic is the ELEMENT TYPE's, so a bigint range counts in bigint and
  // answers a BigInt - a count that a Number could not always hold.
  if (typeof start === 'bigint' && typeof end === 'bigint') {
    let bigSpan = end - start + 1n;
    if (self.RangeStartBound === 'open') {
      bigSpan -= 1n;
    }
    if (self.RangeEndBound === 'open') {
      bigSpan -= 1n;
    }
    return Value(bigSpan > 0n ? bigSpan : 0n);
  }
  if (typeof start !== 'number' || typeof end !== 'number') {
    return Throw.TypeError('a range with a non-integer endpoint has no implicit step; use step(by)');
  }
  let span = end - start + 1;
  if (self.RangeStartBound === 'open') {
    span -= 1;
  }
  if (self.RangeEndBound === 'open') {
    span -= 1;
  }
  return F(span > 0 ? span : 0);
}

function* RangeProto_isEmptyGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (self.RangeStart === undefined || self.RangeEnd === undefined) {
    // An unbounded range is not empty.
    return Value.false;
  }
  const start = (endpointOf(self.RangeStart) as number | bigint);
  const end = (endpointOf(self.RangeEnd) as number | bigint);
  // Descending is empty, as before. At EQUAL endpoints the bounds decide: `5..=5`
  // holds exactly one value, while `5..<5`, `5<..=5`, and `5<..<5` hold none,
  // because an open endpoint excludes the only value the interval could contain.
  const bothClosed = self.RangeStartBound !== 'open' && self.RangeEndBound !== 'open';
  const empty = bothClosed ? start > end : start >= end;
  return empty ? Value.true : Value.false;
}

// A range is full when it constrains nothing, which is exactly the shape with
// neither endpoint.
function* RangeProto_isFullGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return self.RangeStart === undefined && self.RangeEnd === undefined ? Value.true : Value.false;
}

// #sec-ranges: a bound is a value of `Bound`, absent where the shape has no such
// endpoint.
/**
 * #sec-ranges: a range is over an ORDERED element type, and the ordering
 * operations - `contains`, `isEmpty`, `intersect` - are polymorphic over Number
 * and bigint because `R` yields each one's mathematical value and JS compares
 * across them. LENGTH and ITERATION are not: they are integer arithmetic, and an
 * implicit step of one is `1` or `1n` depending on the element type. Until that
 * is threaded through, they answer only for a Number range.
 */
/**
 * An endpoint's mathematical value. A TYPED number is ordered with Number by
 * #sec-matchrange's rule, so it is an endpoint like any other - and reading it
 * here rather than at each operation is what keeps `contains`, `isEmpty`,
 * `intersect`, and the arithmetic from each having to remember it.
 */
export function endpointOf(v: NumberValue | BigIntValue | TypedNumberValue | undefined): number | bigint | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (isTypedNumber(v)) {
    return Number(v.numberValue());
  }
  return R(v);
}

function numericEndpoint(v: NumberValue | BigIntValue | TypedNumberValue | undefined): number | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (!(v instanceof NumberValue)) {
    return undefined;
  }
  return R(v);
}

function boundMember(bound: RangeBound | undefined): Value {
  return bound === undefined ? Value.undefined : boundValue(bound === 'open' ? 'Open' : 'Closed');
}

function* RangeProto_startBoundGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return boundMember(self.RangeStartBound);
}

function* RangeProto_endBoundGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  return boundMember(self.RangeEndBound);
}

// Derived from the two bounds, never stored. Only a two-endpoint range has one of
// the four interval names; a shape missing an endpoint has no pair to name.
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

function* RangeProto_contains([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  // `contains` overloads on a value and on a range. Against a range it is the
  // subset test, so an empty range is contained in every range and the full
  // range contains them all.
  if (isRangeObject(value)) {
    return rangeContainsRange(self, value) ? Value.true : Value.false;
  }
  // #sec-matchrange: containment admits "a value of a type ORDERED WITH the
  // element type", so a typed number counts. Without this a `uint8` reaching
  // `contains` -- which is how a range `case` label sees an enum-like
  // discriminant, and how a typed value reaches a range pattern -- answered
  // false for a value plainly inside the range.
  // #sec-matchrange admits "a value of a type ORDERED WITH the element type", so
  // a typed number counts - and so does a bigint, over a bigint range. `R`
  // yields each one's mathematical value and JS compares across them.
  const numeric: number | bigint | undefined = value instanceof NumberValue ? R(value)
    : (value instanceof BigIntValue ? R(value)
      : (isTypedNumber(value) ? Number(value.numberValue()) : undefined));
  if (numeric === undefined) {
    return Value.false;
  }
  const x = numeric;
  // One comparison per endpoint, each by its own bound.
  if (self.RangeStart !== undefined) {
    const start = (endpointOf(self.RangeStart) as number | bigint);
    const withinStart = self.RangeStartBound === 'open' ? x > start : x >= start;
    if (!withinStart) {
      return Value.false;
    }
  }
  if (self.RangeEnd !== undefined) {
    const end = (endpointOf(self.RangeEnd) as number | bigint);
    const withinEnd = self.RangeEndBound === 'closed' ? x <= end : x < end;
    if (!withinEnd) {
      return Value.false;
    }
  }
  return Value.true;
}

function* RangeProto_intersect([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (!isRangeObject(other)) {
    return Throw.TypeError('$1 is not a range', other);
  }
  return rangeIntersect(self, other, surroundingAgent.currentRealmRecord);
}

function* RangeProto_scale([factor = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  const f = scaleFactor(factor);
  if (f === null || Number.isNaN(f)) {
    return Throw.TypeError('a range scale factor must be a number');
  }
  return rangeScale(self, f, surroundingAgent.currentRealmRecord);
}

// Over an integer range the step is one and implicit. A range with a non-integer
// or missing endpoint needs an explicit step, which `.step` supplies.
function integerIterator(self: RangeObject, realmRec: Realm): RangeIteratorObject | null {
  if (self.RangeStart === undefined) {
    return null;
  }
  const rawStart = (endpointOf(self.RangeStart) as number | bigint);
  const rawEnd = endpointOf(self.RangeEnd);
  const start = rawStart;
  // An INFINITE end is not a member the iteration can stop at, so it stops the
  // iteration nowhere - which is what an ABSENT end already does. The two
  // spellings contain the same values, so they must iterate the same: without
  // this, `0..` counted forever and `0..<Infinity` refused, and containment
  // agreed while iteration disagreed.
  const end = typeof rawEnd === 'number' && !Number.isFinite(rawEnd) ? undefined : rawEnd;
  // A bigint endpoint is an integer by construction; the test below is the
  // Number one.
  if (typeof start === 'number' && (!Number.isInteger(start) || (typeof end === 'number' && !Number.isInteger(end)))) {
    return null;
  }
  if (typeof rawStart === 'bigint') {
    // The implicit step of one, in the element type's arithmetic.
    return CreateRangeIterator(rawStart, rawEnd, 1n, self.RangeStartBound, self.RangeEndBound, realmRec);
  }
  const nStart = numericEndpoint(self.RangeStart);
  if (nStart === undefined) {
    return null;
  }
  return CreateRangeIterator(nStart, numericEndpoint(self.RangeEnd), 1, self.RangeStartBound, self.RangeEndBound, realmRec);
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
  const it = integerIterator(self, surroundingAgent.currentRealmRecord);
  if (it === null) {
    return Throw.TypeError('a range with a non-integer or missing endpoint has no implicit step; use step(by)');
  }
  const fn = Q(yield* Get(it, Value(name)));
  if (!IsCallable(fn)) {
    return Throw.TypeError('$1 is not a function', fn);
  }
  return Q(yield* Call(fn, it, args));
}

function* RangeProto_map(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('map', args, thisValue);
}

function* RangeProto_filter(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('filter', args, thisValue);
}

function* RangeProto_flatMap(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('flatMap', args, thisValue);
}

function* RangeProto_reduce(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('reduce', args, thisValue);
}

function* RangeProto_toArray(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('toArray', args, thisValue);
}

function* RangeProto_forEach(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('forEach', args, thisValue);
}

function* RangeProto_some(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('some', args, thisValue);
}

function* RangeProto_every(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('every', args, thisValue);
}

function* RangeProto_find(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* delegateToIterator('find', args, thisValue);
}

/**
 * ranges.md: `take` and `drop` stay in the FAMILY, where the other nine leave it.
 *
 * They are CLOSED over an integer range: the first n values of a contiguous
 * range are a contiguous range, and so are the rest after the first n. That is
 * the same test `intersect` passes and `step` fails, and it is why these two
 * return a `Range` where `map` and `filter` return an `Iterator` - closure, not
 * uniformity. `(0..<10).take(3).contains(1)` therefore still answers.
 *
 * The result is always CLOSED-OPEN, which normalizes an open start away:
 * `(0<..<10).take(3)` is `1..<4`, not `0<..=3`. Both denote {1, 2, 3}; the
 * closed-open spelling is the one that names the values it actually holds.
 */
function* takeOrDrop(which: 'take' | 'drop', args: Arguments, thisValue: Value): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  const rawStart = endpointOf(self.RangeStart);
  if (rawStart === undefined) {
    // No first value to count from, which is why a range with no start does not
    // iterate either.
    return Throw.TypeError('a range with a non-integer or missing endpoint has no implicit step; use step(by)');
  }
  const rawEnd = endpointOf(self.RangeEnd);
  const big = typeof rawStart === 'bigint';
  if (!big && (!Number.isInteger(rawStart) || (typeof rawEnd === 'number' && Number.isFinite(rawEnd) && !Number.isInteger(rawEnd)))) {
    return Throw.TypeError('a range with a non-integer or missing endpoint has no implicit step; use step(by)');
  }
  const limitValue = Q(yield* ToIntegerOrInfinity(args[0] ?? Value.undefined));
  if (limitValue < 0) {
    return Throw.RangeError('$1 is out of range for $2', args[0] ?? Value.undefined, Value('take'));
  }
  // The first value the range yields: its start, or one step in where the start
  // is open - the same rule the iterator's first index follows.
  const one = big ? 1n : 1;
  const first = self.RangeStartBound === 'open'
    ? (rawStart as number) + (one as number)
    : rawStart;
  // The exclusive end, so the clamp below is one comparison rather than two.
  const endExclusive = rawEnd === undefined || (typeof rawEnd === 'number' && !Number.isFinite(rawEnd))
    ? undefined
    : (self.RangeEndBound === 'open' ? rawEnd : (rawEnd as number) + (one as number));
  const limit = big ? BigInt(limitValue) : limitValue;
  const shifted = (first as number) + (limit as number);
  const clamp = (v: number | bigint) => (endExclusive === undefined ? v : (v < endExclusive ? v : endExclusive));
  const realmRec = surroundingAgent.currentRealmRecord;
  const asValue = (v: number | bigint) => (typeof v === 'bigint' ? Value(v) : F(v));
  if (which === 'take') {
    const end = clamp(shifted);
    return CreateRangeObject(asValue(first), asValue(end), 'closed', 'open', realmRec);
  }
  const newFirst = clamp(shifted);
  return CreateRangeObject(
    asValue(newFirst),
    endExclusive === undefined ? undefined : asValue(endExclusive),
    'closed',
    'open',
    realmRec,
  );
}

function* RangeProto_take(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* takeOrDrop('take', args, thisValue);
}

function* RangeProto_drop(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return yield* takeOrDrop('drop', args, thisValue);
}

function* RangeProto_iterator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  const it = integerIterator(self, surroundingAgent.currentRealmRecord);
  if (it === null) {
    return Throw.TypeError('a range with a non-integer or missing endpoint has no implicit step; use step(by)');
  }
  return it;
}

// ranges.md: "a descending range is empty, not reversed ... `(0..<10).reverse()`
// is how you count down". So `reverse` iterates the SAME members in the opposite
// order, which is a step of -1 from the last member rather than a range with its
// endpoints exchanged - exchanging them would give an empty range by the rule
// above, which is precisely the mistake the rule exists to prevent.
function* RangeProto_reverse(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (self.RangeEnd === undefined) {
    // A descending traversal has to start somewhere, and a range with no end
    // has no last member -- the mirror of a range with no start not iterating.
    return Throw.TypeError('a range with no end cannot be reversed');
  }
  const end = (endpointOf(self.RangeEnd) as number | bigint);
  const start = endpointOf(self.RangeStart);
  // A bigint endpoint is an integer by construction; the test is the Number one.
  if (typeof end === 'number' && (!Number.isInteger(end) || (typeof start === 'number' && !Number.isInteger(start)))) {
    return Throw.TypeError('a range with a non-integer endpoint has no implicit step; use step(by)');
  }
  // The last member is the end itself where the end's bound includes it, and one
  // below where it does not; iteration then runs down to the start, whose own
  // bound decides whether the start is reached.
  if (typeof end === 'bigint') {
    const bigFirst = self.RangeEndBound === 'closed' ? end : end - 1n;
    const bigStop: RangeBound | undefined = self.RangeStartBound === 'open' ? 'open' : 'closed';
    return CreateRangeIterator(bigFirst, start as bigint | undefined, -1n, undefined, bigStop, surroundingAgent.currentRealmRecord);
  }
  if (typeof end !== 'number' || (start !== undefined && typeof start !== 'number')) {
    return Throw.TypeError('a range with a non-integer endpoint has no implicit step; use step(by)');
  }
  const first = self.RangeEndBound === 'closed' ? end : end - 1;
  const stopBound: RangeBound | undefined = self.RangeStartBound === 'open' ? 'open' : 'closed';
  return CreateRangeIterator(first, start, -1, undefined, stopBound, surroundingAgent.currentRealmRecord);
}

function* RangeProto_step([by = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (self.RangeStart === undefined) {
    return Throw.TypeError('a range with no start cannot be iterated');
  }
  if (!(by instanceof NumberValue)) {
    return Throw.TypeError('a range step must be a number');
  }
  const step = R(by);
  if (step === 0 || Number.isNaN(step)) {
    return Throw.TypeError('a range step must be a nonzero number');
  }
  const sStart = numericEndpoint(self.RangeStart);
  if (sStart === undefined) {
    return Throw.TypeError('a range with a non-integer endpoint has no implicit step; use step(by)');
  }
  const sEnd = numericEndpoint(self.RangeEnd);
  return CreateRangeIterator(sStart, typeof sEnd === 'number' && !Number.isFinite(sEnd) ? undefined : sEnd, step, self.RangeStartBound, self.RangeEndBound, surroundingAgent.currentRealmRecord);
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
