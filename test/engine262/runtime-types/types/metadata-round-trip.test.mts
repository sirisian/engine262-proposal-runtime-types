import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * proposal-runtime-types `sec-reflect-maketype`,
 * PLAN-metadata-representation.md phase 3.
 *
 * The clause states the round trip as an IDENTITY, in those words:
 *
 *   "For every type T, Reflect.makeType(Reflect.getReflection(T)) is T.
 *    Construction canonicalizes and interns by [the same operations] that give
 *    a source-written type its identity, which is what makes the round trip the
 *    identity function rather than an equivalence."
 *
 * Every assertion below is therefore `===`, and that is the point of the file
 * rather than a stylistic choice. While this was broken, EVERY WEAKER CHECK
 * PASSED: the rebuilt type had the right `kind`, the right base, readable
 * metadata with the right field values, and it was even stable under further
 * round trips. Only identity failed. A suite that checks shape would have gone
 * green against an implementation holding two Type Objects for one type.
 *
 * The defect it guards was one representation mismatch appearing at three
 * depths in turn, each hidden by the one above it - the record (F148), the
 * container (F154), the marker's own discriminant (F155). Each fix exposed the
 * next and each looked identical from outside.
 */

// ---------------------------------------------------------------------------
// The two leaf kinds, separately and together
// ---------------------------------------------------------------------------

test('a brand round-trips: a Value leaf', () => {
  // A brand's tag is an engine `Value` on both sides of the conversion, so it
  // never met the mismatch. That is why a brand round-tripped while a pattern
  // did not, and why the working feature masked the broken one for two plans.
  expect(evaluated("type B = uint32.<{ brand: 'UserId' }>;"
    + ' String(Reflect.makeType(Reflect.getReflection(B)) === B);')).toBe('true');
});

test('a pattern round-trips: a marker leaf', () => {
  // The case F153 filed. A pattern's metadata is a structural MARKER -
  // `{ __pattern, source, flags }` - and a marker is a container, so it has to
  // survive the conversion as a plain record rather than as the ObjectValue the
  // node carried it in.
  expect(evaluated('type Px = string.<{ pattern: /^a$/ }>;'
    + ' String(Reflect.makeType(Reflect.getReflection(Px)) === Px);')).toBe('true');
});

test('both leaf kinds in ONE record round-trip', () => {
  // The phase-1 gate. A fix that handles a Value leaf and not a marker, or the
  // reverse, passes both tests above and fails this one - which is the whole
  // reason it is stated separately.
  expect(evaluated("type M = string.<{ brand: 'Name', pattern: /^a$/ }>;"
    + ' String(Reflect.makeType(Reflect.getReflection(M)) === M);')).toBe('true');
});

test('a nested record inside the metadata round-trips', () => {
  // Recursion is over CONTAINERS, and a marker is not the only one: a metadata
  // portion may be an ordinary nested record. This is the shape that proves the
  // conversion recurses generally rather than special-casing `__pattern`.
  expect(evaluated("const T = Reflect.makeType({ kind: 'parameterized', base: uint32,"
    + " metadata: { brand: 'a', extra: { deep: 'v' } } });"
    + ' String(Reflect.makeType(Reflect.getReflection(T)) === T);')).toBe('true');
});

test('a SYMBOL-tagged brand round-trips, and its identity survives', () => {
  // The leaf OQ3-A exists to protect. A Symbol has no plain equivalent whose
  // identity survives a conversion, which is why leaves stay `Value`s - and
  // `SameValue` on two SymbolValues is what makes a symbol-tagged brand
  // unforgeable (F147). A round trip that unwrapped the tag would silently make
  // every symbol-tagged brand equal to every other.
  expect(evaluated("const s = Symbol('x');"
    + " const B = Reflect.makeType({ kind: 'parameterized', base: uint32, metadata: { brand: s } });"
    + ' String(Reflect.makeType(Reflect.getReflection(B)) === B);')).toBe('true');
  expect(evaluated("const a = Symbol('x'); const b = Symbol('x');"
    + " const mk = (t) => Reflect.makeType({ kind: 'parameterized', base: uint32, metadata: { brand: t } });"
    + ' String(mk(a) !== mk(b));')).toBe('true');
});

// ---------------------------------------------------------------------------
// The round trip must not achieve identity by collapsing distinctions
// ---------------------------------------------------------------------------

