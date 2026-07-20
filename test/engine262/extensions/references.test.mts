import { test, expect } from 'vitest';
import { evaluated, ok, bool, expectThrown } from '../readme/harness.mts';

/**
 * Extension coverage — references.md (the `ref` type).
 *
 * The `ref` TYPE is wired at the type level: `ref T` parses, resolves to a
 * reference Type Record, interns, is invariant in its target, and reflects. The
 * `ref` PARAMETER declaration parses. The borrowing RUNTIME (call-site `ref`
 * argument, `for (const ref p of a)`, write-through, liveness checks) is the
 * document's deferred part (specnotes.md: "the `ref` type is in the grammar; the
 * borrowing rules remain the document's"), documented as capability O.
 */

// ── The ref type at the type level ────────────────────────────────────────────
test('ref type: `ref T` resolves and reflects as a reference to its target', () => {
  expect(evaluated('type R = ref int32; Reflect.getReflection(R).kind;')).toBe('reference');
  // the target leaf is the target type object
  expect(ok('type R = ref int32; Reflect.getReflection(R).target === int32;')).toBe(true);
});

test('ref type: reference types intern by their target', () => {
  expect(ok('type A = ref int32; type B = ref int32; A === B;')).toBe(true);
  // distinct targets are distinct references
  expect(bool('type A = ref int32; type B = ref uint32; String(A === B);')).toBe(false);
});

test('ref type: a reference is invariant in its target', () => {
  // assignable to itself
  expect(ok('type A = ref int32; type B = ref int32; Reflect.isAssignable(A, B);')).toBe(true);
  // not assignable across different targets (invariant)
  expect(bool('type A = ref int32; type B = ref uint32; String(Reflect.isAssignable(A, B));')).toBe(false);
});

test('ref type: a ref over an object type resolves', () => {
  expect(evaluated('type R = ref { a: uint8 }; Reflect.getReflection(R).kind;')).toBe('reference');
});

// ── The ref parameter declaration parses ──────────────────────────────────────
test('ref parameter: a `ref` parameter declaration parses', () => {
  expect(evaluated('function f(ref a: int32) { return a; } typeof f;')).toBe('function');
  // a ref parameter with a body referencing it parses
  expect(evaluated('function f(ref a: int32) { let b = a; return b; } typeof f;')).toBe('function');
});

// ── Documented gaps: the borrowing runtime ────────────────────────────────────
test('ref runtime: the call-site `ref` argument does not parse (documents the gap)', () => {
  // Target (references.md): `f(ref a)` passes the caller's location.
  expectThrown('function f(ref a: int32) { a = (5 := int32); } let x: int32 = (0 := int32); f(ref x); x;');
});

test('ref runtime: the `for (const ref p of a)` form does not parse (documents the gap)', () => {
  // Target (references.md): a ref loop binds each element by reference.
  expectThrown('let a = [1, 2, 3]; for (const ref p of a) { } "ok";');
});
