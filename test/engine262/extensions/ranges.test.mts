import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Capability Q (ranges.md) core: range literals as values that iterate.
 *
 * A range names an interval as a value. The literal `a..b` is half-open and
 * `a..=b` is inclusive, with the open-ended forms `a..`, `..b`, `..=b`, and `..`
 * omitting an endpoint. A range binds tighter than assignment and looser than
 * `||`/`??`, is non-associative, and member access binds tighter, so a range
 * reaches its own members through parentheses. A range over an integer interval
 * iterates with an implicit step of one, which is the counted loop written once;
 * a non-integer or unbounded range needs an explicit `step`. The endpoints,
 * containment, length, and emptiness are the value's core operations, and `Range`
 * is a usable type name.
 *
 * Deferred with the rest of the extension, each needing a facility another part
 * supplies: the interval kind in the type (`Range.<T, Interval>`) and the two
 * literal forms' specialization, the `uint8.<1..=6>` bounds desugaring (primitive
 * metadata), `a[start..end]` slicing to a view (the array view substrate),
 * range case labels matching by containment, `x is uint8.<1..=6>`, the `Math.random`
 * source, and the ordering-based generalization to bigint, dimensioned quantities,
 * and Temporal.
 */

// -- the literal forms construct ----------------------------------------------
test('a half-open literal has its endpoints', () => {
  expect(evaluated('(0..10).start;')).toBe('0');
  expect(evaluated('(0..10).end;')).toBe('10');
});

test('an inclusive literal has its endpoints', () => {
  expect(evaluated('(1..=6).start;')).toBe('1');
  expect(evaluated('(1..=6).end;')).toBe('6');
});

test('the open-ended forms omit an endpoint', () => {
  expect(evaluated('String((5..).end);')).toBe('undefined');
  expect(evaluated('(5..).start;')).toBe('5');
  expect(evaluated('(..10).end;')).toBe('10');
  expect(evaluated('String((..).start);')).toBe('undefined');
  expect(evaluated('String((..).end);')).toBe('undefined');
});

// -- iteration: the counted loop, spelled once --------------------------------
test('a half-open integer range iterates up to but not including the end', () => {
  expect(evaluated('let s = 0; for (const i of 0..5) { s += i; } String(s);')).toBe('10');
  expect(evaluated('let a = [...0..5]; a.join(",");')).toBe('0,1,2,3,4');
});

test('an inclusive integer range iterates through the end', () => {
  expect(evaluated('let s = 0; for (const i of 0..=5) { s += i; } String(s);')).toBe('15');
  expect(evaluated('let a = [...0..=3]; a.join(",");')).toBe('0,1,2,3');
});

test('a descending range is empty, not reversed', () => {
  expect(evaluated('let a = [...10..0]; String(a.length);')).toBe('0');
});

test('the loop over an array length is half-open by default', () => {
  expect(evaluated('let arr = [9, 8, 7]; let s = ""; for (const i of 0..arr.length) { s += i; } s;')).toBe('012');
});

// -- explicit step ------------------------------------------------------------
test('step widens an integer stride', () => {
  expect(evaluated('let a = [...(0..10).step(2)]; a.join(",");')).toBe('0,2,4,6,8');
});

test('a non-integer range iterates only with an explicit step', () => {
  // a float range has no implicit step
  expectThrown('let a = [...0.5..2.5]; a;');
  expect(evaluated('let a = [...(0.0..1.0).step(0.25)]; a.join(",");')).toBe('0,0.25,0.5,0.75');
});

test('the nth value avoids accumulated error', () => {
  // start + n*by, not repeated addition, so ten values end at 0.9 not 0.8999...
  expect(evaluated('String([...(0.0..1.0).step(0.1)].length);')).toBe('10');
});

// -- containment, length, emptiness -------------------------------------------
test('contains respects the interval kind', () => {
  expect(evaluated('String((0..10).contains(5));')).toBe('true');
  expect(evaluated('String((0..10).contains(10));')).toBe('false');
  expect(evaluated('String((0..=10).contains(10));')).toBe('true');
  expect(evaluated('String((0..10).contains(-1));')).toBe('false');
});

test('length counts the members of a bounded integer range', () => {
  expect(evaluated('String((0..10).length);')).toBe('10');
  expect(evaluated('String((0..=10).length);')).toBe('11');
  expect(evaluated('String((5..5).length);')).toBe('0');
});

test('isEmpty is true exactly when the range holds nothing', () => {
  expect(evaluated('String((5..5).isEmpty);')).toBe('true');
  expect(evaluated('String((0..5).isEmpty);')).toBe('false');
  expect(evaluated('String((0..=0).isEmpty);')).toBe('false');
});

// -- precedence and associativity ---------------------------------------------
test('member access binds tighter than the range', () => {
  // (0..10).length reaches the member through parentheses
  expect(evaluated('String((0..10).length);')).toBe('10');
  // 0..arr.length is 0..(arr.length)
  expect(evaluated('let arr = [1, 2, 3, 4, 5]; let s = 0; for (const i of 0..arr.length) s += i; String(s);')).toBe('10');
});

test('a range is looser than a conditional head', () => {
  // 0..10 ? x : y is (0..10) ? x : y, and a range is truthy
  expect(evaluated('0..10 ? "y" : "n";')).toBe('y');
});

test('a range is non-associative', () => {
  expectThrown('let x = 1..2..3; x;');
});

// -- Range as a type ----------------------------------------------------------
test('Range is a usable type name', () => {
  expect(evaluated('let r: Range = 0..10; typeof r;')).toBe('object');
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
  // with the flag off, `1..6` is the base grammar's two numeric literals and a
  // Syntax Error, and `1..toString()` keeps its base meaning
  expect((runFlagOff('let r = 1..6; r;') as { Type: string }).Type).toBe('throw');
  expect((runFlagOff('1..toString();') as { Type: string }).Type).toBe('normal');
  expect((runFlagOff('let x = 1.5; x;') as { Type: string }).Type).toBe('normal');
});

test('a range case label does not yet match by containment (documents the gap)', () => {
  // ranges.md: a range case label should match a discriminant the range contains.
  // Today the label parses but is compared by identity, so an integer in the
  // range does not select the case and control falls through to the default.
  expect(evaluated('let x = 3; let r = "none"; switch (x) { case 0..5: r = "in"; break; default: r = "def"; } r;')).toBe('def');
  // an exact endpoint likewise does not match by identity
  expect(evaluated('let x = 0; let r = "none"; switch (x) { case 0..5: r = "in"; break; default: r = "def"; } r;')).toBe('def');
});
