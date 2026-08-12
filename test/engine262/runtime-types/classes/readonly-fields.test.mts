import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../harness.mts';

/**
 * The `readonly` class-field modifier.
 *
 * A field declared `readonly` may be assigned only in its own initializer and in
 * a constructor of the declaring class; every other assignment is a TypeError,
 * including one from a method the constructor calls, from a subclass, through a
 * reference, or through reflection (README "Readonly Fields", spec
 * #sec-typed-classes). `readonly` is shallow: the field binding is fixed, not the
 * object it refers to. `Object.freeze` on an instance of a typed class makes every
 * field `readonly`, so a write after freezing is a TypeError in every mode.
 *
 * `readonly` is a field modifier written before the field name, after `static`
 * where both appear. It is new syntax under the runtime types feature; with the
 * feature off, `readonly x` does not parse as a modified field.
 */

// -- Permitted assignments -----------------------------------------------------
test('a readonly field is assignable in its initializer', () => {
  expect(evaluated('class A { readonly x = 5; } let a = new A(); String(a.x);')).toBe('5');
  expect(evaluated('class A { readonly id: uint32 = (7 := uint32); } let a = new A(); String(a.id);')).toBe('7');
});

test('a readonly field is assignable in the declaring class constructor', () => {
  expect(evaluated('class A { readonly x; constructor() { this.x = 10; } } let a = new A(); String(a.x);')).toBe('10');
  // a constructor may assign after reading, as long as it is the constructor body
  expect(evaluated('class A { readonly x; constructor() { this.x = 1; this.x = this.x + 1; } } let a = new A(); String(a.x);')).toBe('2');
});

// -- Forbidden assignments -----------------------------------------------------
test('an assignment to a readonly field outside the constructor is a TypeError', () => {
  expectThrown('class A { readonly x = 5; } let a = new A(); a.x = 9;');
});

test('an assignment from a method is a TypeError, even one the constructor calls', () => {
  // a plain method
  expectThrown('class A { readonly x = 5; set() { this.x = 7; } } let a = new A(); a.set();');
  // a method invoked from the constructor: only constructor bodies are permitted
  expectThrown('class A { readonly x; constructor() { this.init(); } init() { this.x = 3; } } new A();');
});

test('a subclass constructor may not assign a readonly field of the parent', () => {
  expectThrown('class A { readonly x; constructor() { this.x = 1; } } class B extends A { constructor() { super(); this.x = 2; } } new B();');
});

test('a write through reflection is a TypeError', () => {
  expectThrown('class A { readonly x = 5; } let a = new A(); Reflect.set(a, "x", 9);');
});

// -- Shallowness ---------------------------------------------------------------
test('readonly fixes the binding, not the referent', () => {
  // the field may not be reassigned, but the object it holds may be mutated
  expect(evaluated('class A { readonly obj = {}; constructor() {} } let a = new A(); a.obj.k = 5; String(a.obj.k);')).toBe('5');
  expectThrown('class A { readonly obj = {}; constructor() {} } let a = new A(); a.obj = {};');
});

// -- static readonly -----------------------------------------------------------
test('static readonly parses and reads', () => {
  expect(evaluated('class A { static readonly z = 9; } String(A.z);')).toBe('9');
});

// -- readonly as a field name --------------------------------------------------
test('readonly is still usable as a field name', () => {
  // `readonly = 3` declares a field named readonly, not a modifier
  expect(evaluated('class A { readonly = 3; } let a = new A(); String(a.readonly);')).toBe('3');
});

// -- Object.freeze makes fields readonly ---------------------------------------
test('freezing a typed instance makes its fields readonly in every mode', () => {
  // sloppy mode: a write after freeze is a TypeError, not a silent failure
  expectThrown('class A { x: uint8 = (1 := uint8); } let a = new A(); Object.freeze(a); a.x = (2 := uint8);');
  // and the instance reports as frozen
  expect(evaluated('class A { x: uint8 = (1 := uint8); } let a = new A(); Object.freeze(a); String(Object.isFrozen(a));')).toBe('true');
});

