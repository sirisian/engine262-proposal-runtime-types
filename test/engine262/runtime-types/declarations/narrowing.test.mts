import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../harness.mts';

/**
 * Extension coverage - the narrowing framework.
 *
 * A test over a value of a known Static Type splits that type in two: what the
 * value may be where the test succeeds, and what it may be where it fails. Where
 * either half is empty the branch it guards can never be taken, and that is a type
 * error rather than a narrowing to `never`, because a branch the program wrote and
 * can never reach is dead code and not a computation. This file covers that rule
 * for the two forms delivered so far, `instanceof` and the nullish `??`. The
 * remaining rows (the `is` operator, a literal `===`, `typeof`, a brand check, the
 * comparison of a parameterized type, and signature-driven narrowing) and the
 * narrowing of the discriminant inside a matched branch are not yet covered.
 */

// -- A guard whose test can never succeed --------------------------------------
test('narrowing: a guard whose test can never succeed is a type error', () => {
  // uint8 and string share no values, so the branch is unreachable
  expectThrown('let a: uint8 = (5 := uint8); if (a instanceof string) { } "done";');
  expectThrown('let a: string = "x"; if (a instanceof uint8) { } "done";');
  // every branching form asks the same question
  expectThrown('let a: uint8 = (5 := uint8); while (a instanceof string) { } "done";');
  expectThrown('let a: uint8 = (5 := uint8); a instanceof string ? 1 : 2;');
  // the guard is still the guard through a negation or a parenthesis
  expectThrown('let a: uint8 = (5 := uint8); if (!(a instanceof string)) { } "done";');
});

// -- A guard whose test can never fail -----------------------------------------
test('narrowing: a guard whose test can never fail is a type error', () => {
  // every uint8 is a uint8, so the else branch is unreachable
  expectThrown('let a: uint8 = (5 := uint8); if (a instanceof uint8) { } "done";');
});

// -- The nullish form guards by construction -----------------------------------
test('narrowing: a nullish test on a value that can never be nullish is a type error', () => {
  // `??` has a branch built into it: the right operand is taken only where the
  // left is nullish, which a uint8 never is
  expectThrown('let d: uint8 = (5 := uint8); let x = d ?? 5; x;');
  expectThrown('let s: string = "x"; let y = s ?? "other"; y;');
});

// -- A test that genuinely narrows is accepted ---------------------------------
test('narrowing: a test that can both succeed and fail is accepted', () => {
  // a union has members on each side of the question
  expect(evaluated('let a: uint8 | string = "x"; let r = "no"; if (a instanceof uint8) { r = "num"; } else { r = "str"; } r;')).toBe('str');
  expect(evaluated('let d: uint8 | null = null; String(d ?? 5);')).toBe('5');
  // a type the checker does not know is `any`, which narrows to itself both ways
  // and so never reports
  expect(evaluated('let x = 5; let r = "no"; if (x instanceof uint8) { r = "yes"; } r;')).toBe('no');
  // an ordinary constructor on the right denotes no type, so the rows do not apply
  expect(evaluated('let a = [1]; let r = "no"; if (a instanceof Array) { r = "yes"; } r;')).toBe('yes');
});

// -- A question with no branch behind it is not a guard ------------------------
test('narrowing: a test asked as a value, deciding no branch, is left alone', () => {
  // the rule is about the branch a test guards. Asked as an ordinary Boolean the
  // same test is merely a question with a constant answer, which a program may
  // legitimately ask, and membership answers it.
  expect(evaluated('let a: uint8 = (5 := uint8); String(a instanceof uint8);')).toBe('true');
  expect(evaluated('let a: uint8 = (5 := uint8); String(a instanceof string);')).toBe('false');
  expect(evaluated('type T = uint8; ((5 := T) instanceof T) && !("x" instanceof T) ? "ok" : "no";')).toBe('ok');
});

// -- Flag off: no checking happens at all --------------------------------------
test('narrowing: with the feature off, nothing is checked', () => {
  expect((runFlagOff('let a = [1]; if (a instanceof Array) { } "done";') as { Type: string }).Type).toBe('normal');
  expect((runFlagOff('let d = 5; let x = d ?? 5; x;') as { Type: string }).Type).toBe('normal');
});
