import { test, expect } from 'vitest';
import { SequenceAssignment, slotReceiving, type Slot } from '../../../../src/type-system/sequence-assignment.mts';

/**
 * PLAN-rest-parameters.md phase 2: SequenceAssignment, per
 * #sec-sequenceassignment.
 *
 * This is the operation the whole feature rests on, and it has no consumers
 * yet - phase 3 gives it to tuples and phase 4 to calls - so it is tested
 * directly rather than through a script. That is deliberate: the clause's
 * acceptance criterion is a property of the ALGORITHM (the assignment returned
 * is the lexicographically greatest count list), and a property is easier to
 * pin at the module than through the two callers that will consume it.
 *
 * The design's worked examples are the cases that matter, since they are what
 * the README prints and what a reader will check the engine against.
 */

const fixed: Slot = { Rest: false, Optional: false };
const optional: Slot = { Rest: false, Optional: true };
const rest: Slot = { Rest: true, Optional: false };
const all = () => true;

test('an empty pattern matches an empty sequence and nothing else', () => {
  expect(SequenceAssignment([], 0, all)).toEqual([]);
  expect(SequenceAssignment([], 1, all)).toBe('unmatched');
});

test('fixed slots take exactly one each', () => {
  expect(SequenceAssignment([fixed, fixed], 2, all)).toEqual([1, 1]);
  expect(SequenceAssignment([fixed, fixed], 1, all)).toBe('unmatched');
  expect(SequenceAssignment([fixed, fixed], 3, all)).toBe('unmatched');
});

test('an optional slot takes one or none', () => {
  expect(SequenceAssignment([fixed, optional], 2, all)).toEqual([1, 1]);
  expect(SequenceAssignment([fixed, optional], 1, all)).toEqual([1, 0]);
});

test('a rest is greedy, and gives back for the slots after it', () => {
  // The design's worked example: `f(...a: [].<uint32>, ...b: [].<uint32>,
  // c: uint32)` called `f(0, 1, 2)` binds a to [0, 1], b to [], c to 2.
  //
  // The path is the one the clause's note describes: the first rest takes all
  // three, the tail cannot be satisfied, it yields to two, the second rest then
  // takes the one remaining and `c` cannot be satisfied, it yields to none, and
  // the assignment settles.
  expect(SequenceAssignment([rest, rest, fixed], 3, all)).toEqual([2, 0, 1]);

  // Greedy from the LEFT is observable when nothing forces a give-back: the
  // first rest takes everything and the second takes none.
  expect(SequenceAssignment([rest, rest], 3, all)).toEqual([3, 0]);
});

test('the types decide where one run ends and the next begins', () => {
  // `f(a: string, ...args: [].<uint32>, ...args2: [].<string>, callback)`
  // called with ('a', 0, 1, 2, 'a', 'b', fn). No rule about precedence is
  // needed: the admits predicate stops each rest at the first item it cannot
  // take, which is the whole of what splits the runs.
  const kinds = ['string', 'uint32', 'uint32', 'uint32', 'string', 'string', 'fn'];
  const want = ['string', 'uint32', 'string', 'fn'];
  const slots: Slot[] = [fixed, rest, rest, fixed];
  expect(SequenceAssignment(slots, kinds.length, (i, k) => kinds[i] === want[k])).toEqual([1, 3, 2, 1]);
});

test('untyped rests are bounded by the typed parameters around them', () => {
  // `f(...args1, callback1: () => void, ...args2, callback2: () => void)` called
  // with ('a', 1, 1.0, fn, 'b', 2, 2.0, fn). The design once explained this with
  // a rule that "dynamic types have less precedence than typed parameters";
  // no such rule exists or is needed. An untyped rest admits everything, and
  // greedy matching with backtracking produces the documented binding anyway,
  // because a longer first run leaves no function for the last slot.
  const kinds = ['string', 'num', 'num', 'fn', 'string', 'num', 'num', 'fn'];
  const slots: Slot[] = [rest, fixed, rest, fixed];
  expect(SequenceAssignment(slots, kinds.length, (i, k) => (slots[k].Rest || kinds[i] === 'fn'))).toEqual([3, 1, 3, 1]);
});

test('a sequence no distribution admits is unmatched', () => {
  // A required slot the item cannot satisfy.
  expect(SequenceAssignment([fixed], 1, () => false)).toBe('unmatched');
  // More items than the pattern can hold.
  expect(SequenceAssignment([fixed, optional], 3, all)).toBe('unmatched');
  // A rest cannot rescue a required slot that follows it and admits nothing.
  const slots: Slot[] = [rest, fixed];
  expect(SequenceAssignment(slots, 2, (_i, k) => slots[k].Rest)).toBe('unmatched');
});

test('the assignment is the lexicographically greatest one that matches', () => {
  // The clause's determinism claim, which is what lets an implementation use
  // any method that agrees. With three rests over four items every distribution
  // matches, and the greatest is the one that gives the first slot everything.
  expect(SequenceAssignment([rest, rest, rest], 4, all)).toEqual([4, 0, 0]);

  // And with a fixed slot at the end, the greatest that still matches.
  expect(SequenceAssignment([rest, rest, rest, fixed], 4, all)).toEqual([3, 0, 0, 1]);
});

test('the search is bounded rather than exponential', () => {
  // Memoization is a bound, not a tuning: eight rests over sixty items is
  // astronomically many distributions, and the memo visits each (slot, item)
  // state once. A naive matcher does not return from this.
  const slots: Slot[] = Array.from({ length: 8 }, () => rest);
  const started = Date.now();
  expect(SequenceAssignment([...slots, fixed], 60, all)).toEqual([59, 0, 0, 0, 0, 0, 0, 0, 1]);
  expect(Date.now() - started).toBeLessThan(1000);
});

test('slotReceiving reads which slot took an item', () => {
  // The two questions asked of one assignment: how many each took, and which
  // one took this item. Computing the second from the first keeps the callers
  // from drifting apart.
  const counts = [2, 0, 1];
  expect(slotReceiving(counts, 0)).toBe(0);
  expect(slotReceiving(counts, 1)).toBe(0);
  expect(slotReceiving(counts, 2)).toBe(2);
  expect(slotReceiving(counts, 3)).toBe(-1);
});
