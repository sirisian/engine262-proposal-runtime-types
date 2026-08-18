import { test, expect } from 'vitest';
import {
  evaluated, expectStaticTypeError, expectThrownKind, bool,
} from '../harness.mts';

/**
 * #sec-span-type: `Span.<T>` is a fixed-length WINDOW over a run of elements of
 * T that it does not own.
 *
 * The array types say what is known about an EXTENT - `[N].<T>` states one and
 * `[].<T>` states that it varies. Ownership is a separate question, and this is
 * the type that answers it, which is why it lives in a name rather than inside
 * the brackets: a bracket slot carrying both would have made `[].<T>` differ
 * from `[N].<T>` on one axis and from a window on another.
 *
 * The type was already latent in the design and had no name. An array view over
 * a buffer is a window, and an `SoA` column projection is a window; both had to
 * invent the concept locally and neither could say what it was returning.
 *
 * This file covers what has landed: the type, its coercions in both directions,
 * membership, and the receiver surface. The materialised window value and the
 * respelled view constructor are not here yet.
 */

// -- coercion: owned to window, never the reverse -----------------------------

test('an owned array coerces to a window', () => {
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [].<uint32> = [1, 2]; String(f(a));')).toBe('2');
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; String(f(a));')).toBe('4');
});

test('a tuple coerces only when every position is the element type', () => {
  expect(evaluated('function f(p: Span.<uint8>) { return p.length; }'
    + ' let t: [uint8, uint8] = [1, 2]; String(f(t));')).toBe('2');
  // a mixed tuple is not a run of one type, so there is no window of it
  expectStaticTypeError('function f(p: Span.<uint8>) { return p.length; }'
    + ' let t: [uint8, uint16] = [1, 300]; f(t);');
});

test('a window does not coerce back to an owned array', () => {
  // Neither the storage nor the right to grow it is the window's to give.
  expectStaticTypeError('function f(p: [].<uint32>) { return p.length; }'
    + ' function g(s: Span.<uint32>) { return f(s); }');
  expectStaticTypeError('function f(p: [4].<uint32>) { return p.length; }'
    + ' function g(s: Span.<uint32>) { return f(s); }');
});

test('the element type must match', () => {
  expectStaticTypeError('function f(p: Span.<uint8>) { return p.length; }'
    + ' let a: [].<uint32> = [1, 2]; f(a);');
  // `Span.<any>` is admissible on the same ground `[].<any>` is: a store
  // through it is checked against the storage's own element type at run time.
  expect(evaluated('function f(p: Span.<any>) { return p.length; }'
    + ' let a: [].<uint8> = [1, 2]; String(f(a));')).toBe('2');
});

// -- the family --------------------------------------------------------------

test('a window is a member of the array and tuple family', () => {
  // Bare `[]` is the family bound, so a window has to satisfy it or the window
  // would be outside the family it is a view of.
  expect(evaluated('function f(p: []) { return p.length; }'
    + ' function g(s: Span.<uint32>) { return f(s); }'
    + ' let a: [].<uint32> = [1, 2]; String(g(a));')).toBe('2');
  // `T extends []` through a window is NOT asserted: generic inference reads a
  // shape off the value, and a window has no own properties at all - its length
  // and elements are answered by its backing - so it infers the literal type of
  // `{}`. Reporting a window's runtime type as `Span.<T>` is the fix and is not
  // in yet (plan K7).
  expect(bool('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2]; String(w(a) is []);')).toBe(true);
});

// -- membership is structural, not a prototype chain --------------------------

test('an owned array is assignable to a window and is not one', () => {
  // `is` asks membership, not assignability, and the two differ wherever a
  // conversion sits between them. The language already works this way: 5 is
  // assignable to `uint8` and `5 is uint8` is *false*, because the boundary
  // CONVERTS. #sec-span-coercion says that conversion materializes, so
  // answering true here would mean no conversion was needed - and then no
  // window would ever be built and the liveness rule would have nothing to
  // attach to.
  expect(bool('let a: [].<uint32> = [1, 2]; String(a is Span.<uint32>);')).toBe(false);
  expect(bool('let a = [1, 2]; String(a is Span.<uint32>);')).toBe(false);
  // What IS one is the window the coercion produced.
  expect(bool('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2]; String(w(a) is Span.<uint32>);')).toBe(true);
});

test('a view over a buffer is a window', () => {
  // The type the view clause always described and could not name.
  expect(evaluated('const b = new ArrayBuffer(4);'
    + ' function f(p: Span.<uint8>) { return p.length; } String(f(Span.<uint8>(b)));')).toBe('4');
});

// -- the receiver surface -----------------------------------------------------

test('an element read through a window has the element type', () => {
  // Without this the receiver fell through to ~any~, so the type existed and
  // constrained nothing - worse than not having it.
  expectStaticTypeError('function f(p: Span.<uint32>) { let s: string = p[0]; return s; }');
  expect(evaluated('function f(p: Span.<uint32>) { let n: uint32 = p[0]; return n; }'
    + ' let a: [].<uint32> = [5]; String(f(a));')).toBe('5');
});

test('length reads at the index type', () => {
  expect(evaluated('function f(p: Span.<uint32>) { let n: uint64 = p.length; return n; }'
    + ' let a: [].<uint32> = [1, 2]; String(f(a));')).toBe('2');
});

test('a window has no operation that grows, shrinks, or names an allocation', () => {
  // `capacity`, `reserve`, and `shrinkToFit` describe an allocation and a
  // window owns none. `push` and the rest change a length, and a window's
  // length is fixed.
  for (const member of ['capacity', 'reserve(1)', 'shrinkToFit()', 'push(1)', 'pop()', 'shift()', 'unshift(1)', 'splice(0, 1)']) {
    expectStaticTypeError(`function f(p: Span.<uint32>) { return p.${member}; }`);
  }
});

test('a window reads its elements and its length', () => {
  // The read surface a window HAS today. The array METHODS - `indexOf`,
  // `includes`, `map`, iteration - are accepted by the checker and are not
  // implemented on the window value yet, so they are not asserted here; that
  // is the remaining half of equipping the window (plan K7), and a test that
  // passed by accident of the static rule would hide it.
  expect(evaluated('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; String(w(a)[1]);')).toBe('2');
  expect(evaluated('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; String(w(a).length);')).toBe('3');
});

// -- the owned types are undisturbed ------------------------------------------

