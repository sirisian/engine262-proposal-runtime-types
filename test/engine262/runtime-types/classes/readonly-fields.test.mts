import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff, expectStaticTypeError, ok } from '../harness.mts';

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

// -- A method's expected `this` (#sec-this-adoption) --------------------------

test('a method may not be extracted from the object it belongs to', () => {
  // "A method extracted from its class and called free of it is the case this
  // decides ... the extraction is a type error at the boundary that took it
  // rather than a TypeError inside it." It used to fail INSIDE the body, with
  // "Cannot convert undefined to object" when it read a typed field off
  // undefined.
  expectThrown('class C { x: uint8 = (5 := uint8); read(): uint8 { return this.x; } }'
    + ' type Free = () => uint8; let f: Free = (new C()).read;');
  // Calling it through the object is untouched.
  expect(evaluated('class C { x: uint8 = (5 := uint8); read(): uint8 { return this.x; } }'
    + ' const c = new C(); String(c.read());')).toBe('5');
});

test('a method still satisfies an interface and an object type', () => {
  // The reason a method's `this` is a SELF type rather than the class: a method
  // is reached only through an object that has it, so the receiver is a `C` at
  // every call whether the reference is typed `C` or `I`. Giving the class's
  // method a `C` and the interface's an `I` would make the class's the
  // narrower, which contravariance rejects - refusing a program that is sound.
  expect(evaluated('interface I { read(): uint8 }'
    + ' class C implements I { x: uint8 = (5 := uint8); read(): uint8 { return this.x; } }'
    + ' let i: I = new C(); String(i.read());')).toBe('5');
  expect(evaluated('class C { x: uint8 = (5 := uint8); read(): uint8 { return this.x; } }'
    + ' type Shape = { read(): uint8 }; let o: Shape = new C(); String(o.read());')).toBe('5');
});

// ---------------------------------------------------------------------------
// ...AND THE REFUSAL IS AN EARLY ERROR WHERE THE BASE'S TYPE IS KNOWN.
//
// `#sec-object-types`: "A write to a `readonly` member is a type error, AT
// COMPILE TIME WHERE THE TYPE OF THE BASE IS KNOWN and at run time otherwise."
// The rule and the operation that applies it were both correct and reached - a
// `readonly` member of an OBJECT TYPE or an INTERFACE was already refused
// statically. What was missing was the flag: a class field's Property Type
// Record hardcoded `readonly: false`, so the modifier never arrived from the
// declaration and only the run time refused. A divergence in the moment, not in
// the answer - which is why the tests above, all written against the run time,
// went on passing.
// ---------------------------------------------------------------------------

test('a write through a known base is an Early Error', () => {
  const C = 'class C { readonly v: uint8 = 0; } const c = new C(); ';
  expectStaticTypeError(`${C} c.v = 1;`);
  // "every assignment form is a write": a compound assignment and an update are
  // writes, and the operation that refuses them already sat outside the `=`
  // guard - so these follow from the flag alone.
  expectStaticTypeError(`${C} c.v += 1;`);
  expectStaticTypeError(`${C} c.v++;`);
  expectStaticTypeError(`${C} c.v--;`);
  // The object-type and interface spellings are unchanged.
  expectStaticTypeError('type T = { readonly v: uint8 }; let o: T = { v: 1 }; o.v = 2;');
  expectStaticTypeError('interface I { readonly v: uint8 } function f(i: I) { i.v = 2; }');
});

test('what stays writable', () => {
  expect(ok('class C { v: uint8 = 0; } const c = new C(); c.v = 1;')).toBe(true);
  expect(evaluated('class C { readonly v: uint8 = 3; } const c = new C(); let u: uint8 = c.v; String(u);')).toBe('3');
  // The constructor is where a `readonly` field is filled.
  expect(evaluated('class C { readonly v: uint8; constructor() { this.v = 7; } } String(new C().v);')).toBe('7');
});

// ---------------------------------------------------------------------------
// WITHIN A CLASS BODY, `this` IS AN INSTANCE OF THE CLASS.
//
// The `ThisExpression` arm reads the innermost `this` frame, and a class body
// pushed none - so `this` was ~any~ and EVERY access through it was unchecked:
// `this.v = "s"` on a `uint8` field, `this.m("s")` against `m(a: uint8)`,
// `let s: string = this.v` - while the same accesses through a binding were all
// refused. Since a method body is where a class's own members are used, this was
// the widest of the gaps found in this pass: the rules existed and the receiver
// they needed had no type.
// ---------------------------------------------------------------------------

test('an access through `this` is checked as one through a binding is', () => {
  expectStaticTypeError('class B { v: uint8 = 0; m() { this.v = "s"; } }');
  expectStaticTypeError('class B { v: uint8 = 0; m() { let s: string = this.v; } }');
  expectStaticTypeError('class B { m(a: uint8) {} go() { this.m("s"); } }');
  // Correct uses are unaffected.
  expect(evaluated('class B { v: uint8 = 0; m(a: uint8) { this.v = a; } go() { this.m(3); return this.v; } } String(new B().go());')).toBe('3');
});

test('the readonly rule is about a class\'s USERS, so `this` is exempt', () => {
  // The form the modifier exists for. This only arose once `this` had a type:
  // before, the receiver was ~any~ and the member was never found readonly.
  expect(evaluated('class C { readonly v: uint8; constructor() { this.v = 7; } } String(new C().v);')).toBe('7');
  // A user still cannot write it, and the field's TYPE is still enforced
  // through `this`.
  expectStaticTypeError('class C { readonly v: uint8 = 0; } const c = new C(); c.v = 1;');
  expectStaticTypeError('class C { v: uint8 = 0; m() { this.v = "s"; } }');
});
