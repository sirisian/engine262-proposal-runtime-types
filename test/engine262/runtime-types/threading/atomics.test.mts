import { test, expect } from 'vitest';
import { evaluated, ok, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-threading-atomics (Atomics on Typed Values), with
 * #sec-atomics-reference-arguments, #sec-validateatomictarget,
 * #sec-atomics-typed-operations, #sec-atomics-float-arithmetic,
 * #sec-atomics-compare-exchange-predicate and #sec-atomics-typed-wait.
 *
 * Beyond a TypedArray, an `Atomics` operation takes two further targets: a typed
 * binding reached through a `ref` argument, and a typed own data property named by
 * an object and a key. These tests check the surface those clauses specify - which
 * targets are admitted, which types each operation restricts itself to, and the two
 * properties that make SameValueZero the comparison for compareExchange (NaN matches
 * NaN, and -0 matches 0).
 *
 * WHAT THESE TESTS CANNOT SHOW. In this engine a job runs to completion before any
 * other agent runs, so every operation is trivially atomic and the seq-cst ordering
 * costs nothing. Nothing below demonstrates atomicity, and nothing could: a
 * simulation with no interleaving beneath a job boundary has no race to exclude.
 * Two parts of the clauses are out of reach:
 * - The TypedArray target of the pinned edition, which this engine does not provide.
 * - Blocking `Atomics.wait`. An agent of the simulated cluster does not block: a
 *   blocking wait would stop the cluster rather than one thread of it, so it throws
 *   here in every case. That is a divergence of the simulation and not of the
 *   clause. `Atomics.waitAsync` is the form this engine can honour, and the form a
 *   thread that may not block has to use anyway.
 */

// -- The reference target shape -------------------------------------------------
test('Atomics: add operates on a typed binding through a reference', () => {
  // The clause's motivating case (#sec-threading-atomics): a binding updated
  // atomically, with no byte buffer arranged for it first.
  expect(evaluated('let a: uint32 = 5; Atomics.add(ref a, 3); String(a);')).toBe('8');
});

test('Atomics: load, store, and exchange reach the binding', () => {
  expect(evaluated('let a: uint32 = 7; String(Atomics.load(ref a));')).toBe('7');
  expect(evaluated('let a: uint32 = 0; Atomics.store(ref a, 9); String(a);')).toBe('9');
  // exchange returns the OLD value and leaves the new one.
  expect(evaluated('let a: uint32 = 1; var old = Atomics.exchange(ref a, 2); String(old) + "/" + String(a);')).toBe('1/2');
});

test('Atomics: a non-reference first argument is refused', () => {
  // The operation is about the BINDING. Its value is a copy, and operating on a
  // copy is not the operation the program asked for.
  expectThrownKind('let a: uint32 = 1; Atomics.add(a, 1);', 'TypeError');
});

test('the shared modifier is not consulted', () => {
  // Marked and unmarked storage are equally valid targets. Requiring the marker
  // would buy no invariant, unmarked storage being reachable from another thread
  // regardless, and would fracture generic code taking `ref uint32`.
  expect(evaluated('let a: shared uint32 = 5; Atomics.add(ref a, 3); String(a);')).toBe('8');
  expect(evaluated('let a: uint32 = 5; Atomics.add(ref a, 3); String(a);')).toBe('8');
});

// -- Type restrictions ----------------------------------------------------------
test('Atomics: the bitwise operations are integer-only', () => {
  // "a bitwise operation on a floating-point value has no meaning the program
  // intended".
  expect(evaluated('let a: uint8 = 0b1100; Atomics.and(ref a, 0b1010); String(a);')).toBe('8');
  expectThrownKind('let f: float64 = 1.5; Atomics.and(ref f, 1);', 'TypeError');
  expectThrownKind('let f: float64 = 1.5; Atomics.or(ref f, 1);', 'TypeError');
  expectThrownKind('let f: float64 = 1.5; Atomics.xor(ref f, 1);', 'TypeError');
});

test('Atomics: add and sub take the floats as well as the integers', () => {
  expect(evaluated('let f: float64 = 1.5; Atomics.add(ref f, 2.25); String(f);')).toBe('3.75');
  expect(evaluated('let f: float64 = 3.5; Atomics.sub(ref f, 1.25); String(f);')).toBe('2.25');
});

test('Atomics: a target that is not a value type is refused', () => {
  expectThrownKind('let s = "x"; Atomics.add(ref s, 1);', 'TypeError');
  expectThrownKind('let o = {}; Atomics.add(ref o, 1);', 'TypeError');
});

// -- compareExchange ------------------------------------------------------------
test('Atomics: compareExchange replaces on a match and leaves the slot otherwise', () => {
  expect(evaluated('let a: uint32 = 1; Atomics.compareExchange(ref a, 1, 5); String(a);')).toBe('5');
  expect(evaluated('let a: uint32 = 1; Atomics.compareExchange(ref a, 2, 5); String(a);')).toBe('1');
  // It returns the value read, matched or not, which is what a claim loop tests.
  expect(evaluated('let a: uint32 = 1; String(Atomics.compareExchange(ref a, 2, 5));')).toBe('1');
});

test('compareExchange: NaN matches NaN, so a claim loop terminates', () => {
  // The property the whole choice of predicate turns on. Under strict equality a
  // loop whose observed value is NaN retries against the very value it read,
  // forever, NaN not being strictly equal to itself.
  expect(evaluated('let f: float64 = NaN; Atomics.compareExchange(ref f, NaN, 1.0); String(f);')).toBe('1');
});

test('compareExchange: -0 matches 0, the forgiving direction for a sentinel', () => {
  // SameValue would distinguish them, so a computed -0 would fail to match a 0
  // sentinel and a claim loop would intermittently refuse a slot that is
  // arithmetically zero.
  expect(evaluated('let f: float64 = -0; Atomics.compareExchange(ref f, 0, 7.0); String(f);')).toBe('7');
});

test('Atomics: an operation preserves the target\'s type, so a second one works', () => {
  // An operation stores its result through the typed-storage boundary
  // (#sec-atomics-typed-operations), so the target keeps its declared type and a
  // second operation on it is still valid. A store that left a plain Number in the
  // slot would leave a target Atomics no longer operates on: the first add would
  // succeed and the second would throw "number is not a value type Atomics
  // operates on".
  expect(ok('let a: uint32 = 0; Atomics.add(ref a, 5); Reflect.typeOf(a) === uint32;')).toBe(true);
  expect(evaluated('let a: uint32 = 0; Atomics.add(ref a, 5); Atomics.add(ref a, 5); String(a);')).toBe('10');
  expect(evaluated('let a: uint32 = 0; Atomics.store(ref a, 3); Atomics.add(ref a, 1); String(a);')).toBe('4');
  expect(evaluated('let a: uint32 = 0; Atomics.exchange(ref a, 3); Atomics.add(ref a, 1); String(a);')).toBe('4');
  expect(evaluated('let a: uint32 = 0; Atomics.compareExchange(ref a, 0, 3); Atomics.add(ref a, 1); String(a);')).toBe('4');
  expect(evaluated('let a: uint8 = 0b1100; Atomics.and(ref a, 0b1010); Atomics.or(ref a, 0b0001); String(a);')).toBe('9');
});

test('Atomics: repeated operations on a shared binding behave the same', () => {
  // The modifier is not consulted (#sec-validateatomictarget), so marked and
  // unmarked storage accumulate identically over repeated operations.
  expect(evaluated('let a: shared uint32 = 0; Atomics.add(ref a, 5); Atomics.add(ref a, 5); String(a);')).toBe('10');
});

test('Atomics: a typed property keeps its type across operations too', () => {
  expect(evaluated('class C { n: uint32 = 0; } var c = new C(); Atomics.add(c, "n", 5); Atomics.add(c, "n", 5); String(c.n);')).toBe('10');
});

// -- The typed own data property shape -----------------------------------------
test('Atomics: a typed own data property is a target', () => {
  // `Atomics.add(obj, 'count', v)`: the key takes argument position 1, so the
  // operand follows at 2.
  expect(evaluated('class C { count: uint32 = 0; } var c = new C(); Atomics.add(c, "count", 5); String(c.count);')).toBe('5');
  expect(evaluated('class C { n: uint32 = 1; } var c = new C(); Atomics.compareExchange(c, "n", 1, 9); String(c.n);')).toBe('9');
});

test('Atomics: an untyped property is refused', () => {
  // "an `any`-typed slot has no width for an operation to be atomic over".
  expectThrownKind('var o = { x: 1 }; Atomics.add(o, "x", 1);', 'TypeError');
  expectThrownKind('var o = {}; Atomics.add(o, "nope", 1);', 'TypeError');
});

// -- Waiting --------------------------------------------------------------------
test('Atomics: waitAsync resolves not-equal when the value already differs', () => {
  expect(evaluated('let a: shared int32 = 5; String(typeof Atomics.waitAsync(ref a, 0).then);')).toBe('function');
});

test('Atomics: waitAsync and notify are integer-only', () => {
  expectThrownKind('let f: float64 = 0; Atomics.waitAsync(ref f, 0);', 'TypeError');
  expectThrownKind('let f: float64 = 0; Atomics.notify(ref f, 1);', 'TypeError');
});

test('Atomics: blocking wait throws in this engine', () => {
  // The simulation divergence recorded in the file header, not a rule of the
  // clause: an agent here does not block.
  expectThrownKind('let a: shared int32 = 0; Atomics.wait(ref a, 0);', 'TypeError');
});

test('compareExchange: the expected value is converted before comparing', () => {
  // Without the conversion the comparison is between an unconverted operand and a
  // typed value read from the target. It never succeeds, so every compare-exchange
  // fails SILENTLY and a claim loop spins rather than throwing.
  expect(ok('let a: uint32 = 1; Atomics.compareExchange(ref a, 1, 5); a === 5;')).toBe(true);
});
