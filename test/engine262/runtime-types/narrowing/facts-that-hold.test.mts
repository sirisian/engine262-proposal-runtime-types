import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// Narrowing facts the spec says hold (#sec-narrowing) in a `case` body, past an
// earlier test of a chain, and in a loop, which make a later test one that can
// never succeed or never fail (#sec-narrowfrom).

// -- case bodies -----------------------------------------------------------------
test.each([
  "const v: 'a' | 'b' = 'a'; switch (v) { case 'a': if (v === 'b') {} break; default: break; }",
  "const v: 'a' | 'b' = 'a'; switch (v) { case 'a': break; default: if (v === 'a') {} break; }",
  'const x: uint8 = 1; switch (x) { case 1: if (x === 3) {} break; default: break; }',
  // `case e` "where e names a literal type": a `const` naming one counts.
  "const K = 'a'; const v: 'a' | 'b' = 'a'; switch (v) { case K: if (v === 'b') {} break; default: break; }",
])('a test a case label makes impossible is refused: %s', expectStaticTypeError);

test.each([
  "const v: 'a' | 'b' | 'c' = 'a'; let r = 0; switch (v) { case 'a': case 'b': if (v === 'a') { r = 1; } break; default: break; } String(r);",
  "const v: 'a' | 'b' | 'c' = 'a'; let r = 0; switch (v) { case 'a': r = 1; break; default: if (v === 'b') { r = 2; } break; } String(r);",
  "const v: 'a' | 'b' = 'a'; let r = 0; switch (v) { case 'a': let q = 1; r = q; break; default: break; } String(r);",
])('a test a case label leaves live is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- typeof 'number' takes every numeric type --------------------------------------
test.each([
  "const x: uint8 | string = 1; if (typeof x === 'number') {} else if (typeof x === 'number') {}",
  "const x: uint8 | string = 1; if (typeof x === 'number') { if (typeof x === 'string') {} }",
])('a typeof test the earlier one decides is refused: %s', expectStaticTypeError);

test.each([
  "const x: uint8 | string | boolean = 1; let r = 0; if (typeof x === 'number') {} else if (typeof x === 'string') { r = 1; } String(r);",
  "const x: uint8 | { a: uint8 } = 1; let r = 0; if (typeof x === 'number') { r = 1; } String(r);",
])('a typeof test that can go both ways is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- for loops -------------------------------------------------------------------
test('a test a for condition makes impossible is refused', () => {
  expectStaticTypeError("function f(v: 'a' | 'b') { for (; v === 'a';) { if (v === 'b') {} break; } }");
});
test.each([
  "function f(v: 'a' | 'b' | 'c') { for (; v !== 'a';) { if (v === 'b') {} break; } } 'ok';",
  'let s = 0; for (let i = 0; i < 3; i++) { s += i; } String(s);',
  "function f(v: 'a' | 'b') { do { if (v === 'b') {} } while (v === 'a'); } 'ok';",
])('a for or do-while body that can go both ways is accepted: %s', (source) => expect(ok(source)).toBe(true));
