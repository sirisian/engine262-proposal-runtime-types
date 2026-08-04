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
