import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-pattern-matching.md phase five, EXHAUSTIVENESS.
 *
 * `sec-match-exhaustiveness`: "A `match` over an enum-typed or
 * sealed-class-typed subject is exhaustive under the same rules a `switch` is,
 * and this clause adds no new ones - it SHARES them."
 *
 * So this extends `check.mts`'s `SwitchStatement` machinery and reads the same
 * enum-name table the `EnumDeclaration` case already builds, rather than
 * building a second one that could disagree with it.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
const E = 'enum E { A, B } ';

test('a match covering every enumerator needs NO default', () => {
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);`)).toBe('ACCEPTED');
});

test('a match MISSING an enumerator and lacking a default is refused', () => {
  // The assertion that says the check is doing work rather than passing
  // everything - and the one the first version of this pin failed to make,
  // because it only tested the covered case.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; }; } f(E.A);`)).toBe('TypeError');
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; default: 0; }; } f(E.A);`)).toBe('ACCEPTED');
});

test('A GUARDED ARM PROVES NOTHING', () => {
  // "Since the checker does not evaluate guards." A guarded clause does not
  // count towards coverage however exhaustive its pattern looks - which is what
  // keeps exhaustiveness a STATIC claim rather than an optimistic one.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B if (true): 2; }; } f(E.A);`)).toBe('TypeError');
  // The same clauses with the guard removed are exhaustive.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);`)).toBe('ACCEPTED');
});

test('the SWITCH machinery it extends is unchanged', () => {
  // Both forms read one enum-name table, so they cannot disagree about what an
  // enum's members are.
  expect(outcome(`${E} function f(e: E) { switch (e) { case E.A: return 1; case E.B: return 2; } } f(E.A);`)).toBe('ACCEPTED');
  expect(outcome(`${E} function f(e: E) { switch (e) { case E.A: return 1; } } f(E.A);`)).toBe('TypeError');
});

test('PINNED: the shapes an enumerator arrives in differ by position', () => {
  // `E.A` as a PATTERN is a TypeReference whose TypeName carries an
  // IdentifierReference and a list of MemberNames; as a switch CASE LABEL it is
  // a MemberExpression, an expression. Reading the label shape in the pattern
  // position found nothing, so every clause looked uncovered and an exhaustive
  // `match` was reported as missing EVERY member - a check that fires on
  // correct code, which is worse than one that never fires.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);`)).toBe('ACCEPTED');
  // A label that is not an enumerator of the subject's enum does not count.
  expect(outcome(`${E} enum F { C } function f(e: E) { return match (e) { when E.A: 1; when F.C: 2; }; } f(E.A);`)).toBe('TypeError');
});

test('PINNED: what the checker half still lacks', () => {
  // NARROWING per pattern form - a bound name types loosely rather than as the
  // pattern established - and LITERAL PROPAGATION into patterns, where
  // `when 27:` against a `uint8` field should be a `uint8` 27.
  expect(evaluated('String(typeof (1 is 1));')).toBe('boolean');
  // Sealed-class exhaustiveness, which the clause names beside enums.
  expect(outcome('class S {} class T extends S {} function f(s: S) { return match (s) { when T: 1; }; } f(new T());')).toBe('ACCEPTED');
});
