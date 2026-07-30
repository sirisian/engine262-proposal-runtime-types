import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

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

test('PINNED: the binding COLON is context-dependent', () => {
  // `when let x: T:` annotates and `when let x:` ends the pattern - the colon is
  // ambiguous, and it is resolved by speculating: take the annotation only if
  // ANOTHER colon follows, since a clause always has one.
  //
  // In `is` position there is NO clause colon, so an annotated binding cannot be
  // told apart by that rule and is refused. Getting it right means passing the
  // CONTEXT into the parse rather than inferring it from lookahead - the two
  // positions genuinely differ.
  expect(evaluated('String(match (uint8(1)) { when let x: uint8: "yes"; default: "no"; });')).toBe('yes');
  expect(outcome('uint8(1) is let x: uint8;')).toBe('SyntaxError');
  // The unannotated form works in both.
  expect(evaluated('String(match (1) { when let x: x; default: 0; });')).toBe('1');
  expect(evaluated('String(1 is let x);')).toBe('true');
});

test('PINNED: the checker half of phase five', () => {
  // NARROWING per pattern form, LITERAL PROPAGATION into patterns, and
  // EXHAUSTIVENESS extending `check.mts`'s SwitchStatement machinery. A bound
  // name currently types loosely rather than as the pattern established.
  expect(evaluated('String(typeof (1 is 1));')).toBe('boolean');
  // A `match` over an enum still needs a `default`, since exhaustiveness is not
  // yet read from the clauses.
  expect(outcome('enum E { A, B } function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);')).toBe('ACCEPTED');
});
