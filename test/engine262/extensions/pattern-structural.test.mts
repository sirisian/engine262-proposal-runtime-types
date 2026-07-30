import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-pattern-matching.md phase two: the structural core.
 *
 * `sec-match-structural` and the Match Cache Record of `sec-match-expression`.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('INTERPOLATION evaluates and compares', () => {
  // "`${expression}` evaluates the expression and matches by SameValue against
  // the result, whatever the result is" - the escape hatch from every cleverer
  // rule, where a type pattern would test membership.
  expect(evaluated('const k = 5; String(5 is ${k});')).toBe('true');
  expect(evaluated('const k = 5; String(6 is ${k});')).toBe('false');
  // It COMPARES a type object rather than testing membership, which is the
  // whole reason the form exists.
  expect(evaluated('String(1 is ${uint8});')).toBe('false');
  expect(evaluated('String(1 is uint8);')).toBe('false');
  expect(evaluated('String(uint8(1) is uint8);')).toBe('true');
});

test('OBJECT patterns: presence is the `in` test', () => {
  expect(evaluated('String({ x: 1, y: 2 } is { x: _ });')).toBe('true');
  // "An optional member that is ABSENT FAILS the pattern rather than matching
  // undefined."
  expect(evaluated('String({ y: 2 } is { x: _ });')).toBe('false');
  expect(evaluated('String({ x: undefined } is { x: _ });')).toBe('true');
  // "A member the pattern does not name is IGNORED - a pattern is a subset
  // test, as an interface check is, because this type system has width
  // subtyping and no exact object type."
  expect(evaluated('String({ x: 1, z: 9 } is { x: _ });')).toBe('true');
  // A member's sub-pattern is a FULL pattern, combinators included.
  expect(evaluated('String({ x: 1 } is { x: 1 or 2 });')).toBe('true');
  expect(evaluated('String({ x: 3 } is { x: 1 or 2 });')).toBe('false');
  expect(evaluated('String({ x: 1 } is { x: not 2 });')).toBe('true');
  // A non-object subject fails rather than throwing.
  expect(evaluated('String(1 is { x: _ });')).toBe('false');
  expect(evaluated('String(null is { x: _ });')).toBe('false');
});

test('THE CACHE IS A CORRECTNESS REQUIREMENT: a getter runs ONCE', () => {
  // "The presence test and the read are one cached touch per key - a
  // HasProperty and at most one Get per key per match" - so "a getter runs once
  // and arms agree about what they saw". A pattern language that re-read a
  // property per test would turn a lazily computed member into a different
  // value in each clause.
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return 1; } }; '
    + 'o is { g: _ and 1 }; String(n);')).toBe('1');
  // The sharper form: a getter that returns something DIFFERENT each call. With
  // one read both sub-patterns see 1 and the match succeeds; with two reads the
  // second sees 2 and it fails. The count alone would not catch a cache that
  // stored the wrong value.
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return n; } }; '
    + 'String(o is { g: 1 and 1 });')).toBe('true');
});

test('the TYPE path is unchanged where the two spellings agree', () => {
  // `{ x: uint8 }` is spelled identically as a type and as an object pattern,
  // and where every member's sub-pattern IS a type the two agree - so those
  // keep the type path, and every existing `is` keeps its parse, its meaning
  // and its node shape. An object pattern is taken only where the braces hold
  // something a type cannot.
  expect(evaluated('String({ x: 1 } is { x: number });')).toBe('true');
  expect(evaluated('String({ x: "s" } is { x: number });')).toBe('false');
  expect(evaluated('String({ x: 1 } is { x: 1 });')).toBe('true');
  // And the pattern path where it cannot be a type.
  expect(evaluated('String({ x: 1 } is { x: _ });')).toBe('true');
});

test('PINNED: what the structural core still lacks', () => {
  // ARRAY patterns and the `[[Iterations]]` half of the cache, which is what
  // makes "alternatives over array patterns of different lengths pull each
  // element once" true. `[1, 2]` parses as a TUPLE TYPE today, so it answers
  // through the type path exactly as `{ x: 1 }` does - pinned by its RESULT so
  // the day an array pattern diverges from a tuple type is visible.
  expect(evaluated('String([1, 2] is [1, 2]);')).toBe('true');
  expect(evaluated('String([1, 2] is [1, 3]);')).toBe('false');
  // A REST binding needs bindings, which need the scoping rule.
  expect(outcome('({ x: 1 }) is { ...let rest };')).toBe('SyntaxError');
  // RANGE and REGEXP patterns. A range is not a type, so the type path cannot
  // stand in for the pattern here - which is why this one REJECTS rather than
  // coinciding.
  expect(outcome('5 is 1..10;')).toBe('TypeError');
});
