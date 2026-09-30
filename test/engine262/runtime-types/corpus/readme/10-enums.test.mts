import { test, expect } from 'vitest';
import { evaluated, bool, expectThrown } from '../../harness.mts';

/**
 * Fixture: the README section enum Type, in the ecmascript-types repository.
 *
 * The type-level enum semantics the specification fixes (#sec-enums) are verified here: an enum is a nominal type
 * whose values are its enumerators, with sequential and explicit values, an underlying type (int32 by default, any
 * type after `:`), and the subtype relation that makes an enum value usable wherever its underlying type is.
 * `%Enum.prototype%` and its `toString(value)`, `keys`, `values` and `entries` are specified too and are covered
 * in classes/enum-exhaustiveness.test.mts.
 */

// -- Sequential and explicit values --------------------------------------------
// The first enumerator with no initializer takes 0; a later one takes the prefix
// increment of the previous. An explicit initializer sets a value and the
// sequence continues from it.
test('enum: enumerators are numbered sequentially from 0', () => {
  expect(evaluated('enum Count { Zero, One, Two }; String(Count.Zero);')).toBe('0');
  expect(evaluated('enum Count { Zero, One, Two }; String(Count.One);')).toBe('1');
  expect(evaluated('enum Count { Zero, One, Two }; String(Count.Two);')).toBe('2');
});

test('enum: an explicit initializer sets a value and the sequence continues', () => {
  expect(evaluated('enum Count { One = 1, Two, Three }; String(Count.Two);')).toBe('2');
  expect(evaluated('enum Count { One = 1, Two, Three }; String(Count.Three);')).toBe('3');
});

// -- Underlying type -----------------------------------------------------------
// An enum declared without `: Type` has underlying type int32; a `: Type`
// annotation sets it.
test('enum: an underlying type annotation is accepted', () => {
  expect(evaluated('enum Count: float32 { Zero, One, Two }; String(Count.Two);')).toBe('2');
  // the enumerator is usable as its underlying value (a plain number here)
  expect(bool('enum Count: float32 { Zero, One, Two }; String(Count.Two === 2);')).toBe(true);
});

// -- Enum is a subtype of its underlying type ----------------------------------
// A value of an enum type is usable wherever the underlying type is required, so
// arithmetic, indexing, and comparison need no cast.
test('enum: an enumerator is usable as its underlying value with no cast', () => {
  // subtype relation: the enumerator equals its underlying value directly
  expect(bool('enum Count { Zero, One, Two }; String(Count.One === 1);')).toBe(true);
  // arithmetic on enum values works without a cast
  expect(evaluated('enum Count { Zero, One, Two }; String(Count.One + Count.Two);')).toBe('3');
  // comparison without a cast
  expect(bool('enum Count { Zero, One, Two }; String(Count.Two > Count.One);')).toBe(true);
});

// -- Membership ----------------------------------------------------------------
test('enum: an enumerator is an instance of the enum type', () => {
  expect(evaluated('enum Count { Zero, One, Two }; String(Count.One instanceof Count);')).toBe('true');
});

// -- Enum is a static declaration ----------------------------------------------
// There is no expression form; an enum is a static declaration whose name joins
// the scope.
test('enum: the declaration binds a static enum object', () => {
  expect(evaluated('enum Count { Zero, One, Two }; typeof Count;')).toBe('object');
  // distinct enums are distinct types
  expect(bool('enum A { X }; enum B { X }; String(A === B);')).toBe(false);
});

// -- Enum construction: Count(n) -----------------------------------------------
// A call on the enum type returns the enumerator whose underlying value is the argument, and is a TypeError for a
// value that is not one of them (#sec-enums).
test('enum: Count(n) returns the enumerator with that underlying value', () => {
  expect(evaluated('enum Count { Zero, One, Two }; String(Count(1));')).toBe('1');
  // the result is the enumerator itself
  expect(evaluated('enum Count { Zero, One, Two }; String(Count(1) === Count.One);')).toBe('true');
});

test('enum: Count(n) throws for a value that is not an enumerator', () => {
  expectThrown('enum Count { Zero, One, Two }; Count(9);');
});

test('enum: %Enum.prototype% carries the enumeration surface', () => {
  // `Count.One.toString()` answers "1": the signature is `%Enum.prototype%.toString(value)`, a lookup ON THE
  // ENUMERATION taking the value as an argument (#sec-enums). An enumerator IS its underlying value - that is the
  // whole of the one-way subtype rule - so it has no method of its own to override. Interpolation sees the
  // underlying value, and getting the key is what `toString` on the enumeration is for.
  expect(evaluated('enum Count { Zero, One, Two }; Count.One.toString();')).toBe('1');
  expect(evaluated('enum Count { Zero, One, Two }; Count.toString(Count.One);')).toBe('One');
  expect(evaluated('enum Count { Zero, One, Two }; String(typeof Count.keys);')).toBe('function');
  expect(evaluated('enum Count { Zero, One, Two }; [...Count.keys()].join("|");')).toBe('Zero|One|Two');
});

test('enum: an enumerator IS a value of its enum, and of the underlying type', () => {
  // #sec-enums: "Reflect.typeOf(Count.Zero) reports Count, by the rule that a
  // value's runtime type is the most specific type of which it is a value. This
  // does not make the enumerator anything other than a value the underlying type
  // also accepts: membership in int32 follows from Count being a subtype of it."
  // So both hold at once, and the subtype-usability property above holds with
  // them.
  expect(bool('enum Count { Zero, One, Two }; String(Reflect.typeOf(Count.One) === Count);')).toBe(true);
  expect(bool('enum Count { Zero, One, Two }; String(Count.One is int32);')).toBe(true);
  // And the comparison against a value of the underlying type answers by value,
  // which is the subtype rule at an equality position.
  expect(bool('enum Count: float32 { Zero, One, Two }; String(Count.Two === (2 := float32));')).toBe(true);
});
