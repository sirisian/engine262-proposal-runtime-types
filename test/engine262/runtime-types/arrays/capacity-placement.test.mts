import { test, expect } from 'vitest';
import {
  evaluated, expectThrownKind, expectStaticTypeError, bool,
} from '../harness.mts';

/**
 * `capacity`, `reserve`, and `withCapacity` belong to a TYPED array. The spec
 * scopes them to `[].<T>` in one sentence (#sec-reference-liveness):
 *
 *   "A growable `[].<T>` ... has a backing allocation whose capacity is
 *    distinct from its length, reported by `capacity` and grown by `reserve`"
 *
 * and README "Capacity" writes every example on `[].<T>`. Nothing in either
 * document puts them on an untyped array.
 *
 * The engine installed both on %Array.prototype% and guarded them at CALL time
 * on [[TypedElement]], which is a different thing: it makes them members of
 * every array that exist only to throw, and it left the FIXED-extent case
 * unguarded entirely, because the guard asked the wrong question.
 *
 * These tests state the placement and the fixed-extent semantics directly, so
 * a regression in either shows up as a failure here rather than as a snapshot
 * diff in the inspector suite, which is where it surfaced the first time.
 *
 * TWO GROUPS, AND THEY ARE NOT EQUALLY SETTLED:
 *
 *   - The PLACEMENT group below encodes a decision that is still open. It is
 *     written for the reading in which the members do not exist on an untyped
 *     array at all. #sec-array-and-tuple-types currently says a typed array
 *     "is an Array ... and the methods of `Array.prototype` apply", which does
 *     not obviously leave room for a distinct prototype, so this reading needs
 *     spec text before it is true. If the other reading is taken - the members
 *     stay on %Array.prototype% and refuse a receiver with no element type -
 *     the two tests marked PLACEMENT DECISION invert and the rest stand.
 *
 *   - The FIXED-EXTENT group is not open. A fixed `[N].<T>` cannot grow, and
 *     references.md states that it never moves, so a `reserve` past its extent
 *     is a bug under either placement.
 */

// -- element access is typed --------------------------------------------------

test('reading an element has the element type, not any', () => {
  // A computed access fell through to ~any~, so indexing a typed array was
  // untyped: `let b: boolean = a[0]` type-checked on a `[4].<uint32>`. Element
  // WRITES were checked all along, and that asymmetry is what hid it - the
  // half that worked read as though the whole thing did.
  expectStaticTypeError('let a: [4].<uint32> = [1, 2, 3, 4]; let s: string = a[0];');
  expectStaticTypeError('let a: [4].<uint32> = [1, 2, 3, 4]; let b: boolean = a[0];');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; let n: uint32 = a[0]; String(n);')).toBe('1');
});

test('a growable array types its elements the same way', () => {
  expectStaticTypeError('let a: [].<uint32> = [1]; let s: string = a[0];');
  expect(evaluated('let a: [].<uint32> = [1]; let n: uint32 = a[0]; String(n);')).toBe('1');
});

test('element writes stay checked', () => {
  // The half that already worked, kept as a guard: typing the read must not
  // disturb the store check.
  expectStaticTypeError('let a: [4].<uint32> = [1, 2, 3, 4]; a[0] = "x";');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; a[0] = 9; String(a[0]);')).toBe('9');
});

test('an untyped array is unaffected', () => {
  // Reached through a receiver whose type is known; an unannotated binding is
  // ~any~, so existing code sees no change.
  expect(evaluated('let a = [1, 2]; let s: string = a[0]; String(s);')).toBe('1');
});

// -- a literal index against a fixed extent ----------------------------------

test('a literal index outside a fixed extent is refused before the program runs', () => {
  // The extent is a compile-time constant, so the index is decidable here. It
  // was a run-time RangeError, which is the wrong moment for a mistake that
  // was visible in the source.
  //
  // Checked in an UNEXECUTED body: at the top level the run-time RangeError
  // would fire too, and the two are indistinguishable from the outside.
  expectStaticTypeError('let a: [4].<uint32> = [1, 2, 3, 4]; function f() { return a[10]; }');
  expectStaticTypeError('let a: [4].<uint32> = [1, 2, 3, 4]; function f() { return a[4]; }');
});

