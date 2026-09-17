import { test, expect } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError, ok } from '../harness.mts';

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
  // An unannotated CONSTRUCTOR is the catch-all too, a typed field beside it
  // notwithstanding; `new C(1)` for `constructor() {}` is ordinary ECMAScript.
  expect(ok('class C { x: uint8 = 1; constructor() {} } String(new C(1) instanceof C);')).toBe(true);
  expect(ok('class C { constructor() {} } String(new C(1) instanceof C);')).toBe(true);
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

// ---- #sec-object-types: index signatures -----------------------------

test('an index signature key must be one of the three key types', () => {
  // "It is a type error if the key type of an IndexSignature is not `string`,
  // `symbol`, `uint32`, or a union of these."
  expectStaticTypeError('type T = { [k: float64]: uint8 };');
  expectStaticTypeError('type T = { [k: uint8]: uint8 };');
  expectStaticTypeError('type T = { [k: uint64]: uint8 };');
  expectStaticTypeError('type T = { [k: bigint]: uint8 };');
  expectStaticTypeError('type T = { [k: any]: uint8 };');
  expectStaticTypeError("type T = { [k: 'a']: uint8 };");
  expectStaticTypeError('class K {} type T = { [k: K]: uint8 };');
  // The interface path carries the same rule as the inline form.
  expectStaticTypeError('interface I { [k: boolean]: uint8 }');
});

test('the three key types and their unions stand', () => {
  expect(ok('type T = { [k: string]: uint8 }; let t: T = {};')).toBe(true);
  expect(ok('type T = { [k: symbol]: uint8 }; let t: T = {};')).toBe(true);
  expect(ok('type T = { [k: uint32]: uint8 }; let t: T = {};')).toBe(true);
  expect(ok('type T = { [k: string | symbol]: uint8 }; let t: T = {};')).toBe(true);
  // A type parameter says nothing until it is bound, as it does everywhere.
  expect(ok('type T<V> = { [k: string]: V }; let t: T.<uint8> = {};')).toBe(true);
});

test('a declared member coexists with a signature its key falls under', () => {
  // The clause's closing sentence - "a type error if a member declared in the
  // same ObjectType is not assignable to the signature's value type" -
  // contradicts its own opening sentence, which gives the signature "the
  // REMAINING string-keyed properties, beyond those declared", and the opening
  // one is what this proposal implements everywhere else. These assertions pin
  // that, so a later reading of the closing sentence does not quietly change
  // what a program may write. `patches/spec-index-signature-members.patch`
  // removes the closing sentence for the reason the runtime gives below.
  expect(ok('type T = { a: string, [k: string]: uint8 }; let t: T = { a: "x" };')).toBe(true);
  expect(ok('interface I { a: string; [k: string]: uint8; }')).toBe(true);
  // The declared member wins at a named read, and is not the signature's type.
  expect(ok('let y: { a: string, [k: string]: uint8 } = { a: "x" }; let s: string = y.a;')).toBe(true);
  expectStaticTypeError('let y: { a: string, [k: string]: uint8 } = { a: "x" }; let n: uint8 = y.a;');
  // A literal at the type is filled member by member: the declared member
  // against its own type, every other key against the signature's.
  expect(ok('type W = { name: string, [k: string]: number }; let w: W = { name: "n", x: 1 };')).toBe(true);
  expectStaticTypeError('type W = { name: string, [k: string]: number }; let w: W = { name: "n", x: "s" };');
});

test('membership answers the same way the checker does', () => {
  // The decisive reason the closing sentence cannot stand: IsOfType walks the
  // members, and #sec-interfaces-semantics points at it for exactly this - "an
  // object that has the members satisfies an interface-typed position". A type
  // whose ANNOTATION is refused while its MEMBERSHIP PREDICATE accepts values
  // is incoherent, and these two answers are what the predicate gives.
  const W = 'type W = { name: string, [k: string]: number }; ';
  expect(evaluated(`${W}String(({ name: "n", x: 1 } is W));`)).toBe('true');
  expect(evaluated(`${W}String(({ name: "n", x: "s" } is W));`)).toBe('false');
});

// ---- #sec-type-arguments-and-placement-new-in-expression-position ------