test('adding the window changes nothing about the array types', () => {
  expect(evaluated('let a: [].<uint32> = []; a.push((1 := uint32)); String(a.length);')).toBe('1');
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; String(a.capacity);')).toBe('4');
  expect(evaluated('let a = [1, 2, 3]; String(a.length);')).toBe('3');
});

// -- the window is a value, and it materialises -------------------------------

test('a coercion materialises a window distinct from the array', () => {
  // #sec-span-coercion. The window is a value, not a view of the static type:
  // one static type standing for two kinds of value is the confusion this type
  // exists to end.
  expect(bool('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; String(w(a) === a);')).toBe(false);
});

test('a window reads and writes the array it windows', () => {
  expect(evaluated('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; let s = w(a); s[0] = (9 := uint32); String(a[0]);')).toBe('9');
  expect(evaluated('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; String(w(a).length);')).toBe('3');
  expectThrownKind('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; w(a)[10];', 'RangeError');
});

// -- liveness: the soundness obligation ---------------------------------------

test('growth invalidates a window over the array that grew', () => {
  // #sec-span-liveness. A window names a run of elements in storage it does not
  // own, so it is a reference and takes the reference rules: when the
  // allocation relocates the window describes memory the array no longer uses.
  const w = 'function w(s: Span.<uint32>) { return s; } ';
  expectThrownKind(`${w}let a: [].<uint32> = [1, 2, 3]; let s = w(a); a.push((4 := uint32)); s[0];`, 'TypeError');
  expectThrownKind(`${w}let a: [].<uint32> = [1, 2, 3]; let s = w(a); a.reserve(64); s[0];`, 'TypeError');
  expectThrownKind(`${w}let a: [].<uint32> = [1, 2, 3]; a.reserve(64); let s = w(a); a.shrinkToFit(); s[0];`, 'TypeError');
});

test('an operation that does not relocate does not invalidate', () => {
  // The other half, and the one a coarser rule would get wrong: a `reserve` for
  // room the array already has and a `shrinkToFit` on an array already at fit
  // move nothing, so every window over it stays valid. Invalidating on the call
  // rather than on the relocation would refuse a window into storage that never
  // moved.
  const w = 'function w(s: Span.<uint32>) { return s; } ';
  expect(evaluated(`${w}let a: [].<uint32> = [1, 2, 3]; a.reserve(64); let s = w(a); a.reserve(8); String(s[0]);`)).toBe('1');
  expect(evaluated(`${w}let a: [].<uint32> = [1, 2, 3]; let s = w(a); a.shrinkToFit(); String(s[0]);`)).toBe('1');
});

test('a window over a fixed extent is never invalidated', () => {
  // A fixed extent has nothing that relocates, so there is no generation to
  // move and no window over it to refuse.
  expect(evaluated('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; let s = w(a); String(s[0]);')).toBe('1');
});

// -- the object model can see a window's elements -----------------------------

test('a window reports its indices as properties', () => {
  // A window answers its elements from a backing rather than storing them, so
  // the object model could not see them: `0 in window` was *false*,
  // `getOwnPropertyNames` was empty, and every generic array method that tests
  // for a hole treated every element as one. `forEach` over three elements ran
  // ZERO times, which is the shape of the bug - not an error, just nothing.
  const w = 'function w(s: Span.<uint32>) { return s; } let a: [].<uint32> = [1, 2, 3]; const s = w(a); ';
  expect(bool(`${w}String(0 in s);`)).toBe(true);
  expect(bool(`${w}String(Object.prototype.hasOwnProperty.call(s, "0"));`)).toBe(true);
  // the indices in order, then `length`, which is the order an Array reports
  expect(evaluated(`${w}String(Object.getOwnPropertyNames(s).join(","));`)).toBe('0,1,2,length');
});

test('the generic array methods work on a window', () => {
  // They are generic over an array-LIKE, so reporting the indices is all they
  // needed. The window is not given its own copies of them.
  const w = 'function w(s: Span.<uint32>) { return s; } let a: [].<uint32> = [1, 2, 3]; const s = w(a); ';
  expect(evaluated(`${w}let n = 0; Array.prototype.forEach.call(s, () => { n += 1; }); String(n);`)).toBe('3');
  expect(evaluated(`${w}String(Array.prototype.filter.call(s, () => true).length);`)).toBe('3');
  expect(evaluated(`${w}String(Array.prototype.join.call(s, ","));`)).toBe('1,2,3');
  // and `map` produces a real element rather than a hole
  expect(bool(`${w}const r = Array.prototype.map.call(s, (x) => x); String(0 in r);`)).toBe(true);
});

test('a buffer view is fixed by the same change', () => {
  // The view has had this hole since it was written, and it is the same hole:
  // both answer elements from a backing. Fixing one fixes the other, which is
  // the argument for the window and the view sharing a definition rather than
  // resembling each other.
  const v = 'const b = new ArrayBuffer(4); const v = Span.<uint8>(b); ';
  expect(bool(`${v}String(0 in v);`)).toBe(true);
  expect(evaluated(`${v}let n = 0; Array.prototype.forEach.call(v, () => { n += 1; }); String(n);`)).toBe('4');
  expect(evaluated(`${v}String(Object.getOwnPropertyNames(v).join(","));`)).toBe('0,1,2,3,length');
});

test('reporting the indices does not disturb reads, writes, or liveness', () => {
  const w = 'function w(s: Span.<uint32>) { return s; } let a: [].<uint32> = [1, 2, 3]; const s = w(a); ';
  expect(evaluated(`${w}String(s[1]);`)).toBe('2');
  expect(evaluated(`${w}s[0] = (9 := uint32); String(a[0]);`)).toBe('9');
  expect(evaluated(`${w}String(s.length);`)).toBe('3');
  expectThrownKind(`${w}a.push((4 := uint32)); s[0];`, 'TypeError');
});

// -- the window's own surface, reachable ---------------------------------------

test('a window carries the array methods it is allowed', () => {
  // Making the indices visible was what made the methods WORK; this is what
  // makes them reachable. `%Span.prototype%` is built by copying
  // `%Array.prototype%` and removing what a window does not have, rather than
  // by listing what it does - so a method added to arrays reaches windows
  // without a second edit, and the copied functions are the same objects,
  // being generic over an array-like.
  const w = 'function w(s: Span.<uint32>) { return s; } let a: [].<uint32> = [1, 2, 3]; const s = w(a); ';
  expect(evaluated(`${w}String(s.map((x) => x).length);`)).toBe('3');
  expect(evaluated(`${w}let n = 0; s.forEach(() => { n += 1; }); String(n);`)).toBe('3');
  expect(evaluated(`${w}String(s.join(","));`)).toBe('1,2,3');
  expect(evaluated(`${w}String(s.slice(1).length);`)).toBe('2');
  expect(evaluated(`${w}String(s.filter(() => true).length);`)).toBe('3');
});

