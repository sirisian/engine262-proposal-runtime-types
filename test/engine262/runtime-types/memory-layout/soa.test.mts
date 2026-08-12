import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-structure-of-arrays (Structure of Arrays), #sec-soa-references,
 * #sec-array-views. Design: soa.md.
 *
 * An SoA holds each field of its element type in its own column, so an element
 * is gathered on read and scattered on write. The reference forms iterate the
 * columns in place, and the view forms alias bytes that already exist.
 */

test('soa: SoA is a type name, and its layout is the column rule', () => {
  // soa.md: `SoA.<T, Length>` is "a built-in exotic in the same way `[].<T>` is:
  // something no user-defined class could express, specified by the language and
  // provided by the engine". A type name, and unlike the library names beside it
  // in the table NOT a global constructor whose prototype chain decides
  // membership.
  // An alias: a binding of a type with no default is refused, and `SoA` is a
  // library nominal rather than a value type class.
  expect(evaluated('class T { x: float32; } type S = SoA.<T, 4>; "ok";')).toBe('ok');

  // The layout table's row: "each field of `T` is a COLUMN of _N_ elements,
  // PADDED AND ALIGNED ON ITS OWN, and the size is the sum of the columns. An
  // element's fields are not adjacent."
  //
  // THE ASSERTION THAT DISCRIMINATES is the design's own claim: "a `T` whose
  // interleaved layout pads to a larger stride has an `SoA.byteLength` SMALLER
  // than its `[].<T>` equivalent". `Pad` interleaves to 16 (a uint8, then a
  // float64 at offset 8), so four of them is 64 - while the columns are 4 bytes
  // of `a`, aligned up to 8, then 32 of `b`: 40. A `T` that does not pad gives
  // the same number either way, so testing only that would prove nothing.
  const pad = 'class Pad { a: uint8; b: float64; } ';
  expect(evaluated(`${pad} String((type Pad).byteLength * 4);`)).toBe('64');
  expect(evaluated(`${pad} const S = type SoA.<Pad, 4>; String(S.byteLength) + "/" + String(S.alignment);`)).toBe('40/8');

  // The split is ONE LEVEL, not recursive to the leaves: a field that is itself
  // a value type stays one column, interleaved within itself. soa.md makes that
  // deliberate - a consumer wanting `origin` as a contiguous stream of Vec2 gets
  // it, and flattening the class is how a program asks for the other thing.
  const proj = 'class Vec2 { x: float32; y: float32; } class P { origin: Vec2; direction: Vec2; speed: float32; } ';
  expect(evaluated(`${proj} String((type SoA.<P, 4>).byteLength);`)).toBe('80');
  // `elementByteLength` is the PER-ELEMENT SUM OF COLUMN STRIDES, which is not
  // the interleaved stride: `Pad` sums to 9 where its interleaved stride is 16.
  expect(evaluated(`${pad} String((type SoA.<Pad, 4>).elementByteLength);`)).toBe('9');
  expect(evaluated(`${proj} String((type SoA.<P, 4>).elementByteLength);`)).toBe('20');
  // A type with no columns has none.
  expect(evaluated('String(float64.elementByteLength);')).toBe('undefined');

  // "A PRIMITIVE `T` IS PERMITTED and degenerates to a single column, so generic
  // code that may or may not be handed a primitive needs no special case."
  expect(evaluated('const F = type SoA.<float32, 4>; String(F.byteLength) + "/" + String(F.alignment);')).toBe('16/4');

  // REJECTIONS. "`T` must be a value type class, since a class with a reference
  // field has nothing to split", and a growable `SoA.<T>` has no layout as a
  // TYPE exactly as `[].<T>` has none - its instances have a byteLength.
  expectThrown('class Ref { s: string; } (type SoA.<Ref, 4>).byteLength;');
  expectThrown('class U { a: uint8; b; } (type SoA.<U, 4>).byteLength;');
  expectThrown('class Ok { a: uint8; } (type SoA.<Ok>).byteLength;');
});

// -- threading: shared classes and threads -------------------------------------

