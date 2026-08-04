import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Capability Q (ranges.md) core: range literals as values that iterate.
 *
 * A range names an interval as a value. Every range that has an end marks whether
 * it includes it -- `a..<b` and `a..=b` -- and marks its start only where the
 * start is exclusive -- `a<..<b` and `a<..=b`. The open-ended forms `a..`,
 * `a<..`, `..<b`, `..=b`, and `..` omit an endpoint. There is no bare `a..b`. A range binds tighter than assignment and looser than
 * `||`/`??`, is non-associative, and member access binds tighter, so a range
 * reaches its own members through parentheses. A range over an integer interval
 * iterates with an implicit step of one, which is the counted loop written once;
 * a non-integer or unbounded range needs an explicit `step`. The endpoints and their
 * bounds, containment, length, emptiness, and fullness are the value's core
 * operations; the four-way `interval` name is derived from the two bounds rather
 * than stored, and `Range` is a usable type name.
 *
 * The `RangeBounds` operations -- containment of a range in a range,
 * intersection, and scaling -- and the interval arithmetic of `+`, `-`, unary
 * `-`, `*`, and `/` over two ranges are here too, being facts about point sets
 * rather than about any particular shape: each returns whatever shape its
 * operands imply, which is why intersecting a from-range with a to-range gives a
 * two-endpoint range and negating a from-range gives a to-range.
 *
 * Deferred with the rest of the extension, each needing a facility another part
 * supplies: the bounds in the type (`Range.<T, S, E>` over `Bound.Closed`
 * and `Bound.Open`) and the literal forms' specialization, the
 * `uint8.<{ bounds: 1..=6 }>` metadata carrier (primitive metadata),
 * `a[start..<end]` slicing to a view (the array view substrate),
 * range case labels matching by containment, `x is uint8.<{ bounds: 1..=6 }>`, the `Math.random`
 * source, and the ordering-based generalization to bigint, dimensioned quantities,
 * and Temporal.
 */

// -- the literal forms construct ----------------------------------------------
test('a half-open literal has its endpoints', () => {
  expect(evaluated('(0..<10).start;')).toBe('0');
  expect(evaluated('(0..<10).end;')).toBe('10');
});

test('an inclusive literal has its endpoints', () => {
  expect(evaluated('(1..=6).start;')).toBe('1');
  expect(evaluated('(1..=6).end;')).toBe('6');
});

test('an open start is a distinct value from a closed one', () => {
  // ranges.md "Types": a bound per endpoint, so `a<..` and `a..` are different
  // ranges and the four two-endpoint intervals are the four pairs.
  expect(evaluated('(1<..<6).start;')).toBe('1');
  expect(evaluated('(1<..=6).end;')).toBe('6');
  expect(evaluated('(5<..).start;')).toBe('5');
  expect(evaluated('String((5<..).end);')).toBe('undefined');
});

test('each endpoint reports its own bound, and the interval is derived', () => {
  expect(evaluated('(0..<10).startBound;')).toBe('closed');
  expect(evaluated('(0..<10).endBound;')).toBe('open');
  expect(evaluated('(0..=10).endBound;')).toBe('closed');
  expect(evaluated('(0<..<10).startBound;')).toBe('open');
  // A shape with no start has no start bound to report.
  expect(evaluated('String((..<10).startBound);')).toBe('undefined');
  expect(evaluated('String((..).endBound);')).toBe('undefined');
  // The four-way name is computed from the pair, never stored.
  expect(evaluated('(0..=10).interval;')).toBe('closed');
  expect(evaluated('(0..<10).interval;')).toBe('closedOpen');
  expect(evaluated('(0<..=10).interval;')).toBe('openClosed');
  expect(evaluated('(0<..<10).interval;')).toBe('open');
  // A one-ended shape has no pair, so no interval name.
  expect(evaluated('String((5..).interval);')).toBe('undefined');
});

test('isFull is exactly the shape with neither endpoint', () => {
  expect(evaluated('String((..).isFull);')).toBe('true');
  expect(evaluated('String((0..<10).isFull);')).toBe('false');
  expect(evaluated('String((5..).isFull);')).toBe('false');
  expect(evaluated('String((..<5).isFull);')).toBe('false');
});

test('at equal endpoints the bounds decide emptiness', () => {
  // `5..=5` holds exactly one value; every form with an open endpoint holds none,
  // because an open endpoint excludes the only value the interval could contain.
  expect(evaluated('String((5..=5).isEmpty);')).toBe('false');
  expect(evaluated('String((5..<5).isEmpty);')).toBe('true');
  expect(evaluated('String((5<..=5).isEmpty);')).toBe('true');
  expect(evaluated('String((5<..<5).isEmpty);')).toBe('true');
});

