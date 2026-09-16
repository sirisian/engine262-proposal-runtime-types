import { test, expect } from 'vitest';
import {
  evaluated, ok, bool, expectThrown, expectStaticTypeError,
} from '../harness.mts';

/**
 * Spec: #sec-threading-shared-modifier (The Shared Modifier). Design:
 * threading.md.
 *
 * The `shared` MODIFIER at the type level: `shared T` parses to a ~shared~ Type
 * Record, interns, is invariant in its target, reflects, and enforces its
 * admission rule (value types only; not a nested `shared`, not a `ref`).
 *
 * The narrowing regimes are half-covered here - the `shared` half is a
 * type-level fact this file can assert; the unmarked half needs a second thread
 * to be observable at all, and lives in execution.test.mts.
 */

// -- The shared modifier: Type Record, interning, relations --------------------
test('shared: `shared T` resolves and reflects as a shared type over its target', () => {
  expect(evaluated('type S = shared uint32; Reflect.getReflection(S).kind;')).toBe('shared');
  expect(ok('type S = shared uint32; Reflect.getReflection(S).target === uint32;')).toBe(true);
});

test('shared: shared types intern by their target', () => {
  expect(ok('type A = shared uint32; type B = shared uint32; A === B;')).toBe(true);
  expect(bool('type A = shared uint32; type B = shared int32; String(A === B);')).toBe(false);
});

test('shared: `shared T` and `T` are distinct types', () => {
  // The modifier is not observable in the VALUE, but it is a distinct TYPE:
  // it decides placement and what a checker may assume of the slot.
  expect(bool('type A = shared uint32; String(A === uint32);')).toBe(false);
});

test('shared: a shared type is invariant in its target', () => {
  expect(ok('type A = shared uint32; type B = shared uint32; Reflect.isAssignable(A, B);')).toBe(true);
  expect(bool('type A = shared uint32; type B = shared int32; String(Reflect.isAssignable(A, B));')).toBe(false);
  expect(bool('type A = shared float64; type B = shared float32; String(Reflect.isAssignable(A, B));')).toBe(false);
});

// -- The admission rule --------------------------------------------------------
test('shared: admits the value types', () => {
  expect(evaluated('type S = shared float64; Reflect.getReflection(S).kind;')).toBe('shared');
  expect(evaluated('type S = shared boolean; Reflect.getReflection(S).kind;')).toBe('shared');
  expect(evaluated('type S = shared [4].<uint8>; Reflect.getReflection(S).kind;')).toBe('shared');
});

// The three refusals are EARLY errors. #sec-shared-types states each as "it is
// a type error if", and #sec-type-errors fixes what that phrase means: "This
// specification realizes such a violation as an Early Error, and reserves a
// thrown *TypeError* for" a check that "cannot be resolved statically, because
// a value reaches a typed position only as the ~any~ type". A written `shared
// string` is resolved statically by construction - the operand is right there
// in the source - so it is the checking pass that refuses it, before the body
// runs. These assertions used to expect a catchable TypeError raised where the
// type expression is evaluated, with a note that whether they belonged in the
// checking pass was open; the pass covers them now, and the specification says
// it should. The evaluation-time refusal still stands behind it, for the
// deferred case the clause reserves the thrown form for.
test('shared: a non-value type is refused', () => {
  // An object is ALREADY shared - one heap - so the modifier would claim of it
  // nothing that is not already true, and `shared Map` would falsely suggest a
  // concurrent map rather than the ordinary one under a Lock.
  expectStaticTypeError('type S = shared string;');
  expectStaticTypeError('type S = shared any;');
  expectStaticTypeError('type S = shared { a: uint8 };');
  // A `[].<T>` has no layout as a type: its size is a property of the value.
  expectStaticTypeError('type S = shared [].<uint8>;');
});

test('shared: nested `shared` is refused', () => {
  expectStaticTypeError('type S = shared shared uint32;');
});

test('shared: `shared ref T` is refused', () => {
  // A reference denotes a LOCATION, not a value, and a location is already
  // reachable from wherever the thread holding it can reach.
  expectStaticTypeError('type S = shared ref uint32;');
});

// -- The value is a value of the target ----------------------------------------
test('shared: publication in, value out - membership is membership in the target', () => {
  // "A value of type T is assignable to storage of type `shared T` ... and a read
  // of that storage yields a value of T." So the modifier is not observable in
  // the value, in either direction.
  expect(ok('let a: shared uint32 = 5; a === 5;')).toBe(true);
  expect(ok('type S = shared uint32; Reflect.isAssignable(uint32, S);')).toBe(true);
});

test('shared: shared storage holds its declared type across a write', () => {
  expect(ok('let a: shared uint32 = 0; a = 7; a === 7;')).toBe(true);
});

// -- Threads, and what the shared modifier does not reach ------------------------

test('threading: shared class does not parse (documents the gap)', () => {
  // Target (threading.md): `shared class` places instances in the shared heap.
  expectThrown('shared class A { x: uint8; } typeof A;');
});

test('threading: Thread carries the two range operations', () => {
  // WAS a gap pin. #sec-threading-parallel-iteration is implemented, so the
  // namespace exists and both operations are on it.
  expect(evaluated('typeof Thread;')).toBe('object');
  expect(evaluated('typeof Thread.parallelFor + "/" + typeof Thread.parallelReduce;')).toBe('function/function');
});

// -- decorators: the @ syntax under the feature --------------------------------
