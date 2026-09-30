import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// Early errors found in round 3 of the early-error review: narrowing and
// pattern tests the spec already makes type errors (#sec-narrowfrom, "a
// narrowing form where the test can never succeed or can never fail", and
// #sec-match-exhaustiveness). Each is judged where the test guards a branch.

// -- a clause whose values were all covered before it --------------------------
// #sec-match-exhaustiveness: a clause is dead "where every atom the clause
// covers is covered before it".
test.each([
  'const v: boolean = true; const r = match (v) { when true: 1; when false: 2; when true: 3; };',
  'enum E { A, B } const e: E = E.A; const r = match (e) { when E.A: 1; when E.B: 2; when E.A: 3; };',
  'const n: uint8 = 1; const r = match (n) { when 1: 1; when 1: 2; default: 0; };',
  'const n: uint8 = 1; const r = match (n) { when 1: 1; when 2: 2; when 1 or 2: 3; default: 0; };',
  // A `default` after a clause that matches every value can match nothing.
  'const v: uint8 = 1; const r = match (v) { when let x: 1; default: 0; };',
])('a clause that can match nothing is refused: %s', expectStaticTypeError);

test.each([
  // A guarded clause covers nothing for the clauses after it.
  'const n: uint8 = 1; const g = true; const r = match (n) { when 1 if (g): 1; when 1: 2; default: 0; }; String(r);',
  'const n: uint8 = 1; const r = match (n) { when 1: 1; when 2: 2; default: 0; }; String(r);',
  // A typed binding over a union is not irrefutable, so the default is live.
  'const v: uint8 | string = 1; const r = match (v) { when let x: uint8: 1; default: 0; }; String(r);',
])('a clause that can match is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- typeof tests ----------------------------------------------------------------
// #sec-narrowing: `typeof` is unchanged and reports "number" for every numeric
// type, so for a `uint8` the "number" test can never fail, and a tag no value
// has can never succeed.
test.each([
  "const x: uint8 = 1; if (typeof x === 'number') {}",
  "const x: uint8 = 1; if (typeof x !== 'number') {}",
  "const x: uint8 = 1; if (typeof x === 'strng') {}",
  "const x: int64 = 1; if (typeof x === 'number') {}",
  "const b: bigint = 1n; if (typeof b === 'bigint') {}",
])('a typeof test that cannot go both ways is refused: %s', expectStaticTypeError);

test.each([
  "const x: uint8 | string = 1; let r = 0; if (typeof x === 'number') { r = 1; } String(r);",
  "const x: any = 1; if (typeof x === 'strng') {} if (typeof x === 'number') {} 'ok';",
])('a typeof test that can go both ways is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- v.p === e on a union ------------------------------------------------------
const S = "type S = { k: 'a', v: uint8 } | { k: 'b', v: string }; const s: S = { k: 'a', v: 1 }; ";
test('a member literal no union member admits is refused', () => {
  expectStaticTypeError(`${S}if (s.k === 'c') {}`);
});
test('a member literal a union member admits still narrows', () => {
  expect(ok(`${S}let r = 0; if (s.k === 'a') { r = s.v; } String(r);`)).toBe(true);
});

// -- the nullish operators -------------------------------------------------------
// #sec-narrowing groups `?.` and `??=` with `??` and `== null`.
test.each([
  'const o: { a: uint8 } = { a: 1 }; const r = o?.a;',
  'const f: (x: uint8) => uint8 = (x: uint8): uint8 => x; f?.(1);',
  'let x: uint8 = 1; x ??= 2;',
])('a nullish operator on a value that cannot be nullish is refused: %s', expectStaticTypeError);

test.each([
  'const o: { a: uint8 } | null = null; const r = o?.a; String(r);',
  'const o: { a: { b: uint8 } | null } | null = { a: null }; const r = o?.a?.b; String(r);',
  'let x: uint8 | null = null; x ??= 2; String(x);',
  'const o = { a: 1 }; String(o?.a);',
])('a nullish operator on a value that may be nullish is accepted: %s', (source) => expect(ok(source)).toBe(true));
