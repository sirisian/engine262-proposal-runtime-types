import { test, expect } from 'vitest';
import {
  evaluated, ok, bool, expectThrownKind,
} from '../readme/harness.mts';

/**
 * Extension coverage - threading.md.
 *
 * Implemented as of E1 (see PLAN-threading.md): the `shared` MODIFIER at the type
 * level - `shared T` parses to a ~shared~ Type Record, interns, is invariant in
 * its target, reflects, and enforces its admission rule (value types only; not a
 * nested `shared`, not a `ref`). Each test names the decision it covers.
 *
 * NOT yet implemented, and so not tested here: threads themselves (D1's creation-
 * side promise reactions, D6's lifetime, D8's options bag), `Atomics` over typed
 * values, Lock/Condition/ThreadLocal, and Thread.parallelFor/parallelReduce. The
 * D5 narrowing regimes are half-covered - the `shared` half is a type-level fact
 * this build can assert; the unmarked half needs a second thread to be observable
 * at all, so it arrives with E2.
 */

// -- The shared modifier: Type Record, interning, relations --------------------
test('D5 shared: `shared T` resolves and reflects as a shared type over its target', () => {
  expect(evaluated('type S = shared uint32; Reflect.getReflection(S).kind;')).toBe('shared');
  expect(ok('type S = shared uint32; Reflect.getReflection(S).target === uint32;')).toBe(true);
});

test('D5 shared: shared types intern by their target', () => {
  expect(ok('type A = shared uint32; type B = shared uint32; A === B;')).toBe(true);
  expect(bool('type A = shared uint32; type B = shared int32; String(A === B);')).toBe(false);
});

test('D5 shared: `shared T` and `T` are distinct types', () => {
  // The modifier is not observable in the VALUE, but it is a distinct TYPE:
  // it decides placement and what a checker may assume of the slot.
  expect(bool('type A = shared uint32; String(A === uint32);')).toBe(false);
});

test('D5 shared: a shared type is invariant in its target', () => {
  expect(ok('type A = shared uint32; type B = shared uint32; Reflect.isAssignable(A, B);')).toBe(true);
  expect(bool('type A = shared uint32; type B = shared int32; String(Reflect.isAssignable(A, B));')).toBe(false);
  expect(bool('type A = shared float64; type B = shared float32; String(Reflect.isAssignable(A, B));')).toBe(false);
});

// -- The admission rule --------------------------------------------------------
test('D5 shared: admits the value types', () => {
  expect(evaluated('type S = shared float64; Reflect.getReflection(S).kind;')).toBe('shared');
  expect(evaluated('type S = shared boolean; Reflect.getReflection(S).kind;')).toBe('shared');
  expect(evaluated('type S = shared [4].<uint8>; Reflect.getReflection(S).kind;')).toBe('shared');
});

// The three refusals are catchable TypeErrors raised where the type expression
// is evaluated, which is the shape the existing type-expression errors take (the
// `keyof` of a type with no keys is the nearest neighbour). Whether some of these
// belong in the checking pass instead is open; matching the established pattern is
// what this phase does.
test('D5 shared: a non-value type is refused', () => {
  // An object is ALREADY shared - one heap - so the modifier would claim of it
  // nothing that is not already true, and `shared Map` would falsely suggest a
  // concurrent map rather than the ordinary one under a Lock.
  expectThrownKind('type S = shared string;', 'TypeError');
  expectThrownKind('type S = shared any;', 'TypeError');
  expectThrownKind('type S = shared { a: uint8 };', 'TypeError');
  // A `[].<T>` has no layout as a type: its size is a property of the value.
  expectThrownKind('type S = shared [].<uint8>;', 'TypeError');
});

test('D5 shared: nested `shared` is refused', () => {
  expectThrownKind('type S = shared shared uint32;', 'TypeError');
});

test('D5 shared: `shared ref T` is refused', () => {
  // A reference denotes a LOCATION, not a value, and a location is already
  // reachable from wherever the thread holding it can reach.
  expectThrownKind('type S = shared ref uint32;', 'TypeError');
});

// -- The value is a value of the target ----------------------------------------
test('D5 shared: publication in, value out - membership is membership in the target', () => {
  // "A value of type T is assignable to storage of type `shared T` ... and a read
  // of that storage yields a value of T." So the modifier is not observable in
  // the value, in either direction.
  expect(ok('let a: shared uint32 = 5; a === 5;')).toBe(true);
  expect(ok('type S = shared uint32; Reflect.isAssignable(uint32, S);')).toBe(true);
});

test('D5 shared: shared storage holds its declared type across a write', () => {
  expect(ok('let a: shared uint32 = 0; a = 7; a === 7;')).toBe(true);
});
