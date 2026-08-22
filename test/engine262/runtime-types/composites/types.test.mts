import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-composite-types (Composite Types).
 *
 * #sec-composite-types: "A Type Record is a composite type when its [[Kind]] is
 * ~primitive~ and its [[Name]] is *"Composite"*", with [[Arguments]] the shape.
 * NOT a Type Record kind of its own - which is why no `switch` over kinds
 * needed touching, and why these canonicalize through the ordinary type
 * interning by canonicalizing the shape in [[Arguments]].
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('Reflect.typeOf returns the INTERNED structural composite type', () => {
  // "two composites of the same shape have `===` runtime types" - which the
  // existing type interning gives, since the shape is what is canonicalized.
  expect(evaluated('String(Reflect.typeOf(Composite({ x: uint8(1) })) === Reflect.typeOf(Composite({ x: uint8(2) })));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(Composite({ x: 1 })) === Reflect.typeOf(Composite({ y: 1 })));')).toBe('false');
  // A field's TYPE is part of the shape, so the same key at two types is two
  // shapes - the type-sensitivity of interning, seen from the type side.
  expect(evaluated('String(Reflect.typeOf(Composite({ x: uint8(1) })) === Reflect.typeOf(Composite({ x: 1 })));')).toBe('false');
});

test('a field holding an OBJECT records `any`, which keeps shapes stable', () => {
  // #sec-compositefieldtype, and the exception easiest to miss: without it two
  // composites holding DIFFERENT objects would claim different shapes, and
  // shapes are what type identity is computed from - so the type of a composite
  // would depend on which objects it happened to hold.
  expect(evaluated('String(Reflect.typeOf(Composite({ v: {} })) === Reflect.typeOf(Composite({ v: [] })));')).toBe('true');
  // While the composites themselves stay distinct, because an object field
  // compares by IDENTITY. One shape, two objects - the two questions are
  // separate and this pair is what says so.
  expect(evaluated('String(Composite({ v: {} }) === Composite({ v: [] }));')).toBe('false');
});

test('`Composite` resolves in type position, and refuses a non-composite', () => {
  expect(outcome('let c: Composite = Composite({ x: 1 });')).toBe('ACCEPTED');
  expect(outcome('let c: Composite = { x: 1 };')).toBe('TypeError');
  expect(outcome('let c: Composite = 1;')).toBe('TypeError');
  // `Composite.<T>` is an ordinary parameterized spelling of the same family.
  // #sec-defaultvalueof refuses a binding of a type with no default, and a
  // library nominal has none, so resolution is proved with an alias.
  expect(outcome('type K = { x: uint8 }; type C = Composite.<K>;')).toBe('ACCEPTED');
});

test('the TOP composite type is the type of every composite', () => {
  // "`Composite` unparameterized is the family's top, the type of every
  // composite, which is what an untyped or heterogeneous creation infers to."
  expect(outcome('let a: Composite = Composite({ x: 1 }); let b: Composite = Composite({ y: "s", z: true });')).toBe('ACCEPTED');
});

test('a shape must be NAMED at the creation site, not inferred', () => {
  // The clause: "The Static Type of a call of the Composite function is the TOP
  // composite type where the call supplies no TypeArguments and no contextual
  // type reaches it." A shapeless type satisfies no specific interface, so this
  // is refused - and that is the design's OWN advice rather than a shortfall:
  // "an unannotated `Composite` call in typed code produces `number` fields,
  // and code that means anything else should say so at the creation site".
  expect(outcome('interface I { x: uint8 } let i: I = Composite({ x: uint8(1) });')).toBe('TypeError');
  // The remedy is the TYPED CREATION form;
  // typed-creation.test.mts owns the assertions.
  expect(evaluated('interface I { x: uint8 } String(Reflect.typeOf(Composite.<I>({ x: 1 }).x) === (type uint8));')).toBe('true');
});

test('`Composite.<S>` discriminates on its SHAPE', () => {
  // `FINDING-composite-shape-ignored.md`. Every composite satisfied every shape:
  // `Composite.<S>` was built as a metadata parameterization, so the shape went
  // into [[Metadata]] while `#sec-issubtype` reads [[Arguments]] - it found none,
  // treated the type as the TOP composite, and admitted everything.
  //
  // Nothing here covered it, which is why it survived.
  const K = 'type K = { x: uint8 }; ';
  expect(evaluated(`${K}String(Composite({ x: (1 := uint8) }) is Composite.<K>);`)).toBe('true');
  expect(evaluated(`${K}String(Composite({ y: (1 := uint8) }) is Composite.<K>);`)).toBe('false');
  expect(evaluated(`${K}String(Composite({ x: "s" }) is Composite.<K>);`)).toBe('false');
  expect(evaluated(`${K}String(Composite({}) is Composite.<K>);`)).toBe('false');
  // The top composite is still the type of every composite.
  expect(evaluated(`${K}String(Composite({ x: (1 := uint8) }) is Composite);`)).toBe('true');
});

test('a composite shape is READONLY however the annotation writes it', () => {
  // "A composite object is frozen from its creation", and `CompositeShape` marks
  // every field of a stamped value readonly to match. A mutable member in the
  // annotation would describe a type NO composite can satisfy - a trap rather
  // than a distinction - so the shape is normalised. It is also what makes the
  // clause's covariance sound: depth subtyping goes through a `readonly` one.
  expect(evaluated('type K = { x: uint8 }; String(Composite({ x: (1 := uint8) }) is Composite.<K>);')).toBe('true');
  expect(evaluated('type R = { readonly x: uint8 }; String(Composite({ x: (1 := uint8) }) is Composite.<R>);')).toBe('true');
  // covariance, against a field type that genuinely is wider
  expect(evaluated('type W = { x: any }; String(Composite({ x: (1 := uint8) }) is Composite.<W>);')).toBe('true');
  // and a tuple shape, which the clause names beside an object
  expect(evaluated('type T = [uint8]; String(Composite([(1 := uint8)]) is Composite.<T>);')).toBe('true');
});
