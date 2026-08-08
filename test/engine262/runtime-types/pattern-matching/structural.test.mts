import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-match-structural (Structural Matching) and the Match Cache Record
 * of #sec-match-expression.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('INTERPOLATION evaluates and compares', () => {
  // "`${expression}` evaluates the expression and matches by SameValue against
  // the result, whatever the result is" - the escape hatch from every cleverer
  // rule, where a type pattern would test membership.
  expect(evaluated('const k = 5; String(5 is ${k});')).toBe('true');
  expect(evaluated('const k = 5; String(6 is ${k});')).toBe('false');
  // It COMPARES a type object rather than testing membership, which is the
  // whole reason the form exists.
  expect(evaluated('String(1 is ${uint8});')).toBe('false');
  expect(evaluated('String(1 is uint8);')).toBe('false');
  expect(evaluated('String(uint8(1) is uint8);')).toBe('true');
});

test('OBJECT patterns: presence is the `in` test', () => {
  expect(evaluated('String({ x: 1, y: 2 } is { x: _ });')).toBe('true');
  // "An optional member that is ABSENT FAILS the pattern rather than matching
  // undefined."
  expect(evaluated('String({ y: 2 } is { x: _ });')).toBe('false');
  expect(evaluated('String({ x: undefined } is { x: _ });')).toBe('true');
  // "A member the pattern does not name is IGNORED - a pattern is a subset
  // test, as an interface check is, because this type system has width
  // subtyping and no exact object type."
  expect(evaluated('String({ x: 1, z: 9 } is { x: _ });')).toBe('true');
  // A member's sub-pattern is a FULL pattern, combinators included.
  expect(evaluated('String({ x: 1 } is { x: 1 or 2 });')).toBe('true');
  expect(evaluated('String({ x: 3 } is { x: 1 or 2 });')).toBe('false');
  expect(evaluated('String({ x: 1 } is { x: not 2 });')).toBe('true');
  // A non-object subject fails rather than throwing.
  expect(evaluated('String(1 is { x: _ });')).toBe('false');
  expect(evaluated('String(null is { x: _ });')).toBe('false');
});

test('THE CACHE IS A CORRECTNESS REQUIREMENT: a getter runs ONCE', () => {
  // "The presence test and the read are one cached touch per key - a
  // HasProperty and at most one Get per key per match" - so "a getter runs once
  // and arms agree about what they saw". A pattern language that re-read a
  // property per test would turn a lazily computed member into a different
  // value in each clause.
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return 1; } }; '
    + 'o is { g: _ and 1 }; String(n);')).toBe('1');
  // The sharper form: a getter that returns something DIFFERENT each call. With
  // one read both sub-patterns see 1 and the match succeeds; with two reads the
  // second sees 2 and it fails. The count alone would not catch a cache that
  // stored the wrong value.
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return n; } }; '
    + 'String(o is { g: 1 and 1 });')).toBe('true');
});

test('the TYPE path is unchanged where the two spellings agree', () => {
  // `{ x: uint8 }` is spelled identically as a type and as an object pattern,
  // and where every member's sub-pattern IS a type the two agree - so those
  // keep the type path, and every existing `is` keeps its parse, its meaning
  // and its node shape. An object pattern is taken only where the braces hold
  // something a type cannot.
  expect(evaluated('String({ x: 1 } is { x: number });')).toBe('true');
  expect(evaluated('String({ x: "s" } is { x: number });')).toBe('false');
  expect(evaluated('String({ x: 1 } is { x: 1 });')).toBe('true');
  // And the pattern path where it cannot be a type.
  expect(evaluated('String({ x: 1 } is { x: _ });')).toBe('true');
});

test('ARRAY patterns match through ITERATION', () => {
  // #sec-match-array: "through iteration rather than through an array test,
  // which is what reaches every array-shaped value of this proposal - a
  // `[N].<T>` need not be an Array exotic object, a tuple composite is iterable
  // by kind rather than by prototype, and a typed view answers no array
  // predicate". A pattern meaning `Array.isArray` would match the one shape
  // that needed it least.
  expect(evaluated('String([1, 2] is [1, _]);')).toBe('true');
  expect(evaluated('String([1, 2] is [2, _]);')).toBe('false');
  // "Without a rest element the pattern requires the iterator to be EXHAUSTED
  // at the pattern's length: `[let a, let b]` matches exactly two."
  expect(evaluated('String([1, 2, 3] is [1, _]);')).toBe('false');
  expect(evaluated('String([1] is [1, _]);')).toBe('false');
  // A TUPLE COMPOSITE is iterable by kind, which is the case the iteration rule
  // exists for - it has a null prototype and no `Symbol.iterator`.
  expect(evaluated('String(Composite([1, 2]) is [1, _]);')).toBe('true');
  // A non-iterable subject fails rather than throwing.
  expect(evaluated('String(1 is [_]);')).toBe('false');
});

