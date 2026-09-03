import { test, expect } from 'vitest';
import { evaluated, ok, expectError } from '../harness.mts';

/**
 * Spec: #sec-interfaces-semantics (Interfaces), #sec-object-types.
 *
 * The ground the iteration types rest on, none of it asserted elsewhere:
 * `Iterator` is a class declaring that it implements `IterableIterator`,
 * and a hand-written `{ next() { ... } }` has to satisfy the interface without
 * declaring anything - so a silent regression in any row below would surface
 * later as a confusing failure in a feature that did not cause it.
 *
 * The specification calls these out in #sec-object-types, which defines the
 * structural form of an interface, and in IsOfType, which states that a
 * structural check reads each member once.
 */

test('an object literal satisfies an interface by having its members', () => {
  expect(ok(`
    interface I { a: string; }
    function f(x: I) {}
    f({ a: 's' });
  `)).toBe(true);
});

test('a class satisfies an interface it declares', () => {
  expect(ok(`
    interface I { a: string; }
    class C implements I { a: string = 's'; }
    function f(x: I) {}
    f(new C());
  `)).toBe(true);
});

test('a class does NOT satisfy an interface it never declared', () => {
  // REWRITTEN, and the case it was protecting is kept below rather than lost.
  //
  // It asserted the opposite: that a class with the right shape satisfies an
  // interface it never mentions. #sec-issubtype relates a class to an interface
  // only where it REFINES it - "a nominal type whose declaration extends or
  // implements that type's declaration" - and #sec-object-types says a class has
  // no structural form to be compared by: "a class states a construction and an
  // identity as well as a shape, and it is the identity that its type is for".
  //
  // The rule is that an OBJECT TYPE asks what a value HAS and an INTERFACE asks
  // what a class PROMISED. The ergonomic objection this test was defending
  // against - that a class could then reach no structural position - is
  // answered by the structural half, and that is the second assertion here.
  expectError(`
    interface I { a: string; }
    class D { a: string = 's'; }
    function f(x: I) {}
    f(new D());
  `);
  // The same class reaches an OBJECT-typed position, which is where a shape is
  // what was asked for.
  expect(ok(`
    class D { a: string = 's'; }
    function f(x: { a: string }) {}
    f(new D());
  `)).toBe(true);
  // And saying `implements` is all it takes to reach the interface.
  expect(ok(`
    interface I { a: string; }
    class D implements I { a: string = 's'; }
    function f(x: I) {}
    f(new D());
  `)).toBe(true);
});

test('a value of the wrong shape is refused', () => {
  // The assertion that keeps the three above from passing vacuously: if
  // satisfaction were unchecked they would all pass and so would this.
  expectError(`
    interface I { a: string; }
    class E { b: string = 's'; }
    function f(x: I) {}
    f(new E());
  `);
});

test('a structural check reads each member once', () => {
  // #sec-isoftype: a structural check reads each member of the type once and
  // decides on what it read, so a Proxy trap or a getter runs at most once per
  // member per check and cannot answer one way to the step that admits a value
  // and another to a later one. Unobservable except by counting.
  expect(evaluated(`
    interface I { a: string; b: string; }
    let reads = 0;
    const p = new Proxy({ a: 's', b: 't' }, {
      get(t, k) { if (k === 'a' || k === 'b') { reads += 1; } return t[k]; },
    });
    function f(x: I) {}
    f(p);
    String(reads);
  `)).toBe('2');
});

test('an interface and a class coexist in one script', () => {
  // Asserted because an earlier draft reported this as a blocking bug. It was not: the failure reproduced only in a harness evaluating
  // several scripts in ONE realm, where a second `interface I` collides with
  // the first. The test is kept so the claim stays falsifiable.
  expect(ok(`
    interface I { a: string; }
    class C { a: string = 's'; }
  `)).toBe(true);
  expect(ok(`
    interface I { a: string; }
    interface J { b: string; }
  `)).toBe(true);
});

test('a class instance reaches an object-typed position by having the members', () => {
  // An object type asks what a value HAS. A class instance has its members, so
  // it reaches an object-typed position; what it does not reach without saying
  // so is an INTERFACE, which asks what a class promised.
  //
  // This row was refused STATICALLY while the same value passed through `any`
  // at run time and `is` agreed with the run time - the checker and the run
  // time disagreed, and no test covered it.
  expect(ok(`
    class Point { x: uint8 = 1; y: uint8 = 2; }
    function f(p: { x: uint8 }) {}
    f(new Point());
  `)).toBe(true);
  expect(evaluated('class Point { x: uint8 = 1; y: uint8 = 2; } '
    + 'String(Reflect.isAssignable(type Point, type { x: uint8, y: uint8 }));')).toBe('true');
  // Width subtyping applies: a class with more members satisfies an object type
  // asking for fewer.
  expect(evaluated('class Point { x: uint8 = 1; y: uint8 = 2; } '
    + 'String(Reflect.isAssignable(type Point, type { x: uint8 }));')).toBe('true');
});

