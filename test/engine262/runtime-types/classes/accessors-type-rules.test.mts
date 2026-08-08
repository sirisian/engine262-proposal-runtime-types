import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * The kind a rejection carries, through `eval` so that an EARLY error is
 * catchable: these rules are CHECKED BEFORE EVALUATION, so the harness's
 * `expectThrownKind` cannot reach one - the script carrying its try/catch never
 * runs at all.
 */
const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

/**
 * Design: README.md; judged through #sec-typed-classes.
 *
 * The first rule: AN ACCESSOR OVERRIDE IS INVARIANT.
 *
 * README does not say this, and it falls out of the two variance rules that it
 * does say meeting on ONE declaration. A hand-written pair may refine its
 * halves separately - "a derived getter may refine its type covariantly", "a
 * derived setter is contravariant" - but an `accessor` generates both halves
 * from a single annotation, so narrowing it breaks the setter (the base
 * accepted more) and widening it breaks the getter (the base promised less).
 * Both directions refused leaves equality.
 *
 * THE PREREQUISITE WAS NOT A RULE AT ALL. The checker's class member walk is
 * where a class's own declarations are judged, and it had been reached only ON
 * DEMAND - when something asked for the class's type. A class nothing
 * referenced was never walked, so a rule checked there fired only if the
 * program happened to mention the class elsewhere. The walk is now forced once
 * per class; `instanceTypeOf` memoizes, so a later demand is a cache hit and
 * each error is reported once.
 */

test('an accessor override must be invariant', () => {
  const base = 'class B { accessor a: uint32 = 1; } ';
  // The same type is the only legal override.
  expect(evaluated(`${base} class D extends B { accessor a: uint32 = 2; } String(new D().a);`)).toBe('2');
  // NARROWING breaks the setter half: the base's accepted every uint32, and a
  // uint8 setter would not.
  expect(outcome(`${base} class D extends B { accessor a: uint8 = 2; }`)).toBe('TypeError');
  // WIDENING breaks the getter half: the base's promised a uint32 reader no
  // more than a uint32, and a uint8 accessor promises less... in the other
  // direction. Both are refused, which is what invariance means - asserting
  // only one would pass against a rule that had implemented plain covariance.
  expect(outcome('class B { accessor a: uint8 = 1; } class D extends B { accessor a: uint32 = 2; }')).toBe('TypeError');
});

test('the rule applies where it should and nowhere else', () => {
  // No heritage: nothing to be invariant against.
  expect(evaluated('class D { accessor a: uint8 = 2; } String(new D().a);')).toBe('2');
  // A base that declares no such member: the accessor is new, not an override.
  expect(evaluated('class B { b: uint8 = 1; } class D extends B { accessor a: uint8 = 2; } String(new D().a);')).toBe('2');
  // A plain FIELD override is not governed by this rule - the field/accessor
  // substitution rule is a separate one and is not implemented (see below).
  expect(evaluated('class B { a: uint32 = 1; } class D extends B { a: uint32 = 2; } String(new D().a);')).toBe('2');
});

test('a class NOTHING REFERENCES is checked, which is the infrastructure', () => {
  // The violation is the only thing in the program: no `new`, no annotation
  // naming the class, nothing that would have demanded its type. Before the
  // walk was forced this reported nothing at all, and every rule judged there
  // would have inherited that.
  expect(outcome('class B { accessor a: uint32 = 1; } class D extends B { accessor a: uint8 = 2; } 1;')).toBe('TypeError');
});

test('the WITHIN-CLASS rule: a setter accepts everything its getter returns', () => {
  // README: "the derived setter must also accept everything the derived getter
  // can return." A property whose getter yields a value its own setter would
  // refuse cannot round-trip - `o.x = o.x` does not type.
  const A = 'class Animal {} class Dog extends Animal {} ';
  // A WIDER setter is legal: every Dog the getter yields is an Animal.
  expect(outcome(`${A} class C { get x(): Dog { return new Dog(); } set x(v: Animal) {} }`)).toBe('ACCEPTED');
  expect(outcome(`${A} class C { get x(): Animal { return new Animal(); } set x(v: Animal) {} }`)).toBe('ACCEPTED');
  // A NARROWER setter is not: the getter can yield an Animal that is no Dog.
  expect(outcome(`${A} class C { get x(): Animal { return new Animal(); } set x(v: Dog) {} }`)).toBe('TypeError');

  // TWO DIFFERING NUMERIC TYPES ARE ALSO AN ERROR, and this is the assertion
  // two earlier cycles got backwards. Both treated this as a legal pair the
  // rule would wrongly refuse, and held the rule back on that basis. README is
  // explicit: "A value of one value type never implicitly becomes a value of
  // another. `uint8` does not widen to `uint16`" - the rule Rust, Swift, and Go
  // use. So the pair genuinely does not round-trip.
  expect(outcome('class C { get x(): uint8 { return 1; } set x(v: uint32) {} }')).toBe('TypeError');
  expect(outcome('class C { get x(): uint8 { return 1; } set x(v: uint8) {} }')).toBe('ACCEPTED');

  // An untyped pair is unjudged, and an `accessor` cannot violate the rule at
  // all - both halves come from one annotation.
  expect(outcome('class C { get x() { return 1; } set x(v) {} }')).toBe('ACCEPTED');
  expect(outcome('class C { accessor x: uint8 = 1; }')).toBe('ACCEPTED');
});

