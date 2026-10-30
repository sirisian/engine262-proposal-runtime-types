import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5 follow-up, Q11: a class's own `where` clauses, after its heritage
 * and before its body, are specialization predicates over its type parameters.
 * Every application of the class is judged against them before the body where
 * the checker can see it, and every specialization at run time otherwise; the
 * clauses are screened for compile-time evaluability as any where clause is,
 * and a method's own clauses are judged together with the class's at a call.
 */

const unsatisfied = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
};

test('an application the class clause rejects is refused before the body', () => {
  unsatisfied('class V<N: uint32> where N > 2 { } new V.<1>();');
  unsatisfied('class V<N: uint32> where N > 2 { } function f() { return new V.<1>(); }');
  unsatisfied('class V<N: uint32> where N > 2 { } class W extends V.<1> { }');
  expect(evaluated('class V<N: uint32> where N > 2 { m(): uint32 { return N; } } String(new V.<3>().m());')).toBe('3');
});

test('a class clause is screened as any where clause is', () => {
  for (const source of ['class V<N: uint32> where N > Math.random() { }', 'let limit = 2; class V<N: uint32> where N > limit { }', 'class V<N: uint32> where N > nothere { }']) {
    expect(observeScript(source)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-compile-time-evaluability' } });
  }
});

test('a method is called under the class clause and its own', () => {
  const V = 'class V<N: uint32> where N > 2 { m<I: uint32>(): uint32 where I < N { return I; } } ';
  expect(evaluated(`${V}String(new V.<4>().m.<3>());`)).toBe('3');
  unsatisfied(`${V}new V.<4>().m.<5>();`);
});

test('an application in a type position is judged too', () => {
  unsatisfied('class V<N: uint32> where N > 2 { } let v: V.<1>;');
  unsatisfied('class V<N: uint32> where N > 2 { } function f(v: V.<1>) { return v; }');
  expect(evaluated("class V<N: uint32> where N > 2 { } let v: V.<3> = new V.<3>(); 'ok';")).toBe('ok');
});

test('a method clause is judged under the class clause at its declaration (the merge)', () => {
  const impossible = (source: string): void => {
    expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
  };
  impossible('class V<N: uint32> where N > 2 { m() where N < 2 { return 1; } }');
  impossible('class V<N: uint32> where N > 2 { m() where N > 1 { return 1; } }');
  expect(evaluated('class V<N: uint32> where N > 2 { m() where N > 5 { return 1; } } String(new V.<6>().m());')).toBe('1');
  // The same narrowing judges a generic function's clauses over its value parameters.
  impossible('function g<N: uint32>() where N > 5 where N < 5 { return N; }');
  expect(evaluated('function g<N: uint32>() where N > 5 where N < 9 { return N; } String(g.<6>());')).toBe('6');
});
