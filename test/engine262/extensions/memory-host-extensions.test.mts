import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown, expectThrownKind, evaluatedSeeded } from '../readme/harness.mts';

/**
 * Extension coverage — memorylayout.md, soa.md, threading.md, decorators.md, and
 * the value level of primitivemetadata.md.
 *
 * These extensions each need a subsystem the engine does not have (a memory
 * backing store, heap sharing across agents, or decorator-syntax parsing under
 * this feature), so they are largely deferred (capability X). Primitive metadata
 * PARSES and interns but does not carry/validate the metadata. This file records
 * the boundaries; the type-object half of reflection is covered separately in
 * typeobjects.test.mts.
 */

// ── memorylayout: decorators and byte layout ──────────────────────────────────
test('memory layout: the reserved layout controls place a class and its fields', () => {
  // GAP CLOSED. This documented that `@packed` did not parse under the feature,
  // because the `@` token was gated on the TC39 `decorators` feature alone.
  // That feature is a COMPETING decorator proposal - it calls a decorator with
  // the `(value, context)` convention where this proposal identifies one by the
  // type of its context parameter and resolves overloads - so the two are now
  // mutually exclusive and `runtime-types` supplies the grammar itself.
  //
  // The seven controls are not decorators in that semantic sense at all: they
  // name no function and take no context, they set property-descriptor keys.
  // So they are recognized syntactically and never evaluated.
  expect(evaluated('@packed class A { a: uint8; b: uint16; } String((type A).byteLength) + "/" + String((type A).alignment);')).toBe('3/1');
  expect(evaluated('@packed class A { a: uint8; b: uint16; } String(Reflect.getReflection.<Reflect.ClassField, A>("b").offset);')).toBe('1');
  // The design's four-control example, which exercises `alignAll`, `size`,
  // `offset`, and `align` in one declaration. `align` REPLACES a field's
  // alignment rather than strengthening it, so `y` lands at byte 8 and not at
  // 16 - taking the max is the obvious wrong implementation.
  const four = '@alignAll(16) @size(32) class A { @offset(2) x: float32; @align(4) y: float32x4; } ';
  expect(evaluated(`${four} String((type A).byteLength) + "/" + String((type A).alignment);`)).toBe('32/16');
  expect(evaluated(`${four} String(Reflect.getReflection.<Reflect.ClassField, A>("x").offset);`)).toBe('2');
  expect(evaluated(`${four} String(Reflect.getReflection.<Reflect.ClassField, A>("y").offset);`)).toBe('8');
  // A class with no controls is unaffected.
  expect(evaluated('class N { a: uint8; b: uint16; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('4/2');
  // ANY OTHER DECORATOR IS REFUSED. This proposal's decorators extension -
  // context types, overload resolution, replacement by return value - is a
  // separate feature and is not implemented, and a declaration that is accepted
  // and does nothing reads as support.
  expectThrown('function f(x) { return x; } @f class Z { a: uint8; }');
});

test('memory layout: a type reports its own byteLength', () => {
  expect(evaluated('String(uint32.byteLength);')).toBe('4');
  // The buffer-backed value runtime these sizes describe, the view constructor
  // over a buffer and the instance byteLength that goes with it, is still to come.
  expectThrown('let b = new ArrayBuffer(4); [].<uint8>(b);');
});

// ── soa: structure of arrays ──────────────────────────────────────────────────
test('soa: SoA is a type name, and its layout is the column rule', () => {
  // soa.md: `SoA.<T, Length>` is "a built-in exotic in the same way `[].<T>` is:
  // something no user-defined class could express, specified by the language and
  // provided by the engine". A type name, and unlike the library names beside it
  // in the table NOT a global constructor whose prototype chain decides
  // membership.
  expect(evaluated('class T { x: float32; } let s: SoA.<T, 4>; "ok";')).toBe('ok');

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

// ── threading: shared classes and threads ─────────────────────────────────────
test('threading: shared class does not parse (documents the gap)', () => {
  // Target (threading.md): `shared class` places instances in the shared heap.
  expectThrown('shared class A { x: uint8; } typeof A;');
});

test('threading: Thread is not defined (documents the gap)', () => {
  expect(evaluated('typeof Thread;')).toBe('undefined');
});

// ── decorators: the @ syntax under the feature ────────────────────────────────
test('decorators: @decorator does not parse under the runtime-types feature (documents the gap)', () => {
  // Target (decorators.md): @d class A {} plus the declaration-reflection facility.
  // (The type-object half of reflection is implemented; see typeobjects.test.mts.)
  expectThrown('function d(x) { return x; } @d class A {} typeof A;');
});
// Phase 3's unclaimed-key error adjudicates these programs' keys, and none of
// these tests is ABOUT the metadata protocol, so each waives adjudication
// through the base-form route: a meta registered against the base speaks for
// every key of its parameterizations (the C9 waiver, F44). The interning and
// carrying assertions are untouched.
const waive = 'meta float32 { default = {}; subtype(a, b) { return true; } } meta float64 { default = {}; subtype(a, b) { return true; } } ';


// ── primitive metadata: parses and interns, does not carry/validate ───────────
test('primitive metadata: a metadata-parameterized primitive parses and interns', () => {
  expect(evaluated(waive + 'type Meter = float32.<{ unit: "m" }>; typeof Meter;')).toBe('object');
  // it reflects as a parameterization of its base, and interns
  expect(evaluated(waive + 'type Meter = float32.<{ unit: "m" }>; Reflect.getReflection(Meter).kind;')).toBe('parameterized');
  expect(ok(waive + 'type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "m" }>; A === B;')).toBe(true);
});

test('primitive metadata: the metadata is carried; the meta hooks are still to come', () => {
  // The metadata is carried on the type and the parameterization is distinct from
  // its base, which is what the validate judgment needs to have anything to read.
  expect(evaluated(waive + 'type Meter = float32.<{ unit: "m" }>; (Meter === float32) ? "same" : "distinct";')).toBe('distinct');
  // Still to come: a meta declaration binding its name so its hooks reach the
  // judgments, and the dimension, bound, and scale semantics written over them.
  expectThrown('meta Bounds { subtype(a, b) { return true; } validate(v, c) { return true; } } Bounds;');
});

// ── random: the typed no-argument Math.random ─────────────────────────────────
test('random: untyped Math.random works, and the typed no-argument form carries its value type', () => {
  // untyped baseline
  expect(ok('let r = Math.random(); r >= 0 && r < 1;')).toBe(true);
  // random.md: Math.random.<float32>() is a value in [0, 1) at the float value type
  expect(evaluated('let r = Math.random.<float32>(); (r is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('Reflect.typeOf(Math.random.<float32>()) === float32 ? "f32" : "num";')).toBe('f32');
  expect(ok('let r = Math.random.<float32>(); r >= 0 && r < 1;')).toBe(true);
  // a draw is exactly representable at its width, so the checked conversion's
  // rounding (wrapToType) leaves it unchanged: float32 draws are fround-stable
  // and float16 draws sit on the 11-bit significand grid (Number() extracts the
  // plain value, since a typed zero is not === a plain zero)
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let n = Number(Math.random.<float32>()); if (n - Math.fround(n) !== 0) good = false; } good;')).toBe(true);
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let n = Number(Math.random.<float16>()); if (n - Math.f16round(n) !== 0) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<float16>(); (r is float16) ? "yes" : "no";')).toBe('yes');
  // an integer value type draws across its full range, inclusive, at that type
  expect(evaluated('let r = Math.random.<uint8>(); (r is uint8) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<uint8>(); if (!(r >= 0 && r <= 255)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<int8>(); (r is int8) ? "yes" : "no";')).toBe('yes');
  // Deferred: the array-fill and range overloads, wider integers, a plain number
  // or bigint type argument, and the seeded PRNG named by Math.PRNG. These fall
  // through to the ordinary untyped call or are absent.
  expect(evaluated('typeof Math.random.<number>();')).toBe('number');
  expect(evaluated('typeof Math.random.<uint64>();')).toBe('number');
  expect(evaluated('typeof Math.PRNG;')).toBe('undefined');
});

// ── random: a seed makes the stream reproducible, and typed draws share it ─────
test('random: a fixed seed reproduces the stream, and a typed draw advances that same stream', () => {
  // random.md: the seed pins the pseudorandom stream, so the same seed yields the
  // same sequence of untyped draws, and a different seed yields a different one.
  const drawFour = 'let a = []; for (let i = 0; i < 4; i += 1) { a.push(Math.random()); } a.join(",");';
  const first = evaluatedSeeded('12345', drawFour);
  expect(evaluatedSeeded('12345', drawFour)).toBe(first);
  expect(evaluatedSeeded('67890', drawFour)).not.toBe(first);
  // A typed draw is taken from the one shared stream, so it advances it by
  // exactly one step: after a typed draw consumes the first value, the next
  // untyped draw is the second value of the all-untyped sequence.
  const untypedPair = evaluatedSeeded('999', 'let a = []; a.push(Math.random()); a.push(Math.random()); a.join(",");');
  const secondUntyped = untypedPair.split(',')[1];
  const afterTyped = evaluatedSeeded('999', 'Math.random.<float32>(); String(Math.random());');
  expect(afterTyped).toBe(secondUntyped);
});

// ── random: every integer value type draws across its own full range ──────────
test('random: each integer value type draws an in-range value at that type', () => {
  // random.md: an integer type draws across its full range, inclusive. int8 spans
  // the negative side too, and the wider integer widths carry their own type.
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<int8>(); if (!(r >= -128 && r <= 127)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<uint16>(); (r is uint16) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<uint16>(); if (!(r >= 0 && r <= 65535)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<int16>(); (r is int16) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<int16>(); if (!(r >= -32768 && r <= 32767)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<uint32>(); (r is uint32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('let r = Math.random.<int32>(); (r is int32) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<int32>(); if (!(r >= -2147483648 && r <= 2147483647)) good = false; } good;')).toBe(true);
});

// ── memorylayout: the three layout properties a laid-out type exposes ─────────
test('memory layout: a laid out type reports its size, bit width, and alignment', () => {
  // memorylayout.md's own examples
  expect(evaluated('String(uint8.byteLength);')).toBe('1');
  expect(evaluated('String(uint8.bitLength);')).toBe('8');
  expect(evaluated('type U = uint.<4>; String(U.bitLength);')).toBe('4');
  // the bits rounded up to a byte
  expect(evaluated('type U = uint.<4>; String(U.byteLength);')).toBe('1');
  expect(evaluated('String(float64.byteLength);')).toBe('8');
  expect(evaluated('String(float64.alignment);')).toBe('8');
  expect(evaluated('String(float32.byteLength);')).toBe('4');
  expect(evaluated('String(boolean.byteLength);')).toBe('1');
});

test('memory layout: an unnamed width takes the natural alignment rule', () => {
  // The smallest power of two at least the byte length, and NOT capped. The
  // examples the rule was written around are unchanged.
  expect(evaluated('type U = uint.<4>; String(U.alignment);')).toBe('1');
  expect(evaluated('type U = uint.<24>; String(U.byteLength);')).toBe('3');
  expect(evaluated('type U = uint.<24>; String(U.alignment);')).toBe('4');
  // CAP REMOVED (F96). It made two 16-byte types disagree for no reason a
  // program could see: a `uint.<128>` aligned at 8 while a `float32x4` of the
  // same width aligned at 16, because the vector rule bypassed the cap. Rust,
  // which this layout follows, aligns each scalar to its own size - `u128` is
  // 16-byte aligned, matching C - and caps nothing; raising an alignment is
  // `#[repr(align(N))]`'s job, which is `@align` here.
  expect(evaluated('String(int128.byteLength);')).toBe('16');
  expect(evaluated('String(int128.alignment);')).toBe('16');
  // The vector case now FALLS OUT of the general rule rather than needing one
  // of its own, since a width that is already a power of two rounds to itself.
  expect(evaluated('type V = float32x4; String(V.alignment) + "/" + String(V.byteLength);')).toBe('16/16');
  // And a bit vector still packs: eight one-bit lanes in one byte.
  expect(evaluated('type B = boolean8; String(B.alignment) + "/" + String(B.byteLength);')).toBe('1/1');
});

test('memory layout: a fixed length array lays out as its element repeated', () => {
  expect(evaluated('type A = [4].<uint8>; String(A.byteLength);')).toBe('4');
  expect(evaluated('type A = [3].<float32>; String(A.byteLength);')).toBe('12');
  expect(evaluated('type A = [3].<float32>; String(A.alignment);')).toBe('4');
});

test('memory layout: asking a type with no layout for its size is an error', () => {
  // the point of the rule: a program asking for the size of a string has made a
  // mistake a returned number would hide
  expectThrown('string.byteLength;');
  expectThrown('bigint.byteLength;');
  expectThrown('type A = any; A.byteLength;');
  // a union of value types has no single layout
  expectThrown('type U = uint8 | uint16; U.byteLength;');
  // and an array with no length is not a laid out type, though its instances have
  // a byteLength once the buffer-backed runtime lands
  expectThrown('type A = [].<uint8>; A.byteLength;');
});

// -- simd: the named lane types --------------------------------------------------
test('simd: the shorthand names abbreviate the register-width vectors', () => {
  // memorylayout.md's own example: a SIMD vector aligns to its whole width rather
  // than the capped natural rule, since the register is addressed that way
  expect(evaluated('type V = float32x4; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = float32x4; String(V.alignment);')).toBe('16');
  // a shorthand is an alias, not a new type
  expect(evaluated('type A = float32x4; type B = vector.<float32, 4>; (A === B) ? "same" : "diff";')).toBe('same');
  // the 128 bit and 256 bit families
  expect(evaluated('type V = int8x16; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = uint64x2; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = float32x8; String(V.byteLength);')).toBe('32');
  expect(evaluated('type V = int64x4; String(V.byteLength);')).toBe('32');
});

test('simd: a bit vector packs its lanes as bits', () => {
  // eight one-bit lanes in a single byte, which is what makes boolean8 a usable
  // bitfield rather than a name for a byte
  expect(evaluated('type V = boolean8; String(V.byteLength);')).toBe('1');
  expect(evaluated('type V = boolean64; String(V.byteLength);')).toBe('8');
  // and a vector of those still fills its register
  expect(evaluated('type V = boolean32x4; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = boolean8x16; String(V.byteLength);')).toBe('16');
});

test('simd: a name exists only where the lanes fill a register', () => {
  // float32x4 has a name and a three lane float vector does not
  expectThrown('type V = float32x3; V;');
  expectThrown('type V = float32x5; V;');
  expectThrown('type V = uint8x8; V;');
  // the long form still validates its lane type
  expectThrown('type V = vector.<string, 4>; V;');
});

// -- primitive metadata: carrying a metadata parameterization --------------------
test('primitive metadata: a metadata parameterization is carried, not dropped', () => {
  // the argument is an object type written on a primitive, which the metadata
  // protocol reads as metadata rather than as an argument to the primitive
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; Reflect.getReflection(A).kind;')).toBe('parameterized');
  // it is a distinct type from its bare base, where before it interned back to it
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; (A === float32) ? "same" : "distinct";')).toBe('distinct');
  // and two different metadata are two different types
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "s" }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
  expect(evaluated(waive + 'type A = float32.<{ minimum: 0 }>; type B = float32.<{ minimum: 1 }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; type B = float64.<{ unit: "m" }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
});

test('primitive metadata: metadata that agrees interns to one type', () => {
  // interning compares the metadata field for field rather than by identity, since
  // two mentions of one shape must be one type
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "m" }>; (A === B) ? "same" : "distinct";')).toBe('same');
  expect(evaluated(waive + 'type A = float32.<{ m: 1, s: -2 }>; type B = float32.<{ m: 1, s: -2 }>; (A === B) ? "same" : "distinct";')).toBe('same');
});

test('primitive metadata: a parameterization still sheds upward to its base', () => {
  // the default meaning of a parameterization is a brand, shed upward freely
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; String(Reflect.isAssignable(A, float32));')).toBe('true');
});

test('primitive metadata: a numeric type argument is unaffected', () => {
  // only an object argument is metadata; a width or a lane count is not
  expect(evaluated('Reflect.getReflection(float32).kind;')).toBe('primitive');
  expect(evaluated('type U = uint.<8>; String(U.bitLength);')).toBe('8');
  expect(evaluated('type V = vector.<float32, 4>; String(V.byteLength);')).toBe('16');
});

test('memory layout: sub-byte fields pack into shared bytes', () => {
  // #sec-natural-alignment states the whole walk as a BIT cursor, not a byte
  // one: "Where the field's type has a `bitLength` under 8, it is a bit-field:
  // it is placed at the cursor, or at the bit its `offsetBit` names, and the
  // cursor advances by its `bitLength`." Writing it in bytes and special-casing
  // bit-fields is how the rounding rules drift apart; in bits the two cases
  // share one cursor.
  //
  // The design's RGB565, exactly.
  const rgb = '@packed class RGB565 { r: uint.<5>; g: uint.<6>; b: uint.<5>; } ';
  expect(evaluated(`${rgb} String((type RGB565).byteLength) + "/" + String((type RGB565).bitLength);`)).toBe('2/16');
  expect(evaluated(`${rgb} const R = (n) => Reflect.getReflection.<Reflect.ClassField, RGB565>(n); String(R("r").offsetBit) + "/" + String(R("g").offsetBit) + "/" + String(R("b").offsetBit);`)).toBe('0/5/11');
  expect(evaluated(`${rgb} String(Reflect.getReflection.<Reflect.ClassField, RGB565>("g").isBitField);`)).toBe('true');

  // "Automatic packing reaches only a field under 8 bits, so a `uint.<12>`
  // occupies 2 bytes unless an `offsetBit` places it." The BYTE BOUNDARY is the
  // line, not the type's name.
  expect(evaluated('class W { a: uint.<12>; } String((type W).byteLength) + "/" + String((type W).bitLength);')).toBe('2/12');
  // `offsetBit` places one explicitly, which is what fixes bit order exactly.
  expect(evaluated('@packed class E { a: uint.<3>; @offsetBit(8) b: uint.<4>; } const R = (n) => Reflect.getReflection.<Reflect.ClassField, E>(n); String(R("a").offsetBit) + "/" + String(R("b").offsetBit) + "/" + String((type E).bitLength);')).toBe('0/8/12');

  // bitLength is now the UNROUNDED extent: a class of one `uint.<5>` is 5 bits
  // in 1 byte, where the walk previously reported 8 because it derived
  // bitLength from byteLength.
  expect(evaluated('class B { r: uint.<5>; } String((type B).bitLength) + "/" + String((type B).byteLength);')).toBe('5/1');
  // Byte-sized classes are unchanged by the rewrite.
  expect(evaluated('class N { a: uint8; b: uint16; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('4/2');
  expect(evaluated('class V { x: float32; y: float32; z: float32; } String((type V).byteLength) + "/" + String((type V).alignment);')).toBe('12/4');
});

test('memory layout: a bit-field has no byte address to refer to', () => {
  // "Reading or writing a bit-field is a shift and a mask, and taking a
  // reference to one is a type error, since it has no byte address to refer
  // to." A reference borrows a storage LOCATION, and a field packed into part
  // of a byte is not one.
  const c = '@packed class C { r: uint.<5>; n: uint8; } const c = new C(); ';
  expectThrown(`${c} function f(p: ref uint.<5>) { return 1; } f(ref c.r);`);
  // A byte-addressable field of the same class is still borrowable, which is
  // what keeps this a rule about bit-fields rather than about typed classes.
  expect(evaluated(`${c} function g(p: ref uint8) { return 2; } String(g(ref c.n));`)).toBe('2');
  // And an ordinary object property is untouched.
  expect(evaluated('const o = { z: 1 }; function h(p: ref number) { return 3; } String(h(ref o.z));')).toBe('3');
});

test('memory layout: a placement allocation lands an instance on existing bytes', () => {
  // The placement forms of
  // #sec-type-arguments-and-placement-new-in-expression-position. The parser
  // had built these arguments since the form was added and NOTHING consumed
  // them, so a placement construction allocated fresh storage and discarded the
  // buffer it was handed - which reads as support.
  //
  // This is also the first thing in the engine that puts real BYTES under an
  // instance: every typed class before it stored its fields as ordinary
  // properties, which is why four stages could compute a layout that nothing
  // read.
  const V = 'class V { x: float32; y: float32; constructor(a, b) { this.x = a; this.y = b; } } ';
  const setup = `${V} const buf = new ArrayBuffer(32); const v = new(buf, 0) V(1.5, 2.5); const view = new Float32Array(buf); `;
  expect(evaluated(`${setup} String(view[0]) + "/" + String(view[1]);`)).toBe('1.5/2.5');
  // ALIASING, in both directions, which is the whole point: the instance's
  // fields ARE the buffer's bytes.
  expect(evaluated(`${setup} view[0] = 9.5; String(Number(v.x));`)).toBe('9.5');
  expect(evaluated(`${setup} v.y = 7.5; String(view[1]);`)).toBe('7.5');
  // The store check runs before the bytes are written, exactly as for a
  // property-backed field.
  expectThrown(`${setup} v.x = "s";`);
  // "The second, when present, is the byte offset and otherwise 0."
  expect(evaluated(`${setup} const v2 = new(buf, 16) V(3, 4); String(view[4]) + "/" + String(view[5]);`)).toBe('3/4');
  // "It is a *RangeError* exception when the extent so computed exceeds the
  // buffer's length."
  // The extent is validated BEFORE the constructor runs: it depends only on
  // the arguments and the layout, and checking afterwards would let a
  // constructor with side effects run for a placement that can never happen.
  expectThrownKind('class P { x: float32; y: float32; } new(new ArrayBuffer(4), 0) P();', 'RangeError');
  expect(evaluated('let ran = false; class P { x: float32; y: float32; constructor() { ran = true; } } try { new(new ArrayBuffer(4), 0) P(); } catch (e) {} String(ran);')).toBe('false');
  // "Bytes the layout does not assign keep the buffer's contents, since reusing
  // storage is what the form is for and the zero-fill rule of fresh allocation
  // does not apply."
  expect(evaluated('class P { x: float32; y: float32; } const b = new ArrayBuffer(32); const u = new Uint8Array(b); u[12] = 0xAB; new(b, 0) P(); String(u[12]);')).toBe('171');
});

test('memory layout: a placed bit-field is a shift and a mask', () => {
  // "Reading or writing a bit-field is a shift and a mask." Stage F could not
  // implement that sentence because an instance had no bytes to shift within;
  // a placement gives it some, so the sentence becomes real here.
  const rgb = '@packed class RGB { r: uint.<5>; g: uint.<6>; b: uint.<5>; } const cb = new ArrayBuffer(4); const c = new(cb, 0) RGB(); ';
  expect(evaluated(`${rgb} c.r = 31; c.g = 0; c.b = 1; String(Number(c.r)) + "/" + String(Number(c.g)) + "/" + String(Number(c.b));`)).toBe('31/0/1');
  // And the bytes are packed as the layout says: `r` fills bits 0..4 of byte 0,
  // and `b` at bit 11 is bit 3 of byte 1.
  expect(evaluated(`${rgb} c.r = 31; c.b = 1; const u = new Uint8Array(cb); String(u[0]) + "/" + String(u[1]);`)).toBe('31/8');
});

test('memory layout: a placement over a resizable buffer records its extent', () => {
  // "Over a resizable buffer the extent is recorded: shrinking the buffer below
  // a live allocation's extent detaches those instances, touching a detached
  // instance throws a *TypeError* exception, and growing never invalidates."
  const rz = 'class V { x: float32; y: float32; } const rb = new ArrayBuffer(32, { maxByteLength: 64 }); const v = new(rb, 16) V(); v.x = 1.5; ';
  expect(evaluated(`${rz} String(Number(v.x));`)).toBe('1.5');
  expect(evaluated(`${rz} rb.resize(64); String(Number(v.x));`)).toBe('1.5');
  expectThrownKind(`${rz} rb.resize(8); v.x;`, 'TypeError');
});

test('memory layout: overlapping fields reinterpret, and the store check is per field', () => {
  // #sec-layout-control: "Two fields given one `offset` occupy one memory,
  // which is the C union." This is the ONE place a typed read can produce a
  // value the type system did not construct, and the specification permits it
  // knowingly: the store check applies PER FIELD against the type that field
  // declares, and neither field knows the other shares its bytes.
  const u = '@packed class U { value: float32; @offset(0) bits: uint32; } const b = new ArrayBuffer(8); const u = new(b, 0) U(); ';
  // Both fields are placed at byte 0.
  expect(evaluated(`${u} String(Reflect.getReflection.<Reflect.ClassField, U>("value").offset) + "/" + String(Reflect.getReflection.<Reflect.ClassField, U>("bits").offset);`)).toBe('0/0');
  // A float written through one field is read as its BIT PATTERN through the
  // other, which is what a program overlapping two types asked for and is why
  // the C union is expressible at all. 1.0 as a float32 is 0x3F800000.
  expect(evaluated(`${u} u.value = 1; String(Number(u.bits));`)).toBe('1065353216');
  expect(evaluated(`${u} u.bits = 1065353216; String(Number(u.value));`)).toBe('1');
  // Each field still checks its OWN type: the reinterpretation is between the
  // bytes, never a way past a store boundary.
  expectThrown(`${u} u.bits = "s";`);
  expectThrown(`${u} function anyv() { return 4294967296; } u.bits = anyv();`);
});

test('memory layout: a type-position name resolves against its declaration', () => {
  // #sec-compile-time-evaluability: "Evaluation is confined to checking and
  // READS DECLARATIONS RATHER THAN RUN-TIME BINDINGS." The engine resolved a
  // type name through ResolveBinding and GetValue - the run-time binding - so a
  // name in its temporal dead zone was refused, and a class's own binding is in
  // its dead zone for the whole of its declaration.
  //
  // #sec-layout-finiteness names the case this broke: "a field written `T |
  // null` closes a cycle because it is a reference ... which is why a LINKED
  // LIST IS EXPRESSIBLE and a class containing itself by value is not."
  expect(evaluated('class N { value: uint32; next: N | null; } "ok";')).toBe('ok');
  // The refusal was never only about self-reference: a forward reference and
  // mutual recursion went with it, while a METHOD signature naming the same
  // class always worked - which is the diagnostic, since a signature is not
  // resolved at declaration and a field's type is.
  expect(evaluated('class A { b: B | null; } class B { x: uint8; } "ok";')).toBe('ok');
  expect(evaluated('class P { q: Q | null; } class Q { p: P | null; } "ok";')).toBe('ok');
  expect(evaluated('class M { m(): M | null { return null; } } "ok";')).toBe('ok');
  // The list is usable, not merely declarable.
  const list = 'class N { value: uint32; next: N | null; } const a = new N(); a.value = 5; const b = new N(); b.value = 7; a.next = b; ';
  expect(evaluated(`${list} String(Number(a.next.value));`)).toBe('7');
  expect(evaluated(`${list} String(b.next);`)).toBe('null');

  // A reference field has a WIDTH, so a class holding one has a layout: the
  // table's row "a reference type, including a nullable union of a value type
  // class" says the width is the implementation's business, and this
  // implementation spends 8 bytes at alignment 8.
  expect(evaluated('class B { x: uint8; } class R { r: B | null; } String((type R).byteLength) + "/" + String((type R).alignment);')).toBe('8/8');
  expect(evaluated('class B { x: uint8; } class R { v: uint32; r: B | null; } String((type R).byteLength) + "/" + String(Reflect.getReflection.<Reflect.ClassField, R>("r").offset);')).toBe('16/8');
  // KNOWN LIMIT, recorded rather than asserted away: a SELF-referential class
  // declares, constructs, and links, but its own layout is not computed at its
  // declaration. The self-reference resolves to a type built from the
  // declaration, which the class's own Type Object does not yet agree with -
  // `Reflect.typeOf` over it does not report the class - so the layout walk
  // cannot complete. Nothing above depends on it, and the reference width is
  // exercised by the completed-class rows instead.
  // LIMIT CLOSED (F103). This documented that a SELF-REFERENTIAL class's own
  // layout was not computed at its declaration, because the record built from
  // the declaration and the class's finished Type Object did not intern as one.
  // They do now: identity is by [[Declaration]], so the class's completion
  // finds the earlier record and COMPLETES it with the constructor rather than
  // being handed a stale one back. The linked list lays out like any other
  // class holding a reference.
  expect(evaluated('class N { value: uint32; next: N | null; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('16/8');
  expect(evaluated('class N { value: uint32; next: N | null; } String(Reflect.getReflection.<Reflect.ClassField, N>("next").offset);')).toBe('8');
});

test('memory layout: a class may not contain itself by value', () => {
  // #sec-layout-finiteness: "a value type class may not contain itself,
  // directly or through a cycle of value type fields".
  //
  // This check had NEVER HAD TO WORK. A cyclic class was refused by the
  // ordinary temporal dead zone before any layout was computed, so the
  // condition held by accident; resolving a type-position name against its
  // declaration removes the accident and leaves the clause to be enforced.
  expectThrownKind('class C { self: C; }', 'TypeError');
  // The distinction the clause draws: a REFERENCE to the same class closes the
  // cycle and is fine, because the recursion stops at a type with no layout of
  // its own rather than descending.
  expect(evaluated('class D { self: D | null; } "ok";')).toBe('ok');
  // A FORWARD reference by value is not a cycle. Its layout is simply not
  // computable at that declaration, so the class reports none rather than
  // being refused - being wrong in that direction costs precision, being wrong
  // in the other would refuse a program the clause admits.
  expect(evaluated('class P2 { q: Q2; } class Q2 { x: uint8; } "ok";')).toBe('ok');
});

test('memory layout: a placement binds before construction, so no property is created', () => {
  // "Construction stores each field of each instance at its laid-out position."
  // The first implementation constructed into fresh storage and moved the
  // fields afterwards, which left each constructor-written property behind as a
  // stale copy that could not be deleted - #sec-typed-storage makes deleting a
  // typed field a TypeError. Binding between the instance being created and its
  // fields being initialized removes the intermediate state rather than
  // cleaning up after it, which is what C++ placement `new` does: the object is
  // constructed directly in the supplied storage.
  const V = 'class V { x: float32; y: float32; constructor(a, b) { this.x = a; this.y = b; } } const b = new ArrayBuffer(32); const v = new(b, 0) V(1.5, 2.5); ';
  expect(evaluated(`${V} String(Object.getOwnPropertyNames(v).length);`)).toBe('0');
  expect(evaluated(`${V} String(Number(v.x)) + "/" + String(new Float32Array(b)[1]);`)).toBe('1.5/2.5');
  // A class with NO constructor is created on a different path - inside the
  // default constructor builtin rather than in [[Construct]] - and a placement
  // has to be taken on both. Missing the second left such a class placed in
  // name only: its fields became properties and its buffer stayed zero.
  const D = 'class D { x: float32; } const b2 = new ArrayBuffer(8); const d = new(b2, 0) D(); d.x = 1.5; ';
  expect(evaluated(`${D} String(Object.getOwnPropertyNames(d).length);`)).toBe('0');
  expect(evaluated(`${D} String(new Float32Array(b2)[0]);`)).toBe('1.5');
  // A constructor now reads back through the BUFFER, which is what a placed
  // instance should do for the whole of its life rather than from the end of
  // construction onwards.
  expect(evaluated('let seen = 0; class W { p: uint8; constructor() { this.p = 3; seen = Number(this.p); } } const b3 = new ArrayBuffer(8); new(b3, 0) W(); String(seen);')).toBe('3');
  // An unplaced instance is untouched.
  expect(evaluated('class U { x: float32; } String(Object.getOwnPropertyNames(new U()).join(","));')).toBe('x');
});

test('soa: allocation, capacity, and reserve', () => {
  // soa.md's class shape: `constructor()`, `constructor(length)` for growable
  // arrays, `length`, `capacity`, `byteLength`, and `reserve(n)` — "grow every
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
  // 64, so 72 — which is not 8 times anything, because the columns are padded
  // and aligned on their own rather than sharing an element stride.
  expect(evaluated(`${pad} const g = new SoA.<Pad>(); g.reserve(8); String(g.capacity) + "/" + String(g.byteLength);`)).toBe('8/72');
  // Reserving below the current capacity does nothing.
  expect(evaluated(`${pad} const g = new SoA.<Pad>(4); g.reserve(2); String(g.capacity);`)).toBe('4');

  // REJECTIONS. A fixed extent has nothing to reallocate — `push`, `pop`, and
  // `reserve` "are already absent from an `SoA.<T, N>` as they are from a
  // `[N].<T>`". An SoA needs an element type, since the columns ARE the type
  // argument. And a `T` that cannot be split into columns is refused here as it
  // is by the layout rule.
  expectThrown(`${pad} new SoA.<Pad, 4>().reserve(8);`);
  expectThrown('new SoA();');
  expectThrown('SoA();');
  expectThrown('class Ref { s: string; } new SoA.<Ref, 2>();');
});
