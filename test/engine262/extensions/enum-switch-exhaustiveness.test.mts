import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * Enum switch exhaustiveness.
 *
 * When a switch discriminant is an enumerator of an enum, the switch is checked
 * at compile time (README "Control Structures", spec sec-enums): every case label
 * must be an enumerator of that enum, and a switch with no `default` must list
 * every enumerator. A missing enumerator or a label that is not an enumerator of
 * the enum is a type error, raised as an early error before the program runs. A
 * switch with a `default` need not be exhaustive, and a switch whose discriminant
 * is not enum-typed is the ordinary switch, unaffected.
 *
 * The discriminant is recognized as enum-typed when it is a binding known to hold
 * an enumerator: a variable initialized from an enum member, or a parameter or
 * variable annotated with the enum type.
 */

// -- Exhaustiveness ------------------------------------------------------------
test('a switch over an enumerator with no default must cover every enumerator', () => {
  expectThrown('enum E { A, B, C } let e = E.A; switch (e) { case E.A: break; case E.B: break; }');
});

test('a complete switch over an enumerator is accepted', () => {
  expect(evaluated('enum E { A, B } let e = E.A; let r = "none"; switch (e) { case E.A: r = "a"; break; case E.B: r = "b"; break; } r;')).toBe('a');
});

test('the missing enumerators are named in the error', () => {
  // C and the others left out are reported
  expectThrown('enum E { A, B, C, D } let e = E.A; switch (e) { case E.A: break; }');
});

// -- default relaxes exhaustiveness --------------------------------------------
test('a switch with a default need not list every enumerator', () => {
  expect(evaluated('enum E { A, B, C } let e = E.A; let r = "none"; switch (e) { case E.A: r = "a"; break; default: r = "d"; } r;')).toBe('a');
});

test('cases split around a default clause are all counted', () => {
  expect(evaluated('enum E { A, B } let e = E.B; let r = "none"; switch (e) { case E.A: r = "a"; break; default: r = "d"; break; case E.B: r = "b"; break; } r;')).toBe('b');
});

// -- Case labels must be enumerators -------------------------------------------
test('a non-enumerator case label in an enum switch is a type error', () => {
  expectThrown('enum E { A, B } let e = E.A; switch (e) { case E.A: break; case 5: break; }');
});

test('a case label from a different enum is a type error', () => {
  expectThrown('enum E { A, B } enum F { X, Y } let e = E.A; switch (e) { case E.A: break; case F.X: break; }');
});

// -- The discriminant is recognized in several forms ---------------------------
test('a parameter annotated with the enum type is checked', () => {
  expectThrown('enum E { A, B } function f(e: E) { switch (e) { case E.A: break; } }');
});

test('a variable annotated with the enum type is checked', () => {
  expectThrown('enum E { A, B } let e: E = E.A; switch (e) { case E.A: break; }');
});

test('an enum with explicit values is checked by exhaustiveness', () => {
  expect(evaluated('enum Code { Ok = 200, Err = 500 } let c = Code.Ok; let r = "none"; switch (c) { case Code.Ok: r = "ok"; break; case Code.Err: r = "err"; break; } r;')).toBe('ok');
  expectThrown('enum Code { Ok = 200, Err = 500 } let c = Code.Ok; switch (c) { case Code.Ok: break; }');
});

// -- Ordinary switch is unaffected ---------------------------------------------
test('a switch whose discriminant is not enum-typed is unaffected', () => {
  expect(evaluated('let x = 2; let r = "none"; switch (x) { case 1: r = "a"; break; case 2: r = "b"; break; } r;')).toBe('b');
  // a partial numeric switch does not require exhaustiveness
  expect(evaluated('let x = 3; let r = "none"; switch (x) { case 1: r = "a"; break; } r;')).toBe('none');
});