test('soa: allocation, capacity, and reserve', () => {
  // soa.md's class shape: `constructor()`, `constructor(length)` for growable
  // arrays, `length`, `capacity`, `byteLength`, and `reserve(n)` - "grow every
  // column to hold at least n elements".
  //
  // ONE ALLOCATION with the columns at computed offsets, not one allocation per
  // column: "a byte view over an `SoA` sees the columns in declaration order,
  // one after another. That is also its serialization order, and it's why
  // `byteLength` is a sum of column lengths."
  const pad = 'class Pad { a: uint8; b: float64; } ';

  // A FIXED extent is its length from construction, as `[N].<T>` is.
  expect(evaluated(`${pad} const s = new SoA.<Pad, 4>(); String(s.length) + "/" + String(s.capacity);`)).toBe('4/4');
  // And the instance's byteLength agrees with the TYPE's, which is the check
  // that the constructor and the layout rule compute the same thing rather than
  // two things that happen to look alike.
  expect(evaluated(`${pad} const s = new SoA.<Pad, 4>(); String(s.byteLength) + "/" + String((type SoA.<Pad, 4>).byteLength);`)).toBe('40/40');

  // A GROWABLE form starts empty, and takes an optional initial length.
  expect(evaluated(`${pad} const g = new SoA.<Pad>(); String(g.length) + "/" + String(g.capacity);`)).toBe('0/0');
  expect(evaluated(`${pad} const g = new SoA.<Pad>(3); String(g.length) + "/" + String(g.capacity);`)).toBe('3/3');

  // `reserve` grows every column. The size is the discriminating part: for
  // capacity 8 the `a` column is 8 bytes, the `b` column is aligned to 8 and is
  // 64, so 72 - which is not 8 times anything, because the columns are padded
  // and aligned on their own rather than sharing an element stride.
  expect(evaluated(`${pad} const g = new SoA.<Pad>(); g.reserve(8); String(g.capacity) + "/" + String(g.byteLength);`)).toBe('8/72');
  // Reserving below the current capacity does nothing.
  expect(evaluated(`${pad} const g = new SoA.<Pad>(4); g.reserve(2); String(g.capacity);`)).toBe('4');

  // REJECTIONS. A fixed extent has nothing to reallocate - `push`, `pop`, and
  // `reserve` "are already absent from an `SoA.<T, N>` as they are from a
  // `[N].<T>`". An SoA needs an element type, since the columns ARE the type
  // argument. And a `T` that cannot be split into columns is refused here as it
  // is by the layout rule.
  expectThrown(`${pad} new SoA.<Pad, 4>().reserve(8);`);
  expectThrown('new SoA();');
  expectThrown('SoA();');
  expectThrown('class Ref { s: string; } new SoA.<Ref, 2>();');
});

test('soa: the element boundary gathers and scatters', () => {
  // soa.md: "Every operation that reads or writes an element behaves as it does
  // on `[].<T>`." `particles[0]` gathers a value from the columns and
  // `particles[0] = spawned` scatters the fields into them.
  const pad = 'class Pad { a: uint8; b: float64; } ';

  // ZERO-FILL: a fixed
  // `SoA.<T, N>` holds N zero-filled elements from construction, the same rule
  // that makes `let d: [10].<A>` hold ten of them.
  expect(evaluated(`${pad} const s = new SoA.<Pad, 4>(); String(Number(s[0].a)) + "/" + String(Number(s[0].b));`)).toBe('0/0');

  // The round trip, and that it touches ONE element: a scatter that wrote the
  // whole column would pass a round-trip test on its own.
  const one = `${pad} const s = new SoA.<Pad, 4>(); s[1] = { a: 7, b: 2.5 }; `;
  expect(evaluated(`${one} String(Number(s[1].a)) + "/" + String(Number(s[1].b));`)).toBe('7/2.5');
  expect(evaluated(`${one} String(Number(s[0].a)) + "/" + String(Number(s[2].a));`)).toBe('0/0');

  // A GATHER IS A COPY, because a value type copies. `s[0].x = 5` therefore
  // writes to that copy and is lost - which is the ordinary rule for `[N].<T>`
  // too, and is why `ref` exists. It will be the first thing someone trips
  // over, so it is asserted rather than left to be discovered.
  expect(evaluated(`${one} const c = s[1]; c.a = 9; String(Number(s[1].a)) + "/" + String(Number(c.a));`)).toBe('7/9');

  // The store check applies PER COLUMN, against that column's declared type.
  expectThrownKind(`${pad} const s = new SoA.<Pad, 2>(); s[0] = { a: 300, b: 1 };`, 'RangeError');
  // An index past the end reads *undefined*, as an array does.
  expect(evaluated(`${pad} const s = new SoA.<Pad, 2>(); String(s[5]);`)).toBe('undefined');

  // A PRIMITIVE element degenerates to a single column, and its element is the
  // column's value rather than an object with fields.
  expect(evaluated('const p = new SoA.<float32, 3>(); p[0] = 1.5; String(Number(p[0]));')).toBe('1.5');
});

