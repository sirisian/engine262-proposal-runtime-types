import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * PLAN-typed-collections.md sec 6.7 - collection MEMBERSHIP and the type patterns
 * built on it. D12 (new) and D7 (relocated).
 *
 * D12 - FIXED IN PHASE 3. Membership on a collection specialization now compares
 * the type arguments against the [[TypedCollection]] stamp, so these tests
 * assert behaviour rather than record a gap.
 *
 * What was wrong: `m is Map.<string, string>` was *true* for a
 * `Map.<string, uint8>`, and `new Map() is Map.<string, uint8>` was *true* for a
 * collection with no type arguments at all. Membership was a bare prototype-chain
 * test that never consulted [[Arguments]], so every specialization of `Map` had
 * the same extension and the test answered nothing.
 *
 * THE FIX HAD A CONSEQUENCE WORTH KNOWING, because it is the shape of the next
 * one. Membership was doing duty for two different questions: "is this value
 * already of type T", asked by the CONVERSION BOUNDARY so it can skip converting,
 * and "does this value claim to be T", asked by `is`. The boundary was relying on
 * the loose answer - any Map passed, so the branch that STAMPS a fresh
 * `new Map()` was reached. Tightening membership for `is` therefore refused every
 * annotation: `let m: Map.<string, uint8> = new Map()` threw, because an
 * unstamped Map is not a `Map.<string, uint8>` and never got the chance to
 * become one.
 *
 * So the boundary now ADOPTS an unstamped collection into the target's arguments
 * before asking, at both of its two sites - and there are two, which is how the
 * first attempt still left every annotation refused. Only an unstamped
 * collection is adopted; one already carrying arguments is judged on their
 * merits, so `let m: Map.<string, uint8> = someMapOfStrings` is still refused
 * rather than silently re-stamped.
 *
 * This contradicts `sec-issubtype` - "a generic class is invariant in its
 * arguments, so `Map.<string, uint8>` is a subtype of no other instantiation of
 * `Map`" - which names `Map` as its example, and it contradicts the relations,
 * since `Reflect.isAssignable(type Map.<string, uint8>, type Map.<string,
 * number>)` correctly answers *false*. So the three-way agreement that
 * `foundations/generic-instance-membership.test.mts` established for a USER
 * generic (SameType, IsAssignable and `is` all agreeing) does not hold for a
 * library one.
 *
 * The cause was the same as that file's "OUTSTANDING item N", one level along. A
 * user generic's specialization is a distinct constructor, so membership was
 * fixed by carrying the right constructor on the Type Record. A library
 * collection has no per-specialization constructor - the specialization is
 * carried by the [[TypedCollection]] stamp instead - and IsOfType had never been
 * taught to read it.
 *
 * DECIDED BY THE STAMP RATHER THAN BY CONTENTS (OQ8). Inspecting the entries
 * would be the ARRAY's answer - `[1,2,3] is [].<uint8>` walks elements - and it
 * loses on three counts: it is O(n) per test in the positions `is` is read from
 * (narrowing, a `when` arm, a `catch` match, each of which can sit in a loop);
 * its answer is invalidated by the next store, so a narrowing cannot be relied on
 * downstream; and it would licence the unsoundness invariance exists to prevent,
 * since what a container will ACCEPT NEXT is not a function of what it currently
 * holds. That makes the array's contents-inspecting answer the questionable one,
 * which is filed rather than changed here.
 *
 * CONSEQUENCES BEYOND `is`, all of which follow: narrowing reads membership,
 * `catch (e: Map.<K, V>)` selects on the specialization, and a `when` pattern
 * naming one selects on it too - which is why the pattern tests live in this
 * file rather than in a pattern-matching one. They are membership wearing
 * different syntax.
 *
 * D7, CORRECTED. An earlier draft filed "a type pattern over a collection does
 * not match" as a collections defect on the strength of `match (m) { when
 * (Map.<K: type, V: type>): ... }` throwing. That spelling was wrong twice over -
 * the design's form is `when extends Map.<K: type, V: type>:`, and its subject is
 * a TYPE OBJECT rather than an instance. Written correctly it still fails, but
 * so does `when extends uint8:` and `when extends string:`, with the same
 * "Unexpected token". **The `when extends` form is unimplemented across the
 * board.** That is a pattern-matching gap and NOT a collections one; it is
 * recorded here only so the finding is not lost, and the collections work will
 * not move it.
 */

// ---------------------------------------------------------------------------
// D12 - membership must read the type arguments
// ---------------------------------------------------------------------------

test('D12: `is` discriminates between two specializations of Map', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map.<string, string>);')).toBe('false');
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map.<uint8, uint8>);')).toBe('false');
});

test('D12: `is` discriminates between two specializations of Set', () => {
  expect(evaluated('const s = new Set.<uint8>(); String(s is Set.<string>);')).toBe('false');
});

test('D12: an UNTYPED collection is not a member of a specialization', () => {
  // The invariant of sec 0 read in the other direction. An untyped Map is an
  // ordinary Map, and an ordinary Map is not a `Map.<string, uint8>` - it makes
  // no promise about what it holds, which is exactly what the specialization is.
  expect(evaluated('const m = new Map(); String(m is Map.<string, uint8>);')).toBe('false');
  expect(evaluated('const s = new Set(); String(s is Set.<uint8>);')).toBe('false');
});

test('D12: the three relations agree, as they do for a user generic', () => {
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

test('D12: a `when` pattern naming a specialization selects on it', () => {
  // Membership in different syntax: `when T:` tests membership, so this arm and
  // the `is` above are one question.
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map.<string, string>: "wrong"; default: "fell through"; }')).toBe('fell through');
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map.<string, uint8>: "right"; default: "fell through"; }')).toBe('right');
});

test('D12: a typed catch selects on the specialization', () => {
  // A `catch` whose annotation does not match must NOT catch, so the throw
  // escapes the script. Asserted as "the program does not complete normally",
  // which is what an uncaught throw looks like from here - writing the arm's
  // value instead would assert the broken behaviour rather than the wanted one.
  expect(ok('try { throw new Map.<string, uint8>(); } catch (e: Map.<string, string>) { "wrongly caught"; }')).toBe(false);
  // The matching annotation does catch, and the two must not be traded.
  expect(evaluated('try { throw new Map.<string, uint8>(); } catch (e: Map.<string, uint8>) { "caught"; }')).toBe('caught');
});

// ---------------------------------------------------------------------------
// D7 - the `when extends` form, recorded and NOT owned by this plan
// ---------------------------------------------------------------------------

test.fails('D7: `when extends` over a type object is unimplemented (not collection-specific)', () => {
  // The collection spelling the design gives...
  expect(ok('match (type Map.<string, uint8>) { when extends Map.<K: type, V: type>: 1; default: 0; }')).toBe(true);
  // ...and the two non-collection spellings that fail identically, which is what
  // places the defect outside this plan.
  expect(ok('match (type uint8) { when extends uint8: 1; default: 0; }')).toBe(true);
  expect(ok('match (type string) { when extends string: 1; default: 0; }')).toBe(true);
});

// ---------------------------------------------------------------------------
// Controls - these hold today and must keep holding
// ---------------------------------------------------------------------------

test('control: membership against the BARE nominal, and the user-generic answer', () => {
  // A collection is a Map. This much membership does get right, and D12's fix
  // must not break it.
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map);')).toBe('true');
  expect(evaluated('const m = new Map(); String(m is Map);')).toBe('true');
  expect(evaluated('const s = new Set.<uint8>(); String(s is Set);')).toBe('true');
  // A user generic already discriminates, which is the behaviour D12 asks the
  // library nominals to match.
  expect(evaluated('class G<T> { x: uint8; } String(new G.<uint8>() is G.<string>);')).toBe('false');
  expect(evaluated('class G<T> { x: uint8; } String(new G.<uint8>() is G.<uint8>);')).toBe('true');
});

test('control: a Map is not a Set and neither is an ordinary object', () => {
  expect(evaluated('const m = new Map(); String(m is Set);')).toBe('false');
  expect(evaluated('const o = {}; String(o is Map);')).toBe('false');
  expect(evaluated('const m = new Map(); String(m instanceof Map);')).toBe('true');
});

test('control: the assignability relation is already correct', () => {
  // IsAssignable reads the arguments and answers correctly. It is `is` that does
  // not, which is what makes D12 a contradiction rather than a uniform gap - and
  // what makes it fixable without deciding anything new.
  expect(evaluated('String(Reflect.isAssignable(type Map.<string, uint8>, type Map.<string, number>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type Map.<string, uint8>, type Map.<string, uint8>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type Set.<uint8>, type Set.<string>));')).toBe('false');
});

test('control: `when` and `catch` still work at the bare nominal', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map: "matched"; default: "no"; }')).toBe('matched');
  expect(evaluated('try { throw new Map(); } catch (e: Map) { "caught"; }')).toBe('caught');
  // A bare type name in `when` position tests MEMBERSHIP, so against a type
  // object it is always false - the design states this as the reason `extends`
  // exists at all.
  expect(evaluated('match (type uint8) { when uint8: "m"; default: "no"; }')).toBe('no');
});
