import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-callable-overload-contracts: an owner's `where` clauses are part of
 * the contract its attached declarations keep, so every application that
 * selects one of them is held to the clauses: refused where it is written
 * when its arguments are constants, and at run time otherwise. A list the
 * clauses reject does not attach; it is a standalone case, reached by an
 * explicit application of its own arguments and never through the owner.
 */

const Q = "function q<N: uint8>(): string where N < 10; function q<5>(): string { return 'a'; } function q<const M>(): string where M > 6 { return 'cap'; }";
const C = "class C { m<N: uint8>(): string where N < 10; m<5>(): string { return 'a'; } m<const M>(): string where M > 6 { return 'cap'; } }";
const refused = (source: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });

test('an application the owner\'s clauses accept selects as before', () => {
  expect(evaluated(`${Q} q.<5>() + q.<8>();`)).toBe('acap');
  expect(evaluated(`${C} new C().m.<5>() + new C().m.<8>();`)).toBe('acap');
  expect(evaluated("function r<N: uint8>(): string; function r<5>(): string { return 'a'; } r.<5>();")).toBe('a');
});

test('a constant application the owner\'s clauses reject is refused where it is written, whichever attached declaration it selects', () => {
  refused(`${Q} q.<20>();`);
  refused(`${C} new C().m.<20>();`);
});

test('an application decided only at run time is refused there', () => {
  expect(evaluated(`${Q} function call<M: uint8>(): string { return q.<M>(); } let m = 'none'; try { m = call.<20>(); } catch (e) { m = e instanceof TypeError ? 'refused' : 'other'; } m + call.<5>() + call.<8>();`)).toBe('refusedacap');
});

test('a list the owner\'s clauses reject is a standalone case', () => {
  const S = "function q<N: uint8>(): string where N < 10; function q<5>(): string { return 'a'; } function q<20>(): string { return 'b'; }";
  expect(evaluated(`${S} q.<5>() + q.<20>();`)).toBe('ab');
  expect(evaluated("class K { m<N: uint8>(): string where N < 10; m<5>(): string { return 'a'; } m<20>(): string { return 'b'; } } new K().m.<5>() + new K().m.<20>();")).toBe('ab');
  // The standalone case is reached by its own constant, not through a binding the owner takes.
  expect(evaluated(`${S} function call<M: uint8>(): string { return q.<M>(); } let m = 'none'; try { m = call.<20>(); } catch (e) { m = e instanceof TypeError ? 'refused' : 'other'; } m + call.<5>();`)).toBe('refuseda');
});
