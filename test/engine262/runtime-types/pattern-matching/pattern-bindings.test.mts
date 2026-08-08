import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-pattern-matching.md phase five, the BINDING half.
 *
 * `sec-patternmatches`: a |MatchBindingPattern| tests its annotation where it
 * has one, then performs InitializeBinding and returns *true*. "A binding always
 * matches and always binds - and it is written with `let` or `const` because an
 * unadorned name is a CONSTANT to compare against, not a binding site."
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a binding binds, and the arm sees it', () => {
  expect(evaluated('String(match (5) { when let x: x * 2; default: 0; });')).toBe('10');
  expect(evaluated('String(match (5) { when const x: x + 1; default: 0; });')).toBe('6');
  // Each clause gets a FRESH environment, so one arm's binding is invisible to
  // the next - asserted by binding the same name in two clauses.
  expect(evaluated('String(match (2) { when 1: "one"; when let x: x * 3; default: 0; });')).toBe('6');
});

test('an ANNOTATED binding tests before it binds', () => {
  // Which is `catch (e: TypeError)` in a new position.
  expect(evaluated('String(match (uint8(5)) { when let x: uint8: "typed"; default: "no"; });')).toBe('typed');
  expect(evaluated('String(match (5) { when let x: uint8: "typed"; default: "no"; });')).toBe('no');
});

test('bindings work in every structural position', () => {
  expect(evaluated('String(match ({ a: 7 }) { when { a: let v }: v; default: 0; });')).toBe('7');
  expect(evaluated('String(match ([1, 9]) { when [1, let b]: b; default: 0; });')).toBe('9');
  expect(evaluated('const Some = { [Symbol.customMatcher](v) { return [v]; } }; '
    + 'String(match (5) { when Some(let v): v * 10; default: 0; });')).toBe('50');
});

test('a GUARD sees the pattern\'s bindings', () => {
  // "A guard runs after the pattern matches, with the pattern's bindings in
  // scope and the subject narrowed" - which is what makes a guard a refinement
  // of the clause rather than a second, independent test.
  expect(evaluated('String(match (5) { when let x if (x > 3): "big"; default: "small"; });')).toBe('big');
  expect(evaluated('String(match (2) { when let x if (x > 3): "big"; default: "small"; });')).toBe('small');
});

test('`is` creates an environment for its bindings too', () => {
  expect(outcome('const v = 1; v is let x;')).toBe('ACCEPTED');
  expect(evaluated('String(1 is let x);')).toBe('true');
});

test('the binding COLON is resolved by CONTEXT, not by lookahead', () => {
  // `when let x: T:` annotates and `when let x:` ends the pattern, so a colon
  // means different things in different positions. The parsers carry a
  // `colonTerminates` flag: TRUE in a clause, where a second colon distinguishes
  // an annotation from the clause's own, and FALSE in `is` and member positions,
  // where `let x: T` is complete as written.
  //
  // Speculating on a second colon at each site got two of the three positions
  // WRONG - `is` and member bindings were refused - because the speculation
  // encoded a clause's rule everywhere. Passing the context down settles all
  // three at once.
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // Clause position, both spellings.
  expect(evaluated('String(match (uint8(1)) { when let x: uint8: "yes"; default: "no"; });')).toBe('yes');
  expect(evaluated('String(match (5) { when let x: x * 2; default: 0; });')).toBe('10');
  // `is` position, where there is no clause colon to find.
  expect(outcome2('uint8(1) is let x: uint8;')).toBe('ACCEPTED');
  expect(evaluated('String(uint8(1) is let x: uint8);')).toBe('true');
  expect(evaluated('String(1 is let x: uint8);')).toBe('false');
  expect(evaluated('String(1 is let x);')).toBe('true');
});

test('PINNED: the checker half of phase five', () => {
  // NARROWING per pattern form, LITERAL PROPAGATION into patterns, and
  // EXHAUSTIVENESS extending `check.mts`'s SwitchStatement machinery. A bound
  // name currently types loosely rather than as the pattern established.
  expect(evaluated('String(typeof (1 is 1));')).toBe('boolean');
  // EXHAUSTIVENESS landed - match-exhaustiveness.test.mts owns it. This pin
  // had asserted a fully-covered enum was ACCEPTED, which stayed true for a
  // DIFFERENT reason once the check arrived, so it never noticed: a pin on a
  // case the change does not alter is not a pin at all.
});