test('an index within a fixed extent is accepted', () => {
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; function f() { return a[3]; } String(f());')).toBe('4');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; function f() { return a[0]; } String(f());')).toBe('1');
});

test('a computed index keeps the run-time check', () => {
  // Only a literal is decided statically. Everything else keeps the run-time
  // bound as its backstop, which is what the elision above is safe against.
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; let i = 2; String(a[i]);')).toBe('3');
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4]; let i = 10; a[i];', 'RangeError');
});

test('a growable array does not get the static bound', () => {
  // No extent, nothing to decide: a literal index is checked at run time.
  expectThrownKind('let a: [].<uint32> = [1]; a[10];', 'RangeError');
});

// -- shrinkToFit: the only thing that releases capacity ----------------------

test('nothing but shrinkToFit releases capacity', () => {
  // The README claimed a `length =` released it. It does not: shortening an
  // array changes the length and leaves the allocation where it is, which is
  // the same fact the liveness rules state when they say a shrink moves
  // nothing. Before `shrinkToFit` there was no way to give capacity back.
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; a.reserve(64); a.length = 0; String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; a.reserve(64); a.pop(); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; a.reserve(64); a.shrinkToFit(); String(a.capacity);')).toBe('3');
});

test('shrinkToFit keeps the length and the elements', () => {
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; a.reserve(64); a.shrinkToFit(); String(a.length);')).toBe('3');
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; a.reserve(64); a.shrinkToFit(); a.join(",");')).toBe('1,2,3');
  // and the array is still growable afterwards - it released an allocation,
  // not the ability to have one
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; a.reserve(64); a.shrinkToFit(); a.push(4); String(a.length);')).toBe('4');
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); a.shrinkToFit(); String(a.capacity);')).toBe('0');
});

test('releasing room the array does not have is a no-op', () => {
  // The mirror of `reserve`: a caller need not know the capacity to ask.
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; a.shrinkToFit(); String(a.capacity);')).toBe('3');
  // A fixed extent needs no case of its own - its capacity IS its extent and
  // its length is its extent, so it is always already at fit.
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; a.shrinkToFit(); String(a.capacity);')).toBe('4');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; a.shrinkToFit(); String(a.length);')).toBe('4');
});

test('a release relocates, so it invalidates references that a pop would not', () => {
  // This is the distinction worth pinning. Removing an element invalidates the
  // reference to the element REMOVED and leaves the rest readable, because
  // that storage has not moved. Releasing capacity moves all of it, so every
  // live reference goes, including ones to elements that remain.
  expectThrownKind('let a: [].<uint32> = [1, 2, 3]; a.reserve(64); let ref b = a[0]; a.shrinkToFit(); b;', 'TypeError');
  // and the no-op path releases nothing, so it moves nothing and the borrow
  // survives - the generation must not be bumped where no allocation changed
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; let ref b = a[0]; a.shrinkToFit(); String(b);')).toBe('1');
});

test('shrinkToFit is available only on an array with an element type', () => {
  expectThrownKind('let a = [1]; a.shrinkToFit();', 'TypeError');
  expect(evaluated('let a: [].<uint32> = [1]; String(typeof a.shrinkToFit());')).toBe('undefined');
});

// -- the index type is one type, so both counts read at it -------------------

test('capacity reads at the index type, as length does', () => {
  // `length` reads as a typed value and `capacity` read as a plain Number, so
  // the two counts of one array disagreed while sharing a static type. A single
  // index type is the claim that they ARE one type, and two representations
  // contradict it.
  //
  // The typed `length` is the settled side: check-insertion.test.mts pins it,
  // and #sec-arithmetic-never-promotes is why it does not mix with an untyped
  // operand. So `capacity` moves to match `length`, not the reverse.
  expect(bool('let a: [].<uint32> = [1]; String(a.capacity is uint64);')).toBe(true);
  expect(bool('let a: [].<uint32> = [1]; String(a.length is uint64);')).toBe(true);
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a.capacity is uint64);')).toBe(true);
});

