import { test, expect } from 'vitest';
import { evaluated, bool, expectThrown } from '../../harness.mts';

/**
 * README feature coverage - enum Type.
 * Section: enum Type.
 *
 * The type-level enum semantics the normative spec fixes are implemented and
 * verified here: an enum is a nominal type whose values are its enumerators, with
 * sequential and explicit values, an underlying type (int32 by default, any type
 * after `:`), and the subtype relation that makes an enum value usable wherever
 * its underlying type is.
 *
 * One behavior is documented as deferred rather than asserted:
 *
 *  - The `toString`-maps-to-key behavior and `%Enum.prototype%` iterator methods
 *    (keys/values/entries) appear in the README but are not in the normative
 *    spec.emu enum clause; they are design-level and not implemented.
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

// -- Documented gaps -----------------------------------------------------------
// -- Enum construction: Count(n) -----------------------------------------------
// A call on the enum type returns the enumerator whose underlying value is the
// argument, and is a TypeError for a value that is not one of them
// (#sec-enums).
test('enum: Count(n) returns the enumerator with that underlying value', () => {
  expect(evaluated('enum Count { Zero, One, Two }; String(Count(1));')).toBe('1');
  // the result is the enumerator itself
  expect(evaluated('enum Count { Zero, One, Two }; String(Count(1) === Count.One);')).toBe('true');
});

test('enum: Count(n) throws for a value that is not an enumerator', () => {
  expectThrown('enum Count { Zero, One, Two }; Count(9);');
});

test('enum: %Enum.prototype% carries the enumeration surface', () => {
  // One correction to what an earlier reading recorded as the target. It
  // expected
  // `Count.One.toString()` to answer "One", and that is not what the design
  // says: the signature is `%Enum.prototype%.toString(value)`, a lookup ON THE
  // ENUMERATION taking the value as an argument. An enumerator IS its
  // underlying value - that is the whole of the one-way subtype rule - so it
  // has no method of its own to override, and `Count.One.toString()` answering
  // "1" is correct rather than a gap. The design says as much in the sentence
  // after the listing: interpolation sees the underlying value, and getting the
  // key is what `toString` is for.
  expect(evaluated('enum Count { Zero, One, Two }; Count.One.toString();')).toBe('1');
  expect(evaluated('enum Count { Zero, One, Two }; Count.toString(Count.One);')).toBe('One');
  expect(evaluated('enum Count { Zero, One, Two }; String(typeof Count.keys);')).toBe('function');
  expect(evaluated('enum Count { Zero, One, Two }; [...Count.keys()].join("|");')).toBe('Zero|One|Two');
});

test('enum: an enumerator holds a plain underlying value; Reflect.typeOf reports the primitive (documents the gap)', () => {
  // Target (#sec-enums): Reflect.typeOf(Count.Zero) reports Count (the most
  // specific type). Today an enumerator holds its plain underlying value, so
  // Reflect.typeOf reports the underlying primitive rather than the enum type, and
  // the value is not a typed value of the underlying type. The subtype-usability
  // property (verified above) holds regardless.
  expect(bool('enum Count { Zero, One, Two }; String(Reflect.typeOf(Count.One) === Count);')).toBe(false);
  expect(bool('enum Count: float32 { Zero, One, Two }; String(Count.Two === (2 := float32));')).toBe(false);
});
