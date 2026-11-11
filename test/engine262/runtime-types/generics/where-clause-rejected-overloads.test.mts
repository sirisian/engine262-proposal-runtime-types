import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-callable-overload-contracts: an overload attaches to the owner whose
 * list accepts it, and the owner's `where` clauses are part of what accepts:
 * a list they reject does not attach, as one the domain or bound rejects does
 * not. It is a standalone case, reached by explicit application and never
 * through the owner. A clause is decided for a list where every parameter it
 * reads is fixed, or where it can hold for no value of a captured position;
 * a clause neither decides leaves the case attached.
 */
const OWN = 'function f<N: uint8>(): string where N > 100 { return "owner"; } ';
const F5 = 'function f<5>(): string { return "five"; } ';
const CALL = 'function call<M: uint8>(): string { return f.<M>(); } ';
const caught = (expression: string): string => `(() => { try { return ${expression}; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } })()`;
const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('a fixed list the clause rejects is selected by its own application', () => {
  expect(evaluated(`${OWN}${F5}f.<5>();`)).toBe('five');
  expect(evaluated(`${OWN}${F5}function f<120>(): string { return "onetwenty"; } f.<120>() + "/" + f.<200>() + "/" + f.<5>();`)).toBe('onetwenty/owner/five');
  expect(evaluated(`${OWN}function f<5>(x: uint8): string { return "added"; } f.<5>(1);`)).toBe('added');
});

test('a standalone case is not reached through the owner', () => {
  refused(`${OWN}${F5}const g = f; g.<5>();`, 'rt-where-unsatisfied');
  expect(evaluated(`${OWN}${F5}${CALL}${caught('call.<5>()')} + "/" + call.<120>();`)).toBe('TypeError/owner');
  refused(`${OWN}f.<5>();`, 'rt-where-unsatisfied');
});

test('a clause over two parameters or a type parameter is decided for a fixed list', () => {
  const P = 'function p<N: uint8, M: uint8>(): string where N < M { return "owner"; } ';
  expect(evaluated(`${P}function p<5, 5>(): string { return "eq"; } p.<5, 5>() + "/" + p.<5, 6>();`)).toBe('eq/owner');
  const T = 'function t<T: type>(): string where Reflect.isAssignable(T, uint8) { return "owner"; } ';
  expect(evaluated(`${T}function t<string>(): string { return "str"; } t.<string>() + "/" + t.<uint8>();`)).toBe('str/owner');
});

test('a list that captures a position stays attached while some application satisfies the clause', () => {
  const P = 'function p<N: uint8, M: uint8>(): string where N < M { return "owner"; } ';
  expect(evaluated(`${P}function p<5, const K>(): string { return "five,K"; } p.<5, 9>() + "/" + p.<3, 9>();`)).toBe('five,K/owner');
  refused(`${P}function p<5, const K>(): string { return "five,K"; } p.<5, 2>();`, 'rt-where-unsatisfied');
});

test('a list the clause can hold for no value of its capture is a standalone case and states its domain', () => {
  const P = 'function p<N: uint8, M: uint8>(): string where N < M { return "owner"; } ';
  refused(`${P}function p<255, const K>(): string { return "max,K"; }`, 'rt-specialization-contract');
  expect(evaluated(`${P}function p<255, const K: uint8>(): string { return "max,K"; } p.<255, 3>() + "/" + p.<3, 9>();`)).toBe('max,K/owner');
});

test('a case whose own clause no application the owner admits satisfies is a standalone case', () => {
  refused(`${OWN}function f<const M>(): string where M < 50 { return "small"; }`, 'rt-specialization-contract');
  expect(evaluated(`${OWN}function f<const M: uint8>(): string where M < 50 { return "small"; } f.<5>() + "/" + f.<120>();`)).toBe('small/owner');
  // A clause that overlaps the owner's stays attached and held to it.
  expect(evaluated(`${OWN}function f<const M>(): string where M < 150 { return "mid"; } f.<120>() + "/" + f.<200>();`)).toBe('mid/owner');
  refused(`${OWN}function f<const M>(): string where M < 150 { return "mid"; } f.<5>();`, 'rt-where-unsatisfied');
});

test('method groups follow the same rule', () => {
  expect(evaluated('class K { m<N: uint8>(): string where N > 100 { return "owner"; } m<5>(): string { return "five"; } } new K().m.<5>() + "/" + new K().m.<120>();')).toBe('five/owner');
  expect(evaluated('class K { static m<N: uint8>(): string where N > 100 { return "owner"; } static m<5>(): string { return "five"; } } K.m.<5>();')).toBe('five');
});

test('a bodyless owner left with no attached case is refused', () => {
  refused("function q<N: uint8>(): string where N < 10; function q<20>(): string { return 'b'; }", 'rt-specialization-contract');
});

test('a clause that cannot be decided at the declaration leaves the case attached', () => {
  const D = 'const LIMIT: uint8 = 10; function d<N: uint8>(): string where N < LIMIT { return "owner"; } function d<20>(): string { return "twenty"; } ';
  expect(evaluated(`${D}${caught('d.<20>()')} + "/" + d.<5>();`)).toBe('TypeError/owner');
});
