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
