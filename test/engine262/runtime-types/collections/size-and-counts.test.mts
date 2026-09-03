import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * `size` AT THE INDEX TYPE.
 *
 * A typed collection's `size` reads at the index type, `uint64`, the same type
 * an array's `length` and `capacity` report.
 *
 * WHY `uint64`, and why not the reason the arrays give. `#index-type` fixes the
 * width at `uint64` rather than `uint32` because "a view's length comes from its
 * buffer and is not bounded by the maximum length of an Array" - an argument
 * about views, and a collection has no view form, so it does not transfer. What
 * transfers is the OTHER property the clause is built on: "the invariant that a
 * capacity is at least a length is unstateable if the two are not one type." The
 * same holds across containers. `map.size < array.length` is a sentence a
 * program wants to write, and before this change it was a TypeError - a Number
 * meeting a `uint64` under "arithmetic never promotes". That single expression is
 * the whole case; `size` was the one count in the language with no type, in a
 * proposal whose subject is types.
 *
 * The directions ruled out, briefly, so a later reader need not re-derive them:
 * `uint32` does not fix the comparison either, since a `uint32` `size` and a
 * `uint64` `length` are still two types, and it imports the `Length`/`LongLength`
 * split C# regrets; a distinct count type makes the two counts incomparable BY
 * CONSTRUCTION, which is the defect `#index-type` exists to prevent; and no
 * language in the sample - Rust `usize`, C++ `size_t`, Java/Swift/C# one integer
 * type - has a per-container count type.
 *
 * EVERY TEST HERE IS ABOUT A COLLECTION WITH TYPE ARGUMENTS. The untyped half is
 * `backcompat.test.mts`, which was written first and must stay green through all
 * of this.
 */

// ---------------------------------------------------------------------------
// The type of a typed size
// ---------------------------------------------------------------------------

test('a typed collection reports size at the index type', () => {
  expect(evaluated('const m = new Map.<string, uint8>(); String(Reflect.typeOf(m.size) === (type uint64));')).toBe('true');
  expect(evaluated('const s = new Set.<uint8>(); String(Reflect.typeOf(s.size) === (type uint64));')).toBe('true');
  // Through an annotation as well as through the construction form: both stamp.
  expect(evaluated('let m: Map.<string, uint8> = new Map(); String(Reflect.typeOf(m.size) === (type uint64));')).toBe('true');
  expect(evaluated('let s: Set.<uint8> = new Set(); String(Reflect.typeOf(s.size) === (type uint64));')).toBe('true');
  // And it is NOT a Number, which is the half a loose check would miss.
  expect(evaluated('const m = new Map.<string, uint8>(); String(Reflect.typeOf(m.size) === (type number));')).toBe('false');
});

test('the checker gives size the index type too', () => {
  // The static and runtime halves must agree. A checker saying `uint64` over a
  // run time answering a Number is a disagreement this suite has been bitten by
  // before, so both are asserted rather than either alone.
  //
  // Written through an ANNOTATION rather than through `new Map.<K, V>()`,
  // because only the annotation gives the checker a receiver type - see the
  // test below, which is a general checker gap and not a collections one.
  expectStaticTypeError('let m: Map.<string, uint8> = new Map(); let n: string = m.size;');
  expectStaticTypeError('let m: Map.<string, uint8> = new Map(); let n: number = m.size;');
  expectStaticTypeError('let s: Set.<uint8> = new Set(); let n: string = s.size;');
  expect(ok('let m: Map.<string, uint8> = new Map(); let n: uint64 = m.size;')).toBe(true);
  expect(ok('let s: Set.<uint8> = new Set(); let n: uint64 = s.size;')).toBe(true);
});

test.fails('a `new T.<Args>()` expression has no Static Type (general, not collections)', () => {
  // The checker sees a collection member only through an annotation. Through the
  // construction spelling the receiver is ~any~, so every signature
  // `collectionMethodSignature` provides is unreachable that way - `size`, and
  // `get` and `set` long before it.
  //
  // NOT a collections defect. The array and the user generic behave identically,
  // which is why all three are asserted here: a fix belongs wherever a
  // construction's Static Type is computed, and it converts all three at once.
  expect(ok('const m = new Map.<string, uint8>(); let n: string = m.size;')).toBe(false);
  expect(ok('const a = new [4].<uint8>(); let n: string = a.length;')).toBe(false);
  expect(ok('class G<T> { x: uint8; } const g = new G.<uint8>(); let n: string = g.x;')).toBe(false);
  // The RUN TIME is unaffected either way - the stamp is applied at construction,
  // so the behaviour is enforced; it is the Early Error that is missing.
  expect(ok('const s = new Set.<uint8>(); const bad = (300 := any); s.add(bad);')).toBe(false);
});