test('soa: push, pop, fill, and toArray', () => {
  const pad = 'class Pad { a: uint8; b: float64; } ';
  // `push` "appends to every column" and returns the new length; growth doubles
  // the capacity, so a run of pushes does not recopy every column each time.
  const pushed = `${pad} const g = new SoA.<Pad>(); g.push({ a: 1, b: 1.5 }); g.push({ a: 2, b: 2.5 }); `;
  expect(evaluated(`${pushed} String(g.length);`)).toBe('2');
  expect(evaluated(`${pushed} String(Number(g[0].a)) + "/" + String(Number(g[1].b));`)).toBe('1/2.5');
  // The elements survive the reallocation growth causes, which is the part a
  // length check alone would not show.
  expect(evaluated(`${pushed} for (let i = 0; i < 20; i = i + 1) { g.push({ a: 5, b: 0.5 }); } String(Number(g[0].a)) + "/" + String(Number(g[1].b)) + "/" + String(g.length);`)).toBe('1/2.5/22');

  expect(evaluated(`${pushed} const p = g.pop(); String(Number(p.a)) + "/" + String(g.length);`)).toBe('2/1');
  expect(evaluated(`${pad} const g = new SoA.<Pad>(); String(g.pop());`)).toBe('undefined');
  expect(evaluated(`${pad} const f = new SoA.<Pad, 3>(); f.fill({ a: 9, b: 0.5 }); String(Number(f[0].a)) + String(Number(f[1].a)) + String(Number(f[2].a));`)).toBe('999');

  // `toArray` COPIES: "SoA.<T> and [].<T> are distinct types with distinct
  // layouts, and neither is assignable to the other."
  const conv = `${pad} const f = new SoA.<Pad, 2>(); f.fill({ a: 4, b: 1 }); const arr = f.toArray(); `;
  expect(evaluated(`${conv} String(arr.length) + "/" + String(Number(arr[0].a));`)).toBe('2/4');
  expect(evaluated(`${conv} arr[0].a = 8; String(Number(f[0].a));`)).toBe('4');

  // A fixed extent has nothing to reallocate.
  expectThrown(`${pad} new SoA.<Pad, 2>().push({ a: 1, b: 1 });`);
  expectThrown(`${pad} new SoA.<Pad, 2>().pop();`);
});

test('soa: a ref into an SoA is a column set and an index', () => {
  // soa.md: "A `ref` binding is a reference to the element, which for an `SoA`
  // is A COLUMN SET AND AN INDEX. Field accesses through it compile to a load or
  // store on one column."
  //
  // This is NOT the proxy object soa.md forecloses. A proxy traps every field
  // access and checks it at the read; this computes the read from the columns
  // directly, which is the mechanism a placed instance's fields already use.
  const pad = 'class Pad { a: uint8; b: float64; } const s = new SoA.<Pad, 3>(); const seed = new Pad(); seed.a = 1; seed.b = 1.5; s[0] = seed; ';
  expect(evaluated(`${pad} const ref p = s[0]; String(Number(p.a)) + "/" + String(Number(p.b));`)).toBe('1/1.5');
  // THE WRITE THROUGH, which is the whole point: a `ref` names storage, so a
  // field write lands in the column and is visible through the element API.
  expect(evaluated(`${pad} const ref p = s[0]; p.a = 9; String(Number(s[0].a));`)).toBe('9');
  expect(evaluated(`${pad} const ref p = s[0]; p.a = 9; String(Number(s[1].a));`)).toBe('0');
  // And the GATHER remains a copy, which is the distinction the design rests
  // on: `s[i]` copies, `ref s[i]` names storage. Both are correct.
  expect(evaluated(`${pad} const c = s[0]; c.a = 4; String(Number(s[0].a));`)).toBe('1');

  // THE ASSERTION THAT MATTERS. "Because a reference names storage rather than
  // an object, `SoA` and `[].<T>` present the same interface to every function
  // that takes a `ref Particle`. A system written against one storage works
  // against the other" - and neither call site says which layout produced the
  // reference. No other test proves this.
  const cross = 'class Particle { x: float32; y: float32; } '
    + 'function move(p: ref Particle) { p.x = Number(p.x) + 1; } '
    + 'const soa = new SoA.<Particle, 2>(); const seed = new Particle(); seed.x = 10; soa[0] = seed; '
    + 'let arr: [2].<Particle>; arr[0].x = 20; '
    + 'move(ref soa[0]); move(ref arr[0]); ';
  expect(evaluated(`${cross} String(Number(soa[0].x)) + "/" + String(Number(arr[0].x));`)).toBe('11/21');

  // "A reference into an `SoA` PINS THE CONTAINER as well as the element: a
  // `push` that reallocates moves every column, so growing an `SoA` while a
  // reference into it is live is a TypeError, exactly as changing an array's
  // length during `ref` iteration is."
  const grow = 'class P { a: uint8; } const g = new SoA.<P>(); const seed = new P(); seed.a = 1; '
    + 'g.push(seed); g.push(seed); const ref r = g[0]; ';
  expect(evaluated(`${grow} String(Number(r.a));`)).toBe('1');
  expectThrownKind(`${grow} for (let i = 0; i < 10; i = i + 1) { g.push(seed); } r.a;`, 'TypeError');
  // A fixed extent cannot grow, so a reference into one never moves.
  expect(evaluated('class P { a: uint8; } const f = new SoA.<P, 2>(); const ref fr = f[0]; fr.a = 7; String(Number(f[0].a));')).toBe('7');
});