test('length adjusts once per open endpoint', () => {
  expect(evaluated('String((0..=10).length);')).toBe('11');
  expect(evaluated('String((0..<10).length);')).toBe('10');
  expect(evaluated('String((0<..=10).length);')).toBe('10');
  expect(evaluated('String((0<..<10).length);')).toBe('9');
  // Never negative.
  expect(evaluated('String((5<..<5).length);')).toBe('0');
});

test('containment tests each endpoint by its own bound', () => {
  expect(evaluated('String((0<..<10).contains(0));')).toBe('false');
  expect(evaluated('String((0<..<10).contains(1));')).toBe('true');
  expect(evaluated('String((0<..=10).contains(10));')).toBe('true');
  expect(evaluated('String((0..=10).contains(0));')).toBe('true');
  // A from-range with an open start excludes its own endpoint and nothing above.
  expect(evaluated('String((5<..).contains(5));')).toBe('false');
  expect(evaluated('String((5<..).contains(5.5));')).toBe('true');
  // The full range contains everything numeric.
  expect(evaluated('String((..).contains(-1e9));')).toBe('true');
});

test('an open start begins iteration one step in', () => {
  // ranges.md and #sec-ranges fix the nth value as start + n * step but were
  // written before an open start had a literal, so neither states the first
  // index. An open start excludes its own endpoint, so it must be n >= 1.
  expect(evaluated('let a = [...0<..<4]; a.join(",");')).toBe('1,2,3');
  expect(evaluated('let a = [...0<..=4]; a.join(",");')).toBe('1,2,3,4');
  expect(evaluated('let a = [...(0<..<1).step(0.25)]; a.join(",");')).toBe('0.25,0.5,0.75');
  // And a closed start still yields its own endpoint first.
  expect(evaluated('let a = [...0..<4]; a.join(",");')).toBe('0,1,2,3');
});

test('the open-ended forms omit an endpoint', () => {
  expect(evaluated('String((5..).end);')).toBe('undefined');
  expect(evaluated('(5..).start;')).toBe('5');
  expect(evaluated('(..<10).end;')).toBe('10');
  expect(evaluated('(..=10).end;')).toBe('10');
  expect(evaluated('String((..).start);')).toBe('undefined');
  expect(evaluated('String((..).end);')).toBe('undefined');
});

// -- iteration: the counted loop, spelled once --------------------------------
test('a half-open integer range iterates up to but not including the end', () => {
  expect(evaluated('let s = 0; for (const i of 0..<5) { s += i; } String(s);')).toBe('10');
  expect(evaluated('let a = [...0..<5]; a.join(",");')).toBe('0,1,2,3,4');
});

test('an inclusive integer range iterates through the end', () => {
  expect(evaluated('let s = 0; for (const i of 0..=5) { s += i; } String(s);')).toBe('15');
  expect(evaluated('let a = [...0..=3]; a.join(",");')).toBe('0,1,2,3');
});

test('a descending range is empty, not reversed', () => {
  expect(evaluated('let a = [...10..<0]; String(a.length);')).toBe('0');
});

test('the loop over an array length is half-open by default', () => {
  expect(evaluated('let arr = [9, 8, 7]; let s = ""; for (const i of 0..<arr.length) { s += i; } s;')).toBe('012');
});

// -- explicit step ------------------------------------------------------------
test('step widens an integer stride', () => {
  expect(evaluated('let a = [...(0..<10).step(2)]; a.join(",");')).toBe('0,2,4,6,8');
});

test('a non-integer range iterates only with an explicit step', () => {
  // a float range has no implicit step
  expectThrown('let a = [...0.5..<2.5]; a;');
  expect(evaluated('let a = [...(0.0..<1.0).step(0.25)]; a.join(",");')).toBe('0,0.25,0.5,0.75');
});

test('the nth value avoids accumulated error', () => {
  // start + n*by, not repeated addition, so ten values end at 0.9 not 0.8999...
  expect(evaluated('String([...(0.0..<1.0).step(0.1)].length);')).toBe('10');
});

// -- containment, length, emptiness -------------------------------------------
test('contains respects the interval kind', () => {
  expect(evaluated('String((0..<10).contains(5));')).toBe('true');
  expect(evaluated('String((0..<10).contains(10));')).toBe('false');
  expect(evaluated('String((0..=10).contains(10));')).toBe('true');
  expect(evaluated('String((0..<10).contains(-1));')).toBe('false');
});

test('length counts the members of a bounded integer range', () => {
  expect(evaluated('String((0..<10).length);')).toBe('10');
  expect(evaluated('String((0..=10).length);')).toBe('11');
  expect(evaluated('String((5..<5).length);')).toBe('0');
});

