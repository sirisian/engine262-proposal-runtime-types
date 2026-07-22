import {
  Value, ObjectValue, NumberValue, wellKnownSymbols,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw } from '#self';
import {
  OrdinaryObjectCreate,
  CreateIteratorResultObject,
  F, R,
  type OrdinaryObject,
  Realm,
} from '#self';

/**
 * proposal-runtime-types (ranges.md): the Range value and its iteration.
 *
 * A range names an interval as a value. The two literal forms `a..b` and `a..=b`
 * produce a half-open and an inclusive range; the open-ended forms omit an
 * endpoint. This implements the value and its core operations: the endpoints,
 * containment, length and emptiness, iteration over an integer range with an
 * implicit step of one, and an explicit step. The interval kind lives in the
 * value here (the internal slot [[RangeInclusive]]); the design's placement of it
 * in the type, the `uint8.<1..=6>` bounds desugaring, slicing, and the random and
 * Temporal integrations are the extension's deferred remainder.
 */

export interface RangeObject extends OrdinaryObject {
  RangeStart: NumberValue | undefined;
  RangeEnd: NumberValue | undefined;
  RangeInclusive: boolean;
}

export function isRangeObject(value: Value): value is RangeObject {
  return value instanceof ObjectValue && 'RangeInclusive' in value;
}

export function CreateRangeObject(start: NumberValue | undefined, end: NumberValue | undefined, inclusive: boolean, realmRec: Realm): RangeObject {
  const proto = realmRec.Intrinsics['%Range.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['RangeStart', 'RangeEnd', 'RangeInclusive']) as Mutable<RangeObject>;
  obj.RangeStart = start;
  obj.RangeEnd = end;
  obj.RangeInclusive = inclusive;
  return obj;
}

interface RangeIteratorObject extends OrdinaryObject {
  IteratedStart: number;
  IteratedEnd: number | undefined;
  IteratedStep: number;
  IteratedInclusive: boolean;
  IteratedIndex: number;
}

function CreateRangeIterator(start: number, end: number | undefined, step: number, inclusive: boolean, realmRec: Realm): RangeIteratorObject {
  const proto = realmRec.Intrinsics['%RangeIteratorPrototype%'];
  const it = OrdinaryObjectCreate(proto, [
    'IteratedStart', 'IteratedEnd', 'IteratedStep', 'IteratedInclusive', 'IteratedIndex',
  ]) as Mutable<RangeIteratorObject>;
  it.IteratedStart = start;
  it.IteratedEnd = end;
  it.IteratedStep = step;
  it.IteratedInclusive = inclusive;
  it.IteratedIndex = 0;
  return it;
}

// A value is past the end of a range when, iterating in the direction of the
// step, it has reached or passed the endpoint. A range with no end never ends.
function reachedEnd(value: number, end: number | undefined, step: number, inclusive: boolean): boolean {
  if (end === undefined) {
    return false;
  }
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
  const value = it.IteratedStart + it.IteratedIndex * it.IteratedStep;
  if (reachedEnd(value, it.IteratedEnd, it.IteratedStep, it.IteratedInclusive)) {
    return CreateIteratorResultObject(Value.undefined, Value.true);
  }
  it.IteratedIndex += 1;
  return CreateIteratorResultObject(F(value), Value.false);
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
  const start = R(self.RangeStart);
  const end = R(self.RangeEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return Throw.TypeError('a range with a non-integer endpoint has no length');
  }
  const span = end - start + (self.RangeInclusive ? 1 : 0);
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
  const start = R(self.RangeStart);
  const end = R(self.RangeEnd);
  const empty = self.RangeInclusive ? start > end : start >= end;
  return empty ? Value.true : Value.false;
}

function* RangeProto_contains([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const self = thisRange(thisValue);
  if (!self) {
    return Throw.TypeError('$1 is not a range', thisValue);
  }
  if (!(value instanceof NumberValue)) {
    return Value.false;
  }
  const x = R(value);
  if (self.RangeStart !== undefined && x < R(self.RangeStart)) {
    return Value.false;
  }
  if (self.RangeEnd !== undefined) {
    const end = R(self.RangeEnd);
    const withinEnd = self.RangeInclusive ? x <= end : x < end;
    if (!withinEnd) {
      return Value.false;
    }
  }
  return Value.true;
}

// Over an integer range the step is one and implicit. A range with a non-integer
// or missing endpoint needs an explicit step, which `.step` supplies.
function integerIterator(self: RangeObject, realmRec: Realm): RangeIteratorObject | null {
  if (self.RangeStart === undefined) {
    return null;
  }
  const start = R(self.RangeStart);
  const end = self.RangeEnd === undefined ? undefined : R(self.RangeEnd);
  if (!Number.isInteger(start) || (end !== undefined && !Number.isInteger(end))) {
    return null;
  }
  return CreateRangeIterator(start, end, 1, self.RangeInclusive, realmRec);
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
  const start = R(self.RangeStart);
  const end = self.RangeEnd === undefined ? undefined : R(self.RangeEnd);
  return CreateRangeIterator(start, end, step, self.RangeInclusive, surroundingAgent.currentRealmRecord);
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
    ['length', [RangeProto_lengthGetter]],
    ['isEmpty', [RangeProto_isEmptyGetter]],
    ['contains', RangeProto_contains, 1],
    ['step', RangeProto_step, 1],
    [wellKnownSymbols.iterator, RangeProto_iterator, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Range');
  realmRec.Intrinsics['%Range.prototype%'] = proto;
}
