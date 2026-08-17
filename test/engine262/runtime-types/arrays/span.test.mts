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
    + ' function f(p: Span.<uint8>) { return p.length; } String(f([].<uint8>(b)));')).toBe('4');
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
  expect(evaluated('function f(p: Span.<uint32>) { let n: uint32 = p.length; return n; }'
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
  const v = 'const b = new ArrayBuffer(4); const v = [].<uint8>(b); ';
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
  const v = 'const b = new ArrayBuffer(4); const v = [].<uint8>(b); ';
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

test('the old spellings still construct', () => {
  // Deliberately NOT yet an error. The fixed view is `[N].<T>(buffer, ...)` and
  // takes its extent from the array type's brackets; `Span.<T>` has no brackets
  // to take one from, so retiring the old spelling waits on deciding where a
  // fixed view's extent lives.
  const b = 'const b = new ArrayBuffer(8); ';
  expect(evaluated(`${b}String([].<uint8>(b).length);`)).toBe('8');
  expect(evaluated(`${b}String([8].<uint8>(b).length);`)).toBe('8');
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

test('the per-field hop is not yet typed', () => {
  // `s.fields` is an object of `Span.<F>` properties, and `s.fields.x` should
  // therefore be a `Span.<float32>` - it is not, it is ~any~, so the refusal
  // below comes from the run-time boundary rather than the checker. The
  // property record carries the right keys and the right types; what does not
  // happen is the second member access reading them.
  //
  // Asserted so the boundary is recorded rather than assumed. When the hop is
  // fixed this test fails and says so, which is how the previous limit here was
  // caught moving.
  expectThrownKind('class P { x: float32; } let s: SoA.<P> = new SoA.<P>(); s.push({ x: 1 });'
    + ' let z: string = s.fields.x;', 'TypeError');
  // and what already works regardless: the window itself is right
  expect(evaluated('class P { x: float32; } let s: SoA.<P> = new SoA.<P>(); s.push({ x: 1 });'
    + ' let z: Span.<float32> = s.fields.x; String(z.length);')).toBe('1');
});
