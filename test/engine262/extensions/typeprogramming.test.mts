import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../readme/harness.mts';

/**
 * Extension coverage — typeprogramming.md.
 *
 * The design is type BUILDERS: `Reflect.makeType` plus the completed node model,
 * with the standard kit (mapped/conditional types, template literals, and the
 * rest) shipping as JavaScript over that base rather than as new syntax. The
 * builder foundation is implemented: makeType builds a type from a reflection
 * node and round-trips with getReflection; the `keyof` and `is` operators work.
 * The `typeof` type operator, indexed-access types, and the higher-level catalog
 * are deferred (capability W).
 */

// ── Reflect.makeType: the builder foundation ──────────────────────────────────
test('type builders: makeType builds a union from a node', () => {
  expect(evaluated('let U = Reflect.makeType({ kind: "union", arms: [uint8, uint16] }); Reflect.getReflection(U).kind;')).toBe('union');
  expect(evaluated('let U = Reflect.makeType({ kind: "union", arms: [uint8, uint16] }); String(Reflect.getReflection(U).arms.length);')).toBe('2');
});

test('type builders: makeType builds an array and an object', () => {
  expect(evaluated('let A = Reflect.makeType({ kind: "array", element: uint8, extent: undefined }); Reflect.getReflection(A).kind;')).toBe('array');
  expect(ok('let A = Reflect.makeType({ kind: "array", element: uint8, extent: undefined }); Reflect.getReflection(A).element === uint8;')).toBe(true);
  expect(evaluated('let O = Reflect.makeType({ kind: "object", properties: [{ name: "a", type: uint8, optional: false, readonly: false }], indexSignatures: [] }); Reflect.getReflection(O).kind;')).toBe('object');
});

test('type builders: makeType round-trips with getReflection into one interned type', () => {
  // makeType(getReflection(T)) === T, because types are interned by structure
  expect(ok('type T = uint8 | uint16; Reflect.makeType(Reflect.getReflection(T)) === T;')).toBe(true);
  expect(ok('type A = [].<uint8>; Reflect.makeType(Reflect.getReflection(A)) === A;')).toBe(true);
});

// ── keyof ─────────────────────────────────────────────────────────────────────
test('type builders: keyof yields the union of an object type\u2019s keys', () => {
  expect(evaluated('type T = { a: uint8, b: string }; type K = keyof T; Reflect.getReflection(K).kind;')).toBe('union');
});

// ── The is narrowing operator ─────────────────────────────────────────────────
test('type builders: the is operator tests a value against a type', () => {
  expect(evaluated('let x = (5 := uint8); (x is uint8) ? "yes" : "no";')).toBe('yes');
  // a value not of the type reports no
  expect(evaluated('let x = "s"; (x is uint8) ? "yes" : "no";')).toBe('no');
});

// ── Documented gaps: the operators and catalog ────────────────────────────────
test('type builders: the typeof type operator is deferred (documents the gap)', () => {
  // Target (typeprogramming.md 4.1): `type T = typeof x` is the type of the value x.
  expectThrown('let x = (5 := uint8); type T = typeof x; T;');
});

test('type builders: indexed-access types are deferred (documents the gap)', () => {
  // Target (typeprogramming.md 4.1): `T["a"]` is the type of property a.
  expectThrown('type T = { a: uint8 }; type A = T["a"]; A;');
});

test('type builders: conditional-type syntax is deferred (documents the gap)', () => {
  // Target (typeprogramming.md 4.3): conditional types ship as builder functions
  // over makeType, not as `extends ? :` syntax; that syntax does not parse.
  expectThrown('type T = uint8 extends number ? "yes" : "no"; T;');
});
