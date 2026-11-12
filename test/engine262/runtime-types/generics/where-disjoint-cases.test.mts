import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-specialization-lists: two callable cases of one list are one case
 * declared twice only where some application satisfies the clauses of both.
 * Where the declaration-time judgment proves their clauses disjoint, they are
 * two cases, and an application selects the one whose clauses hold of it.
 */
const Q = "function q<N: uint8>(): string { return 'o'; } ";
const duplicate = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-specialization-contract' } });
};

test('cases split by range coexist, and each application selects its own', () => {
  const split = `${Q}function q<const M>(): string where M > 6 { return 'hi'; } function q<const M>(): string where M < 3 { return 'lo'; } `;
  expect(evaluated(`${split}q.<9>() + q.<1>() + q.<5>();`)).toBe('hiloo');
  expect(evaluated(`${split}function call<K: uint8>(): string { return q.<K>(); } call.<9>() + call.<1>() + call.<5>();`)).toBe('hiloo');
});

test('cases whose clauses overlap are still one case declared twice', () => {
  duplicate(`${Q}function q<const M>(): string where M > 6 { return 'hi'; } function q<const M>(): string where M > 3 { return 'mid'; }`);
  duplicate(`${Q}function q<const M>(): string where M > 6 { return 'hi'; } function q<const M>(): string { return 'all'; }`);
  duplicate(`${Q}function q<const M>(): string { return 'a'; } function q<const M>(): string { return 'b'; }`);
});

test('method cases follow the same rule', () => {
  expect(evaluated("class K { m<N: uint8>(): string { return 'o'; } m<const M>(): string where M > 6 { return 'hi'; } m<const M>(): string where M < 3 { return 'lo'; } } const k = new K(); k.m.<9>() + k.m.<1>() + k.m.<5>();")).toBe('hiloo');
});
