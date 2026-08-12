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

const P = 'class P { constructor(v) { this.v = v; } operator<(o) { return this.v < o.v; } } ';

test('range elements: a type declaring operator< is an element type', () => {
  // The constraint the design states - `RangeBounds<T: Ordered.<T>>` - rather
  // than the numeric check that stood in for it. `Temporal.Instant` is the
  // design's own motivating case and is not in this engine, so a class
  // declaring the one operator `Ordered` requires is the vehicle.
  expect(evaluated(`${P}const r = new P(1)..=new P(5); String(typeof r);`)).toBe('object');
  expect(evaluated(`${P}String((new P(1)..=new P(5)).contains(new P(3)));`)).toBe('true');
  expect(evaluated(`${P}String((new P(1)..=new P(5)).contains(new P(9)));`)).toBe('false');
});

test('range elements: every comparison derives from operator< alone', () => {
  // `Ordered` declares `<` and nothing else, so `a <= b` is `!(b < a)` under the
  // total order it requires. A closed bound includes its endpoint and an open
  // one excludes it, which is exactly where the derived comparison shows.
  //
  // Deriving rather than calling `<=` also keeps a range clear of an UNDECLARED
  // `<=`: that falls through to the base language, where `{} <= {}` is true, so
  // a range built on it would report every value as contained.
  expect(evaluated(`${P}String((new P(1)..=new P(5)).contains(new P(1)));`)).toBe('true');
  expect(evaluated(`${P}String((new P(1)..=new P(5)).contains(new P(5)));`)).toBe('true');
  expect(evaluated(`${P}String((new P(1)..<new P(5)).contains(new P(5)));`)).toBe('false');
  expect(evaluated(`${P}String((new P(1)..<new P(5)).contains(new P(4)));`)).toBe('true');
});

test('range elements: what is still not an element type', () => {
  // A type declaring no `operator<` does not satisfy `Ordered`, and the message
  // names the constraint rather than saying "must be a number".
  expectThrown('class Q { constructor(v) { this.v = v; } } new Q(1)..=new Q(5);');
  // A string and a Date declare no `operator<` of their own, so they are refused
  // for that reason rather than for being non-numeric.
  expectThrown("'a'..='z';");
  expectThrown('new Date(0)..=new Date(1000);');
  // Both endpoints are of ONE element type.
  expectThrown(`${P}new P(1)..=5;`);
});

test('range elements: NaN is refused for a reason that will survive', () => {
  // Distinct from the limit above: NaN is not ordered, so it is refused whatever
  // the element type rule becomes.
  expectThrown('NaN..=5;');
  expectThrown('1..=NaN;');
});