test('isEmpty is true exactly when the range holds nothing', () => {
  expect(evaluated('String((5..<5).isEmpty);')).toBe('true');
  expect(evaluated('String((0..<5).isEmpty);')).toBe('false');
  expect(evaluated('String((0..=0).isEmpty);')).toBe('false');
});

// -- the RangeBounds operations ----------------------------------------------

test('contains overloads on a range, and is the subset test', () => {
  expect(evaluated('String((0..<10).contains(2..<5));')).toBe('true');
  expect(evaluated('String((0..<10).contains(2..<20));')).toBe('false');
  // An empty range has no point to fall outside, so every range contains it.
  expect(evaluated('String((0..<10).contains(7..<7));')).toBe('true');
  // The full range contains them all.
  expect(evaluated('String((..).contains(0..<10));')).toBe('true');
  // Equal endpoints: an open outer excludes the point a closed inner needs.
  expect(evaluated('String((0..<10).contains(0..=10));')).toBe('false');
  expect(evaluated('String((0..=10).contains(0..<10));')).toBe('true');
});

test('intersect is the point-set intersection, with the full range as identity', () => {
  expect(evaluated('const r = (0..<10).intersect(5..<20); r.start + "," + r.end;')).toBe('5,10');
  // Identity, and a shape that follows from the operands rather than either one.
  expect(evaluated('const r = (0..<5).intersect(..); r.start + "," + r.end;')).toBe('0,5');
  expect(evaluated('const r = (5..).intersect(..<9); r.start + "," + r.end + "," + r.interval;')).toBe('5,9,closedOpen');
});

test('intersect gives an equal endpoint to the exclusive bound', () => {
  // `0..<10` and `0..=10` agree everywhere below 10 and disagree only at it.
  expect(evaluated('(0..<10).intersect(0..=10).interval;')).toBe('closedOpen');
  expect(evaluated('(0<..<10).intersect(0..<10).interval;')).toBe('open');
});

test('a disjoint intersection is empty without a representation of its own', () => {
  // The crossed pair -- greater low with lesser high -- is descending, and
  // therefore empty by the rule the value model already has.
  expect(evaluated('String((0..<5).intersect(10..<20).isEmpty);')).toBe('true');
});

test('scale multiplies both endpoints, and a negative factor reflects', () => {
  expect(evaluated('const r = (0..<10).scale(2); r.start + "," + r.end + "," + r.interval;')).toBe('0,20,closedOpen');
  // The image of [a, b) under negation is (-b, -a]: the endpoints exchange
  // places AND carry their bounds with them.
  expect(evaluated('const r = (0..<10).scale(-1); r.start + "," + r.end + "," + r.interval;')).toBe('-10,0,openClosed');
  // Which swaps the one-ended shapes: a from-range scales to a to-range.
  expect(evaluated('const r = (5..).scale(-1); String(r.start) + "," + r.end + "," + r.endBound;')).toBe('undefined,-5,closed');
});

test('scaling by zero is the single point zero, not an empty range', () => {
  // Multiplying both endpoints of `0..<10` would give the empty `0..<0`, where
  // the image of a nonempty range under multiplication by zero is {0}.
  expect(evaluated('const r = (0..<10).scale(0); r.start + "," + r.end + "," + r.interval;')).toBe('0,0,closed');
  // An already-empty range stays empty.
  expect(evaluated('String((5..<5).scale(0).isEmpty);')).toBe('true');
});

// -- interval arithmetic ------------------------------------------------------

test('addition adds the corresponding endpoints', () => {
  expect(evaluated('const r = (1..=3) + (10..=20); r.start + "," + r.end + "," + r.interval;')).toBe('11,23,closed');
  // A result bound is exclusive where EITHER contributing bound is: the right
  // operand approaches 5 without reaching it, so the sum approaches 8.
  expect(evaluated('const r = (3..) + (5<..); r.start + "," + r.startBound;')).toBe('8,open');
});

test('subtraction crosses the endpoints', () => {
  // The result's low is the left's low minus the right's HIGH.
  expect(evaluated('const r = (1..=3) - (10..=20); r.start + "," + r.end;')).toBe('-19,-7');
});

test('negation reflects, as scaling by minus one does', () => {
  expect(evaluated('const r = -(1..<3); r.start + "," + r.end + "," + r.interval;')).toBe('-3,-1,openClosed');
});

test('multiplication takes the least and greatest of the four endpoint products', () => {
  expect(evaluated('const r = (2..=3) * (4..=5); r.start + "," + r.end;')).toBe('8,15');
  // A negative operand puts the extremes on the crossed products.
  expect(evaluated('const r = (-2..=3) * (4..=5); r.start + "," + r.end;')).toBe('-10,15');
});

