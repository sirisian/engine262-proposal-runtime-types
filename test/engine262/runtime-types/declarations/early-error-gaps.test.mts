import { test, expect } from 'vitest';
import { expectEarlyError, expectStaticTypeError, ok } from '../harness.mts';

/**
 * Early errors the specification states and the checker did not raise.
 *
 * Each group names the clause it comes from. They are collected in one file
 * because they were found in one pass over the specification's "it is a type
 * error if" sentences rather than because they belong together; a group that
 * grows should move beside the feature it belongs to.
 */

// ---- #sec-resolveoverload: arity ------------------------------------

test('a call supplying more arguments than any signature accepts is refused', () => {
  // "A call of `f` declared as `function f(a: uint8) {}` with two arguments
  // selects no signature and is an error, because a signature is viable only
  // for an argument list its arity accepts" (#sec-issignaturesubtype, the note
  // settling the disagreement with the assignability rule).
  expectStaticTypeError('function f(a: uint8) {} f(1, 2);');
  // The clause's own example.
  expectStaticTypeError('function f(): void {} f(1);');
  // Every callable form reaches the same check.
  expectStaticTypeError('const f = (a: uint8): void => {}; f(1, 2);');
  expectStaticTypeError('class A { m(a: uint8): void {} } new A().m(1, 2);');
  expectStaticTypeError('let f: (uint8) => void = (a: uint8) => {}; f(1, 2);');
  expectStaticTypeError('class A { constructor(a: uint8) {} } let a: A = new A(1, 2);');
});

test('the arity rule stands down where the count decides nothing', () => {
  // An untyped signature is the catch-all of #sec-overload-resolution and
  // accepts any arity - the clause's other example, which pairs with the first.
  expect(ok('function f(a) {} f(1, 2);')).toBe(true);
  expect(ok('function f() {} function f(a: uint8) {} f(1, 2);')).toBe(true);
  // A rest absorbs the surplus; a default and an optional are positions.
  expect(ok('function f(a: uint8, ...r: [].<uint8>) {} f(1, 2, 3);')).toBe(true);
  expect(ok('function f(a: uint8, b?: uint8) {} f(1, 2);')).toBe(true);
  expect(ok('function f(a: uint8, b: uint8 = 2) {} f(1, 2);')).toBe(true);
  // A spread has no static length.
  expect(ok('let xs: [].<uint8> = [1, 2]; function f(a: uint8) {} f(...xs);')).toBe(true);
  // An overload set is judged over EVERY signature, not the selected one.
  expect(ok('function f(a: uint8) {} function f(a: uint8, b: string) {} f(1, "x");')).toBe(true);
  // A decorator's context argument is supplied by the language, not written.
  expect(ok('function d(t) { return t; } class C { @d m() {} }')).toBe(true);
});

// ---- #sec-match-exhaustiveness: reachability ------------------------

test('a match clause that can match nothing left is refused', () => {
  // "It is a type error if a clause can match nothing the preceding unguarded
  // clauses have left."
  expectStaticTypeError('let x: uint8 | string = 1; match (x) { when uint8: 1; when string: 2; when uint8: 3; };');
  expectStaticTypeError('let x: uint8 = 1; match (x) { when let a: 1; when 2: 2; };');
  // The impossible-test rule of #sec-narrowfrom, at a clause rather than a
  // sub-pattern.
  expectStaticTypeError('let x: uint8 = 1; match (x) { when string: 1; default: 2; };');
});

test('a default no atom is left for is refused', () => {
  // "A `default` whose preceding clauses cover every atom of a subject with
  // atoms is that error's instance, so a covered `match` and a defaulted one
  // cannot silently coexist."
  expectStaticTypeError('enum E { A, B } let e: E = E.A; match (e) { when E.A: 1; when E.B: 2; default: 3; };');
  expectStaticTypeError('sealed abstract class S {} class A extends S {} class B extends S {} '
    + 'let s: S = new A(); match (s) { when A: 1; when B: 2; default: 3; };');
});

test('reachability leaves the matches that need every clause', () => {
  expect(ok('enum E { A, B } let e: E = E.A; let r = match (e) { when E.A: 1; when E.B: 2; };')).toBe(true);
  expect(ok('enum E { A, B } let e: E = E.A; let r = match (e) { when E.A: 1; default: 2; };')).toBe(true);
  expect(ok('let x: uint8 | string = 1; let r = match (x) { when uint8: 1; when string: 2; };')).toBe(true);
  expect(ok('let x: uint8 = 1; let r = match (x) { when 1: "a"; when 2: "b"; default: "c"; };')).toBe(true);
  expect(ok('type Sh = { kind: "c", r: float64 } | { kind: "r", w: float64 }; let s: Sh = { kind: "c", r: 1 }; '
    + 'let a = match (s) { when { kind: "c" }: 1; when { kind: "r" }: 2; };')).toBe(true);
  // `match all` is exempt: "no clause of a `match all` need match ... and a
  // later clause there is reached whether or not an earlier one matched".
  expect(ok('let x: uint8 = 1; let r = match all (x) { when uint8: 1; when uint8: 2; };')).toBe(true);
});

