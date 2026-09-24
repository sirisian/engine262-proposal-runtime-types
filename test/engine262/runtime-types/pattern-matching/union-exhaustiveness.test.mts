import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-match-exhaustiveness.
 *
 * "It is a type error for a `match` not to be exhaustive." Exhaustiveness was
 * judged for a boolean, an enum and a sealed class subject. A union of types or
 * of literals was not: `match (t) { when uint8: 1; }` over `uint8 | string`
 * was accepted and threw "matched no clause" at run time. Each member must now
 * be covered by an unguarded clause's pattern, or the match needs a `default`.
 */

test('a match over a union that leaves a member uncovered is refused', () => {
  expectStaticTypeError('function m(t: uint8 | string) { return match (t) { when uint8: 1; }; }');
  expectStaticTypeError('function n(s: "a" | "b") { return match (s) { when "a": 1; }; }');
  expectStaticTypeError('function k(x: 1 | 2) { return match (x) { when 1: "a"; }; }');
  // A guarded clause covers nothing on its own.
  expectStaticTypeError('function m(t: uint8 | string) { return match (t) { when uint8: 1; when string if (t.length > 0): 2; }; }');
});

test('a covered union, a default and a catch-all binding are admitted', () => {
  expect(evaluated('function m(t: uint8 | string) { return match (t) { when uint8: 1; when string: 2; }; } String(m("a"));')).toBe('2');
  expect(evaluated('function n(s: "a" | "b") { return match (s) { when "a": 1; when "b": 2; }; } String(n("b"));')).toBe('2');
  expect(evaluated('function k(x: 1 | 2) { return match (x) { when 1: "a"; when 2: "b"; }; } k(2);')).toBe('b');
  expect(evaluated('function m(t: uint8 | string) { return match (t) { when uint8: 1; default: 2; }; } String(m("a"));')).toBe('2');
  expect(evaluated('function m(t: uint8 | string) { return match (t) { when uint8: 1; when let x: 2; }; } String(m("a"));')).toBe('2');
});
