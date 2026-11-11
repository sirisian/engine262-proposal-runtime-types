import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-specialization-lists: the primary binds before a class specialization
 * is matched, so a specialization whose fixed arguments a clause of the
 * primary rejects, or whose own clauses can never hold under the primary's,
 * reaches no application. A class family has no standalone case to receive
 * it, so it is refused at its declaration.
 */
const unreachable = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-specialization-contract' } });
};
const impossible = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
};

test('a fixed argument the primary\'s clause rejects leaves the specialization unreachable', () => {
  unreachable('class B<N: uint8> where N > 100 {} class B<5> {}');
  unreachable('class B<N: uint8> where N > 100 {} partial class B<5> { extra(): void {} }');
  expect(evaluated('class B<N: uint8> where N > 100 {} class B<120> {} String(new B.<120>() instanceof B.<120>);')).toBe('true');
});

test('a clause over two parameters is decided where the list fixes both', () => {
  unreachable('class B<N: uint8, M: uint8> where N < M {} class B<5, 5> {}');
  expect(evaluated("class B<N: uint8, M: uint8> where N < M {} class B<5, 6> {} 'ok';")).toBe('ok');
  // A capture leaves the clause to each application.
  expect(evaluated("class B<N: uint8, M: uint8> where N < M {} class B<5, const K> {} 'ok';")).toBe('ok');
});

test('a clause over a type parameter is decided for a fixed type', () => {
  unreachable('class B<T: type> where Reflect.isAssignable(T, uint8) {} class B<string> {}');
  expect(evaluated("class B<T: type> where Reflect.isAssignable(T, uint8) {} class B<uint8> {} 'ok';")).toBe('ok');
});

test('a specialization\'s own clauses are judged under the primary\'s', () => {
  impossible('class B<N: uint8> where N > 100 {} class B<const M> where M < 50 {}');
  impossible('class B<N: uint8, M: uint8> where N > 100 {} class B<const K, 7> where K < 50 {}');
  expect(evaluated("class B<N: uint8> where N > 100 {} class B<const M> where M > 200 {} 'ok';")).toBe('ok');
  expect(evaluated("class B<N: uint8> where N > 100 {} class B<const M> {} 'ok';")).toBe('ok');
});

test('the domain and bound judgments stand beside the clause judgment', () => {
  unreachable('class B<N: uint8> {} class B<300> {}');
  unreachable('class B<T: type extends uint8> {} class B<string> {}');
  expect(evaluated("class B<N: uint8> {} class B<5> {} 'ok';")).toBe('ok');
});

test('an application of the same arguments is still refused by the primary\'s clause', () => {
  expect(observeScript('class B<N: uint8> where N > 100 {} new B.<5>();'))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
});