test('the value a capacity reports is unchanged', () => {
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; String(a.capacity);')).toBe('4');
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(typeof a.capacity);')).toBe('number');
});

test('a capacity carries the same comparison rules a length does', () => {
  // #sec-arithmetic-never-promotes: a literal adopts the other operand's type,
  // so the comparison against a literal is true; a binding adopts nothing, so
  // the comparison against one is false. This is the pinned behaviour of
  // `length`, now true of `capacity` as well rather than only of one of them.
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a.capacity === 4);')).toBe(true);
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; let n = 4; String(a.capacity === n);')).toBe(false);
});

test('a loop over a capacity needs a typed counter, as one over a length does', () => {
  // The price of a typed count, applied consistently. This is STRICTER than
  // before - the same loop over `a.capacity` used to run - and it is the pinned
  // decision reaching a place it had not reached.
  expectThrownKind('let a: [].<uint32> = [1, 2, 3]; for (let i = 0; i < a.capacity; i++) { }', 'TypeError');
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; let n = 0;'
    + ' for (let i = (0 := uint64); i < a.capacity; i++) { n += 1; } String(n);')).toBe('3');
});

// -- the index type: capacity and reserve are typed, not `any` ---------------

test('capacity has the index type rather than any', () => {
  // `capacity` had no entry in the array member table at all, so a read fell
  // through to ~any~ and `let n: string = a.capacity` type-checked - a member
  // that silently defeats the checker, on a proposal whose subject is types.
  //
  // #index-type: one type describes every count an array reports or accepts,
  // so `capacity` carries whatever `length` carries. The invariant the design
  // states, that a capacity is at least a length, is unstateable otherwise.
  expectStaticTypeError('let a: [].<uint32> = [1]; let n: string = a.capacity;');
  expectStaticTypeError('let a: [].<uint32> = [1]; let b: boolean = a.capacity;');
  expect(evaluated('let a: [].<uint32> = [1]; let n: uint64 = a.capacity; String(n);')).toBe('1');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; let n: uint64 = a.capacity; String(n);')).toBe('4');
});

test('length keeps the same index type', () => {
  // The control for the above: whatever `capacity` gets, `length` already had,
  // and the two must not drift apart.
  expectStaticTypeError('let a: [].<uint32> = [1]; let s: string = a.length;');
  expect(evaluated('let a: [].<uint32> = [1]; let n: uint64 = a.length; String(n);')).toBe('1');
});

test('reserve takes the index type and answers nothing', () => {
  expectStaticTypeError('let a: [].<uint32> = []; a.reserve("4");');
  expectStaticTypeError('let a: [].<uint32> = []; a.reserve(true);');
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [].<uint32> = []; String(typeof a.reserve(8));')).toBe('undefined');
});

test('an untyped array is untouched by the index type', () => {
  // The typing is reached through an array RECEIVER whose type is known. An
  // unannotated binding is ~any~, so existing code sees no change.
  expect(evaluated('let a = [1, 2]; let s: string = a.length; String(s);')).toBe('2');
});

// -- the growable ceiling: reserve cannot buy unusable room -------------------

test('reserve past the maximum array length is refused', () => {
  // The ceiling is the Array limit, not the index type's range: an owned array
  // is an Array and cannot hold more. With the index type at `uint64` the
  // literal 2**32 FITS the parameter, so the refusal is no longer static - it
  // comes from the ceiling at run time instead. Same refusal, later moment, and
  // both spellings are pinned so a change to either shows up.
  expectThrownKind('let a: [].<uint32> = []; a.reserve(4294967296);', 'RangeError');
  expectThrownKind('let a: [].<uint32> = []; let n = 4294967296; a.reserve(n);', 'RangeError');
  expectThrownKind('let a: [].<uint32> = []; a.reserve(1099511627776);', 'RangeError');
  // and the ceiling itself is still reservable
  expect(evaluated('let a: [].<uint32> = []; a.reserve(4294967295); String(a.capacity);')).toBe('4294967295');
});
test('a computed reserve within the ceiling is unaffected', () => {
  // The control for the runtime half: the ceiling check must not catch a value
  // that merely arrived dynamically.
  expect(evaluated('let a: [].<uint32> = []; let n = 64; a.reserve(n); String(a.capacity);')).toBe('64');
});

