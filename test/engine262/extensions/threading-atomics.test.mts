import { test, expect } from 'vitest';
import { evaluated, ok, expectThrownKind } from '../readme/harness.mts';

/**
 * Extension coverage - threading.md, #sec-threading-atomics.
 *
 * WHAT THESE TESTS ARE FOR. In this engine a job runs to completion before any
 * other agent runs, so every operation here is trivially atomic and the seq-cst
 * ordering costs nothing. Nothing below demonstrates atomicity and nothing below
 * could: a simulation with no interleaving beneath a job boundary has no race to
 * exclude. What is checked is the SURFACE the clause specifies, which a real
 * implementation has to get right anyway - which targets are admitted, which
 * types each operation restricts itself to, and the two properties that made
 * SameValueZero the comparison for compareExchange.
 *
 * IMPLEMENTED: the reference target shape, `Atomics.<op>(ref binding, ...)`.
 *
 * NOT YET IMPLEMENTED, and so not tested:
 * - The typed own data property shape, `Atomics.add(obj, 'count', v)`, which
 *   needs the declared type of a typed property at runtime.
 * - The TypedArray shape, which needs the TypedArray Atomics of the pinned
 *   edition; this engine has none.
 * - wait, waitAsync, and notify, which need a WaiterList and agent suspension.
 *   Those also carry the last cancellation checkpoints of #sec-thread-cancellation.
 *
 * KNOWN ENGINE GAP, not a divergence of this clause: a write THROUGH A REFERENCE
 * does not enforce the referent's declared type. `let a: uint8 = 0; let ref b =
 * a; b = 300;` leaves 300 in a uint8, with no Atomics involved, so the store
 * operations below inherit it and cannot be more correct than the reference
 * machinery beneath them. #sec-atomics-typed-operations says a stored value
 * passes the typed-storage boundary; when the reference write path enforces it,
 * these operations will too, and the two tests marked below become meaningful.
 */

// -- The reference target shape -------------------------------------------------
test('Atomics: add operates on a typed binding through a reference', () => {
  // The design's opening example: a binding, updated atomically, with no byte
  // buffer arranged for it first.
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

test('D10: the shared modifier is not consulted', () => {
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

test('D9 compareExchange: NaN matches NaN, so a claim loop terminates', () => {
  // The property the whole choice of predicate turns on. Under strict equality a
  // loop whose observed value is NaN retries against the very value it read,
  // forever, NaN not being strictly equal to itself.
  expect(evaluated('let f: float64 = NaN; Atomics.compareExchange(ref f, NaN, 1.0); String(f);')).toBe('1');
});

test('D9 compareExchange: -0 matches 0, the forgiving direction for a sentinel', () => {
  // SameValue would distinguish them, so a computed -0 would fail to match a 0
  // sentinel and a claim loop would intermittently refuse a slot that is
  // arithmetically zero.
  expect(evaluated('let f: float64 = -0; Atomics.compareExchange(ref f, 0, 7.0); String(f);')).toBe('7');
});

test('D9 compareExchange: the expected value is converted before comparing', () => {
  // Without the conversion the comparison is between an unconverted operand and a
  // typed value read from the target. It never succeeds, so every compare-exchange
  // fails SILENTLY and a claim loop spins rather than throwing.
  expect(ok('let a: uint32 = 1; Atomics.compareExchange(ref a, 1, 5); a === 5;')).toBe(true);
});