test('a class only reaches an object type it actually satisfies', () => {
  // The assertions that keep the one above from passing vacuously.
  expect(evaluated('class Wrong { z: uint8 = 1; } String(Reflect.isAssignable(type Wrong, type { x: uint8 }));')).toBe('false');
  expect(evaluated('class Point { x: uint8 = 1; } String(Reflect.isAssignable(type Point, type { x: string }));')).toBe('false');
  // A PRIVATE member is not reachable through a member expression, so no object
  // type can name it and the shape excludes it - the class below satisfies
  // `{ x: uint8 }` by its public `x`, not by `#s`.
  expect(evaluated('class Priv { #s = 1; x: uint8 = 1; } String(Reflect.isAssignable(type Priv, type { x: uint8 }));')).toBe('true');
  // And the reverse direction stays refused: an object type is not a class.
  // "A class states a construction and an identity as well as a shape, and it is
  // the identity that its type is for."
  expect(evaluated('class Point { x: uint8 = 1; } String(Reflect.isAssignable(type { x: uint8 }, type Point));')).toBe('false');
});

test('the implements clause is walked up the base chain', () => {
  // A class implements what its superclass implements, so the relation walks
  // [[Base]] as well as the class's own clause.
  expect(ok(`
    interface I { x: uint8; }
    class Declared implements I { x: uint8 = 1; }
    class Sub extends Declared { y: uint8 = 2; }
    function f(p: I) {}
    f(new Sub());
  `)).toBe(true);
  expect(evaluated('interface I { x: uint8; } class Declared implements I { x: uint8 = 1; } '
    + 'class Sub extends Declared { y: uint8 = 2; } String(Reflect.isAssignable(type Sub, type I));')).toBe('true');
  // A sibling that inherits nothing declaring it does not satisfy.
  expect(evaluated('interface I { x: uint8; } class Loose { x: uint8 = 1; } '
    + 'String(Reflect.isAssignable(type Loose, type I));')).toBe('false');
});

test('an empty interface is satisfied by a value, not by any class', () => {
  // Decided deliberately: an empty interface is satisfied by any value with no
  // required members, which is what falls out of the structural half. A CLASS
  // still has to say so - which is what
  // keeps `implements` meaningful for a marker interface, the case TypeScript's
  // `{}` cannot express.
  expect(evaluated('interface Marker {} String(Reflect.isAssignable(type { q: string }, type Marker));')).toBe('true');
  expect(evaluated('interface Marker {} class C { q: string = "s"; } '
    + 'String(Reflect.isAssignable(type C, type Marker));')).toBe('false');
  expect(evaluated('interface Marker {} class C implements Marker { q: string = "s"; } '
    + 'String(Reflect.isAssignable(type C, type Marker));')).toBe('true');
});

test('a class expression carries the same relations as a declaration', () => {
  // `check.mts` registered class nodes by
  // NAME and only for |ClassDeclaration|, so `classInstanceType` never ran for
  // an expression, nothing was published, and the runtime record built at
  // ClassExpression and NamedEvaluation carried neither [[Base]] nor
  // [[Structure]]. Expressions are now collected by NODE - an anonymous one has
  // no name to key on - and forced after the declarations, since an expression
  // may extend a declared class.
  const base = 'class Base { a: uint8 = 1; } interface I { a: uint8 } ';
  expect(evaluated(`${base} const Anon = class extends Base { c: uint8 = 3; }; `
    + 'String(Reflect.isAssignable(type Anon, type Base));')).toBe('true');
  // The NAMED form too: they behaved identically before, and a name-keyed fix
  // would have split them silently.
  expect(evaluated(`${base} const Named = class N extends Base { c: uint8 = 3; }; `
    + 'String(Reflect.isAssignable(type Named, type Base));')).toBe('true');
  // And into an object type, the structural rule applied to the same record.
  expect(evaluated(`${base} const Loose = class { a: uint8 = 1; }; `
    + 'String(Reflect.isAssignable(type Loose, type { a: uint8 }));')).toBe('true');
  // A class expression that declares `implements` satisfies the interface - the
  // arm named only |ClassDeclaration|, which is the same omission one layer up.
  expect(evaluated(`${base} const Decl = class D implements I { a: uint8 = 1; }; `
    + 'String(Reflect.isAssignable(type Decl, type I));')).toBe('true');
  // One that declares nothing does not, exactly as for a declaration.
  expect(evaluated(`${base} const Loose = class { a: uint8 = 1; }; `
    + 'String(Reflect.isAssignable(type Loose, type I));')).toBe('false');
  // And the reverse direction stays refused.
  expect(evaluated(`${base} const Anon = class extends Base { c: uint8 = 3; }; `
    + 'String(Reflect.isAssignable(type { a: uint8, c: uint8 }, type Anon));')).toBe('false');
});

