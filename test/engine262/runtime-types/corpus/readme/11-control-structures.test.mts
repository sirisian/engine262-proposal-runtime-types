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

test('a bare test narrows a NULLABLE, and nothing else', () => {
  // table-narrowing-forms: "`v` as the test itself, where _s_ is a ~union~ with
  // a `null` or an `undefined` member" - NarrowFrom(_s_, `null | undefined`)
  // where the test succeeds, NarrowTo where it fails.
  expect(evaluated('function f(n: uint8 | null): uint8 { if (n) { return n; } return (0 := uint8); } `${f(null)}`;')).toBe('0');
  expect(evaluated('function f(n: uint8 | undefined): uint8 { if (n) { return n; } return (0 := uint8); } `${f(undefined)}`;')).toBe('0');
  // The else branch is the nullish one, so the binding takes `null` there.
  expect(evaluated('function f(n: uint8 | null): string { if (n) { return "p"; } else { let x: null = n; return "a"; } } `${f(null)}`;')).toBe('a');
  // `!v` inverts, and a conditional expression narrows as an `if` does.
  expect(evaluated('function f(n: uint8 | null): uint8 { if (!n) { return (0 := uint8); } else { return n; } } `${f(null)}`;')).toBe('0');
  expect(evaluated('function f(n: uint8 | null): uint8 { return n ? n : (0 := uint8); } `${f(null)}`;')).toBe('0');
  // An object union narrows to the member, so a property read is admitted.
  expect(evaluated('function f(o: { a: uint8 } | null): uint8 { if (o) { return o.a; } return (0 := uint8); } `${f(null)}`;')).toBe('0');
  // AND NOTHING ELSE. `0` is a value of `uint8` and the empty String is a value
  // of `string`, so a test on a type with no nullish member narrows nothing -
  // `if (count)` must not read as a type test that excludes a number the type
  // admits. Both arms still see the full type, so both compile.
  expect(evaluated('function f(n: uint8): uint8 { if (n) { return n; } else { return n; } } `${f(0 := uint8)}`;')).toBe('0');
  expect(evaluated('function f(s: string): string { if (s) { return s; } else { return s; } } `${f("")}`;')).toBe('');
});

test('a guard clause carries its fact to the statements after it', () => {
  // #sec-narrowing: the Static Type at a point is the declared type "refined by
  // the narrowing facts that HOLD THERE". Where one branch cannot complete, the
  // other branch's fact holds after the `if` - reaching that point is what the
  // taken branch made impossible. Only the `else` spelling worked before.
  expect(evaluated('function f(n: uint8 | null): uint8 { if (n === null) { return (0 := uint8); } return n; } `${f(null)}`;')).toBe('0');
  expect(evaluated('function f(n: uint8 | null): uint8 { if (n === null) { throw new Error("x"); } return n; } `${f(7 := uint8)}`;')).toBe('7');
  // Either direction: an `else` that leaves carries the TRUE branch's fact.
  expect(evaluated('function f(n: uint8 | null): uint8 { if (n != null) { } else { return (0 := uint8); } return n; } `${f(null)}`;')).toBe('0');
  // And through the bare-test row as well as an explicit comparison.
  expect(evaluated('function f(n: uint8 | null): uint8 { if (!n) { return (0 := uint8); } return n; } `${f(null)}`;')).toBe('0');
  // AN ASSIGNMENT STILL ENDS IT. This is the case that makes the fact's frame
  // matter: `invalidateNarrowing` deletes the entry from whichever frame holds
  // it, so the fact must live in a frame PUSHED for the remaining statements -
  // put in the frame that holds the declaration, the same deletion would remove
  // the declaration itself and the binding would read as untyped.
  expectThrown('function f(n: uint8 | null): uint8 { if (n === null) { return (0 := uint8); } n = null; return n; }', 'is not assignable to');
  // Neither branch leaving means control joins, so no fact holds after.
  expectThrown('function f(n: uint8 | null): uint8 { if (n === null) { } return n; }', 'is not assignable to');
});
