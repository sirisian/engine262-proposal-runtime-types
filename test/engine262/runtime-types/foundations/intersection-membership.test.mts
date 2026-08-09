import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// sec-type-membership: "An intersection type. A value belongs to it if it
// belongs to every member."
//
// `CheckedConvertValue` had a `union` branch and no `intersection` one, so an
// intersection record fell past every case to the terminal refusal and NO value
// could satisfy one - `type C = A & B; let c: C = { a: 1, b: 2 }` was a
// TypeError.
//
// Nothing caught it because intersections were tested only at the TYPE level:
// of 16 intersection declarations in the suite, all were `keyof`, interning,
// assignability, or reflection, and none bound a VALUE. These do.

test('a value belongs to an intersection when it belongs to every member', () => {
  expect(evaluated('type A = { a: uint8 }; type B = { b: uint8 }; type C = A & B; let c: C = { a: 1, b: 2 }; String(Number(c.a));')).toBe('1');
  expect(evaluated('type C = { a: uint8 } & { b: uint8 }; let c: C = { a: 1, b: 2 }; String(Number(c.b));')).toBe('2');
  expect(evaluated('interface I { a: uint8 } interface J { b: uint8 } type C = I & J; let c: C = { a: 1, b: 2 }; String(Number(c.a));')).toBe('1');
  // More than two members.
  expect(evaluated('type A = { a: uint8 }; type B = { b: uint8 }; type D = { d: uint8 }; type C = A & B & D; let c: C = { a: 1, b: 2, d: 3 }; String(Number(c.d));')).toBe('3');
  // And at an argument, not only a binding.
  expect(evaluated('type A = { a: uint8 }; type B = { b: uint8 }; type C = A & B; function f(x: C) { return x.a; } String(Number(f({ a: 7, b: 1 })));')).toBe('7');
});

test('EVERY member contributes its conversion', () => {
  // The property that makes threading the members correct: conversion to an
  // object type coerces in place and returns the same object, so each member
  // applies its own coercion and both sides end up typed.
  expect(evaluated('type A = { a: uint8 }; type B = { b: uint8 }; type C = A & B; let c: C = { a: 1, b: 2 }; String(c.a is uint8) + "/" + String(c.b is uint8);')).toBe('true/true');
});

test('a value failing any member is refused', () => {
  // Missing the second member's property.
  expectThrown('type A = { a: uint8 }; type B = { b: uint8 }; type C = A & B; let c: C = { a: 1 };');
  // Present but out of range, which the member itself refuses.
  expectThrown('type A = { a: uint8 }; type B = { b: uint8 }; type C = A & B; let c: C = { a: 300, b: 1 };');
});

test('the union is unaffected, and differs as it should', () => {
  // A union needs ONE member; the intersection above needs every one. Sited
  // together so the asymmetry is visible if either regresses.
  expect(evaluated('type A = { a: uint8 }; type B = { b: uint8 }; type C = A | B; let c: C = { a: 1 }; String(Number(c.a));')).toBe('1');
  expectThrown('type A = { a: uint8 }; type B = { b: uint8 }; type C = A & B; let c: C = { a: 1 };');
});