test('a window is iterable', () => {
  const w = 'function w(s: Span.<uint32>) { return s; } let a: [].<uint32> = [1, 2, 3]; const s = w(a); ';
  expect(evaluated(`${w}let n = 0; for (const x of s) { n += 1; } String(n);`)).toBe('3');
  expect(evaluated(`${w}String([...s].length);`)).toBe('3');
  // and the spread produces a new OWNED array, which is the explicit way out of
  // a window's lifetime
  expect(evaluated(`${w}const owned = [...s]; owned.push(4); String(owned.length);`)).toBe('4');
});

test('the operations a window does not have are absent, not merely refused', () => {
  // The checker refuses them on a `Span.<T>` receiver; the value does not carry
  // them either, so the two agree rather than one relying on the other.
  const w = 'function w(s: Span.<uint32>) { return s; } let a: [].<uint32> = [1, 2, 3]; const s = w(a); ';
  for (const member of ['push', 'pop', 'shift', 'unshift', 'splice', 'capacity', 'reserve', 'shrinkToFit']) {
    expect(evaluated(`${w}String(typeof s.${member});`)).toBe('undefined');
  }
});

test('a buffer view gains the same surface', () => {
  const v = 'const b = new ArrayBuffer(4); const v = Span.<uint8>(b); ';
  expect(evaluated(`${v}String(v.map((x) => x).length);`)).toBe('4');
  expect(evaluated(`${v}let n = 0; for (const x of v) { n += 1; } String(n);`)).toBe('4');
  expect(evaluated(`${v}String(typeof v.push);`)).toBe('undefined');
});

test('equipping the window disturbs neither arrays nor liveness', () => {
  expect(evaluated('let a = [1, 2]; a.push(3); String(a.length);')).toBe('3');
  expect(evaluated('let a: [].<uint32> = []; a.push((1 := uint32)); a.reserve(64); String(a.capacity);')).toBe('64');
  expectThrownKind('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; const s = w(a); a.push((4 := uint32)); s[0];', 'TypeError');
});

// -- the view constructor, respelled ------------------------------------------

test('a view is constructed as Span.<T>(buffer)', () => {
  // #sec-array-views. It was spelled `[].<T>(buffer, ...)`, which named the
  // GROWABLE ARRAY type to produce a value that owns nothing and cannot grow.
  // The spelling now says which type it makes.
  const b = 'const b = new ArrayBuffer(8); ';
  expect(evaluated(`${b}String(Span.<uint8>(b).length);`)).toBe('8');
  expect(evaluated(`${b}String(Span.<uint32>(b).length);`)).toBe('2');
  expect(evaluated(`${b}String(Span.<uint8>(b, 2).length);`)).toBe('6');
});

test('a view built this way is a window in full', () => {
  const b = 'const b = new ArrayBuffer(8); ';
  expect(bool(`${b}String(Span.<uint8>(b) is Span.<uint8>);`)).toBe(true);
  expect(evaluated(`${b}const v = Span.<uint8>(b); v[0] = 7; String(v[0]);`)).toBe('7');
  expect(evaluated(`${b}String(typeof Span.<uint8>(b).map);`)).toBe('function');
  expect(evaluated(`${b}let n = 0; for (const x of Span.<uint8>(b)) { n += 1; } String(n);`)).toBe('8');
  expect(evaluated(`${b}function f(p: Span.<uint8>) { return p.length; } String(f(Span.<uint8>(b)));`)).toBe('8');
});

test('the old view spellings are retired, not reinterpreted', () => {
  // `[].<T>(buffer, …)` named the GROWABLE ARRAY type to produce a value that
  // owns nothing, and `[N].<T>(buffer, …)` put a window's extent inside the
  // brackets of an owned type. Both are gone.
  //
  // They RAISE rather than being quietly re-read, because the third argument
  // changed meaning in the same change - it was the stride and is now the count
  // - so an untouched call site would keep parsing and describe a different run
  // of bytes. This is not hypothetical: `[].<uint16>(buf, 1, 3)` in the SoA
  // tests meant five elements at a 3-byte stride and would have become three
  // elements at the default stride, with nothing reported.
  expectThrownKind('const b = new ArrayBuffer(8); [].<uint8>(b);', 'TypeError');
  expectThrownKind('const b = new ArrayBuffer(8); [8].<uint8>(b);', 'TypeError');
  expectThrownKind('const b = new ArrayBuffer(8); [].<uint16>(b, 1, 3);', 'TypeError');
});
// -- the failure path ---------------------------------------------------------

test('a window of the wrong element type is refused, not converted', () => {
  // A window does not own its storage, so it cannot restate what that storage
  // holds: there is no conversion from a `Span.<uint8>` to a `Span.<uint32>`,
  // and the attempt is a type error.
  //
  // This was an infinite loop rather than a wrong answer, and it is worth
  // saying how: membership failed, the coercion was attempted, the coercion
  // declined because the value was ALREADY a window, and the declared-conversion
  // search then re-entered membership. The stack overflowed inside the
  // diagnostic being built for the failure, which is why it presented as a
  // `displayType` bug and not as a coercion one.
  expectThrownKind('const b = new ArrayBuffer(4);'
    + ' function f(p: Span.<uint32>) { return p.length; } f(Span.<uint8>(b));', 'TypeError');
  expectThrownKind('class P { x: float32; } const s = new SoA.<P>(); s.push({ x: 1 });'
    + ' function f(p: Span.<uint32>) { return p.length; } f(s.fields.x);', 'TypeError');
});

test('a matching window still passes, and an owned array still coerces', () => {
  // The controls for the refusal above: it must reject the mismatch WITHOUT
  // rejecting the cases that were working.
  expect(evaluated('const b = new ArrayBuffer(4);'
    + ' function f(p: Span.<uint8>) { return p.length; } String(f(Span.<uint8>(b)));')).toBe('4');
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [].<uint32> = [1, 2]; String(f(a));')).toBe('2');
  // and a window passed on to another window position is not re-wrapped
  expect(evaluated('const b = new ArrayBuffer(4);'
    + ' function g(s: Span.<uint8>) { return s; } function f(p: Span.<uint8>) { return p.length; }'
    + ' String(f(g(Span.<uint8>(b))));')).toBe('4');
});

