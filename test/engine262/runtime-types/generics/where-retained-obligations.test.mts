import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: an application whose arguments still name enclosing
 * value parameters retains its callee's clauses as obligations on them. One
 * that the enclosing declarations' domains and clauses rule out can never
 * hold, whichever specialization reaches it, and is refused at the
 * application; an obligation that can hold stays a specialization-time check.
 */
const unsatisfiable = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
};
const A = 'class A<N: uint8> where N > 100 {}';
const G = 'function g<N: uint8>() where N > 100 { return N; }';

test('a heritage the enclosing class\'s clauses rule out is refused', () => {
  unsatisfiable(`${A} class B<M: uint8> extends A.<M> where M < 50 {}`);
});

test('an application in a body or an annotation the enclosing clauses rule out is refused', () => {
  unsatisfiable(`${G} function h<M: uint8>() where M < 50 { return g.<M>(); }`);
  unsatisfiable(`${A} function h<M: uint8>(a: A.<M>) where M < 50 { return a; }`);
});

test('an alias application inside another alias the enclosing clauses rule out is refused', () => {
  unsatisfiable('type A<N: uint8> = [N].<uint8> where N > 100; type B<M: uint8> = A.<M> where M < 50;');
  expect(evaluated("type A<N: uint8> = [N].<uint8> where N > 100; type B<M: uint8> = A.<M> where M > 150; 'ok';")).toBe('ok');
});

test('an application the enclosing parameter\'s domain rules out is refused', () => {
  unsatisfiable('function g<N: uint32>() where N > 1000 { return N; } function h<M: uint8>() { return g.<M>(); }');
});

test('an obligation that can hold stays a specialization-time check', () => {
  expect(evaluated(`${G} function h<M: uint8>() where M > 150 { return g.<M>(); } String(h.<200>());`)).toBe('200');
  expect(observeScript(`${G} function h<M: uint8>() { return g.<M>(); } h.<5>();`)).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});

/**
 * The callee's clause is walked as a test under the enclosing facts, each
 * callee parameter reading as the place or constant it is bound to, so every
 * narrowing form is judged, not only an ordered comparison; a conditional
 * enclosing clause holds the union of its branches; and a class applied in an
 * expression retains its clauses as one applied in a type does.
 */
const accepted = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ completion: { Type: 'normal' } });
};
test('equality, inequality, disjunction and two-parameter clauses are judged under the enclosing facts', () => {
  unsatisfiable('function e<N: uint8>() where N === 7 { return N; } function h<M: uint8>() where M < 5 { return e.<M>(); }');
  unsatisfiable('function n<N: uint8>() where N !== 3 { return N; } function h<M: uint8>() where M === 3 { return n.<M>(); }');
  unsatisfiable('function m<N: uint8, K: uint8>() where N < K { return N; } function h<M: uint8>() where M > 200 { return m.<M, 100>(); }');
  unsatisfiable('function d<N: uint8>() where N < 10 || N > 200 { return N; } function h<M: uint8>() where M >= 50 where M <= 100 { return d.<M>(); }');
  unsatisfiable('function g<N: uint8>() where N > 100 { return N; } function h<M: uint8>() where M === 5 { return g.<M>(); }');
  accepted('function e<N: uint8>() where N === 7 { return N; } function h<M: uint8>() where M < 10 { return e.<M>(); }');
  accepted('function m<N: uint8, K: uint8>() where N < K { return N; } function h<M: uint8>() where M > 50 { return m.<M, 100>(); }');
  accepted('function d<N: uint8>() where N < 10 || N > 60 { return N; } function h<M: uint8>() where M >= 50 where M <= 100 { return d.<M>(); }');
});
test("a callee parameter is mapped by declaration, never by spelling", () => {
  accepted('function g<N: uint8>() where N > 100 { return N; } function h<M: uint8, N: uint8>() where N < 50 where M > 200 { return g.<M>(); }');
  unsatisfiable('function g<N: uint8>() where N > 100 { return N; } function h<N: uint8>() where N < 50 { return g.<N>(); }');
});
test('a conditional enclosing clause holds the union of its branches under their test', () => {
  unsatisfiable('function g<N: uint8>() where N > 100 { return N; } function h<M: uint8>() where if (M > 0) { M < 50 } else { false } { return g.<M>(); }');
  accepted('function g<N: uint8>() where N > 100 { return N; } function h<M: uint8>() where if (M > 200) { M < 250 } else { false } { return g.<M>(); }');
});
test('a class applied in an expression retains its clauses', () => {
  unsatisfiable('class V<N: uint8> where N > 100 {} function h<M: uint8>() where M < 50 { return new V.<M>(); }');
  unsatisfiable('class V<N: uint8> where N > 100 { static m() { return 1; } } function h<M: uint8>() where M < 50 { return V.<M>.m(); }');
  accepted('class V<N: uint8> where N > 100 { static m() { return 1; } } function h<M: uint8>() where M > 150 { return V.<M>.m(); }');
  expect(evaluated('class V<N: uint8> where N > 100 { static m() { return 1; } } function h<M: uint8>() where M > 150 { return V.<M>.m(); } String(h.<200>());')).toBe('1');
});
