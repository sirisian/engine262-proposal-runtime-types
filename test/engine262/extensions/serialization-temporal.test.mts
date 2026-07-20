import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../readme/harness.mts';

/**
 * Extension coverage — serialization.md, dependentrecordtypes.md, temporal.md.
 *
 * These extensions are largely deferred (capabilities T, U, V). The typed-JSON and
 * `where`-clause SYNTAX parses, but the validating/converting semantics are not
 * implemented; Temporal is not exposed in this configuration. Untyped JSON works.
 * This file records the boundaries and verifies the untyped baseline.
 */

// ── Serialization: untyped baseline works ─────────────────────────────────────
test('serialization: untyped JSON.parse and JSON.stringify work', () => {
  expect(evaluated('let o = JSON.parse(\'{"a":5}\'); String(o.a);')).toBe('5');
  expect(evaluated('JSON.stringify({ a: 5 });')).toBe('{"a":5}');
  // round trip
  expect(evaluated('JSON.stringify(JSON.parse(\'{"a":5,"b":"x"}\'));')).toBe('{"a":5,"b":"x"}');
});

test('serialization: JSON.parse.<T> parses but does not yet validate or convert (documents the gap)', () => {
  // Target (serialization.md): JSON.parse.<T> converts leaves to T and validates.
  // Today the type argument is accepted but ignored: the value is a plain number,
  // not a uint8, and an out-of-range value is not rejected.
  expect(evaluated('type T = { a: uint8 }; let o = JSON.parse.<T>(\'{"a":5}\'); o.a === (5 := uint8) ? "typed" : "untyped";')).toBe('untyped');
  expect(evaluated('type T = { a: uint8 }; let o = JSON.parse.<T>(\'{"a":300}\'); String(o.a);')).toBe('300');
});

// ── Dependent record types: where clauses parse but do not validate ───────────
test('dependent records: a where clause parses and the type resolves', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; typeof Pos;')).toBe('object');
  // the type is still an object type structurally
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; Reflect.getReflection(Pos).kind;')).toBe('object');
});

test('dependent records: the where predicate is not enforced (documents the gap)', () => {
  // Target (dependentrecordtypes.md): a value violating the predicate is rejected.
  // Today the predicate is not evaluated, so a: 0 is accepted despite `a > 0`.
  expect(ok('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (0 := uint8) }; p.a === (0 := uint8);')).toBe(true);
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
