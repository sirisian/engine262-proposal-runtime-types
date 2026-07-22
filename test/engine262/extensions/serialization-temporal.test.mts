import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * Extension coverage - serialization.md, dependentrecordtypes.md, temporal.md.
 *
 * Typed JSON parsing (`JSON.parse.<T>`) now converts and validates: see the
 * dedicated typed-json-parse test file for the full coverage. The `where`-clause
 * SYNTAX parses but the predicate is not enforced (dependent record types are
 * deferred), Temporal is not exposed in this configuration, and `structuredClone`
 * is absent from the base engine. This file records those boundaries and verifies
 * the untyped JSON baseline.
 */

// ── Serialization: untyped baseline works ─────────────────────────────────────
test('serialization: untyped JSON.parse and JSON.stringify work', () => {
  expect(evaluated('let o = JSON.parse(\'{"a":5}\'); String(o.a);')).toBe('5');
  expect(evaluated('JSON.stringify({ a: 5 });')).toBe('{"a":5}');
  // round trip
  expect(evaluated('JSON.stringify(JSON.parse(\'{"a":5,"b":"x"}\'));')).toBe('{"a":5,"b":"x"}');
});

test('serialization: JSON.parse.<T> converts leaves and validates', () => {
  // JSON.parse.<T> now threads T through the parse: a numeric leaf becomes its
  // target type, and an out-of-range value is rejected with a TypeError.
  expect(evaluated('type T = { a: uint8 }; let o = JSON.parse.<T>(\'{"a":5}\'); o.a === (5 := uint8) ? "typed" : "untyped";')).toBe('typed');
  expectThrown('type T = { a: uint8 }; let o = JSON.parse.<T>(\'{"a":300}\'); String(o.a);');
});

// ── Dependent record types: where clauses are enforced at boundaries ──────────
test('dependent records: a where clause makes the alias a dependent record type', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; typeof Pos;')).toBe('object');
  // A where clause gives the alias declaration identity, so it resolves to a
  // nominal type (which reflects as 'primitive', as every nominal type does)
  // rather than the transparent structural object a plain alias resolves to.
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; Reflect.getReflection(Pos).kind;')).toBe('primitive');
  expect(evaluated('type Plain = { a: uint8 }; Reflect.getReflection(Plain).kind;')).toBe('object');
});

test('dependent records: the where predicate is enforced at a boundary', () => {
  // A value satisfying the predicate is accepted; one violating it is rejected.
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; String(p.a);')).toBe('5');
  expectThrown('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (0 := uint8) }; p.a;');
});

// ── Temporal: not exposed here ────────────────────────────────────────────────
test('temporal: Temporal is not exposed as a type source in this configuration (documents the gap)', () => {
  // Target (temporal.md): Temporal.Unit, Temporal.Instant, etc. as types.
  expect(evaluated('typeof Temporal;')).toBe('undefined');
});

// ── structuredClone: base-engine absence ──────────────────────────────────────
test('serialization: structuredClone is absent from the base engine (documents the gap)', () => {
  expectThrown('let o = structuredClone({ a: 5 }); o.a;');
});