test('a recursive interface terminates against a matching object type', () => {
  // `assumed` compared assumption pairs by
  // IDENTITY, and for a nominal pair the thing that recurs is the DECLARATION:
  // comparing an interface walks its structural form, whose members reach the
  // interface again through records built along the way, which are not the same
  // objects. It now keys on the declaration AND the arguments - `Box.<uint8>`
  // and `Box.<string>` share a declaration and are not one question.
  expect(evaluated('interface Node2 { next?: Node2 } let o: { next?: Node2 } = {}; '
    + 'let n: Node2 = o; String(Reflect.isAssignable(type { next?: Node2 }, type Node2));')).toBe('true');
});

test('two interfaces relate by width, and only where they are two', () => {
  // The step existed in #sec-issubtype and could not be routed: it blew the
  // stack. Two things were
  // wrong, and only the first was diagnosed at the time.
  //
  // `assumed` compared assumption pairs by IDENTITY, which a recursive
  // interface needs keyed on the DECLARATION. And this step's own guard called
  // `SameType(s, t)`, which re-enters IsSubtype from the top - instrumenting
  // showed the step re-entered with an assumption list of length ZERO every
  // time, so nothing was recursing through the list at all and no keying could
  // have helped. Identical types are answered above by
  // SameTypeWithAssumptions, so the guard was redundant as well as fatal.
  const ifaces = 'interface Big { x: uint8, y: uint8 } interface Small { x: uint8 } '
    + 'interface Other { z: string } ';
  expect(evaluated(`${ifaces} String(Reflect.isAssignable(type Big, type Small));`)).toBe('true');
  expect(evaluated(`${ifaces} String(Reflect.isAssignable(type Small, type Big));`)).toBe('false');
  expect(evaluated(`${ifaces} String(Reflect.isAssignable(type Other, type Small));`)).toBe('false');
  expect(evaluated(`${ifaces} String(Reflect.isAssignable(type Small, type Small));`)).toBe('true');

  // Two instantiations of ONE declaration are excluded from this step: they are
  // the declaration-site variance question, and comparing their structures made
  // every generic interface covariant by inference. A declaration carrying no
  // modifier is invariant, "the conservative default".
  expect(evaluated('interface B<T> { get(): T } '
    + 'String(Reflect.isAssignable(type B.<uint8>, type B.<uint8 | string>));')).toBe('false');
  expect(evaluated('interface P<out T> { get(): T } '
    + 'String(Reflect.isAssignable(type P.<uint8>, type P.<uint8 | string>));')).toBe('true');
});

test('a method-bearing interface is satisfiable through reflection', () => {
  // An interface's method member resolved
  // to `{ Kind: 'function', Signatures: [] }` in the RUNTIME record - a stub,
  // never filled - so every comparison against it failed and
  // `Reflect.isAssignable` answered *false* for a method-bearing interface,
  // from a declaring class and from a matching object type alike, while the
  // checker accepted all of them. The same family of defect throughout: the
  // runtime record carrying less than the checker's.
  const iface = 'interface IM { m(): uint8 } ';
  expect(evaluated(`${iface} class Impl implements IM { m(): uint8 { return (0 := uint8); } } `
    + 'String(Reflect.isAssignable(type Impl, type IM));')).toBe('true');
  expect(evaluated(`${iface} String(Reflect.isAssignable(type { m(): uint8 }, type IM));`)).toBe('true');
  // A member written `m: () => uint8` declares a function-valued PROPERTY, not
  // a method, so it does not satisfy one: method syntax means "expects a
  // receiver", said through [[ThisType]], and absence is not a wildcard. The
  // checker refuses the same pair, which is what makes this the right answer
  // rather than a convenient one.
  expect(evaluated(`${iface} String(Reflect.isAssignable(type { m: () => uint8 }, type IM));`)).toBe('false');
  // And the signature is really resolved now, not merely present: a wrong
  // return type is refused.
  expect(evaluated(`${iface} String(Reflect.isAssignable(type { m(): string }, type IM));`)).toBe('false');
});
