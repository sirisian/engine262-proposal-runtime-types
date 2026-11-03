import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-callable-overload-contracts: a bodyless owner's `where` clauses are
 * part of the contract its attached declarations keep, so every application
 * is held to them, whichever attached declaration it selects: refused where
 * it is written when its arguments are constants, and at run time otherwise.
 */

const Q = "function q<N: uint8>(): string where N < 10; function q<5>(): string { return 'a'; } function q<20>(): string { return 'b'; }";
const C = "class C { m<N: uint8>(): string where N < 10; m<5>(): string { return 'a'; } m<20>(): string { return 'b'; } }";
const refused = (source: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });

test('an application the owner\'s clauses accept selects as before', () => {
  expect(evaluated(`${Q} q.<5>();`)).toBe('a');
  expect(evaluated(`${C} new C().m.<5>();`)).toBe('a');
  expect(evaluated("function r<N: uint8>(): string; function r<5>(): string { return 'a'; } r.<5>();")).toBe('a');
});

test('a constant application the owner\'s clauses reject is refused where it is written', () => {
  refused(`${Q} q.<20>();`);
  refused(`${C} new C().m.<20>();`);
});

test('an application decided only at run time is refused there', () => {
  expect(evaluated(`${Q} function call<M: uint8>(): string { return q.<M>(); } let m = 'none'; try { m = call.<20>(); } catch (e) { m = e instanceof TypeError ? 'refused' : 'other'; } m + call.<5>();`)).toBe('refuseda');
});
