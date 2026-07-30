import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-pattern-matching.md phase one: `is` takes a pattern.
 *
 * `sec-is-pattern`: "`subject is P` is the one-arm `match`, EXACTLY: it matches,
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

test('PINNED: the forms phase one does not carry', () => {
  const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // BINDINGS (`let`/`const`) need the scoping rule - "in scope in exactly the
  // positions the truth of the test governs" - which is checker work, so the
  // runtime for them lands with it.
  expect(outcome('const v = 1; String(v is let x);')).toBe('SyntaxError');
  // INTERPOLATION, and OBJECT and ARRAY patterns. The last two are spelled
  // identically to types (`{ x: uint8 }` is both), and settling that
  // coincidence belongs with the structural matching that needs the read cache.
  expect(outcome('const k = 1; String(1 is ${k});')).toBe('SyntaxError');
  // `{ x: 1 }` is spelled identically as a TYPE and as an object pattern, and
  // it currently parses as the type - whose member type is the literal type 1,
  // so the answer coincides with what the object pattern would give. That
  // coincidence is exactly why settling the form belongs with the structural
  // matching that needs the read cache, and it is pinned by what it PRODUCES so
  // that the day the two diverge is visible.
  expect(evaluated('String({ x: 1 } is { x: 1 });')).toBe('true');
  expect(evaluated('String({ x: 2 } is { x: 1 });')).toBe('false');
  // NARROWING is phase five: a pattern-carrying `is` types as boolean and
  // narrows nothing yet.
  expect(evaluated('String(typeof (1 is 1));')).toBe('boolean');
});