test('reserve at the maximum array length is allowed', () => {
  // The ceiling is a valid length, so reserving exactly it is a request the
  // array could in principle satisfy. Off-by-one here would make the largest
  // legal array unbuildable.
  expect(evaluated('let a: [].<uint32> = []; a.reserve(4294967295); String(a.capacity);')).toBe('4294967295');
});

test('an ordinary reserve is unaffected by the ceiling', () => {
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [].<uint32> = [1, 2]; a.reserve(64); String(a.length) + "/" + String(a.capacity);')).toBe('2/64');
});

// -- array type arity ---------------------------------------------------------

test('an array type takes exactly one type argument', () => {
  // A second argument was read as the length type in an early draft of the
  // design and never wired to anything, so `[4].<uint8, uint64>` type-checked,
  // enforced `uint8` on elements, and yielded a plain `uint32` length with the
  // second argument DISCARDED. A three-argument form parsed too. Silently
  // ignoring them made a typo indistinguishable from a feature.
  // A STATIC rejection, not a catchable throw: the checker refuses the
  // annotation before evaluation, so a `try` around it cannot swallow it.
  expectStaticTypeError('let a: [4].<uint8, uint64> = [1, 2, 3, 4];');
  expectStaticTypeError('let a: [4].<uint8, uint64, uint32> = [1, 2, 3, 4];');
  expectStaticTypeError('let a: [].<uint32, uint64> = [];');
});

test('the one-argument and bare array forms still resolve', () => {
  // The guard must not catch the forms that were always correct.
  expect(evaluated('let a: [4].<uint8> = [1, 2, 3, 4]; String(a.length);')).toBe('4');
  expect(evaluated('let a: [].<uint32> = [1, 2]; String(a.length);')).toBe('2');
  expect(evaluated('let a: [] = [1, 2]; String(a.length);')).toBe('2');
});

// -- placement: an untyped array has no capacity surface ----------------------
// PLACEMENT DECISION: the two tests in this section assert the members are
// ABSENT from an untyped array. Invert them if the receiver-check reading wins.

test('an untyped array does not have the capacity members at all', () => {
  // Not "throws when called" - ABSENT. An untyped array has no allocation
  // distinct from its length, so there is nothing for these to report.
  expect(bool('let a = [1]; String("capacity" in a);')).toBe(false);
  expect(bool('let a = [1]; String("reserve" in a);')).toBe(false);
  expect(evaluated('let a = [1]; typeof a.capacity;')).toBe('undefined');
  expect(evaluated('let a = [1]; typeof a.reserve;')).toBe('undefined');
});

test('the capacity members are not own properties of %Array.prototype%', () => {
  // The regression that reached the inspector snapshots: both appeared in
  // Array.prototype's property listing, so DevTools showed `capacity` and
  // `reserve` on every plain array in the inspector.
  expect(bool('String(Object.getOwnPropertyNames(Array.prototype).includes("capacity"));')).toBe(false);
  expect(bool('String(Object.getOwnPropertyNames(Array.prototype).includes("reserve"));')).toBe(false);
});

test('an untyped array answers for the members as it does for anything absent', () => {
  // Calling one is still a TypeError, because `undefined` is not callable -
  // the outcome the old guard produced, now reached by the member simply not
  // being there.
  expectThrownKind('let a = [1]; a.reserve(4);', 'TypeError');
  expectThrownKind('let a = [1]; a.shrinkToFit();', 'TypeError');
  // READING one no longer throws, and that is the placement decision showing
  // its face: a property that does not exist reads as `undefined`, which is
  // ordinary JavaScript. The throw it used to give was a symptom of the member
  // being present in order to refuse, which is the thing that was wrong.
  expect(evaluated('let a = [1]; String(a.capacity);')).toBe('undefined');
});