test('soa: reference iteration mutates in place', () => {
  // soa.md: "for (const ref p of particles) { p.position += p.velocity * dt; }
  // // Reference iteration, as on any typed array."
  //
  // Each iteration binds the element VIEW - the column set and the index -
  // rather than a location, because a location over an SoA index would gather a
  // COPY and every write through the binding would be lost. Same distinction
  // the `ref` binding form draws, same reason it exists.
  expect(evaluated('class P { a: uint8; } const s = new SoA.<P, 3>(); for (const ref p of s) { p.a = 7; } String(Number(s[0].a)) + String(Number(s[1].a)) + String(Number(s[2].a));')).toBe('777');

  // The design's own loop, in two passes so the second reads what the first
  // wrote - which is what shows the writes reaching the columns rather than a
  // per-iteration copy.
  const particles = 'class Particle { position: float32; velocity: float32; } '
    + 'const particles = new SoA.<Particle, 3>(); '
    + 'for (const ref p of particles) { p.velocity = 2; } '
    + 'const dt = 0.5; '
    + 'for (const ref p of particles) { p.position = Number(p.position) + Number(p.velocity) * dt; } ';
  expect(evaluated(`${particles} String(Number(particles[0].position)) + "/" + String(Number(particles[2].position));`)).toBe('1/1');

  // The length is fixed, and for a sharper reason than an array's: growth
  // reallocates every column, so a reference taken in an earlier iteration is
  // invalidated by a `push` in a later one.
  const grow = 'class Particle { position: float32; velocity: float32; } '
    + 'const g = new SoA.<Particle>(); const seed = new Particle(); g.push(seed); g.push(seed); ';
  expectThrownKind(`${grow} for (const ref p of g) { g.push(seed); }`, 'TypeError');

  // Array reference iteration is untouched - the SoA path is taken only for an
  // SoA, and the loop that already worked still does.
  expect(evaluated('class P { a: uint8; } let d: [2].<P>; for (const ref q of d) { q.a = 3; } String(Number(d[0].a)) + String(Number(d[1].a));')).toBe('33');
});

