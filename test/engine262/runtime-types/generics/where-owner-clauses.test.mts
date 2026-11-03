import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-callable-overload-contracts: a bodyless owner's `where` clauses are
 * part of the contract its attached declarations keep, so every application
 * is held to them, whichever attached declaration it selects.
 */

const Q = "function q<N: uint8>(): string where N < 10; function q<5>(): string { return 'a'; } function q<20>(): string { return 'b'; }";

test('an application the owner\'s clauses accept selects as before', () => {
  expect(evaluated(`${Q} q.<5>();`)).toBe('a');
  expect(evaluated("function r<N: uint8>(): string; function r<5>(): string { return 'a'; } r.<5>();")).toBe('a');
});

test('an application the owner\'s clauses reject is refused', () => {
  expect(evaluated(`${Q} let m = 'none'; try { m = q.<20>(); } catch (e) { m = e instanceof TypeError ? 'refused' : 'other'; } m;`)).toBe('refused');
});

// Pinned as `test.fails`: a method family's application is not yet held to
// its owner's clauses.
test.fails('a method application the owner\'s clauses reject is refused', () => {
  expect(evaluated("class C { m<N: uint8>(): string where N < 10; m<5>(): string { return 'a'; } m<20>(): string { return 'b'; } } let m = 'none'; try { m = new C().m.<20>(); } catch (e) { m = 'refused'; } m;")).toBe('refused');
});
