import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * The kind a rejection carries, through `eval` so that an EARLY error is
 * catchable: these rules are CHECKED BEFORE EVALUATION, so the harness's
 * `expectThrownKind` cannot reach one - the script carrying its try/catch never
 * runs at all.
 */
const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

/**
 * PLAN-accessor.md stage D, first rule: AN ACCESSOR OVERRIDE IS INVARIANT.
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
  // walk was forced this reported nothing at all, and every rule stage D adds
  // would have inherited that.
  expect(outcome('class B { accessor a: uint32 = 1; } class D extends B { accessor a: uint8 = 2; } 1;')).toBe('TypeError');
});

test('PINNED: the three rules stage D has not implemented', () => {
  // Each needs something the checker does not record, and each is stated by
  // README. Pinned in its CURRENT state so the next cycle sees the gap rather
  // than rediscovering it.
  const accepted = outcome;
  const animals = 'class Animal {} class Dog extends Animal {} ';

  // 2. Derived setter contravariance. Needs the base's SETTER types, which the
  // class type does not expose - `setterTypes` is local to the walk.
  expect(accepted(`${animals} class S { set r(v: Animal) {} } class K extends S { set r(v: Dog) {} }`)).toBe('ACCEPTED');

  // 3. The WITHIN-CLASS rule - "the setter must accept everything the getter
  // can return" - which needs no new bookkeeping and STILL cannot be written
  // yet. Implemented against today's assignability it refuses pairs README
  // permits, because that relation rejects even a widening: measured, `let b:
  // uint32 = a` on a `uint8` is a TypeError today, as is `let a: Animal = new
  // Dog()`. So the rule waits on assignability, not on bookkeeping - and the
  // invariance rule above is immune to that, because it asks for equality.
  expect(accepted(`${animals} class A { get x(): Animal { return new Animal(); } set x(v: Dog) {} }`)).toBe('ACCEPTED');
  // HALF OF THAT BLOCKER IS GONE (cycle 140): a class is now a subtype of the
  // class it extends, so `let a: Animal = new Dog()` is accepted. What remains
  // is NUMERIC widening, which the relation still refuses - so the within-class
  // rule would still manufacture a false positive on `get x(): uint8 / set
  // x(v: uint32)`, which is legal.
  expect(accepted(`${animals} let a: Animal = new Dog();`)).toBe('ACCEPTED');
  expect(accepted('let a: uint8 = 5; let b: uint32 = a;')).toBe('TypeError');

  // 4. Field/accessor substitution, which needs the member KIND recorded.
  expect(accepted('class B { a: uint8 = 1; } class D extends B { get a(): uint8 { return 1; } set a(v: uint8) {} }')).toBe('ACCEPTED');
});

test('NOMINAL SUBTYPING: a class is a subtype of the class it extends', () => {
  // The prerequisite the remaining rules were waiting on, and the engine had
  // been disagreeing with ITSELF about it: `new Dog() is Animal` was true and a
  // `Dog` argument satisfied an `Animal` parameter, while `let a: Animal = new
  // Dog()` was refused. The run time walks a prototype chain; the checker had
  // no chain to walk, so the class type now carries the class it extends -
  // exactly as an enum carries its underlying type (F62).
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
});

test('PINNED: a NUMERIC getter refinement is left unjudged, deliberately', () => {
  // `get r(): uint8` overriding `get r(): uint32` is a legal covariant
  // refinement and is NOT checked. IsSubtype has no primitive case at all, so
  // it reports every numeric pair as unrelated in both directions; a rule that
  // trusted it here would refuse this, which is the false positive that kept
  // the within-class rule out twice.
  expect(outcome('class S { get r(): uint32 { return 1; } } class K extends S { get r(): uint8 { return 1; } }')).toBe('ACCEPTED');
  // THE UNDERLYING DISAGREEMENT, measured: the RUN TIME widens happily, and
  // only the checker refuses. Through an untyped parameter - where the checker
  // cannot see the source type - the same widening succeeds and yields 5.
  expect(evaluated('function f(x) { let b: uint32 = x; return b; } let a: uint8 = 5; String(f(a));')).toBe('5');
  expect(outcome('let a: uint8 = 5; let b: uint32 = a;')).toBe('TypeError');
});