test('RANGE patterns match by containment', () => {
  // "Exactly as a range `case` label does", and "at most two comparisons" - the
  // form that makes a FLOAT subject matchable at all, since a float has no
  // cases to enumerate.
  expect(evaluated('String(5 is 1..<10);')).toBe('true');
  expect(evaluated('String(50 is 1..<10);')).toBe('false');
  expect(evaluated('String(1.5 is 1..<2);')).toBe('true');
  expect(evaluated('String(5 is 1..<3 or 4..<6);')).toBe('true');
});

test('REGEXP patterns match the ENTIRE subject', () => {
  // "The whole-string discipline this proposal uses everywhere a pattern
  // constrains a string ... and a search is spelled by writing the pattern as a
  // search."
  expect(evaluated('String("aaa" is /^a+$/);')).toBe('true');
  expect(evaluated('String("xaaay" is /a+/);')).toBe('false');
  expect(evaluated('String("xaaay" is /.*a+.*/);')).toBe('true');
  expect(evaluated('String(1 is /1/);')).toBe('false');
});

test('THE SPECULATION DECLINES what a type can express', () => {
  // The braced and bracketed forms are patterns only where they hold something
  // a |Type| cannot. Two ways of getting that wrong were found by the suite:
  //
  // A REST element belongs to a type - and a nested parse that THROWS rather
  // than declining escapes the speculation entirely, since the checkpoint is
  // only restored on the paths the function takes.
  expect(evaluated("String([1, 'a', 'b'] is [number, ...[].<string>]);")).toBe('true');
  // And a LITERAL is a literal TYPE as much as a literal pattern, so a union of
  // them stays a type - counting a literal as non-type stole the form and left
  // the `| 'b'` unconsumed.
  expect(evaluated("String({ kind: 'a' } is { kind: 'a' | 'b' });")).toBe('true');
  expect(evaluated("String({ kind: 'c' } is { kind: 'a' | 'b' });")).toBe('false');
});

test('what the structural core still lacks', () => {
  const bindings = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // BINDINGS and the REST binding need the scoping rule - "in scope in exactly
  // the positions the truth of the test governs" - which is checker work.
  expect(evaluated('String(1 is let x);')).toBe('true');
  // A REST BINDING works in `is` position: it "collects the
  // remaining own enumerable members", meaning those the pattern did not NAME.
  expect(evaluated('let out = "X"; if (({ a: 1, b: 2, c: 3 }) is { a: 1, ...let rest }) { out = Object.keys(rest).join(","); } out;')).toBe('b,c');
  expect(evaluated('let out = "X"; if (({ a: 1, b: 2 }) is { a: _, ...let rest }) { out = String(rest.a); } out;')).toBe('undefined');
  expect(evaluated('let out = "X"; if (({ a: 1 }) is { a: 1, ...let rest }) { out = String(Object.keys(rest).length); } out;')).toBe('0');
  // It does NOT yet work in a `match` CLAUSE: the pattern is read
  // under the colon-terminates rule and the rest binding's `let` meets it. The
  // exact failure is left unasserted because it is a host-level one, not a
  // language error the suite should encode.
  expect(evaluated('String(({ a: 1, b: 2 }) is { a: 1, ...let rest });')).toBe('true');
  // A PLAIN binding in a member position does work; the rest binding needs the
  // run-after-the-fixed-elements rule as well.
  expect(evaluated('String(match ({ a: 7 }) { when { a: let v }: v; default: 0; });')).toBe('7');
  // And a regexp's typed match result is not yet available to a juxtaposed
  // object pattern, which is where the capture types would flow into bindings.
  expect(bindings('"a1" is /(?<d>\\d)/ { d: _ };')).toBe('SyntaxError');
});