test('a derived setter must be CONTRAVARIANT', () => {
  // README: "A derived setter is contravariant: it must accept every value the
  // base setter accepts, and may accept more." The direction is the REVERSE of
  // the getter rule, so a rule that had copied that one would accept a widening
  // and a narrowing both - which is why both are asserted.
  const A = 'class Animal {} class Dog extends Animal {} ';
  expect(outcome(`${A} class S { set r(v: Dog) {} } class K extends S { set r(v: Animal) {} }`)).toBe('ACCEPTED');
  expect(outcome(`${A} class S { set r(v: Animal) {} } class K extends S { set r(v: Animal) {} }`)).toBe('ACCEPTED');
  expect(outcome(`${A} class S { set r(v: Animal) {} } class K extends S { set r(v: Dog) {} }`)).toBe('TypeError');
  // Nothing to be contravariant against.
  expect(outcome(`${A} class S { m() {} } class K extends S { set r(v: Dog) {} }`)).toBe('ACCEPTED');
  // The base's WRITE type had to be carried on the class type to make this
  // decidable: a Structure holds one type per property and the getter already
  // claims it, so a setter is invisible to a derived class without it.
  expect(outcome('class S { set r(v: uint32) {} } class K extends S { set r(v: uint8) {} }')).toBe('TypeError');
});

test('README\'s worked Shelter/Kennel example, both directions', () => {
  // The design's own illustration, which exercises the getter and setter rules
  // together on ONE property - the case a rule checked in isolation can pass
  // while the pair still does not hold.
  const decl = 'class Animal {} class Dog extends Animal {} '
    + 'class Shelter { get resident(): Animal { return new Animal(); } set resident(value: Animal) {} } ';
  expect(outcome(`${decl} class Kennel extends Shelter { get resident(): Dog { return new Dog(); } set resident(value: Animal) {} }`)).toBe('ACCEPTED');
  // README's own commented-out line: "// set resident(value: Dog) {} //
  // TypeError: the base setter accepts any Animal".
  expect(outcome(`${decl} class Kennel extends Shelter { set resident(value: Dog) {} }`)).toBe('TypeError');
});

test('the one rule not implemented: field and accessor substitution', () => {
  // Field/accessor substitution, which needs the member KIND recorded on the
  // class type - only accessor keys are tracked, and only within one walk.
  expect(outcome('class B { a: uint8 = 1; } class D extends B { get a(): uint8 { return 1; } set a(v: uint8) {} }')).toBe('ACCEPTED');
  // NOT a gap, recorded because two cycles read it as one: a value of one value
  // type never implicitly becomes another, so refusing this is correct. The run
  // time converting from an untyped parameter is a CHECKED conversion at a
  // boundary, which is a different rule.
  expect(outcome('let a: uint8 = 5; let b: uint32 = a;')).toBe('TypeError');
  expect(evaluated('function f(x) { let b: uint32 = x; return b; } let a: uint8 = 5; String(f(a));')).toBe('5');
});

test('NOMINAL SUBTYPING: a class is a subtype of the class it extends', () => {
  // The prerequisite the remaining rules were waiting on, and the engine had
  // been disagreeing with ITSELF about it: `new Dog() is Animal` was true and a
  // `Dog` argument satisfied an `Animal` parameter, while `let a: Animal = new
  // Dog()` was refused. The run time walks a prototype chain; the checker had
  // no chain to walk, so the class type now carries the class it extends -
  // exactly as an enum carries its underlying type.
  const A = 'class Animal {} class Dog extends Animal {} class Puppy extends Dog {} ';
  expect(outcome(`${A} let a: Animal = new Dog();`)).toBe('ACCEPTED');
  // Transitive, which a one-level check would miss.
  expect(outcome(`${A} let a: Animal = new Puppy();`)).toBe('ACCEPTED');
  // And still NOMINAL, which is the half a structural fix would have broken:
  // the base is not a subtype of the derived, and two unrelated EMPTY classes
  // are unrelated though their structures are identical.
  expect(outcome(`${A} let d: Dog = new Animal();`)).toBe('TypeError');
  expect(outcome('class X {} class Y {} let x: X = new Y();')).toBe('TypeError');
  // The run-time judgment it was disagreeing with is unchanged.
  expect(evaluated(`${A} String(new Dog() is Animal);`)).toBe('true');
});