test('an owned array of the wrong element type is still an early error', () => {
  // The static path is unchanged: where both types are known at check time the
  // mismatch is caught before the program runs, and only a value that reaches
  // the boundary needs the run-time refusal above.
  expectStaticTypeError('function f(p: Span.<uint32>) { return p.length; } let a: [].<uint8> = [1]; f(a);');
});

// -- SoA column projections are windows ---------------------------------------

test('a column projection is a window at run time', () => {
  // #sec-structure-of-arrays. The projection has BEEN a window since before the
  // type had a name - it is stored the way a buffer view is - so this needed no
  // work in `SoA` at all. It follows from the window being a real value.
  const s = 'class P { x: float32; y: float32; } const s = new SoA.<P>();'
    + ' s.push({ x: 1, y: 2 }); s.push({ x: 3, y: 4 }); ';
  expect(bool(`${s}String(s.fields.x is Span.<float32>);`)).toBe(true);
  expect(evaluated(`${s}String(s.fields.x.length);`)).toBe('2');
  expect(evaluated(`${s}String(s.fields.x[1]);`)).toBe('3');
  expect(evaluated(`${s}String(typeof s.fields.x.map);`)).toBe('function');
  expect(evaluated(`${s}let n = 0; for (const v of s.fields.x) { n += 1; } String(n);`)).toBe('2');
  expect(evaluated(`${s}String(typeof s.fields.x.push);`)).toBe('undefined');
  expect(evaluated(`${s}function f(p: Span.<float32>) { return p.length; } String(f(s.fields.x));`)).toBe('2');
});

test('a column projection of the wrong element type is refused', () => {
  expectThrownKind('class P { x: float32; } const s = new SoA.<P>(); s.push({ x: 1 });'
    + ' function f(p: Span.<uint32>) { return p.length; } f(s.fields.x);', 'TypeError');
});

test('fields is statically an object of windows', () => {
  // Built from `SoAColumnsOf` where the element has a layout - which covers a
  // primitive - and from the element's Structure otherwise. A class element has
  // no layout at check time, the layout being built when the class is
  // constructed, but a layout is not what this needs: the columns are one per
  // FIELD, and the checker already knows a class's fields and their types.
  expectStaticTypeError('let s: SoA.<float32> = new SoA.<float32>(); let z: string = s.fields;');
  expectStaticTypeError('class P { x: float32; } let s: SoA.<P> = new SoA.<P>(); let z: string = s.fields;');
});

test('a column reads as a window of the field type', () => {
  // The hop that completes it: `s.fields` is an object of `Span.<F>` properties
  // and `s.fields.x` reads one, so a column is typed all the way down to its
  // elements rather than only at the projection.
  const s = 'class P { x: float32; y: float32; } let s: SoA.<P> = new SoA.<P>(); s.push({ x: 1, y: 2 }); ';
  expectStaticTypeError(`${s}let z: string = s.fields.x;`);
  expectStaticTypeError(`${s}let z: string = s.fields.x[0];`);
  // and the ELEMENT type is the field's, not merely "some number"
  expectStaticTypeError(`${s}let z: uint32 = s.fields.x[0];`);
  expect(evaluated(`${s}let z: float32 = s.fields.x[0]; String(z);`)).toBe('1');
  expect(evaluated(`${s}let z: Span.<float32> = s.fields.x; String(z.length);`)).toBe('1');
});

// -- the coercion this whole phase replaces -----------------------------------

test('a fixed array is not assignable to a growable one', () => {
  // The unsoundness `Span.<T>` exists to replace. `[].<T>` promises growth and
  // a fixed array cannot grow, so the assignment type-checked and then threw at
  // whatever grew it - the checker said yes and the run time said no.
  expectStaticTypeError('function f(p: [].<uint32>) { return p.length; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; f(a);');
  expectStaticTypeError('function g(p: [].<uint32>) { p.push((9 := uint32)); }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; g(a);');
});

test('membership agrees with assignability', () => {
  // `match` dispatches on membership, so a run-time answer that disagreed with
  // the checker would let a pattern select a branch the checker calls
  // impossible. The two halves land together for that reason.
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a is [].<uint32>);')).toBe(false);
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a is [4].<uint32>);')).toBe(true);
  expect(bool('let a: [].<uint32> = [1, 2]; String(a is [].<uint32>);')).toBe(true);
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' match (a) { when [].<uint32>: "dyn"; when [4].<uint32>: "fixed"; default: "no" };')).toBe('fixed');
});

test('the window is what replaces it', () => {
  // Both owned forms reach a window, which is the whole point: a function that
  // only reads says `Span.<T>` and accepts either.
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; String(f(a));')).toBe('4');
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [].<uint32> = [1, 2]; String(f(a));')).toBe('2');
  // and the forms that always worked still do
  expect(evaluated('function f(p: [4].<uint32>) { return p.length; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; String(f(a));')).toBe('4');
  expect(evaluated('function f(p: []) { return p.length; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; String(f(a));')).toBe('4');
});

// -- a window is a run of T, and the coercion checks that ---------------------

test('a value reaching the boundary untyped is checked before a window is built', () => {
  // The checker catches a mismatch where both types are known. Anything
  // arriving as ~any~ is not caught there - a `Uint8Array`, a plain array, an
  // object with a `length` - and every one of them coerced to `Span.<`ANY`>`.
  //
  // That was unsound rather than merely permissive: a `Uint8Array` became a
  // `Span.<uint32>` that answered *true* to `is`, and a store of 300 through it
  // landed as 44, the underlying storage having wrapped it. The window was
  // promising an element type its storage does not hold.
  expectThrownKind('const u = new Uint8Array([1, 2, 3]);'
    + ' function f(p: Span.<uint32>) { return p.length; } f(u);', 'TypeError');
  expectThrownKind('const p = [1, 2, 3];'
    + ' function f(q: Span.<uint32>) { return q.length; } f(p);', 'TypeError');
  expectThrownKind('const o = { length: 2, 0: 1, 1: 2 };'
    + ' function f(q: Span.<uint32>) { return q.length; } f(o);', 'TypeError');
});

