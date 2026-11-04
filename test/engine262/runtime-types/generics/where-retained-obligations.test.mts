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

test('an application the enclosing parameter\'s domain rules out is refused', () => {
  unsatisfiable('function g<N: uint32>() where N > 1000 { return N; } function h<M: uint8>() { return g.<M>(); }');
});

test('an obligation that can hold stays a specialization-time check', () => {
  expect(evaluated(`${G} function h<M: uint8>() where M > 150 { return g.<M>(); } String(h.<200>());`)).toBe('200');
  expect(observeScript(`${G} function h<M: uint8>() { return g.<M>(); } h.<5>();`)).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});
