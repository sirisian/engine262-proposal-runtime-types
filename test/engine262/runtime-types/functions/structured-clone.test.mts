import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * `structuredClone(value)` and its typed signature.
 *
 * PLAN-remaining-blockers.md item 6. It is defined by HTML rather than by
 * ECMAScript and this engine did not provide it, so the signature
 * `standardlibrary.md` states - `structuredClone<T>(value: T): T` - could not be
 * given: a signature is a claim that the function EXISTS.
 *
 * Implemented here because a structured clone is HOW a program moves a typed
 * value across a boundary, and the identity signature exists so the type
 * survives the crossing. Scoped to the ECMAScript-shaped subset: HTML's
 * transferables and `SharedArrayBuffer` mean nothing in a bare engine.
 */

test('the clone is deep, and independent of its source', () => {
  expect(evaluated('const a = { x: 1 }; const b = structuredClone(a); b.x = 9; String(a.x);')).toBe('1');
  expect(evaluated('const a = { n: { y: 2 } }; const b = structuredClone(a); b.n.y = 9; String(a.n.y);')).toBe('2');
  expect(evaluated('const a = [1, 2]; const b = structuredClone(a); b[0] = 9; String(a[0]);')).toBe('1');
  expect(evaluated('const mp = new Map(); mp.set("k", 1); const b = structuredClone(mp); String(b.get("k"));')).toBe('1');
  expect(evaluated('const s = new Set([1, 2]); const b = structuredClone(s); String(b.size);')).toBe('2');
});

test('a CYCLE terminates and SHARING is preserved', () => {
  // The memo is what makes both true. A naive recursion loses its termination
  // on the first and its sharing on the second: two references to one object in
  // the source must be two references to ONE object in the clone.
  expect(evaluated('const a = { x: 1 }; a.self = a; const b = structuredClone(a); String(b.self === b);')).toBe('true');
  expect(evaluated('const sh = { v: 1 }; const a = { p: sh, q: sh }; const b = structuredClone(a); String(b.p === b.q);')).toBe('true');
});

test('what cannot be cloned is REFUSED', () => {
  // HTML raises a *DataCloneError*, a DOM exception this engine does not define,
  // so a *TypeError* is raised instead - refusing with a catchable error is the
  // behaviour that matters, and inventing a DOM exception hierarchy to carry one
  // name would be a larger change than this signature is worth.
  expect(evaluated('try { structuredClone(() => 1); "no"; } catch (e) { "caught"; }')).toBe('caught');
  expect(evaluated('try { structuredClone(Symbol("x")); "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('the clone KEEPS its type, which is what the signature is for', () => {
  // A value type class instance clones by the copy #sec-value-type-copying
  // already defines, so it carries its type, its private state and its sealing -
  // giving a structured clone different semantics from an assignment, for one
  // kind of value, would have been the alternative.
  const V = 'class P { x: uint8 = 0; } ';
  expect(evaluated(`${V} const a = new P(); const b = structuredClone(a); String(Reflect.typeOf(b) === (type P));`)).toBe('true');
  expect(evaluated(`${V} const a = new P(); a.x = 1; const b = structuredClone(a); b.x = 9; String(a.x);`)).toBe('1');
  expect(evaluated('const a: [].<uint8> = [1, 2]; const b = structuredClone(a); String(b.length);')).toBe('2');
});

test('the SIGNATURE is an identity, not a fixed result', () => {
  expect(ok('const a: [].<uint8> = [1]; let n: [].<uint8> = structuredClone(a);')).toBe(true);
  expectStaticTypeError('const a: [].<uint8> = [1]; let n: string = structuredClone(a);');
  expect(ok('class P { x: uint8 = 0; } const a: P = new P(); let n: P = structuredClone(a);')).toBe(true);
  expectStaticTypeError('class P { x: uint8 = 0; } const a: P = new P(); let n: string = structuredClone(a);');
  // An untyped argument yields an untyped result, and a program that shadows the
  // name gets its own function.
  expect(ok('if (false) { const u = { x: 1 }; let n: uint8 = structuredClone(u); } 1;')).toBe(true);
  expect(ok('if (false) { function structuredClone(x) { return x; } const a: [].<uint8> = [1]; let n: string = structuredClone(a); } 1;')).toBe(true);
});