// ---- #sec-typed-initializers-semantics ------------------------------

test('a := declaration whose initializer has no static type is refused', () => {
  // "It is a type error if the Static Type of the initializer is the `any`
  // type, since `let a := f();` where `f` is untyped would declare a binding of
  // the `any` type through a syntax that asks for a type."
  expectStaticTypeError('let x; let a := x;');
  expectStaticTypeError('let a := JSON.parse("1");');
  expectStaticTypeError('let a := globalThis.foo;');
});

test(':= keeps the declarations it exists for', () => {
  expect(ok('class Rich { m(): uint8 { return 1; } } let r := new Rich();')).toBe(true);
  expect(ok('function g(): uint8 { return 1; } let a := g();')).toBe(true);
  expect(ok('let x: uint8 = 1; let a := x;')).toBe(true);
  expect(ok('let a := (5 := uint8);')).toBe(true);
  expect(ok('let a := 5;')).toBe(true);
});

// ---- #sec-variance-static-semantics-early-errors ---------------------

test('a variance modifier on a type alias is judged where it is declared', () => {
  // The rule is stated over "any occurrence ... within the declaration that
  // introduces this TypeParameter", which is every declaration that introduces
  // one; it was applied to classes and interfaces only.
  // Raised as a *SyntaxError*, which is how the class and interface paths
  // already raise it: the rule is stated as an Early Error of the production
  // rather than as a judgment about types.
  expectEarlyError('type O<out T> = { v: T };', 'SyntaxError');
  expectEarlyError('type F<out T> = (x: T) => void;', 'SyntaxError');
});

test('a well-placed variance on an alias stands', () => {
  expect(ok('type O<out T> = { readonly v: T };')).toBe(true);
  expect(ok('type F<in T> = (x: T) => void;')).toBe(true);
  expect(ok('type O<T> = { v: T };')).toBe(true);
});

// ---- #sec-interfaces-semantics: operator members ---------------------

test('implements verifies operator members', () => {
  // "It is a type error if a class whose ClassTail carries an ImplementsClause
  // does not satisfy every member, OPERATOR MEMBERS INCLUDED, of every listed
  // interface." An operator member is not in the Type Record's [[Properties]],
  // since an operator is reached from the declaration rather than the type, so
  // the member walk could not see one.
  expectStaticTypeError('interface I { operator+(o: I): I; } class A implements I {}');
  expectStaticTypeError('interface I { operator+(o: I): I; } class A implements I { operator+(o: string): A { return this; } }');
  expectStaticTypeError('interface I { operator[](i: uint32): uint8; } class A implements I {}');
  // The clause's own example, whose parameter is the interface's own type
  // parameter and is bound by the `implements` application.
  const O = 'interface Ordered<T> { operator<(other: T): boolean; } ';
  expectStaticTypeError(`${O}class V implements Ordered.<V> { n: uint8 = 1; }`);
  expectStaticTypeError(`${O}class V implements Ordered.<V> { n: uint8 = 1; operator<(o: string): boolean { return true; } }`);
});

test('a class that declares its operators satisfies the interface', () => {
  expect(ok('interface I { operator+(o: I): I; } class A implements I { operator+(o: I): I { return this; } }')).toBe(true);
  expect(ok('interface Ordered<T> { operator<(other: T): boolean; } '
    + 'class V implements Ordered.<V> { n: uint8 = 1; operator<(o: V): boolean { return this.n < o.n; } }')).toBe(true);
  // An inherited operator satisfies a member as an inherited method does. `B`
  // declares `implements` itself so that `return this` satisfies the `I`
  // return - a class reaches an interface-typed position by declaring it
  // (#sec-interfaces-semantics), which is a separate rule this one composes
  // with rather than an artefact of the check.
  expect(ok('interface I { operator+(o: I): I; } class B implements I { operator+(o: I): I { return this; } } '
    + 'class A extends B implements I {}')).toBe(true);
  // An interface operator with no annotations states only that the operator
  // exists, and presence is then the whole of the check.
  expect(ok('interface I { operator+(o); } class A implements I { operator+(o) { return this; } }')).toBe(true);
  expect(ok('interface I { operator[](i: uint32): uint8; } '
    + 'class A implements I { a: [].<uint8> = [1]; operator[](i: uint32): uint8 { return this.a[i]; } }')).toBe(true);
});
