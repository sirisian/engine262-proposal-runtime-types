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

// ── The typeof and indexed-access operators ───────────────────────────────────
test('type builders: the typeof type operator is the type of a value', () => {
  // typeprogramming.md 4.1: `typeof x` is the type of the value x, the query
  // Reflect.typeOf(x) performs.
  expect(evaluated('let x = (5 := uint8); type T = typeof x; (T === uint8) ? "yes" : "no";')).toBe('yes');
  // a value of that type passes the membership test, one not of it does not
  expect(evaluated('let s = "hi"; ("world" is typeof s) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('let s = "hi"; (42 is typeof s) ? "yes" : "no";')).toBe('no');
});

test('type builders: an indexed-access type is the type of the named property', () => {
  // typeprogramming.md 4.1: `T["a"]` is the type of property a, and `T[keyof T]`
  // the union of the value types.
  expect(evaluated('type T = { a: uint8, b: string }; type A = T["a"]; (A === uint8) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('type T = { a: string, b: string }; type V = T[keyof T]; (V === string) ? "yes" : "no";')).toBe('yes');
  // an optional property's access admits undefined; a required one does not
  expect(evaluated('type T = { a?: string }; (undefined is T["a"]) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('type T = { a: string }; (undefined is T["a"]) ? "yes" : "no";')).toBe('no');
  // accessing a key the type does not have is a type error
  expectThrown('type T = { a: uint8 }; type M = T["missing"]; M;');
});

// ── Documented gaps: the catalog ships as builders, not syntax ─────────────────
test('type builders: conditional-type syntax is deferred (documents the gap)', () => {
  // Target (typeprogramming.md 4.3): conditional types ship as builder functions
  // over makeType, not as `extends ? :` syntax; that syntax does not parse.
  expectThrown('type T = uint8 extends number ? "yes" : "no"; T;');
});

// ── typeof and indexed-access: depth, a qualified operand, and a round-trip ────
test('typeof and indexed access compose and round-trip through reflection', () => {
  // typeprogramming.md: indexed access chains, so an access into an access
  // resolves stepwise to the nested property type.
  expect(evaluated('type T = { a: { b: uint8 } }; type A = T["a"]["b"]; (A === uint8) ? "yes" : "no";')).toBe('yes');
  // the typeof operand may be a qualified member expression, not only a bare name
  expect(evaluated('let o = { n: (5 := uint8) }; type A = typeof o.n; (A === uint8) ? "yes" : "no";')).toBe('yes');
  // a type reached through an operator round-trips through the reflection model,
  // the same interned object coming back from getReflection then makeType
  expect(evaluated('type T = { a: uint8 }; type A = T["a"]; (Reflect.makeType(Reflect.getReflection(A)) === A) ? "yes" : "no";')).toBe('yes');
  // a binding annotated with an operator-derived type enforces it at the boundary
  expect(evaluated('type T = { n: uint8 }; let x: T["n"] = (5 := uint8); String(x);')).toBe('5');
  expectThrown('type T = { n: uint8 }; let x: T["n"] = 999; x;');
});

// ── indexed access is limited to string-literal keys today ────────────────────
test('indexed access rejects non-literal and numeric-index keys (documents the gap)', () => {
  // typeprogramming.md: beyond string-literal keys, numeric, tuple, and
  // index-signature access are not covered. Each such form is rejected today; the
  // diagnostic for a non-literal key names the string-literal requirement.
  expect(evaluated('let m = ""; try { type T = { a: uint8 }; type Z = T[number]; let x: Z = 0; } catch (e) { m = String(e.message.includes("must be a string literal")); } m;')).toBe('true');
  expect(evaluated('let m = ""; try { type T = { a: uint8 }; type Z = T[string]; let x: Z = 0; } catch (e) { m = String(e.message.includes("must be a string literal")); } m;')).toBe('true');
  // a numeric index into a tuple is likewise not resolved
  expectThrown('type T = [uint8, string]; type Z = T[0]; Z;');
});

// ── keyof binds looser than an index access, matching the TypeScript grouping ─
test('keyof applied to an index access groups as keyof of the indexed type', () => {
  // typeprogramming.md follows TypeScript here: `keyof T["a"]` groups as
  // `keyof (T["a"])`, the keys of the indexed property type, not `(keyof T)["a"]`.
  // So it resolves to the union of that property type's keys.
  expect(evaluated('type T = { a: { x: uint8, y: uint8 } }; type K = keyof T["a"]; Reflect.getReflection(K).kind;')).toBe('union');
  expect(evaluated('type T = { a: { x: uint8, y: uint8 } }; type K = keyof T["a"]; (("x" is K) && ("y" is K)) ? "both" : "no";')).toBe('both');
  expect(evaluated('type T = { a: { x: uint8, y: uint8 } }; ("z" is keyof T["a"]) ? "y" : "n";')).toBe('n');
  // the grouping is the same one written with an explicit parenthesized access,
  // and both intern to the key union of the property type itself
  expect(evaluated('type T = { a: { x: uint8, y: uint8 } }; type A = keyof T["a"]; type B = keyof (T["a"]); (A === B) ? "same" : "diff";')).toBe('same');
  expect(evaluated('type T = { a: { x: uint8, y: uint8 } }; type P = { x: uint8, y: uint8 }; type A = keyof T["a"]; type B = keyof P; (A === B) ? "same" : "diff";')).toBe('same');
  // an index access still chains left on its own, and keyof reaches over a deeper chain
  expect(evaluated('type T = { a: { b: { c: uint8 } } }; ("c" is keyof T["a"]["b"]) ? "yes" : "no";')).toBe('yes');
});
