import { expect, test } from 'vitest';
import { expectThrown, ok, evaluated } from '../harness.mts';

/**
 * sec-enums lets two enumerators of ONE enum share a value. The rule against a
 * repeated value is about two ENUMS, and only where the underlying type's values
 * carry their own identity:
 *
 *   "Where the underlying type's values are compared by CONTENT, an enumerator
 *   is a distinct value of that content carrying its enum, so two enums may name
 *   the same content."
 *
 * So `enum E { A = 1, B = 1 }` declares one value under two names, and
 * `E.A === E.B` is true. A switch matching `E.A` therefore matches every value
 * the type admits - measured: with `let e: E = E.B`, the arm that runs is
 * `E.A`'s - and reporting `B` as missing refused an exhaustive program.
 *
 * The rule counted NAMES where the switch matches VALUES. An enumerator is
 * missing only when no covered enumerator shares its value.
 */

test('an alias is covered by the name that shares its value', () => {
  const A = 'enum E { A = 1, B = 1 } let e: E = E.A; ';
  expect(ok(`${A}switch (e) { case E.A: break; } "ok";`)).toBe(true);
  expect(ok(`${A}switch (e) { case E.B: break; } "ok";`)).toBe(true);
  // `match` shares the rule and the fix.
  expect(ok(`${A}let q = match (e) { when E.A: 1 };`)).toBe(true);
  // The premise, measured rather than assumed.
  expect(evaluated('enum E { A = 1, B = 1 } String(E.A === E.B);')).toBe('true');
  expect(evaluated('enum E { A = 1, B = 1 } let e: E = E.B; let hit = "none";'
    + ' switch (e) { case E.A: hit = "A"; break; default: hit = "default"; } hit;')).toBe('A');
});

test('DISTINCT values still need every arm', () => {
  const D = 'enum E { A = 1, B = 2 } let e: E = E.A; ';
  expectThrown(`${D}switch (e) { case E.A: break; } "ok";`, 'is missing');
  expectThrown(`${D}let q = match (e) { when E.A: 1 };`, 'is missing');
  expect(ok(`${D}switch (e) { case E.A: break; case E.B: break; } "ok";`)).toBe(true);
  expect(ok(`${D}switch (e) { case E.A: break; default: break; } "ok";`)).toBe(true);
  // An auto-numbered enum gives every member its own value.
  expectThrown('enum E { A, B } let e: E = E.A; switch (e) { case E.A: break; } "ok";', 'is missing');
});

test('only the shared value is forgiven', () => {
  // `A` and `B` are one value; `C` is its own and is still required.
  const M = 'enum E { A = 1, B = 1, C = 2 } let e: E = E.A; ';
  expect(ok(`${M}switch (e) { case E.A: break; case E.C: break; } "ok";`)).toBe(true);
  expectThrown(`${M}switch (e) { case E.A: break; } "ok";`, 'is missing "C"');
});