test('array views alias bytes that already exist', () => {
  // README, "Views": `[].<T>(buffer [, byteOffset [, byteElementLength]])`.
  // "The `buffer` argument accepts any typed array as well as existing
  // `TypedArray`, `ArrayBuffer`, and `SharedArrayBuffer` instances, so a
  // `[].<uint8>` and a `Uint8Array` viewing the same buffer ALIAS THE SAME
  // MEMORY."
  const setup = 'const buf = new ArrayBuffer(16); const u8 = new Uint8Array(buf); for (let i = 0; i < 16; i = i + 1) { u8[i] = i; } ';
  expect(evaluated(`${setup} const v = [].<uint8>(buf); String(v.length) + "/" + String(Number(v[2]));`)).toBe('16/2');
  // Aliasing in BOTH directions is the assertion that matters: a view that
  // copied would pass a read test on its own.
  expect(evaluated(`${setup} const v = [].<uint8>(buf); v[3] = 9; String(u8[3]);`)).toBe('9');
  // A wider element divides the extent.
  expect(evaluated(`${setup} String([].<uint32>(buf).length);`)).toBe('4');

  // "By default `byteElementLength` is the size of the array's type ... [it] can
  // be less than or greater than the actual size of the type", which is how the
  // design reads `uint16`s at a 3-byte stride out of an array of a 3-byte
  // class. Offset 1 with stride 3 over 0..15 gives five elements, and the first
  // is bytes 1 and 2 little-endian: 0x0201.
  expect(evaluated(`${setup} const s = [].<uint16>(buf, 1, 3); String(s.length) + "/" + String(Number(s[0]));`)).toBe('5/513');

  // "A `[].<T>` view is LENGTH-TRACKING: its length derives from the buffer's
  // current byte length, growing and shrinking as the buffer is resized. A fixed
  // `[N].<T>` view has a fixed byte extent recorded at construction; if the
  // buffer shrinks below that extent the view is detached and any access throws
  // a TypeError. GROWTH NEVER INVALIDATES A VIEW."
  const rz = 'const rb = new ArrayBuffer(16, { maxByteLength: 64 }); const track = [].<uint8>(rb); const fixed = [8].<uint8>(rb); ';
  expect(evaluated(`${rz} String(track.length);`)).toBe('16');
  expect(evaluated(`${rz} rb.resize(32); String(track.length);`)).toBe('32');
  expect(evaluated(`${rz} rb.resize(4); String(track.length);`)).toBe('4');
  expectThrownKind(`${rz} rb.resize(4); fixed[0];`, 'TypeError');
  // A fixed view whose extent does not fit is refused at construction.
  expectThrownKind('const b = new ArrayBuffer(4); [8].<uint8>(b);', 'RangeError');
});

test('soa: a fixed SoA views bytes that already exist', () => {
  // soa.md, "Views": "The form is the array view's. It is A CALL ON THE TYPE
  // rather than a `new`, because nothing is constructed, and the buffer argument
  // accepts what `[].<T>`'s does ... so an `SoA` view and a `[].<uint8>` over
  // the same bytes alias the same memory."
  const pad = 'class Pad { a: uint8; b: float64; } const need = (type SoA.<Pad, 4>).byteLength; '
    + 'const align = (type SoA.<Pad, 4>).alignment; const buf = new ArrayBuffer(need + 32); ';
  expect(evaluated(`${pad} const v = SoA.<Pad, 4>(buf, 0); String(v.length) + "/" + String(v.byteLength);`)).toBe('4/40');
  // ALIASING is the assertion that matters: a view that copied would pass a
  // read test on its own.
  expect(evaluated(`${pad} const v = SoA.<Pad, 4>(buf, 0); const seed = new Pad(); seed.a = 7; v[0] = seed; String(new Uint8Array(buf)[0]);`)).toBe('7');

  // "byteOffset must be a multiple of SoA.<T, Length>.alignment, or it's a
  // TypeError. Columns are placed relative to the base, so a misaligned base
  // misaligns every column and there would be nothing left of the
  // aligned-lane-load guarantee."
  expectThrownKind(`${pad} SoA.<Pad, 4>(buf, 1);`, 'TypeError');
  expect(evaluated(`${pad} String(SoA.<Pad, 4>(buf, align).length);`)).toBe('4');
  // "The buffer must hold SoA.<T, Length>.byteLength bytes past byteOffset, or
  // it's a TypeError."
  expectThrownKind('class Pad { a: uint8; b: float64; } SoA.<Pad, 4>(new ArrayBuffer(8), 0);', 'TypeError');

  // "ONLY THE FIXED FORM IS VIEWABLE, and the reason is the layout rather than
  // caution ... an `SoA`'s capacity is baked into every column's offset, so
  // growth moves every column after the first, and a length-tracking `SoA` view
  // would be describing a layout that is no longer there."
  expectThrownKind(`${pad} SoA.<Pad>(buf, 0);`, 'TypeError');

  // "Detachment follows the fixed array view: shrinking a resizable buffer below
  // the view's extent detaches it and any access afterward is a TypeError, while
  // GROWTH NEVER INVALIDATES IT."
  const rz = 'class Pad { a: uint8; b: float64; } const need = (type SoA.<Pad, 4>).byteLength; '
    + 'const rb = new ArrayBuffer(need, { maxByteLength: need * 4 }); const v = SoA.<Pad, 4>(rb, 0); '
    + 'const seed = new Pad(); seed.a = 3; v[0] = seed; ';
  expect(evaluated(`${rz} String(Number(v[0].a));`)).toBe('3');
  expect(evaluated(`${rz} rb.resize(need * 2); String(Number(v[0].a));`)).toBe('3');
  expectThrownKind(`${rz} rb.resize(8); v[0];`, 'TypeError');

  // "A viewed `SoA` is the same object an allocated one is." A `ref` into one
  // borrows the same way, which is what makes the view worth having: a host
  // hands over one buffer and the script iterates its storage with no copy.
  expect(evaluated(`${pad} const v = SoA.<Pad, 4>(buf, 0); const ref r = v[1]; r.a = 6; String(Number(v[1].a));`)).toBe('6');
});