test('the check is on the ELEMENTS, so a fixed array still reaches a window', () => {
  // Asking "is this a dynamic array of T" would answer *false* for a fixed
  // array now that the extents must agree - and a fixed array is exactly one of
  // the things that must reach a window. What a window promises is a run of T;
  // the extent is the part it does not promise.
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; String(f(a));')).toBe('4');
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [].<uint32> = [1, 2]; String(f(a));')).toBe('2');
  expect(evaluated('const b = new ArrayBuffer(4);'
    + ' function f(p: Span.<uint8>) { return p.length; } String(f(Span.<uint8>(b)));')).toBe('4');
  expect(evaluated('class P { x: float32; } const s = new SoA.<P>(); s.push({ x: 1 });'
    + ' function f(p: Span.<float32>) { return p.length; } String(f(s.fields.x));')).toBe('1');
});

test('a legacy TypedArray reaches a window through its buffer', () => {
  // `Uint8Array` is untouched by this proposal, and its elements are plain
  // Numbers rather than `uint8` values - so it is not a run of `uint8` and does
  // not coerce to one. The interop path is the buffer, which is what a window
  // over bytes is for.
  expect(bool('const u = new Uint8Array([1, 2, 3]); String(u[0] is uint8);')).toBe(false);
  expect(bool('const u = new Uint8Array([1, 2, 3]); String(u[0] is number);')).toBe(true);
  expect(evaluated('const u = new Uint8Array([1, 2, 3]);'
    + ' String(Span.<uint8>(u.buffer).length);')).toBe('3');
});

// -- one index type, every count ----------------------------------------------

test('every count an array reports reads at the index type', () => {
  // #index-type is a claim about ALL of them - a `length`, a `capacity`, and
  // the length of a view. Three of the five places a count comes from read as
  // plain Numbers, so the type that says "one type describes every count"
  // described two of them.
  //
  // Asserted together rather than one per site, because the point is that they
  // AGREE: a widening that reached only some of these would be worse than one
  // that reached none.
  expect(bool('let a: [].<uint32> = [1, 2]; String(a.length is uint64);')).toBe(true);
  expect(bool('let a: [].<uint32> = [1, 2]; String(a.capacity is uint64);')).toBe(true);
  expect(bool('const b = new ArrayBuffer(4); String(Span.<uint8>(b).length is uint64);')).toBe(true);
  expect(bool('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2]; String(w(a).length is uint64);')).toBe(true);
  expect(bool('class P { x: float32; } const s = new SoA.<P>(); s.push({ x: 1 });'
    + ' String(s.fields.x.length is uint64);')).toBe(true);
});

test('typing the counts does not change what they report', () => {
  expect(evaluated('const b = new ArrayBuffer(4); String(Span.<uint8>(b).length);')).toBe('4');
  expect(evaluated('const b = new ArrayBuffer(4); String(Span.<uint8>(b).map((x) => x).length);')).toBe('4');
  expect(evaluated('const b = new ArrayBuffer(4); let n = 0;'
    + ' for (const x of Span.<uint8>(b)) { n += 1; } String(n);')).toBe('4');
  expect(evaluated('class P { x: float32; } const s = new SoA.<P>(); s.push({ x: 1 });'
    + ' String(s.fields.x.length);')).toBe('1');
});

// -- one bounds rule, every window --------------------------------------------

test('an out-of-range access raises through every window, however backed', () => {
  // #sec-array-and-tuple-types pins that a typed array is bounds-checked and
  // only a PLAIN array keeps JavaScript's `undefined`. A window over a buffer
  // and an `SoA` column projection did not honour it: the read answered
  // `undefined` and the write silently did nothing, while the same access
  // through an array-backed window raised.
  //
  // One type standing for two behaviours at the same operation is the
  // divergence the window was introduced to end, so all five are asserted
  // together - the point is that they AGREE.
  expectThrownKind('const b = new ArrayBuffer(4); Span.<uint8>(b)[100];', 'RangeError');
  expectThrownKind('const b = new ArrayBuffer(4); const v = Span.<uint8>(b); v[100] = 1;', 'RangeError');
  expectThrownKind('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2, 3]; w(a)[100];', 'RangeError');
  expectThrownKind('let a: [].<float32> = [1, 2, 3]; a[9];', 'RangeError');
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4]; let i = 9; a[i];', 'RangeError');
  expectThrownKind('class P { x: float32; } const s = new SoA.<P>(); s.push({ x: 1 });'
    + ' s.fields.x[100];', 'RangeError');
});

test('a plain array still answers undefined', () => {
  // The one case that must NOT change: an array with no element type keeps
  // JavaScript's semantics exactly.
  expect(evaluated('const p = [1, 2, 3]; String(p[100]);')).toBe('undefined');
  expect(evaluated('const p = [1, 2, 3]; p[100] = 1; String(p[100]);')).toBe('1');
});

test('a window in range is unaffected', () => {
  const b = 'const b = new ArrayBuffer(4); ';
  expect(evaluated(`${b}const v = Span.<uint8>(b); v[3] = 7; String(v[3]);`)).toBe('7');
  expect(evaluated(`${b}String(Span.<uint8>(b)[0]);`)).toBe('0');
});

// -- the view signature matches the platform ----------------------------------

test('the third argument is a count, as every other view constructor takes', () => {
  // It was the STRIDE, so a call that looked exactly like a `%TypedArray%`
  // construction meant something else: `Span.<uint8>(b, 0, 4)` was a view of
  // two elements where `new Uint8Array(b, 0, 4)` is a view of four, and neither
  // reported anything. The two are asserted together, because agreeing with the
  // platform is the whole point of the position.
  const b = 'const b = new ArrayBuffer(8); ';
  expect(evaluated(`${b}String(Span.<uint8>(b, 0, 4).length);`)).toBe('4');
  expect(evaluated(`${b}String(new Uint8Array(b, 0, 4).length);`)).toBe('4');
  // the stride moved to fourth, where a capability nothing else has belongs
  expect(evaluated(`${b}String(Span.<uint8>(b, 0, undefined, 2).length);`)).toBe('4');
  expect(evaluated(`${b}String(Span.<uint8>(b, 0, 3, 2).length);`)).toBe('3');
  expectThrownKind(`${b}Span.<uint8>(b, 0, 99);`, 'RangeError');
});

