import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../readme/harness.mts';

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

test('memory layout: byteLength/alignment on a type are not present (documents the gap)', () => {
  // Target: uint32.byteLength === 4, and alignment/bitLength on types.
  expect(evaluated('typeof uint32.byteLength;')).toBe('undefined');
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
  // it reflects as a primitive and interns
  expect(evaluated('type Meter = float32.<{ unit: "m" }>; Reflect.getReflection(Meter).kind;')).toBe('primitive');
  expect(ok('type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "m" }>; A === B;')).toBe(true);
});

test('primitive metadata: the metadata is not fully carried or validated (documents the gap)', () => {
  // Target (primitivemetadata.md): a metadata-parameterized primitive carries and
  // validates its metadata. Today it resolves as the plain base primitive.
  expect(evaluated('type Meter = float32.<{ unit: "m" }>; let m: Meter = (5 := Meter); typeof m;')).toBe('number');
});

// ── random: typed and seeded Math.random ──────────────────────────────────────
test('random: untyped Math.random works; the typed/seeded generic is deferred', () => {
  // untyped baseline
  expect(ok('let r = Math.random(); r >= 0 && r < 1;')).toBe(true);
  // Target (random.md): Math.random.<float32>() is a typed generator, and
  // Math.PRNG names the algorithm for seeded generators. Today the type argument
  // parses but is not specialized, and Math.PRNG is absent.
  expect(evaluated('let r = Math.random.<float32>(); typeof r;')).toBe('number');
  expect(evaluated('typeof Math.PRNG;')).toBe('undefined');
});
