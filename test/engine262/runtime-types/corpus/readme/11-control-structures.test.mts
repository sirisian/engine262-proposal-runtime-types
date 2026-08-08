import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectErrorFlagOff } from '../../harness.mts';

/**
 * README feature coverage - control structures.
 * Section: Control Structures (if else, switch).
 *
 * if/else truthiness and the ordinary (value-matching) switch are implemented and
 * verified here, as is enum switch exhaustiveness: a switch over an enumerator must
 * cover every enumerator when it has no default, and its labels must be enumerators
 * of that enum (#sec-enums). The sealed-class switch, whose case labels are type
 * objects compiled to instanceof tests with narrowing (#sec-narrowing), is a
 * deeper static-checker and runtime-dispatch feature and is documented as deferred
 * below. Floating-point discriminants with range case labels are the ranges
 * extension.
 */

// -- if else: truthiness is unchanged ------------------------------------------
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

// -- switch: value matching on a typed discriminant ----------------------------
// A typed integral/string/symbol discriminant matches value cases.
test('switch: a typed integral discriminant matches a value case', () => {
  expect(evaluated('let a: uint32 = (1 := uint32); let r = "none"; switch (a) { case (1 := uint32): r = "one"; break; case (2 := uint32): r = "two"; break; } r;')).toBe('one');
  // a string discriminant
  expect(evaluated('let a: string = "b"; let r = "none"; switch (a) { case "a": r = "A"; break; case "b": r = "B"; break; } r;')).toBe('B');
});

// -- switch: matching on an enum value -----------------------------------------
// A switch over an enum value matches enumerator cases (an enumerator is its
// underlying value, so value matching applies).
test('switch: an enum-valued discriminant matches enumerator cases', () => {
  expect(evaluated('enum Count { Zero, One, Two }; let a = Count.One; let r = "none"; switch (a) { case Count.Zero: r = "z"; break; case Count.One: r = "o"; break; case Count.Two: r = "t"; break; } r;')).toBe('o');
  // the default is reached when no case matches
  expect(evaluated('enum Count { Zero, One, Two }; let a = Count.Two; let r = "none"; switch (a) { case Count.Zero: r = "z"; break; default: r = "d"; } r;')).toBe('d');
});

// -- Documented gaps -----------------------------------------------------------
// -- switch: enum exhaustiveness -----------------------------------------------
// A switch over an enumerator must cover every enumerator when it has no default,
// and its case labels must be enumerators of that enum (#sec-enums; README
// "Control Structures").
test('switch: an enum switch missing an enumerator with no default is a type error', () => {
  expectThrown('enum Count { Zero, One, Two }; let a = Count.Two; switch (a) { case Count.Zero: break; case Count.One: break; }');
});

test('switch: a complete enum switch is accepted', () => {
  expect(evaluated('enum Count { Zero, One }; let a = Count.Zero; let r = "none"; switch (a) { case Count.Zero: r = "z"; break; case Count.One: r = "o"; break; } r;')).toBe('z');
});

test('switch: an enum switch with a default need not list every enumerator', () => {
  expect(evaluated('enum Count { Zero, One, Two }; let a = Count.Zero; let r = "none"; switch (a) { case Count.Zero: r = "z"; break; default: r = "d"; } r;')).toBe('z');
});

test('switch: a non-enumerator case label in an enum switch is a type error', () => {
  expectThrown('enum Count { Zero, One }; let a = Count.Zero; switch (a) { case Count.Zero: break; case 5: break; }');
});

test('switch: sealed-class switch with type-object case labels is not implemented (documents the gap)', () => {
  // Target (README): where the discriminant's static type is a sealed class, each
  // case label is a type object and the case is an instanceof test. Today the
  // label is compared by value, so `case NumberNode:` does not match an instance.
  expect(evaluated('sealed class Node {} class NumberNode extends Node {} let n = new NumberNode(); let r = "none"; switch (n) { case NumberNode: r = "num"; break; } r;')).toBe('none');
});

test('switch: a bare-range case is reserved without the ranges extension', () => {
  // The core reserves the bare-range case syntax for the ranges extension. With
  // the feature off it is not ordinary syntax and does not parse.
  expectErrorFlagOff('let a = 0.5; switch (a) { case 0..<0.99: break; } "ok";');
  // With the extension a range case label is an ordinary range expression and
  // parses; matching a range case by containment is deferred, so a range label
  // compares by identity here and an integer discriminant falls through.
  expect(evaluated('let a = 5; switch (a) { case 0..<10: "in"; break; default: "out"; } "ran";')).toBe('ran');
});