test('a count present fixes the view, a count omitted tracks', () => {
  // The rule `%TypedArray%` and `DataView` already use, spelled the same way so
  // that a reader who knows one knows the other.
  const r = 'const rb = new ArrayBuffer(8, { maxByteLength: 16 }); ';
  expect(evaluated(`${r}const v = Span.<uint8>(rb); rb.resize(12); String(v.length);`)).toBe('12');
  expect(evaluated(`${r}const v = Span.<uint8>(rb, 0, 8); rb.resize(12); String(v.length);`)).toBe('8');
});

test('a fixed view whose bytes cease to exist reports a length of zero', () => {
  // It reported its ORIGINAL extent, describing a run of elements none of which
  // could be read - every access already refused and only the count disagreed.
  // A `%TypedArray%` in the same position answers 0, and is asserted beside it.
  const r = 'const rb = new ArrayBuffer(8, { maxByteLength: 16 }); ';
  expect(evaluated(`${r}const v = Span.<uint8>(rb, 0, 8); rb.resize(4); String(v.length);`)).toBe('0');
  expect(evaluated(`${r}const u = new Uint8Array(rb, 0, 8); rb.resize(4); String(u.length);`)).toBe('0');
  expectThrownKind(`${r}const v = Span.<uint8>(rb, 0, 8); rb.resize(4); v[0];`, 'TypeError');
  // and it recovers if the bytes come back, rather than being permanently dead
  expect(evaluated(`${r}const v = Span.<uint8>(rb, 0, 8); rb.resize(4); rb.resize(12); String(v.length);`)).toBe('8');
});

// -- instanceof and is answer the same question -------------------------------

test('instanceof on an array type goes through membership', () => {
  // #sec-instanceof-for-type-objects: a Type Object's %Symbol.hasInstance%
  // returns IsOfType(v, its [[TypeRecord]]). An array type in EXPRESSION
  // position is a constructor, so it inherited
  // `Function.prototype[%Symbol.hasInstance%]` and answered by walking the
  // prototype chain instead - every Array is an Array, so the answer was *true*
  // for a plain untyped array, for the wrong element type, and for a fixed
  // extent, while `is` answered correctly in all three.
  //
  // Each case is asserted through BOTH operators, because the defect was not a
  // wrong answer in isolation but two membership operators disagreeing.
  for (const [source, expected] of [
    ['const p = [1, 2];', false],
    ['let p: [].<uint8> = [1];', false],
    ['let p: [4].<uint32> = [1, 2, 3, 4];', false],
    ['let p: [].<uint32> = [1, 2];', true],
  ] as [string, boolean][]) {
    expect(bool(`${source} String(p instanceof [].<uint32>);`)).toBe(expected);
    expect(bool(`${source} String(p is [].<uint32>);`)).toBe(expected);
  }
});

test('instanceof on a scalar type is unchanged', () => {
  // The scalar types already routed through membership, and must keep doing so.
  expect(bool('let a: uint8 = 5; String(a instanceof uint8);')).toBe(true);
  expect(bool('let a: uint8 = 5; String(a instanceof uint16);')).toBe(false);
});

test('a fixed extent is an instance of its own type', () => {
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a instanceof [4].<uint32>);')).toBe(true);
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a instanceof [3].<uint32>);')).toBe(false);
});

// -- a coercion materialises at EVERY boundary --------------------------------

test('a window is built at a binding, a return, and a parameter alike', () => {
  // #sec-span-coercion says a coercion MATERIALIZES. It did so at a parameter
  // and nowhere else: the checker proved a binding and a return "had nothing to
  // do" because the source was already assignable, and eliding the check elided
  // the conversion with it.
  //
  // Every route is asserted because the defect was route-dependent, and every
  // existing test of this type used the one route that worked.
  const o = 'let owned: [].<uint32> = [1, 2, 3]; ';
  expect(bool(`${o}let w: Span.<uint32> = owned; String(w === owned);`)).toBe(false);
  expect(bool(`${o}function f(): Span.<uint32> { return owned; } String(f() === owned);`)).toBe(false);
  expect(bool(`${o}function f(s: Span.<uint32>) { return s; } String(f(owned) === owned);`)).toBe(false);
  expect(bool(`${o}let w: Span.<uint32> = owned; String(w is Span.<uint32>);`)).toBe(true);
  expect(bool(`${o}function f(): Span.<uint32> { return owned; } String(f() is Span.<uint32>);`)).toBe(true);
});

test('a window bound by a let has the window surface and not the array one', () => {
  // What the elision cost: a `Span.<uint32>` on the binding path WAS the array,
  // carrying every member the type says it does not have and obeying no
  // liveness rule.
  const o = 'let owned: [].<uint32> = [1, 2, 3]; let w: Span.<uint32> = owned; ';
  expect(evaluated(`${o}String(typeof w.push);`)).toBe('undefined');
  expect(evaluated(`${o}String(typeof w.capacity);`)).toBe('undefined');
  expect(evaluated(`${o}w[0] = (9 := uint32); String(owned[0]);`)).toBe('9');
  expectThrownKind(`${o}owned.push((4 := uint32)); w[0];`, 'TypeError');
});

test('an elision with nothing to do is still elided', () => {
  // The control. Only a boundary whose conversion has an EFFECT is kept - an
  // ordinary same-type binding still passes the value through, and identity
  // proves no work was done.
  expect(bool('let a: [].<uint32> = [1, 2]; let b: [].<uint32> = a; String(b === a);')).toBe(true);
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; let b: [4].<uint32> = a; String(b === a);')).toBe(true);
});

// -- assignment aliases; a disagreement is refused, not copied ----------------

test('an already-typed array is refused rather than rebuilt', () => {
  // Where the source arrives as `any`, a fixed array assigned to a dynamic
  // target was ACCEPTED and produced a copy. Sound, but it made one operation
  // mean two things: assignment aliases everywhere else, and `b === a` was the
  // only way to find out which had happened.
  //
  // It reached that path because the extent rule made membership answer *false*
  // for the pair, so the early return stopped firing and an already-typed array
  // fell into the branch meant for LITERALS.
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4]; let x = a; let b: [].<uint32> = x;', 'TypeError');
  // and the explicit route the message names still works
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; let b = [...a];'
    + ' b.push((5 := uint32)); String(b.length);')).toBe('5');
});

test('propagation is untouched: an UNTYPED array still adopts the element type', () => {
  // The feature the branch exists for. A literal, and a plain array reaching
  // the boundary as `any`, both become typed arrays whose elements are
  // converted - and both are new objects, which is correct for a literal.
  expect(bool('let b: [].<uint8> = [1, 2, 3]; String(b[0] is uint8);')).toBe(true);
  expect(bool('let x = [1, 2, 3]; let b: [].<uint8> = x; String(b[0] is uint8);')).toBe(true);
  expect(bool('let x = [1, 2, 3]; let b: [].<uint8> = x; String(b === x);')).toBe(false);
});