// -- placement: a typed array has them ---------------------------------------

test('a growable typed array has the capacity members', () => {
  expect(evaluated('let a: [].<uint32> = [1]; typeof a.capacity;')).toBe('number');
  expect(evaluated('let a: [].<uint32> = [1]; typeof a.reserve;')).toBe('function');
});

test('a typed array is still an Array', () => {
  // Whatever prototype the members are moved to must sit UNDER %Array.prototype%:
  // a `[].<T>` is an array and keeps every array method.
  expect(bool('let a: [].<uint32> = [1]; String(Array.isArray(a));')).toBe(true);
  expect(bool('let a: [].<uint32> = [1]; String(Array.prototype.isPrototypeOf(a));')).toBe(true);
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; String(a.map((x) => x).length);')).toBe('3');
  expect(evaluated('let a: [].<uint32> = [1, 2, 3]; String(a.slice(1).length);')).toBe('2');
});

test('an untyped array keeps exactly its ordinary prototype', () => {
  // The other half of the placement: moving the members must not push a plain
  // `[]` off %Array.prototype%.
  expect(bool('let a = [1]; String(Object.getPrototypeOf(a) === Array.prototype);')).toBe(true);
});

// -- fixed extent: capacity is the extent, permanently ------------------------

test('a fixed-extent array reports its extent as its capacity', () => {
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; String(a.capacity);')).toBe('4');
});

test('reserve past a fixed extent is refused', () => {
  // `push` and `length =` already refuse with "a fixed-extent array cannot be
  // grown". `reserve` asked only whether the array was typed, so it SUCCEEDED
  // and reported a capacity of 64 for a `[4]` - a capacity the array can never
  // use, since its length is pinned at 4.
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4]; a.reserve(64);', 'TypeError');
  // Consistency with the operations that were already guarded.
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4]; a.push(5);', 'TypeError');
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4]; a.length = 9;', 'TypeError');
});

test('a reserve within a fixed extent is a no-op rather than an error', () => {
  // Asking for room the array already has is not a request to grow, so it is
  // allowed - the same rule a growable array follows for `reserve(n <= cap)`.
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; a.reserve(4); String(a.capacity);')).toBe('4');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; a.reserve(2); String(a.capacity);')).toBe('4');
});

// -- fixed extent: storage that never moves never invalidates a borrow --------

test('a borrow into a fixed-extent array survives a reserve', () => {
  // references.md: "A fixed-length `[N].<T>` and a placement-`new` allocation
  // never move, so references into them are never invalidated."
  //
  // Because `reserve` bumped [[TypedGeneration]] unconditionally, a reserve on
  // a FIXED array invalidated every live borrow into storage the specification
  // guarantees never relocates - the borrow then threw "this reference is into
  // an array that has since grown" for an array that cannot grow.
  //
  // Once `reserve` refuses on a fixed array this cannot arise through `reserve`;
  // the test is kept as the statement of the underlying rule.
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; let ref b = a[0]; a.reserve(4); String(b);')).toBe('1');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; let ref b = a[0]; b = 9; String(a[0]);')).toBe('9');
});

test('a growable array still invalidates a borrow on real growth', () => {
  // The control: the relocation rule must keep firing where storage DOES move.
  // If the fixed-extent fix were written as "never bump the generation", this
  // is the test that would catch it.
  expectThrownKind('const a: [].<uint32> = [1]; let ref b = a[0]; a.reserve(64); b;', 'TypeError');
});

// -- withCapacity -------------------------------------------------------------

test('withCapacity is on the array type object, not on Array', () => {
  // README "Capacity": the static is `[].<T>.withCapacity(n)`.
  expect(evaluated('typeof [].<uint32>.withCapacity;')).toBe('function');
  expect(evaluated('typeof Array.withCapacity;')).toBe('undefined');
});

