import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown, evaluatedSeeded } from '../readme/harness.mts';

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
test('memory layout: field layout decorators do not parse under the feature (documents the gap)', () => {
  // Target (memorylayout.md): @packed / @align / @offset / @endian on fields.
  expectThrown('@packed class A { x: uint8; } typeof A;');
});

test('memory layout: a type reports its own byteLength', () => {
  expect(evaluated('String(uint32.byteLength);')).toBe('4');
  // The buffer-backed value runtime these sizes describe, the view constructor
  // over a buffer and the instance byteLength that goes with it, is still to come.
  expectThrown('let b = new ArrayBuffer(4); [].<uint8>(b);');
});

// ── soa: structure of arrays ──────────────────────────────────────────────────
test('soa: SoA.<T> is not defined (documents the gap)', () => {
  // Target (soa.md): a structure-of-arrays container storing each field in a column.
  expectThrown('let a: SoA.<{ x: uint8 }>; typeof SoA;');
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

// ── primitive metadata: parses and interns, does not carry/validate ───────────
test('primitive metadata: a metadata-parameterized primitive parses and interns', () => {
  expect(evaluated('type Meter = float32.<{ unit: "m" }>; typeof Meter;')).toBe('object');
  // it reflects as a parameterization of its base, and interns
  expect(evaluated('type Meter = float32.<{ unit: "m" }>; Reflect.getReflection(Meter).kind;')).toBe('parameterized');
  expect(ok('type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "m" }>; A === B;')).toBe(true);
});

test('primitive metadata: the metadata is carried; the meta hooks are still to come', () => {
  // The metadata is carried on the type and the parameterization is distinct from
  // its base, which is what the validate judgment needs to have anything to read.
  expect(evaluated('type Meter = float32.<{ unit: "m" }>; (Meter === float32) ? "same" : "distinct";')).toBe('distinct');
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
  // the smallest power of two at least the byte length, capped at eight
  expect(evaluated('type U = uint.<4>; String(U.alignment);')).toBe('1');
  expect(evaluated('type U = uint.<24>; String(U.byteLength);')).toBe('3');
  expect(evaluated('type U = uint.<24>; String(U.alignment);')).toBe('4');
  // the cap: a sixteen byte integer still aligns to eight
  expect(evaluated('String(int128.byteLength);')).toBe('16');
  expect(evaluated('String(int128.alignment);')).toBe('8');
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
  expect(evaluated('type A = float32.<{ unit: "m" }>; Reflect.getReflection(A).kind;')).toBe('parameterized');
  // it is a distinct type from its bare base, where before it interned back to it
  expect(evaluated('type A = float32.<{ unit: "m" }>; (A === float32) ? "same" : "distinct";')).toBe('distinct');
  // and two different metadata are two different types
  expect(evaluated('type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "s" }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
  expect(evaluated('type A = float32.<{ minimum: 0 }>; type B = float32.<{ minimum: 1 }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
  expect(evaluated('type A = float32.<{ unit: "m" }>; type B = float64.<{ unit: "m" }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
});

test('primitive metadata: metadata that agrees interns to one type', () => {
  // interning compares the metadata field for field rather than by identity, since
  // two mentions of one shape must be one type
  expect(evaluated('type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "m" }>; (A === B) ? "same" : "distinct";')).toBe('same');
  expect(evaluated('type A = float32.<{ m: 1, s: -2 }>; type B = float32.<{ m: 1, s: -2 }>; (A === B) ? "same" : "distinct";')).toBe('same');
});

test('primitive metadata: a parameterization still sheds upward to its base', () => {
  // the default meaning of a parameterization is a brand, shed upward freely
  expect(evaluated('type A = float32.<{ unit: "m" }>; String(Reflect.isAssignable(A, float32));')).toBe('true');
});

test('primitive metadata: a numeric type argument is unaffected', () => {
  // only an object argument is metadata; a width or a lane count is not
  expect(evaluated('Reflect.getReflection(float32).kind;')).toBe('primitive');
  expect(evaluated('type U = uint.<8>; String(U.bitLength);')).toBe('8');
  expect(evaluated('type V = vector.<float32, 4>; String(V.byteLength);')).toBe('16');
});
