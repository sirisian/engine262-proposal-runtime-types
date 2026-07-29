import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators.md stage H, the METADATA member.
 *
 * decorators.md, Metadata Inheritance: "Each member's metadata is inherited
 * through the PROTOTYPE CHAIN ... If B redeclares the field and applies its own
 * decorators, B gets a new metadata object (PROTOTYPICALLY INHERITING FROM A'S)
 * where B's decorators write their values, SHADOWING A'S WITHOUT MUTATING
 * THEM."
 *
 * So a metadata object is an ORDINARY OBJECT whose [[Prototype]] is the base
 * declaration's - which makes "symbol key lookups fall through the prototype"
 * true by construction rather than by a lookup rule written for it. It is also
 * why the metadata channel became a `partial interface` rather than a `partial
 * class` (cycle 126): an instance of a class with a typed field is not
 * extensible and could not be prototypically linked at all.
 */

test('a class context carries a metadata object', () => {
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.metadata; } @f class A {} t;')).toBe('object');
});

test('the object PERSISTS, so decorators of one declaration share it', () => {
  // The object a decorator receives IS the one that persists, not a copy - two
  // decorators on one class see one object, which is what makes metadata a
  // channel rather than a per-call scratch space.
  expect(evaluated('const k = Symbol("k"); function write(c) { c.metadata[k] = "set"; } '
    + 'let seen = "?"; function read(c) { seen = String(c.metadata[k]); } '
    + '@read @write class A {} seen;')).toBe('set');
});

test('a subclass INHERITS its base\'s metadata through the prototype', () => {
  // "If A declares a field with metadata, and B extends A without redeclaring
  // that field, B inherits A's metadata as-is."
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'let seen = "?"; function derived(c) { seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} seen;')).toBe('A');
});

test('a subclass SHADOWS without mutating, which is the assertion that matters', () => {
  // A write in B must not reach A. The discriminating form is a THIRD class
  // that also extends A and reads the key: if B's write had mutated A's object,
  // C would see "B". Reading through A itself would be weaker, since an
  // implementation could special-case the base.
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'function derived(c) { c.metadata[k] = "B"; } '
    + 'let seen = "?"; function read(c) { seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} @read class C extends A {} seen;')).toBe('A');
  // And B genuinely has its own value, so the shadowing is real rather than the
  // write being dropped.
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'let seen = "?"; function derived(c) { c.metadata[k] = "B"; seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} seen;')).toBe('B');
});

test('a class with no base still has a metadata object', () => {
  expect(evaluated('const k = Symbol("k"); let seen = "?"; '
    + 'function f(c) { c.metadata[k] = "own"; seen = String(c.metadata[k]); } @f class A {} seen;')).toBe('own');
  // An unrelated class shares nothing with it.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "A"; } '
    + 'let seen = "none"; function g(c) { seen = String(c.metadata[k]); } '
    + '@f class A {} @g class B {} seen;')).toBe('undefined');
});

test('every class-family context carries metadata, and it READS BACK', () => {
  // decorators.md gives `metadata` to every context of the Class, Function,
  // Object and Enum families. The class family is wired here.
  const t = 'let t = "?"; function f(c) { t = typeof c.metadata; } ';
  expect(evaluated(`${t} class A { @f a: uint8 = 1; } t;`)).toBe('object');
  expect(evaluated(`${t} class A { @f m() {} } t;`)).toBe('object');
  expect(evaluated(`${t} class A { @f accessor a: uint8 = 1; } t;`)).toBe('object');

  // `Reflect.getMetadata` reads back what a decorator wrote - THE SAME OBJECT,
  // not a copy, which is what makes metadata a channel rather than a snapshot.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "written"; } '
    + '@f class A {} String(Reflect.getMetadata.<Reflect.Class, A>()[k]);')).toBe('written');
  expect(evaluated('const k = Symbol("k"); let seen; function f(c) { seen = c.metadata; } '
    + '@f class A {} String(seen === Reflect.getMetadata.<Reflect.Class, A>());')).toBe('true');
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "field"; } '
    + 'class A { @f a: uint8 = 1; } String(Reflect.getMetadata.<Reflect.ClassField, A>("a")[k]);')).toBe('field');

  // A MEMBER's metadata is keyed by the CONSTRUCTOR, not by the home object it
  // was defined on - an instance member's home object is the prototype, so
  // storing it there wrote where nothing would read.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "A"; } '
    + 'class A { @f a: uint8 = 1; } class B extends A { a: uint8 = 2; } '
    + 'String(Reflect.getMetadata.<Reflect.ClassField, B>("a")[k]);')).toBe('A');
  // And two members do not share one object.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "a"; } '
    + 'class A { @f a: uint8 = 1; b: uint8 = 2; } String(Reflect.getMetadata.<Reflect.ClassField, A>("b")[k]);')).toBe('undefined');
  // The untyped call names no context and so names no metadata object.
  expect(evaluated('try { Reflect.getMetadata(); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('the FUNCTION, OBJECT and ENUM families carry metadata too', () => {
  // decorators.md gives `metadata` to every context of the Class, Function,
  // Object and Enum families. The class family landed first; these three
  // complete it.
  const t = 'let t = "?"; function f(c) { t = typeof c.metadata; } ';
  expect(evaluated(`${t} @f function g() {} t;`)).toBe('object');
  expect(evaluated(`${t} const o = { @f a: 1 }; t;`)).toBe('object');
  expect(evaluated(`${t} const o = { @f m() {} }; t;`)).toBe('object');
  expect(evaluated(`${t} @f enum E { A } t;`)).toBe('object');
  expect(evaluated(`${t} enum E { @f A } t;`)).toBe('object');
});

