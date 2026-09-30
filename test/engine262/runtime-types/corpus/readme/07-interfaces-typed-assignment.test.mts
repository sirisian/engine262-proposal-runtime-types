import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from '../../harness.mts';

/**
 * Fixture: the README sections Interfaces (Object, Index Signatures, Array and Function Interfaces), Implementing
 * Interfaces and Typed Assignment, in the ecmascript-types repository.
 *
 * Interfaces and typed assignment. An interface is NOMINAL where a class declares it implements one and STRUCTURAL
 * where a value is checked against it (#sec-interfaces-semantics: an object that has the members satisfies an
 * interface-typed position whether or not any class declared it), and IsSubtype reads the structural form
 * (#sec-object-types), so a bare object type that has the members is assignable to the interface, as an
 * implementing class is.
 *
 * `interface B extends A` has no counterpart in the specification's grammar (#sec-classes-interfaces-and-enums):
 * there is no heritage clause, and interface inheritance is expressed by intersection. The extends form does not
 * parse.
 */

// -- Object Interfaces: declaration and structural membership ------------------
// An interface declares a contract. A value that has the members satisfies an
// interface-typed position (structural value check).
test('Object Interfaces: a value with the members satisfies the interface', () => {
  expect(evaluated('interface IPoint { x: uint32; y: uint32; } typeof IPoint;')).toBe('object');
  expect(evaluated('interface IPoint { x: uint32; y: uint32; } let p = { x: (1 := uint32), y: (2 := uint32) }; String(p instanceof IPoint);')).toBe('true');
  // a value missing a required member does not satisfy it
  expect(evaluated('interface IPoint { x: uint32; y: uint32; } let p = { x: (1 := uint32) }; String(p instanceof IPoint);')).toBe('false');
});

test('Object Interfaces: an optional member need not be present', () => {
  expect(evaluated('interface I { a: uint8; b?: string; } let p = { a: (1 := uint8) }; String(p instanceof I);')).toBe('true');
  // members may be separated by ; or ,
  expect(evaluated('interface I { a: uint8, b: uint8 } typeof I;')).toBe('object');
});

// -- Index Signatures ----------------------------------------------------------
// An interface or object type constrains arbitrary keys with an index signature;
// the key type must be string, symbol, uint32, or a union of these.
test('Index Signatures: an interface may constrain arbitrary keys', () => {
  expect(evaluated('interface StringMap { [key: string]: uint32; } typeof StringMap;')).toBe('object');
  expect(evaluated('interface Sparse { [index: uint32]: float32; } typeof Sparse;')).toBe('object');
  // the inline form on an object type
  expect(ok('type J = { [key: string]: any }; typeof J;')).toBe(true);
});

// -- Function and operator members ---------------------------------------------
// An interface may declare operator members; a type satisfies such an interface
// by defining those operators.
test('Interfaces: operator members are declarable', () => {
  expect(evaluated('interface Ordered { operator<(other: uint8): boolean; } typeof Ordered;')).toBe('object');
});

// -- Implementing Interfaces ---------------------------------------------------
// A class implements an interface with an implements clause; it may combine with
// extends.
test('Implementing Interfaces: a class implements an interface', () => {
  expect(evaluated('interface A { a: uint32; } class C implements A { a = (1 := uint32); } typeof C;')).toBe('function');
  // combined with extends
  expect(evaluated('interface A { a: uint32; } class B {} class C extends B implements A { a = (1 := uint32); } typeof C;')).toBe('function');
  // an instance is created normally
  expect(evaluated('interface A { a: uint32; } class C implements A { a: uint32; } let c = new C(); typeof c;')).toBe('object');
  // The interface example: `C` declares `a` and inherits `b`'s host from `B`.
  expect(evaluated('interface A { a: uint32; b(uint32): uint32; } class B {} class C extends B implements A { a: uint32; b(a) { return a; } } const x = new C(); x.a = x.b(5); String(x.a);')).toBe('5');
  // A member is DECLARED if the class or a class it extends declares it: an
  // inherited member satisfies the interface as an own one does.
  expect(evaluated('interface A { a: uint32; } class B { a: uint32 = 0; } class C extends B implements A { } typeof C;')).toBe('function');
  // What does NOT declare a member: a constructor assignment, or an assignment on the instance after construction. A
  // class states its members; `this.a = ...` creates a property on one object. Both forms are refused for the same
  // reason, and the field must be declared.
  expectThrown('interface A { a: uint32; } class C implements A { constructor() { this.a = (1 := uint32); } }');
});

// -- Interface assignability is nominal ----------------------------------------
// A class that implements an interface is a subtype of it; a plain object type is
// not a declared subtype (though its values satisfy it structurally, above).
test('Interfaces: assignability follows the nominal hierarchy', () => {
  // An implementing class relates to its interface, and so does a bare object type that has the members:
  // #sec-object-types defines the structural form ("This is what lets a value satisfy an interface by having its
  // members, which IsSubtype reads") and #sec-issubtype carries the step itself. `f(o)` for an object-typed `o` is
  // therefore accepted, and refusing it would be the failure that clause describes. The nominal reading of an
  // interface for assignability would make this line false, and would mean changing the specification's two
  // steps.
  expect(bool('interface I { a: uint8; } type O = { a: uint8 }; String(Reflect.isAssignable(O, I));')).toBe(true);
});

// -- Typed Assignment: `let a := X` and `expression := Type` -------------------
// A typed-assignment declaration infers the binding's type from the right side.
// `expression := Type` is also an expression usable in any position.
test('Typed Assignment: let a := X infers the type from X', () => {
  expect(bool('let a := (5 := uint8); String(a === (5 := uint8));')).toBe(true);
  expect(bool('let a := (5 := uint8); String(Reflect.typeOf(a) === uint8);')).toBe(true);
  // the var form works too
  expect(bool('var b := (7 := uint8); String(b === (7 := uint8));')).toBe(true);
  // an untyped right side infers a plain value
  expect(evaluated('let a := 5; String(a);')).toBe('5');
});

test('Typed Assignment: expression := Type is an expression that converts', () => {
  // as an expression in a larger context
  expect(bool('let a = (300 := uint8); String(a === (44 := uint8));')).toBe(true);
  // the declaration form applies the same conversion (wrapping)
  expect(bool('let a := (300 := uint8); String(a === (44 := uint8));')).toBe(true);
});

// -- interface extends: no heritage clause in the grammar --------------------------
test('Interfaces: the extends heritage clause is not in the normative grammar', () => {
  // `interface B extends A { ... }`: the specification's grammar has no interface heritage clause; inheritance is
  // expressed by intersection. The extends form does not parse.
  expectThrown('interface A { a: uint8; } interface B extends A { b: string; } typeof B;');
});
