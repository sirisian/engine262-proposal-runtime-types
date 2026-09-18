import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-match-patterns.
 *
 *     MatchNamePattern :
 *       IdentifierReference
 *       MatchNamePattern `.` IdentifierName
 *       MatchNamePattern TypeArguments
 *
 * An extractor is `MatchNamePattern ( MatchPatternList? )`, so its head takes all
 * three forms. The parser read only the first, so a head reached through a
 * NAMESPACE OBJECT was a *SyntaxError* - and that is how an imported matcher
 * arrives, which meant a matcher could only be used where it could also be named
 * by a single identifier.
 *
 * The plain name pattern already took both forms, because everything that is not
 * an extractor falls through to `parseType`. Only the extractor head was
 * restricted, so the two halves of one production disagreed.
 */

const NS = 'const Ns = { Some: { [Symbol.customMatcher](v) { return [v]; } } }; ';

test('an extractor head may be qualified', () => {
  expect(evaluated(`${NS}let x: any = 5; `
    + 'let r = match (x) { when Ns.Some(let n): n; default: 0; }; String(r);')).toBe('5');
  // More than one step, since the production is left-recursive.
  expect(evaluated('const A = { B: { C: { [Symbol.customMatcher](v) { return [v]; } } } }; let x: any = 5; '
    + 'let r = match (x) { when A.B.C(let n): n; default: 0; }; String(r);')).toBe('5');
});

test('an extractor head may take type arguments', () => {
  expect(evaluated('class Box<T> { static [Symbol.customMatcher](v) { return [v]; } } let x: any = 5; '
    + 'let r = match (x) { when Box.<uint8>(let n): n; default: 0; }; String(r);')).toBe('5');
});

test('the `is` spelling takes the same heads', () => {
  // `is` and a `match` arm share the pattern grammar, so a head that parses in
  // one has to parse in the other.
  expect(evaluated(`${NS}function f(v: any) { if (v is Ns.Some(let n)) { return n; } return 0; } String(f(5));`)).toBe('5');
});

test('the plain name pattern is unchanged', () => {
  // It already took both forms; pinned so the extractor work cannot regress it.
  expect(evaluated('const Ns = { K: class { } }; let x: any = new Ns.K(); '
    + 'let r = match (x) { when Ns.K: 1; default: 2; }; String(r);')).toBe('1');
  expect(evaluated('class Box<T> { v: T | null = null; } let x: any = new Box.<uint8>(); '
    + 'let r = match (x) { when Box.<uint8>: 1; default: 2; }; String(r);')).toBe('1');
});

test('the extractor still behaves as before once parsed', () => {
  // A qualified head reaches the same arity check a bare one does - a
  // *TypeError* from the matcher's result, not a *SyntaxError* from the head.
  expectThrownKind(`${NS}let x: any = 5; let r = match (x) { when Ns.Some(let a, let b): 1; default: 2; };`, 'TypeError');
  // A head the checker can see and that carries no matcher is still refused
  // before the source runs (#sec-match-patterns), which the head change must
  // not have loosened.
  expectStaticTypeError('const Foo: uint8 = 5; let x: any = 1; '
    + 'let r = match (x) { when Foo(let a): 1; default: 2; };');
});

test('ordinary calls are unaffected', () => {
  // The head loop runs inside a SPECULATIVE parse that restores on failure, so
  // nothing outside a match pattern may change.
  expect(evaluated('function f(a) { return a; } String(f(3));')).toBe('3');
  expect(evaluated('const o = { f(a) { return a; } }; String(o.f(4));')).toBe('4');
  expect(evaluated('function f<T>(a: T): T { return a; } String(f.<uint8>(5));')).toBe('5');
});