// ---------------------------------------------------------------------------
// The expression that motivated the whole change
// ---------------------------------------------------------------------------

test('a collection count is comparable with an array count', () => {
  // This was once a TypeError. It is the reason the width is the index type and
  // not something of its own.
  expect(evaluated('const m = new Map.<string, uint8>(); const a: [].<uint8> = [1, 2, 3]; String(m.size < a.length);')).toBe('true');
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); const a: [].<uint8> = [1, 2, 3]; String(s.size < a.length);')).toBe('true');
  // And with the other counts an array reports, which are the same type.
  expect(ok('const m = new Map.<string, uint8>(); const a: [].<uint8> = [1]; m.size < a.capacity;')).toBe(true);
  // Two collections compare with each other.
  expect(evaluated('const m = new Map.<string, uint8>(); const s = new Set.<uint8>(); s.add(1); String(m.size < s.size);')).toBe('true');
});

test('a typed size does arithmetic at its own type', () => {
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); s.add(2); const n: uint64 = (1 := uint64); String(s.size + n);')).toBe('3');
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); String(s.size + s.size);')).toBe('2');
  // A LITERAL beside a typed count takes the count's type, so the ordinary
  // spelling keeps working without a cast.
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); String(s.size + 1);')).toBe('2');
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); String(s.size === 1);')).toBe('true');
  expect(evaluated('const m = new Map.<string, uint8>(); String(m.size > 0 ? "some" : "none");')).toBe('none');
});

test('a typed size does NOT mix with an untyped count', () => {
  // The other side of the coin, and the reason `backcompat.test.mts` exists: a
  // typed count meeting an untyped one is a type error, per "arithmetic never
  // promotes". A program mixing the two writes the conversion.
  expect(ok('const t = new Map.<string, uint8>(); const u = new Map(); t.size + u.size;')).toBe(false);
  expect(ok('const t = new Map.<string, uint8>(); t.size < [1, 2].length;')).toBe(false);
  // A bigint is a different numeric type, so a RELATIONAL against one is
  // refused. `==` is deliberately not aligned with it: `sec-equality-and-comparison`
  // has IsLooselyEqual "compare their mathematical values where both are
  // numeric", so `uint64(0) == 0n` is *true* - the same split that makes
  // `uint8(1) == uint16(1)` true while `uint8(1) + uint16(1)` is a type error.
  // An equality asks a question and has no result type to fix; an operator
  // produces a value and must.
  expect(ok('const t = new Map.<string, uint8>(); t.size > 0n;')).toBe(false);
  expect(evaluated('const t = new Map.<string, uint8>(); String(t.size == 0n);')).toBe('true');
});

// ---------------------------------------------------------------------------
// The count itself is right
// ---------------------------------------------------------------------------

test('a typed size counts what an untyped one counts', () => {
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); s.add(2); s.add(1); String(s.size);')).toBe('2');
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); s.delete(1); String(s.size);')).toBe('0');
  expect(evaluated('const s = new Set.<uint8>(); s.delete(1); String(s.size);')).toBe('0');
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); m.set("a", 2); String(m.size);')).toBe('1');
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); m.clear(); String(m.size);')).toBe('0');
  expect(evaluated('const m = new Map.<string, uint8>(); m.getOrInsert("a", 1); String(m.size);')).toBe('1');
});

// ---------------------------------------------------------------------------
// size is read-only
// ---------------------------------------------------------------------------

