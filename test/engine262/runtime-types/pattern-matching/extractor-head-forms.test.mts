import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

/**
 * Spec: #sec-match-patterns.
 *
 *     MatchNamePattern :
 *       IdentifierReference
 *       MatchNamePattern `.` IdentifierName
 *       MatchNamePattern TypeArguments
 *
 * An extractor is `MatchNamePattern ( MatchPatternList? )`, so its head takes
 * all three forms. This engine parses only the first, so a matcher reached
 * through a namespace object - which is how an imported one arrives - cannot be
 * written.
 *
 * A round of this work admitted the other two and had to be reverted. A
 * qualified head is INDISTINGUISHABLE from a type query at the point the
 * speculation runs: `v is Reflect.typeOf(s)` has a qualified callee and one
 * argument that reads as a `MatchNamePattern`, exactly as `v is Ns.Some(let a)`
 * does, and the extractor speculation runs before the fall-through to
 * `parseType`. Admitting it made every `Reflect.typeOf(x)` in an `is` position
 * parse as an extractor and fail with "has no custom matcher".
 *
 * The clause's overlap rule does not settle it: a `MatchNamePattern` and a
 * `Type` "overlap where a name is both; the name form is preferred, and THE TWO
 * READINGS AGREE wherever both exist". Here they do not agree. A
 * disambiguation the clause does not state would have to be invented, so the
 * gap is recorded rather than half-closed.
 */

const NS = 'const Ns = { Some: { [Symbol.customMatcher](v) { return [v]; } } }; ';
const X = 'let x: any = 5; ';

test('a bare identifier head works', () => {
  expect(evaluated('const Some = { [Symbol.customMatcher](v) { return [v]; } }; '
    + `${X}let r = match (x) { when Some(let n): n; default: 0; }; String(r);`)).toBe('5');
});

test('a qualified head is not yet written, and that is the open gap', () => {
  // `Ns.Some` reaches a real matcher and cannot be spelled here.
  expect(ok(`${NS}${X}let r = match (x) { when Ns.Some(let n): n; default: 0; };`)).toBe(false);
});

test('a type query in `is` position keeps its reading', () => {
  // What the qualified-head attempt broke. `Reflect.typeOf(s)` is a type, and
  // the pattern grammar reaches it through `TypePattern : Type`.
  // Type-position builders need compile-time-evaluable inputs. Keep these
  // as value queries so the test isolates the qualified type-pattern reading.
  expect(evaluated('const s = "hi"; String("world" is Reflect.typeOf(s));')).toBe('true');
  expect(evaluated('const s = "hi"; String(42 is Reflect.typeOf(s));')).toBe('false');
  expect(evaluated('const x = (5 := uint8); String((6 := uint8) is Reflect.typeOf(x));')).toBe('true');
});

test('type-query patterns do not make mutable builder inputs compile-time evaluable', () => {
  expectThrownKind('let s = "hi"; String("world" is Reflect.typeOf(s));', 'TypeError');
  expectThrownKind('let x = (5 := uint8); String((6 := uint8) is Reflect.typeOf(x));', 'TypeError');
});

test('the plain name pattern takes both forms, as it always did', () => {
  // Everything that is not an extractor falls through to `parseType`, which
  // reads a qualified name and type arguments - so the two halves of one
  // production still disagree, which is the gap stated above.
  expect(evaluated('const Ns = { K: class { } }; let x: any = new Ns.K(); '
    + 'let r = match (x) { when Ns.K: 1; default: 2; }; String(r);')).toBe('1');
  expect(evaluated('class Box<T: type> { v: T | null = null; } let x: any = new Box.<uint8>(); '
    + 'let r = match (x) { when Box.<uint8>: 1; default: 2; }; String(r);')).toBe('1');
});

test('the extractor head rule is unaffected', () => {
  // A head the checker can see that carries no matcher is still refused before
  // the source runs.
  expectStaticTypeError(`let Foo: uint8 = 5; ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`);
  // And a matcher-bearing head still matches.
  expect(evaluated('const Some = { [Symbol.customMatcher](v) { return v > 0 ? [v] : null; } }; '
    + 'let x: any = 5; let r = match (x) { when Some(let n): n; default: 0; }; String(r);')).toBe('5');
  expectThrownKind('const Some = { [Symbol.customMatcher](v) { return [v]; } }; '
    + `${X}let r = match (x) { when Some(let a, let b): 1; default: 2; };`, 'TypeError');
});

test('ordinary calls are unaffected', () => {
  expect(evaluated('function f(a) { return a; } String(f(3));')).toBe('3');
  expect(evaluated('const o = { f(a) { return a; } }; String(o.f(4));')).toBe('4');
  expect(evaluated('function f<T: type>(a: T): T { return a; } String(f.<uint8>(5));')).toBe('5');
});