test('every other assignment still aliases', () => {
  // The controls, and they matter more than the refusal: refusing too much is
  // the likely failure, and identity is what shows it.
  expect(bool('let a: [].<uint32> = [1]; let b: [].<uint32> = a; String(b === a);')).toBe(true);
  expect(bool('let a: [].<uint32> = [1]; let x = a; let b: [].<uint32> = x; String(b === a);')).toBe(true);
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; let x = a; let b: [4].<uint32> = x; String(b === a);')).toBe(true);
});

test('the family bound admits a fixed array, and does not copy it', () => {
  // Bare `[]` is `[].<any>`, the top of the array and tuple family, so a fixed
  // array IS a member of it - the extent rule excepts it, because the family
  // bound is not a promise of growth but the statement that the element type is
  // not being constrained.
  //
  // Two clauses contradicted each other before this: `a is []` answered *false*
  // while a parameter typed `[]` accepted one, and it accepted one by COPYING,
  // since a failed membership sent the value to the conversion.
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a is []);')).toBe(true);
  expect(bool('function f(p: []) { return p; } let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' String(f(a) === a);')).toBe(true);
  // and the concrete-element rule is unaffected
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a is [].<uint32>);')).toBe(false);
});

// -- an optional stated length ------------------------------------------------

test('a source reaches Span.<T, N> only where its length is known to be N', () => {
  // #sec-span-type. A `[N].<T>` and a tuple know their length; a `[].<T>` does
  // not, its length being a run-time fact, so it reaches only the unstated
  // form. The second argument was parsed and IGNORED before this - a window of
  // 4 satisfied `Span.<uint32, 3>` and said nothing.
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' function f(p: Span.<uint32, 4>) { return p.length; } String(f(a));')).toBe('4');
  expectStaticTypeError('let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' function f(p: Span.<uint32, 3>) { return p.length; } f(a);');
  expectStaticTypeError('let d: [].<uint32> = [1, 2];'
    + ' function f(p: Span.<uint32, 2>) { return p.length; } f(d);');
  // a tuple knows its length
  expect(evaluated('let t: [uint8, uint8] = [1, 2];'
    + ' function f(p: Span.<uint8, 2>) { return p.length; } String(f(t));')).toBe('2');
});

test('forgetting a length is safe; inventing one is not', () => {
  // The asymmetry, which is the whole of the subtyping rule.
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' function g(p: Span.<uint32>) { return p.length; }'
    + ' function f(p: Span.<uint32, 4>) { return g(p); } String(f(a));')).toBe('4');
  expectStaticTypeError('function g(p: Span.<uint32, 4>) { return p.length; }'
    + ' function f(p: Span.<uint32>) { return g(p); }');
  expectStaticTypeError('function g(p: Span.<uint32, 3>) { return p.length; }'
    + ' function f(p: Span.<uint32, 4>) { return g(p); }');
});

test('a stated length decides a literal index', () => {
  // This is what the length in the type is FOR: an access it has proven to be
  // in range needs no per-element check. An unstated window has nothing to
  // decide against, and a computed index proves nothing either way, so both
  // keep the run-time check.
  expectStaticTypeError('function f(p: Span.<uint32, 4>) { return p[9]; }');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' function f(p: Span.<uint32, 4>) { return p[2]; } String(f(a));')).toBe('3');
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' function f(p: Span.<uint32>) { return p[9]; } f(a);', 'RangeError');
  expectThrownKind('let a: [4].<uint32> = [1, 2, 3, 4];'
    + ' function f(p: Span.<uint32, 4>) { let i = 9; return p[i]; } f(a);', 'RangeError');
});

test('a fixed SoA projects columns that carry their length', () => {
  // #sec-structure-of-arrays: a fixed `SoA.<T, N>` has columns of exactly N, so
  // the projection states its length; a growable one projects a window whose
  // length follows the container and cannot be stated.
  expect(evaluated('class P { x: float32; } let s: SoA.<P, 4> = new SoA.<P, 4>();'
    + ' function f(p: Span.<float32, 4>) { return p.length; } String(f(s.fields.x));')).toBe('4');
  expectStaticTypeError('class P { x: float32; } let s: SoA.<P, 4> = new SoA.<P, 4>();'
    + ' function f(p: Span.<float32, 3>) { return p.length; } f(s.fields.x);');
  expect(evaluated('class P { x: float32; } let s: SoA.<P> = new SoA.<P>(); s.push({ x: 1 });'
    + ' function f(p: Span.<float32>) { return p.length; } String(f(s.fields.x));')).toBe('1');
});

// -- the buffer bridge runs both ways -----------------------------------------

test('a view exposes its buffer, byte offset, and byte length', () => {
  // Without these the `%TypedArray%` bridge went one way only: `Span.<T>(u.buffer)`
  // went in and nothing came back, because a window could not say what buffer
  // it was over.
  const b = 'const b = new ArrayBuffer(8); const v = Span.<uint8>(b, 2); ';
  expect(evaluated(`${b}String(v.byteOffset);`)).toBe('2');
  expect(evaluated(`${b}String(v.byteLength);`)).toBe('6');
  expect(bool(`${b}String(v.buffer === b);`)).toBe(true);
  // the counts are counts, so they read at the index type
  expect(bool(`${b}String(v.byteOffset is uint64);`)).toBe(true);
  expect(bool(`${b}String(v.byteLength is uint64);`)).toBe(true);
  // and the byte length follows the element size, not the length
  expect(evaluated('const b2 = new ArrayBuffer(8); String(Span.<uint32>(b2).byteLength);')).toBe('8');
});

test('a window round-trips to a TypedArray and back', () => {
  // The requirement the bridge claims. It FAILED SILENTLY before: `v.buffer`
  // was `undefined`, the constructor read that as a length, and the program got
  // an empty array rather than an error.
  const b = 'const b = new ArrayBuffer(8); const v = Span.<uint8>(b, 2); ';
  expect(evaluated(`${b}String(new Uint8Array(v.buffer).length);`)).toBe('8');
  // and the two really are the same bytes
  expect(evaluated(`${b}v[0] = (9 := uint8); String(new Uint8Array(v.buffer)[2]);`)).toBe('9');
});