test('size has no setter, on a typed collection as on an untyped one', () => {
  // Read-only, with `capacity` as the in-proposal precedent for an
  // index-typed count that reports and does not accept. An array's `length` is
  // settable because an array is POSITIONAL and dropping a suffix is well
  // defined; a keyed collection has no such operation that is not already
  // spelled `clear()`.
  expect(evaluated('const d = Object.getOwnPropertyDescriptor(Map.prototype, "size"); String(d.set);')).toBe('undefined');
  expect(evaluated('const d = Object.getOwnPropertyDescriptor(Set.prototype, "size"); String(d.set);')).toBe('undefined');
  // Assigning in sloppy mode is a silent no-op, as it is for any getter-only
  // accessor; the count is unchanged either way.
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); try { m.size = 0; } catch (e) {} String(m.size);')).toBe('1');
});

// ---------------------------------------------------------------------------
// WeakMap and WeakSet have no size
// ---------------------------------------------------------------------------

test('a weak collection refuses `size` by name', () => {
  // It was ~any~, so `let n: string = w.size` type-checked on a proposal whose
  // subject is types. Refused the way `Span.<T>` refuses the operations it does
  // not have.
  expectStaticTypeError('let w: WeakMap.<object, uint8> = new WeakMap(); let n: string = w.size;');
  expectStaticTypeError('let w: WeakSet.<object> = new WeakSet(); let n: string = w.size;');
  // In an inferred binding and in an argument position, which are the two other
  // places the member is reached. A BARE `w.size;` statement is not asserted: an
  // expression statement whose value nothing consumes is not visited by the
  // checker, which is a general property and not this member's.
  expectStaticTypeError('let w: WeakMap.<object, uint8> = new WeakMap(); let n = w.size;');
  expectStaticTypeError('function f(n: uint64) {} let w: WeakMap.<object, uint8> = new WeakMap(); f(w.size);');
  // An UNTYPED weak collection is untouched: reading an absent property is
  // undefined, not an error, exactly as it is today.
  expect(evaluated('const w = new WeakMap(); String(w.size);')).toBe('undefined');
});

// ---------------------------------------------------------------------------
// The set-algebra methods still work with a typed size
// ---------------------------------------------------------------------------

test('a set operation between two TYPED sets still works', () => {
  // GetSetRecord reads `size` off the other operand and used to run ToNumber
  // over it. Once `size` answers a value of the index type, that step is an
  // implicit numeric conversion - the thing this proposal does not do - so it
  // now reads a typed count directly and coerces nothing. If this regresses,
  // every set operation between two typed sets is broken.
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); a.add(2); const b = new Set.<uint8>(); b.add(2); [...a.intersection(b)].join(",");')).toBe('2');
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set.<uint8>(); b.add(2); [...a.union(b)].join(",");')).toBe('1,2');
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set.<uint8>(); b.add(2); [...a.difference(b)].join(",");')).toBe('1');
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set.<uint8>(); b.add(2); [...a.symmetricDifference(b)].join(",");')).toBe('1,2');
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set.<uint8>(); b.add(1); b.add(2); String(a.isSubsetOf(b));')).toBe('true');
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set.<uint8>(); b.add(2); String(a.isDisjointFrom(b));')).toBe('true');
});

test('a typed set against an untyped one, and against a set-like', () => {
  // Mixed operands are the case that reaches BOTH branches of the new
  // GetSetRecord step in one call.
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set([2]); [...a.union(b)].join(",");')).toBe('1,2');
  expect(evaluated('const a = new Set([1]); const b = new Set.<uint8>(); b.add(2); [...a.union(b)].join(",");')).toBe('1,2');
  // A set-like with an ordinary Number `size` keeps the ES2026 path exactly.
  const like = 'const like = { size: 1, has: (v) => v === 2, keys: () => [2][Symbol.iterator]() }; ';
  expect(evaluated(`${like} const a = new Set.<uint8>(); a.add(1); [...a.union(like)].join(",");`)).toBe('1,2');
  // A set-like whose `size` is a TYPED count is read as a count rather than
  // coerced, and works.
  const typedLike = 'const like = { size: (1 := uint64), has: (v) => v === 2, keys: () => [2][Symbol.iterator]() }; ';
  expect(evaluated(`${typedLike} const a = new Set.<uint8>(); a.add(1); [...a.union(like)].join(",");`)).toBe('1,2');
  // ...and a typed count that is not a count is refused rather than clamped.
  const badLike = 'const like = { size: (-1 := int32), has: () => true, keys: () => [][Symbol.iterator]() }; ';
  expect(ok(`${badLike} const a = new Set.<uint8>(); a.union(like);`)).toBe(false);
});