test('a specialization of a non-generic value is refused, in both phases', () => {
  // "Where the expression's Static Type shows a value that is not generic it
  // is a type error, and otherwise a specialization of a non-generic value
  // throws a *TypeError* exception." The static half applied to a non-generic
  // FUNCTION only; a typed primitive value and a class without type
  // parameters were accepted - and at run time `A.<uint8>` for `class A {}`
  // minted a Type Object that was neither `A` nor an error, so `A.<uint8> ===
  // A` was *false* with no diagnostic, and `x.<uint8>` was silently `x`.
  expectStaticTypeError('let x: uint8 = 1; x.<uint8>;');
  expectStaticTypeError('class A {} let B = A.<uint8>;');
  // The deferred half, for a value the checker cannot see.
  expect(evaluated('let x = 1; try { x.<uint8>; "ran"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  expect(evaluated('interface I { a: uint8 } try { I.<uint8>; "ran"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('every generic form still specializes', () => {
  expect(ok('class B<T> { v: T | null = null; } String(B.<uint8> === B.<uint8>);')).toBe(true);
  expect(ok('function f<T>(x: T): T { return x; } String(f.<uint8>(1));')).toBe(true);
  expect(ok('type Box<T> = { v: T }; let b: Box.<uint8> = { v: 1 }; String(b.v);')).toBe(true);
  expect(ok('String(typeof Map.<string, uint8>);')).toBe(true);
  expect(ok('String(int.<8>(1));')).toBe(true);
  expect(ok('String(typeof complex.<float32>);')).toBe(true);
  // The array type's own spelling in expression position is a type, not a
  // specialization of a literal.
  expect(ok('const a = new [4].<uint8>(); String(a.length);')).toBe(true);
});

// ---- #sec-typed-classes: overriding ---------------------------------

test('an override may narrow a return but not change it', () => {
  // "It is a type error if the declared return type of such a method is not
  // a subtype of the inherited signature's return type." The rule was the
  // design's (README "Methods and Inheritance", "Covariant Return Types") and
  // is now the specification's; without it a derived `f(a: uint8): string`
  // over `f(a: uint8): uint8` was a second overload told apart by return type
  // alone, which no dispatch slot has room for.
  expectStaticTypeError('class A { f(a: uint8): uint8 { return a; } } class B extends A { f(a: uint8): string { return "x"; } }');
  // A numeric NARROWING is a change: `uint8` is not a subtype of `uint16`.
  expectStaticTypeError('class A { f(): uint16 { return 1; } } class B extends A { f(): uint8 { return 1; } }');
  // A widening too.
  expectStaticTypeError('class A { f(): uint8 { return 1; } } class B extends A { f(): uint8 | string { return 1; } }');
});

test('overriding leaves the shapes it does not reach', () => {
  // A covariant return, the class itself standing in for the base it extends.
  expect(ok('class A { f(): A { return this; } } class B extends A { f(): B { return this; } }')).toBe(true);
  // A union narrowed to a member.
  expect(ok('class A { f(): uint8 | null { return null; } } class B extends A { f(): uint8 { return 1; } }')).toBe(true);
  // The same signature restated.
  expect(ok('class A { f(a: uint8): uint8 { return a; } } class B extends A { f(a: uint8): uint8 { return a; } }')).toBe(true);
  // Different parameter types are an OVERLOAD, not an override.
  expect(ok('class A { f(a: uint8): uint8 { return a; } } class B extends A { f(a: string): string { return a; } }')).toBe(true);
  // An untyped method says nothing.
  expect(ok('class A { f(a) { return a; } } class B extends A { f(a) { return 1; } }')).toBe(true);
});

// ---- #sec-resolveoverload: operator declarations ----------------------

test('an operator declared twice for one invocation is refused at the second', () => {
  // "It is a type error to declare a signature that is viable for the same
  // argument list as an existing one at the same rank ... one signature
  // written twice." Functions, methods and constructors were judged; the
  // operator definitions of a class body were not, so two bodies for one
  // invocation stood until the call.
  expectStaticTypeError('class A { operator+(o: A): A { return this; } operator+(o: A): A { return o; } }');
  expectStaticTypeError('class A { static operator+(a: A, b: A): A { return a; } static operator+(a: A, b: A): A { return b; } }');
  expectStaticTypeError('class A { operator uint8(): uint8 { return 1; } operator uint8(): uint8 { return 2; } }');
  expectStaticTypeError('class A { a: [].<uint8> = [1]; operator[](i: uint32): uint8 { return this.a[i]; } operator[](i: uint32): uint8 { return 0; } }');
});

test('distinct operator declarations stand', () => {
  // Different operand types are overloads.
  expect(ok('class A { operator+(o: A): A { return this; } operator+(o: uint8): A { return this; } }')).toBe(true);
  // `static` and instance definitions are different tables.
  expect(ok('class A { operator+(o: A): A { return this; } static operator+(a: A, b: A): A { return a; } }')).toBe(true);
  // Conversions are keyed by target.
  expect(ok("class A { operator uint8(): uint8 { return 1; } operator string(): string { return 'a'; } }")).toBe(true);
  // An untyped definition is the catch-all and stands beside anything.
  expect(ok('class A { operator+(o) { return this; } operator+(o: A): A { return o; } }')).toBe(true);
  // A generic class's operators resolve under its parameters.
  expect(ok('class A<T> { v: T | null = null; operator+(o: A.<T>): A.<T> { return this; } }')).toBe(true);
});

// ---- #sec-declared-zero -------------------------------------------------

test('a declared zero must be a compile-time-evaluable value of its class', () => {
  // "The expression must be compile-time evaluable" and "It is a type error
  // if the declared zero is not a value of the class." Neither was judged, so
  // `static default = 5` was registered as the zero at evaluation and every
  // default-initialized binding of the class then held a Number.
  expectStaticTypeError('class A { x: uint8 = 1; static default = 5; }');
  expectStaticTypeError("class A { x: uint8 = 1; static default = 'x'; }");
  expectStaticTypeError('class A { x: uint8 = 1; static default = function () { return 1; }; }');
  expectEarlyError('class A { x: uint8 = 1; static default = Math.random(); }', 'SyntaxError');
  expectEarlyError('class A { x: uint8 = 1; static default = (globalThis.q = new A()); }', 'SyntaxError');
});

test('a declared zero of the class itself stands, generic or not', () => {
  expect(ok('class A { x: uint8 = 1; static default = new A(); } let a: A; String(a.x);')).toBe(true);
  // A generic class's zero is judged at the specialization, where the
  // checker stands down and the run time's instance check decides.
  expect(ok('class Bx<T> { x: uint8; static default = new Bx.<T>(); } const f = Bx.<uint8>; String(f.default instanceof f);')).toBe(true);
  // A static block assigning the zero is the other spelling.
  expect(ok('class S { x: uint8 = 1; static { S.default = new S(); } } let s: S; String(s.x);')).toBe(true);
  // Any other static field is untouched by the rule.
  expect(ok('class A { x: uint8 = 1; static count = 5; } String(A.count);')).toBe(true);
});

// ---- #sec-partial-classes ---------------------------------------------

test('a partial class must name a class and may add only methods and operators', () => {
  // "It is a type error if a `partial` declaration names a value that is not
  // a class", and a partial over a class "does not re-open the constructor or
  // add fields". The first went unjudged where the name was a plain function,
  // which IsConstructor admits; the second was a silent DROP, so `partial
  // class A { x: uint8 = 7; }` left `new A().x` undefined with no diagnostic.
  expectStaticTypeError('function f() {} partial class f { m() {} }');
  expectStaticTypeError('const f = 5; partial class f { m() {} }');
  expectStaticTypeError('class A {} partial class A { x: uint8 = 1; }');
  expectStaticTypeError('class A {} partial class A { constructor() {} }');
  expectStaticTypeError('class A {} partial class A { static { } }');
  // The deferred half: a name the checker cannot see is judged at evaluation,
  // and a function value is refused there too.
  expect(evaluated('globalThis.g = function () {}; try { eval("partial class g { m() {} }"); "ran"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('a partial class adds what it may', () => {
  expect(evaluated('class A { x: uint8 = 1; } partial class A { m(): uint8 { return this.x; } } String(new A().m());')).toBe('1');
  expect(evaluated('class A { x: uint8 = 1; } partial class A { operator+(o: A): A { return this; } } let a: A = new A(); String((a + a).x);')).toBe('1');
  expect(evaluated('class A {} partial class A { static make() { return new A(); } } String(A.make() instanceof A);')).toBe('true');
  expect(evaluated('interface I { a: uint8 } partial interface I { b: uint8 } let i: I = { a: 1, b: 2 }; String(i.b);')).toBe('2');
});

// ---- #sec-match-exhaustiveness, the two pieces left from round 1 --------

test('a default after true and false is unreachable', () => {
  // `boolean` has atoms - *true* and *false* - and "a `default` whose
  // preceding clauses cover every atom of a subject with atoms is that
  // error's instance". The enum and sealed passes had this branch; the
  // chain-atom pass, which is where `boolean` is judged, did not.
  expectStaticTypeError('let b: boolean = true; match (b) { when true: 1; when false: 2; default: 3; };');
  expect(ok('let b: boolean = true; let r = match (b) { when true: 1; when false: 2; }; String(r);')).toBe(true);
  expect(ok('let b: boolean = true; let r = match (b) { when true: 1; default: 2; }; String(r);')).toBe(true);
});

test('a non-numeric literal that cannot match its position is refused', () => {
  // The impossible-test rule of #sec-pattern-static-semantics applied to a
  // literal. A numeric literal was judged by fit; a string, a Boolean or
  // `null` against a numeric position was not judged at all.
  expectStaticTypeError("let x: uint8 = 1; match (x) { when 'a': 1; default: 2; };");
  expectStaticTypeError('let x: uint8 = 1; match (x) { when true: 1; default: 2; };');
  expectStaticTypeError('let x: uint8 = 1; match (x) { when null: 1; default: 2; };');
  // At a nested position too.
  expectStaticTypeError("let o: { a: uint8 } = { a: 1 }; match (o) { when { a: 'z' }: 1; default: 2; };");
  // And through `is`.
  expectStaticTypeError("let x: uint8 = 1; if (x is 'a') {}");
  // A literal a union or its own type admits stands.
  expect(ok("let x: uint8 | string = 'a'; let r = match (x) { when 'a': 1; default: 2; }; String(r);")).toBe(true);
  expect(ok('let x: uint8 | null = null; let r = match (x) { when null: 1; default: 2; }; String(r);')).toBe(true);
});

// ---- #sec-meta-declarations ---------------------------------------------

test('a meta declaration is judged for its hooks and its type before it runs', () => {
  // "a second declaration for one type, a missing `default` or `subtype` ...
  // is an early error." A missing hook was a TypeError at evaluation; a second
  // declaration for one TYPE was caught nowhere: the parser's duplicate check
  // is by name, and `type A = { k: uint8 }; type B = { k: uint8 }` intern to
  // ONE type, so `meta A` and `meta B` were two declarations for it that the
  // run time's key-claim check - seeing the same claimant twice - let through.
  expectStaticTypeError('type Dim = { m: uint8 }; meta Dim { subtype(a, b) { return true; } }');
  expectStaticTypeError('type Dim = { m: uint8 }; meta Dim { default = { m: 0 }; }');
  expectStaticTypeError('type A = { k: uint8 }; type B = { k: uint8 }; '
    + 'meta A { default = { k: 0 }; subtype(a, b) { return true; } } meta B { default = { k: 0 }; subtype(a, b) { return true; } }');
});

test('meta declarations that are distinct, base-form, or generic stand', () => {
  // Two shapes with different members are two types.
  expect(ok('type A = { k: uint8 }; type B = { j: uint8 }; '
    + 'meta A { default = { k: 0 }; subtype(a, b) { return true; } } meta B { default = { j: 0 }; subtype(a, b) { return true; } } String(1);')).toBe(true);
  // The base-form of #sec-meta-declarations: a meta over a PRIMITIVE, "a meta
  // type that constrains a base without naming any field of it".
  expect(ok('meta uint8 { subtype(a, b) { return true; } default = 0; validate(v, c) { return true; } } String(1);')).toBe(true);
  // A member type declared in the same list, still resolving during the
  // pre-scan, must not make two different shapes look like one.
  expect(ok('type Dim2 = { m?: number, ratio?: number }; meta Dim2 { default = { m: 0, ratio: 1 }; subtype(a, b) { return true; } } '
    + 'type NBr = { bounds?: RangeBounds }; meta NBr { default = {}; subtype(a, b) { return true; } } String(1);')).toBe(true);
});
