import { test, expect } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError, expectThrown, ok } from '../harness.mts';

/**
 * Early errors the specification states with "it is a type error if".
 *
 * Each group names the clause it comes from. A group that grows should move
 * beside the feature it belongs to.
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
  expectEarlyError('type O<out T: type> = { v: T };', 'SyntaxError');
  expectEarlyError('type F<out T: type> = (x: T) => void;', 'SyntaxError');
});

test('a well-placed variance on an alias stands', () => {
  expect(ok('type O<out T: type> = { readonly v: T };')).toBe(true);
  expect(ok('type F<in T: type> = (x: T) => void;')).toBe(true);
  expect(ok('type O<T: type> = { v: T };')).toBe(true);
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
  const O = 'interface Ordered<T: type> { operator<(other: T): boolean; } ';
  expectStaticTypeError(`${O}class V implements Ordered.<V> { n: uint8 = 1; }`);
  expectStaticTypeError(`${O}class V implements Ordered.<V> { n: uint8 = 1; operator<(o: string): boolean { return true; } }`);
});

test('a class that declares its operators satisfies the interface', () => {
  expect(ok('interface I { operator+(o: I): I; } class A implements I { operator+(o: I): I { return this; } }')).toBe(true);
  expect(ok('interface Ordered<T: type> { operator<(other: T): boolean; } '
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
  expect(ok('type T<V: type> = { [k: string]: V }; let t: T.<uint8> = {};')).toBe(true);
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
  expect(ok('class B<T: type> { v: T | null = null; } String(B.<uint8> === B.<uint8>);')).toBe(true);
  expect(ok('function f<T: type>(x: T): T { return x; } String(f.<uint8>(1));')).toBe(true);
  expect(ok('type Box<T: type> = { v: T }; let b: Box.<uint8> = { v: 1 }; String(b.v);')).toBe(true);
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
  expect(ok('class A<T: type> { v: T | null = null; operator+(o: A.<T>): A.<T> { return this; } }')).toBe(true);
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
  expect(ok('class Bx<T: type> { x: uint8; static default = new Bx.<T>(); } const f = Bx.<uint8>; String(f.default instanceof f);')).toBe(true);
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

// ---- #sec-match-exhaustiveness, #sec-pattern-static-semantics: literals ----

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
    + 'type NBr = { bounds?: RangeBounds.<any> }; meta NBr { default = {}; subtype(a, b) { return true; } } String(1);')).toBe(true);
});

// ---- #sec-collection-iteration: weak collections ------------------------

const WEAK = 'function unused(w: WeakMap.<object, uint8>, s: WeakSet.<object>) { ';

test('a weak collection has no @@iterator, and nothing consumes one as iterable', () => {
  // "`WeakMap` and `WeakSet` have none of the members in the table above, nor
  // `size`, and reading any of them from a value of either type is a type
  // error rather than *undefined*." The table lists `@@iterator` beside the
  // String-named members, and #sec-iteration-types makes consuming a value
  // whose entry hook is proved invalid a type error too. The String-named
  // members were refused; the Symbol-keyed one, and every consumer, were not.
  expectStaticTypeError(`${WEAK}return w[Symbol.iterator]; }`);
  expectStaticTypeError(`${WEAK}const k = Symbol.iterator; return w[k]; }`);
  expectStaticTypeError(`${WEAK}for (const e of w) {} }`);
  expectStaticTypeError(`${WEAK}return [...w]; }`);
  expectStaticTypeError(`${WEAK}const [a] = w; }`);
  expectStaticTypeError('function* unused(s: WeakSet.<object>): Generator.<object> { yield* s; }');
  // `@@asyncIterator` is absent too, so `for await` falls back and fails.
  expectStaticTypeError('async function unused(s: WeakSet.<object>) { for await (const x of s) {} }');
  // The absence is a fact of the collection, not of its type arguments.
  expectStaticTypeError('function unused(w: WeakMap) { return w.size; }');
});

test('an object pattern reads a weak collection as a dot read does', () => {
  // A pattern property is a read, so the collection rule reaches it. Patterns
  // gain no missing-key rule in general: only the weak collections' table.
  expectStaticTypeError(`${WEAK}const { size } = w; }`);
  expectStaticTypeError(`${WEAK}const { keys: k } = s; }`);
  expectStaticTypeError(`${WEAK}let size; ({ size } = w); }`);
  expect(ok(`${WEAK}const { get } = w; } String(1);`)).toBe(true);
  expect(ok('function unused(o: { a: uint8 }) { const { b } = o; } String(1);')).toBe(true);
});

test('what a weak collection does have, and what iterates, stay legal', () => {
  expect(ok(`${WEAK}const o = {}; return w.get(o); } String(1);`)).toBe(true);
  // Not in the member table: an ordinary absent read, as on a Map.
  expect(ok(`${WEAK}return w[Symbol.asyncIterator]; } String(1);`)).toBe(true);
  expect(ok('function unused(m: Map.<string, uint8>) { for (const e of m) {} } String(1);')).toBe(true);
  // A subclass that declares an iterator has one.
  expect(ok('class IW extends WeakMap.<object, uint8> { *[Symbol.iterator]() { yield 1; } } '
    + 'function unused(w: IW) { for (const e of w) {} } String(1);')).toBe(true);
});

// ---- #sec-narrowfrom: a class operand of instanceof ---------------------

test('an instanceof test against a class that can never fail is refused', () => {
  // "It is a type error to apply a narrowing form where the test can never
  // succeed or can never fail." The impossible-test check resolved only
  // aliases and built-ins, so a CLASS operand was never judged. NarrowFrom of
  // a class by itself is ~empty~, so the else branch is dead.
  expectStaticTypeError('class P { x: uint8 = 1; } let p: P = new P(); if (p instanceof P) { } else { }');
  // A primitive against a class is disjoint (#sec-aredisjoint), so it can
  // never succeed.
  expectStaticTypeError('class P { x: uint8 = 1; } let x: uint8 = 1; if (x instanceof P) { }');
});

test('instanceof between unrelated classes can never succeed', () => {
  // Rule 967 refuses `P & Q` for two classes neither of which extends the
  // other; NarrowTo now makes the same judgment, so the test that would narrow
  // to that intersection is the dead branch it is. AreDisjoint stays silent on
  // the interning path, as #sec-aredisjoint chooses.
  expectStaticTypeError('class P { x: uint8 = 1; } class Q { y: uint8 = 1; } '
    + 'function unused(p: P) { if (p instanceof Q) { return 1; } return 0; }');
  // The `is` form judges a class too: class membership is an identity, which
  // no write to a field can change.
  expectStaticTypeError('class P { x: uint8 = 1; } class Q { y: uint8 = 1; } '
    + 'function unused(p: P) { if (p is Q) { return 1; } return 0; }');
  expectStaticTypeError('class P { x: uint8 = 1; } let p: P = new P(); if (p is P) { } else { }');
  // An object type stays open: a binding of one can stop satisfying it.
  expect(ok('type Pos = { a: uint8 }; let p: Pos = { a: 1 }; if (p is Pos) { } else { } String(1);')).toBe(true);
  expect(ok('class P { x: uint8 = 1; } class S extends P { } function unused(p: P) { if (p is S) { return 1; } return 0; } String(1);')).toBe(true);
});

test('instanceof against a class stays legal where a value can be both', () => {
  expect(ok('class P { x: uint8 = 1; } class S extends P { } '
    + 'function unused(p: P) { if (p instanceof S) { return 1; } return 0; } String(1);')).toBe(true);
  expect(ok('class P { x: uint8 = 1; } class Q { y: uint8 = 1; } '
    + 'function unused(p: P | Q) { if (p instanceof Q) { return 1; } return 0; } String(1);')).toBe(true);
  // An interface stays open: a class may implement any number of them.
  expect(ok('interface I { x: uint8; } class P { x: uint8 = 1; } '
    + 'function unused(i: I) { if (i instanceof P) { return 1; } return 0; } String(1);')).toBe(true);
  // A test that guards no branch is a question with a constant answer.
  expect(ok('class P { x: uint8 = 1; } let p: P = new P(); String(p instanceof P);')).toBe(true);
});

// ---- #sec-this-adoption: a call that supplies no this -------------------

const M = 'class C { x: uint8 = 1; m(): uint8 { return this.x; } static s(): uint8 { return 1; } } const c: C = new C(); ';

test('a method called without its object is refused', () => {
  // A signature with a [[ThisType]] "is usable nowhere a `this` is absent",
  // and a method's carries the self marker. A binding that kept the marker
  // could still be called bare, and failed inside the method.
  expectStaticTypeError(`${M}const f = c.m; f();`);
  expectStaticTypeError(`${M}const { m } = c; m();`);
  expectStaticTypeError(`${M}(0, c.m)();`);
  expectStaticTypeError(`${M}function unused(k: C) { const f = k.m; return f(); }`);
  expectStaticTypeError('interface I { m(): uint8; } function unused(i: I) { const f = i.m; return f(); }');
});

test('every call that supplies a this stays legal', () => {
  expect(evaluated(`${M}String(c.m());`)).toBe('1');
  expect(evaluated(`${M}String((c.m)());`)).toBe('1');
  expect(evaluated(`${M}String(c?.m());`)).toBe('1');
  expect(evaluated(`${M}const f = c.m.bind(c); String(f());`)).toBe('1');
  expect(evaluated(`${M}const f = c.m; String(f.call(c));`)).toBe('1');
  expect(evaluated(`${M}const f = C.s; String(f());`)).toBe('1');
  expect(evaluated('class B { m(): uint8 { return 1; } } class D extends B { m(): uint8 { return super.m(); } } String(new D().m());')).toBe('1');
  // An arrow field has no `this` of its own to require.
  expect(evaluated('class E { x: uint8 = 1; f = (): uint8 => this.x; } const e: E = new E(); const g = e.f; String(g());')).toBe('1');
});

test('the refusal at a boundary names the this the method needs', () => {
  // The self marker prints, so the two sides no longer read identically.
  expectThrown(`${M}const g: () => uint8 = c.m;`, '(this: its receiver) => uint.<8>');
});

// ---- #sec-type-references: argument lists in annotations ----------------

const PAIR = 'class P<A: type = uint8, B: type = uint8> {} ';

test('a spread type argument of unstated length is refused in an annotation', () => {
  // "its |Type| must resolve to a ~tuple~ type or to an ~array~ type whose
  // extent is stated, and it is a type error otherwise". The expression path
  // refused it; an annotation deferred it to evaluation, so a parameter's was
  // reported at its first call and a never-called function's never.
  expectStaticTypeError(`${PAIR}let p: P.<...[].<uint8>>;`);
  expectStaticTypeError(`${PAIR}function unused(p: P.<...[].<uint8>>) {}`);
  expect(ok(`${PAIR}let p: P.<...[2].<uint8>>; String(1);`)).toBe(true);
  expect(ok(`${PAIR}let p: P.<...[uint8, string]>; String(1);`)).toBe(true);
});

test('the syntactic named-argument rules are Syntax Errors', () => {
  // A named argument on an array type names nothing, and one name twice in a
  // list is visible in the list alone - both refused as they parse.
  expectEarlyError('let a: [4].<E: uint8>;', 'SyntaxError');
  expectEarlyError('function unused(a: [].<E: uint8>) {}', 'SyntaxError');
  expectEarlyError('class Q<A: type, B: type> {} let q: Q.<A: uint8, A: uint8>;', 'SyntaxError');
  expectEarlyError('function f<T: type>(x: T) {} f.<T: uint8, T: uint8>(1);', 'SyntaxError');
});

test('the named-argument rules that need the declaration are type errors', () => {
  // Whether a name is a parameter, was already supplied positionally, or is
  // followed by a positional argument joining its variadic run, all turn on
  // the declaration applied - an imported or computed one included.
  expectStaticTypeError('function f<T: type>(x: T) {} f.<U: uint8>(1);');
  expectStaticTypeError('class Box<T: type> {} let b: Box.<U: uint8>;');
  expectStaticTypeError('function f<A: type, B: type>(a: A, b: B) {} f.<A: uint8, string>(1, "s");');
  expectStaticTypeError('function f<A: type, B: type>(a: A, b: B) {} f.<uint8, A: string>(1, "s");');
  // A positional argument after a variadic parameter's name joins its run.
  expect(evaluated('function q<...I: [].<uint32>, N: uint32>(): uint32 { return N; } String(q.<I: 0, 1, N: 8>());')).toBe('8');
});

// ---- #sec-resolveoverload: ambiguity at the declaration -----------------

test('an overload set ambiguous for some argument list is refused where it is declared', () => {
  // "Two signatures declared for one name must not be ambiguous for any
  // argument list." Overlap was proved only for the SAME parameter types, so a
  // partial overlap was reported at each ambiguous call, and through a
  // converting constructor only at run time.
  expectStaticTypeError('function f(a: uint8 | string) {} function f(a: uint8 | boolean) {}');
  expectStaticTypeError('function unused() { function f(a: uint8 | string) {} function f(a: uint8 | boolean) {} }');
  expectStaticTypeError('function f(a: uint8 | string, b: string) {} function f(a: uint8 | boolean, b: string) {}');
  // #sec-constructor-overloading: "at the class ... not deferred to the
  // constructions that would be ambiguous".
  expectStaticTypeError('class T { constructor(a: uint8 | string) {} constructor(a: uint8 | boolean) {} }');
});

test('overload sets that resolution can always decide stand', () => {
  expect(ok('function f(a: uint8) {} function f(a: string) {} String(1);')).toBe(true);
  // Specificity ranks the narrower one first for the shared argument.
  expect(evaluated('function f(a: uint8) { return 1; } function f(a: uint8 | string) { return 2; } String(f((1 := uint8)));')).toBe('1');
  expect(ok('function f(a: uint8 | string, b: string) {} function f(a: uint8 | boolean, b: uint8) {} String(1);')).toBe(true);
  // Declared returns discriminate by contextual type.
  expect(ok('function f(a: uint8 | string): uint8 { return 1; } function f(a: uint8 | boolean): string { return "s"; } String(1);')).toBe(true);
  expect(evaluated('class T { constructor(a: uint8) {} constructor(a: string) {} } String(new T("x") instanceof T);')).toBe('true');
  // A catch-all, a generic and a rest prove nothing here.
  expect(ok('function f(a) {} function f(a: uint8 | string) {} String(1);')).toBe(true);
  expect(ok('function f<T: type>(a: T | string) {} function f(a: uint8 | string) {} String(1);')).toBe(true);
  expect(ok('function f(...a: [].<uint8>) {} function f(a: uint8 | string) {} String(1);')).toBe(true);
});

// ---- #sec-trial-specialization, #sec-declared-inverses ------------------

const WRAP = 'function wrapOf(T) { return T; } ';

test('a call the inference ladder must refuse is refused before the program runs', () => {
  // "zero or more than one is a type error asking for explicit arguments", and
  // where no inverse proposes a binding "the site is a type error". The pass
  // ran only trials over literal unions; every other refusal waited for the
  // call, and a call in a function nothing invoked raised nothing.
  expectStaticTypeError(`${WRAP}function j<T: type>(x: wrapOf(T)): uint32 { return 1; } j(1);`);
  expectStaticTypeError(`${WRAP}function j<T: type>(x: wrapOf(T)): uint32 { return 1; } function unused() { return j(1); }`);
  // A union of TYPES is a closed candidate set whose candidates are its members.
  expectStaticTypeError(`${WRAP}function j<T: type extends uint8 | string>(x: wrapOf(T)): uint32 { return 1; } j(true);`);
  // A value parameter trials its domain.
  expectStaticTypeError(`${WRAP}function j<T: 'a' | 'b'>(x: wrapOf(T)): uint32 { return 1; } j(true);`);
});

test('the ladder binds what it can', () => {
  // One member of a union of types fits: it binds, where the run time used to
  // flatten each member's inhabitants, give up, and report "no inverse".
  expect(evaluated(`${WRAP}function j<T: type extends uint8 | string>(x: wrapOf(T)): string { return String(T); } j('s');`)).toBe('string');
  expect(evaluated(`${WRAP}function j<T: type>(x: wrapOf(T)): uint32 { return 1; } String(j.<uint8>(1));`)).toBe('1');
  expect(evaluated(`${WRAP}function j<T: type>(y: T, x: wrapOf(T)): uint32 { return 1; } String(j((1 := uint8), (2 := uint8)));`)).toBe('1');
});

test('a variadic parameter reached only through an undecorated builder is refused early', () => {
  expectStaticTypeError(`${WRAP}function j3<...Ts: [].<type>>(...ps: wrapOf(Ts)): uint64 { return ps.length; } j3(1);`);
  expectStaticTypeError(`${WRAP}function j3<...Ts: [].<type>>(...ps: wrapOf(Ts)): uint64 { return ps.length; } function unused() { return j3(1); }`);
  expect(evaluated(`${WRAP}function j3<...Ts: [].<type>>(...ps: wrapOf(Ts)): uint64 { return ps.length; } String(j3.<uint8>((1 := uint8)));`)).toBe('1');
});

test('an enum of types proposes its enumerators, and the pass leaves it to the run time', () => {
  // A same-source enum is uninitialized when the pass runs, which made the
  // trial a false early error; the run time now trials the enumerators, so a
  // call no enumerator fits names the enum rather than a missing inverse.
  const E = 'class A { a: uint8 = 1; } class B { b: string = ""; } enum S: type { X = A, Y = B } ';
  expectThrown(`${E}${WRAP}function j<T: type extends S>(x: wrapOf(T)): string { return "x"; } j(1);`, 'no inhabitant of S');
});

// ---- #sec-match-patterns: juxtaposition heads ---------------------------

test('a juxtaposed head naming a numeric const is refused with the rule\'s own message', () => {
  expectThrown('const T = 1; let x: uint8 = 1; match (x) { when T [let a]: 1; default: 0; };', 'a juxtaposed head must denote a type');
  // A class of that name shadowing it in an inner scope is a type.
  expect(evaluated('const T = 1; class P { a: uint8 = 1; } function g(v: P) { class T { a: uint8 = 1; } '
    + 'return match (v) { when T { a: let a }: 1; default: 0; }; } String(g(new P()));')).toBe('0');
});

// ---- #sec-the-conversion-rule: compound and update stores ---------------

test('a compound or update store of a number into a string or boolean location is refused', () => {
  expectStaticTypeError("let s: string = 'a'; s -= 1;");
  expectStaticTypeError("let s: string = 'a'; s >>>= 1;");
  expectStaticTypeError("class C { a: string = 'x'; } const c: C = new C(); c.a -= 1;");
  expectStaticTypeError('function u(o: { a: uint8 } | { a: string }) { o.a -= 1; }');
  expectStaticTypeError("function u(o: { a: uint8, b: string }, k: 'a' | 'b') { o[k] -= 1; }");
  expectStaticTypeError('let b: boolean = true; b -= 1;');
  // `+=` may concatenate; an `any` operand is left to the boundary, whose
  // string conversion #sec-primitiveconvert specifies.
  expect(evaluated("let s: string = 'a'; s += 1; s;")).toBe('a1');
  expect(evaluated("let s: string = 'a'; let n: any = 1; s -= n; s;")).toBe('NaN');
  expect(evaluated('let u: uint8 = 5; u -= 1; String(u);')).toBe('4');
  // An UPDATE stores back through the boundary: #sec-unary-operators-for-typed-
  // values keeps "numeric-to-String conversion on the existing update/store
  // path" valid, so `++` on a string is legal where `-= 1` is not.
  expect(evaluated("let s: string = '1'; s++; s;")).toBe('2');
  expectStaticTypeError('let b: boolean = true; b++;');
});

// ---- #sec-collectcaptures: class family specialization lists ------------

test('a capture\'s written domain and position are checked at the declaration', () => {
  expectStaticTypeError('class Box<T: type> {} class Box<const U: uint8> {}');
  expectStaticTypeError('class Box<N: uint8> {} class Box<const U: string> {}');
  expectStaticTypeError('class Box<T: type> {} class Box<Map.<const K: uint8, const V>> {}');
  expectThrown('type W = uint8; class Box<T: type> {} class Box<W.<const U>> {} let b: Box.<uint8>;', 'names no constructor');
  expect(ok('class Box<T: type> {} class Box<const U: type> {} String(1);')).toBe(true);
  expect(ok('class Box<T: type> {} class Box<Map.<const K, const V>> {} String(1);')).toBe(true);
});

// ---- #sec-typed-classes: protected members ------------------------------

test('a protected member read through destructuring is refused', () => {
  const C = 'class C { protected x: uint8 = 1; } const c: C = new C(); ';
  expectStaticTypeError(`${C}const { x } = c;`);
  expectStaticTypeError(`${C}let x; ({ x } = c);`);
  expectStaticTypeError('class C { protected x: uint8 = 1; } function u({ x }: C) { return x; }');
  expect(evaluated('class C { protected x: uint8 = 1; } class D extends C { n(): uint8 { const { x } = this; return x; } } String(new D().n());')).toBe('1');
});

// ---- #sec-void-type -----------------------------------------------------

test('a binding typed void through its pattern\'s annotation is refused', () => {
  expectThrown('const { a }: { a: void } = { a: undefined };', 'a binding cannot have type void');
  expectStaticTypeError('let [a]: [void] = [undefined];');
  expectStaticTypeError('function f({ a }: { a: void }) {}');
  // Line 1761: each name takes its member's type, and the initializer crosses
  // the annotation.
  expectStaticTypeError('let { a }: { a: uint8 } = { a: "x" };');
  expectStaticTypeError('const { a }: { a: uint8 } = { a: 1 }; let s: string = a;');
  expect(evaluated('const { a }: { a: uint8 } = { a: 1 }; String(a);')).toBe('1');
});

// ---- #sec-narrowfrom: logical operands ----------------------------------

test('a logical operand that can never be evaluated is refused whatever settles the test', () => {
  expectStaticTypeError('const o: {} = {}; const x = o || 1;');
  expectStaticTypeError('const f = (x: uint8): uint8 => x; const h = f || 1;');
  expectStaticTypeError('let n: null = null; const y = n && 1;');
  // The right operand is evaluated in these, so they stay legal.
  expect(evaluated('const obj: {} = {}; function h(): uint8 { return 1; } String(obj && h());')).toBe('1');
  expect(evaluated('let n: null = null; String(n || 1);')).toBe('1');
  expect(evaluated('let u: uint8 = 1; String(u || 2);')).toBe('1');
});

// ---- #sec-function-types: conditional selections ------------------------

test('a logical operator is a conditional selection', () => {
  const F = 'const f = (x: uint8): uint8 => x; const g = (y: uint8): uint8 => y; ';
  expectStaticTypeError(`${F}new (f && g)(1);`);
  expectStaticTypeError(`${F}const h = f && g; new h(1);`);
  expectStaticTypeError('class K { x: uint8 = 1; } class L { y: uint8 = 1; } const D = K && L; D();');
  expect(evaluated('function F() {} function G() {} const H = F && G; String(typeof new H());')).toBe('object');
});

// ---- #sec-bindarguments: object-literal spreads -------------------------

test('an object-literal spread argument is judged as the named arguments it stands for', () => {
  const G = 'function g(a: uint8): uint8 { return a; } ';
  expectStaticTypeError(`${G}g(...{ c: 1 });`);
  expectStaticTypeError(`${G}g(...{ a: 'x' });`);
  expectStaticTypeError('function h(a: uint8, b: uint8): uint8 { return a; } h(...{ a: 1 });');
  expectStaticTypeError('class C { constructor(a: uint8) {} } new C(...{ a: \'x\' });');
  expectStaticTypeError('class B { constructor(a: uint8) {} } class D extends B { constructor() { super(...{ z: 1 }); } }');
  expect(evaluated(`${G}const a = (5 := uint8); String(g(...{ a }));`)).toBe('5');
  expect(evaluated('function h(a: uint8, b: uint8): uint8 { return a + b; } String(h(...{ b: 2, a: 1 }));')).toBe('3');
  expect(evaluated(`${G}String(g(...[(1 := uint8)]));`)).toBe('1');
  // An overload binds names against the member that declares them.
  const F = 'function f(a: uint8): uint8 { return 1; } function f(b: string): uint8 { return 2; } ';
  expectStaticTypeError(`${F}f(...{ c: 1 });`);
  expect(evaluated(`${F}String(f(b: 'x'));`)).toBe('2');
  expect(evaluated(`${F}String(f(...{ b: 'x' }));`)).toBe('2');
});

// ---- #sec-type-alias-declarations ---------------------------------------

test('an alias cycle with no member in it is refused in every scope', () => {
  expectThrown('type R = R;', 'is defined as itself');
  expectStaticTypeError('type A = B; type B = A;');
  expectStaticTypeError('type A = B; type B = C; type C = A;');
  expectStaticTypeError('function u() { type R = (R); }');
  expect(ok('type A = B; type B = uint8; let a: A = 1; String(a);')).toBe(true);
  expect(ok('type L = { v: uint8, next: L | null }; String(1);')).toBe(true);
});

// ---- #sec-defaultvalueof ------------------------------------------------

test('a binding typed by a class of untyped fields has no default', () => {
  expectThrown('class K { a = 1; } let k: K;', 'has no default value');
  expectStaticTypeError('class K { a = 1; } class H { k: K; }');
  expectStaticTypeError('class K { a = 1; b = 2; } const k: K;');
  // A class with no instance field keeps its default.
  expect(evaluated('class K { } let k: K; typeof k;')).toBe('object');
  expect(evaluated('class K { m(): uint8 { return 1; } } let k: K; typeof k;')).toBe('object');
  expect(evaluated('class K { x: uint8 = 1; } let k: K; String(k.x);')).toBe('0');
  expect(evaluated('class B { x: uint8 = 1; } class K extends B { } let k: K; String(k.x);')).toBe('0');
  expect(evaluated("class K { s: string = 'a'; } let k: K; JSON.stringify(k.s);")).toBe('""');
});

// ---- #sec-array-defaults-and-stores: tuple searches ---------------------

test('a tuple\'s search methods take the union of its position types', () => {
  expectStaticTypeError('let t: [uint16, uint16] = [1, 2]; t.includes(70000);');
  expectStaticTypeError("let t: [uint16, uint16] = [1, 2]; t.indexOf('x');");
  expectStaticTypeError("let t: [uint8, string] = [1, 'a']; t.includes(true);");
  expectStaticTypeError('let t: [uint8, ...[].<uint8>] = [1, 2]; t.includes(300);');
  expect(evaluated('let t: [uint16, uint16] = [1, 2]; String(t.includes(2));')).toBe('true');
  expect(evaluated('let t: [uint16, uint16] = [1, 2]; String(t.indexOf(2));')).toBe('1');
  expect(evaluated("let t: [uint8, string] = [1, 'a']; String(t.includes('a'));")).toBe('true');
});

// ---- #sec-collection-construction ---------------------------------------

test('a WeakMap seeded by a literal is checked', () => {
  expectThrown('new WeakMap.<object, uint8>([[1, 1]]);', 'cannot be held weakly');
  expectStaticTypeError('const k = {}; new WeakMap.<object, uint8>([[k, 300]]);');
  expectStaticTypeError("const k = {}; new WeakMap.<object, uint8>([[k, 'x']]);");
  expect(evaluated('const k = {}; const w = new WeakMap.<object, uint8>([[k, 1]]); String(w.get(k));')).toBe('1');
  expect(evaluated('const k = {}; const w = new WeakSet.<object>([k]); String(w.has(k));')).toBe('true');
});

// ---- #sec-interfaces-semantics: class expressions -----------------------

test('an anonymous class expression may begin its tail with implements', () => {
  expect(ok('interface I { } const C = class implements I { }; String(1);')).toBe(true);
  expectStaticTypeError('interface I { a: uint8; } const C = class implements I { };');
  expect(ok('interface I { } const C = class K implements I { }; String(1);')).toBe(true);
  // A declaration still needs its name.
  expect(ok('interface I { } class implements I { }')).toBe(false);
});

// ---- #sec-operator-declarations: typed-class operands -------------------

test('an update of a typed-class instance is refused before the program runs', () => {
  const C = 'class C { x: uint8 = 1; } ';
  expectStaticTypeError(`${C}let c: C = new C(); ++c;`);
  expectStaticTypeError(`${C}function u(c: C) { c--; }`);
  expectStaticTypeError('class C { x: uint8 = 1; valueOf() { return 1; } } let c: C = new C(); c++;');
  expect(evaluated('let n: number = 1; n++; String(n);')).toBe('2');
});

test('a unary operator on a typed-class instance is refused', () => {
  const C = 'class C { x: uint8 = 1; } ';
  expectStaticTypeError(`${C}const c: C = new C(); -c;`);
  expectStaticTypeError(`${C}const c: C = new C(); ~c;`);
  expectStaticTypeError(`${C}const c: C = new C(); +c;`);
  expectStaticTypeError(`${C}function u(c: C) { return -c; }`);
  expect(evaluated('class C { x: uint8 = 1; valueOf() { return 1; } } const c: C = new C(); String(-c);')).toBe('-1');
  expect(evaluated('class C { } const c = new C(); String(-c);')).toBe('NaN');
});

// ---- #sec-integer-operations --------------------------------------------

test('a converted literal zero divisor is refused', () => {
  expectStaticTypeError('let a: uint8 = 1; a / (0 := uint8);');
  expectStaticTypeError('let a: int32 = 1; a % (0 := int32);');
  expectStaticTypeError('let a: uint8 = 1; a /= (0 := uint8);');
  expect(evaluated('let a: uint8 = 4; String(a / (2 := uint8));')).toBe('2');
  expect(evaluated('let f: float32 = 1; String(f / (0 := float32));')).toBe('Infinity');
});

test('a compound shift by a distance of another integer type is valid', () => {
  expect(evaluated('let a: uint8 = 1; let b: uint16 = 1; a <<= b; String(a);')).toBe('2');
  expect(evaluated('let a: uint16 = 4; let b: uint8 = 1; a >>>= b; String(a);')).toBe('2');
  expect(evaluated('let o: { a: uint8 } = { a: 1 }; let b: uint16 = 1; o.a <<= b; String(o.a);')).toBe('2');
  expectStaticTypeError('let a: uint8 = 1; let b: uint16 = 1; a += b;');
  expectStaticTypeError("let a: uint8 = 1; let s: string = 'x'; a <<= s;");
  expectStaticTypeError('let a: uint8 = 1; a <<= 8;');
});

// ---- #sec-declared-narrowing --------------------------------------------

test('an arrow function may declare a return predicate', () => {
  expect(evaluated('const f = (x: any): x is uint8 => true; String(f(1));')).toBe('true');
  expectStaticTypeError('const f = (x: any): y is uint8 => true;');
  expectStaticTypeError('const f = function (x: any): y is uint8 { return true; };');
  expect(evaluated('const c = true; const g = c ? (x: uint8) => x : (x: uint8) => x; String(g(2));')).toBe('2');
});

// ---- #sec-typed-classes: class expressions ------------------------------

test('a class extending a class-expression base meets the inheritance rules', () => {
  expectStaticTypeError('const A = abstract class { abstract m(): uint8; }; class B extends A { }');
  expectStaticTypeError('class B extends (abstract class { abstract m(): uint8; }) { }');
  expectStaticTypeError("const B = class { m(): uint8 { return 1; } }; class D extends B { m(): string { return 'x'; } }");
  expectStaticTypeError('const B = class { x: uint8 = 1; }; class D extends B { x: uint8 = 2; }');
  expect(ok('interface I { a: uint8; } const B = class { a: uint8 = 1; }; class C extends B implements I { } String(1);')).toBe(true);
  expect(ok("let B = class { m(): uint8 { return 1; } }; class D extends B { m(): string { return 'x'; } } String(1);")).toBe(true);
});

test('a class expression is checked as a class, and its instances are typed', () => {
  expectStaticTypeError('const C = class { x: uint8 = 1; static default = 5; };');
  expectStaticTypeError("const C = class { x: uint8 = 1; }; const c = new C(); c.x = 'a';");
  expectStaticTypeError('const C = class { m(a: uint8): uint8 { return a; } }; new C().m(1, 2);');
  expectStaticTypeError('const C = class { protected x: uint8 = 1; }; const c = new C(); c.x;');
  // The run time finds an anonymous class expression's constructor by its node.
  expect(evaluated('const C = class { x: uint8 = 1; }; const c = new C(); c.x = 2; String(c.x);')).toBe('2');
});

// ---- #sec-arithmetic-never-promotes: relational literals ----------------

test('a relational literal the other operand cannot hold is refused', () => {
  expectStaticTypeError('let i: uint8 = 0; i < 300;');
  expectStaticTypeError('let i: uint8 = 0; 300 > i;');
  expectStaticTypeError('for (let i: uint8 = 0; i < 300; i++) {}');
  expect(evaluated('let i: uint8 = 0; String(i === 300);')).toBe('false');
  expect(evaluated('let i: uint8 = 0; String(i < 200);')).toBe('true');
});

// ---- #sec-generic-parameters-as-values ----------------------------------

test('a value parameter reads as its domain in the body', () => {
  expectStaticTypeError('function f<N: uint8>() { let s: string = N; }');
  expectStaticTypeError('function f<N: uint8>() { let y: uint16 = 1; return N + y; }');
  expectStaticTypeError('function f<N: uint8>() { return N / 0; }');
  expect(evaluated('function f<N: uint8>(): uint8 { return N; } String(f.<3>());')).toBe('3');
  expect(evaluated('function f<N: uint32>(): uint32 { return N * 2; } String(f.<3>());')).toBe('6');
});

// ---- #sec-partial-classes: static members -------------------------------

test('a static partial member colliding with another is refused before the program runs', () => {
  expectStaticTypeError('class C { static s() { } } partial class C { static s() { } }');
  expectStaticTypeError('class C { static s: uint8 = 1; } partial class C { static s(): uint8 { return 2; } }');
  expectStaticTypeError('class C { } partial class C { static m() { } } partial class C { static m() { } }');
  expectStaticTypeError('function u() { class C { static s() { } } partial class C { static s() { } } }');
  expect(ok('class C { m() { } } partial class C { static m() { } } String(1);')).toBe(true);
  expect(evaluated('class C { static s(): uint8 { return 1; } } partial class C { static t(): uint8 { return 2; } } String(C.t());')).toBe('2');
});

// ---- #sec-iterator-helper-contracts: flatMap ----------------------------

test('a flatMap callback whose conditional arms are all primitive is refused', () => {
  expectStaticTypeError("const c: boolean = Math.random() > 2; Iterator.from([1]).flatMap((x) => c ? 1 : 'a');");
  expectStaticTypeError("const c: boolean = Math.random() > 2; Iterator.from([1]).flatMap((x) => c ? 1 : c ? 'a' : null);");
  expect(evaluated('const c: boolean = Math.random() > 2; String([...Iterator.from([1]).flatMap((x) => c ? 1 : [x])].length);')).toBe('1');
});

// ---- #sec-typed-classes: protected members ------------------------------

test('a protected field read through an object rest or spread is refused', () => {
  const C = 'class C { protected x: uint8 = 1; y: uint8 = 2; } const c: C = new C(); ';
  expectStaticTypeError(`${C}const { ...r } = c;`);
  expectStaticTypeError(`${C}const { y, ...r } = c;`);
  expectStaticTypeError(`${C}const o = { ...c };`);
  expect(evaluated('class P { y: uint8 = 2; } const p: P = new P(); const { ...r } = p; String(r.y);')).toBe('2');
  expect(evaluated('class C { protected m(): uint8 { return 1; } y: uint8 = 2; } const c: C = new C(); const { ...r } = c; String(r.y);')).toBe('2');
});

// ---- #sec-literalvalueintype --------------------------------------------

test('a fractional literal beside an integer operand is refused', () => {
  expectStaticTypeError('let i: uint8 = 0; i + 1.5;');
  expectStaticTypeError('let i: uint8 = 2; i * 0.5;');
  expectStaticTypeError('let i: uint8 = 0; i < 1.5;');
  expect(evaluated('let i: uint8 = 0; String(i + 2.0);')).toBe('2');
  expect(evaluated('let i: uint8 = 1; String(i === 1.5);')).toBe('false');
});

// ---- #sec-interfaces-semantics: callable interfaces ---------------------

test('a constructor returning an established non-callable object cannot meet a callable interface', () => {
  const F = 'interface F { (x: uint8): uint8; } ';
  expectStaticTypeError(`${F}class C implements F { constructor() { return {}; } }`);
  expectStaticTypeError(`${F}class C implements F { constructor(b: boolean) { if (b) { return []; } } }`);
  expect(ok(`${F}class C implements F { constructor() { return (x: uint8): uint8 => x; } } String(1);`)).toBe(true);
  expect(ok(`${F}class C implements F { constructor(f: any) { return f; } } String(1);`)).toBe(true);
});

// ---- #sec-function-types: rest annotations ------------------------------

test('a rest annotation in an object type method must denote an array or tuple', () => {
  expectStaticTypeError('type O = { m(...xs: uint8): void };');
  expectStaticTypeError('type U = uint8; type O = { m(...xs: U): void };');
  expectStaticTypeError('function g(o: { m(...xs: uint8): void }) {}');
  expectStaticTypeError('type O = { m<T: type>(...xs: T): void };');
  expect(ok('type O = { m(...xs: [].<uint8>): void }; String(1);')).toBe(true);
  expect(ok('type O = { m<T: type extends [].<uint8>>(...xs: T): void }; String(1);')).toBe(true);
});

// ---- #sec-iterator-helper-contracts: flatMap ----------------------------

test('a flatMap callback returning a conditional of primitives is refused', () => {
  const C = 'const c: boolean = Math.random() > 2; ';
  expectStaticTypeError(`${C}Iterator.from([1]).flatMap((x) => { return c ? 1 : 'a'; });`);
  expectStaticTypeError(`${C}Iterator.from([1]).flatMap(function (x) { return c ? 1 : 'a'; });`);
  expectStaticTypeError(`${C}Iterator.from([1]).flatMap((x) => { if (x) { return c ? 1 : 'a'; } return null; });`);
  expect(evaluated(`${C}String([...Iterator.from([1]).flatMap((x) => { return c ? 1 : [x]; })].length);`)).toBe('1');
  expect(evaluated(`${C}String([...Iterator.from([1]).flatMap((x) => { const g = () => c ? 1 : 'a'; return [x]; })].length);`)).toBe('1');
});

// ---- #sec-interfaces-semantics: callable interfaces ---------------------

test('a constructor returning an instance of an ordinary class cannot meet a callable interface', () => {
  const F = 'interface F { (x: uint8): uint8; } ';
  expectStaticTypeError(`${F}class O { } class C implements F { constructor() { return new O(); } }`);
  expectStaticTypeError(`${F}const O = class { }; class C implements F { constructor() { return new O(); } }`);
  expect(ok(`${F}class Fn { constructor() { return (x: uint8): uint8 => x; } } class C implements F { constructor() { return new Fn(); } } String(1);`)).toBe(true);
  expect(ok(`${F}class P { constructor(f: any) { return f; } } class C implements F { constructor() { return new P(1); } } String(1);`)).toBe(true);
});

// ---- #sec-operator-declarations: typed-class operands -------------------

test('an operator on a class-expression instance is refused as on a declared one', () => {
  const K = 'const K = class { x: uint8 = 1; }; const k = new K(); ';
  expectStaticTypeError(`${K}k + 1;`);
  expectStaticTypeError(`${K}1 - k;`);
  expectStaticTypeError(`${K}-k;`);
  expectStaticTypeError('new (class { x: uint8 = 1; })() + 1;');
  expect(evaluated('const K = class { x: uint8 = 1; valueOf() { return 1; } }; const k = new K(); String(k + 1);')).toBe('2');
  expect(evaluated('const K = class { }; const k = new K(); String(k + 1);')).toBe('[object Object]1');
  expect(evaluated(`${K}String(k.x + 1);`)).toBe('2');
});
