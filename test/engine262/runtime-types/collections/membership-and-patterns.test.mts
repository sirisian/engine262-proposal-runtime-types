import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * PLAN-typed-collections.md §6.7 - collection MEMBERSHIP and the type patterns
 * built on it. D12 (new) and D7 (relocated).
 *
 * D12: A SPECIALIZATION OF A LIBRARY COLLECTION DOES NOT DISCRIMINATE ON ITS
 * TYPE ARGUMENTS. `m is Map.<string, string>` is *true* for a
 * `Map.<string, uint8>`, and `new Map() is Map.<string, uint8>` is *true* for a
 * collection with no type arguments at all. Membership is a bare prototype-chain
 * test that never consults [[Arguments]], so every specialization of `Map` has
 * the same extension and the test answers nothing.
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
 * The cause is the same as that file's "OUTSTANDING item N", one level along. A
 * user generic's specialization is a distinct constructor, so membership was
 * fixed by carrying the right constructor on the Type Record. A library
 * collection has no per-specialization constructor - the specialization is
 * carried by the [[TypedCollection]] stamp instead - and IsOfType was never
 * taught to read it. The stamp is on the value already, so the fix is local:
 * membership against a nominal with arguments compares them against the stamp.
 *
 * CONSEQUENCES BEYOND `is`. Narrowing reads membership, so narrowing a value to
 * a collection specialization produces a type the value need not have. `catch (e:
 * Map.<K, V>)` catches any Map. And a `when` pattern naming a specialization
 * matches any collection, which is why the pattern tests live in this file
 * rather than in a pattern-matching one: they are membership wearing different
 * syntax.
 *
 * D7, CORRECTED. An earlier draft filed "a type pattern over a collection does
 * not match" as a collections defect on the strength of `match (m) { when
 * (Map.<K: type, V: type>): … }` throwing. That spelling was wrong twice over -
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

test.fails('D12: `is` discriminates between two specializations of Map', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map.<string, string>);')).toBe('false');
  expect(evaluated('const m = new Map.<string, uint8>(); String(m is Map.<uint8, uint8>);')).toBe('false');
});

test.fails('D12: `is` discriminates between two specializations of Set', () => {
  expect(evaluated('const s = new Set.<uint8>(); String(s is Set.<string>);')).toBe('false');
});

test.fails('D12: an UNTYPED collection is not a member of a specialization', () => {
  // The invariant of §0 read in the other direction. An untyped Map is an
  // ordinary Map, and an ordinary Map is not a `Map.<string, uint8>` - it makes
  // no promise about what it holds, which is exactly what the specialization is.
  expect(evaluated('const m = new Map(); String(m is Map.<string, uint8>);')).toBe('false');
  expect(evaluated('const s = new Set(); String(s is Set.<uint8>);')).toBe('false');
});

test.fails('D12: the three relations agree, as they do for a user generic', () => {
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

test.fails('D12: a `when` pattern naming a specialization selects on it', () => {
  // Membership in different syntax: `when T:` tests membership, so this arm and
  // the `is` above are one question.
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map.<string, string>: "wrong"; default: "fell through"; }')).toBe('fell through');
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map.<string, uint8>: "right"; default: "fell through"; }')).toBe('right');
});

test.fails('D12: a typed catch selects on the specialization', () => {
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
