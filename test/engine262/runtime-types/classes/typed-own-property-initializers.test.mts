import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

/**
 * Spec: #sec-typed-own-property-initializers (Typed Own-Property Initializers).
 *
 * The annotation in `{ (x: uint8): 1 }` declares the own property's storage type and supplies the
 * contextual type of its initializer. It is a type error if the initializer's Static Type, after
 * contextual literal propagation, is known and is not assignable to that declared type. The judgment
 * belongs to each definition independently of the final inferred shape, including when a later
 * definition overwrites the property. At evaluation the key and the initializer are evaluated once,
 * in their ordinary property-definition order, and the value crosses the declared property boundary
 * before the property is installed; an ~any~-typed initializer is checked there at run time.
 */

test('an initializer that fits the declared type is accepted', () => {
  expect(ok('const o = { (x: uint8): 1 };')).toBe(true);
  // The literal takes the declared type as its contextual type, so it is a uint8.
  expect(evaluated('const o = { (x: uint8): 1 }; String(Reflect.typeOf(o.x) === uint8);')).toBe('true');
});

test('a known initializer that is not assignable is a type error before the source runs', () => {
  expectStaticTypeError('const o = { (x: uint8): "s" };');
  expectStaticTypeError('const o = { (x: uint8): 300 };');
});

test('the judgment belongs to each definition, even when a later definition overwrites the property', () => {
  expectStaticTypeError('const o = { (x: uint8): "s", x: 2 };');
});

test('an any-typed initializer is checked at run time, where the value crosses the property boundary', () => {
  expectThrownKind('var a: any = "s"; const o = { (x: uint8): a };', 'TypeError');
  expect(evaluated('var a: any = 5; const o = { (x: uint8): a }; String(o.x);')).toBe('5');
});

test('the key and the initializer are evaluated once', () => {
  expect(evaluated('let n = 0; const o = { (x: uint8): (n += 1, 1) }; String(n);')).toBe('1');
});

test('the declared type is the property\'s storage type afterwards', () => {
  expectStaticTypeError('const o = { (x: uint8): 1 }; o.x = "no";');
  expectThrownKind('var v: any = "no"; const o = { (x: uint8): 1 }; o.x = v;', 'TypeError');
});
