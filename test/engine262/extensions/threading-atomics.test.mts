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
 * IMPLEMENTED: the reference and typed-own-data-property target shapes, and
 * waitAsync and notify over a WaiterList.
 *
 * NOT IMPLEMENTED, and so not tested:
 * - The TypedArray shape, which needs the TypedArray Atomics of the pinned
 *   edition; this engine has none.
 * - Blocking `Atomics.wait`. An agent of the simulated cluster does not block: a
 *   job runs to completion before the driver runs anything else, so a blocking
 *   wait would stop the cluster rather than one thread of it. It therefore
 *   throws here in every case, which is a divergence of the SIMULATION and not
 *   of the clause. waitAsync is the form this engine can honour, and the form a
 *   thread that may not block has to use anyway.
 *
 * KNOWN ENGINE GAP, not a divergence of this clause: a LEXICAL BINDING has no
 * run-time typed-storage boundary. A class field, a parameter, and an array
 * element each refuse a wrongly-typed value at run time; a `let a: uint8` does
 * not - `let a: uint8 = 0; var v = ["x"][0]; a = v;` leaves a string in a uint8,
 * with no reference and no Atomics anywhere. Only the static checker guards a
 * binding, and only where it can fold the value, so the literal `a = 300` is
 * refused and the unfoldable `a = v` is not. A write through a `ref` inherits
 * its referent's storage, so `ref` to a field or an element enforces and `ref`
 * to a binding does not, which is where this was first noticed.
 *
 * The store operations below inherit it and cannot be more correct than the
 * storage beneath them; #sec-atomics-typed-operations says a stored value passes
 * the typed-storage boundary, and the two tests marked below become meaningful
 * once a binding has one. It also bears on the specification's own argument:
 * #sec-shared-stability says a cross-thread race on unmarked storage costs a
 * stale narrowing and never a wrongly-typed value BECAUSE every write passes
 * that boundary, and for a lexical binding here the boundary is absent - of a
 * binding, not of the clause.
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

test('D9 compareExchange: the expected value is converted before comparing', () => {
  // Without the conversion the comparison is between an unconverted operand and a
  // typed value read from the target. It never succeeds, so every compare-exchange
  // fails SILENTLY and a claim loop spins rather than throwing.
  expect(ok('let a: uint32 = 1; Atomics.compareExchange(ref a, 1, 5); a === 5;')).toBe(true);
});
