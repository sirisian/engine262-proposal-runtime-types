import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// A union of a literal and its base type discarded the BASE, so `"a" | string`
// rejected `"b"` - a value the `string` arm plainly admits.
//
// Canonicalization de-duplicated members by dropping any that a PRECEDING member
// was `SameType` to, and `SameType` is asymmetric for a literal against a
// non-literal: it answers true for ("a", string) and false for (string, "a").
// So the reduction fired in one written order and not the other, and the same
// type written two ways behaved differently.
//
// The replacement reduces by SUBSUMPTION and is DIRECTIONAL, because the two
// kinds want opposite survivors: a union keeps the wider member, an
// intersection the narrower. A single "keep the wider" rule would fix unions and
// break intersections - which were right by accident, so every intersection case
// here needs both orders too.

const kind = (decl: string): string => evaluated(
  `const d = (T) => { const r = Reflect.getReflection(T); return String(r.kind) + (r.members ? "[" + r.members.length + "]" : "") + (r.members ? "{" + r.members.length + "}" : ""); }; ${decl} d(U);`,
);

test('a union keeps the wider member, in either order', () => {
  expect(evaluated('type U = "a" | string; let x: U = "b"; String(x);')).toBe('b');
  expect(evaluated('type U = string | "a"; let x: U = "b"; String(x);')).toBe('b');
  expect(evaluated('type U = 1 | number; let x: U = 5; String(x);')).toBe('5');
  expect(evaluated('type U = number | 1; let x: U = 5; String(x);')).toBe('5');
  expect(evaluated('type U = true | boolean; let x: U = false; String(x);')).toBe('false');
  expect(evaluated('type U = boolean | true; let x: U = false; String(x);')).toBe('false');
  // The canonical form is the base type itself, not a two-arm union.
  expect(kind('type U = "a" | string;')).toBe('primitive');
  expect(kind('type U = string | "a";')).toBe('primitive');
});

test('an intersection keeps the narrower member, in either order', () => {
  // `"a" & string` is `"a"`. This was already correct in one order and not the
  // other, so asserting only the first would prove nothing.
  expect(kind('type U = "a" & string;')).toBe('literal');
  expect(kind('type U = string & "a";')).toBe('literal');
  expect(kind('type U = 1 & number;')).toBe('literal');
  expect(kind('type U = number & 1;')).toBe('literal');
});

test('reduction does not over-collapse', () => {
  // Distinct literals are not related by subsumption and both survive.
  expect(evaluated('type U = "a" | "b"; let x: U = "b"; String(x);')).toBe('b');
  expectThrown('type U = "a" | "b"; let x: U = "c";');
  // A sized type is not the base of a numeric literal, so this never reduced
  // and must still not.
  expect(evaluated('type U = 5 | uint8; let x: U = 7; String(Number(x));')).toBe('7');
  // A genuine duplicate still collapses to one member.
  expect(kind('type A = uint8; type U = A | A;')).toBe('primitive');
});

test('the other union identities are unchanged', () => {
  expect(kind('type U = uint8 | never;')).toBe('primitive');
  expect(kind('type U = (uint8 | string) | boolean;')).toBe('union[3]');
  expect(kind('type A = { a: uint8 }; type B = { b: uint8 }; type C = { c: uint8 }; type U = (A & B) & C;')).toBe('intersection{3}');
  expect(evaluated('type U = uint8 | string; let x: U = "s"; String(x);')).toBe('s');
});
