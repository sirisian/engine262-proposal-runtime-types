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
  // Brackets for a union's arity, braces for an intersection's, so the two are
  // told apart in one string. Both clauses tested `r.members` and so both fired,
  // giving `union[3]{3}` where the assertions read `union[3]` - harmless while
  // a union exposed `arms` and the first clause was dead, and a failure the
  // moment reflection began exposing `members` for both kinds.
  `const d = (T) => { const r = Reflect.getReflection(T); const n = r.members ? r.members.length : 0;`
  + ` return String(r.kind) + (r.kind === "union" ? "[" + n + "]" : r.kind === "intersection" ? "{" + n + "}" : ""); };`
  + ` ${decl} d(U);`,
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

test('absorption terminates and stays order-independent on RECURSIVE members', () => {
  // The specification once forbade absorption, on the ground that folding by
  // IsSubtype would make the canonical form depend on a relation that READS
  // canonical forms. The circularity does not arise: the fold runs on members
  // the loop above it has ALREADY canonicalized, so IsSubtype is asked about
  // forms that exist rather than about the one being built.
  //
  // These are the cases that would show it if it did - a recursive type, and a
  // MUTUALLY recursive pair, both in a union and in an intersection. Where the
  // relation cannot relate the pair it simply declines and both members stay,
  // which is always sound: absorption is a simplification, never a judgment.
  const kindOf = (decl: string): string => evaluated(
    `const d = (T) => String(Reflect.getReflection(T).kind); ${decl} d(U);`,
  );
  const REC = 'type A = { next: A | null }; type B = { next: B | null, x: uint8 };';
  expect(kindOf(`${REC} type U = B | A;`)).toBe('union');
  expect(kindOf(`${REC} type U = A | B;`)).toBe('union');
  expect(evaluated(`${REC} type U = B | A; type V = A | B; String(U === V);`)).toBe('true');
  expect(kindOf(`${REC} type U = B & A;`)).toBe('intersection');
  const MUT = 'interface A { b: B | null } interface B { a: A | null }';
  expect(kindOf(`${MUT} type U = A | B;`)).toBe('union');
  expect(evaluated(`${MUT} type U = A | B; type V = B | A; String(U === V);`)).toBe('true');
});

test('absorption fires where one member really does subsume the other', () => {
  // And the two kinds keep OPPOSITE survivors, which is the whole reason the
  // rule is directional: a union keeps the wider, an intersection the narrower.
  const S = 'type Wide = { a: uint8 }; type Narrow = { a: uint8, b: string };';
  expect(evaluated(`${S} type U = Narrow | Wide; type V = Wide; String(U === V);`)).toBe('true');
  expect(evaluated(`${S} type U = Wide | Narrow; type V = Wide; String(U === V);`)).toBe('true');
  expect(evaluated(`${S} type U = Narrow & Wide; type V = Narrow; String(U === V);`)).toBe('true');
  expect(evaluated(`${S} type U = Wide & Narrow; type V = Narrow; String(U === V);`)).toBe('true');
});