test('a window with no buffer beneath it reports the limit, not undefined', () => {
  // #sec-array-and-tuple-types says a typed array IS a contiguous buffer, so
  // this is an implementation limit rather than a rule of the language, and it
  // is reported as one. Answering `undefined` is what made the failure silent.
  expectThrownKind('let a: [].<uint8> = [1, 2, 3]; a.buffer;', 'TypeError');
  expectThrownKind('function w(s: Span.<uint32>) { return s; }'
    + ' let a: [].<uint32> = [1, 2]; w(a).buffer;', 'TypeError');
  // an owned array still reports its byte length, which it takes from its layout
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; String(a.byteLength);')).toBe('3');
  // and a plain array has none of the three
  expect(evaluated('const p = [1, 2]; String(typeof p.buffer);')).toBe('undefined');
});

// -- set and subarray ---------------------------------------------------------

test('set stores a run of elements, checking each', () => {
  // A `%TypedArray%` method with no `Array.prototype` equivalent. It is
  // LENGTH-PRESERVING, which is why a window may have it: it writes elements
  // and never grows.
  const a = 'let a: [].<uint8> = [1, 2, 3, 4]; ';
  expect(evaluated(`${a}a.set([9, 8]); a.join(",");`)).toBe('9,8,3,4');
  expect(evaluated(`${a}a.set([9, 8], 2); a.join(",");`)).toBe('1,2,9,8');
  // each element goes through the ordinary store, so it gets the ordinary check
  expectThrownKind(`${a}a.set([300]);`, 'RangeError');
  expectThrownKind(`${a}a.set([1, 2], 3);`, 'RangeError');
  // and it works on a window, which is the point of it being length-preserving
  expect(evaluated('const b = new ArrayBuffer(4); const v = Span.<uint8>(b);'
    + ' v.set([7, 6]); String(v[0]) + "/" + String(v[1]);')).toBe('7/6');
});

test('subarray aliases where slice copies', () => {
  // The distinction is the whole point of having both, and it is the reason
  // `subarray` belongs on a window: a subarray of anything is a window, since
  // it does not own the storage it names.
  const a = 'let a: [].<uint8> = [1, 2, 3, 4]; ';
  expect(evaluated(`${a}const s = a.subarray(1, 3); s[0] = (9 := uint8); String(a[1]);`)).toBe('9');
  expect(evaluated(`${a}const c = a.slice(1, 3); c[0] = (9 := uint8); String(a[1]);`)).toBe('2');
  expect(evaluated(`${a}String(a.subarray(1, 3).length);`)).toBe('2');
  expect(bool(`${a}String(a.subarray(1, 3) is Span.<uint8>);`)).toBe(true);
  expect(evaluated(`${a}String(a.subarray().length);`)).toBe('4');
});

test('subarray carves both backings a window can have', () => {
  // A window is one type over two representations - a run of an owned array's
  // elements, or a stretch of a buffer's bytes - and they carve differently:
  // one counts elements, one counts bytes. Both are asserted because handling
  // only the first is the mistake that is easy to make and hard to see.
  expect(evaluated('let a: [].<uint8> = [1, 2, 3, 4]; const w = a.subarray(0);'
    + ' const s = w.subarray(2); s[0] = (9 := uint8); String(a[2]);')).toBe('9');
  expect(evaluated('const b = new ArrayBuffer(4); const v = Span.<uint8>(b);'
    + ' v.set([1, 2, 3, 4]); const s = v.subarray(2); s[0] = (9 := uint8); String(v[2]);')).toBe('9');
});

test('both live on an array with an element type, and on no other array', () => {
  expect(evaluated('let a: [].<uint8> = [1]; String(typeof a.set) + "/" + String(typeof a.subarray);')).toBe('function/function');
  expect(evaluated('const b = new ArrayBuffer(4); const v = Span.<uint8>(b);'
    + ' String(typeof v.set) + "/" + String(typeof v.subarray);')).toBe('function/function');
  expect(evaluated('const p = [1]; String(typeof p.set) + "/" + String(typeof p.subarray);')).toBe('undefined/undefined');
});

// -- window() -----------------------------------------------------------------

test('window takes a window over part of an array, aliasing it', () => {
  // Documented in the design and absent from the engine until now. It is
  // `subarray` under the name the design uses, and it aliases - a copy would
  // break the example the README is built around, which writes through the
  // window and expects the original to change.
  const a = 'let a: [].<uint8> = [1, 2, 3, 4]; ';
  expect(evaluated(`${a}String(a.window(0, 2).length);`)).toBe('2');
  expect(bool(`${a}String(a.window(0, 2) is Span.<uint8>);`)).toBe(true);
  expect(evaluated(`${a}const w = a.window(1, 3); w[0] = (9 := uint8); String(a[1]);`)).toBe('9');
  // and on a window over a buffer, which carves by bytes rather than elements
  expect(evaluated('const b = new ArrayBuffer(4); const v = Span.<uint8>(b); v.set([1, 2, 3, 4]);'
    + ' const w = v.window(2, 4); w[0] = (9 := uint8); String(v[2]);')).toBe('9');
  expect(evaluated('const p = [1, 2]; String(typeof p.window);')).toBe('undefined');
});

test('window.<N> returns a window of exactly N and checks once that it fits', () => {
  // The overload the design's Bounds Checks section is about: the length is in
  // the TYPE, so an index the checker can prove is below N needs no
  // per-element check, and `window(start, start + N)` cannot say that.
  //
  // The bounds check belongs to this form rather than to plain `window`, which
  // CLAMPS the way `subarray` does - clamping is right for a range and wrong
  // for a promise of exactly N elements.
  const rows = 'const rows: [64].<uint32> = new [64].<uint32>(); ';
  expect(evaluated(`${rows}String(rows.window.<8>(0).length);`)).toBe('8');
  expect(evaluated(`${rows}String(rows.window.<8>(16).length);`)).toBe('8');
  expectThrownKind(`${rows}rows.window.<8>(60);`, 'RangeError');
});

test('the design README example works as written', () => {
  // `row[0] = 1; rows[entityIndex * 8]` reading 1 back is the whole claim: the
  // window is the same storage, not a copy of it.
  expect(evaluated('const rows: [64].<uint32> = new [64].<uint32>();'
    + ' const row = rows.window.<8>(2 * 8); row[0] = (1 := uint32); String(rows[16]);')).toBe('1');
});
