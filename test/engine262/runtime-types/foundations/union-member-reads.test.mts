import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-static-type-of-an-expression, the union member-read rule.
 *
 * "Reading a member of a UNION gives the union of that member's type across the
 * union's members, and is a type error where a member SOME of them declare is
 * read without narrowing." The accessible keys are the INTERSECTION of the
 * members' keys, because the program cannot know which member it holds.
 *
 * A key NO member declares is a different situation and not this rule's: every
 * member agrees the key is absent, so the uncertainty the rule exists for does
 * not arise, and #sec-typed-storage governs the read - "READING a property the
 * type does not declare is unaffected ... `if (o.maybe)`, `typeof o.maybe`, and
 * `o.absent === undefined` are all ordinary. The asymmetry is deliberate."
 *
 * Refusing those made a union the ONE receiver in the language where such a read
 * was refused, and refused inconsistently: `typeof u.zz` and `u?.zz` were
 * accepted throughout, reaching other arms of the same operation.
 */

test('a key SOME member declares is refused without narrowing', () => {
  expectThrown('let u: { x: int32 } | { y: string } = { x: int32(1) }; let q = u.x;',
    'is not declared by every member');
  expectThrown('let u: { x: int32 } | { y: string } = { y: "s" }; let q = u.y;',
    'is not declared by every member');
  // Three members, one lacking it, is the same case.
  expectThrown('let u: { x: int32 } | { x: int8 } | { y: string } = { x: int32(1) }; let q = u.x;',
    'is not declared by every member');
  // A `null` member declares nothing, which is what makes every read of a
  // nullable object this case.
  expectThrown('let u: { x: int32 } | null = null; let q = u.x;',
    'is not declared by every member');
});

test('a key EVERY member declares reads, and reading it as one member does not', () => {
  // The discriminant is readable, which is what makes narrowing possible at all.
  expect(ok('let u: { a: uint8 } | { a: string } = { a: uint8(1) }; let q = u.a; "ok";')).toBe(true);
  // ...but its type is the union, so reading it AS one member is refused.
  expectThrown('let u: { x: int32 } | { x: int8 } = { x: int32(1) }; let q: int32 = u.x;');
  // Narrowing is the escape, for a discriminated union and for a member only one
  // arm declares.
  expect(ok('let u: { k: "a", v: uint8 } | { k: "b", v: string } = { k: "a", v: uint8(1) };'
    + ' if (u.k === "a") { let q: uint8 = u.v; } "ok";')).toBe(true);
  expect(ok('let u: { x: int32 } | { y: string } = { x: int32(1) };'
    + ' if (u is { x: int32 }) { let q = u.x; } "ok";')).toBe(true);
});

test('a key NO member declares is an ordinary absent read', () => {
  const U = 'let u: { a: uint8 } | { b: uint8 } = { a: uint8(1) }; ';
  // The three programs #sec-typed-storage names as ordinary.
  expect(ok(`${U}if (u.maybe) { } "ok";`)).toBe(true);
  expect(ok(`${U}let q = typeof u.absent; "ok";`)).toBe(true);
  expect(ok(`${U}let q = u.absent === undefined; "ok";`)).toBe(true);
  // A plain read and an optional one, which must not disagree with each other.
  expect(ok(`${U}let q = u.zz; "ok";`)).toBe(true);
  expect(ok(`${U}let q = u?.zz; "ok";`)).toBe(true);
  // An Object.prototype member is declared by no arm's structure and is
  // reachable on every value the union admits.
  const V = 'let u: { a: uint8 } | { a: string } = { a: uint8(1) }; ';
  expect(ok(`${V}let q = u.toString(); "ok";`)).toBe(true);
  expect(ok(`${V}let q = u.hasOwnProperty("a"); "ok";`)).toBe(true);
});