test('soa: conversion is explicit and copies, and the two types are distinct', () => {
  // soa.md, "Conversion": "`SoA.<T>` and `[].<T>` are DISTINCT TYPES WITH
  // DISTINCT LAYOUTS, and NEITHER IS ASSIGNABLE TO THE OTHER. Conversion is
  // explicit and copies."
  const arr = 'class Pad { a: uint8; } let arr: [3].<Pad>; arr[0].a = 1; arr[1].a = 2; arr[2].a = 3; ';

  // `SoA.from` takes the element type from the array's own, so the caller does
  // not restate it, and produces a growable SoA as the signature says.
  expect(evaluated(`${arr} const s = SoA.from(arr); String(s.length) + "/" + String(Number(s[0].a)) + "/" + String(Number(s[2].a));`)).toBe('3/1/3');
  // An untyped array has no element type to take, and is refused rather than
  // guessed at.
  expectThrown('SoA.from([1, 2, 3]);');

  // THE CONVERSION COPIES, in both directions. A view would alias; this does
  // not, and the design is explicit that it must not.
  expect(evaluated(`${arr} const s = SoA.from(arr); const ref r = s[0]; r.a = 9; String(Number(arr[0].a)) + "/" + String(Number(s[0].a));`)).toBe('1/9');
  expect(evaluated(`${arr} const s = SoA.from(arr); const back = s.toArray(); back[0].a = 4; String(Number(s[0].a));`)).toBe('1');

  // `withCapacity.<T>(n)` - "Empty, capacity >= n". Its element type is a TYPE
  // argument because there is no value to infer it from.
  expect(evaluated('class Pad { a: uint8; } const w = SoA.withCapacity.<Pad>(8); String(w.length) + "/" + String(w.capacity);')).toBe('0/8');

  // NEITHER DIRECTION ASSIGNS. The array-into-SoA direction was already an early
  // error; the SoA-into-array direction was NOT, because the membership judgment
  // is structural - a `length` and elements of the right type - and an SoA has
  // both, so it satisfied an array type by duck typing. That is precisely what
  // the design refuses: "making the two silently interchangeable ... reads well
  // until a function needs the concrete layout, and then the abstraction has to
  // be undone."
  expectThrown('class Pad { a: uint8; } let arr: [2].<Pad>; let t: SoA.<Pad, 2> = arr;');
  expectThrownKind('class Pad { a: uint8; } const s = new SoA.<Pad, 2>(); let u: [2].<Pad> = s;', 'TypeError');
});