test('withCapacity reserves rather than fills', () => {
  // "withCapacity reserves rather than fills - a zero-filled array of a known
  // length is a fixed [N].<T>."
  expect(evaluated('const o = [].<uint32>.withCapacity(1024); String(o.length);')).toBe('0');
  expect(bool('const o = [].<uint32>.withCapacity(1024); String(o.capacity >= 1024);')).toBe(true);
  expect(evaluated('const o = [].<uint32>.withCapacity(8); String(Object.getOwnPropertyNames(o).join(","));')).toBe('length');
});

test('an array from withCapacity is a growable typed array', () => {
  expect(bool('const o = [].<uint32>.withCapacity(8); String(Array.isArray(o));')).toBe(true);
  expect(evaluated('const o = [].<uint32>.withCapacity(8); o.push(1); String(o.length);')).toBe('1');
  expect(evaluated('const o = [].<uint32>.withCapacity(8); o.reserve(64); String(o.capacity);')).toBe('64');
  // It is growable, NOT fixed - `withCapacity` sets a capacity, not an extent.
  expect(evaluated('const o = [].<uint32>.withCapacity(2); o.push(1); o.push(2); o.push(3); String(o.length);')).toBe('3');
});

test('withCapacity is defined per element type', () => {
  expect(bool('String([].<uint32>.withCapacity(4) !== [].<float32>.withCapacity(4));')).toBe(true);
  expect(evaluated('const o = [].<float32>.withCapacity(4); o.push(1.5); String(o[0]);')).toBe('1.5');
});

// -- the capacity rules the design states (kept green through the move) -------

test('the existing capacity rules still hold after the move', () => {
  // Carried from arrays/capacity.test.mts so a regression in the MOVE shows up
  // beside the placement assertions rather than only in the other file.
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); typeof a.capacity;')).toBe('number');
  // reserve grows the allocation without changing the length
  expect(evaluated('let a: [].<uint32> = [1, 2]; a.reserve(64); String(a.length) + "/" + String(a.capacity);')).toBe('2/64');
  // capacity never shrinks implicitly
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); a.reserve(8); String(a.capacity);')).toBe('64');
  // capacity is kept at least the length
  expect(bool('let a: [].<uint32> = [];  a.push(1); String(a.capacity >= 1);')).toBe(true);
});

// -- gaps found by rechecking the landed work --------------------------------

test('shrinkToFit has a signature rather than resolving to any', () => {
  // It was added without one, so it resolved to ~any~ - the same hole the
  // index type closed for `capacity`, reopened by adding an operation and not
  // its signature alongside. Adding an operation to the family means adding
  // its entry in the same change.
  expectStaticTypeError('let a: [].<uint32> = [1]; let s: string = a.shrinkToFit();');
  expect(evaluated('let a: [].<uint32> = [1]; String(typeof a.shrinkToFit());')).toBe('undefined');
});

test('withCapacity enforces the ceiling its clause specifies', () => {
  // #sec-array-type-withcapacity has always said "If wanted > 2**32 - 1, throw
  // a RangeError". The construction path did not perform it, so `withCapacity`
  // was the one way to obtain the unusable capacity `reserve` refuses - a
  // specification and an implementation disagreeing in the same feature.
  expectThrownKind('[].<uint32>.withCapacity(4294967296);', 'RangeError');
  expectThrownKind('[].<uint32>.withCapacity(1099511627776);', 'RangeError');
  // and the ceiling itself is still constructible
  expect(evaluated('const o = [].<uint32>.withCapacity(4294967295); String(o.capacity);')).toBe('4294967295');
  expect(evaluated('const o = [].<uint32>.withCapacity(8); String(o.capacity);')).toBe('8');
});

test('reserve and withCapacity agree on the ceiling', () => {
  // The two ways to obtain capacity must refuse the same values, or the rule is
  // only enforced on whichever path a program happens to take.
  expectThrownKind('let a: [].<uint32> = []; let n = 4294967296; a.reserve(n);', 'RangeError');
  expectThrownKind('[].<uint32>.withCapacity(4294967296);', 'RangeError');
});