test('each declaration gets its OWN object, which is what keying is for', () => {
  // Two members of one object literal do not share. "For objects the metadata
  // is on the INSTANCE", so two objects of the same shape do not share either -
  // the case a shape-keyed store would get wrong.
  const write = 'const k = Symbol("k"); function w(c) { c.metadata[k] = "written"; } ';
  const read = 'let seen = "?"; function r(c) { seen = String(c.metadata[k]); } ';
  expect(evaluated(`${write}${read} const o = { @w a: 1, @r b: 2 }; seen;`)).toBe('undefined');
  expect(evaluated(`${write}${read} const o1 = { @w a: 1 }; const o2 = { @r a: 1 }; seen;`)).toBe('undefined');
  // An enum's own metadata is not its enumerator's.
  expect(evaluated(`${write}${read} @w enum E { @r A } seen;`)).toBe('undefined');
  // And a function's is its own.
  expect(evaluated(`${write} let seen2 = "?"; function r2(c) { seen2 = String(c.metadata[k]); } `
    + '@w function g() {} @r2 function h() {} seen2;')).toBe('undefined');
});

test('getMetadata serves every class-family MEMBER context', () => {
  // A declaration is a field or a method or an accessor and never two of them,
  // so every member context reads the same per-declaration store: the context
  // decides the metadata's TYPE and the name decides which object. That is why
  // these need no cases of their own.
  const w = 'const k = Symbol("k"); function f(c) { c.metadata[k] = "v"; } ';
  expect(evaluated(`${w} class A { @f m() {} } String(Reflect.getMetadata.<Reflect.ClassMethod, A>("m")[k]);`)).toBe('v');
  expect(evaluated(`${w} class A { @f accessor v: uint8 = 1; } String(Reflect.getMetadata.<Reflect.ClassAccessor, A>("v")[k]);`)).toBe('v');
  expect(evaluated(`${w} class A { @f get v(): uint8 { return 1; } } String(Reflect.getMetadata.<Reflect.ClassGetter, A>("v")[k]);`)).toBe('v');
  expect(evaluated(`${w} class A { @f set v(x: uint8) {} } String(Reflect.getMetadata.<Reflect.ClassSetter, A>("v")[k]);`)).toBe('v');
  // A context that names no class declaration is refused rather than answered
  // with an empty object.
  expect(evaluated('try { eval("Reflect.getMetadata.<Reflect.Let, uint8>();"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('PINNED: getMetadata reaches the class family only', () => {
  // The Function, Object and Enum families CARRY metadata and cannot be read
  // back through `getMetadata` yet: its target type argument names a class, and
  // a function or an object literal has no such type to name. decorators.md's
  // signatures for those take an instance rather than a type, which is a
  // different interception than the one the class family uses.
  expect(evaluated('const k = Symbol("k"); let seen = "?"; function f(c) { c.metadata[k] = "fn"; seen = String(c.metadata[k]); } '
    + '@f function g() {} seen;')).toBe('fn');
});
