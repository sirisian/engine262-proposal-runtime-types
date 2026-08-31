import { expect, test } from 'vitest';
import { evaluated, expectError, ok } from '../harness.mts';

/**
 * `PLAN-parameter-composition.md` Stage E — the plan's own acceptance criteria,
 * asserted rather than claimed.
 *
 * The plan's "done when": §1.1's two lines refused, §1.3's four still accepted,
 * and no suite regresses. Each is pinned below with the section it comes from,
 * so a later change that breaks one is told which promise it broke.
 *
 * The subject is what a type PARAMETER composes into. Three things were wrong
 * and are fixed: a parameter carried no constraint, so a constrained one was
 * less usable than an unconstrained one (Stage A); a computed access with a
 * String literal key had no type at all (Stage B); and an indexed access over a
 * parameter resolved to nothing, so its annotation was unchecked (Stages C/D).
 */

const okSrc = (s: string) => expect(ok(s), `expected accepted: ${s}`).toBe(true);

// -- §1.1, the reported gap: these must be REFUSED -----------------------------

test('§1.1 an indexed access over a parameter refuses a concrete value', () => {
  expectError('function p<T, K: keyof T>(o: T, k: K): T[K] { return 5; }');
  expectError('function p<T, K: keyof T>(o: T, k: K) { let v: T[K] = 5; }');
});

// -- §1.3, what must not break: these must be ACCEPTED -------------------------

test('§1.3 a generic accessor still type checks', () => {
  // The one the whole staging was ordered around: it passes because `o[k]` and
  // `T[K]` reach one operation and answer one record, not because either is
  // unresolvable.
  okSrc('function p<T, K: keyof T>(o: T, k: K): T[K] { return o[k]; }');
  expect(evaluated('function p<T, K: keyof T>(o: T, k: K): T[K] { return o[k]; } let u = { n: "x" }; String(p(u, "n"));')).toBe('x');
});

test('§1.3 the identities hold', () => {
  okSrc('function q<T>(o: T, k: keyof T): keyof T { return k; }');
  okSrc('function f<T>(x: T): T { return x; }');
});

test('§1.3 the call boundary is unchanged', () => {
  okSrc('function id<T>(v: T) { return v; } id(5); id("hi"); id({});');
});

// -- that the fix is real, not fail-open ---------------------------------------

test('the deferred access is TYPED, not merely unresolvable', () => {
  // If `o[k]` were still unresolvable these would pass, and the criterion above
  // would be satisfied for the wrong reason.
  expectError('function p<T, K: keyof T>(o: T, k: K) { let v: string = o[k]; }');
  expectError('function p<T, K: keyof T>(o: T, k: K) { let v: uint8 = o[k]; }');
  okSrc('function p<T, K: keyof T>(o: T, k: K) { let v: T[K] = o[k]; }');
});

test('the two RESOLVERS agree about the deferred case', () => {
  // The checker deferred and the runtime raised, because the shared record had
  // two callers and both were in the checker while this path kept its own copy
  // of the walk. A class field is resolved by the runtime.
  okSrc('class Box<T, K: keyof T> { v: T[K]; }');
  okSrc('class Box<T> { v: keyof T; }');
  okSrc('class Box<T> { v: T; }');
});

test('and the concrete cases are untouched', () => {
  expect(evaluated('type T = { n: uint8 }; type A = T["n"]; String(A === uint8);')).toBe('true');
  expect(evaluated('let o: { n: uint8 } = { n: 1 }; let v: uint8 = o["n"]; String(v);')).toBe('1');
  // including each of the three distinct errors the walk still raises
  expectError('type A = uint8["a"];');
  expectError('type T = { a: uint8 }; type A = T[number];');
  expectError('type T = { a: uint8 }; type A = T["zz"];');
});

test('a PARENTHESIZED type may be indexed, as the grammar says', () => {
  // `PostfixType : PrimaryType`, and a parenthesized type is one. The parser
  // rejoined the grammar at the INTERSECTION level after looking past `(` to
  // tell a FunctionType from a parenthesized one, so it skipped the postfix
  // level: `(A | B)["n"]` was a SyntaxError while `U["n"]` for a named alias was
  // not. Parenthesising is the only way to index a union written inline.
  expect(evaluated('type A = ({ n: uint8 })["n"]; String(A === uint8);')).toBe('true');
  expect(evaluated('type A = ({ n: uint8 } | { n: uint8 })["n"]; String(A === uint8);')).toBe('true');
  // and the two forms `(` still has to distinguish are unaffected
  expect(evaluated('type F = (a: uint8) => string; String(typeof F);')).toBe('object');
  expect(evaluated('type A = (uint8); String(A === uint8);')).toBe('true');
});

test('the deferred case reaches inside a UNION operand', () => {
  // `mentionsParameter` recurses through union and intersection members, so a
  // union with a parameter arm defers rather than resolving to nothing.
  expectError('function p<T>(o: T) { let v: (T | { n: uint8 })["n"] = 1; }');
});
