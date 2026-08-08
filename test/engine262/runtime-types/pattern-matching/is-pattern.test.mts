import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-is-pattern (The Is Pattern) - `is` takes a pattern.
 *
 * #sec-is-pattern: "`subject is P` is the one-arm `match`, EXACTLY: it matches,
 * binds, and narrows as `when P` would." The right operand is "widened from
 * |Type| to |MatchPattern|, OF WHICH A |Type| IS ONE FORM, so every existing
 * `is` keeps its parse and its meaning".
 *
 * That last clause is why `is` is the spine of this extension rather than a late
 * convenience: the production already exists, so the change is a widening whose
 * regression suite is every `is` test already written.
 */

test('EVERY EXISTING `is` KEEPS ITS PARSE AND ITS MEANING', () => {
  // The promise the clause makes, asserted directly rather than left to the
  // suite at large - a |Type| is one |MatchPattern| form and takes the path it
  // always took.
  expect(evaluated('class A {} String(new A() is A);')).toBe('true');
  expect(evaluated('class A {} class B {} String(new B() is A);')).toBe('false');
  expect(evaluated('String({ x: 1 } is { x: number });')).toBe('true');
  expect(evaluated('String({ x: "s" } is { x: number });')).toBe('false');
  expect(evaluated('String(uint8(1) is uint8);')).toBe('true');
  expect(evaluated('String(1 is uint8);')).toBe('false');
});

test('LITERAL patterns compare by MatchConstant', () => {
  expect(evaluated('String(5 is 5);')).toBe('true');
  expect(evaluated('String(5 is 6);')).toBe('false');
  expect(evaluated('String("a" is "a");')).toBe('true');
  expect(evaluated('String("a" is "b");')).toBe('false');
  expect(evaluated('String(true is true);')).toBe('true');
  expect(evaluated('String(null is null);')).toBe('true');
  // MatchConstant is *false* where the operands' TYPES differ - it is a third
  // relation beside SameValue and SameValueZero, not either of them.
  expect(evaluated('String(uint8(5) is 5);')).toBe('false');
  expect(evaluated('String("5" is 5);')).toBe('false');
});

test('the BARE-ZERO rule, which is not in MatchConstant', () => {
  // A bare `0` matches both zeros of the position's type; an explicit `+0` or
  // `-0` distinguishes them. The rule lives in the literal step rather than in
  // MatchConstant, because inside that operation it would reach every constant
  // comparison including interpolations and enumerators.
  expect(evaluated('String(-0 is 0);')).toBe('true');
  expect(evaluated('String(0 is 0);')).toBe('true');
});

test('the WILDCARD matches anything and binds nothing', () => {
  expect(evaluated('String(1 is _);')).toBe('true');
  expect(evaluated('String(null is _);')).toBe('true');
  expect(evaluated('String(undefined is _);')).toBe('true');
  expect(evaluated('String({} is _);')).toBe('true');
});

test('COMBINATORS: not binds tightest, then and, then or', () => {
  expect(evaluated('String(1 is not 2);')).toBe('true');
  expect(evaluated('String(1 is not 1);')).toBe('false');
  expect(evaluated('String(5 is 4 or 5);')).toBe('true');
  expect(evaluated('String(3 is 4 or 5);')).toBe('false');
  expect(evaluated('String(5 is 5 and 5);')).toBe('true');
  expect(evaluated('String(5 is 5 and 6);')).toBe('false');
  // A combinator over a TYPE pattern, which is what says the two kinds of
  // pattern compose rather than living in separate grammars.
  expect(evaluated('String(1 is uint8 or number);')).toBe('true');
  expect(evaluated('String("s" is not uint8);')).toBe('true');
});

test('the forms still outstanding', () => {
  // BINDINGS work: `is` creates a declarative environment for
  // them exactly as a clause does. Their SCOPE - "in exactly the positions the
  // truth of the test governs" - is still the checker's business.
  expect(evaluated('String(1 is let x);')).toBe('true');
  // ARRAY patterns, and the `[[Iterations]]` half of the cache with them.
  // `[1, 2]` currently parses as a TUPLE TYPE of two literal types, so the
  // answer coincides with what an array pattern would give - the same
  // coincidence objects have, asserted by its RESULT.
  expect(evaluated('String([1, 2] is [1, 2]);')).toBe('true');
  // NARROWING: a non-type pattern narrows nothing yet.
  expect(evaluated('String(typeof (1 is 1));')).toBe('boolean');
});
