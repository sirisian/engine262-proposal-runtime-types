import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from '../../harness.mts';

/**
 * README feature coverage - interfaces and typed assignment.
 * Sections: Interfaces (Object/Index Signatures/Array/Function Interfaces),
 * Implementing Interfaces, Typed Assignment.
 *
 * Two README/spec reconciliations are recorded:
 *
 *  - An interface is NOMINAL where a class declares it implements one and
 *    STRUCTURAL where a value is checked against it (#sec-interfaces-semantics:
 *    "an object that has the members satisfies an interface-typed
 *    position whether or not any class declared it"). So `obj instanceof I` is a
 *    structural membership test, while `Reflect.isAssignable(objectType, I)`
 *    follows the nominal hierarchy. Both are verified below and are correct per
 *    spec; they are not the same question.
 *
 *  - `interface B extends A` appears in the README but the NORMATIVE grammar
 *    (#sec-classes-interfaces-and-enums) has no heritage clause; interface
 *    inheritance is
 *    expressed by intersection. The extends form does not parse and is noted as a
 *    documented gap superseded by the spec.
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
  expect(evaluated('interface A { a: uint32; } class C implements A { constructor() { this.a = (1 := uint32); } } let c = new C(); typeof c;')).toBe('object');
});

// -- Interface assignability is nominal ----------------------------------------
// A class that implements an interface is a subtype of it; a plain object type is
// not a declared subtype (though its values satisfy it structurally, above).
test('Interfaces: assignability follows the nominal hierarchy', () => {
  // an implementing class relates to its interface; a bare object type does not
  // (its VALUES satisfy the interface structurally via instanceof, tested above)
  expect(bool('interface I { a: uint8; } type O = { a: uint8 }; String(Reflect.isAssignable(O, I));')).toBe(false);
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

// -- Documented gap: interface extends -----------------------------------------
test('Interfaces: the extends heritage clause is not in the normative grammar (documents the gap)', () => {
  // Target (README): `interface B extends A { ... }`. The normative spec grammar
  // has no interface heritage clause; inheritance is expressed by intersection.
  // The extends form does not parse.
  expectThrown('interface A { a: uint8; } interface B extends A { b: string; } typeof B;');
});
