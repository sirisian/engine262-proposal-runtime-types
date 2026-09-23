import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

/**
 * Spec: #sec-match-patterns with #sec-type-errors.
 *
 * "It is a type error if the |MatchNamePattern| of a juxtaposition or of an
 * extractor form resolves to a binding: the juxtaposed head must denote a type,
 * and the extractor head must denote a value with a %Symbol.customMatcher%
 * method, decided at the site where the head's Static Type is KNOWN and at run
 * time otherwise."
 *
 * The clause names its own two halves and the checking pass implemented only the
 * second. It already looked the matcher up on the head's structure; when it
 * found none it silently did nothing and left the refusal to the match, so
 * `when Foo(let a)` over a `uint8` binding threw when the arm was reached, and
 * the same arm inside a function nothing called raised nothing at all.
 *
 * Only the EXTRACTOR half is pinned here. The juxtaposition forms of the grammar
 * - `MatchNamePattern ObjectMatchPattern` and `MatchNamePattern
 * ArrayMatchPattern` - are not parsed by this engine at all, so the rule has
 * nothing to govern there yet.
 */

const X = 'let x: any = 1; ';

test('an extractor head that cannot carry a matcher is refused', () => {
  expectStaticTypeError(`let Foo: uint8 = 5; ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`);
  expectStaticTypeError(`let Foo: string = 'a'; ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`);
  // An object type without the well-known symbol among its members.
  expectStaticTypeError(`let Foo: { k: uint8 } = { k: 1 }; ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`);
  // A function is a value, and its type says it has no matcher.
  expectStaticTypeError(`function Foo() {} ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`);
  // A class whose static side is typed and carries no matcher.
  expectStaticTypeError(`class Foo { static k: uint8 = 1; } ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`);
});

test('the refusal does not wait for the arm to be reached', () => {
  expectStaticTypeError('function q() { let Foo: uint8 = 5; let x: any = 1; '
    + 'return match (x) { when Foo(let a): 1; default: 2; }; }');
});

test('a head that does carry a matcher still matches', () => {
  expect(evaluated('class Foo { static [Symbol.customMatcher](v) { return [v]; } } '
    + `${X}let r = match (x) { when Foo(let a): 1; default: 2; }; String(r);`)).toBe('1');
  expect(evaluated('const Foo = { [Symbol.customMatcher](v) { return [v]; } }; '
    + `${X}let r = match (x) { when Foo(let a): 1; default: 2; }; String(r);`)).toBe('1');
  // Through an interface that declares the symbol-keyed member.
  expect(evaluated('interface M { [Symbol.customMatcher](v: any): [any]; } '
    + 'let Foo: M = { [Symbol.customMatcher](v) { return [v]; } }; '
    + `${X}let r = match (x) { when Foo(let a): 1; default: 2; }; String(r);`)).toBe('1');
  // And on an instance, where the matcher is on the prototype.
  expect(evaluated('class C { [Symbol.customMatcher](v) { return [v]; } } let Foo: C = new C(); '
    + `${X}let r = match (x) { when Foo(let a): 1; default: 2; }; String(r);`)).toBe('1');
  // The matcher's own result still governs whether the arm is taken.
  expect(evaluated('const Some = { [Symbol.customMatcher](v) { return v > 0 ? [v] : null; } }; '
    + 'let x: any = 5; let r = match (x) { when Some(let n): n; default: 0; }; String(r);')).toBe('5');
});

test('a head whose type is not known is judged at run time', () => {
  // "at run time otherwise" - the clause's own second half. An `any` head says
  // nothing, and #sec-type-errors reserves a thrown error for that boundary.
  expectThrownKind(`let Foo: any = 5; ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`, 'TypeError');
  expectThrownKind(`let Foo = 5; ${X}let r = match (x) { when Foo(let a): 1; default: 2; };`, 'TypeError');
});

test('a head mentioning a type parameter defers to the application', () => {
  // It reads a parameter that is not bound, so whether it carries a matcher is
  // not known until the declaration is applied - the same deferral
  // #sec-evaluatetotypeobject draws everywhere else.
  expect(ok('function f<T: type>(Foo: T, x: any) { return match (x) { when Foo(let a): 1; default: 2; }; }')).toBe(true);
  // And the application is judged.
  expectThrownKind('function f<T: type>(Foo: T, x: any) { return match (x) { when Foo(let a): 1; default: 2; }; } '
    + 'let r = f.<uint8>(5, 1);', 'TypeError');
});

test('the other pattern forms are untouched', () => {
  expect(evaluated('class Foo { k: uint8 = 1; } let x: any = new Foo(); '
    + 'let r = match (x) { when Foo: 1; default: 2; }; String(r);')).toBe('1');
  expect(evaluated('let x: any = { k: 1 }; let r = match (x) { when { k: let v }: v; default: 0; }; String(r);')).toBe('1');
});
