import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// Early errors found in round 5 of the early-error review: narrowing facts the
// spec says hold (#sec-narrowing), which make a later test one that can never
// succeed or never fail (#sec-narrowfrom).

// -- case bodies -----------------------------------------------------------------
test.each([
  "const v: 'a' | 'b' = 'a'; switch (v) { case 'a': if (v === 'b') {} break; default: break; }",
  "const v: 'a' | 'b' = 'a'; switch (v) { case 'a': break; default: if (v === 'a') {} break; }",
  'const x: uint8 = 1; switch (x) { case 1: if (x === 3) {} break; default: break; }',
  // `case e` "where e names a literal type": a `const` naming one counts.
  "const K = 'a'; const v: 'a' | 'b' = 'a'; switch (v) { case K: if (v === 'b') {} break; default: break; }",
])('a test a case label makes impossible is refused: %s', expectStaticTypeError);

test.each([
  "function f(v: 'a' | 'b' | 'c') { let r = 0; switch (v) { case 'a': case 'b': if (v === 'a') { r = 1; } break; default: break; } return r; } String(f('a'));",
  "function f(v: 'a' | 'b' | 'c') { let r = 0; switch (v) { case 'a': r = 1; break; default: if (v === 'b') { r = 2; } break; } return r; } String(f('a'));",
  "const v: 'a' | 'b' = 'a'; let r = 0; switch (v) { case 'a': let q = 1; r = q; break; default: break; } String(r);",
])('a test a case label leaves live is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- typeof 'number' takes every numeric type --------------------------------------
test.each([
  "function readX(): uint8 | string { return 1; } const x: uint8 | string = readX(); if (typeof x === 'number') {} else if (typeof x === 'number') {}",
  "function readX(): uint8 | string { return 1; } const x: uint8 | string = readX(); if (typeof x === 'number') { if (typeof x === 'string') {} }",
])('a typeof test the earlier one decides is refused: %s', expectStaticTypeError);

test.each([
  "function readX(): uint8 | string | boolean { return 1; } const x: uint8 | string | boolean = readX(); let r = 0; if (typeof x === 'number') {} else if (typeof x === 'string') { r = 1; } String(r);",
  "function readX(): uint8 | { a: uint8 } { return 1; } const x: uint8 | { a: uint8 } = readX(); let r = 0; if (typeof x === 'number') { r = 1; } String(r);",
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