test('freezing an ordinary object is unchanged', () => {
  // a non-typed object frozen in sloppy mode fails the write silently, as before
  expect(evaluated('let o = { a: 1 }; Object.freeze(o); o.a = 2; String(o.a);')).toBe('1');
});

// -- Non-readonly fields are unaffected ----------------------------------------
test('a non-readonly field is writable from anywhere', () => {
  expect(evaluated('class A { y = 1; } let a = new A(); a.y = 42; String(a.y);')).toBe('42');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, readonly is not a field modifier', () => {
  // `readonly x = 5` is a syntax error without the feature (two field names)
  const c = runFlagOff('class A { readonly x = 5; } new A();') as { Type: string };
  expect(c.Type).toBe('throw');
});

// -- readonly on an OBJECT TYPE member (#sec-isobjectsubtype) ------------------
//
// "It is subtyped in depth only through a `readonly` member. A `readonly` member
// is covariant, since a value read from it and never written through it need
// only be of the required type." This is where "never written through it"
// becomes true for an object type, as the rules above make it true for a field.

test('a write through a readonly object-type member is refused', () => {
  expectThrown('type R = { readonly x: uint8 }; let v: R = { x: 1 }; v.x = (2 := uint8);');
  // Every assignment operator writes, and so does an update.
  expectThrown('type R = { readonly x: uint8 }; let v: R = { x: 1 }; v.x += (1 := uint8);');
  expectThrown('type R = { readonly x: uint8 }; let v: R = { x: 1 }; v.x++;');
  expectThrown('type R = { readonly x: uint8 }; let v: R = { x: 1 }; ++v.x;');
});

test('an interface member carries the flag too', () => {
  // An interface's structural form IS an object type, so it reaches the same
  // rule. The flag was dropped where the interface's structure is built, which
  // is why the inline spelling refused the write and this one did not.
  expectThrown('interface I { readonly x: uint8 } let v: I = { x: 1 }; v.x = (2 := uint8);');
});

test('a writable member is unaffected', () => {
  expect(evaluated('type W = { x: uint8 }; let v: W = { x: 1 };'
    + ' v.x = (2 := uint8); v.x += (1 := uint8); v.x++; String(v.x);')).toBe('4');
});

test('readonly is a property of the VIEW, not of the object', () => {
  // The reason this is checked in the checking pass rather than at the store:
  // one object can be viewed through both a readonly and a writable type, and
  // the boundary hands back the same object. A mark on the object could not
  // tell the two writes apart, and which one won would be the order the
  // bindings happened to be declared in - so it is asserted both ways round.
  expect(evaluated('type RO = { readonly x: uint8 }; type RW = { x: uint8 };'
    + ' let o = { x: 1 }; let a: RW = o; let b: RO = o;'
    + ' a.x = (2 := uint8); `${a === b}:${b.x}`;')).toBe('true:2');
  expect(evaluated('type RO = { readonly x: uint8 }; type RW = { x: uint8 };'
    + ' let o = { x: 1 }; let b: RO = o; let a: RW = o;'
    + ' a.x = (2 := uint8); String(a.x);')).toBe('2');
});

test('reading is unaffected, and readonly is shallow', () => {
  expect(evaluated('type R = { readonly x: uint8 }; let v: R = { x: 7 }; String(v.x);')).toBe('7');
  // "it fixes the binding, not the object the field refers to", so an object
  // HELD by a readonly member may still be mutated.
  expect(evaluated('type Inner = { y: uint8 }; type R = { readonly o: Inner };'
    + ' let v: R = { o: { y: 1 } }; v.o.y = (5 := uint8); String(v.o.y);')).toBe('5');
});

test('the limit: a write through an any-typed reference is not refused', () => {
  // The view exists only in the checking pass, so a value whose static type is
  // not known there cannot be checked. A class field's guarantee is stronger
  // because it belongs to the object. Pinned so the limit is recorded rather
  // than assumed.
  expect(evaluated('type R = { readonly x: uint8 }; let v: R = { x: 1 };'
    + ' let loose: any = v; loose.x = (2 := uint8); String(v.x);')).toBe('2');
});
