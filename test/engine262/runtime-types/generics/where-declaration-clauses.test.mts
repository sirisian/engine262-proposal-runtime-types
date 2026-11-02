import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: each clause of a declaration is judged at the
 * declaration under the clauses written before it, whether or not the
 * declaration is ever applied. A class's clauses and a generic alias's are
 * read over their parameters' domains, as a generic function's are.
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('a class clause is judged against its parameter\'s domain', () => {
  refused('class V<N: uint8> where N > 300 { }', 'rt-numeric-range');
  refused('class V<N: uint32> where N >= 0 { }', 'rt-impossible-test');
  refused('class V<N: uint32> where N > 5 where N < 5 { }', 'rt-impossible-test');
});

test('a generic alias clause is judged against its parameter\'s domain', () => {
  refused('type A<N: uint8> = [N].<uint8> where N > 300;', 'rt-numeric-range');
  refused('type B<N: uint32> = [N].<uint8> where N > 5 where N < 5;', 'rt-impossible-test');
});

test('a method clause is still judged under its class\'s clauses', () => {
  refused('class V<N: uint32> where N > 2 { m() where N < 2 { return 1; } }', 'rt-impossible-test');
  expect(evaluated('class V<N: uint32> where N > 2 { m() where N > 5 { return 1; } } String(new V.<6>().m());')).toBe('1');
});

test('satisfiable class and alias clauses are unchanged', () => {
  expect(evaluated('class V<N: uint32> where N > 2 { m(): uint32 { return N; } } String(new V.<3>().m());')).toBe('3');
  expect(evaluated('type A<N: uint32> = [N].<uint8> where N > 2; \'ok\';')).toBe('ok');
});
