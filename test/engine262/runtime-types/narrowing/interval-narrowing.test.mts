import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5, Q5, direction A (#sec-narrowing-flow): an ordered comparison of an
 * integer-typed place against a constant narrows the place to an interval on
 * each branch. A later ordered comparison of the same place is decided against
 * it: one no value of the interval satisfies can never succeed, one every value
 * satisfies can never fail. Each `where` clause is walked under the clauses
 * before it, so contradictory clauses are refused at the declaration.
 */

const impossible = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test', phase: 'static' } });
};

test('an ordered comparison the interval excludes is refused', () => {
  impossible('function k(i: uint8) { if (i > 5 && i < 5) { return 1; } return 0; }');
  impossible('function k(i: uint8) { if (i > 5) { if (i < 5) { return 1; } } return 0; }');
  impossible('function k(i: uint8) { if (i > 5 && i < 3) { return 1; } return 0; }');
  impossible('function k(i: uint8) { if (i > 5) { if (i > 3) { return 1; } } return 0; }');
  impossible('function k(i: uint8) { if (i > 5) { return 0; } else { if (i > 7) { return 1; } } return 2; }');
  impossible('function k(i: int8) { if (i < -5 && i > -3) { return 1; } return 0; }');
});

test('contradictory where clauses are refused at the declaration', () => {
  impossible('function f(i: uint8) where i > 5 where i < 5 { return i; }');
  impossible('function f(i: uint8) where i > 5 && i < 5 { return i; }');
  expect(evaluated('function f(i: uint8) where i > 5 where i < 10 { return i; } String(f(7));')).toBe('7');
});

test('a satisfiable interval, an assignment, a loop, and a number are left alone', () => {
  expect(evaluated('function k(i: uint8) { if (i > 5 && i < 10) { return 1; } return 0; } String(k(7));')).toBe('1');
  expect(evaluated('function k(i: uint8, j: uint8) { if (i > 5) { i = j; if (i < 5) { return 1; } } return 0; } String(k(9, 1));')).toBe('1');
  expect(evaluated('function k(i: uint8) { while (i > 5) { i = i - 1; } return i; } String(k(9));')).toBe('5');
  expect(evaluated('function k(x: number) { if (x > 5 && x < 5) { return 1; } return 0; } "ok";')).toBe('ok');
});
