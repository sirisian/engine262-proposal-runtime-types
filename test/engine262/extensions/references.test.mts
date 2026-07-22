import { test, expect } from 'vitest';
import { evaluated, ok, bool } from '../readme/harness.mts';

/**
 * Extension coverage — references.md (the `ref` type and borrowing runtime).
 *
 * The `ref` TYPE is wired at the type level: `ref T` parses, resolves to a
 * reference Type Record, interns, is invariant in its target, and reflects. The
 * borrowing RUNTIME is implemented as capability O: the call-site `ref` argument
 * and `ref` return, `ref` parameter aliasing, the `let ref` / `const ref`
 * lexical binding and rebinding, the index-based `for (const ref p of a)` loop,
 * decay to the referent at value boundaries, and the two liveness rules. The
 * fuller borrowing surface (location-consuming returns such as `first(a)++`,
 * destructuring `ref` members, and the SoA/typed-buffer substrate) is exercised
 * in extensions/ref-borrowing.test.mts and noted there as deferred.
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

// ── The borrowing runtime (capability O) ──────────────────────────────────────
test('ref runtime: the call-site `ref` argument passes the caller location', () => {
  // Target (references.md): `f(ref a)` passes the caller's location, so a write
  // in the callee is a write in the caller.
  expect(evaluated('function f(ref a) { a++; } let x = 0; f(ref x); String(x);')).toBe('1');
});

test('ref runtime: the `for (const ref p of a)` form binds each element by reference', () => {
  // Target (references.md): a ref loop binds each element by reference, so the
  // body writes into the array in place.
  expect(evaluated('let a = [1, 2, 3]; for (let ref p of a) { p = p * 10; } a[0] + "," + a[1] + "," + a[2];')).toBe('10,20,30');
});