test('a product bound is exclusive only where EVERY attaining product is', () => {
  // `(0..=1) * (0..<2)`: the least product is zero, attained by `0 * 0` from two
  // inclusive endpoints, so zero is REACHED and the low bound is closed even
  // though `0 * 2` touches an exclusive one.
  expect(evaluated('(0..=1) * (0..<2) |> %.startBound;')).toBe('closed');
  // The greatest is two, attained only by `1 * 2`, and 2 is never reached, so
  // the high bound is open.
  //
  // FEEDBACK: ranges.md states this example's result as `0..=2`. That is wrong:
  // the supremum needs the right operand to REACH 2, which it never does, so the
  // result is `0..<2`. The rule the sentence states is right; the interval it
  // writes out contradicts it.
  expect(evaluated('(0..=1) * (0..<2) |> %.endBound;')).toBe('open');
  expect(evaluated('const r = (0..=1) * (0..<2); r.start + "," + r.end;')).toBe('0,2');
});

test('an unbounded side propagates, and what can be said still is', () => {
  // Two non-negative lows still give a low.
  expect(evaluated('const r = (2..) * (3..); r.start + "," + String(r.end);')).toBe('6,undefined');
});

test('division is defined only where the divisor is bounded away from zero', () => {
  expect(evaluated('const r = (1..=2) / (2..=4); r.start + "," + r.end;')).toBe('0.25,1');
  // A divisor whose range contains zero says nothing.
  expect(evaluated('String(((1..=2) / (0..=4)).isFull);')).toBe('true');
  // And one that merely EXCLUDES zero at an open endpoint is not enough: its
  // values approach zero, so the quotient is unbounded.
  expect(evaluated('String(((1..=2) / (0<..=1)).isFull);')).toBe('true');
});

test('interval arithmetic needs two ranges, and leaves the base behaviour alone', () => {
  // A range beside a non-range is not interval arithmetic, so the base
  // language's own semantics apply and string concatenation still works.
  expect(evaluated('typeof ("x" + (0..<5));')).toBe('string');
  expect(evaluated('typeof ((0..<5) + 1);')).toBe('string');
});

// -- precedence and associativity ---------------------------------------------
test('member access binds tighter than the range', () => {
  // (0..<10).length reaches the member through parentheses
  expect(evaluated('String((0..<10).length);')).toBe('10');
  // 0..<arr.length is 0..<(arr.length)
  expect(evaluated('let arr = [1, 2, 3, 4, 5]; let s = 0; for (const i of 0..<arr.length) s += i; String(s);')).toBe('10');
});

test('a range is looser than a conditional head', () => {
  // 0..<10 ? x : y is (0..<10) ? x : y, and a range is truthy
  expect(evaluated('0..<10 ? "y" : "n";')).toBe('y');
});

test('a range is non-associative', () => {
  expectThrown('let x = 1..<2..<3; x;');
});

// -- Range as a type ----------------------------------------------------------
test('Range is a usable type name', () => {
  expect(evaluated('let r: Range = 0..<10; typeof r;')).toBe('object');
  expect(evaluated('let r: Range = 0..=5; String(r.length);')).toBe('6');
});

test('a non-range value is not assignable to Range', () => {
  expectThrown('let r: Range = 5; "ok";');
  expectThrown('let r: Range = "abc"; "ok";');
});

// -- the base grammar is unchanged with the feature off -----------------------
test('numeric member access and the C-style loop are unaffected', () => {
  // 1..toString() parses today as (1.).toString() and is not a range here
  expect(evaluated('(1).toString();')).toBe('1');
  expect(evaluated('let sum = 0; for (let i = 0; i < 5; ++i) { sum += i; } String(sum);')).toBe('10');
});

test('the range operator does not exist with the feature off', () => {
  // with the flag off, `1..<6` is not a token sequence the base grammar has, and
  // `1..toString()` keeps its base meaning
  expect((runFlagOff('let r = 1..<6; r;') as { Type: string }).Type).toBe('throw');
  expect((runFlagOff('1..toString();') as { Type: string }).Type).toBe('normal');
  expect((runFlagOff('let x = 1.5; x;') as { Type: string }).Type).toBe('normal');
});

test('a range case label does not yet match by containment (documents the gap)', () => {
  // ranges.md: a range case label should match a discriminant the range contains.
  // Today the label parses but is compared by identity, so an integer in the
  // range does not select the case and control falls through to the default.
  expect(evaluated('let x = 3; let r = "none"; switch (x) { case 0..<5: r = "in"; break; default: r = "def"; } r;')).toBe('def');
  // an exact endpoint likewise does not match by identity
  expect(evaluated('let x = 0; let r = "none"; switch (x) { case 0..<5: r = "in"; break; default: r = "def"; } r;')).toBe('def');
});