test('a derived getter must refine COVARIANTLY', () => {
  // README: "A derived getter may refine its type covariantly under the same
  // conversion free rule that governs method returns." Every caller of the
  // base's getter must still receive what the base promised.
  const A = 'class Animal {} class Dog extends Animal {} ';
  expect(outcome(`${A} class S { get r(): Animal { return new Animal(); } } class K extends S { get r(): Dog { return new Dog(); } }`)).toBe('ACCEPTED');
  expect(outcome(`${A} class S { get r(): Animal { return new Animal(); } } class K extends S { get r(): Animal { return new Animal(); } }`)).toBe('ACCEPTED');
  // The violation: widening the getter breaks the base's promise.
  expect(outcome(`${A} class S { get r(): Dog { return new Dog(); } } class K extends S { get r(): Animal { return new Animal(); } }`)).toBe('TypeError');
  // An unrelated class is not a refinement either, which a rule comparing only
  // "different" rather than "not a subtype" would also catch - but this one
  // distinguishes it from the covariant case above, which that rule would not.
  expect(outcome(`${A} class X {} class S { get r(): Animal { return new Animal(); } } class K extends S { get r(): X { return new X(); } }`)).toBe('TypeError');
  expect(outcome(`${A} class K { get r(): Dog { return new Dog(); } }`)).toBe('ACCEPTED');
  // A NUMERIC refinement is judged too: one value type never implicitly
  // becomes another, so a differing numeric is a failed refinement like any
  // other, and the rule is not restricted to class types.
  expect(outcome('class S { get r(): uint32 { return 1; } } class K extends S { get r(): uint8 { return 1; } }')).toBe('TypeError');
});

// -- readonly accessor -----------------------------------------------------------

/*
 * `readonly accessor` is LEGAL and means a GETTER-ONLY accessor.
 *
 * The alternatives were illegal, and legal-but-unreportable. A modifier that
 * parses and enforces nothing is worse than one that is refused, because the
 * declaration reads as a constraint and is not one - so it is both enforced
 * and reported.
 */

test('a readonly accessor installs a GETTER ONLY', () => {
  // Installing only the getter is what makes assignment fail, by the ordinary
  // rule for a getter-only property rather than by a check written for this.
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } '
    + 'String(Object.getOwnPropertyDescriptor(A.prototype, "a").set);')).toBe('undefined');
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } '
    + 'String(typeof Object.getOwnPropertyDescriptor(A.prototype, "a").get);')).toBe('function');
  // A NON-readonly accessor still has both, which says the change was narrowed
  // to the modifier rather than applied to every accessor.
  expect(evaluated('class A { accessor a: uint8 = 3; } '
    + 'String(typeof Object.getOwnPropertyDescriptor(A.prototype, "a").set);')).toBe('function');
});

test('assignment is refused, and the initializer still reaches the backing', () => {
  expect(outcome('"use strict"; class A { readonly accessor a: uint8 = 1; } const x = new A(); x.a = 2;')).toBe('TypeError');
  // Sloppy mode fails silently, as it does for any getter-only property - so
  // the VALUE is the assertion there, not the throw.
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } const x = new A(); x.a = 9; String(x.a);')).toBe('3');
  // The INITIALIZER still works: DefineField writes the Private Name directly
  // and never goes through the setter, which is why removing the setter costs
  // nothing.
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } String(new A().a);')).toBe('3');
  expect(evaluated('class A { readonly accessor a: uint8; } String(new A().a);')).toBe('0');
  // A non-readonly accessor is unaffected.
  expect(evaluated('class A { accessor a: uint8 = 1; } const x = new A(); x.a = 5; String(x.a);')).toBe('5');
});

test('the context REPORTS `readonly`', () => {
  expect(evaluated('let r; function f(c) { r = String(c.readonly); } '
    + 'class A { @f readonly accessor a: uint8 = 1; } r;')).toBe('true');
  expect(evaluated('let r; function f(c) { r = String(c.readonly); } '
    + 'class A { @f accessor a: uint8 = 1; } r;')).toBe('false');
});

test('the LAYOUT is unaffected by the modifier', () => {
  // "An accessor participates in the memory layout exactly as a field does" -
  // and a readonly one is still a field's worth of storage, so removing the
  // setter must not remove the slot.
  expect(evaluated('class A { readonly accessor a: uint32 = 1; } '
    + 'String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("a").byteLength);')).toBe('4');
  expect(evaluated('class A { x: uint32 = 0; readonly accessor a: uint8 = 1; } '
    + 'String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("a").offset);')).toBe('4');
});
