import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * Collection MEMBERSHIP and the type patterns built on it (#sec-collection-membership). A value is of the
 * type `Map.<K, V>` when it is a Map and the type arguments it CARRIES are K and V; an argument written
 * `any` admits any instantiation in its position. Membership is compared against the [[TypedCollection]]
 * stamp: a bare prototype-chain test never consults [[Arguments]], so every specialization of `Map` would
 * have the same extension and the test would answer nothing (`m is Map.<string, string>` true for a
 * `Map.<string, uint8>`, and `new Map() is Map.<string, uint8>` true for a collection with no type
 * arguments at all).
 *
 * Membership answers two different questions: "is this value already of type T", asked by the CONVERSION
 * BOUNDARY so it can skip converting, and "does this value claim to be T", asked by `is`. So the boundary
 * ADOPTS an unstamped collection into the target's arguments before asking, at both of its sites: `let
 * m: Map.<string, uint8> = new Map()` must be accepted, since an unstamped Map is not yet a
 * `Map.<string, uint8>` and would otherwise never get the chance to become one. Only an unstamped
 * collection is adopted; one already carrying arguments is judged on its merits, so `let m: Map.<string,
 * uint8> = someMapOfStrings` is still refused rather than silently re-stamped.
 *
 * The three relations agree, as they do for a user generic (foundations/generic-instance-membership): SameType,
 * IsAssignable and `is` all agree, and `Reflect.isAssignable(type Map.<string, uint8>, type Map.<string,
 * number>)` is false. A user generic's specialization is a distinct constructor, so membership is carried by
 * the constructor on the Type Record; a library collection has no per-specialization constructor, so the
 * specialization is carried by the [[TypedCollection]] stamp and IsOfType reads it.
 *
 * DECIDED BY THE STAMP RATHER THAN BY CONTENTS. Inspecting the entries would be the ARRAY's answer -
 * `[1,2,3] is [].<uint8>` walks elements - and it loses on three counts: it is O(n) per test in the
 * positions `is` is read from (narrowing, a `when` arm, a `catch` match, each of which can sit in a loop);
 * its answer is invalidated by the next store, so a narrowing cannot be relied on downstream; and it would
 * licence the unsoundness invariance exists to prevent, since what a container will ACCEPT NEXT is not a
 * function of what it currently holds. That makes the array's contents-inspecting answer the questionable
 * one, which is noted here rather than changed.
 *
 * CONSEQUENCES BEYOND `is`, all of which follow: narrowing reads membership, `catch (e: Map.<K, V>)`
 * selects on the specialization, and a `when` pattern naming one selects on it too - which is why the
 * pattern tests live in this file rather than in a pattern-matching one. They are membership wearing
 * different syntax.
 *
 * THE `when extends` FORM, over a type object: `match (type Map.<string, uint8>) { when extends Map.<K:
 * type, V: type>: ... }`. Divergence: the form is specified (#sec-matchtypepattern) and the engine does
 * not parse it - `when extends uint8:` and `when extends string:` fail with the same "Unexpected token".
 * It is a pattern-matching gap and not a collections one, recorded here as a `test.fails` so the finding
 * is not lost.
 */

// ---------------------------------------------------------------------------
// Membership must read the type arguments
// ---------------------------------------------------------------------------

test('`is` discriminates between two specializations of Map', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map.<string, string>);')).toBe('false');
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map.<uint8, uint8>);')).toBe('false');
});

test('`is` discriminates between two specializations of Set', () => {
  expect(evaluated('const s = new Set.<uint8>(); String(s is Set.<string>);')).toBe('false');
});

test('an UNTYPED collection is not a member of a specialization', () => {
  // The invariant of sec 0 read in the other direction. An untyped Map is an
  // ordinary Map, and an ordinary Map is not a `Map.<string, uint8>` - it makes
  // no promise about what it holds, which is exactly what the specialization is.
  expect(evaluated('const m = new Map(); String(m is Map.<string, uint8>);')).toBe('false');
  expect(evaluated('const s = new Set(); String(s is Set.<uint8>);')).toBe('false');
});

test('the three relations agree, as they do for a user generic', () => {
  // The evidence shape `generic-instance-membership.test.mts` uses: a fix that
  // moved one of these without the others would trade one contradiction for
  // another.
  const m = 'const m = new Map.<string, uint8>(); ';
  expect(evaluated(`${m} String(Reflect.typeOf(m) === (type Map.<string, uint8>));`)).toBe('true');
  expect(evaluated(`${m} String(Reflect.isAssignable(Reflect.typeOf(m), type Map.<string, uint8>));`)).toBe('true');
  expect(evaluated(`${m} String(m is Map.<string, uint8>);`)).toBe('true');
  // ...and all three answer false for a different specialization.
  expect(evaluated(`${m} String(Reflect.isAssignable(Reflect.typeOf(m), type Map.<string, string>));`)).toBe('false');
  expect(evaluated(`${m} String(m is Map.<string, string>);`)).toBe('false');
});

test('a `when` pattern naming a specialization selects on it', () => {
  // Membership in different syntax: `when T:` tests membership, so this arm and
  // the `is` above are one question.
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map.<string, string>: "wrong"; default: "fell through"; }')).toBe('fell through');
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map.<string, uint8>: "right"; }')).toBe('right');
});

test('a typed catch selects on the specialization', () => {
  // A `catch` whose annotation does not match must NOT catch, so the throw
  // escapes the script. Asserted as "the program does not complete normally",
  // which is what an uncaught throw looks like from here - writing the arm's
  // value instead would assert the broken behaviour rather than the wanted one.
  expect(ok('try { throw new Map.<string, uint8>(); } catch (e: Map.<string, string>) { "wrongly caught"; }')).toBe(false);
  // The matching annotation does catch, and the two must not be traded.
  expect(evaluated('try { throw new Map.<string, uint8>(); } catch (e: Map.<string, uint8>) { "caught"; }')).toBe('caught');
});

// ---------------------------------------------------------------------------
// The `when extends` form, recorded and NOT owned by the collections work
// ---------------------------------------------------------------------------

test.fails('`when extends` over a type object is unimplemented (not collection-specific)', () => {
  // The collection spelling...
  expect(ok('match (type Map.<string, uint8>) { when extends Map.<K: type, V: type>: 1; default: 0; }')).toBe(true);
  // ...and the two non-collection spellings that fail identically, which is what
  // places the defect outside the collections work.
  expect(ok('match (type uint8) { when extends uint8: 1; default: 0; }')).toBe(true);
  expect(ok('match (type string) { when extends string: 1; default: 0; }')).toBe(true);
});

// ---------------------------------------------------------------------------
// Controls - these hold today and must keep holding
// ---------------------------------------------------------------------------

test('control: membership against the BARE nominal, and the user-generic answer', () => {
  // A collection is a Map. This much membership does get right, and the fix
  // must not break it.
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map);')).toBe('true');
  expect(evaluated('const m = new Map(); String(m is Map);')).toBe('true');
  expect(evaluated('const s = new Set.<uint8>(); String(s is Set);')).toBe('true');
  // A user generic already discriminates, which is the behaviour the library
  // nominals are asked to match.
  expect(evaluated('class G<T: type> { x: uint8; } String(new G.<uint8>() is G.<string>);')).toBe('false');
  expect(evaluated('class G<T: type> { x: uint8; } String(new G.<uint8>() is G.<uint8>);')).toBe('true');
});

test('control: a Map is not a Set and neither is an ordinary object', () => {
  expect(evaluated('const m = new Map(); String(m is Set);')).toBe('false');
  expect(evaluated('const o = {}; String(o is Map);')).toBe('false');
  expect(evaluated('const m = new Map(); String(m instanceof Map);')).toBe('true');
});

test('control: the assignability relation is already correct', () => {
  // IsAssignable reads the arguments and answers correctly. It is `is` that does
  // not, which makes this a contradiction rather than a uniform gap - and what
  // makes it fixable without deciding anything new.
  expect(evaluated('String(Reflect.isAssignable(type Map.<string, uint8>, type Map.<string, number>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type Map.<string, uint8>, type Map.<string, uint8>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type Set.<uint8>, type Set.<string>));')).toBe('false');
});

test('control: `when` and `catch` still work at the bare nominal', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map: "matched"; default: "no"; }')).toBe('matched');
  expect(evaluated('try { throw new Map(); } catch (e: Map) { "caught"; }')).toBe('caught');
  // A bare type name in `when` position tests MEMBERSHIP (#sec-matchtypepattern), so against a type object
  // it is always false: that is the reason `extends` exists at all.
  expect(evaluated('match (type uint8) { when uint8: "m"; default: "no"; }')).toBe('no');
});
