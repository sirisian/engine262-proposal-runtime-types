import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../harness.mts';

/**
 * Spec: #sec-explicit-conversion (Explicit Conversion) - callable Type
 * Objects: the `T(v)` cast-call form and `Count(n)` enum construction.
 *
 * A Type Object is callable. A call on a plain type is an explicit conversion of
 * the argument to that type: `uint8(v)` is the same operation as `v := uint8`
 * (#sec-conversions). A call on an enum type is the reverse conversion:
 * `Count(n)` returns the enumerator whose underlying value is `n`, and is a
 * TypeError when `n` is not one of them (#sec-enums). Making a Type Object
 * callable does not change `typeof`, which reports "object" for a Type Object as
 * the proposal's feature detection (#sec-reflect-typeof), nor its interned
 * identity: two mentions of one type are one object, callable or not.
 */

// -- Cast-call on a plain type -------------------------------------------------
test('a call on a numeric type converts the argument, the same as :=', () => {
  expect(evaluated('String(uint8(300));')).toBe('44');
  expect(evaluated('String(uint8(300) === (300 := uint8));')).toBe('true');
});

test('a call on a type performs the ordinary primitive conversions', () => {
  expect(evaluated('String(string(42));')).toBe('42');
  expect(evaluated('String(uint16(65535));')).toBe('65535');
});

test('a call on a type through a type alias works', () => {
  expect(evaluated('type U = uint8; String(U(300));')).toBe('44');
});

test('a call on a type is a TypeError when the conversion cannot be performed', () => {
  expectThrown('uint8("hello");');
  expectThrown('uint8({});');
});

// -- Enum construction ---------------------------------------------------------
test('a call on an enum type returns the enumerator with that underlying value', () => {
  expect(evaluated('enum Count { Zero, One, Two } String(Count(1));')).toBe('1');
  expect(evaluated('enum Count { Zero, One, Two } String(Count(0) === Count.Zero);')).toBe('true');
  expect(evaluated('enum Count { Zero, One, Two } String(Count(2) === Count.Two);')).toBe('true');
});

test('a call on an enum type with explicit values finds the enumerator by value', () => {
  expect(evaluated('enum Code { Ok = 200, NotFound = 404 } String(Code(404) === Code.NotFound);')).toBe('true');
});

test('a call on an enum type is a TypeError for a value that is not an enumerator', () => {
  expectThrown('enum Count { Zero, One, Two } Count(9);');
  expectThrown('enum Code { Ok = 200, NotFound = 404 } Code(1);');
});

// -- typeof is unchanged -------------------------------------------------------
test('typeof a Type Object is object even though it is callable', () => {
  expect(evaluated('typeof uint8;')).toBe('object');
  expect(evaluated('enum E { A, B } typeof E;')).toBe('object');
  expect(evaluated('type U = uint8; typeof U;')).toBe('object');
  // and the type object is still callable
  expect(evaluated('String(uint8(300));')).toBe('44');
});

// -- Interned identity is preserved --------------------------------------------
test('two mentions of one type are one object, callable or not', () => {
  expect(evaluated('type A = uint8; type B = uint8; String(A === B);')).toBe('true');
});

test('a callable type object still reports membership through instanceof', () => {
  expect(evaluated('let v = (5 := uint8); String(v instanceof uint8);')).toBe('true');
  expect(evaluated('let v = (5 := uint8); String(v instanceof uint16);')).toBe('false');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, there are no callable type objects', () => {
  // the type name resolves to nothing callable without the feature
  const c = runFlagOff('uint8(300);') as { Type: string };
  expect(c.Type).toBe('throw');
});
