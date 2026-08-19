import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-typed-classes (Typed Classes) - a class name in a type position.
 *
 * A class name resolves to the nominal instance type carrying its declared
 * members, which is what makes a store to a field, a call to a method, and an
 * assignment between related classes judgeable.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

test('a class name denotes its class type', () => {
  expect(evaluated('class A {} const T = type A; typeof T === "object" ? "ok" : "no";')).toBe('ok');
  // The class type is stable: the same class yields the same Type Object.
  expect(evaluated('class A {} type A1 = A; type A2 = A; A1 === A2 ? "same" : "different";')).toBe('same');
  // Distinct classes are distinct types even when structurally identical.
  expect(evaluated('class A {} class B {} type TA = A; type TB = B; TA !== TB ? "ok" : "no";')).toBe('ok');
});

test('class membership follows the prototype chain', () => {
  expect(evaluated('class A {} class B extends A {} const T = type A; (new A() instanceof T) && (new B() instanceof T) && !({} instanceof T) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('class A {} class B extends A {} const U = type B; !(new A() instanceof U) && (new B() instanceof U) ? "ok" : "no";')).toBe('ok');
  // A plain object with a matching shape is still not a class instance.
  expect(evaluated('class Point { constructor() { this.x = 0; } } const T = type Point; !({ x: 0 } instanceof T) ? "ok" : "no";')).toBe('ok');
});

test('class types work as annotations and are enforced', () => {
  expect(evaluated('class A {} function f(a: A) { return "got"; } f(new A()) === "got" ? "ok" : "no";')).toBe('ok');
  expectThrown('class A {} function f(a: A) { return a; } f({});');
  expect(evaluated('class A {} let x: A = new A(); x instanceof (type A) ? "ok" : "no";')).toBe('ok');
  expectThrown('class A {} let x: A = {};');
});

test('class types compose with is and unions', () => {
  expect(evaluated('class A {} class B {} type U = A | B; (new A() is U) && (new B() is U) && !({} is U) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('class A {} (new A() is A) === true && ({} is A) === false ? "ok" : "no";')).toBe('ok');
});

test('class expressions bind class types too', () => {
  expect(evaluated('const C = class {}; type T = C; (new C() instanceof T) ? "ok" : "no";')).toBe('ok');
});

test('feature off: class-name-as-type stays an error', () => {
  expect(run('class A {} const T = type A;', )).toMatchObject({ Type: 'normal' });
});

test('reflection answers the class relations the checker decides', () => {
  // PLAN-nominal-records.md phase 2. `Reflect.isAssignable` is specified as the
  // checker's judgment "exposed unchanged", and it was not: the relation walks
  // [[Base]] for the inheritance chain and compares [[Structure]] to decide
  // that a class satisfies an interface it implements, and the record the
  // RUNTIME built for a class carried neither. Every answer below was *false*.
  const decls = 'class Base { a: uint8 = 1; } class Derived extends Base { b: uint8 = 2; } '
    + 'class Unrelated { a: uint8 = 1; } interface I { a: uint8 } class Impl implements I { a: uint8 = 1; } ';
  expect(evaluated(`${decls} String(Reflect.isAssignable(type Derived, type Base));`)).toBe('true');
  expect(evaluated(`${decls} String(Reflect.isAssignable(type Impl, type I));`)).toBe('true');
  // The chain is one-way, and an unrelated class of the same shape is not in it:
  // "two unrelated empty classes stay unrelated, which is the point of classes
  // being nominal at all".
  expect(evaluated(`${decls} String(Reflect.isAssignable(type Base, type Derived));`)).toBe('false');
  expect(evaluated(`${decls} String(Reflect.isAssignable(type Unrelated, type Base));`)).toBe('false');
  // The corollaries, which were false for the same reason one layer down.
  expect(evaluated(`${decls} String(Reflect.isAssignable(type (x: Base) => void, type (x: Derived) => void));`)).toBe('true');
  expect(evaluated(`${decls} String(Reflect.isAssignable(type { readonly v: Derived }, type { readonly v: Base }));`)).toBe('true');
});

test('a class type is satisfied by construction, not by shape', () => {
  // The guard phase 2 needed. Giving a runtime class record a [[Structure]] for
  // SUBTYPING made membership read it too, and `{} instanceof (type A)` became
  // true for any class with no members. #sec-object-types: "a class states a
  // construction and an identity as well as a shape, and it is the identity
  // that its type is for" - so membership follows the prototype chain and
  // subtyping follows the declaration.
  expect(evaluated('class A {} const T = type A; String(!({} instanceof T));')).toBe('true');
  expect(evaluated('class A { a: uint8 = 1; } const T = type A; String(!({ a: 1 } instanceof T));')).toBe('true');
  expectThrown('class A {} function f(a: A) { return a; } f({});');
  // An INTERFACE is still satisfied structurally, which is the same field read
  // for the other question.
  expect(evaluated('interface I { a: uint8 } let o: I = { a: (1 := uint8) }; String(o.a);')).toBe('1');
});
