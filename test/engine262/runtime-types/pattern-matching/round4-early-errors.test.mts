import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// Early errors found in round 4 of the early-error review: tests that can never
// go both ways (#sec-narrowfrom) on shapes the round 1-3 fixes did not reach.

// -- literal patterns on a literal subject ----------------------------------------
// #sec-match-exhaustiveness: a literal union has no atoms, but the NarrowFrom
// fold still empties it - `match (1) { when 1: ... }` is the spec's example.
test.each([
  'const r = match (1) { when 1: 1; default: 2; };',
  "const v: 1 | 2 = 1; const r = match (v) { when 1: 'a'; when 2: 'b'; default: 'c'; };",
  "const v: 1 | 2 = 1; const r = match (v) { when 3: 'c'; default: 'x'; };",
  "const v: 1 | 2 = 1; const r = match (v) { when -1: 'n'; default: 'x'; };",
  "const v: 'a' | 'b' = 'a'; const r = match (v) { when 'a': 1; when 'b': 2; default: 3; };",
])('a clause over a literal subject that can match nothing is refused: %s', expectStaticTypeError);

test.each([
  "const r = match (1) { when 1: 'one'; }; String(r);",
  "function readV(): 1 | 2 { return 2; } const v: 1 | 2 = readV(); const r = match (v) { when 1: 'a'; default: 'c'; }; String(r);",
  "const v: uint8 = 2; const r = match (v) { when 1: 'a'; when 2: 'b'; default: 'c'; }; String(r);",
])('a clause over a literal subject that can match is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- typeof 'function' -----------------------------------------------------------
test.each([
  "const f: (x: uint8) => uint8 = (x: uint8): uint8 => x; if (typeof f === 'function') {}",
  "const f: (x: uint8) => uint8 = (x: uint8): uint8 => x; if (typeof f === 'object') {}",
  "class K { a: uint8 = 1; } const k: K = new K(); if (typeof k === 'function') {}",
])('a typeof test on a function type or typed class instance that cannot go both ways is refused: %s', expectStaticTypeError);

test.each([
  "class U { m() {} } const u: U = new U(); if (typeof u === 'function') {} 'ok';",
  "function readF(): ((x: uint8) => uint8) | null { return null; } const f: ((x: uint8) => uint8) | null = readF(); let r = 0; if (typeof f === 'function') { r = 1; } String(r);",
])('a typeof test that can go both ways is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- string and boolean case labels ------------------------------------------------
test.each([
  "const v: 'a' | 'b' = 'a'; switch (v) { case 'c': break; default: break; }",
  'const b: true = true; switch (b) { case false: break; default: break; }',
  "type S = { k: 'a' } | { k: 'b' }; const s: S = { k: 'a' }; switch (s.k) { case 'c': break; default: break; }",
])('a literal case label the discriminant cannot hold is refused: %s', expectStaticTypeError);

test.each([
  "const v: 'a' | 'b' = 'a'; let r = 0; switch (v) { case 'a': r = 1; break; default: break; } String(r);",
  "function readV(): string { return 'a'; } const v: string = readV(); let r = 0; switch (v) { case 'z': r = 1; break; default: break; } String(r);",
  'const b: true = true; let r = 0; switch (b) { case true: r = 1; break; default: break; } String(r);',
])('a literal case label the discriminant can hold is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- a default after every atom ------------------------------------------------------
test.each([
  'const v: null | undefined = null; const r = match (v) { when null: 1; when undefined: 2; default: 3; };',
  'enum E { A, B } function f(e: E) { switch (e) { case E.A: break; case E.B: break; default: break; } }',
  'sealed abstract class N {} class A extends N {} class B extends N {} function f(n: N) { switch (n) { case A: break; case B: break; default: break; } }',
])('a default after every atom is refused: %s', expectStaticTypeError);

test.each([
  "enum E { A, B } function f(e: E) { switch (e) { case E.A: break; default: break; } } 'ok';",
  "sealed class N {} class A extends N {} class B extends N {} function f(n: N) { switch (n) { case A: break; case B: break; default: break; } } 'ok';",
  "sealed abstract class N {} class A extends N {} class B extends N {} function f(n: N) { switch (n) { case A: break; default: break; } } 'ok';",
])('a default that can be taken is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- ?. on an always-nullish receiver ----------------------------------------------
test.each([
  'const o: null = null; const r = o?.a;',
  'const o: undefined = undefined; const r = o?.a;',
])('an optional chain whose receiver is always nullish is refused: %s', expectStaticTypeError);

test('an optional chain whose receiver may be nullish is accepted', () => {
  expect(ok('function readO(): { a: uint8 } | null { return null; } const o: { a: uint8 } | null = readO(); const r = o?.a; String(r);')).toBe(true);
});
