import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * What a range's ELEMENT type may be.
 *
 * The design makes this generic - `RangeBounds<T: Ordered.<T>>`, with
 * `Temporal.Instant` named as the motivating case for separating ordering from
 * arithmetic - and the specification agrees: "a value type class over an ordered
 * element type". The engine admits Numbers, BigInts, and typed numbers, testing
 * the value rather than the constraint.
 *
 * These tests record BOTH halves: the numeric surface, which works and is
 * specified, and the non-numeric refusal, which is an UNIMPLEMENTED CONSTRAINT
 * rather than a rule. Without the second, a reader cannot tell whether
 * `'a'..='z'` is meant to be an error, and a change to the endpoint check would
 * turn an unrecorded limit into an unnoticed regression.
 */

test('range elements: the numeric surface, across the interface', () => {
  expect(evaluated('const r = 1..=6; String(r.start) + "," + String(r.end);')).toBe('1,6');
  expect(evaluated('const r = 1..=6; String(r.contains(3)) + "," + String(r.contains(9));')).toBe('true,false');
  expect(evaluated('const r = 1..=6; String(r.isEmpty) + "," + String(r.isFull);')).toBe('false,false');
  expect(evaluated('const a = 1..=10; const b = 5..=20; const c = a.intersect(b);'
    + ' String(c.start) + "," + String(c.end);')).toBe('5,10');
  // `scale` is on the instantiations whose element type is Scalable, which for
  // now is the numeric one - the partial specialization rule already giving the
  // right answer for the one element type implemented
  expect(evaluated('const r = 1..=6; String(r.scale(2).end);')).toBe('12');
});

test('range elements: a bigint range, and no mixing', () => {
  expect(evaluated('const r = 1n..=6n; String(r.start);')).toBe('1');
  // a Number endpoint beside a BigInt one is refused: the two are different
  // numeric types and this proposal mixes none
  expectThrown('1..=6n;');
  expectThrown('1n..=6;');
});

test('range elements: a non-numeric endpoint is refused TODAY', () => {
  // NOT a rule of the proposal. The design requires only that the element type
  // implement `Ordered`, and each of these is ordered in the ordinary sense;
  // the engine tests the value rather than the constraint. When the constraint
  // lands these become the cases that must WORK.
  expectThrown("'a'..='z';");
  expectThrown('new Date(0)..=new Date(1000);');
  // including a type that satisfies the design's stated requirement exactly
  expectThrown('class P { constructor(v) { this.v = v; } operator<(o) { return this.v < o.v; } }'
    + ' new P(1)..=new P(5);');
});

test('range elements: NaN is refused for a reason that will survive', () => {
  // Distinct from the limit above: NaN is not ordered, so it is refused whatever
  // the element type rule becomes.
  expectThrown('NaN..=5;');
  expectThrown('1..=NaN;');
});
