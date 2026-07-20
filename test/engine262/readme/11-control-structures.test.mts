import { test, expect } from 'vitest';
import { evaluated, bool, expectThrown } from './harness.mts';

/**
 * README feature coverage — control structures.
 * Section: Control Structures (if else, switch).
 *
 * if/else truthiness and the ordinary (value-matching) switch are implemented and
 * verified here. The STATIC-checking parts of switch - enum exhaustiveness and the
 * sealed-class switch whose case labels are type objects - are a static
 * type-checker feature (spec sec-narrowing) that is not implemented; they are
 * documented as gaps (PENDING-CAPABILITIES.md capability H). Floating-point
 * discriminants with range case labels are the ranges extension.
 */

// ── if else: truthiness is unchanged ──────────────────────────────────────────
// Nothing about truthiness changes: numeric zero and NaN are falsy, as are 0n,
// the empty string, null, and undefined; every other value, including every typed
// object and every array, is truthy. Zero is falsy for the new numeric types too.
test('if else: a typed numeric zero is falsy, non-zero is truthy', () => {
  expect(evaluated('if ((0 := uint32)) { "truthy"; } else { "falsy"; }')).toBe('falsy');
  expect(evaluated('if ((5 := uint32)) { "truthy"; } else { "falsy"; }')).toBe('truthy');
  // a typed float zero is falsy on the same rule
  expect(evaluated('if ((0 := float32)) { "truthy"; } else { "falsy"; }')).toBe('falsy');
});

test('if else: a typed object and a typed array are always truthy', () => {
  expect(evaluated('class A { x: uint32 = (0 := uint32); } let a = new A(); if (a) { "truthy"; } else { "falsy"; }')).toBe('truthy');
  // an empty array is truthy
  expect(evaluated('let a = []; if (a) { "truthy"; } else { "falsy"; }')).toBe('truthy');
});

// ── switch: value matching on a typed discriminant ────────────────────────────
// A typed integral/string/symbol discriminant matches value cases.
test('switch: a typed integral discriminant matches a value case', () => {
  expect(evaluated('let a: uint32 = (1 := uint32); let r = "none"; switch (a) { case (1 := uint32): r = "one"; break; case (2 := uint32): r = "two"; break; } r;')).toBe('one');
  // a string discriminant
  expect(evaluated('let a: string = "b"; let r = "none"; switch (a) { case "a": r = "A"; break; case "b": r = "B"; break; } r;')).toBe('B');
});

// ── switch: matching on an enum value ─────────────────────────────────────────
// A switch over an enum value matches enumerator cases (an enumerator is its
// underlying value, so value matching applies).
test('switch: an enum-valued discriminant matches enumerator cases', () => {
  expect(evaluated('enum Count { Zero, One, Two }; let a = Count.One; let r = "none"; switch (a) { case Count.Zero: r = "z"; break; case Count.One: r = "o"; break; case Count.Two: r = "t"; break; } r;')).toBe('o');
  // the default is reached when no case matches
  expect(evaluated('enum Count { Zero, One, Two }; let a = Count.Two; let r = "none"; switch (a) { case Count.Zero: r = "z"; break; default: r = "d"; } r;')).toBe('d');
});

// ── Documented gaps ───────────────────────────────────────────────────────────
test('switch: enum exhaustiveness is not checked (documents the gap)', () => {
  // Target (README): a switch over an enum with no default that omits an
  // enumerator is a compile-time TypeError. Today no exhaustiveness check runs, so
  // the switch simply falls through the missing case.
  expect(evaluated('enum Count { Zero, One, Two }; let a = Count.Two; let r = "none"; switch (a) { case Count.Zero: r = "z"; break; case Count.One: r = "o"; break; } r;')).toBe('none');
});

test('switch: sealed-class switch with type-object case labels is not implemented (documents the gap)', () => {
  // Target (README): where the discriminant's static type is a sealed class, each
  // case label is a type object and the case is an instanceof test. Today the
  // label is compared by value, so `case NumberNode:` does not match an instance.
  expect(evaluated('sealed class Node {} class NumberNode extends Node {} let n = new NumberNode(); let r = "none"; switch (n) { case NumberNode: r = "num"; break; } r;')).toBe('none');
});

test('switch: a bare-range case outside the ranges extension is reserved', () => {
  // The core reserves the bare-range case syntax (defined by the ranges
  // extension) and does not accept it as ordinary syntax.
  expectThrown('let a = 0.5; switch (a) { case 0..0.99: break; } "ok";');
});