test('soa: fields projects each column as a live view', () => {
  // soa.md: "`fields` projects each of `T`'s immediate fields as an array view
  // ALIASING THAT FIELD'S COLUMN. The views are LIVE: writes through them are
  // visible through the element API and the reverse."
  const pad = 'class Pad { a: uint8; b: float64; } const s = new SoA.<Pad, 3>(); ';
  expect(evaluated(`${pad} Object.getOwnPropertyNames(s.fields).join(",");`)).toBe('a,b');
  expect(evaluated(`${pad} String(s.fields.a.length);`)).toBe('3');

  // LIVENESS IN BOTH DIRECTIONS is the assertion that matters: a projection
  // that copied would pass a read test on its own.
  expect(evaluated(`${pad} s.fields.a[1] = 9; String(Number(s[1].a));`)).toBe('9');
  expect(evaluated(`${pad} const ref r = s[2]; r.a = 4; String(Number(s.fields.a[2]));`)).toBe('4');
  // "mesh.fields.color.fill(0xFFFFFFFF); // Writes one column across every
  // element" - one column touched, the others not.
  expect(evaluated(`${pad} const c = s.fields.a; c[0] = 1; c[1] = 2; c[2] = 3; String(Number(s[1].a)) + "/" + String(Number(s[1].b));`)).toBe('2/0');

  // "The projections live under `fields` RATHER THAN ON THE CONTAINER so a field
  // named `length` or `push` collides with nothing."
  expect(evaluated('class C { length: uint8; push: uint8; } const t = new SoA.<C, 2>(); String(t.length) + "/" + String(t.fields.length.length);')).toBe('2/2');

  // THE SPLIT IS ONE LEVEL. "Nested value type fields project as columns of
  // that type, so `p.fields.origin` is a `[].<Vec2>` and `p.fields.origin.x`
  // doesn't exist; flatten the class if that's what's wanted."
  const proj = 'class Vec2 { x: float32; y: float32; } class Projectile { origin: Vec2; direction: Vec2; speed: float32; } const p = new SoA.<Projectile, 4>(); ';
  expect(evaluated(`${proj} Object.getOwnPropertyNames(p.fields).join(",");`)).toBe('origin,direction,speed');
  expect(evaluated(`${proj} String(p.fields.origin.length) + "/" + String(p.fields.origin.x);`)).toBe('4/undefined');
  // A nested column is read and written as an aggregate at its offset - the
  // same bytes a placed instance of that class describes, decoded the same way.
  expect(evaluated(`${proj} const ref r = p[1]; r.origin.x = 7; String(Number(p[1].origin.x)) + "/" + String(Number(p[0].origin.x));`)).toBe('7/0');
});

test('soa: the three open questions, resolved', () => {
  // 1. A `fields` projection of a GROWABLE SoA is invalidated by a growth that
  // reallocates, exactly as a `ref` into the same SoA is. Before this, the
  // projection kept reading the ABANDONED allocation and disagreed with its
  // container silently - the one outcome none of the alternatives chose.
  //
  // Invalidating rather than preventing is what a GC language can express:
  // Rust's borrow checker refuses the program outright and pays nothing, but
  // nothing here marks the end of a projection's life, so a container that
  // could not grow while one had ever been taken could never grow again.
  const grow = 'class P { a: uint8; } const g = new SoA.<P>(); const seed = new P(); seed.a = 1; '
    + 'g.push(seed); g.push(seed); const col = g.fields.a; ';
  expect(evaluated(`${grow} String(Number(col[0]));`)).toBe('1');
  expectThrownKind(`${grow} for (let i = 0; i < 20; i = i + 1) { g.push(seed); } col[0];`, 'TypeError');
  // A fresh projection after the growth is fine, and a FIXED SoA can never be
  // invalidated at all - which is the case the performance argument cares
  // about, since its accesses have no check to make.
  expect(evaluated(`${grow} for (let i = 0; i < 20; i = i + 1) { g.push(seed); } String(Number(g.fields.a[0]));`)).toBe('1');
  expect(evaluated('class P { a: uint8; } const f = new SoA.<P, 3>(); const fc = f.fields.a; fc[0] = 5; String(Number(f[0].a));')).toBe('5');

  // 2. `Length` is defaulted, so `SoA.<T>` and `SoA.<T, 0>` name ONE type - as a
  // defaulted parameter does in C++, TypeScript, and Rust alike. Two interned
  // records for one type cost a `===` that answers *false* and, under
  // monomorphization, room for two specializations of the same generic.
  expect(evaluated('class P { a: uint8; } String((type SoA.<P>) === (type SoA.<P, 0>));')).toBe('true');
  expect(evaluated('class P { a: uint8; } const g = new SoA.<P>(); String(g.length) + "/" + String(g.capacity);')).toBe('0/0');

  // 3. Each column is aligned to its ELEMENT TYPE and to nothing wider. A vector
  // width is a property of the host, so folding one in would make the same SoA a
  // different size on different implementations and cost `byteLength` its place
  // among the compile-time constants. Where the allocation is PLACED is a
  // separate question and the implementation's own.
  expect(evaluated('class P { a: uint8; b: float64; } String((type SoA.<P, 4>).alignment);')).toBe('8');
  expect(evaluated('class F { x: float32; } String((type SoA.<F, 4>).alignment);')).toBe('4');
  // And byteLength stays exactly the sum the layout rule computes.
  expect(evaluated('class P { a: uint8; b: float64; } String((type SoA.<P, 4>).byteLength);')).toBe('40');
});