test('two patterns differing only in FLAGS stay distinct, before and after', () => {
  // A fix that normalised leaves - unwrapping every Value to a JS primitive,
  // say - could make the round trip an identity by making everything equal.
  // These two assertions are what stop that: distinctness is checked on the
  // originals AND on the rebuilds.
  const A = 'type A = string.<{ pattern: /^a$/i }>;';
  const B = 'type B = string.<{ pattern: /^a$/ }>;';
  expect(evaluated(`${A}${B}String(A !== B);`)).toBe('true');
  expect(evaluated(`${A}${B}String(Reflect.makeType(Reflect.getReflection(A))`
    + ' !== Reflect.makeType(Reflect.getReflection(B)));')).toBe('true');
});

test('two patterns differing only in SOURCE stay distinct, before and after', () => {
  const A = 'type A = string.<{ pattern: /^a$/ }>;';
  const B = 'type B = string.<{ pattern: /^b$/ }>;';
  expect(evaluated(`${A}${B}String(A !== B);`)).toBe('true');
  expect(evaluated(`${A}${B}String(Reflect.makeType(Reflect.getReflection(A))`
    + ' !== Reflect.makeType(Reflect.getReflection(B)));')).toBe('true');
});

test('two brands differing only in TAG stay distinct, before and after', () => {
  const A = "type A = uint32.<{ brand: 'UserId' }>;";
  const B = "type B = uint32.<{ brand: 'OrderId' }>;";
  expect(evaluated(`${A}${B}String(A !== B);`)).toBe('true');
  expect(evaluated(`${A}${B}String(Reflect.makeType(Reflect.getReflection(A))`
    + ' !== Reflect.makeType(Reflect.getReflection(B)));')).toBe('true');
});

// ---------------------------------------------------------------------------
// Properties that were true while the invariant was false
// ---------------------------------------------------------------------------

test('the rebuild is idempotent, and that is not sufficient', () => {
  // This held throughout the defect: rebuilding the rebuilt type gave itself,
  // so one conversion moved the type to a FIXED POINT that was not where it
  // started. Asserted here so it cannot regress into an oscillation - but
  // recorded as the property that made the bug stable rather than obvious.
  const P = 'type Px = string.<{ pattern: /^a$/ }>;'
    + ' const R = Reflect.makeType(Reflect.getReflection(Px));';
  expect(evaluated(`${P}String(Reflect.makeType(Reflect.getReflection(R)) === R);`)).toBe('true');
  // and now the fixed point IS the original
  expect(evaluated(`${P}String(R === Px);`)).toBe('true');
});

test('a reflected `metadata` is readable, on both leaf kinds', () => {
  // Reading this field used to ABORT the engine, not throw - which is how a
  // slot that crashed on access survived until a plan went looking for a
  // brand's tag. No test in the repository read it before that.
  expect(evaluated("type B = uint32.<{ brand: 'UserId' }>;"
    + ' String(Reflect.getReflection(B).metadata.brand);')).toBe('UserId');
  expect(evaluated('type Px = string.<{ pattern: /^a$/ }>;'
    + ' String(Reflect.getReflection(Px).metadata.pattern.source);')).toBe('^a$');
  expect(evaluated('type Px = string.<{ pattern: /^a$/ }>;'
    + ' String(Reflect.getReflection(Px).metadata.pattern.__pattern);')).toBe('true');
});

test('the entry check refuses a metadata node that is not a plain record', () => {
  // OQ2-C. The canonical form is a plain record with plain containers, and
  // nothing in the type system enforces it - the slot is declared `Value` and
  // holds something else behind a cast. This is the check that would have
  // caught F154 at construction rather than in a round-trip test three plans
  // later.
  expectThrown("Reflect.makeType({ kind: 'parameterized', base: uint32, metadata: 'not a record' });");
});

// ---------------------------------------------------------------------------
// The one remaining exception
// ---------------------------------------------------------------------------

test('`enum` is the one kind that still does not round-trip, for its own reason', () => {
  // Not the same problem. `parameterized` HAD a write-side case that was
  // incomplete; `enum` has none at all - "a type node of kind enum is not
  // supported yet". The read side emits `kind: 'enum'` with five fields, so the
  // node exists and nothing consumes it.
  //
  // Asserted as an exception so that closing it breaks a test that explains
  // why, and so that `sec-reflect-maketype`'s two named exceptions - the opaque
  // `primitive` leaf and `application` having no node - are not quietly joined
  // by a third.
  expect(evaluated("enum E { a, b } String(Reflect.getReflection(type E).kind);")).toBe('enum');
  expectThrown('enum E { a, b } Reflect.makeType(Reflect.getReflection(type E));');
});
