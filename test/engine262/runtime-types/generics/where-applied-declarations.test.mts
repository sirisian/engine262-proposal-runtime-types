import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: the clauses of a generic declaration the program
 * applies are decided by its applications. An application with bound
 * arguments reports what evaluating them finds; one with unbound arguments
 * defers them. A declaration nothing applies keeps its declaration-time
 * judgments.
 */

const outcome = (source: string) => {
  const r: any = observeScript(source);
  return { errorClass: r.errorClass, rule: r.diagnostic?.rule, node: r.diagnostic?.location?.nodeType };
};

test('an application reports what evaluating the clause finds', () => {
  expect(outcome('function F<N: uint32>(): void where N < 0 {} function unused() { F.<1>(); }')).toMatchObject({ rule: 'rt-where-unsatisfied', node: 'WhereClause' });
  expect(outcome('function F<N: uint32>(): void where new RegExp("[") {} function unused() { F.<1>(); }')).toMatchObject({ rule: 'rt-type-evaluation', node: 'WhereClause' });
  expect(outcome("function b() { type P<N: uint32> = uint8 where N < 0; let x: P.<1>; } 'ok';")).toMatchObject({ rule: 'rt-where-unsatisfied', node: 'WhereClause' });
});

test('an unselected conditional holds, and an unbound application defers', () => {
  expect(evaluated("function F<N: uint32>(): void where if (N < 0) { JSON.parse('{') } {} function unused() { F.<1>(); } 'ok';")).toBe('ok');
  expect(evaluated("type F<N: uint32> = uint8 where JSON.parse('{'); function outer<M: uint32>() { let x: F.<M>; } 'ok';")).toBe('ok');
});

test('a generic declaration nothing applies keeps its declaration-time judgments', () => {
  expect(outcome("function G<N: uint8>(): void where N > 300 {} 'ok';")).toMatchObject({ errorClass: 'StaticTypeError', rule: 'rt-numeric-range' });
  expect(outcome("class V<N: uint8> where N > 300 {} 'ok';")).toMatchObject({ errorClass: 'StaticTypeError', rule: 'rt-numeric-range' });
});
